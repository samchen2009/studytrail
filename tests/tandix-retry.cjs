'use strict';
// Real vendored SDK + a fake Chrome extension transport. No model/service calls.
const assert=require('node:assert/strict');
async function main(){
 const {TandixGrader}=await import('../web/grading-tandix.mjs');
 const {TandixClient}=await import('../web/vendor/tandix/tandix.mjs');
 const {WEB_LIMITS}=await import('../web/vendor/tandix/protocol.mjs');
 const old={window:global.window,chrome:global.chrome},events=new EventTarget(),origin='http://127.0.0.1:8767';
 const win={top:null,location:{origin,href:origin+'/#grading'},addEventListener:(...a)=>events.addEventListener(...a),removeEventListener:(...a)=>events.removeEventListener(...a)};win.top=win;
 win.postMessage=m=>{const e=new Event('message');Object.defineProperties(e,{source:{value:win},origin:{value:origin},data:{value:{type:'tandix:discovered:v1',requestId:m.requestId,product:'tandix',version:1,extensionId:'a'.repeat(32)}}});queueMicrotask(()=>events.dispatchEvent(e));};global.window=win;
 const tasks=new Map(),log=[],ports=[],uploads=new Map(),resumeSeen=new Set();let recovery=1,loseRunReply=false,loseResumeReply=false,reset=false,pageSize=500,allocated=false,active;
 const hello={product:'tandix',version:1,authorized:true,origin,limits:WEB_LIMITS,mediaTypes:['image/jpeg'],backends:['codex'],resultFormats:['json']};
 const emit=(t,type,extra={})=>{const e={taskId:t.taskId,seq:++t.lastSeq,type,...extra};t.events.push(e);if(type==='delta')t.text+=extra.text;return e;};
 const snapshot=(t,after=0)=>{const all=t.events.filter(e=>e.seq>after),selected=all.slice(0,pageSize);return {...t,events:selected,cursor:selected.at(-1)?.seq??after,hasMore:all.length>selected.length,reset,...(reset?{text:t.text}:{} )};};
 const complete=t=>{t.status='completed';t.resumable=false;t.result={taskId:t.taskId,text:'{"ok":true}',data:{ok:true}};emit(t,'completed',{result:t.result});};
 global.chrome={runtime:{connect:()=>{
  const listeners=[],disconnects=[];let closed=false;
  const port={onMessage:{addListener:f=>listeners.push(f)},onDisconnect:{addListener:f=>disconnects.push(f)},disconnect(){if(closed)return;closed=true;disconnects.forEach(f=>f());},postMessage(m){
   log.push(m);let result,error;
   try{
    if(m.method==='hello')result={...hello,taskRecovery:recovery};
    else if(m.method==='files.begin'){const fileId=crypto.randomUUID();uploads.set(fileId,[]);result={fileId};}
    else if(m.method==='files.chunk'){const parts=uploads.get(m.params.fileId);parts.push(Buffer.from(m.params.data,'base64'));result={received:Buffer.concat(parts).length};}
    else if(m.method==='files.remove')result={removed:true};
    else if(m.method==='tasks.run'){
     assert.ok(allocated,'provider ID persisted before any model submission');
     let t=tasks.get(m.params.taskId);
     if(!t){t={taskId:m.params.taskId,backend:'codex',agentId:'agent-fixture',sessionId:'session-fixture-'+tasks.size,turnId:'turn-1',status:'running',attempt:1,createdAt:Date.now(),updatedAt:Date.now(),lastSeq:0,cursor:0,hasMore:false,reset:false,text:'',events:[],resumable:false};tasks.set(t.taskId,t);emit(t,'accepted');emit(t,'started');emit(t,'delta',{text:'第一题已完成。'});}
     active=t;result=snapshot(t);
     if(loseRunReply){loseRunReply=false;queueMicrotask(()=>port.disconnect());return;}
    }else if(['tasks.attach','tasks.get','tasks.resume','tasks.cancel'].includes(m.method)){
     const t=tasks.get(m.params.taskId);if(!t)throw Object.assign(Error('unknown-task'),{code:'unknown-task'});
     if(m.method==='tasks.resume'){
      if(!resumeSeen.has(m.params.requestId)){resumeSeen.add(m.params.requestId);t.attempt++;t.status='running';t.resumable=false;t.turnId='turn-'+t.attempt;emit(t,'resuming');emit(t,'delta',{text:'继续第二题。'});}
      if(loseResumeReply){loseResumeReply=false;queueMicrotask(()=>port.disconnect());return;}
     }
     if(m.method==='tasks.cancel'){t.status='cancelled';t.error={code:'cancelled',message:'cancelled'};emit(t,'cancelled',{error:t.error});}
     result=snapshot(t,m.params.afterSeq||0);
    }else throw Error('Unexpected method '+m.method);
   }catch(e){error={code:e.code||'request-failed',message:e.message};}
   queueMicrotask(()=>{if(!closed)listeners.forEach(f=>f(error?{id:m.id,ok:false,error}:{id:m.id,ok:true,result}));});
  }};ports.push(port);return port;
 }}};
 const wait=async predicate=>{const deadline=Date.now()+7000;while(!predicate()){if(Date.now()>deadline)throw Error('Condition timed out');await new Promise(r=>setTimeout(r,10));}};
 const bytes=Buffer.from([255,216,255,0]),asset={id:'page-fixture',role:'student',size:4,type:'image/jpeg',pageNumber:1};
 const job={title:'虚构恢复验证',subject:'数学',grade:'高一',files:[{...asset,id:'source-fixture',complete:true}],pages:[asset]};
 let reads=0,progress='',journal={},grader;
 const make=()=>new TandixGrader({onCheckpoint:async patch=>{if(patch.status==='submitting')allocated=true;journal={...journal,...patch};},onProgress:e=>{if(e.type==='snapshot')progress=e.text;if(e.type==='delta')progress+=e.text;}});
 const execute=(id,g=grader)=>g.run({job,taskId:id,contract:'{}',fetchAsset:async()=>{reads++;return {ok:true,blob:async()=>new Blob([bytes])};}});
 try{
  const id=crypto.randomUUID();grader=make();const first=execute(id);await wait(()=>grader.task?.snapshot?.status==='running');grader.close();await assert.rejects(first,{code:'disconnected'});
  assert.equal(log.filter(m=>m.method==='tasks.cancel').length,0,'closing observation never cancels provider work');assert.equal(tasks.size,1);
  // Close/reopen and a transport disconnect while result delivery is lost.
  grader=make();const recovered=grader.recover({taskId:id,cursor:journal.cursor||0,identity:{sessionId:journal.sessionId,agentId:journal.agentId}});await wait(()=>grader.task);ports.at(-1).disconnect();complete(active);assert.deepEqual((await recovered).data,{ok:true});
  assert.equal(log.filter(m=>m.method==='tasks.run').length,1);assert.equal(reads,1);assert.equal(tasks.size,1);assert.equal(journal.status,'received');assert.equal(journal.sessionId,active.sessionId);
  // Lost tasks.run acknowledgement is recovered by GET, never resubmission.
  journal={};allocated=false;grader=make();loseRunReply=true;const lostId=crypto.randomUUID(),lost=execute(lostId);await wait(()=>tasks.has(lostId));complete(tasks.get(lostId));await lost;assert.equal(log.filter(m=>m.method==='tasks.run'&&m.params.taskId===lostId).length,1);
  // Resume remains explicit; the original session and work survive timeouts.
  journal={};allocated=false;grader=make();const resumeId=crypto.randomUUID(),pending=execute(resumeId);await wait(()=>grader.task);const t=tasks.get(resumeId);t.status='interrupted';t.resumable=true;t.error={code:'timeout',message:'attempt timed out'};emit(t,'interrupted',{error:t.error});await wait(()=>grader.task.snapshot.status==='interrupted');
  assert.equal(log.filter(m=>m.method==='tasks.resume').length,0,'timeout does not silently start another turn');
  const session=t.sessionId,requestId=crypto.randomUUID();loseResumeReply=true;await assert.rejects(grader.resume({requestId,prompt:'保留第一题，只继续第二题。'}));assert.equal(t.attempt,2);assert.equal(t.sessionId,session);
  // A lost continue reply followed by reconnect first queries; running is not resumed twice.
  await assert.rejects(grader.resume({requestId,prompt:'保留第一题，只继续第二题。'}),{code:'task-busy'});assert.equal(resumeSeen.size,1);complete(t);await pending;assert.equal(t.attempt,2);assert.equal(tasks.size,3);
  // Pagination/reset uses authoritative text, not repeated deltas.
  const pageId=crypto.randomUUID(),pageTask={...t,taskId:pageId,status:'running',text:'',events:[],lastSeq:0,result:undefined,resumable:false};tasks.set(pageId,pageTask);for(const text of ['A','B','C','D'])emit(pageTask,'delta',{text});complete(pageTask);pageSize=2;reset=true;progress='OLD';grader=make();await grader.recover({taskId:pageId});assert.equal(progress,'ABCD','truncated/paged replay does not duplicate displayed text');
  pageSize=500;reset=false;
  grader=make();await assert.rejects(grader.recover({taskId:crypto.randomUUID()}),{code:'unknown-task'});assert.equal(log.filter(m=>m.method==='tasks.run').length,3);
  grader=make();await assert.rejects(grader.recover({taskId:id,identity:{sessionId:'wrong-session'}}),{code:'agent-mismatch'});
  // Missing capability prevents uploads/submission; journal failures also prevent invocation.
  recovery=undefined;grader=make();const count=log.length;await assert.rejects(execute(crypto.randomUUID()),{code:'unsupported-companion'});assert.ok(!log.slice(count).some(m=>m.method==='files.begin'||m.method==='tasks.run'));recovery=1;
  grader=new TandixGrader({onCheckpoint:async()=>{throw Error('disk full');}});const before=log.filter(m=>m.method==='tasks.run').length;await assert.rejects(execute(crypto.randomUUID()),/disk full/);assert.equal(log.filter(m=>m.method==='tasks.run').length,before);
  // Genuine SDK cancel remains explicit.
  allocated=false;journal={};grader=make();const cancelId=crypto.randomUUID(),cancelled=execute(cancelId);await wait(()=>grader.task);await grader.cancel();await assert.rejects(cancelled,{code:'cancelled'});assert.equal(tasks.get(cancelId).status,'cancelled');
  console.log('PASS: real SDK mock transport: detach/reconnect, missed result, lost acceptance reply, cursor replay/reset/pagination, explicit same-session resume, lost resume acknowledgement, no duplicate model submission, identity/capability checks and durable-write gate. No real Tandix/model call.');
 }finally{grader?.close();for(const port of ports)port.disconnect();if(old.window===undefined)delete global.window;else global.window=old.window;if(old.chrome===undefined)delete global.chrome;else global.chrome=old.chrome;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
