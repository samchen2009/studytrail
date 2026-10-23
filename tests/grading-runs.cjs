'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {GradingStore,createGradingService}=require('../api/grading');
async function main(){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'studytrail-ai-journal-'));let store=new GradingStore(folder);
 const server=http.createServer((req,res)=>createGradingService({store,origins:['http://local.test']})(req,res));
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base='http://127.0.0.1:'+server.address().port+'/api/grading';
  const request=async(route,body,origin='http://local.test')=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,value:await r.json()};};
  const job=(await request('/jobs',{title:'虚构执行记录',subject:'数学'})).value,id=job.data.id,route='/jobs/'+id+'/ai-run';
  const start={start:true,sourceRevision:job.revision,mode:'pages',timeoutMs:600000,extra:'详细说明'};
  assert.equal((await request(route,start,'https://other.invalid')).status,403);
  assert.equal((await request(route,{...start,sourceRevision:0})).status,409);
  const starts=await Promise.all([request(route,start),request(route,start)]);assert.deepEqual(starts.map(r=>r.status).sort(),[200,409],'concurrent tabs can create only one invocation');let run=starts.find(r=>r.status===200).value.run;
  const update=patch=>request(route,{baseRevision:run.revision,runId:run.data.runId,...patch});
  assert.equal((await request(route,start)).status,409);
  let r=await update({status:'preparing',prompt:'原始批改要求与页码映射',progress:'第一题已识别'});assert.equal(r.status,200);run=r.value.run;
  assert.equal((await update({prompt:'替换提示'})).status,409);
  const taskId=run.data.taskId;assert.match(taskId,/^[a-f0-9-]{36}$/);assert.equal(run.data.providerProtocol,'tandix-recovery-v1');r=await update({status:'submitting',taskId});assert.equal(r.status,200);run=r.value.run;
  store=new GradingStore(folder);assert.deepEqual((await request(route)).value.run,run,'task ID survives server restart even when acknowledgement is lost');
  assert.equal((await request(route,start)).status,409,'ambiguous remote submission blocks another task');
  r=await update({status:'running',progress:'第一题已识别，第二题完成'});assert.equal(r.status,200);run=r.value.run;
  assert.equal((await update({taskId:'b9cfb5d7-0a14-42d4-9ddc-508deec78847'})).status,422,'provider task ID never changes during recovery');
  r=await update({status:'interrupted',errorCode:'disconnected'});assert.equal(r.status,200);run=r.value.run;
  assert.equal((await request(route,start)).status,409);assert.equal((await update({resume:true,resumePrompt:'继续剩余工作'})).status,409,'must confirm resumable before continuing');
  r=await update({providerStatus:'interrupted',resumable:true,backend:'codex',agentId:'original-agent',sessionId:'original-session',turnId:'turn-1',attempt:1,cursor:8});assert.equal(r.status,200);run=r.value.run;
  r=await update({resume:true,resumePrompt:'保留第一题，继续第二题'});assert.equal(r.status,200);run=r.value.run;const originalRequest=run.data.resumeRequest;assert.equal(run.data.status,'resuming');
  store=new GradingStore(folder);assert.deepEqual((await request(route)).value.run.data.resumeRequest,originalRequest,'resume operation survives restart');
  r=await update({resume:true,resumePrompt:'修改后的要求'});assert.equal(r.status,200);assert.deepEqual(r.value.run.data.resumeRequest,originalRequest,'uncertain continuation keeps its original ID and prompt');run=r.value.run;
  r=await update({status:'running',providerStatus:'running',resumable:false,attempt:2,turnId:'turn-2',cursor:12});assert.equal(r.status,200);run=r.value.run;assert.equal(run.data.resumeRequest.state,'acknowledged');assert.equal(run.data.sessionId,'original-session');
  assert.equal((await update({sessionId:'new-session'})).status,409);assert.equal((await update({agentId:'new-agent'})).status,409);assert.equal((await update({cursor:2})).status,409);
  r=await update({status:'interrupted',providerStatus:'interrupted',resumable:true});run=r.value.run;
  r=await update({resume:true,resumePrompt:'继续第三题'});assert.equal(r.status,200);run=r.value.run;assert.notEqual(run.data.resumeRequest.requestId,originalRequest.requestId,'next interrupted attempt gets a new idempotency ID');
  // Simulate a late delivery of the original final result, without a second model invocation.
  const resultText='{"schemaVersion":"synthetic-result","questions":[]}';
  r=await update({status:'received',resultText});assert.equal(r.status,200);run=r.value.run;
  assert.equal((await update({status:'failed'})).status,409,'a late error cannot erase a received result');assert.equal((await update({resultText:'{}'})).status,409);
  assert.equal((await request(route,start)).status,409,'unsaved final results block duplicate calls');
  store=new GradingStore(folder);assert.equal((await request(route)).value.run.data.resultText,resultText,'final output remains recoverable after page and server restart');
  assert.equal((await request('/jobs/'+id)).value.revision,job.revision,'AI progress never changes grading/PDF revision');
  assert.equal((await update({progress:'x'.repeat(32001)})).status,422);
  assert.equal((await update({baseRevision:1})).status,409);
  assert.equal((await request('/jobs/../../config/ai-run')).status,404);
  const history=await fs.readdir(path.join(folder,id,'ai-run'));assert.ok(history.filter(n=>n.endsWith('.json')).length>=6);
  console.log('PASS: durable AI journal, concurrent submission exclusion, immutable provider ID/prompt/result, restart recovery, ambiguous-task lock, monotonic cursors, stable session identity, persisted/idempotent resume requests, stale/cross-origin rejection, score revision isolation. Synthetic only.');
 }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(folder,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
