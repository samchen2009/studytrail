'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {AttachmentStore,createAttachmentService}=require('../api/attachments');
const {LocalJsonStore}=require('../api/store');
async function run(){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'highschool-attachments-test-'));
 const grades=new LocalJsonStore(directory);
 const data=require('./fixtures/grades.cjs')(),examId=data.exams[0].id;
 await grades.create({revision:1,requestId:'attachment-test-initial',data});
 let store=new AttachmentStore(path.join(directory,'attachments'),{maxBytes:2048});
 const server=http.createServer((req,res)=>createAttachmentService({store,grades,origins:['http://local.test']})(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const pdf=Buffer.from('%PDF-1.4\nlocal test fixture\n%%EOF'),png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
 async function upload(body=pdf,parameters={},headers={}){
  return fetch(base+'/api/attachments?'+new URLSearchParams({examId,subject:'语文',kind:'paper',name:'语文试卷.pdf',...parameters}),{method:'POST',body,headers:{Origin:'http://local.test',...headers}});
 }
 const list=async (id=examId)=>(await fetch(base+'/api/attachments?'+new URLSearchParams({examId:id}))).json();
 try{
  assert.deepEqual((await list()).attachments,[]);
  let response=await upload();assert.equal(response.status,201);
  const paper=(await response.json()).attachment;
  assert.equal(paper.name,'语文试卷.pdf');assert.equal(paper.type,'application/pdf');assert.equal(paper.size,pdf.length);
  response=await upload(png,{subject:'数学',kind:'answer',name:'答题 <第一页>.PNG'});assert.equal(response.status,201);
  const answer=(await response.json()).attachment;
  assert.equal(answer.kind,'answer');assert.equal(answer.subject,'数学');
  response=await fetch(base+'/api/attachments/'+paper.id+'/content');
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');
  assert.match(response.headers.get('content-disposition'),/^inline;.*filename\*=UTF-8/);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),pdf);
  response=await fetch(base+'/api/attachments/'+answer.id+'/content?download=1');
  assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
  store=new AttachmentStore(path.join(directory,'attachments'),{maxBytes:2048});
  assert.equal((await list()).attachments.length,2,'attachments persist across store restart and another client');
  for(const [body,params,status]of [
   [pdf,{examId:'not-saved'},409],[pdf,{subject:'生物'},400],[pdf,{kind:'other'},400],
   [pdf,{name:'../exam.pdf'},400],[pdf,{name:'exam.html'},415],
   [Buffer.from('<html>fake PDF</html>'),{},415],[pdf,{name:'exam.png'},415],
   [Buffer.alloc(0),{},400],[Buffer.alloc(2049),{},413]
  ])assert.equal((await upload(body,params)).status,status,JSON.stringify(params));
  assert.equal((await upload(pdf,{}, {Origin:'https://untrusted.example'})).status,403);
  assert.equal((await fetch(base+'/api/attachments/'+encodeURIComponent('../secret')+'/content')).status,404);
  assert.equal((await fetch(base+'/api/attachments/'+paper.id+'/content',{method:'DELETE'})).status,405);
  const concurrent=await Promise.all([upload(),upload(pdf,{kind:'answer'})]);
  assert.deepEqual(concurrent.map(result=>result.status),[201,201]);
  assert.equal((await list()).attachments.length,4);
  // Chunked uploads exercise the limit without relying on Content-Length.
  const oversized=await new Promise((resolve,reject)=>{
   const req=http.request(base+'/api/attachments?'+new URLSearchParams({examId,subject:'英语',kind:'paper',name:'large.pdf'}),{method:'POST'},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
   req.on('error',reject);req.write(pdf);req.end(Buffer.alloc(2049));
  });assert.equal(oversized,413);
  assert.equal((await fs.readdir(store.directory)).some(name=>name.startsWith('.upload-')),false,'failed uploads leave no partial files');
  async function changeAttachment(id,{restore=false,recordId=examId,origin='http://local.test'}={}){
   return fetch(base+'/api/attachments/'+id+(restore?'/restore':'')+'?'+new URLSearchParams({examId:recordId}),{method:restore?'POST':'DELETE',headers:{Origin:origin}});
  }
  assert.equal((await changeAttachment(paper.id,{recordId:data.exams[1].id})).status,409,'cannot delete another exam attachment');
  assert.equal((await changeAttachment(paper.id,{origin:'https://untrusted.example'})).status,403);
  assert.equal((await changeAttachment('not-a-uuid')).status,404);
  const realSetDeleted=store.setDeleted.bind(store);
  store.setDeleted=async()=>{throw Object.assign(Error('Test disk failure'),{code:'EACCES'});};
  assert.equal((await changeAttachment(paper.id)).status,503);
  assert.equal((await fetch(base+'/api/attachments/'+paper.id+'/content')).status,200,'failed delete keeps attachment accessible');
  store.setDeleted=realSetDeleted;
  response=await changeAttachment(paper.id);assert.equal(response.status,200);
  assert.ok((await response.json()).attachment.deletedAt);
  assert.equal((await list()).attachments.length,3);
  assert.equal((await list()).deletedAttachments[0].id,paper.id);
  assert.equal((await fetch(base+'/api/attachments/'+paper.id+'/content')).status,404,'deleted files cannot be previewed');
  assert.equal((await fetch(base+'/api/attachments/'+paper.id+'/content?download=1')).status,404,'deleted files cannot be downloaded');
  assert.deepEqual(await fs.readFile(path.join(store.directory,paper.id,'file.bin')),pdf,'original bytes remain recoverable');
  assert.equal((await changeAttachment(paper.id)).status,200,'delete retry is idempotent');
  store=new AttachmentStore(path.join(directory,'attachments'),{maxBytes:2048});
  assert.equal((await list()).deletedAttachments.length,1,'delete state persists across restart');
  response=await changeAttachment(paper.id,{restore:true});assert.equal(response.status,200);
  assert.equal((await response.json()).attachment.deletedAt,undefined);
  assert.equal((await list()).attachments.length,4);assert.deepEqual((await list()).deletedAttachments,[]);
  assert.deepEqual(Buffer.from(await (await fetch(base+'/api/attachments/'+paper.id+'/content')).arrayBuffer()),pdf,'restore returns exact original bytes');
  assert.equal((await changeAttachment(paper.id,{restore:true})).status,200,'restore retry is idempotent');
  response=await changeAttachment(answer.id);assert.equal(response.status,200,'answer sheets can also be deleted');
  assert.equal((await list()).deletedAttachments[0].kind,'answer');
  assert.equal((await list()).attachments.some(item=>item.id===paper.id),true,'other attachments stay intact');
  response=await changeAttachment(answer.id,{restore:true});assert.equal(response.status,200);
  store=new AttachmentStore(path.join(directory,'attachments'),{maxBytes:2048});
  assert.equal((await list()).attachments.length,4,'restored state persists across restart');
  assert.deepEqual((await grades.latest()).data,data,'attachment operations never change grades');
  response=await upload(pdf,{kind:'solution',name:'语文参考答案.pdf'});assert.equal(response.status,201);
  const solution=(await response.json()).attachment;
  assert.equal(solution.kind,'solution');assert.equal(solution.subject,'语文');
  let threeKinds=(await list()).attachments;
  assert.deepEqual([...new Set(threeKinds.map(item=>item.kind))].sort(),['answer','paper','solution']);
  assert.equal(threeKinds.find(item=>item.id===answer.id).kind,'answer','existing answer sheets retain their original category');
  store=new AttachmentStore(path.join(directory,'attachments'),{maxBytes:2048});
  assert.equal((await list()).attachments.find(item=>item.id===solution.id).kind,'solution','reference answers persist across restart');
  for(const suffix of ['','?download=1']){
   response=await fetch(base+'/api/attachments/'+solution.id+'/content'+suffix);
   assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),pdf);
  }
  assert.equal((await changeAttachment(solution.id)).status,200);
  assert.equal((await list()).deletedAttachments[0].kind,'solution');
  assert.equal((await fetch(base+'/api/attachments/'+solution.id+'/content')).status,404);
  assert.equal((await list()).attachments.length,4,'deleting reference answers leaves papers and answer sheets intact');
  assert.equal((await changeAttachment(solution.id,{restore:true})).status,200);
  assert.equal((await list()).attachments.length,5);
  assert.equal((await list()).attachments.find(item=>item.id===solution.id).kind,'solution');
  response=await upload(pdf,{kind:'practice',name:'语文补充练习.pdf'});assert.equal(response.status,201);
  const practice=(await response.json()).attachment;
  assert.equal(practice.kind,'practice');assert.equal(practice.subject,'语文');assert.equal(practice.examId,examId);
  assert.deepEqual([...new Set((await list()).attachments.map(item=>item.kind))].sort(),['answer','paper','practice','solution']);
  store=new AttachmentStore(path.join(directory,'attachments'),{maxBytes:2048});
  assert.equal((await list()).attachments.find(item=>item.id===practice.id).kind,'practice','practice category persists across restart');
  for(const suffix of ['','?download=1']){
   response=await fetch(base+'/api/attachments/'+practice.id+'/content'+suffix);
   assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),pdf);
  }
  assert.equal((await list(data.exams[1].id)).attachments.some(item=>item.id===practice.id),false,'practice stays with its exam');
  assert.equal((await changeAttachment(practice.id)).status,200);
  assert.equal((await list()).deletedAttachments.find(item=>item.id===practice.id).kind,'practice');
  assert.equal((await fetch(base+'/api/attachments/'+practice.id+'/content')).status,404);
  assert.equal((await list()).attachments.length,5,'deleting practice leaves all existing categories intact');
  store=new AttachmentStore(path.join(directory,'attachments'),{maxBytes:2048});
  assert.equal((await list()).deletedAttachments.some(item=>item.id===practice.id),true,'practice deletion persists across restart');
  assert.equal((await changeAttachment(practice.id,{restore:true})).status,200);
  assert.equal((await list()).attachments.length,6);
  assert.deepEqual(Buffer.from(await (await fetch(base+'/api/attachments/'+practice.id+'/content')).arrayBuffer()),pdf,'practice restores original bytes');
  assert.deepEqual((await grades.latest()).data,data,'practice operations never change grades');
  await grades.create({revision:2,requestId:'attachment-test-second',data:{...data,exams:data.exams.filter(exam=>exam.id!==examId)}});
  assert.equal((await upload()).status,409,'deleted exams cannot receive more attachments');
  assert.equal((await fetch(base+'/api/attachments/'+paper.id+'/content')).status,200,'deleting grades does not destroy attachments');
  console.log('附件验证通过：试卷 / 答题卷 / 答案 / 练习四类上传、旧分类兼容、查看下载、删除恢复、重启持久化、考试隔离与文件校验。');
 }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
