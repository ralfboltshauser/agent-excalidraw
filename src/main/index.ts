import {app,BrowserWindow,Menu,dialog,ipcMain,protocol,net as electronNet,session,shell,clipboard} from 'electron';
import {watch,type FSWatcher} from 'node:fs';
import {createServer} from 'node:net';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,chmod,unlink,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {integrationStatus,installLocalCli,installSkill} from './integrations.js';
import {FileStore} from './files.js';
import {AppError,failure,success,type Reply,type Request,type Scene,type HostState} from '../shared/types.js';
const here=path.dirname(fileURLToPath(import.meta.url));
app.setName('agent-excalidraw');
if(process.env.AGENT_EXCALIDRAW_DATA_DIR)app.setPath('userData',path.resolve(process.env.AGENT_EXCALIDRAW_DATA_DIR));
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const lock=app.requestSingleInstanceLock();if(!lock){app.quit();process.exit(0)}
let window:BrowserWindow,store:FileStore,rendererReady=false,dirty=false,saving=false,quitting=false,loading=false;
let approvedTransition:any=null;
let watcher:FSWatcher|undefined,watchedPath='',external={changed:false,missing:false},saveError=false;
let currentRevision=0,epoch=randomUUID(),errorMessage:string|null=null;
let lastUsed:number|null=null,working=false,agentSession:string|null=null;
const paused=new Set<string>(),pending=new Map<string,{resolve:(r:Reply)=>void;timer:ReturnType<typeof setTimeout>}>();
const receipts=new Map<string,{hash:string;reply:Reply}>();
let recoveryTimer:ReturnType<typeof setTimeout>|undefined,lastScene:Scene|undefined;
let readyResolve:()=>void;const readyPromise=new Promise<void>(resolve=>readyResolve=resolve);
const dataDir=app.getPath('userData');
const endpoint=path.join(dataDir,'endpoint.json');
const token=randomBytes(32).toString('hex');
const socket=process.platform==='win32'?`\\\\.\\pipe\\agent-excalidraw-${createHash('sha256').update(dataDir).digest('hex').slice(0,20)}`:path.join(dataDir,'control.sock');
function state():HostState{return {drawings:store?.drawings||[],settings:store?.settings,active:store?.active||null,recovery:[],platform:process.platform,version:app.getVersion(),agent:{lastUsed,working,session:agentSession,paused:agentSession?paused.has(agentSession):false},dirty,saving,error:errorMessage,external,saveError,revision:currentRevision} as HostState}
async function broadcast(){if(!window?.isDestroyed()){if(store.active?.path!==watchedPath){watcher?.close();watchedPath=store.active?.path||'';external={changed:false,missing:false};if(watchedPath){try{watcher=watch(path.dirname(watchedPath),(_kind,file)=>{if(file&&file.toString()!==path.basename(watchedPath))return;void store.externalStatus().then(value=>{external=value;void broadcast()}).catch(()=>{})})}catch{}}}const value=state();value.recovery=await store.recoveries();if(window.isDestroyed()||window.webContents.isDestroyed())return;window.webContents.send('host-state',value);window.setDocumentEdited(dirty);window.setTitle(`${store.active?.title||'Agent Excalidraw'}${dirty?' •':''} — Agent Excalidraw`)}}
async function scene(request:Request):Promise<any>{if(!rendererReady)await Promise.race([readyPromise,new Promise((_,reject)=>setTimeout(()=>reject(new AppError('APP_STARTING','The editor is still starting. Retry shortly.')),15000))]);const id=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new AppError('OUTCOME_UNKNOWN','The editor did not reply. Inspect the document before retrying this operation.'))},30000);pending.set(id,{timer,resolve:reply=>reply.ok?resolve(reply.result):reject(new AppError(reply.error.code,reply.error.message,reply.error.details))});window.webContents.send('scene-command',{id,request})})}
async function capture(){return await scene({command:'capture',document:store.active?.id}) as {scene:Scene;revision:number}}
async function save(asPath?:string){if(!store.active)throw new AppError('NO_DOCUMENT','Open or create a drawing first.');saving=true;errorMessage=null;saveError=false;await broadcast();try{const captured=await capture();const drawing=asPath?await store.saveAs(captured.scene,asPath):await store.save(captured.scene);if(asPath){const rebound=await scene({command:'rebind',args:{document:drawing.id}});epoch=rebound.epoch;}const marked=await scene({command:'mark-saved',args:{revision:captured.revision}});dirty=marked.dirty;return {drawing,revision:captured.revision,path:drawing.path,persisted:true}}catch(e){errorMessage=(e as Error).message;saveError=true;throw e}finally{saving=false;await broadcast()}}
async function guard(fromAgent=false):Promise<string|undefined>{
 approvedTransition=null;if(store.active){const live=await capture();if((live as any).busy)throw new AppError('DOCUMENT_BUSY','Finish the current canvas edit before switching drawings.');dirty=(live as any).dirty;currentRevision=live.revision;approvedTransition={document:store.active.id,epoch,revision:live.revision};}
 if(!dirty)return;
 if(fromAgent)throw new AppError('UNSAVED_CHANGES','The active drawing has unsaved edits. Save it or ask the user to switch first.');
 const result=await dialog.showMessageBox(window,{type:'question',message:`Save changes to “${store.active?.title}”?`,detail:'Your drawing has unsaved changes.',buttons:['Save','Don’t save','Cancel'],defaultId:0,cancelId:2,noLink:true});
 if(result.response===2)throw new AppError('CANCELLED','The drawing was kept open.');
 if(result.response===0){await save();const live=await capture();if((live as any).dirty)throw new AppError('DOCUMENT_CHANGED','New edits arrived while saving. Save those changes before switching.');approvedTransition={document:store.active!.id,epoch,revision:live.revision};return;}
 const live=await capture();approvedTransition={document:store.active!.id,epoch,revision:live.revision};return store.active?.id;
}
async function switchDrawing(factory:()=>Promise<{drawing:any;scene:Scene}>,fromAgent=false){const discard=await guard(fromAgent),previous=store.active;clearTimeout(recoveryTimer);try{const result=await activate(await factory());if(discard)await store.discardRecovery(discard);return result}catch(e){store.active=previous;if(previous){try{const live=await capture();dirty=!!(live as any).dirty;currentRevision=live.revision;lastScene=live.scene;if(dirty)await store.writeRecovery(live.scene,live.revision)}catch{errorMessage='The editor could not restore its previous drawing. Your saved file and recovery copies are unchanged.';}}await broadcast();throw e}}
async function activate(result:{drawing:any;scene:Scene}){loading=true;clearTimeout(recoveryTimer);try{const nextEpoch=randomUUID();await scene({command:'load',args:{...result,epoch:nextEpoch,previous:approvedTransition}});epoch=nextEpoch;currentRevision=0;dirty=false;errorMessage=null;saveError=false;lastScene=result.scene;await broadcast();return {document:result.drawing.id,drawing:result.drawing,path:result.drawing.path,epoch,revision:0}}finally{loading=false}}
const mutationCommands=new Set(['apply','layout','revert-last-agent-batch']);
async function execute(request:Request,fromAgent=false):Promise<any>{const args=request.args||{};const command=request.command;if(!command||typeof command!=='string')throw new AppError('INVALID_REQUEST','A command is required.');if(request.document&&request.document!==store.active?.id&&!['open','list','status'].includes(command))throw new AppError('DOCUMENT_NOT_ACTIVE','This document is not active. Open it explicitly before editing.');if(fromAgent){agentSession=request.session||'default';if(mutationCommands.has(command)&&paused.has(agentSession))throw new AppError('SESSION_PAUSED','This agent session was stopped. Resume explicitly before editing.');}
 if(fromAgent&&['save','save-as','move','duplicate','view','render','export','reveal'].includes(command)){if(!request.document||!request.epoch)throw new AppError('PRECONDITION_REQUIRED','This command requires document and epoch from a current snapshot.');if(request.document!==store.active?.id||request.epoch!==epoch)throw new AppError('STALE_EPOCH','The target drawing changed or was reopened. Inspect it again.');}
 switch(command){
 case'status':{const s=state();s.recovery=await store.recoveries();return {...s,epoch,revision:currentRevision,protocol:1}}
 case'integration-status':return integrationStatus();
 case'install-cli':return installLocalCli();
 case'install-skill':return installSkill();
 case'list':return {drawings:await store.list()};
 case'path-suggest':return {path:(store as any).pathSuggest? (store as any).pathSuggest(args.title,args.projectDir):path.join(store.settings.defaultFolder,slug(args.title||'Untitled')+'.excalidraw')};
 case'new':return switchDrawing(()=>store.create(args),fromAgent);
 case'open':{const file=args.path||((await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'Excalidraw drawing',extensions:['excalidraw']}]})).filePaths[0]);if(!file)throw new AppError('CANCELLED','No drawing selected.');return switchDrawing(()=>store.open(file),fromAgent)}
 case'save':return save();
 case'reload':{if(!store.active)throw new AppError('NO_DOCUMENT','Open a drawing first.');const result=await dialog.showMessageBox(window,{type:'warning',message:'Reload the version on disk?',detail:'This discards unsaved edits in this window. Save a copy first if you want to keep them.',buttons:['Reload file','Cancel'],defaultId:1,cancelId:1});if(result.response!==0)throw new AppError('CANCELLED','Your drawing is unchanged.');const live=await capture();approvedTransition={document:store.active.id,epoch,revision:live.revision};return activate(await store.open(store.active.path));}
 case'shape-library-get':try{return JSON.parse(await readFile(path.join(dataDir,'shape-library.json'),'utf8'))}catch{return []}
 case'shape-library-set':await writeFile(path.join(dataDir,'shape-library.json'),JSON.stringify(args.items));return {};
 case'save-as':{const file=args.path||(await dialog.showSaveDialog(window,{defaultPath:store.active?.path,filters:[{name:'Excalidraw drawing',extensions:['excalidraw']}]})).filePath;if(!file)throw new AppError('CANCELLED','No destination selected.');return save(file)}
 case'duplicate':{const c=await capture();return {drawing:await store.duplicate(c.scene,args)}}
 case'move':{const file=args.path||(await dialog.showSaveDialog(window,{defaultPath:store.active?.path})).filePath;if(!file)throw new AppError('CANCELLED','No destination selected.');const drawing=await store.move(file);await broadcast();return {drawing}}
 case'rename':{const drawing=await store.rename(args.title);await broadcast();return {drawing}}
 case'reveal':if(store.active)shell.showItemInFolder(store.active.path);return {path:store.active?.path};
 case'copy-path':clipboard.writeText(store.active?.path||'');return {copied:true};
 case'star':await store.star(args.id,args.value);await broadcast();return {};
 case'forget':await store.forget(args.id);await broadcast();return {};
 case'folder-add':{const folder=args.path||(await dialog.showOpenDialog(window,{properties:['openDirectory']})).filePaths[0];if(!folder)throw new AppError('CANCELLED','No folder selected.');await store.addFolder(folder);await broadcast();return {folder}}
 case'folder-remove':await store.removeFolder(args.path);await broadcast();return {};
 case'settings':{if(args.defaultFolder==='choose'){const folder=(await dialog.showOpenDialog(window,{properties:['openDirectory','createDirectory']})).filePaths[0];if(!folder)throw new AppError('CANCELLED','No folder selected.');args.defaultFolder=folder}await store.setSettings(args);await broadcast();return store.settings}
 case'trash':{const drawing=args.id?store.drawings.find(d=>d.id===args.id):store.active;if(!drawing)throw new AppError('NOT_FOUND','No drawing selected.');const wasActive=drawing.id===store.active?.id;const discard=wasActive?await guard(fromAgent):undefined;const result=await dialog.showMessageBox(window,{type:'warning',message:`Move “${drawing.title}” to ${process.platform==='win32'?'Recycle Bin':'Trash'}?`,detail:drawing.path,buttons:['Move to Trash','Cancel'],cancelId:1,defaultId:1});if(result.response!==0)throw new AppError('CANCELLED','File kept.');await shell.trashItem(drawing.path);await store.removeAfterTrash(drawing.id);if(wasActive){clearTimeout(recoveryTimer);dirty=false;if(discard)await store.discardRecovery(discard);}await broadcast();return {trashed:true}}
 case'recovery-list':return {recovery:await store.recoveries()};
 case'recovery-restore':return switchDrawing(()=>store.restoreRecovery(args.id),fromAgent);
 case'recovery-discard':await store.discardRecovery(args.id);await broadcast();return {};
 case'stop':paused.add(args.session||agentSession||'default');await broadcast();return {paused:true,message:'Further changes from this session are paused. Applied changes remain on the canvas.'};
 case'resume':paused.delete(args.session||request.session||agentSession||'default');await broadcast();return {paused:false};
 case'export':case'render':{if(command==='export'&&args.format==='excalidraw'){const captured=await capture();const output=args.output||(await dialog.showSaveDialog(window,{defaultPath:store.active?.title+'.excalidraw'})).filePath;if(!output)throw new AppError('CANCELLED','Export cancelled.');await writeFile(output,JSON.stringify(captured.scene,null,2),{flag:'wx'});return {path:output,revision:captured.revision}}const rendered=await scene({...request,command:'render'});const format=args.format==='svg'?'svg':'png';const output=args.output||(command==='export'?(await dialog.showSaveDialog(window,{defaultPath:(store.active?.title||'drawing')+'.'+format})).filePath:path.join(dataDir,'previews',`${store.active?.id}-${rendered.revision}-${randomUUID().slice(0,8)}.${format}`));if(!output)throw new AppError('CANCELLED','Export cancelled.');await mkdir(path.dirname(output),{recursive:true});await writeFile(output,Buffer.from(rendered.data,'base64'),{flag:'wx'});return {path:output,mime:rendered.mime,revision:rendered.revision,document:store.active?.id}}
 case'window-library':window.webContents.send('ui-action','library');return {};
 case'update-check':{const response=await fetch('https://api.github.com/repos/ralfboltshauser/agent-excalidraw/releases/latest',{headers:{Accept:'application/vnd.github+json'}});if(response.status===404)return {available:false,message:'No public release has been published yet.'};if(!response.ok)throw new AppError('UPDATE_FAILED','Could not check releases. Try again later.');const release=await response.json() as any;return {version:release.tag_name,url:release.html_url,available:release.tag_name!=='v'+app.getVersion()}}
 case'open-releases':await shell.openExternal('https://github.com/ralfboltshauser/agent-excalidraw/releases');return {};
 case'quit':{const discard=await guard(fromAgent);if(discard)await store.discardRecovery(discard);quitting=true;app.quit();return {};}
 default:if(!store.active)throw new AppError('NO_DOCUMENT','Create or open a drawing first.');working=mutationCommands.has(command);await broadcast();try{return await scene({...request,document:store.active.id})}finally{working=false;await broadcast()}
 }}
