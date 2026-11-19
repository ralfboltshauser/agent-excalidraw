export type Scene = {type:'excalidraw';version:number;source:string;elements:any[];appState:Record<string,any>;files:Record<string,any>};
export type Drawing = {id:string;path:string;title:string;lastOpened:number;starred:boolean;missing?:boolean};
export type Settings = {defaultFolder:string;theme:'system'|'light'|'dark';autosave:boolean;folders:string[]};
export type HostState = {drawings:Drawing[];settings:Settings;active:Drawing|null;recovery:{id:string;path:string;time:number}[];platform:string;version:string;agent:{lastUsed:number|null;working:boolean;session:string|null;paused:boolean};};
export type Request = {command:string;args?:Record<string,any>;requestId?:string;session?:string;document?:string;epoch?:string;expectedRevision?:number};
export type Receipt = {document:string;epoch:string;revision:number;[key:string]:any};
export type Reply = {ok:true;result:any}|{ok:false;error:{code:string;message:string;retryable:boolean;details?:any}};
export type SceneCall = {id:string;request:Request};
export interface Bridge {
  invoke(request:Request):Promise<Reply>;
  onSceneCommand(listener:(call:SceneCall)=>void):()=>void;
  replyScene(id:string,reply:Reply):void;
  onHostState(listener:(state:HostState)=>void):()=>void;
  notifyChange(data:{document:string;epoch:string;revision:number;dirty:boolean;scene:Scene}):void;
  onUiAction(listener:(action:string)=>void):()=>void;
  pathForFile(file:File):string;
  ready():void;
}
export const blankScene=():Scene=>({type:'excalidraw',version:2,source:'agent-excalidraw',elements:[],appState:{viewBackgroundColor:'#ffffff'},files:{}});
export class AppError extends Error {constructor(public code:string,message:string,public details?:any){super(message)}}
export function failure(error:unknown):Reply {const e=error as any;return {ok:false,error:{code:e.code||'INTERNAL_ERROR',message:e.message||String(error),retryable:['DOCUMENT_BUSY','APP_STARTING'].includes(e.code),...(e.details?{details:e.details}:{})}}}
export const success=(result:any):Reply=>({ok:true,result});
