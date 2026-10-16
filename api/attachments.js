'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const Core=require('./core');
const MAX_FILE_BYTES=20*1024*1024;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const extensions={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
function fileType(prefix){
 if(prefix.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
 if(prefix.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(prefix.length>=3&&prefix[0]===255&&prefix[1]===216&&prefix[2]===255)return 'image/jpeg';
 if(prefix.subarray(0,4).toString()==='RIFF'&&prefix.subarray(8,12).toString()==='WEBP')return 'image/webp';
 return null;
}
function failure(status,message){return Object.assign(Error(message),{status});}
// Filenames are metadata only. All disk paths use server-generated UUIDs.
class AttachmentStore{
 constructor(directory,{maxBytes=MAX_FILE_BYTES}={}){this.directory=directory;this.maxBytes=maxBytes;}
 async metadata(id){
  if(!UUID.test(id))throw failure(404,'附件不存在。');
  try{
   const value=JSON.parse(await fs.readFile(path.join(this.directory,id,'meta.json'),'utf8'));
   if(value.id!==id||!extensions[path.extname(value.name).toLowerCase()]||/[\x00-\x1f\x7f/\\]/.test(value.name))throw Error('Invalid attachment metadata');
   try{const marker=await fs.stat(path.join(this.directory,id,'deleted'));value.deletedAt=marker.mtime.toISOString();}catch(error){if(error.code!=='ENOENT')throw error;}
   return value;
  }
  catch(error){if(error.code==='ENOENT')throw failure(404,'附件不存在。');throw error;}
 }
 async list(examId,{includeDeleted=false}={}){
  await fs.mkdir(this.directory,{recursive:true});
  const entries=await fs.readdir(this.directory);
  const items=await Promise.all(entries.filter(id=>UUID.test(id)).map(id=>this.metadata(id)));
  return items.filter(item=>item.examId===examId&&(includeDeleted||!item.deletedAt)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
 }
 async setDeleted(id,deleted){
  await this.metadata(id);
  const marker=path.join(this.directory,id,'deleted');
  if(deleted){
   // An empty marker is published atomically. Original bytes and metadata stay intact.
   try{const handle=await fs.open(marker,'wx');await handle.close();}catch(error){if(error.code!=='EEXIST')throw error;}
  }else{try{await fs.unlink(marker);}catch(error){if(error.code!=='ENOENT')throw error;}}
  return this.metadata(id);
 }
 async upload(req,input){
  const {examId,subject,kind,name}=input;
  if(!Core.subjects.includes(subject)||!['paper','answer','solution','practice'].includes(kind))throw failure(400,'请选择六科中的科目，以及试卷、答题卷、答案或练习。');
  if(!name||name.length>200||/[\x00-\x1f\x7f/\\]/.test(name))throw failure(400,'文件名称无效或过长。');
  const expectedType=extensions[path.extname(name).toLowerCase()];
  if(!expectedType)throw failure(415,'支持 PDF、JPG、PNG、WebP 文件。');
  if(Number(req.headers['content-length'])>this.maxBytes)throw failure(413,'每个附件不能超过 20 MB。');
  await fs.mkdir(this.directory,{recursive:true});
  const id=crypto.randomUUID(),temporary=path.join(this.directory,'.upload-'+id);
  await fs.mkdir(temporary);
  let handle,size=0,prefix=Buffer.alloc(0);
  try{
   handle=await fs.open(path.join(temporary,'file.bin'),'wx');
   for await(const chunk of req){
    size+=chunk.length;
    if(prefix.length<16)prefix=Buffer.concat([prefix,chunk.subarray(0,16-prefix.length)]);
    if(size<=this.maxBytes)await handle.writeFile(chunk);
   }
   await handle.close();handle=null;
   if(size>this.maxBytes)throw failure(413,'每个附件不能超过 20 MB。');
   if(!size)throw failure(400,'不能上传空文件。');
   const type=fileType(prefix);
   if(type!==expectedType)throw failure(415,'文件内容与扩展名不符，请上传有效的 PDF 或图片。');
   const metadata={id,examId,subject,kind,name,type,size,createdAt:new Date().toISOString()};
   await fs.writeFile(path.join(temporary,'meta.json'),JSON.stringify(metadata,null,2),{flag:'wx'});
   await fs.rename(temporary,path.join(this.directory,id));
   return metadata;
  }finally{if(handle)await handle.close();await fs.rm(temporary,{recursive:true,force:true});}
 }
}
function createAttachmentService({store,grades,origins=[]}){
 const allowed=new Set(origins);
 return async(req,res)=>{
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
  try{
   if(req.headers.origin&&!allowed.has(req.headers.origin))throw failure(403,'此网站不在允许的来源中。');
   if(!['GET','POST','DELETE'].includes(req.method))throw failure(405,'不支持此请求方法。');
   const url=new URL(req.url,'http://localhost');
   const match=url.pathname.match(/^\/api\/attachments\/([^/]+)\/content$/);
   if(match&&req.method!=='GET')throw failure(405,'不支持此请求方法。');
   if(match&&req.method==='GET'){
    const metadata=await store.metadata(match[1]);
    if(metadata.deletedAt)throw failure(404,'该附件已删除，可在已删除附件列表中恢复。');
    if(!Object.values(extensions).includes(metadata.type))throw failure(415,'附件格式无效。');
    const handle=await fs.open(path.join(store.directory,metadata.id,'file.bin'),'r');
    const stat=await handle.stat();
    const disposition=(url.searchParams.get('download')==='1'?'attachment':'inline')+'; filename="attachment'+path.extname(metadata.name).toLowerCase()+'"; filename*=UTF-8\'\''+encodeURIComponent(metadata.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16));
    res.writeHead(200,{'Content-Type':metadata.type,'Content-Length':stat.size,'Content-Disposition':disposition,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'self'"});
    const stream=handle.createReadStream();stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return;
   }
   const mutation=url.pathname.match(/^\/api\/attachments\/([^/]+)(\/restore)?$/);
   if(url.pathname!=='/api/attachments'&&!mutation)throw failure(404,'附件接口不存在。');
   if(mutation){
    if((mutation[2]&&req.method!=='POST')||(!mutation[2]&&req.method!=='DELETE'))throw failure(405,'不支持此请求方法。');
   }else if(req.method==='DELETE')throw failure(405,'请选择要删除的附件。');
   const examId=url.searchParams.get('examId');
   if(!examId||examId.length>200)throw failure(400,'考试编号无效。');
   const latest=await grades.latest();
   if(!latest?.data.exams.some(exam=>exam.id===examId))throw failure(409,'请先将这次考试保存到本地 JSON，再上传或读取附件。');
   if(mutation){
    const metadata=await store.metadata(mutation[1]);
    if(metadata.examId!==examId)throw failure(409,'附件不属于这次考试，请重新读取附件列表。');
    return send(200,{attachment:await store.setDeleted(metadata.id,!mutation[2])});
   }
   if(req.method==='GET'){
    const items=await store.list(examId,{includeDeleted:true});
    return send(200,{attachments:items.filter(item=>!item.deletedAt),deletedAttachments:items.filter(item=>item.deletedAt).sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt))});
   }
   const input=Object.fromEntries(url.searchParams);input.examId=examId;
   return send(201,{attachment:await store.upload(req,input)});
  }catch(error){
   req.resume();
   if(!error.status)console.error('ATTACHMENT_STORAGE_FAILURE',error.code||'OTHER');
   if(!res.headersSent)send(error.status||503,{error:error.status?error.message:'附件存储暂时不可用，请重试。'});
   else res.destroy();
  }
 };
}
module.exports={AttachmentStore,createAttachmentService,MAX_FILE_BYTES};
