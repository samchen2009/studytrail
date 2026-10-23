'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {MistakeStore,createMistakeService}=require('../api/mistakes');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studytrail-paper-management-'));let server;
 try{
  let store=new MistakeStore(root);let service=createMistakeService({store,origins:['http://local.test']});
  server=http.createServer((req,res)=>service(req,res));await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base='http://127.0.0.1:'+server.address().port+'/api/mistakes/';
  const api=async(route,body,origin='http://local.test')=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,value:await r.json()};};
  const entry=async(n,subject='数学')=>(await api('entries',{requestId:crypto.randomUUID(),subject,title:'合成第 '+n+' 题',stem:'计算 $'+n+'+1$。',answer:'ANSWER_SECRET_'+n,methods:[],knowledgePoints:[],printReady:true})).value;
  const a=await entry(1),b=await entry(2),c=await entry(3),other=await entry(4,'物理');
  const selection=(e,extra={})=>({id:e.data.id,revision:e.revision,points:null,space:'medium',...extra});
  const initial={requestId:crypto.randomUUID(),subject:'数学',title:'合成原卷',questions:[selection(a),selection(b)]};
  let paper=(await api('papers',initial)).value;const id=paper.data.id,route='papers/'+id;
  const firstFile=path.join(root,'papers',id,'000000000001.json'),firstBytes=await fs.readFile(firstFile);
  // Source revisions can change without forcing a saved paper to silently adopt them.
  await api('entries/'+a.data.id,{baseRevision:a.revision,stem:'已变化的源题'});
  const edit={requestId:crypto.randomUUID(),baseRevision:paper.revision,title:'合成改版 <script>unsafe()</script>',questions:[selection(c,{points:8,space:'large'}),selection(a,{stem:'本卷题干 $1+1$，仅用于本卷。',points:2,space:'small'})]};
  let r=await api(route,edit);assert.equal(r.status,200);paper=r.value;assert.equal(paper.revision,2);assert.equal(paper.data.id,id);assert.deepEqual(paper.data.questions.map(q=>q.entry.id),[c.data.id,a.data.id]);assert.equal(paper.data.questions[0].points,8);assert.equal(paper.data.questions[1].space,'small');assert.equal(paper.data.questions[1].entry.stem,edit.questions[1].stem);
  assert.equal((await api(route,edit)).value.revision,2,'retry after a lost save response does not duplicate versions');
  assert.equal((await api(route,{...edit,title:'other'})).status,409,'request IDs cannot be reused with another payload');
  assert.equal((await api(route,{...edit,requestId:crypto.randomUUID()})).status,409,'stale editor cannot overwrite a newer paper');
  assert.deepEqual(await fs.readFile(firstFile),firstBytes,'previous paper revision is immutable');
  assert.equal((await api('entries/'+a.data.id)).value.data.stem,'已变化的源题','paper text edits do not modify the notebook');
  const html=await (await fetch(base+route+'/print?kind=questions')).text();assert.ok(html.includes('本卷题干'));assert.ok(!html.includes('ANSWER_SECRET_'));assert.ok(!html.includes('<script>unsafe()'));assert.ok(html.includes('&lt;script&gt;'));assert.match(html,/满分 10/);
  for(const questions of [[],[selection(c),selection(c)],[selection(other)],[selection(c,{space:'bad'})],[selection(c,{points:0})],[selection(c,{stem:''})],[selection(b,{revision:99})]]){
   const bad=await api(route,{requestId:crypto.randomUUID(),baseRevision:paper.revision,title:'验证',questions});assert.ok([409,422].includes(bad.status),JSON.stringify(bad));
  }
  assert.equal((await api(route,{...edit,baseRevision:paper.revision,requestId:crypto.randomUUID()},'https://foreign.test')).status,403);
  const writes=await Promise.all(['并发甲','并发乙'].map(title=>api(route,{...edit,requestId:crypto.randomUUID(),baseRevision:paper.revision,title})));assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);paper=writes.find(r=>r.status===200).value;
  const deletion={baseRevision:paper.revision,requestId:crypto.randomUUID()};r=await api(route+'/delete',deletion);assert.equal(r.status,200);const deleted=r.value;
  assert.equal((await api(route+'/delete',deletion)).value.revision,deleted.revision,'delete retry is idempotent');
  assert.equal((await api(route)).status,404);assert.equal((await fetch(base+route+'/print')).status,404);assert.equal((await fetch(base+route+'/print?kind=answers&download=1')).status,404);
  assert.equal((await api('papers?subject='+encodeURIComponent('数学'))).value.papers.length,0);assert.equal((await api('papers?subject='+encodeURIComponent('数学')+'&deleted=1')).value.papers[0].id,id);
  assert.equal((await api('entries?subject='+encodeURIComponent('数学'))).value.total,3,'deleting a paper leaves notebook questions intact');
  assert.equal((await api(route,{...edit,baseRevision:deleted.revision,requestId:crypto.randomUUID()})).status,409,'deleted papers cannot be edited');
  assert.equal((await api(route+'/restore',{baseRevision:paper.revision,requestId:crypto.randomUUID()})).status,409);
  store=new MistakeStore(root);service=createMistakeService({store,origins:['http://local.test']});
  assert.equal((await api('papers?subject='+encodeURIComponent('数学')+'&deleted=1')).value.papers.length,1,'trash survives restart');
  const restore={baseRevision:deleted.revision,requestId:crypto.randomUUID()};r=await api(route+'/restore',restore);assert.equal(r.status,200);assert.equal(r.value.data.id,id);assert.deepEqual(r.value.data.questions,deleted.data.questions);assert.equal((await api(route+'/restore',restore)).value.revision,r.value.revision);
  assert.equal((await api('papers?subject='+encodeURIComponent('数学')+'&deleted=1')).value.papers.length,0);
  assert.equal((await api('papers?subject='+encodeURIComponent('数学'))).value.papers.length,1);assert.equal((await fetch(base+route+'/print')).status,200);
  assert.deepEqual(await fs.readFile(firstFile),firstBytes);
  console.log('PASS: in-place paper editing, add/remove/reorder, title/text/points/spacing, snapshot/source isolation, answer-free output, immutable revisions, optimistic conflicts, idempotent retries, cross-origin rejection, recoverable delete/restore and restart persistence.');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
