'use strict';
const path=require('node:path'),crypto=require('node:crypto');
const {LocalJsonStore}=require('./store');
const fail=(status,message)=>Object.assign(Error(message),{status});
const blocked=new Set(['preparing','submitting','running','interrupted','resuming','received']);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const transitions={preparing:['submitting','failed','cancelled','interrupted'],submitting:['running','received','failed','cancelled','interrupted'],running:['received','failed','cancelled','interrupted','resuming'],interrupted:['running','resuming','received','failed','cancelled'],resuming:['running','interrupted','received','failed','cancelled'],received:['saved'],failed:[],cancelled:[],saved:[]};
// Independent of grading revisions: saving progress must never invalidate scores/PDFs.
class GradingRuns{
 constructor(store){this.store=store;}
 journal(id){return new LocalJsonStore(path.join(this.store.folder(id),'ai-run'));}
 async get(id){await this.store.get(id);return this.journal(id).latest();}
 async write(id,current,data){
  const next={revision:(current?.revision||0)+1,requestId:crypto.randomUUID(),updatedAt:new Date().toISOString(),data};
  if(!await this.journal(id).create(next))throw fail(409,'AI 任务记录已更新，请重新读取；不会重新调用模型。');return next;
 }
 async start(id,input){
  const job=await this.store.get(id),current=await this.get(id);
  if(blocked.has(current?.data.status))throw fail(409,'已有未确认结束或待保存的 AI 任务；为避免重复执行，不能新建调用。');
  if(input.sourceRevision!==job.revision)throw fail(409,'试卷已更新，请重新读取。');
  if(!['pages','originals'].includes(input.mode)||!Number.isInteger(input.timeoutMs)||input.timeoutMs<1000||input.timeoutMs>600000||typeof input.extra!=='string'||input.extra.length>6000)throw fail(422,'AI 任务参数无效。');
  return this.write(id,current,{runId:crypto.randomUUID(),sourceRevision:job.revision,mode:input.mode,timeoutMs:input.timeoutMs,extra:input.extra,status:'preparing',providerProtocol:'tandix-recovery-v1',taskId:crypto.randomUUID(),cursor:0,providerStatus:null,backend:null,agentId:null,sessionId:null,turnId:null,attempt:0,resumable:false,resumeRequest:null,prompt:'',progress:'',resultText:'',errorCode:'',startedAt:new Date().toISOString()});
 }
 async update(id,input){
  const current=await this.get(id);if(!current||input.baseRevision!==current.revision||input.runId!==current.data.runId)throw fail(409,'AI 任务记录已更新，请重新读取。');
  const next=structuredClone(current.data);let status=input.status??next.status;
  if(input.resume===true){
   if(next.providerProtocol!=='tandix-recovery-v1')throw fail(409,'旧版临时任务没有持久映射，不能自动续接。');
   if(next.resumeRequest?.state==='pending')return current;
   if(next.status!=='interrupted'||!next.resumable)throw fail(409,'原任务尚未确认可继续，请先查询原任务。');
   if(typeof input.resumePrompt!=='string'||!input.resumePrompt.trim()||input.resumePrompt.length>64000)throw fail(422,'继续要求无效。');
   next.resumeRequest={requestId:crypto.randomUUID(),prompt:input.resumePrompt,state:'pending',attempt:input.attempt??(next.attempt||0)};status='resuming';
  }
  if(input.resumeAcknowledged===true&&next.resumeRequest)next.resumeRequest.state='acknowledged';
  for(const key of ['cursor','attempt'])if(input[key]!==undefined){
   if(!Number.isSafeInteger(input[key])||input[key]<0)throw fail(422,'任务游标或轮次无效。');
   if(input[key]<(next[key]||0))throw fail(409,'旧进度不能覆盖较新的任务记录。');next[key]=input[key];
  }
  if(input.providerStatus!==undefined){if(!['accepted','creating','ready','dispatching','running','interrupted','completed','failed','cancelled'].includes(input.providerStatus))throw fail(422,'原任务状态无效。');next.providerStatus=input.providerStatus;}
  if(input.resumable!==undefined){if(typeof input.resumable!=='boolean')throw fail(422,'续接状态无效。');next.resumable=input.resumable;}
  if(input.backend!==undefined){if(input.backend!=='codex')throw fail(422,'原任务后端无效。');next.backend=input.backend;}
  for(const key of ['agentId','sessionId','turnId'])if(input[key]!==undefined){
   const value=input[key];if(value!==null&&(typeof value!=='string'||!value||value.length>200))throw fail(422,'原会话标识无效。');
   if(key!=='turnId'&&next[key]&&value!==next[key])throw fail(409,'原 Agent 或会话发生变化，停止续接。');next[key]=value;
  }
  if(next.resumeRequest?.state==='pending'&&next.attempt>next.resumeRequest.attempt)next.resumeRequest.state='acknowledged';
  if(status!==next.status&&!transitions[next.status]?.includes(status))throw fail(409,'不能覆盖 AI 任务的结束状态或已收到的结果。');
  if(!transitions[next.status]?.length&&status===next.status)throw fail(409,'此 AI 任务已经结束。');
  for(const [key,max] of [['prompt',64000],['progress',32000],['resultText',1000000],['errorCode',100],['errorMessage',2000]])if(input[key]!==undefined){
   if(typeof input[key]!=='string'||input[key].length>max)throw fail(422,'AI 任务字段无效。');
   if(key==='prompt'&&next.prompt&&next.prompt!==input[key]||key==='resultText'&&next.resultText&&next.resultText!==input[key])throw fail(409,'不能覆盖原始提示或已收到的结果。');
   next[key]=input[key];
  }
  if(input.taskId!==undefined){if(typeof input.taskId!=='string'||!UUID.test(input.taskId)||next.taskId&&input.taskId!==next.taskId)throw fail(422,'原任务 ID 无效或已改变。');next.taskId=input.taskId;}
  if(['submitting','running','received','saved'].includes(status)&&!next.taskId)throw fail(422,'缺少原 Tandix 任务 ID。');
  if(['received','saved'].includes(status)&&!next.resultText)throw fail(422,'缺少已收到的最终结果。');
  if(status==='saved'){
   const job=await this.store.get(id);
   // A saved marker is an acknowledgement, never an independent score write.
   if(!job.data.result)throw fail(409,'请先校验并保存批改结果。');
  }
  next.status=status;return this.write(id,current,next);
 }
}
module.exports={GradingRuns};
