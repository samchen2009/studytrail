'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const filename=revision=>String(revision).padStart(12,'0')+'.json';
const isVersion=name=>/^\d{12}\.json$/.test(name);
class LocalJsonStore {
 constructor(directory){this.directory=directory;}
 async latest(){
  await fs.mkdir(this.directory,{recursive:true});
  const names=(await fs.readdir(this.directory)).filter(isVersion).sort().reverse();
  return names.length?JSON.parse(await fs.readFile(path.join(this.directory,names[0]),'utf8')):null;
 }
 async create(envelope){
  // Complete the file before atomically publishing it. A concurrent writer cannot overwrite it.
  await fs.mkdir(this.directory,{recursive:true});
  const temporary=path.join(this.directory,'.'+envelope.requestId+'.tmp');
  await fs.writeFile(temporary,JSON.stringify(envelope),{flag:'wx'});
  try{await fs.link(temporary,path.join(this.directory,filename(envelope.revision)));}
  catch(error){if(error.code==='EEXIST')return false;throw error;}
  finally{await fs.unlink(temporary);}
  return true;
 }
}
class CloudBaseJsonStore {
 constructor(bucket){this.bucket=bucket.setHeader('Content-Type','application/json');}
 async latest(){
  const {data,error}=await this.bucket.list('revisions/',{limit:1,withDelimiter:false,sortBy:{column:'name',order:'desc'}},{cache:'no-store'});
  if(error){error.storageStage='list';throw error;}
  if(!Array.isArray(data?.objects))throw Object.assign(Error('SDK list response is invalid'),{storageStage:'list'});
  const object=data?.objects?.[0];if(!object)return null;
  const name=object.name;if(!/^revisions\/\d{12}\.json$/.test(name))throw Error('Invalid revision object');
  const result=await this.bucket.download(name,{cacheNonce:String(Date.now())},{cache:'no-store'});
  if(result.error){result.error.storageStage='download';throw result.error;}
  return JSON.parse(await result.data.text());
 }
 async create(envelope){
  // Keep signing JSON metadata separate from file bytes in the Node.js runtime.
  // The temporary upload token stays in this service and is never returned to the browser.
  const name='revisions/'+filename(envelope.revision);
  let signed;
  try{signed=await this.bucket.createSignedUploadUrl(name,{upsert:false});}
  catch(error){error.storageStage='sign';throw error;}
  if(signed.error){
   if(String(signed.error.statusCode)==='409'||/already exists|duplicate|resource.?exists|已存在/i.test(signed.error.message||''))return false;
   signed.error.storageStage='sign';throw signed.error;
  }
  if(typeof signed.data?.token!=='string'||!signed.data.token)throw Object.assign(Error('Invalid signed upload response'),{storageStage:'sign'});
  let result;
  try{result=await this.bucket.uploadToSignedUrl(name,signed.data.token,JSON.stringify(envelope),{contentType:'application/json',cacheControl:'0',upsert:false});}
  catch(error){error.storageStage='upload';throw error;}
  if(!result.error){
   if(result.data?.path!==name)throw Object.assign(Error('Invalid upload response'),{storageStage:'upload'});
   return true;
  }
  if(String(result.error.statusCode)==='409'||/already exists|duplicate|resource.?exists|已存在/i.test(result.error.message||''))return false;
  result.error.storageStage='upload';throw result.error;
 }
}
module.exports={LocalJsonStore,CloudBaseJsonStore};
