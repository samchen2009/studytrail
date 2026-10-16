'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),http=require('node:http');
const {createService}=require('./api/server');
const {LocalJsonStore,CloudBaseJsonStore}=require('./api/store');
async function run(){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'studytrail-json-test-'));
 const seed=require('./tests/fixtures/grades.cjs')();
 const token='local-test-only-never-deployed';
 const hash=crypto.createHash('sha256').update(token).digest('hex');
 const store=new LocalJsonStore(folder);
 let activeStore=store,hashEnabled=hash;
 const server=http.createServer((req,res)=>createService({store:activeStore,editorHash:hashEnabled,origins:['http://device-a.test','http://device-b.test']})(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 async function request(method,body,{authorization='Bearer '+token,origin='http://device-a.test',contentType='application/json'}={}){
  const r=await fetch(url,{method,headers:{Origin:origin,'Content-Type':contentType,Authorization:authorization},...(body?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
  const result=await r.json();return {status:r.status,result,cache:r.headers.get('cache-control')};
 }
 const payload=(data,baseRevision)=>({baseRevision,requestId:crypto.randomUUID(),data});
 try{
  let r=await request('GET');assert.equal(r.status,200);assert.equal(r.result.revision,0);assert.equal(r.cache,'no-store');
  assert.equal((await request('POST',payload(seed,0),{authorization:''})).status,401);
  assert.equal((await request('POST',payload(seed,0),{origin:'http://untrusted.test'})).status,403);
  hashEnabled='';assert.equal((await request('POST',payload(seed,0))).status,503);hashEnabled=hash;
  assert.equal((await request('POST','not-json')).status,400);
  const invalid=structuredClone(seed);invalid.exams[0].scores['语文']=999;
  assert.equal((await request('POST',payload(invalid,0))).status,422);
  assert.equal((await request('POST',payload(seed,0),{contentType:'text/plain'})).status,415);
  const first=payload(seed,0);r=await request('POST',first);assert.equal(r.status,200);assert.equal(r.result.revision,1);
  assert.equal((await request('POST',first)).status,200);
  const conflictingRetry=structuredClone(first);conflictingRetry.data.targets['语文']=61;
  assert.equal((await request('POST',conflictingRetry)).status,409);
  const secondDevice=await request('GET',null,{origin:'http://device-b.test'});assert.deepEqual(secondDevice.result.data,seed);
  const nextA=structuredClone(seed),nextB=structuredClone(seed);nextA.targets['语文']=70;nextB.targets['语文']=80;
  const writes=await Promise.all([request('POST',payload(nextA,1)),request('POST',payload(nextB,1),{origin:'http://device-b.test'})]);
  assert.deepEqual(writes.map(x=>x.status).sort(),[200,409]);
  r=await request('GET');assert.equal(r.result.revision,2);assert.ok([70,80].includes(r.result.data.targets['语文']));
  assert.equal((await request('POST',payload(seed,1))).status,409);
  const prior=await fs.readFile(path.join(folder,'000000000001.json'),'utf8');assert.deepEqual(JSON.parse(prior).data,seed);
  const restarted=new LocalJsonStore(folder);assert.equal((await restarted.latest()).revision,2);
  const oralData=structuredClone(r.result.data);const e=oralData.exams[3];e.englishScope='written';e.maxima['英语']=115;e.scores['英语']=57.5;e.english={};e.englishMax={};
  for(const [name,m]of require('./api/core').breakdowns['英语'].types){e.englishMax[name]=name==='听说测试'?0:m;e.english[name]=e.englishMax[name]>0?e.englishMax[name]/2:null;}
  e.notes['英语']={tags:['答题策略'],evidence:'试验用复盘证据',action:'复查阅读错题',due:'',status:'待开始'};
  assert.equal((await request('POST',payload(oralData,2))).status,200);
  assert.deepEqual((await request('GET')).result.data,oralData);
  activeStore={latest:async()=>{throw Error('storage unavailable');}};
  assert.equal((await request('POST',payload(seed,3))).status,503);activeStore=store;
  assert.equal((await store.latest()).revision,3);
  assert.equal((await request('POST','x'.repeat(2*1024*1024+1))).status,413);
  // Validate the CloudBase adapter contract separately; this is not a live-cloud test.
  const objects=new Map();
  const bucket={setHeader(name,value){assert.equal(name,'Content-Type');assert.equal(value,'application/json');return this;},list:async()=>({data:{objects:[...objects.keys()].sort().reverse().map(name=>({name}))}}),download:async(name)=>({data:new Blob([objects.get(name)])}),createSignedUploadUrl:async(name,options)=>{assert.equal(options.upsert,false);return {data:{token:'mock-only-upload-token'}};},uploadToSignedUrl:async(name,token,body,options)=>{assert.equal(token,'mock-only-upload-token');assert.equal(options.upsert,false);if(objects.has(name))return {error:{statusCode:409}};objects.set(name,body);return {data:{path:name}};}};
  const adapter=new CloudBaseJsonStore(bucket);assert.equal(await adapter.latest(),null);
  const envelope=await store.latest();assert.equal(await adapter.create(envelope),true);assert.equal(await adapter.create(envelope),false);assert.deepEqual(await adapter.latest(),envelope);
  console.log('PASS: two independent clients, shared reads, save/restart persistence, immutable history, parallel-write conflict, stale-write rejection, idempotent retry, authentication, read-only default, CORS, size/schema validation, language fields and reviews.');
  console.log('PASS: CloudBase PG storage adapter contract (mock only; live cloud writes require separate verification).');
 }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(folder,{recursive:true,force:true});}
}
run().catch(error=>{console.error(error);process.exit(1);});
