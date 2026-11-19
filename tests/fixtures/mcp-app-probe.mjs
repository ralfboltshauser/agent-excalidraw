import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema,ListResourcesRequestSchema,ReadResourceRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY} from '@modelcontextprotocol/ext-apps/server';
import {readFile,appendFile} from 'node:fs/promises';
const uri='ui://agent-excalidraw/e0-probe.html';
const trace=(event,value={})=>appendFile('/tmp/ae-e0-probe-events.jsonl',JSON.stringify({time:Date.now(),event,...value})+'\n');
const server=new Server({name:'agent-excalidraw-e0',version:'1.0.0'},{capabilities:{tools:{},resources:{}}});
server.oninitialized=()=>{void trace('initialized',{capabilities:server.getClientCapabilities()});};
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[
{name:'show_probe',description:'Show the Agent Excalidraw synthetic MCP App bridge probe.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,openWorldHint:false},_meta:{ui:{resourceUri:uri,visibility:['model']},[RESOURCE_URI_META_KEY]:uri}},
{name:'read_counter',description:'Read the current synthetic clock.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,openWorldHint:false},_meta:{ui:{visibility:['app']}}}
]}));
server.setRequestHandler(CallToolRequestSchema,async r=>{await trace('tool',{name:r.params.name});if(r.params.name==='show_probe')return {content:[{type:'text',text:'Synthetic bridge probe.'}],_meta:{probe:'ready'}};if(r.params.name==='read_counter')return {content:[],structuredContent:{seconds:Math.floor(Date.now()/1000)}};throw Error('Unknown tool');});
server.setRequestHandler(ListResourcesRequestSchema,async()=>({resources:[{uri,name:'Bridge probe',mimeType:RESOURCE_MIME_TYPE}]}));
server.setRequestHandler(ReadResourceRequestSchema,async r=>{if(r.params.uri!==uri)throw Error('Unknown resource');await trace('resource');return {contents:[{uri,mimeType:RESOURCE_MIME_TYPE,text:await readFile(new URL('../../artifacts/e0/probe.html',import.meta.url),'utf8'),_meta:{ui:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[]}}}}]};});
await server.connect(new StdioServerTransport());
