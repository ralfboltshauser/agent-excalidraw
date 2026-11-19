import {test as base,expect,_electron,type ElectronApplication,type Page} from '@playwright/test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import type {Reply,Request} from '../src/shared/types';

const execute=promisify(execFile);
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cliEntry=path.join(repository,'dist','cli','index.js');
const modifier=process.platform==='darwin'?'Meta':'Control';

type Workspace={
  application:ElectronApplication;
  page:Page;
  root:string;
  dataDirectory:string;
  drawingsDirectory:string;
  cli:(command:string,payload?:Record<string,any>)=>Promise<Reply>;
  invoke:(request:Request)=>Promise<Reply>;
  restartAfterCrash:()=>Promise<void>;
  screenshot:(name:string)=>Promise<void>;
};
function result(reply:Reply):any{
  expect(reply.ok,reply.ok?'':`${reply.error.code}: ${reply.error.message}`).toBe(true);
  return reply.ok?reply.result:undefined;
}
function errorCode(reply:Reply):string|undefined{return reply.ok?undefined:reply.error.code}
function live(elements:any[]){return elements.filter(element=>!element.isDeleted)}

const test=base.extend<{workspace:Workspace}>({
  workspace:async({},use,testInfo)=>{
    // Short Unix paths avoid the macOS sockaddr_un pathname limit. All source
    // drawings and app metadata stay inside this owned temporary test home.
    const root=await mkdtemp(path.join(process.platform==='darwin'?'/tmp':tmpdir(),'ae-e2e-'));
    const dataDirectory=path.join(root,'data'),drawingsDirectory=path.join(root,'drawings');
    await mkdir(drawingsDirectory,{recursive:true});
    const environment:Record<string,string>={};
    for(const [key,value] of Object.entries(process.env))if(value!==undefined&&!['ELECTRON_RUN_AS_NODE','NODE_OPTIONS'].includes(key))environment[key]=value;
    environment.AGENT_EXCALIDRAW_DATA_DIR=dataDirectory;
    const processLogs:string[]=[];
    let current!:ElectronApplication;
    let page!:Page;
    async function launch(){
      const packagedExecutable=process.env.AGENT_EXCALIDRAW_EXECUTABLE;
      current=await _electron.launch({...(packagedExecutable?{executablePath:path.resolve(packagedExecutable)}:{}),args:packagedExecutable?[]:['.'],cwd:repository,env:environment,timeout:60_000});
      current.process().stdout?.on('data',chunk=>processLogs.push(String(chunk)));
      current.process().stderr?.on('data',chunk=>processLogs.push(String(chunk)));
      page=await current.firstWindow();
      page.on('pageerror',error=>processLogs.push(`RENDERER ERROR: ${error.stack||error.message}\n`));
      await page.waitForFunction(()=>Boolean(window.agentExcalidraw));
      await expect(page.getByRole('button',{name:'New drawing',exact:true})).toBeEnabled();
      await expect.poll(async()=>{
        try{return JSON.parse(await readFile(path.join(dataDirectory,'endpoint.json'),'utf8')).protocol}catch{return null}
      }).toBe(1);
      const configured=await page.evaluate(async folder=>window.agentExcalidraw.invoke({command:'settings',args:{defaultFolder:folder,theme:'light'}}),drawingsDirectory);
      result(configured);
    }
    try{await launch()}catch(error){if(current)await current.close().catch(()=>current.process().kill('SIGKILL'));throw error}
    const workspace:Workspace={
      get application(){return current},get page(){return page},root,dataDirectory,drawingsDirectory,
      async invoke(request){return page.evaluate(request=>window.agentExcalidraw.invoke(request),request)},
      async cli(command,payload={}){
        const input=path.join(root,`input-${randomUUID()}.json`);
        await writeFile(input,JSON.stringify(payload),{mode:0o600});
        try{
          const {stdout}=await execute(process.execPath,command==='schema'?[cliEntry,'schema','--json']:[cliEntry,command,'--input',input,'--json','--no-launch'],{cwd:repository,env:environment,timeout:60_000,maxBuffer:32*1024*1024});
          return JSON.parse(stdout.trim()) as Reply;
        }catch(error:any){
          // CLI validation/application errors intentionally exit nonzero. Keep
          // their real machine-readable envelopes available for assertions.
          if(error.stdout?.trim()){try{return JSON.parse(error.stdout.trim()) as Reply}catch{}}
          throw error;
        }
      },
      async restartAfterCrash(){
        const process=current.process();
        const exited=once(process,'exit');
        process.kill('SIGKILL');
        await exited;
        await launch();
      },
      async screenshot(name){
        const destination=testInfo.outputPath(`${name}.png`);
        await page.screenshot({path:destination,fullPage:true});
        await testInfo.attach(name,{path:destination,contentType:'image/png'});
      },
    };
    try{await use(workspace)}finally{
      // Save through the public command path before normal close. If a test
      // intentionally caused a conflict, preserve a copy inside the test home.
      try{
        const status=result(await workspace.invoke({command:'status'}));
        if(status.active){
          const saved=await workspace.invoke({command:'save'});
          if(!saved.ok)await workspace.invoke({command:'save-as',args:{path:path.join(root,`teardown-${randomUUID()}.excalidraw`)}});
        }
      }catch(error){processLogs.push(`TEARDOWN SAVE: ${String(error)}\n`)}
      try{await Promise.race([current.close(),new Promise((_,reject)=>{const timeout=setTimeout(()=>reject(new Error('Native test app did not close after saving.')),5000);timeout.unref()})])}catch(error){processLogs.push(`TEARDOWN CLOSE: ${String(error)}\n`);current.process().kill('SIGKILL')}
      await testInfo.attach('electron-process.log',{body:Buffer.from(processLogs.join('')),contentType:'text/plain'});
      await testInfo.attach('test-home.txt',{body:Buffer.from(root),contentType:'text/plain'});
      // Keep the fixture on failure for diagnosis and never delete source files
      // from outside this root. Successful fixtures are also useful evidence.
    }
  },
});

