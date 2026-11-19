import {readFile,writeFile,mkdir,lstat,realpath,rename,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve,delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AppError} from '../shared/types.js';
import {installSkills,roots} from '../cli/skills.js';
import {dataDirectory,VERSION} from '../cli/transport.js';

const marker='agent-excalidraw-owned-launcher-v1';
function launcherLocation(){
  const directory=process.platform==='win32'?join(process.env.LOCALAPPDATA||join(homedir(),'AppData','Local'),'agent-excalidraw','bin'):join(homedir(),'.local','bin');
  return {directory,path:join(directory,process.platform==='win32'?'agent-excalidraw.cmd':'agent-excalidraw')};
}
function onPath(directory:string){
  const normalize=(p:string)=>process.platform==='win32'?resolve(p).toLowerCase():resolve(p);
  return (process.env.PATH||'').split(delimiter).some(p=>p&&normalize(p)===normalize(directory));
}
function shellQuote(value:string){return "'"+value.replaceAll("'","'\\''")+"'";}
function launcherSource(){
  // Main and CLI live in sibling directories both in development and app.asar.
  // Electron's Node mode understands ASAR paths, avoiding a second dependency tree.
  const cli=fileURLToPath(new URL('../cli/index.js',import.meta.url));
  const executable=process.execPath;
  if(/[\r\n]/.test(cli+executable))throw new AppError('INVALID_INSTALL_PATH','The app installation path contains a newline. Move the app to a normal folder before installing its CLI.');
  if(process.platform==='win32')return `@echo off\r\nrem ${marker}\r\nsetlocal\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"${executable}" "${cli}" %*\r\nexit /b %errorlevel%\r\n`;
  return `#!/bin/sh\n# ${marker}\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(executable)} ${shellQuote(cli)} "$@"\n`;
}
async function ownLauncher(path:string){try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())return false;return (await readFile(path,'utf8')).includes(marker);}catch(error:any){if(error.code==='ENOENT')return false;throw error;}}
export async function integrationStatus(){
  const launcher=launcherLocation(),installed=await ownLauncher(launcher.path),canonical=join(dataDirectory(),'skills','agent-excalidraw');
  const links=[];
  let canonicalReal:string|null=null;try{canonicalReal=await realpath(canonical)}catch{}
  for(const [host,root] of Object.entries(roots())){const path=join(root,'agent-excalidraw');let linked=false;try{linked=!!canonicalReal&&(await lstat(path)).isSymbolicLink()&&await realpath(path)===canonicalReal}catch{}links.push({host,path,installed:linked});}
  return {cli:installed,cliPath:launcher.path,skill:links.some(link=>link.installed),canonical,links,cliDetails:{installed,path:launcher.path,onPath:onPath(launcher.directory),version:installed?VERSION:null,needsTerminalRestart:installed&&!onPath(launcher.directory)},lastUsed:null};
}
export async function installLocalCli(){
  const launcher=launcherLocation(),source=launcherSource();
  await mkdir(launcher.directory,{recursive:true});
  let exists=false;try{await lstat(launcher.path);exists=true}catch(error:any){if(error.code!=='ENOENT')throw error;}
  if(exists&&!await ownLauncher(launcher.path))throw new AppError('CLI_CONFLICT',`A command already exists at ${launcher.path}. It has not been replaced. Use the existing command or move it explicitly before installing this app’s launcher.`);
  // Atomic replacement of our own launcher; never redirect through an existing link.
  const temporary=launcher.path+`.${process.pid}.installing`;
  try{await writeFile(temporary,source,{mode:0o755,flag:'wx'});await rename(temporary,launcher.path);}finally{try{await unlink(temporary)}catch{}}
  const pathReady=onPath(launcher.directory);
  return {...await integrationStatus(),installed:true,path:launcher.path,onPath:pathReady,version:VERSION,needsTerminalRestart:!pathReady,message:pathReady?'Local CLI launcher installed.':'Local CLI launcher installed. Add its directory to your user PATH or use its full path.',instruction:pathReady?'The CLI is available in terminals using this PATH.':'Add '+launcher.directory+' to your user PATH, then start a new terminal. You can use the full command path immediately.',command:process.platform==='win32'?`"${launcher.path}"`:shellQuote(launcher.path)};
}
export async function installSkill(){return installSkills();}