function slug(s:string){return s.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g,'-').slice(0,100)||'Untitled'}
let commandQueue=Promise.resolve();
function run(request:Request,fromAgent=false):Promise<Reply>{const work=async()=>{try{const key=fromAgent&&request.requestId&&!mutationCommands.has(request.command)?request.requestId:null;const hash=JSON.stringify(request);if(key&&receipts.has(key)){const old=receipts.get(key)!;if(old.hash!==hash)throw new AppError('REQUEST_ID_REUSED','Use a new request ID for a different operation.');return old.reply}const reply=success(await execute(request,fromAgent));if(fromAgent&&!['status','list','path-suggest','integration-status'].includes(request.command)){lastUsed=Date.now();await broadcast();}if(key){receipts.set(key,{hash,reply});if(receipts.size>500)receipts.delete(receipts.keys().next().value!)}return reply}catch(e){if(!fromAgent&&(e as any).code!=='CANCELLED'){errorMessage=(e as Error).message;await broadcast();}return failure(e)}};const result=commandQueue.then(work);commandQueue=result.then(()=>{});return result}
function validSender(event:any){if(event.sender!==window.webContents||!event.senderFrame?.url.startsWith('app://local/'))throw new AppError('INVALID_SENDER','Untrusted renderer.');}
app.whenReady().then(async()=>{
 await mkdir(dataDir,{recursive:true,mode:0o700});if(process.platform!=='win32')await chmod(dataDir,0o700);
 store=new FileStore(dataDir);await store.init();
 const root=path.resolve(here,'../renderer');
 protocol.handle('app',request=>{const url=new URL(request.url);if(url.hostname!=='local')return new Response('Forbidden',{status:403});const candidate=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(candidate!==root&&!candidate.startsWith(root+path.sep))return new Response('Forbidden',{status:403});return electronNet.fetch(pathToFileURL(candidate).href)});
 session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{callback({cancel:/^https?:|^wss?:/.test(details.url)})});
 session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 window=new BrowserWindow({width:1280,height:860,minWidth:760,minHeight:580,backgroundColor:'#f7f8fa',title:'Agent Excalidraw',titleBarStyle:process.platform==='darwin'?'hiddenInset':'default',trafficLightPosition:{x:18,y:20},webPreferences:{preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 window.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown'&&!input.alt&&(process.platform==='darwin'?input.meta:input.control)&&input.key.toLowerCase()==='z'){event.preventDefault();window.webContents.send('ui-action',input.shift?'redo':'undo');}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
 ipcMain.handle('command',async(event,request)=>{validSender(event);return run(request)});
 ipcMain.on('scene-reply',(event,{id,reply})=>{validSender(event);const p=pending.get(id);if(p){clearTimeout(p.timer);pending.delete(id);p.resolve(reply)}});
 ipcMain.on('renderer-ready',async event=>{validSender(event);rendererReady=true;readyResolve();await broadcast()});
 ipcMain.on('scene-change',(event,data)=>{validSender(event);if(loading||data.document!==store.active?.id||data.epoch!==epoch)return;currentRevision=data.revision;dirty=data.dirty;lastScene=data.scene;clearTimeout(recoveryTimer);if(dirty&&store.active)recoveryTimer=setTimeout(async()=>{if(data.document!==store.active?.id||data.epoch!==epoch)return;try{await store.writeRecovery(data.scene,data.revision);if(store.settings.autosave)await run({command:'save'});await broadcast()}catch(e){errorMessage='Recovery could not be written: '+(e as Error).message;await broadcast()}},1200);void broadcast()});
 window.on('close',event=>{if(quitting)return;event.preventDefault();void guard().then(async discard=>{if(discard)await store.discardRecovery(discard);quitting=true;app.quit()}).catch(()=>{})});
 Menu.setApplicationMenu(Menu.buildFromTemplate([
 ...(process.platform==='darwin'?[{label:'Agent Excalidraw',submenu:[{role:'about' as const},{type:'separator' as const},{label:'Settings…',accelerator:'CmdOrCtrl+,',click:()=>window.webContents.send('ui-action','settings')},{type:'separator' as const},{label:'Quit Agent Excalidraw',accelerator:'CmdOrCtrl+Q',click:()=>window.close()}]}]:[]),
 {label:'File',submenu:[{label:'New drawing',accelerator:'CmdOrCtrl+N',click:()=>void run({command:'new'})},{label:'Open drawing…',accelerator:'CmdOrCtrl+O',click:()=>void run({command:'open'})},{type:'separator'},{label:'Save',accelerator:'CmdOrCtrl+S',click:()=>void run({command:'save'})},{label:'Save As…',accelerator:'CmdOrCtrl+Shift+S',click:()=>void run({command:'save-as'})},{label:'Export…',click:()=>window.webContents.send('ui-action','export')},{type:'separator'},{label:'Close',accelerator:'CmdOrCtrl+W',click:()=>window.close()}]},
 {label:'Edit',submenu:[{label:'Undo',accelerator:'CmdOrCtrl+Z',click:()=>window.webContents.send('ui-action','undo')},{label:'Redo',accelerator:'CmdOrCtrl+Shift+Z',click:()=>window.webContents.send('ui-action','redo')},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
 {label:'View',submenu:[{label:'Your drawings',accelerator:'CmdOrCtrl+P',click:()=>window.webContents.send('ui-action','library')},{role:'togglefullscreen'},{role:'zoomIn'},{role:'zoomOut'},{role:'resetZoom'}]},
 {label:'Help',submenu:[{label:'Getting started',click:()=>window.webContents.send('ui-action','help')},{label:'Use with an agent',click:()=>window.webContents.send('ui-action','agents')}]}
 ]));
 await window.loadURL('app://local/index.html');
 if(process.platform!=='win32')await unlink(socket).catch(()=>{});
 const server=createServer(connection=>{connection.setEncoding('utf8');let buffer='';connection.setTimeout(35000,()=>connection.destroy());connection.on('data',chunk=>{buffer+=chunk;if(Buffer.byteLength(buffer)>8*1024*1024){connection.destroy();return}const newline=buffer.indexOf('\n');if(newline<0)return;const line=buffer.slice(0,newline);buffer='';try{const {token:provided,...request}=JSON.parse(line);if(provided!==token){connection.end(JSON.stringify(failure(new AppError('UNAUTHORIZED','Invalid local credential.')))+'\n');return}void run(request,true).then(reply=>connection.end(JSON.stringify(reply)+'\n'))}catch(e){connection.end(JSON.stringify(failure(e))+'\n')}})});
 server.listen(socket,async()=>{if(process.platform!=='win32')await chmod(socket,0o600);await writeFile(endpoint,JSON.stringify({socket,token,pid:process.pid,version:app.getVersion(),protocol:1}),{mode:0o600});if(process.platform!=='win32')await chmod(endpoint,0o600)});
 server.on('error',e=>{console.error('Local control:',e.message)});
 app.on('will-quit',()=>{server.close();void unlink(endpoint).catch(()=>{});if(process.platform!=='win32')void unlink(socket).catch(()=>{})});
 const startup=process.argv.find(arg=>arg.endsWith('.excalidraw'));if(startup)await run({command:'open',args:{path:path.resolve(startup)}});
}).catch(error=>{console.error(error);app.quit()});
app.on('second-instance',(_event,argv)=>{window?.show();window?.focus();const file=argv.find(v=>v.endsWith('.excalidraw'));if(file)void run({command:'open',args:{path:path.resolve(file)}})});
app.on('open-file',(event,file)=>{event.preventDefault();void app.whenReady().then(()=>run({command:'open',args:{path:file}}))});
app.on('activate',()=>window?.show());