async function snapshot(workspace:Workspace){return result(await workspace.cli('snapshot'))}
async function apply(workspace:Workspace,operations:any[],context?:any,requestId=randomUUID()){
  const inspected=context||await snapshot(workspace);
  return workspace.cli('apply',{document:inspected.document,epoch:inspected.epoch,expectedRevision:inspected.revision,requestId,session:'e2e-agent',operations});
}
async function create(workspace:Workspace,title='Agent onboarding'){
  const file=path.join(workspace.drawingsDirectory,`${title}.excalidraw`);
  return result(await workspace.cli('new',{title,path:file}));
}
async function target(workspace:Workspace){const scene=await snapshot(workspace);return {document:scene.document,epoch:scene.epoch}}
async function focusCanvas(page:Page){
  const canvas=page.locator('canvas.excalidraw__canvas.interactive');
  await expect(canvas).toBeVisible();
  const box=await canvas.boundingBox();
  if(!box)throw new Error('The actual interactive Excalidraw canvas has no bounds.');
  await page.mouse.click(box.x+box.width-90,box.y+box.height-100);
  return box;
}

test('native shell journeys remain minimal and expose real file locations',async({workspace})=>{
  const page=workspace.page;
  await expect(page.getByRole('heading',{name:/A little space for/})).toBeVisible();
  await workspace.screenshot('01-first-launch');
  await page.getByRole('button',{name:'New drawing',exact:true}).click();
  await expect(page.locator('.drawing-title')).toBeVisible();
  await expect(page.getByRole('button',{name:'Saved',exact:true})).toBeVisible();
  await workspace.screenshot('02-empty-editor');
  await page.locator('.drawing-title').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText(workspace.drawingsDirectory);
  await workspace.screenshot('03-document-location');
  await page.getByLabel('Name',{exact:true}).fill('A quieter onboarding');
  await page.getByRole('button',{name:'Rename',exact:true}).click();
  await expect(page.locator('.drawing-title')).toContainText('A quieter onboarding');
  const host=result(await workspace.invoke({command:'status'}));
  expect(JSON.parse(await readFile(host.active.path,'utf8')).type).toBe('excalidraw');
  await page.getByRole('button',{name:'Your drawings',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your drawings',exact:true})).toBeVisible();
  await expect(page.locator('.open-drawing').filter({hasText:'A quieter onboarding'})).toBeVisible();
  await workspace.screenshot('04-library');
  await page.getByRole('button',{name:'Star drawing',exact:true}).click();
  await page.getByRole('button',{name:'Starred',exact:true}).click();
  await expect(page.locator('.open-drawing').filter({hasText:'A quieter onboarding'})).toBeVisible();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Make yourself at home.'})).toBeVisible();
  await workspace.screenshot('05-settings-light');
  await page.getByRole('button',{name:'dark appearance',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await workspace.screenshot('06-settings-dark');
  await page.getByRole('button',{name:'light appearance',exact:true}).click();
  await page.getByRole('button',{name:'Review recovery…',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('No unsaved recovery snapshots.');
  await workspace.screenshot('07-recovery-empty');
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:/Keyboard & help/}).click();
  await expect(page.getByRole('heading',{name:'Room to think.',exact:true})).toBeVisible();
  await workspace.screenshot('08-help');
  await page.getByRole('button',{name:'Set up your agent',exact:false}).click();
  await expect(page.getByRole('heading',{name:/Your agent.*The same canvas/})).toBeVisible();
  await workspace.screenshot('09-agents');
  await page.getByRole('button',{name:/Prefer MCP/}).click();
  await expect(page.getByRole('dialog')).toContainText('The CLI works independently');
  await workspace.screenshot('10-optional-mcp');
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Back to your space',exact:true}).click();
  await page.locator('.drawing-title').click();
  await page.getByRole('dialog').getByRole('button',{name:'Export…',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Export does not save unsaved changes');
  await expect(page.getByRole('checkbox',{name:'Include editable drawing',exact:true})).not.toBeChecked();
  await workspace.screenshot('11-export');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:/Find a drawing/}).click();
  await expect(page.getByRole('dialog',{name:'Go to a drawing'})).toBeVisible();
  await page.getByRole('textbox',{name:'Find a drawing',exact:true}).fill('quieter');
  await expect(page.getByRole('dialog')).toContainText('A quieter onboarding');
  await workspace.screenshot('12-quick-switch');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('real CLI creates, binds, edits, renders, saves and reopens with one native undo step',async({workspace},testInfo)=>{
  const schema=result(await workspace.cli('schema'));
  expect(schema.commands.some((command:any)=>command.name==='apply')).toBe(true);
  expect(schema.mutationPreconditions).toEqual(['document','epoch','expectedRevision','requestId']);
  const created=await create(workspace);
  const before=await snapshot(workspace);
  const operations=[
    {op:'create',ref:'start',type:'rectangle',x:120,y:160,width:200,height:100,label:'Start here',backgroundColor:'#e5dbff',fillStyle:'solid'},
    {op:'create',ref:'done',type:'rectangle',x:540,y:160,width:200,height:100,label:'Make it clear'},
    {op:'create',ref:'next',type:'arrow',from:'start',to:'done',label:'next'},
  ];
  const requestId=randomUUID();
  const receipt=result(await apply(workspace,operations,before,requestId));
  const first=receipt.created.find((entry:any)=>entry.ref==='start').id;
  const second=receipt.created.find((entry:any)=>entry.ref==='done').id;
  const connector=receipt.created.find((entry:any)=>entry.ref==='next').id;
  expect(receipt.applied).toBe(true);
  const repeated=result(await apply(workspace,operations,before,requestId));
  expect(repeated.created).toEqual(receipt.created);
  expect(repeated.revision).toBe(receipt.revision);
  const afterCreate=await snapshot(workspace);
  expect(afterCreate.elements).toHaveLength(6);
  const arrow=afterCreate.elements.find((element:any)=>element.id===connector);
  expect(arrow.startBinding.elementId).toBe(first);
  expect(arrow.endBinding.elementId).toBe(second);
  expect(errorCode(await apply(workspace,[{op:'update',id:first,x:999}],before))).toBe('STALE_REVISION');
  expect((await snapshot(workspace)).elements.find((element:any)=>element.id===first).x).toBe(120);
  result(await workspace.cli('view',{...await target(workspace),focus:true}));
  await workspace.screenshot('01-agent-created-diagram');
  const moved=result(await apply(workspace,[{op:'update',id:first,y:340}]));
  expect(moved.revision).toBeGreaterThan(afterCreate.revision);
  const afterMove=await snapshot(workspace);
  expect(afterMove.elements.find((element:any)=>element.id===first).y).toBe(340);
  const movedArrow=afterMove.elements.find((element:any)=>element.id===connector);
  expect(movedArrow.startBinding.elementId).toBe(first);
  expect(movedArrow.endBinding.elementId).toBe(second);
  expect(movedArrow.points).not.toEqual(arrow.points);
  // First establish SDK history using its actual visible controls. This isolates
  // native shortcut routing defects from scene/history integration defects.
  await expect(workspace.page.getByTestId('button-undo')).toBeEnabled();
  await workspace.page.getByTestId('button-undo').click();
  await expect.poll(async()=>{const scene=await snapshot(workspace);return scene.elements.find((element:any)=>element.id===first)?.y}).toBe(160);
  await workspace.page.getByTestId('button-redo').click();
  await expect.poll(async()=>{const scene=await snapshot(workspace);return scene.elements.find((element:any)=>element.id===first)?.y}).toBe(340);
  await workspace.application.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.show();window.focus();window.webContents.focus()});
  await workspace.page.bringToFront();
  await focusCanvas(workspace.page);
  await workspace.page.keyboard.press(`${modifier}+z`);
  await expect.poll(async()=>{const scene=await snapshot(workspace);return scene.elements.find((element:any)=>element.id===first)?.y}).toBe(160);
  // One Undo must retain the earlier complete creation batch.
  expect((await snapshot(workspace)).elements).toHaveLength(6);
  await workspace.screenshot('02-native-undo');
  await workspace.page.keyboard.press(`${modifier}+Shift+z`);
  await expect.poll(async()=>{const scene=await snapshot(workspace);return scene.elements.find((element:any)=>element.id===first)?.y}).toBe(340);
  const targetContext=await target(workspace);
  const png=path.join(workspace.root,'diagram.png'),svg=path.join(workspace.root,'diagram.svg');
  const rendered=result(await workspace.cli('render',{...targetContext,output:png,format:'png'}));
  expect(rendered.path).toBe(png);
  const bytes=await readFile(png);
  expect([...bytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
  await workspace.cli('render',{...targetContext,output:svg,format:'svg'}).then(result);
  expect(await readFile(svg,'utf8')).toContain('<svg');
  const saved=result(await workspace.cli('save',targetContext));
  expect(saved.path).toBe(created.path);
  const persisted=JSON.parse(await readFile(created.path,'utf8'));
  expect(live(persisted.elements)).toHaveLength(6);
  expect(persisted.elements.find((element:any)=>element.id===first).y).toBe(340);
  await workspace.screenshot('03-saved-diagram');
  await testInfo.attach('persisted-drawing',{path:created.path,contentType:'application/json'});
  await testInfo.attach('rendered-png',{path:png,contentType:'image/png'});
  await testInfo.attach('rendered-svg',{path:svg,contentType:'image/svg+xml'});
  const reopened=result(await workspace.cli('open',{path:created.path}));
  expect(reopened.epoch).not.toBe(before.epoch);
  const restored=await snapshot(workspace);
  expect(restored.elements.find((element:any)=>element.id===first).y).toBe(340);
  expect(restored.elements.find((element:any)=>element.id===connector).startBinding.elementId).toBe(first);
  expect(errorCode(await apply(workspace,[{op:'update',id:first,x:900}],afterMove))).toBe('STALE_EPOCH');
});

test('a human gesture and a stale agent request cannot overwrite each other',async({workspace})=>{
  await create(workspace,'Human and agent');
  const before=await snapshot(workspace);
  const box=await focusCanvas(workspace.page);
  await workspace.page.getByTestId('toolbar-rectangle').locator('..').click();
  await expect(workspace.page.getByRole('radio',{name:'Rectangle',exact:true})).toBeChecked();
  await focusCanvas(workspace.page);
  await workspace.page.keyboard.press('v');
  await expect(workspace.page.getByRole('radio',{name:'Selection',exact:true})).toBeChecked();
  await workspace.page.keyboard.press('r');
  await expect(workspace.page.getByRole('radio',{name:'Rectangle',exact:true})).toBeChecked();
  await workspace.page.mouse.move(box.x+300,box.y+260);
  await workspace.page.mouse.down();
  await workspace.page.mouse.move(box.x+500,box.y+380,{steps:10});
  const midGesture=await snapshot(workspace);
  const refused=await apply(workspace,[{op:'create',type:'text',x:700,y:200,text:'Do not interrupt'}],midGesture);
  expect(errorCode(refused)).toBe('DOCUMENT_BUSY');
  await workspace.page.mouse.up();
  const afterHuman=await snapshot(workspace);
  expect(afterHuman.elements.filter((element:any)=>element.type==='rectangle')).toHaveLength(1);
  expect(afterHuman.revision).toBeGreaterThan(before.revision);
  expect(errorCode(await apply(workspace,[{op:'create',type:'text',text:'Stale edit',x:20,y:20}],before))).toBe('STALE_REVISION');
  result(await apply(workspace,[{op:'create',type:'text',text:'Your sketch, a little clearer.',x:300,y:430}]));
  const combined=await snapshot(workspace);
  expect(combined.elements.some((element:any)=>element.type==='rectangle')).toBe(true);
  expect(combined.elements.some((element:any)=>element.text==='Your sketch, a little clearer.')).toBe(true);
  await workspace.screenshot('01-human-and-agent');
  result(await workspace.cli('stop',{session:'e2e-agent'}));
  expect(errorCode(await apply(workspace,[{op:'create',type:'text',text:'Stopped',x:0,y:0}]))).toBe('SESSION_PAUSED');
  result(await workspace.cli('resume',{session:'e2e-agent'}));
  result(await workspace.cli('save',await target(workspace)));
});

test('external changes preserve both disk data and unsaved work',async({workspace},testInfo)=>{
  const created=await create(workspace,'A shared filename');
  const applied=result(await apply(workspace,[{op:'create',ref:'note',type:'text',text:'Saved original',x:180,y:180}]));
  const textId=applied.created[0].id;
  result(await workspace.cli('save',await target(workspace)));
  const original=JSON.parse(await readFile(created.path,'utf8'));
  result(await apply(workspace,[{op:'update',id:textId,text:'Unsaved local thought'}]));
  const outside={...original,appState:{...original.appState,viewBackgroundColor:'#fff4e6'}};
  const externalBytes=JSON.stringify(outside,null,2)+'\n';
  await writeFile(created.path,externalBytes);
  const failed=await workspace.cli('save',await target(workspace));
  expect(errorCode(failed)).toBe('FILE_CONFLICT');
  expect(await readFile(created.path,'utf8')).toBe(externalBytes);
  await expect(workspace.page.getByRole('alert')).toContainText('changed outside the app');
  await workspace.screenshot('01-external-change-error');
  expect((await snapshot(workspace)).elements.find((element:any)=>element.id===textId).text).toBe('Unsaved local thought');
  const copyPath=path.join(workspace.drawingsDirectory,'My preserved copy.excalidraw');
  result(await workspace.cli('save-as',{...await target(workspace),path:copyPath}));
  expect(await readFile(created.path,'utf8')).toBe(externalBytes);
  expect(JSON.parse(await readFile(copyPath,'utf8')).elements.find((element:any)=>element.id===textId).text).toBe('Unsaved local thought');
  await testInfo.attach('external-original',{path:created.path,contentType:'application/json'});
  await testInfo.attach('preserved-local-copy',{path:copyPath,contentType:'application/json'});
  const unsupportedPath=path.join(workspace.drawingsDirectory,'Future drawing.excalidraw');
  const unsupportedBytes=JSON.stringify({...original,elements:[{id:'future-sticky',type:'stickynote',x:0,y:0}]});
  await writeFile(unsupportedPath,unsupportedBytes);
  expect(errorCode(await workspace.cli('open',{path:unsupportedPath}))).toBe('UNSUPPORTED_FORMAT');
  expect(await readFile(unsupportedPath,'utf8')).toBe(unsupportedBytes);
  expect(result(await workspace.invoke({command:'status'})).active.path).toBe(await realpath(copyPath));
});

test('a real process crash offers a recovery copy without replacing the source',async({workspace},testInfo)=>{
  const created=await create(workspace,'A thought worth keeping');
  const originalBytes=await readFile(created.path,'utf8');
  result(await apply(workspace,[{op:'create',type:'text',text:'Unsaved but recoverable',x:200,y:180}]));
  await expect.poll(async()=>{
    const reply=await workspace.invoke({command:'recovery-list'});
    return reply.ok?reply.result.recovery.length:0;
  }).toBe(1);
  expect(await readFile(created.path,'utf8')).toBe(originalBytes);
  await workspace.restartAfterCrash();
  await expect(workspace.page.getByRole('heading',{name:'Your drawings',exact:true})).toBeVisible();
  await workspace.page.getByRole('button',{name:/unsaved drawing can be recovered/}).click();
  await expect(workspace.page.getByRole('dialog')).toContainText('Your original files stay unchanged.');
  await workspace.screenshot('01-real-crash-recovery');
  await workspace.page.getByRole('button',{name:'Restore a copy',exact:true}).click();
  await expect(workspace.page.getByRole('dialog')).not.toBeVisible();
  const restored=result(await workspace.invoke({command:'status'}));
  expect(restored.active.path).not.toBe(created.path);
  expect(await readFile(created.path,'utf8')).toBe(originalBytes);
  const recovered=JSON.parse(await readFile(restored.active.path,'utf8'));
  expect(recovered.elements.some((element:any)=>element.text==='Unsaved but recoverable')).toBe(true);
  await workspace.screenshot('02-recovered-copy');
  await testInfo.attach('untouched-original',{path:created.path,contentType:'application/json'});
  await testInfo.attach('recovered-copy',{path:restored.active.path,contentType:'application/json'});
});

async function internalSceneCommand(workspace:Workspace,request:Request):Promise<Reply>{
  // Exercise the real renderer through the same narrow IPC channel as main.
  // The public CLI/renderer bridge intentionally cannot invoke load/capture.
  const envelope={id:`e2e-${randomUUID()}`,request};
  return workspace.application.evaluate(({BrowserWindow,ipcMain},envelope)=>new Promise<Reply>((resolve,reject)=>{
    const timeout=setTimeout(()=>{ipcMain.removeListener('scene-reply',listener);reject(new Error('The actual renderer did not reply to the integration probe.'))},10_000);
    const listener=(_event:unknown,message:{id:string;reply:Reply})=>{
      if(message.id!==envelope.id)return;
      clearTimeout(timeout);ipcMain.removeListener('scene-reply',listener);resolve(message.reply);
    };
    ipcMain.on('scene-reply',listener);
    BrowserWindow.getAllWindows()[0].webContents.send('scene-command',envelope);
  }),envelope);
}

test('a real PNG imported through the image picker survives undo, save and reopen',async({workspace},testInfo)=>{
  const drawing=await create(workspace,'A local image');
  const imagePath=path.join(workspace.root,'local-image.png');
  const dataUrl=await workspace.page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#eeedff';ctx.fillRect(0,0,320,180);
    ctx.strokeStyle='#6965db';ctx.lineWidth=3;ctx.strokeRect(24,24,272,132);
    ctx.fillStyle='#20212b';ctx.font='22px sans-serif';ctx.fillText('A local image',82,96);
    return canvas.toDataURL('image/png');
  });
  await writeFile(imagePath,Buffer.from(dataUrl.split(',')[1],'base64'));
  const chooserPromise=workspace.page.waitForEvent('filechooser',{timeout:10_000});
  await workspace.page.getByTestId('toolbar-image').locator('..').click();
  const chooser=await chooserPromise.catch(async error=>{await workspace.screenshot('image-picker-failure');throw error});
  await chooser.setFiles(imagePath);
  await expect.poll(async()=>{
    const scene=await snapshot(workspace);
    return Boolean(scene.elements.find((element:any)=>element.type==='image')?.fileId);
  }).toBe(true);
  const canvas=workspace.page.locator('canvas.excalidraw__canvas.interactive');
  const bounds=await canvas.boundingBox();if(!bounds)throw new Error('Image placement canvas has no bounds.');
  await workspace.page.mouse.move(bounds.x+380,bounds.y+280);
  await workspace.page.mouse.click(bounds.x+380,bounds.y+280);
  await expect.poll(async()=>{const image=(await snapshot(workspace)).elements.find((element:any)=>element.type==='image');return Boolean(image&&image.width>0&&image.height>0)}).toBe(true);
  const imported=(await snapshot(workspace)).elements.find((element:any)=>element.type==='image');
  expect(imported.fileId).toBeTruthy();
  result(await workspace.cli('save',await target(workspace)));
  const persisted=JSON.parse(await readFile(drawing.path,'utf8'));
  expect(persisted.files[imported.fileId].mimeType).toBe('image/png');
  const binary=persisted.files[imported.fileId].dataURL;
  expect(binary).toMatch(/^data:image\/png;base64,/);
  expect([...Buffer.from(binary.split(',')[1],'base64').subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
  await workspace.screenshot('01-imported-image');
  await focusCanvas(workspace.page);
  const beforeUndo=await snapshot(workspace);
  await workspace.page.keyboard.press(`${modifier}+z`);
  let undoSteps=1;
  let undone=await snapshot(workspace);
  // The pinned SDK records asynchronous image insertion and placement at two
  // native history boundaries. Agent batches have their separate one-step test.
  if(undone.elements.some((element:any)=>element.type==='image')){
    await workspace.page.keyboard.press(`${modifier}+z`);undoSteps++;
  }
  await expect.poll(async()=>((await snapshot(workspace)).elements.filter((element:any)=>element.type==='image').length)).toBe(0);
  await workspace.screenshot('02-image-undo');
  for(let step=0;step<undoSteps;step++)await workspace.page.keyboard.press(`${modifier}+Shift+z`);
  await expect.poll(async()=>((await snapshot(workspace)).elements.filter((element:any)=>element.type==='image').length)).toBe(1);
  const redone=(await snapshot(workspace)).elements.find((element:any)=>element.type==='image');
  const originalImage=beforeUndo.elements.find((element:any)=>element.type==='image');
  expect(redone.fileId).toBe(imported.fileId);
  expect({x:redone.x,y:redone.y,width:redone.width,height:redone.height}).toEqual({x:originalImage.x,y:originalImage.y,width:originalImage.width,height:originalImage.height});
  await testInfo.attach('native-image-history',{body:Buffer.from(JSON.stringify({undoSteps,redoSteps:undoSteps})),contentType:'application/json'});
  result(await workspace.cli('save',await target(workspace)));
  result(await workspace.cli('open',{path:drawing.path}));
  const reopened=(await snapshot(workspace)).elements.find((element:any)=>element.type==='image');
  expect(reopened.fileId).toBe(imported.fileId);expect(reopened.width).toBeGreaterThan(0);expect(reopened.height).toBeGreaterThan(0);
  const restored=JSON.parse(await readFile(drawing.path,'utf8'));
  expect(restored.files[reopened.fileId].dataURL).toBe(binary);
  const output=path.join(workspace.root,'imported-image-render.png');
  result(await workspace.cli('render',{...await target(workspace),output,format:'png'}));
  await workspace.screenshot('03-reopened-image');
  await testInfo.attach('image-source',{path:imagePath,contentType:'image/png'});
  await testInfo.attach('drawing-with-embedded-image',{path:drawing.path,contentType:'application/json'});
  await testInfo.attach('reopened-image-render',{path:output,contentType:'image/png'});
});

test('Stop cancels both font preparation and queued edits before anything is applied',async({workspace})=>{
  await create(workspace,'Stop before commit');
  const before=await snapshot(workspace);
  await workspace.page.evaluate(()=>{
    const fonts=document.fonts;
    const original=fonts.load;
    const gate={blocked:false,release:null as (()=>void)|null,original};
    (window as any).__e2eFontGate=gate;
    // Delay the real browser font preparation rather than replace measurement,
    // the editor, the renderer command handler or any drawing state.
    fonts.load=async function(font:string,text?:string){
      gate.blocked=true;
      await new Promise<void>(resolve=>gate.release=resolve);
      return original.call(fonts,font,text);
    };
  });
  let pending:Promise<Reply>|undefined,queued:Promise<Reply>|undefined;
  try{
    pending=apply(workspace,[{op:'create',type:'text',text:'Must never appear',x:180,y:180}],before);
    await workspace.page.waitForFunction(()=>(window as any).__e2eFontGate?.blocked===true);
    queued=apply(workspace,[{op:'create',type:'rectangle',x:500,y:200,width:100,height:80}],before);
    const stopped=result(await workspace.invoke({command:'stop',args:{session:'e2e-agent'}}));
    expect(stopped.paused).toBe(true);
    await workspace.page.evaluate(()=>{
      const gate=(window as any).__e2eFontGate;
      document.fonts.load=gate.original;gate.release();
    });
    expect(errorCode(await pending)).toBe('OPERATION_CANCELLED');
    expect(['OPERATION_CANCELLED','SESSION_PAUSED']).toContain(errorCode(await queued));
    const unchanged=await snapshot(workspace);
    expect(unchanged.elements).toHaveLength(0);expect(unchanged.revision).toBe(before.revision);
    expect(errorCode(await apply(workspace,[{op:'create',type:'text',text:'Still paused',x:0,y:0}]))).toBe('SESSION_PAUSED');
    result(await workspace.invoke({command:'resume',args:{session:'e2e-agent'}}));
    result(await apply(workspace,[{op:'create',type:'text',text:'Resumed with your permission.',x:180,y:180}]));
    expect((await snapshot(workspace)).elements.some((element:any)=>element.text==='Resumed with your permission.')).toBe(true);
    await workspace.screenshot('01-resumed-after-cancellation');
  }finally{
    await workspace.page.evaluate(()=>{const gate=(window as any).__e2eFontGate;if(gate){document.fonts.load=gate.original;gate.release?.();delete (window as any).__e2eFontGate}}).catch(()=>{});
    await pending?.catch(()=>{});await queued?.catch(()=>{});
  }
});

test('the final renderer load guard preserves edits made after switch approval',async({workspace})=>{
  const drawing=await create(workspace,'Keep the latest edit');
  const approved=await snapshot(workspace);
  const changed=result(await apply(workspace,[{op:'create',ref:'human-work',type:'rectangle',x:220,y:180,width:200,height:100,label:'Keep this thought'}],approved));
  const beforeRefusal=await snapshot(workspace);
  expect(beforeRefusal.revision).toBeGreaterThan(approved.revision);
  const candidate={
    command:'load',
    args:{drawing:{id:randomUUID(),path:path.join(workspace.drawingsDirectory,'Another drawing.excalidraw'),title:'Another drawing'},
      epoch:randomUUID(),
      scene:{type:'excalidraw',version:2,source:'integration-test',elements:[],appState:{viewBackgroundColor:'#ffffff'},files:{}},
      previous:{document:approved.document,epoch:approved.epoch,revision:approved.revision}},
  };
  const refused=await internalSceneCommand(workspace,candidate);
  expect(errorCode(refused)).toBe('STALE_REVISION');
  const afterRefusal=await snapshot(workspace);
  expect(afterRefusal.document).toBe(beforeRefusal.document);expect(afterRefusal.epoch).toBe(beforeRefusal.epoch);
  expect(afterRefusal.revision).toBe(beforeRefusal.revision);expect(afterRefusal.elements).toEqual(beforeRefusal.elements);
  const host=result(await workspace.invoke({command:'status'}));
  expect(host.epoch).toBe(beforeRefusal.epoch);expect(host.active.path).toBe(drawing.path);
  // Public clients cannot skip the file service by calling an internal load.
  expect(errorCode(await workspace.invoke(candidate))).toBe('UNKNOWN_COMMAND');
  const dismiss=workspace.page.getByRole('button',{name:'Dismiss message',exact:true});
  if(await dismiss.isVisible())await dismiss.click();
  result(await apply(workspace,[{op:'update',id:changed.created[0].id,backgroundColor:'#e5dbff',fillStyle:'solid'}]));
  await workspace.screenshot('01-edits-preserved-after-stale-switch');
  result(await workspace.cli('save',await target(workspace)));
});

test('settings and agent education stay open before any drawing exists',async({workspace})=>{
  const page=workspace.page;
  expect(result(await workspace.invoke({command:'status'})).active).toBeNull();
  await page.getByRole('button',{name:'Agents',exact:true}).click();
  await expect(page.getByRole('heading',{name:/Your agent.*The same canvas/})).toBeVisible();
  await page.getByRole('button',{name:'Back to your space',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your drawings',exact:true})).toBeVisible();
  await workspace.screenshot('01-empty-library');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Make yourself at home.'})).toBeVisible();
  await page.getByRole('button',{name:'dark appearance',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.getByRole('heading',{name:'Make yourself at home.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'dark appearance',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(result(await workspace.invoke({command:'status'})).active).toBeNull();
  await workspace.screenshot('02-settings-without-a-drawing');
  await page.getByRole('button',{name:/Keyboard & help/}).click();
  await expect(page.getByRole('heading',{name:'Room to think.',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Set up your agent',exact:false}).click();
  await expect(page.getByRole('heading',{name:/Your agent.*The same canvas/})).toBeVisible();
  // integration-status broadcasts metadata while no document is active. That
  // must not redirect this education flow back to Welcome or Library.
  result(await workspace.invoke({command:'integration-status'}));
  await expect(page.getByRole('heading',{name:/Your agent.*The same canvas/})).toBeVisible();
  await workspace.screenshot('03-agent-education-without-a-drawing');
});
