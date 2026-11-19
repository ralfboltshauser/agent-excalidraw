#!/usr/bin/env node
import {Command,Option} from 'commander';
import {readFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {commands} from '../shared/commands.js';
import {failure,success,AppError,type Reply} from '../shared/types.js';
import {dataDirectory,endpoint,launchApp,requestApp,VERSION} from './transport.js';
import {schemaDocument,validateRequest,shapeFor} from './schema.js';
import {coreInstructions} from './core.js';
import {installSkills,uninstallSkills,roots} from './skills.js';
import {installApp} from './installer.js';
import {runMcp} from './mcp.js';

function output(reply:Reply,json:boolean){
  if(json){console.log(JSON.stringify(reply));}
  else if(!reply.ok){console.error(`${reply.error.code}: ${reply.error.message}`);}
  else if(typeof reply.result==='string')console.log(reply.result);
  else console.log(JSON.stringify(reply.result,null,2));
  if(!reply.ok)process.exitCode=1;
}
async function inputFile(path:string){
  let raw:string;if(path==='-'){const chunks:Buffer[]=[];let size=0;for await(const chunk of process.stdin){size+=Buffer.byteLength(chunk);if(size>8*1024*1024)throw new AppError('INPUT_TOO_LARGE','Input exceeds 8 MiB.');chunks.push(Buffer.from(chunk))}raw=Buffer.concat(chunks).toString();}
  else {const absolute=resolve(path);if((await stat(absolute)).size>8*1024*1024)throw new AppError('INPUT_TOO_LARGE','Input exceeds 8 MiB.');raw=await readFile(absolute,'utf8');}
  try{return JSON.parse(raw)}catch{throw new AppError('INVALID_INPUT','Input must be valid JSON. Use an object with command arguments, or an operation array for apply.');}
}
function decorate(command:Command,name:string){
  command.option('--json','Print a machine-readable Reply envelope').option('--input <path>','Read arguments from JSON file; use - for stdin').option('--document <id>','Target the returned document ID').option('--epoch <epoch>','Expected runtime document epoch').option('--expected-revision <n>','Expected live content revision',v=>Number(v)).option('--request-id <id>','Unique ID for this exact operation').option('--session <name>','Agent session name').option('--no-launch','Do not launch a stopped app');
  const shape=shapeFor(name);
  for(const key of Object.keys(shape)){
    if(['document','epoch','expectedRevision','requestId','session'].includes(key))continue;
    const flag=key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
    if(['compact','background','embedScene','selection','focus'].includes(key))command.option(`--${flag}`,shape[key].description||key);
    else if(['ids'].includes(key))command.option(`--${flag} <ids>`,'Comma-separated stable IDs',v=>v.split(',').filter(Boolean));
    else if(['zoom','scrollX','scrollY','scale','gap','offset','limit'].includes(key))command.option(`--${flag} <number>`,shape[key].description||key,v=>Number(v));
    else if(key!=='operations')command.option(`--${flag} <value>`,shape[key].description||key);
  }
  command.addHelpText('after',`\nInput contract:\n${JSON.stringify(schemaDocument().commands.find(c=>c.name===name)?.inputSchema,null,2)}\n\nScene edits require document, epoch, expectedRevision and requestId. Inspect snapshot first.\n`);
  command.action(async()=>{
    const options=command.opts();
    try{
      let payload:any=options.input?await inputFile(options.input):{};
      if(Array.isArray(payload)){if(name!=='apply')throw new AppError('INVALID_INPUT','An array input is supported only for apply.');payload={operations:payload};}
      if(!payload||typeof payload!=='object')throw new AppError('INVALID_INPUT','Command input must be a JSON object.');
      // Permit a saved Request envelope as well as the concise args-only form.
      if(payload.args)payload={...payload.args,...Object.fromEntries(['document','epoch','expectedRevision','requestId','session'].filter(k=>payload[k]!==undefined).map(k=>[k,payload[k]]))};
      const {json,input,launch,...overrides}=options;
      payload={...payload,...overrides};
      const request=validateRequest(name,payload);
      output(await requestApp(request,{launch:name!=='status'&&launch!==false}),!!json);
    }catch(error:any){if(error.name==='ZodError')error=new AppError('INVALID_INPUT',error.issues.map((i:any)=>`${i.path.join('.')||'input'}: ${i.message}`).join('; '));output(failure(error),!!options.json);}
  });
}
export async function main(argv=process.argv){
  const program=new Command().name('agent-excalidraw').description('Local Excalidraw for people and agents. Full CLI; optional MCP.').version(VERSION).showHelpAfterError();
  program.addHelpText('after','\nFirst use: agent-excalidraw launch\nAgent guide: agent-excalidraw skills get core\nDiscover exact JSON contracts: agent-excalidraw schema\n');
  for(const command of commands)decorate(program.command(command.name).description(command.description),command.name);
  const path=program.command('path').description('Choose a deterministic local drawing location');decorate(path.command('suggest').description('Suggest a location without creating a file'),'path-suggest');
  const operation=program.command('operation').description('Reconcile uncertain results');decorate(operation.command('status').description('Look up a request in the current epoch'),'operation-status');
  program.command('launch').description('Launch the workspace without creating a drawing').option('--json').action(async opts=>{try{await launchApp();output(success({launched:true}),!!opts.json)}catch(error){output(failure(error),!!opts.json)}});
  program.command('version').description('Print the installed CLI version').option('--json').action(opts=>output(success({version:VERSION,protocol:1}),!!opts.json));
  program.command('schema').description('Print all command input schemas without launching the app').option('--json').action(opts=>output(success(schemaDocument()),!!opts.json));
  program.command('doctor').description('Diagnose install, discovery and app availability without launching').option('--json').action(async opts=>{
    let ep:any;try{const value=await endpoint();ep={available:true,version:value.version,protocol:value.protocol,pid:value.pid};}catch(error:any){ep={available:false,code:error.code,message:error.message};}
    let running:Reply|undefined;if(ep.available){try{running=await requestApp({command:'status'},{launch:false,timeout:3000});}catch(error){running=failure(error)}}
    output(success({cliVersion:VERSION,nodeVersion:process.version,platform:process.platform,architecture:process.arch,dataDirectory:dataDirectory(),endpoint:ep,app:running,skillRoots:roots(),remoteHost:!!(process.env.SSH_CONNECTION||process.env.WSL_DISTRO_NAME),remoteHostNote:'The CLI must run on the same host as the desktop. Remote/WSL environments are not bridged automatically.'}),!!opts.json);
  });
  const skills=program.command('skills').description('Version-matched guide and one-source skill discovery');
  skills.command('get [name]').description('Read instructions for this installed CLI version').action((name='core')=>{if(name!=='core')throw new AppError('UNKNOWN_GUIDE','Only the core guide is available.');console.log(coreInstructions)});
  skills.command('install').description('Install one canonical skill and link it into selected host folders').option('--hosts <names>','Comma-separated agents,codex,claude','agents,codex,claude').option('--json').action(async opts=>{try{output(success(await installSkills({hosts:opts.hosts.split(',')})),!!opts.json)}catch(error){output(failure(error),!!opts.json)}});
  skills.command('uninstall').description('Remove only links owned by this skill installation; keep drawings').option('--hosts <names>','Comma-separated agents,codex,claude','agents,codex,claude').option('--remove-source','Also remove this installation’s canonical skill source').option('--json').action(async opts=>{try{output(success(await uninstallSkills({hosts:opts.hosts.split(','),removeSource:opts.removeSource})),!!opts.json)}catch(error){output(failure(error),!!opts.json)}});
  program.command('install').description('Download and verify a compatible released desktop app').option('--version <version>','Specific app release version',VERSION).option('--json').action(async opts=>{try{output(success(await installApp({version:opts.version})),!!opts.json)}catch(error){output(failure(error),!!opts.json)}});
  program.command('mcp').description('Expose the same drawing commands over MCP stdio').action(runMcp);
  if(argv.length<=2){program.outputHelp();return;}
  await program.parseAsync(argv);
}
main().catch(error=>{output(failure(error),process.argv.includes('--json'));});
