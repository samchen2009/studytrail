'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http'),vm=require('node:vm');
const {createAnswersHtml,rich,HTML_RENDERER}=require('../api/grading-html');
const {GradingStore,createGradingService}=require('../api/grading'),G=require('../api/grading-core');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=','base64');
function question(pageId,id='q1',number='1'){
 return {id,number,stem:String.raw`计算 \(\frac{1}{2}+\frac{1}{3}\)，并阅读反应式 \(\ce{CO(g) + 2H2(g) -> CH3OH(g)}\)。A. 1 B. 5/6 C. 2 D. 3`,studentAnswer:'<script>globalThis.unsafe=1</script>；答案为5/6',answer:String.raw`\(\frac{5}{6}\)`,maxScore:10,score:10,confidence:0.98,needsReview:false,reviewReason:'',feedback:'通分与计算正确。',regions:[{pageId,x:0.25,y:0.3,anchorText:'1.'}],rubric:[{criterion:'计算正确',maxScore:10,score:10,evidence:'5/6',reason:'分母统一后相加'}],methods:[{title:'通分',steps:[String.raw`\[\frac{1}{2}+\frac{1}{3}=\frac{3+2}{6}=\frac{5}{6}\]`,'检验数量级。']}],knowledgePoints:['分数加法'],diagrams:[{title:'分子连接辅助示意',description:'图形与正文分开渲染。',shapes:[{type:'line',x1:80,y1:300,x2:500,y2:300,color:'green'},{type:'text',x:160,y:250,text:'<img src=x onerror=alert(1)>',color:'ink'}]}]};
}
async function run(){
 assert.match(rich(String.raw`\(\frac{1}{2}\)`),/<mfrac>/);
 assert.match(rich(String.raw`\[\ce{H2(g) + O2(g) -> H2O(g)}\]`),/katex-display/);
 assert.match(rich(String.raw`$x^2$ 和 $$y=1$$`),/katex/);
 assert.equal(rich('<script>bad</script>'),'&lt;script&gt;bad&lt;/script&gt;');
 assert.match(rich(String.raw`\(\unknowncommand{1}\)`),/公式待核/);
 assert.doesNotMatch(rich(String.raw`\(\href{javascript:alert(1)}{x}\)`),/href="javascript:/);
 assert.doesNotMatch(rich(String.raw`\(\includegraphics{https://example.invalid/a.png}\)`),/<img/);
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'studytrail-html-')),store=new GradingStore(folder);
 let current=await store.create({title:'虚构公式测试 <script>bad</script>',subject:'化学',grade:'高二',expectedMax:10});
 const id=current.data.id,assetId=crypto.randomUUID(),sourceId=crypto.randomUUID();
 await fs.mkdir(path.join(folder,id,'assets'));await fs.writeFile(path.join(folder,id,'assets',assetId),PNG);
 current=await store.update(id,{baseRevision:current.revision},job=>{
  job.files=[{id:sourceId,role:'student',name:'虚构卷.png',type:'image/png',complete:true,size:PNG.length}];
  job.pages=[{id:assetId,sourceId,role:'student',pageNumber:1,name:'page.png',type:'image/png',width:1200,height:1600,size:PNG.length}];
  job.result=G.validateResult({schemaVersion:G.SCHEMA,reviewedPageIds:[assetId],questions:[question(assetId)],knowledgeSummary:[{topic:'分数',summary:String.raw`公式 \(a/b\)`,commonMistakes:['误加分母'],practice:['通分练习']}],overallFeedback:'练习后复做。'},job.pages);
 });
 const html=await createAnswersHtml(current.data,{loadAsset:async()=>PNG,scoreRevision:current.data.scoreRevision});
 assert.match(html,/<mfrac>/);assert.match(html,/KaTeX 0\.19\.0/);assert.match(html,/data:font\/woff2;base64,/);assert.match(html,/data:image\/png;base64,/);
 assert.doesNotMatch(html,/url\((?!data:)/);assert.doesNotMatch(html,/(?:src|href)="https?:/);
 assert.doesNotMatch(html,/<script>globalThis\.unsafe/);assert.match(html,/&lt;script&gt;globalThis\.unsafe/);assert.match(html,/&lt;img src=x/);
 assert.match(html,/id="question-0"/);assert.match(html,/id="scores"/);assert.match(html,/id="knowledge"/);assert.match(html,/id="source-/);assert.match(html,/@media print/);
 // Exercise the actual exported controls with a DOM adapter: printing waits for
 // fonts, expands hidden answers/sources, then restores the reader's choices.
 const details=[{open:true},{open:false},{open:false}],buttons={expand:{},collapse:{},print:{}},events={},printed=[];
 const script=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
 const document={querySelectorAll:s=>s==='details'?details:details.slice(0,2),getElementById:id=>buttons[id],fonts:{ready:Promise.resolve()}};
 const window={addEventListener:(name,fn)=>events[name]=fn,print:()=>{events.beforeprint();printed.push(details.map(d=>d.open));events.afterprint();}};
 vm.runInNewContext(script,{document,window,location:{search:''},URLSearchParams});
 buttons.collapse.onclick();assert.deepEqual(details.map(d=>d.open),[false,false,false]);
 await buttons.print.onclick();assert.deepEqual(printed,[[true,true,true]]);assert.deepEqual(details.map(d=>d.open),[false,false,false]);
 buttons.expand.onclick();assert.deepEqual(details.map(d=>d.open),[true,true,true]);
 assert.ok(Buffer.byteLength(html)<1024*1024,'small report does not rasterize text into page images');
 const originalScore=G.summarize(current.data).score,service=createGradingService({store,origins:['http://local.test']}),server=http.createServer(service);
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base='http://127.0.0.1:'+server.address().port+'/api/grading/jobs/'+id;
  const post=(route,body,origin='http://local.test')=>fetch(base+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await fetch(base+'/exports/answers-html')).status,404);
  assert.equal((await post('/exports/answers-html',{baseRevision:current.revision-1})).status,409);
  assert.equal((await post('/exports/answers-html',{baseRevision:current.revision},'https://other.test')).status,403);
  assert.equal((await post('/exports/answers-html',{baseRevision:current.revision,html:'<script>untrusted payload</script>'})).status,201);
  let r=await fetch(base+'/exports/answers-html');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/html/);assert.match(r.headers.get('content-disposition'),/^inline;/);assert.match(r.headers.get('content-security-policy'),/sandbox/);
  const bytes=Buffer.from(await r.arrayBuffer());assert.ok(!bytes.includes(Buffer.from('<script>untrusted payload')));
  r=await fetch(base+'/exports/answers-html?download=1');assert.match(r.headers.get('content-disposition'),/^attachment;/);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);
  let status=await (await fetch(base+'/exports')).json();assert.equal(status.files['answers-html'],true);assert.equal(status.files.marked,false);assert.equal(status.files.answers,false);
  assert.equal((await store.get(id)).revision,current.revision,'export does not mutate score revision');assert.equal(G.summarize((await store.get(id)).data).score,originalScore);
  let changed=await store.update(id,{baseRevision:current.revision},job=>{job.deletedAt=new Date().toISOString();},{preserveScoreRevision:true});
  assert.equal((await fetch(base+'/exports/answers-html')).status,404);
  current=await store.update(id,{baseRevision:changed.revision},job=>{delete job.deletedAt;},{includeDeleted:true,preserveScoreRevision:true});
  assert.deepEqual(Buffer.from(await (await fetch(base+'/exports/answers-html')).arrayBuffer()),bytes,'restore keeps original HTML');
  const cachedFile=path.join(folder,id,'exports',current.data.scoreRevision+'-'+HTML_RENDERER+'-answers.html');
  changed=await store.update(id,{baseRevision:current.revision},job=>{job.reviews.q1={score:8,maxScore:10,note:'虚构复核',studentAnswer:'5/6'};});
  status=await (await fetch(base+'/exports')).json();assert.equal(status.files['answers-html'],false);assert.equal((await fetch(base+'/exports/answers-html')).status,404);
  assert.deepEqual(await fs.readFile(cachedFile),bytes,'previous report remains immutable after score change');
  assert.equal((await post('/exports/answers-html',{baseRevision:changed.revision})).status,201);
  assert.match(await (await fetch(base+'/exports/answers-html')).text(),/8\/10/);
  await fs.rm(path.join(folder,id,'assets',assetId));
  assert.equal((await post('/exports/answers-html',{baseRevision:changed.revision})).status,422,'missing source does not replace valid cached report');
  assert.equal((await fetch(base+'/exports/answers-html')).status,200);
  console.log('PASS: offline HTML, embedded fonts/images, LaTeX/mhchem, escaped untrusted content, formula fallbacks, navigation, print expansion/font wait/restore, versioning, independent export, stale writes, restore and missing-source recovery.');
 }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(folder,{recursive:true,force:true});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
