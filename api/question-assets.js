'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {crop,referenceParts}=require('./mistake-images');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const VERSION=1;
async function atomic(file,bytes){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,bytes,{mode:0o600});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}}

// Derived question images are independent of reports and of notebook membership.
// Keep the source crop coordinates and a versioned manifest; never alter scores.
async function ensureQuestionAssets(store,job){
 const folder=store.folder(job.id),revision=job.scoreRevision||0;
 const fingerprint=hash(JSON.stringify({version:VERSION,tone:require('./document-image').VERSION,questions:job.result?.questions,pages:job.pages}));
 const manifestPath=path.join(folder,'questions',revision+'-v'+VERSION+'.json');
 try{const cached=JSON.parse(await fs.readFile(manifestPath,'utf8'));if(cached.fingerprint===fingerprint&&!cached.questions.some(q=>q.warning)){await Promise.all(cached.questions.flatMap(q=>q.assets.map(a=>fs.access(path.join(folder,'question-assets',a.hash+'.jpg')))));return cached;}}catch(error){if(error.code!=='ENOENT')throw error;}
 const questions=[];
 for(const q of job.result?.questions||[]){
  const content=q.questionContent||{complete:false,confidence:0,parts:referenceParts(job,q)},assets=[];let warning='';
  for(const part of content.parts){
   try{
    const page=job.pages.find(p=>p.id===part.pageId);if(!page)throw Error('missing page');
    const image=await crop(await fs.readFile(path.join(folder,'assets',page.id)),part),digest=hash(image.bytes);
    const file=path.join(folder,'question-assets',digest+'.jpg');
    await fs.mkdir(path.dirname(file),{recursive:true});try{await fs.writeFile(file,image.bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
    assets.push({hash:digest,type:'image/jpeg',name:(part.role==='question'?'原题':'作答')+' · 第 '+page.pageNumber+' 页',role:part.role==='question'&&!part.clean?'source':part.role,pageId:page.id,pageNumber:page.pageNumber,cropped:true,clean:part.clean,kind:part.kind,width:image.width,height:image.height,size:image.bytes.length,origin:{pageNumber:page.pageNumber,rotation:part.rotation,rect:part.rect},url:'/api/grading/jobs/'+job.id+'/question-assets/'+digest+'.jpg'});
   }catch(error){warning='部分题图尚未截取成功，可重新生成；原题文字与评分已保留。';}
  }
  const printReady=q.questionContent?content.complete&&content.confidence>=.8&&!warning&&!content.parts.some(p=>p.role==='question'&&!p.clean):Boolean(q.stem.trim())&&!/图|表|材料|原文|短文|passage|diagram|figure|graph|table|reading/i.test(q.stem);
  questions.push({questionId:q.id,assets,warning,printReady,questionFormat:assets.some(a=>a.role==='question'&&a.kind==='full')?'image':'text'});
 }
 const manifest={schemaVersion:VERSION,scoreRevision:revision,fingerprint,questions};await atomic(manifestPath,JSON.stringify(manifest));return manifest;
}
module.exports={ensureQuestionAssets};
