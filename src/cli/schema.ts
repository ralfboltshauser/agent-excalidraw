import {z} from 'zod';
import {commands} from '../shared/commands.js';
import {AppError,type Request} from '../shared/types.js';
export const commonShape={
  document:z.string().optional().describe('Document ID from new/open/snapshot; mutations never target focus implicitly'),
  epoch:z.string().optional().describe('Runtime document epoch from snapshot'),
  expectedRevision:z.number().int().nonnegative().optional().describe('Content revision from the latest inspected snapshot'),
  requestId:z.string().optional().describe('Unique operation ID; reuse only to reconcile the same operation'),
  session:z.string().optional().describe('Stable agent-session name, used for Stop/Resume')
};
const operation=z.discriminatedUnion('op',[
  z.object({op:z.literal('create'),type:z.enum(['rectangle','ellipse','diamond','text','arrow','line']),ref:z.string().optional(),x:z.number().optional(),y:z.number().optional(),width:z.number().optional(),height:z.number().optional(),text:z.string().optional(),label:z.union([z.string(),z.object({text:z.string(),fontSize:z.number().optional(),fontFamily:z.number().optional()})]).optional(),from:z.string().optional(),to:z.string().optional()}).passthrough(),
  z.object({op:z.literal('update'),id:z.string()}).passthrough(),z.object({op:z.literal('delete'),id:z.string()}),z.object({op:z.literal('group'),ids:z.array(z.string())})
]);
export function shapeFor(name:string):Record<string,z.ZodTypeAny>{
  const shape:Record<string,z.ZodTypeAny>={...commonShape};
  if(['save','save-as','move','duplicate','view','render','export','reveal'].includes(name)){shape.document=z.string();shape.epoch=z.string();}
  if(['apply','layout','revert-last-agent-batch'].includes(name)){shape.document=z.string();shape.epoch=z.string();shape.expectedRevision=z.number().int().nonnegative();shape.requestId=z.string().min(1);}
  if(name==='apply')shape.operations=z.array(operation).max(1000).describe('One validated visible batch; create refs can be used by later arrow from/to');
  if(['new','duplicate','path-suggest'].includes(name)){shape.title=z.string().optional();shape.projectDir=z.string().optional();}
  if(['new','duplicate','open','move','save-as'].includes(name))shape.path=name==='open'||name==='move'||name==='save-as'?z.string():z.string().optional();
  if(['render','export'].includes(name)){shape.output=z.string().describe('Absolute output path, returned as an artifact');shape.format=z.enum(['png','svg','excalidraw']).optional();shape.background=z.boolean().optional();shape.embedScene=z.boolean().optional();shape.scale=z.number().positive().max(4).optional();}
  if(name==='snapshot'){shape.selection=z.boolean().optional();shape.group=z.string().optional();shape.compact=z.boolean().optional();shape.ids=z.array(z.string()).optional();shape.offset=z.number().int().nonnegative().optional();shape.limit=z.number().int().positive().max(10000).optional();}
  if(name==='layout'){shape.ids=z.array(z.string()).optional();shape.direction=z.enum(['horizontal','vertical']).optional();shape.gap=z.number().nonnegative().optional();}
  if(name==='view'){shape.ids=z.array(z.string()).optional();shape.zoom=z.number().positive().optional();shape.scrollX=z.number().optional();shape.scrollY=z.number().optional();shape.focus=z.boolean().optional();}
  return shape;
}
export function validateRequest(name:string,input:Record<string,unknown>):Request{
  if(!commands.some(c=>c.name===name))throw new AppError('UNKNOWN_COMMAND',`Unknown command: ${name}`);
  const checked=z.object(shapeFor(name)).passthrough().safeParse(input);
  if(!checked.success)throw new AppError('INVALID_INPUT',checked.error.issues.map(i=>`${i.path.join('.')||'input'}: ${i.message}`).join('; '));
  const parsed=checked.data as Record<string,any>;
  const {document,epoch,expectedRevision,requestId,session,...args}=parsed;
  return {command:name,args,...(document?{document}:{}),...(epoch?{epoch}:{}),...(expectedRevision!==undefined?{expectedRevision}:{}),...(requestId?{requestId}:{}),...(session?{session}:{})};
}
export function schemaDocument(){return {name:'agent-excalidraw',protocol:1,commands:commands.map(command=>({...command,inputSchema:z.toJSONSchema(z.object(shapeFor(command.name)).passthrough())})),mutationPreconditions:['document','epoch','expectedRevision','requestId'],input:'JSON object through --input <file> or --input -; apply accepts an operation array too'};}
