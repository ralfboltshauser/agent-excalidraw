import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {readFile} from 'node:fs/promises';
import {commands} from '../shared/commands.js';
import {failure} from '../shared/types.js';
import {requestApp,VERSION} from './transport.js';
import {validateRequest,shapeFor} from './schema.js';
import {z} from 'zod';
export function jsonSchema(schema:z.ZodTypeAny):any{return z.toJSONSchema(schema);}
export async function runMcp(){
  const server=new Server({name:'agent-excalidraw',version:VERSION},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:commands.map(command=>({name:command.name.replaceAll('-','_'),description:command.description,inputSchema:jsonSchema(z.object(shapeFor(command.name)).strict()),annotations:{readOnlyHint:['status','list','snapshot','operation-status','path-suggest'].includes(command.name),destructiveHint:['apply','move','revert-last-agent-batch'].includes(command.name),openWorldHint:false}}))}));
  server.setRequestHandler(CallToolRequestSchema,async request=>{
    try{
      const command=request.params.name.replaceAll('_','-');
      const reply=await requestApp(validateRequest(command,request.params.arguments||{}),{launch:true});
      const content:any[]=[{type:'text',text:JSON.stringify(reply)}];
      if(reply.ok&&['render','export'].includes(command)){
        const output=reply.result.output||reply.result.path;
        const mime=reply.result.mime||reply.result.mimeType;
        if(typeof output==='string'&&(mime==='image/png'||output.toLowerCase().endsWith('.png'))){const bytes=await readFile(output);if(bytes.length<=12*1024*1024)content.push({type:'image',data:bytes.toString('base64'),mimeType:'image/png'});}
      }
      return {content,isError:!reply.ok};
    }catch(error){return {content:[{type:'text',text:JSON.stringify(failure(error))}],isError:true};}
  });
  await server.connect(new StdioServerTransport());
}
