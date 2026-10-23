'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),sharp=require('sharp');
const {GradingStore}=require('../api/grading'),{MistakeStore,createMistakeService}=require('../api/mistakes'),G=require('../web/grading-core');
const {validateExtraction,SCHEMA}=require('../api/mistake-imports');
async function run(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studytrail-auto-import-'));let server;
 try{
  // Blue question area and red answers. A printable crop must contain no red area.
  const bytes=await sharp({create:{width:600,height:800,channels:3,background:'#ff0000'}}).composite([{input:await sharp({create:{width:480,height:160,channels:3,background:'#0000ff'}}).png().toBuffer(),left:60,top:80}]).png().toBuffer();
  const grading=new GradingStore(path.join(root,'grading')),store=new MistakeStore(path.join(root,'mistakes'),{grading});await store.init();grading.onSaved=row=>store.syncJob(row);
  let job=await grading.create({title:'合成自动截题样例',subject:'物理',grade:'高二'});const pageId=crypto.randomUUID();
  await fs.mkdir(path.join(grading.folder(job.data.id),'assets'),{recursive:true});await fs.writeFile(path.join(grading.folder(job.data.id),'assets',pageId),bytes);
  const part={pageId,rect:[.1,.1,.8,.2],rotation:0,role:'question',clean:true,kind:'full'};
  const q={id:'q1',number:'1',stem:'合成题干，按图计算。',studentAnswer:'SOURCE_ANSWER_SECRET',answer:'原参考答案',methods:[{title:'原解析',steps:['保留本次原解法。']}],knowledgePoints:['力学'],diagrams:[],maxScore:10,score:4,confidence:1,needsReview:false,feedback:'合成失分依据',rubric:[{criterion:'合成评分',maxScore:10,score:4}],regions:[{pageId,x:.5,y:.3}],questionType:'计算题',questionContent:{complete:true,confidence:.99,parts:[part]}};
  job=await grading.update(job.data.id,{baseRevision:job.revision},j=>{j.pages=[{id:pageId,type:'image/png',name:'synthetic.png',role:'student',pageNumber:1,width:600,height:800}];j.files=[{id:crypto.randomUUID(),complete:true}];j.result=G.validateResult({schemaVersion:G.SCHEMA,reviewedPageIds:[pageId],questions:[q],knowledgeSummary:[],overallFeedback:''},j.pages);});
  let entry=[...store.rows.values()][0];assert.equal(entry.data.printReady,true);assert.equal(entry.data.extractionNeeded,false);assert.equal(entry.data.questionType,'计算题');assert.equal(entry.data.questionFormat,'image');
  const picture=entry.data.assets.find(a=>a.role==='question');assert.ok(picture?.cropped,'the server itself crops and saves the image');const cropped=await store.asset(picture),meta=await sharp(cropped).metadata();assert.equal(meta.width,480);assert.equal(meta.height,160);
  const stats=await sharp(cropped).stats();assert.ok(stats.channels[0].mean<10,'answer area is excluded from the actual stored bitmap');assert.ok(stats.channels[2].mean>240);
  assert.throws(()=>G.validateQuestionContent({complete:true,confidence:1,parts:[{...part,rect:[.8,.8,.5,.5]}]},job.data.pages),/超出/);
  assert.throws(()=>validateExtraction({schemaVersion:SCHEMA,questions:[{...q,questionContent:{complete:true,confidence:1,parts:[{...part,pageId:'foreign'}]}}]},job.data.pages));
  const oldScoreRevision=job.data.scoreRevision;
  const service=createMistakeService({store,origins:['http://local.test']});server=http.createServer(service);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  const api=async(route,body)=>{const r=await fetch(base+'/api/mistakes/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:'http://local.test',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,value:await r.json()};};
  // Legacy single-click collection automatically keeps a cropped source snapshot.
  job=await grading.update(job.data.id,{baseRevision:job.revision},j=>{delete j.result.questions[0].questionContent;});entry=[...store.rows.values()][0];assert.equal(entry.data.extractionNeeded,true);assert.ok(entry.data.assets.some(a=>a.role==='source'&&a.cropped));assert.equal(entry.data.printReady,false);
  const beforeJob=await grading.get(job.data.id),score=structuredClone(entry.data.score),methods=structuredClone(entry.data.methods);
  let prepared=(await api('imports',{entryId:entry.data.id})).value;assert.equal(prepared.run.data.status,'preparing');assert.equal((await api('imports',{entryId:entry.data.id})).value.run.data.taskId,prepared.run.data.taskId,'repeated clicks reuse one persisted provider task');
  const id=prepared.data.id;assert.equal((await fetch(base+'/api/mistakes/imports/'+id+'/pages/'+pageId)).status,200);
  let journal=prepared.run;
  const checkpoint=async patch=>{const r=await api('imports/'+id+'/run',{baseRevision:journal.revision,runId:journal.data.runId,...patch});assert.equal(r.status,200,JSON.stringify(r.value));journal=r.value;};
  const result={schemaVersion:SCHEMA,subject:'数学',questions:[{...q,title:'自动识别题名',sourceQuestionId:'q1',answer:'AI 不能覆盖原答案',methods:[{title:'AI 新解法',steps:['不能覆盖原解法']}],questionContent:{complete:true,confidence:.99,parts:[part]}}]};
  await checkpoint({status:'submitting',prompt:'合成固定识题提示'});await checkpoint({status:'running'});await checkpoint({status:'received',resultText:JSON.stringify(result)});
  assert.equal((await api('imports/'+id+'/result',{})).status,200);
  const previewResponse=await fetch(base+'/api/mistakes/imports/'+id+'/preview/q1');assert.equal(previewResponse.status,200);assert.equal((await sharp(Buffer.from(await previewResponse.arrayBuffer())).metadata()).height,160);
  let saved=await api('imports/'+id+'/collect',{ids:['q1']});assert.equal(saved.status,200,JSON.stringify(saved.value));const enriched=saved.value.entries[0];assert.equal(enriched.data.id,entry.data.id);assert.equal(enriched.data.subject,'物理','known source subject is preserved');assert.equal(enriched.data.printReady,true);assert.deepEqual(enriched.data.score,score);assert.deepEqual(enriched.data.methods,methods);assert.equal(enriched.data.answer,'原参考答案');
  assert.equal((await api('imports/'+id+'/collect',{ids:['q1']})).value.entries[0].revision,enriched.revision,'retries do not create versions or duplicates');
  assert.deepEqual(await grading.get(job.data.id),beforeJob,'automatic extraction never changes a score, grading revision or original result');assert.ok(beforeJob.data.scoreRevision>=oldScoreRevision);
  const paper=await store.createPaper({requestId:crypto.randomUUID(),subject:'物理',questions:[{id:enriched.data.id,revision:enriched.revision,points:null,space:'medium'}]});const html=await(await fetch(base+'/api/mistakes/papers/'+paper.data.id+'/print')).text();assert.match(html,/data:image\/jpeg/);assert.ok(!html.includes('SOURCE_ANSWER_SECRET')&&!html.includes('原参考答案'));
  // Unknown photos only need a subject and file; all metadata comes from recognition.
  const photo={subject:'数学',name:'合成练习.png',pages:[{pageNumber:1,data:'data:image/png;base64,'+bytes.toString('base64')}]};
  prepared=(await api('imports',photo)).value;const photoId=prepared.data.id,pid=prepared.data.pages[0].id;assert.equal(prepared.data.source.title,'合成练习.png');
  const photoResult={schemaVersion:SCHEMA,subject:'化学',questions:['qA','qB'].map((qid,i)=>({...result.questions[0],id:qid,sourceQuestionId:'',number:String(i+1),stem:'自动识别的第 '+(i+1)+' 道题',questionContent:{complete:true,confidence:.95,parts:[{...part,pageId:pid}]}}))};
  journal=prepared.run;for(const patch of [{status:'submitting',prompt:'照片自动识题'},{status:'received',resultText:JSON.stringify(photoResult)}]){const r=await api('imports/'+photoId+'/run',{baseRevision:journal.revision,runId:journal.data.runId,...patch});assert.equal(r.status,200);journal=r.value;}
  assert.equal((await api('imports/'+photoId+'/result',{})).value.data.result.questions.length,2);
  saved=await api('imports/'+photoId+'/collect',{ids:['qB']});assert.equal(saved.value.entries.length,1);assert.equal(saved.value.entries[0].data.number,'2');assert.equal(saved.value.entries[0].data.subject,'化学');assert.equal(saved.value.entries[0].data.score,null);
  assert.equal((await api('entries?subject='+encodeURIComponent('化学'))).value.total,1,'unselected recognized questions are not silently added');
  const unclean={...result,questions:[{...result.questions[0],questionContent:{complete:true,confidence:1,parts:[{...part,clean:false}]}}]};assert.equal(validateExtraction(unclean,job.data.pages).questions[0].questionContent.parts[0].clean,false);
  const capture=await store.extractAssets(job.data.pages,unclean.questions[0].questionContent,()=>Promise.resolve(bytes));assert.equal(capture.printReady,false);assert.equal(capture.assets[0].role,'source','handwriting cannot be silently promoted to a printable question');
  // Updating an entry while recognition runs must never be overwritten by its late result.
  prepared=(await api('imports',{entryId:enriched.data.id})).value;const staleId=prepared.data.id;await store.edit(enriched.data.id,{baseRevision:enriched.revision,stem:'用户新修改的题面'});journal=prepared.run;
  for(const patch of [{status:'submitting',prompt:'并发识题'},{status:'received',resultText:JSON.stringify(result)}]){const r=await api('imports/'+staleId+'/run',{baseRevision:journal.revision,runId:journal.data.runId,...patch});assert.equal(r.status,200);journal=r.value;}
  await api('imports/'+staleId+'/result',{});assert.equal((await api('imports/'+staleId+'/collect',{ids:['q1']})).status,409);assert.equal((await store.get(enriched.data.id)).data.stem,'用户新修改的题面');
  prepared=(await api('imports',{...photo,name:'合成格式错误重试.png'})).value;journal=prepared.run;const invalidId=prepared.data.id,firstTask=journal.data.taskId;
  for(const patch of [{status:'submitting',prompt:'合成坏结果'},{status:'received',resultText:'not json'}]){const r=await api('imports/'+invalidId+'/run',{baseRevision:journal.revision,runId:journal.data.runId,...patch});assert.equal(r.status,200);journal=r.value;}
  assert.equal((await api('imports/'+invalidId+'/result',{})).status,422);assert.equal((await api('imports/'+invalidId+'/run')).value.data.status,'failed');
  const retry=await api('imports/'+invalidId+'/run',{start:true});assert.equal(retry.status,200);assert.notEqual(retry.value.data.taskId,firstTask,'explicit retry starts a new recognition only after invalid output was confirmed');
  // Historical HTML questions can have only saved cropped sources. They remain
  // valid recognition inputs even though they are unsafe to print as questions.
  const legacy=await store.manual({requestId:crypto.randomUUID(),subject:'物理',title:'独立题图回归',stem:'带批注的电路题',answer:'LEGACY_ANSWER_SECRET',images:[{role:'question',data:'data:image/png;base64,'+bytes.toString('base64')}]});
  const cropA=legacy.data.assets[0],secondBytes=await sharp(bytes).resize(300,400).png().toBuffer(),cropB=await store.putAsset(secondBytes,'image/png','共用材料','source',{cropped:true,pageId:'same-original-page',pageNumber:46});
  const legacySources=[{...cropA,role:'source',cropped:true,pageId:'same-original-page',pageNumber:46},cropB];
  const savedLegacy=await store.saveEntry({...legacy.data,printReady:false,assets:[{...cropA,hash:'f'.repeat(64),role:'source'},...legacySources]},legacy.revision);
  prepared=(await api('entries/'+legacy.data.id+'/prepare',{})).value;
  assert.ok(prepared.data,JSON.stringify(prepared));assert.equal(prepared.data.pages.length,2,'two crops from one original page must not be collapsed');assert.equal(new Set(prepared.data.pages.map(p=>p.id)).size,2);assert.equal(prepared.data.pages[0].pageNumber,46);
  assert.equal((await store.get(legacy.data.id)).data.printReady,false,'finding a source image alone must not make it printable');
  for(const p of prepared.data.pages)assert.equal((await fetch(base+'/api/mistakes/imports/'+prepared.data.id+'/pages/'+p.id)).status,200);
  assert.match(prepared.prompt,/questionDiagrams/);assert.match(prepared.prompt,/相对于本次所附图片/);
  const diagram={title:'原题电路示意图',description:'',shapes:[{type:'line',x1:100,y1:100,x2:300,y2:100},{type:'circle',cx:200,cy:200,r:25},{type:'text',x:190,y:206,text:'V'}]};
  const cleanResult={schemaVersion:SCHEMA,questions:[{id:'clean',number:'21',stem:'完整原题条件，求所需物理量。',answer:'不能覆盖原答案',questionDiagrams:[diagram],questionContent:{complete:true,confidence:.99,parts:[]}}]};
  journal=prepared.run;const recoveredId=prepared.data.id;
  for(const patch of [{status:'submitting',prompt:prepared.prompt},{status:'received',resultText:JSON.stringify(cleanResult)}]){const r=await api('imports/'+recoveredId+'/run',{baseRevision:journal.revision,runId:journal.data.runId,...patch});assert.equal(r.status,200,JSON.stringify(r.value));journal=r.value;}
  assert.equal((await api('imports/'+recoveredId+'/result',{})).status,200);
  const recovered=(await api('imports/'+recoveredId+'/collect',{ids:['clean']})).value.entries[0];assert.equal(recovered.data.printReady,true);assert.equal(recovered.data.answer,'LEGACY_ANSWER_SECRET');assert.ok(legacySources.every(a=>recovered.data.assets.some(b=>b.hash===a.hash&&b.role==='source'&&b.cropped)),'original question crops and origin metadata remain available');
  const generated=recovered.data.assets.find(a=>a.generated);assert.equal(generated.role,'question');assert.equal(generated.clean,true);assert.equal((await sharp(await store.asset(generated)).metadata()).width,900);
  const recoveredPaper=await store.createPaper({requestId:crypto.randomUUID(),subject:'物理',questions:[{id:recovered.data.id,revision:recovered.revision,points:null,space:'medium'}]});
  const recoveredHtml=await(await fetch(base+'/api/mistakes/papers/'+recoveredPaper.data.id+'/print')).text();assert.ok(recoveredHtml.includes('完整原题条件'));assert.match(recoveredHtml,/data:image\/jpeg/);assert.ok(!recoveredHtml.includes('LEGACY_ANSWER_SECRET')&&!recoveredHtml.includes('data:image/png'));
  // If a previous enrichment lost its question assets, recover only the matching
  // original question from the report, without using answer-page images.
  const reportId=crypto.randomUUID(),sourceSha256='a'.repeat(64),questionId='original-q',key=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,32),reportEntryId=key('manual:'+key('report:'+reportId+':'+sourceSha256+':'+questionId));
  store.attachments={report:async()=>({id:reportId,sourceSha256,questions:[{id:questionId,images:[{...cropA,origin:{pageNumber:46}}],content:[{hash:'b'.repeat(64)}]}]}),reportAsset:async(_id,hash)=>{assert.equal(hash,cropA.hash);return bytes;}};
  await store.saveEntry({...legacy.data,id:reportEntryId,printReady:false,assets:[],source:{kind:'exam-attachment',attachmentId:reportId,title:'合成迁移报告'}},0);
  const recoveredReport=await api('entries/'+reportEntryId+'/prepare',{});assert.equal(recoveredReport.status,200);assert.equal(recoveredReport.value.data.pages.length,1);assert.equal(recoveredReport.value.data.pages[0].hash,cropA.hash);
  assert.throws(()=>validateExtraction({...cleanResult,questions:[{...cleanResult.questions[0],questionDiagrams:[{title:'invalid',shapes:[{type:'script'}]}]}]},prepared.data.pages));
  const denied=await fetch(base+'/api/mistakes/imports/'+photoId,{headers:{Origin:'https://other.test'}});assert.equal(denied.status,403);
  console.log('PASS: server-side exact image crops, automatic metadata, legacy source capture, durable/idempotent imports, selective photo collection, score preservation, clean printing, late-result conflicts and origin checks. Synthetic only; no real AI call.');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
