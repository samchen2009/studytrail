'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http'),vm=require('node:vm'),sharp=require('sharp');
const {GradingStore,createGradingService}=require('../api/grading');
const {MistakeStore,createMistakeService}=require('../api/mistakes');
const G=require('../api/grading-core');

async function fixture(root){
 const grading=new GradingStore(path.join(root,'grading'));
 let row=await grading.create({title:'HTML 与独立题图验收（虚构）',subject:'物理',grade:'高二',autoCollectMistakes:false});
 const pageIds=[crypto.randomUUID(),crypto.randomUUID()],sourceId=crypto.randomUUID();
 await fs.mkdir(path.join(grading.folder(row.data.id),'assets'),{recursive:true});
 for(const [i,id] of pageIds.entries()){
  const svg=`<svg width="1000" height="1200" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="1200" fill="white"/><g font-family="sans-serif" fill="#203b35"><text x="60" y="100" font-size="28">Synthetic physics question — ${i?'continued':'Part 1'}</text><text x="60" y="150" font-size="24">${i?'Find the distance travelled in 4 seconds.':'An object starts from rest. Acceleration = 2 m/s².'}</text><path d="M100 450 L100 220 M100 450 L620 450 M100 450 L550 260" fill="none" stroke="#17665c" stroke-width="4"/><text x="120" y="250" font-size="24">v (m/s)</text><text x="590" y="490" font-size="24">t (s)</text><text x="60" y="900" font-size="28" fill="#b32735">Student answer: 8 m — excluded from question image</text></g></svg>`;
  await fs.writeFile(path.join(grading.folder(row.data.id),'assets',id),await sharp(Buffer.from(svg)).png().toBuffer());
 }
 const part=id=>({pageId:id,rect:[.04,.04,.9,.4],rotation:0,role:'question',clean:true,kind:'full'});
 const q={id:'q1',number:'1',stem:'物体从静止开始以 2 m/s² 匀加速运动，求 4 秒内位移（含续页图）。',studentAnswer:'8 m',answer:'16 m',methods:[{title:'位移公式',steps:['使用公式 \\(s=\\frac{1}{2}at^2\\)。','代入 a=2 m/s²、t=4 s，得到 s=16 m。']}],knowledgePoints:['匀加速直线运动'],diagrams:[],maxScore:10,score:4,confidence:1,needsReview:false,feedback:'公式中的时间需要平方。',rubric:[{criterion:'公式与计算',maxScore:10,score:4,evidence:'8 m',reason:'未计算时间平方'}],regions:[{pageId:pageIds[0],x:.2,y:.75}],questionType:'计算题',questionContent:{complete:true,confidence:.99,parts:pageIds.map(part)}};
 row=await grading.update(row.data.id,{baseRevision:row.revision},job=>{job.files=[{id:sourceId,complete:true,name:'虚构原卷.png',type:'image/png'}];job.pages=pageIds.map((id,i)=>({id,sourceId,type:'image/png',name:'synthetic-'+i+'.png',role:'student',pageNumber:i+1,width:1000,height:1200}));job.result=G.validateResult({schemaVersion:G.SCHEMA,reviewedPageIds:pageIds,questions:[q,{...q,id:'q2',number:'2',score:10,studentAnswer:'16 m',feedback:'计算正确。',rubric:[{criterion:'计算',maxScore:10,score:10}],questionContent:{...q.questionContent,parts:[part(pageIds[0])]}}],knowledgeSummary:[],overallFeedback:'复核公式与单位。'},job.pages);});
 return {grading,row};
}

