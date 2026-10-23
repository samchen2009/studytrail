'use strict';
const assert=require('node:assert/strict');
(async()=>{
 const {createPreparationQueue}=await import('../web/mistake-preparation.mjs');
 const calls=[],states=[];let release;const gate=new Promise(r=>release=r);
 const api=async(route,options)=>{calls.push(route);if(route==='entries/a/prepare'){await gate;return {entry:{revision:2,data:{id:'a',printReady:true}}};}if(route==='entries/b/prepare')return {entry:{revision:3,data:{id:'b',printReady:true}}};throw Error('unexpected '+route);};
 const queue=createPreparationQueue({api,onChange:(id,s)=>states.push([id,s.status])}),a=queue.ensure('a'),again=queue.ensure('a'),b=queue.ensure('b');assert.equal(a,again,'background collection and generation share the same promise');
 await Promise.resolve();assert.deepEqual(calls,['entries/a/prepare','entries/b/prepare']);assert.equal((await b).data.printReady,true,'cached question bypasses another pending preparation');release();await Promise.all([a,b]);assert.deepEqual(calls,['entries/a/prepare','entries/b/prepare']);assert.equal(queue.get('a').status,'ready');assert.ok(states.some(x=>x[1]==='queued'));
 let count=0;const retry=createPreparationQueue({api:async()=>{if(!count++)throw Error('材料暂时不可读');return {entry:{data:{id:'c',printReady:true}}};}});
 await assert.rejects(retry.ensure('c'),/不可读/);assert.equal(retry.get('c').status,'failed');await retry.wait(['c'],{retry:true});assert.equal(count,2);
 // A persisted provider result is consumed without starting a new model task.
 const record={data:{id:'import',target:{id:'d'},result:{questions:[{id:'q1'}]}},run:{data:{status:'received'}}};let modelCalls=0;
 class Runner{constructor(){modelCalls++;}}
 const cached=createPreparationQueue({Runner,api:async route=>route==='entries/d/prepare'?record:route==='imports/import/collect'?{entries:[{revision:4,data:{id:'d',printReady:true}}]}:Promise.reject(Error(route))});
 assert.equal((await cached.ensure('d')).revision,4);assert.equal(modelCalls,0);
 const incomplete=createPreparationQueue({api:async route=>route.endsWith('/prepare')?record:{entries:[{data:{id:'d',printReady:false}}]}});await assert.rejects(incomplete.ensure('d'),/必要题干或图表/);
 // Recognition completes and is collected automatically, with no candidate/confirmation UI.
 const journal={revision:1,data:{runId:'run',taskId:'task',status:'preparing'}},events=[];let nextRevision=1;
 class AutoRunner{constructor(options){this.options=options;}async run(){events.push('recognize');await this.options.onCheckpoint({status:'received',resultText:'{}'});}close(){}}
 const auto=createPreparationQueue({Runner:AutoRunner,api:async(route,options)=>{
  if(route==='entries/e/prepare')return {data:{id:'live'},run:journal,job:{},prompt:'extract only'};
  if(route==='imports/live/run')return {revision:++nextRevision,data:{...journal.data,status:JSON.parse(options.body).status}};
  if(route==='imports/live/result')return {data:{id:'live',result:{questions:[{id:'q1'}]}}};
  if(route==='imports/live/collect'){events.push('collect');return {entries:[{revision:2,data:{id:'e',printReady:true}}]};}
  throw Error(route);
 }});
 await auto.ensure('e');assert.deepEqual(events,['recognize','collect']);assert.equal(auto.get('e').status,'ready');
 // A browser without the extension must not mark another browser's provider task interrupted.
 const untouched=[];class NoExtension{constructor(){this.submitted=true;}async recover(){throw Object.assign(Error('no extension'),{code:'discovery-timeout'});}close(){}}
 const connectionFailure=createPreparationQueue({Runner:NoExtension,api:async route=>{untouched.push(route);if(route==='entries/network/prepare')return {data:{id:'existing'},run:{revision:5,data:{runId:'run',taskId:'task',status:'running'}}};throw Error('Provider journal should remain unchanged');}});
 await assert.rejects(connectionFailure.ensure('network'),/Tandix/);assert.deepEqual(untouched,['entries/network/prepare']);
 // Cached preparations count immediately even when an earlier selected entry is slow.
 let readyFirst;const delayed=new Promise(r=>readyFirst=r),progress=[];
 const progressQueue=createPreparationQueue({api:async route=>{if(route==='entries/slow/prepare')await delayed;return {entry:{data:{id:route.includes('slow')?'slow':'fast',printReady:true}}};}});
 const waiting=progressQueue.wait(['slow','fast'],{onProgress:p=>progress.push(p.completed)});await new Promise(r=>setTimeout(r,0));assert.ok(progress.includes(1));readyFirst();assert.deepEqual((await waiting).map(r=>r.data.id),['slow','fast']);assert.equal(progress.at(-1),2);
 console.log('PASS: shared automatic preparation queue, serialization, durable result reuse, automatic recognition/collection, meaningful incomplete-material errors and retry without manual editing.');
})().catch(e=>{console.error(e);process.exitCode=1;});
