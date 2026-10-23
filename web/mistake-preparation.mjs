import {TandixGrader,explain} from './grading-tandix.mjs';

// One durable extraction per entry. Collection and paper generation share this queue.
export function createPreparationQueue({api,Runner=TandixGrader,onChange=()=>{}}){
 const states=new Map();let tail=Promise.resolve();
 const post=(route,body)=>api(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const publish=(id,patch)=>{Object.assign(states.get(id),patch);onChange(id,{...states.get(id)});};
 async function prepare(id,record){
  publish(id,{status:'running',message:'正在整理题干、选项和必要图表…'});
  let run=record.run,chain=Promise.resolve(),runner,resuming=false,resumes=0,rejectRun;
  const interrupted=new Promise((_,reject)=>{rejectRun=reject;});
  const checkpoint=patch=>{chain=chain.then(async()=>{run=await post('imports/'+record.data.id+'/run',{baseRevision:run.revision,runId:run.data.runId,...patch});});return chain;};
  try{
   if(!record.data.result){
    runner=new Runner({onState:phase=>{
     publish(id,{message:phase==='waiting'?'正在等待本机识别服务授权…':'正在识别题干、选项和图表…'});
     if(phase==='interrupted'&&!resuming){
      if(resumes>=2){rejectRun(Error('题目整理暂未完成，原任务和材料已保留。再次生成时会继续处理。'));return;}
      resuming=true;resumes++;
      Promise.resolve().then(async()=>{await checkpoint({resume:true,resumePrompt:'继续整理指定题目的干净题面、选项和必要图表。只处理原附件，不改变原评分，返回约定的完整 JSON。'});const request=run.data.resumeRequest;await runner.resume({requestId:request.requestId,prompt:request.prompt});}).catch(rejectRun).finally(()=>{resuming=false;});
     }
    },onProgress:()=>{},onCheckpoint:checkpoint});
    if(run.data.status!=='received')await Promise.race([
     run.data.status==='preparing'
      ?runner.run({job:record.job,taskId:run.data.taskId,prompt:record.prompt,fetchAsset:p=>fetch('/api/mistakes/imports/'+record.data.id+'/pages/'+p.id,{cache:'no-store'})})
      :runner.recover({taskId:run.data.taskId,cursor:run.data.cursor||0,identity:{agentId:run.data.agentId,sessionId:run.data.sessionId},allowAuthorize:true}),
     interrupted,
    ]);
    await chain;record=await post('imports/'+record.data.id+'/result',{});
   }
   const saved=await post('imports/'+record.data.id+'/collect',{ids:record.data.result.questions.map(q=>q.id)}),entry=saved.entries.find(e=>e.data.id===id);
   if(!entry?.data.printReady)throw Error('原材料中的必要题干或图表仍无法完整识别，系统已保留整理结果；请提供更清晰的原材料后再次生成。');
   return entry;
  }catch(error){
   try{await chain;if(!['discovery-timeout','unavailable','unsupported-page','unsupported-companion','authorization-required'].includes(error.code)&&['preparing','submitting','running','interrupted'].includes(run?.data.status))await checkpoint({status:runner?.submitted&&error.code!=='invalid-json'?'interrupted':'failed',errorCode:error.code||'preparation-error',errorMessage:explain(error).slice(0,2000)});}catch{}
   throw Error(explain(error).replace(/批改/g,'整理题目'));
  }finally{runner?.close();}
 }
 function ensure(id,{retry=false}={}){
  const existing=states.get(id);
  if(existing&&(!retry||['queued','running'].includes(existing.status)))return existing.promise;
  const state={status:'queued',message:'题目已加入自动整理队列。'};states.set(id,state);
  // Cached clean statements must not wait behind an unrelated recognition task.
  const task=post('entries/'+id+'/prepare',{}).then(record=>{
   if(record.entry)return record.entry;
   const recognition=tail.then(()=>prepare(id,record));tail=recognition.catch(()=>{});return recognition;
  }).then(entry=>{publish(id,{status:'ready',message:'题目已准备好。',entry});return entry;},error=>{publish(id,{status:'failed',message:error.message,error});throw error;});
  state.promise=task;onChange(id,{...state});return task;
 }
 return {ensure,get:id=>states.get(id),async wait(ids,{retry=false,onProgress=()=>{}}={}){
  let completed=0;onProgress({completed,total:ids.length});
  return Promise.all(ids.map(async id=>{try{const entry=await ensure(id,{retry});onProgress({completed:++completed,total:ids.length,id});return entry;}catch(error){error.entryId=id;throw error;}}));
 }};
}
