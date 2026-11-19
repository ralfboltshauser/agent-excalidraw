import {build as bundle} from 'esbuild';
import {build as vite} from 'vite';
import {cp,mkdir,writeFile} from 'node:fs/promises';
await mkdir('dist/main',{recursive:true});
await bundle({entryPoints:['src/main/index.ts','src/main/preload.ts','src/cli/index.ts'],outdir:'dist',outbase:'src',bundle:true,platform:'node',format:'esm',packages:'external',sourcemap:true});
// Sandboxed preload must be a self-contained CommonJS bundle.
await bundle({entryPoints:['src/main/preload.ts'],outfile:'dist/main/preload.cjs',bundle:true,platform:'node',format:'cjs',external:['electron']});
await vite({root:'src/renderer',base:'./',build:{outDir:'../../dist/renderer',emptyOutDir:true,chunkSizeWarningLimit:5000},logLevel:'warn'});
await cp('node_modules/@excalidraw/excalidraw/dist/prod/fonts','dist/renderer/fonts',{recursive:true});
await cp('skills','dist/skills',{recursive:true});
await writeFile('dist/cli/package.json','{"type":"module"}');
