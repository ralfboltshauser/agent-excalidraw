import {mkdir,readFile,writeFile,lstat,realpath,symlink,unlink,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AppError} from '../shared/types.js';
import {dataDirectory,VERSION} from './transport.js';
export const skillName='agent-excalidraw';
export function roots(env:NodeJS.ProcessEnv=process.env,home=homedir()){
  return {agents:join(env.AGENTS_HOME||join(home,'.agents'),'skills'),codex:join(env.CODEX_HOME||join(home,'.codex'),'skills'),claude:join(env.CLAUDE_CONFIG_DIR||join(home,'.claude'),'skills')};
}
export async function bundledSkill(){
  const candidates=[new URL('../skills/agent-excalidraw/SKILL.md',import.meta.url),new URL('../../skills/agent-excalidraw/SKILL.md',import.meta.url)];
  for(const candidate of candidates){try{return await readFile(candidate,'utf8')}catch{}}
  throw new AppError('SKILL_MISSING','This installation does not contain the skill. Reinstall the CLI package.');
}
export async function installSkills(options:{hosts?:string[];dir?:string;home?:string;env?:NodeJS.ProcessEnv}={}){
  const base=options.dir||dataDirectory(options.env),canonical=join(base,'skills',skillName),known=roots(options.env,options.home),hosts=options.hosts||['agents','codex','claude'];
  for(const host of hosts)if(!(host in known))throw new AppError('UNKNOWN_HOST',`Unknown skill host ${host}. Choose agents, codex or claude.`);
  let exists=false;try{await lstat(canonical);exists=true}catch(error:any){if(error.code!=='ENOENT')throw error;}
  if(exists){try{const existing=await lstat(canonical);if(existing.isSymbolicLink())throw new Error('canonical link');const marker=JSON.parse(await readFile(join(canonical,'.agent-excalidraw-owned.json'),'utf8'));if(marker.name!==skillName||resolve(marker.canonical)!==resolve(canonical))throw new Error('not owned');}catch{throw new AppError('SKILL_CONFLICT',`An unrelated folder already exists at ${canonical}. It has not been changed.`);}}
  let canonicalTarget=exists?await realpath(canonical):canonical;
  // Preflight all links before changing any host configuration.
  for(const host of hosts){const link=join(known[host as keyof typeof known],skillName);try{const info=await lstat(link);if(!info.isSymbolicLink()||resolve(await realpath(link))!==resolve(canonicalTarget))throw new AppError('SKILL_CONFLICT',`Existing skill at ${link} is not owned by this installation. It has not been replaced.`);}catch(error:any){if(error.code!=='ENOENT')throw error;}}
  const content=await bundledSkill();await mkdir(canonical,{recursive:true});canonicalTarget=await realpath(canonical);await writeFile(join(canonical,'SKILL.md'),content);await writeFile(join(canonical,'.agent-excalidraw-owned.json'),JSON.stringify({name:skillName,version:VERSION,canonical}));
  const links=[];
  for(const host of hosts){const root=known[host as keyof typeof known],link=join(root,skillName);await mkdir(root,{recursive:true});try{await lstat(link)}catch(error:any){if(error.code!=='ENOENT')throw error;await symlink(canonical,link,process.platform==='win32'?'junction':'dir');}links.push({host,path:link,target:await realpath(link)});}
  return {canonical,links,verified:links.every(link=>resolve(link.target)===resolve(canonicalTarget)),message:'Skill files are installed. Start a new agent session if your host does not reload skills. Actual use is verified by a successful app call.'};
}
export async function uninstallSkills(options:{hosts?:string[];dir?:string;home?:string;env?:NodeJS.ProcessEnv;removeSource?:boolean}={}){
  const canonical=join(options.dir||dataDirectory(options.env),'skills',skillName),known=roots(options.env,options.home),hosts=options.hosts||['agents','codex','claude'],removed:string[]=[],kept:string[]=[];
  const canonicalTarget=await realpath(canonical).catch(()=>canonical);
  for(const host of hosts){if(!(host in known))throw new AppError('UNKNOWN_HOST',`Unknown skill host ${host}.`);const link=join(known[host as keyof typeof known],skillName);try{const info=await lstat(link);if(info.isSymbolicLink()&&resolve(await realpath(link))===resolve(canonicalTarget)){await unlink(link);removed.push(link)}else kept.push(link);}catch(error:any){if(error.code!=='ENOENT')throw error;}}
  if(options.removeSource){const marker=JSON.parse(await readFile(join(canonical,'.agent-excalidraw-owned.json'),'utf8'));if(marker.name!==skillName||resolve(marker.canonical)!==resolve(canonical))throw new AppError('SKILL_CONFLICT','Canonical skill ownership could not be verified.');await rm(canonical,{recursive:true});}
  return {removed,kept,drawingsRemoved:false};
}
