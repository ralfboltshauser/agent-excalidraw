import {mkdir,mkdtemp,readFile,writeFile,rename,rm,stat,chmod} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AppError} from '../shared/types.js';
import {VERSION,send} from './transport.js';
const exec=promisify(execFile);
const repository='ralfboltshauser/agent-excalidraw';
type Asset={platform:string;arch:string;name:string;sha256:string};
type Manifest={version:string;assets:Asset[]};
async function fetchRelease(url:string){const response=await fetch(url,{signal:AbortSignal.timeout(120000),headers:{'User-Agent':'agent-excalidraw-cli','Accept':'application/vnd.github+json'}});if(!response.ok)throw new AppError(response.status===404?'RELEASE_NOT_AVAILABLE':'DOWNLOAD_FAILED',response.status===404?`A compatible desktop release is not published yet. Build from the source instructions at https://github.com/${repository}.`:`Download failed (${response.status}). Your existing installation is unchanged.`);return response;}
export async function installApp(options:{version?:string}={}){
  const version=(options.version||VERSION).replace(/^v/,'');
  if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))throw new AppError('INVALID_VERSION','Use a specific release version, for example 0.1.0.');
  const release=await (await fetchRelease(`https://api.github.com/repos/${repository}/releases/tags/v${version}`)).json() as any;
  const manifestAsset=release.assets?.find((a:any)=>a.name==='agent-excalidraw-manifest.json');
  if(!manifestAsset)throw new AppError('RELEASE_NOT_INSTALLABLE','This release has no verified installer manifest. Download the signed native installer from the release page.');
  const manifest=await (await fetchRelease(manifestAsset.browser_download_url)).json() as Manifest;
  if(manifest.version!==version||!Array.isArray(manifest.assets))throw new AppError('INVALID_MANIFEST','The release manifest does not match the requested version.');
  const asset=manifest.assets.find(a=>a.platform===process.platform&&a.arch===process.arch);
  if(!asset||!/^([a-f0-9]{64})$/i.test(asset.sha256))throw new AppError('UNSUPPORTED_PLATFORM',`No verified installer is available for ${process.platform}/${process.arch} in this release.`);
  const remote=release.assets.find((a:any)=>a.name===asset.name);if(!remote)throw new AppError('INVALID_MANIFEST','The installer named by the manifest is missing.');
  // An existing live app is never replaced by a CLI bootstrap/update.
  try{await send({command:'status'},{timeout:3000});throw new AppError('APP_RUNNING','Close Agent Excalidraw normally before installing an app update. Save or discard your work in its window first.');}catch(error:any){if(!['APP_NOT_RUNNING','APP_UNAVAILABLE'].includes(error.code))throw error;}
  const work=await mkdtemp(join(tmpdir(),'agent-excalidraw-install-'));
  try{
    const bytes=Buffer.from(await (await fetchRelease(remote.browser_download_url)).arrayBuffer());
    if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256.toLowerCase())throw new AppError('CHECKSUM_MISMATCH','The downloaded app failed checksum verification. Nothing was installed.');
    const downloaded=join(work,basename(asset.name));await writeFile(downloaded,bytes);
    if(process.platform==='darwin'){
      if(!asset.name.endsWith('.zip'))throw new AppError('INSTALLER_FORMAT','Automatic macOS installation requires a signed app zip. Use the disk image manually.');
      const expanded=join(work,'expanded');await exec('/usr/bin/ditto',['-x','-k',downloaded,expanded]);
      const app=join(expanded,'Agent Excalidraw.app');await stat(app);
      await exec('/usr/bin/codesign',['--verify','--deep','--strict',app]);await exec('/usr/sbin/spctl',['--assess','--type','execute',app]);
      const applications=join(homedir(),'Applications');await mkdir(applications,{recursive:true});
      const target=join(applications,'Agent Excalidraw.app'),stage=join(applications,'.Agent Excalidraw.installing.app'),backup=join(applications,'.Agent Excalidraw.previous.app');
      await rm(stage,{recursive:true,force:true});await exec('/usr/bin/ditto',[app,stage]);
      let replaced=false;try{await stat(target);await rm(backup,{recursive:true,force:true});await rename(target,backup);replaced=true;}catch(error:any){if(error.code!=='ENOENT')throw error;}
      try{await rename(stage,target)}catch(error){if(replaced)await rename(backup,target);throw error;}
      return {version,path:target,verified:true,previousVersionRetained:replaced};
    }
    if(process.platform==='win32'){
      if(!asset.name.endsWith('.exe'))throw new AppError('INSTALLER_FORMAT','Windows installation requires the signed per-user installer.');
      // Verify Authenticode before executing any downloaded installer.
      const escaped=downloaded.replaceAll("'","''");const result=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-AuthenticodeSignature -LiteralPath '${escaped}').Status`]);
      if(result.stdout.trim()!=='Valid')throw new AppError('SIGNATURE_INVALID','The Windows installer signature is not valid. Nothing was installed.');
      await exec(downloaded,['/S']);return {version,installed:true,verified:true,message:'Per-user installer completed. Start Agent Excalidraw from the Start menu.'};
    }
    if(process.platform==='linux'){
      if(!asset.name.endsWith('.AppImage'))throw new AppError('INSTALLER_FORMAT','Use the documented .deb installer for this release. Automatic installation requires a verified AppImage.');
      const folder=join(homedir(),'.local','share','agent-excalidraw');await mkdir(folder,{recursive:true});const target=join(folder,'Agent Excalidraw.AppImage'),stage=target+'.installing';await writeFile(stage,bytes,{mode:0o755});await chmod(stage,0o755);try{await stat(target);await rename(target,target+'.previous')}catch(error:any){if(error.code!=='ENOENT')throw error;}try{await rename(stage,target)}catch(error){try{await rename(target+'.previous',target)}catch{}throw error;}return {version,path:target,verified:true,message:'AppImage installed. If your distribution requires FUSE, follow the release launch instructions.'};
    }
    throw new AppError('UNSUPPORTED_PLATFORM',`Automatic installation is not available for ${process.platform}.`);
  }finally{await rm(work,{recursive:true,force:true});}
}
