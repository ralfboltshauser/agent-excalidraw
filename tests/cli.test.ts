import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm,symlink,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer,type Server} from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {send,dataDirectory} from '../src/cli/transport.js';
import {installSkills,uninstallSkills} from '../src/cli/skills.js';
import {validateRequest,schemaDocument} from '../src/cli/schema.js';
import {commands} from '../src/shared/commands.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const exec=promisify(execFile);
const cli=resolve('src/cli/index.ts');
async function temporary(){return mkdtemp(join(tmpdir(),'ae-cli-'));}
async function fakeApp(dir:string,handler:(request:any,socket:any)=>void){
  const socket=process.platform==='win32'?`\\\\.\\pipe\\ae-cli-test-${process.pid}-${Math.random()}`:join(dir,'s');
  const server=createServer(connection=>{connection.setEncoding('utf8');let input='';connection.on('data',data=>{input+=data;if(input.includes('\n'))handler(JSON.parse(input.split('\n')[0]),connection)});});
  await new Promise<void>((r,e)=>{server.once('error',e);server.listen(socket,r)});
  await writeFile(join(dir,'endpoint.json'),JSON.stringify({socket,token:'test-secret',pid:process.pid,version:'0.1.0',protocol:1}),{mode:0o600});
  return {server,close:()=>new Promise<void>((r,e)=>server.close(error=>error?e(error):r()))};
}
test('transport authenticates the local request and preserves UTF-8 replies',async()=>{
  const dir=await temporary();const app=await fakeApp(dir,(request,socket)=>{assert.equal(request.token,'test-secret');const data=Buffer.from(JSON.stringify({ok:true,result:{title:'你好 Café'}})+'\n');const middle=data.indexOf(Buffer.from('你'))+1;socket.write(data.subarray(0,middle));setTimeout(()=>socket.end(data.subarray(middle)),5)});
  try{assert.deepEqual(await send({command:'status'},{dir}),{ok:true,result:{title:'你好 Café'}})}finally{await app.close();await rm(dir,{recursive:true,force:true})}
});
test('lost reply after delivery is outcome unknown, not a retryable connection error',async()=>{
  const dir=await temporary();const app=await fakeApp(dir,(_,socket)=>socket.end());
  try{await assert.rejects(send({command:'apply',requestId:'once'},{dir}),{code:'OUTCOME_UNKNOWN'})}finally{await app.close();await rm(dir,{recursive:true,force:true})}
});
test('CLI input file maps to the same validated request as the MCP contract',async()=>{
  const dir=await temporary();let received:any;const app=await fakeApp(dir,(request,socket)=>{received=request;socket.end(JSON.stringify({ok:true,result:{document:'d',epoch:'e',revision:1}})+'\n')});
  const payload={operations:[{op:'create',ref:'a',type:'rectangle',label:'Hello'}]};await writeFile(join(dir,'batch.json'),JSON.stringify(payload));
  try{const {stdout}=await exec(process.execPath,['--import','tsx',cli,'apply','--no-launch','--document','d','--epoch','e','--expected-revision','0','--request-id','once','--input',join(dir,'batch.json'),'--json'],{env:{...process.env,AGENT_EXCALIDRAW_DATA_DIR:dir}});assert.equal(JSON.parse(stdout).ok,true);assert.deepEqual(received.args,payload);assert.equal(received.document,'d');assert.equal(received.expectedRevision,0);assert.equal(received.requestId,'once')}
  finally{await app.close();await rm(dir,{recursive:true,force:true})}
});
test('MCP enumerates shared commands and invokes the same app protocol',async()=>{
  const dir=await temporary();let received:any;const app=await fakeApp(dir,(request,socket)=>{received=request;socket.end(JSON.stringify({ok:true,result:{document:'d',epoch:'e',revision:1}})+'\n')});
  const env=Object.fromEntries(Object.entries({...process.env,AGENT_EXCALIDRAW_DATA_DIR:dir}).filter(([,v])=>typeof v==='string')) as Record<string,string>;
  const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx',cli,'mcp'],env,stderr:'pipe'});const client=new Client({name:'cli-test',version:'1.0.0'});
  try{await client.connect(transport);const listed=await client.listTools();assert.deepEqual(listed.tools.map(t=>t.name).sort(),commands.map(c=>c.name.replaceAll('-','_')).sort());const result=await client.callTool({name:'apply',arguments:{document:'d',epoch:'e',expectedRevision:0,requestId:'mcp-once',operations:[{op:'create',type:'rectangle',label:'MCP'}]}});assert.equal(result.isError,false);assert.equal(received.command,'apply');assert.equal(received.requestId,'mcp-once');assert.equal(received.args.operations[0].label,'MCP');const invalid=await client.callTool({name:'apply',arguments:{operations:[]}});assert.equal(invalid.isError,true);assert.match(JSON.stringify(invalid.content),/INVALID_INPUT/)}
  finally{await client.close();await app.close();await rm(dir,{recursive:true,force:true})}
});
test('skill installation has one source, idempotent links and leaves unrelated skills intact',async()=>{
  const base=await temporary(),home=join(base,'home'),dir=join(base,'data');await mkdir(home);const opts={home,dir,env:{}};
  try{const installed=await installSkills(opts);assert.equal(installed.links.length,3);assert(installed.verified);assert(new Set(installed.links.map(l=>l.target)).size===1);await installSkills(opts);await uninstallSkills(opts);for(const link of installed.links)await assert.rejects(lstat(link.path),{code:'ENOENT'});assert((await readFile(join(installed.canonical,'SKILL.md'),'utf8')).startsWith('---'));const unrelated=join(home,'.codex','skills','agent-excalidraw');await mkdir(unrelated);await writeFile(join(unrelated,'mine'),'preserve');await assert.rejects(installSkills(opts),{code:'SKILL_CONFLICT'});assert.equal(await readFile(join(unrelated,'mine'),'utf8'),'preserve');const removed=await uninstallSkills(opts);assert(removed.kept.includes(unrelated));}
  finally{await rm(base,{recursive:true,force:true})}
});
test('existing canonical folder without ownership marker is preserved',async()=>{
  const base=await temporary();const canonical=join(base,'data','skills','agent-excalidraw');await mkdir(canonical,{recursive:true});await writeFile(join(canonical,'mine'),'keep');try{await assert.rejects(installSkills({home:join(base,'home'),dir:join(base,'data'),env:{}}),{code:'SKILL_CONFLICT'});assert.equal(await readFile(join(canonical,'mine'),'utf8'),'keep')}finally{await rm(base,{recursive:true,force:true})}
});
test('mutation schema requires live preconditions; every command has discoverable schema',()=>{
  assert.throws(()=>validateRequest('apply',{operations:[]}),{code:'INVALID_INPUT'});assert.throws(()=>validateRequest('apply',{document:'d',epoch:'e',expectedRevision:-1,requestId:'x',operations:[]}),{code:'INVALID_INPUT'});assert.equal(schemaDocument().commands.length,commands.length);assert.equal(dataDirectory({},'win32','C:\\Users\\test'),join('C:\\Users\\test','AppData','Roaming','agent-excalidraw'));
});