async function run(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studytrail-html-'));let server;
 try{
  const {grading,row}=await fixture(root),id=row.data.id,original=await grading.get(id);
  const manifest=await grading.questionAssets(row.data);assert.equal(manifest.questions.length,2);
  assert.equal(manifest.questions[0].assets.length,2,'cross-page question keeps both files');
  assert.equal(manifest.questions[1].assets.length,1,'correct question prepared before collection too');
  assert.equal((await fs.readdir(path.join(grading.folder(id),'question-assets'))).length,2,'identical crops deduplicate');
  for(const q of manifest.questions)for(const a of q.assets){const bytes=await grading.questionAsset(id,a);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),a.hash);assert.equal((await sharp(bytes).metadata()).width,900);}
  const store=new MistakeStore(path.join(root,'mistakes'),{grading});await store.init();assert.equal(store.rows.size,0);
  const gradeService=createGradingService({store:grading,origins:['http://local.test']}),mistakeService=createMistakeService({store,origins:['http://local.test']});
  server=http.createServer((req,res)=>req.url.startsWith('/api/mistakes/')?mistakeService(req,res):gradeService(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,jobBase=base+'/api/grading/jobs/'+id;
  const post=(route,value)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://local.test'},body:JSON.stringify(value)});
  const html=await (await fetch(jobBase+'/reports/answers')).text();assert.match(html,/data-collect="q1"/);assert.match(html,/data-collect="q2"/);assert.match(html,/question-assets\/[a-f0-9]{64}\.jpg/);assert.doesNotMatch(html,/data:image/);
  for(const q of manifest.questions)for(const a of q.assets){const response=await fetch(base+a.url);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),await grading.questionAsset(id,a));}
  const marked=await (await fetch(jobBase+'/reports/marked')).text();assert.match(marked,/<title>.*批改卷<\/title>/);assert.match(marked,/<svg/);assert.doesNotMatch(marked,/方法1 ·/);assert.match(html,/方法1 ·/);
  // Run the real report button handler against the real local service.
  const button={dataset:{job:id,collect:'q1',revision:String(row.data.scoreRevision)},nextElementSibling:{textContent:'',append(){}}},calls=[];
  const script=[...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)][1][1];
  vm.runInNewContext(script,{document:{querySelectorAll:()=>[button],createElement:()=>({})},fetch:async(url,options)=>{calls.push(url);return fetch(base+url,options);},encodeURIComponent});
  await button.onclick();assert.equal(button.textContent,'已加入错题本');assert.deepEqual(calls,['/api/mistakes/collect']);assert.equal(store.rows.size,1);
  const entry=[...store.rows.values()][0];assert.equal(entry.data.answer,'16 m');assert.equal(entry.data.printReady,true);assert.deepEqual(entry.data.assets.filter(a=>a.role==='question').map(a=>a.hash),manifest.questions[0].assets.map(a=>a.hash));
  for(const a of entry.data.assets.filter(a=>a.role==='question'))assert.deepEqual(await store.asset(a),await grading.questionAsset(id,a));
  await button.onclick();assert.equal(store.rows.size,1);assert.equal((await store.get(entry.data.id)).revision,entry.revision);
  for(const kind of ['marked','answers']){
   assert.equal((await post('/api/grading/jobs/'+id+'/exports/'+kind+'-html',{baseRevision:row.revision})).status,201);
   const offline=await (await fetch(jobBase+'/exports/'+kind+'-html?download=1')).text();assert.match(offline,/data:image\/jpeg;base64/);assert.doesNotMatch(offline,/src="\/api\//);assert.doesNotMatch(offline,/data-collect=/);assert.match(offline,/window.print/);
  }
  const exports=await (await fetch(jobBase+'/exports')).json();assert.equal(exports.files.marked,false);assert.equal(exports.files.answers,false);assert.equal(exports.files['marked-html'],true);assert.equal(exports.files['answers-html'],true);
  assert.deepEqual(await grading.get(id),original,'rendering and collecting never rescore');
  const changed=await grading.update(id,{baseRevision:row.revision},job=>{job.reviews.q1={score:6,maxScore:10,note:'虚构复核',studentAnswer:'8 m'};});
  assert.equal((await post('/api/mistakes/collect',{jobId:id,questionId:'q1',scoreRevision:row.data.scoreRevision})).status,409,'old report cannot silently collect changed question');
  await grading.update(id,{baseRevision:changed.revision},job=>{job.deletedAt=new Date().toISOString();},{preserveScoreRevision:true});
  assert.equal((await fetch(jobBase+'/reports/answers')).status,404);assert.equal((await fetch(base+manifest.questions[0].assets[0].url)).status,404);
  assert.equal((await fetch(base+'/api/mistakes/assets/'+entry.data.assets.find(a=>a.role==='question').hash)).status,200,'notebook copy survives source deletion');
  console.log('PASS: HTML-first grading/answers, all-question independent images, cross-page mapping, exact file reuse, real report button, idempotency, version conflicts, offline exports, PDF opt-in and source deletion.');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
}
module.exports={fixture};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
