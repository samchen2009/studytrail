'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {LocalJsonStore}=require('./store'),G=require('./grading-core');
const {GradingRuns}=require('./grading-runs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const TYPES={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
const PDF_RENDERER='annotations-v2';
const {createAnswersHtml,HTML_RENDERER,REPORT_CSP,ONLINE_REPORT_CSP}=require('./grading-html');
function fail(status,message){return Object.assign(Error(message),{status});}
function signature(b){if(b.subarray(0,5).toString()==='%PDF-')return 'application/pdf';if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')return 'image/webp';return '';}
async function body(req,max){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw fail(413,'内容过大，请分批上传或提交。');chunks.push(chunk);}return Buffer.concat(chunks);}
async function json(req,max=4*1024*1024){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw fail(415,'仅接受 JSON。');try{return JSON.parse((await body(req,max)).toString());}catch(e){if(e.status)throw e;throw fail(400,'JSON 格式无效。');}}
function bounded(value,label,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw fail(422,label+'无效。');return value.trim();}
class GradingStore{
 constructor(directory){this.directory=directory;this.onSaved=null;this.questionTasks=new Map();}
 async questionAssets(job){const key=job.id+':'+(job.scoreRevision||0);if(!this.questionTasks.has(key)){const task=require('./question-assets').ensureQuestionAssets(this,job).finally(()=>this.questionTasks.delete(key));this.questionTasks.set(key,task);}return this.questionTasks.get(key);}
 async questionAsset(jobId,asset){return fs.readFile(path.join(this.folder(jobId),'question-assets',asset.hash+'.jpg'));}
 folder(id){if(!UUID.test(id))throw fail(404,'批改任务不存在。');return path.join(this.directory,id);}
 store(id){return new LocalJsonStore(this.folder(id));}
 async get(id,{includeDeleted=false}={}){const value=await this.store(id).latest();if(!value)throw fail(404,'批改任务不存在。');if(value.data.deletedAt&&!includeDeleted)throw fail(404,'这份试卷已删除，请先在“已删除试卷”中恢复。');return value;}
 async list({includeDeleted=false}={}){await fs.mkdir(this.directory,{recursive:true});const ids=(await fs.readdir(this.directory)).filter(id=>UUID.test(id));const out=[];for(const id of ids){const envelope=await this.store(id).latest();if(envelope){const j=envelope.data;if(includeDeleted||!j.deletedAt)out.push({id,revision:envelope.revision,title:j.title,subject:j.subject,createdAt:j.createdAt,deletedAt:j.deletedAt||null,pages:j.pages.length,summary:G.summarize(j)});}}return out.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 async create(input){
  const subject=bounded(input.subject,'科目',20,true);if(!['语文','数学','英语','物理','化学','地理'].includes(subject))throw fail(422,'请选择有效科目。');
  const expectedMax=input.expectedMax??null;if(expectedMax!==null&&(!Number.isFinite(expectedMax)||expectedMax<=0||expectedMax>2000))throw fail(422,'试卷满分无效。');
  if(input.autoCollectMistakes!==undefined&&typeof input.autoCollectMistakes!=='boolean')throw fail(422,'自动收集选项无效。');
  const job={id:crypto.randomUUID(),title:bounded(input.title,'标题',100,true),subject,grade:bounded(input.grade||'高一','年级',30,true),instructions:bounded(input.instructions||'','批改要求',10000),expectedMax,autoCollectMistakes:input.autoCollectMistakes!==false,createdAt:new Date().toISOString(),files:[],pages:[],result:null,reviews:{}};
  return this.write(job,0,crypto.randomUUID());
 }
 async write(job,revision,requestId){
  if(Buffer.byteLength(JSON.stringify(job))>8*1024*1024)throw fail(413,'批改记录过大，请拆分试卷。');
  const value={format:'studytrail-grading-v1',revision:revision+1,requestId,updatedAt:new Date().toISOString(),data:job};
  if(!await this.store(job.id).create(value))throw fail(409,'批改任务已被更新，请重新读取后提交。');
  if(job.result&&!job.deletedAt){try{await this.questionAssets(job);}catch(error){value.questionAssetWarning='题图整理未完成，可重新生成 HTML。';}}
  if(this.onSaved&&job.result&&!job.deletedAt){try{value.mistakeSync={ok:true,...await this.onSaved(value)};}catch(error){console.error('MISTAKE_SYNC_FAILURE',error.code||'OTHER');value.mistakeSync={ok:false,message:'评分已保存，错题整理未完成，可重试。'};}}
  return value;
 }
 async update(id,input,mutate,{includeDeleted=false,preserveScoreRevision=false}={}){
  const current=await this.get(id,{includeDeleted});
  if(!Number.isSafeInteger(input.baseRevision)||current.revision!==input.baseRevision)throw fail(409,'批改任务已被更新，请先重新读取。');
  const job=structuredClone(current.data);job.scoreRevision=preserveScoreRevision?(current.data.scoreRevision??current.revision):current.revision+1;await mutate(job);return this.write(job,current.revision,crypto.randomUUID());
 }
 async upload(id,req,url){
  const before=await this.get(id),baseRevision=Number(req.headers['x-base-revision']);
  if(before.revision!==baseRevision)throw fail(409,'上传版本已过期，请刷新后重试。');
  if(before.data.result)throw fail(409,'已有批改结果，请新建任务上传其他页面。');
  const kind=url.searchParams.get('kind'),role=url.searchParams.get('role'),name=url.searchParams.get('name')||'';
  if(!['original','page'].includes(kind)||!['student','paper','reference'].includes(role)||!name||name.length>200||/[\x00-\x1f/\\]/.test(name))throw fail(422,'上传参数无效。');
  const type=TYPES[path.extname(name).toLowerCase()];if(!type||(kind==='page'&&type==='application/pdf'))throw fail(415,'支持 PDF、PNG、JPG、WebP；预览页必须是图片。');
  const bytes=await body(req,20*1024*1024);if(!bytes.length||signature(bytes)!==type)throw fail(415,'文件为空或内容与扩展名不符。');
  const asset={id:crypto.randomUUID(),kind,role,name,type,size:bytes.length};
  if(kind==='page'){
   asset.sourceId=url.searchParams.get('sourceId');asset.pageNumber=Number(url.searchParams.get('pageNumber'));
   const width=Number(url.searchParams.get('width')),height=Number(url.searchParams.get('height'));
   if(width||height){if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>8192||height>8192)throw fail(422,'预览页尺寸无效。');asset.width=width;asset.height=height;}
   const source=before.data.files.find(f=>f.id===asset.sourceId);
   if(!source||source.role!==role||!Number.isInteger(asset.pageNumber)||asset.pageNumber<1||asset.pageNumber>30)throw fail(422,'页面所属原文件或页码无效。');
   if(source.complete)throw fail(409,'该原文件已经完成分页，不能追加页面。');
   if(source.type!=='application/pdf'&&asset.pageNumber!==1)throw fail(422,'图片原文件只有一张阅读页。');
   if(before.data.pages.some(p=>p.sourceId===source.id&&p.pageNumber===asset.pageNumber))throw fail(409,'该预览页已保存。');
   if(before.data.result)throw fail(409,'任务已有批改结果，请新建任务上传其他页面。');
   if(before.data.pages.length>=30)throw fail(422,'每份任务最多 30 页。');
  }else if(before.data.files.length>=10)throw fail(422,'每份任务最多 10 个原文件。');
  if(before.data.files.reduce((sum,f)=>sum+f.size,0)+before.data.pages.reduce((sum,f)=>sum+f.size,0)+bytes.length>160*1024*1024)throw fail(413,'单份任务文件总量不能超过 160 MB。');
  const dir=path.join(this.folder(id),'assets');await fs.mkdir(dir,{recursive:true});const file=path.join(dir,asset.id);
  await fs.writeFile(file,bytes,{flag:'wx'});
  try{return await this.update(id,{baseRevision},job=>{(kind==='page'?job.pages:job.files).push(asset);});}catch(error){await fs.rm(file,{force:true});throw error;}
 }
}
function createGradingService({store,origins=[]}){
 const allowed=new Set(origins),runs=new GradingRuns(store);
 return async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  try{
   if(req.headers.origin&&!allowed.has(req.headers.origin))throw fail(403,'不允许此来源访问批改数据。');
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/api/grading/jobs'){
    if(req.method==='GET'){const all=await store.list({includeDeleted:true});return send(200,{jobs:all.filter(j=>!j.deletedAt),deletedJobs:all.filter(j=>j.deletedAt).sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt))});}
    if(req.method==='POST')return send(201,await store.create(await json(req)));
    throw fail(405,'不支持此方法。');
   }
   const match=url.pathname.match(/^\/api\/grading\/jobs\/([^/]+)(?:\/(assets|complete|result|review|files|exports|restore|positions|ai-run|reports|question-assets|questions)(?:\/([^/]+))?)?$/);if(!match)throw fail(404,'批改接口不存在。');
   const [,id,action,assetId]=match;
   if(action==='ai-run'&&!assetId){
    if(req.method==='GET')return send(200,{run:await runs.get(id)});
    if(req.method==='POST'){const input=await json(req,8*1024*1024);return send(200,{run:input.start===true?await runs.start(id,input):await runs.update(id,input)});}
    throw fail(405,'不支持此方法。');
   }
   if(!action&&req.method==='GET')return send(200,await store.get(id));
   if(action==='questions'&&!assetId&&req.method==='GET'){const current=await store.get(id);return send(200,await store.questionAssets(current.data));}
   if(action==='question-assets'&&req.method==='GET'){
    const current=await store.get(id);if(!/^[a-f0-9]{64}\.jpg$/.test(assetId||''))throw fail(404,'题图不存在。');
    const bytes=await store.questionAsset(id,{hash:assetId.slice(0,-4)}).catch(error=>{if(error.code==='ENOENT')throw fail(404,'题图不存在。');throw error;});
    res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"});res.end(bytes);return;
   }
   if(action==='reports'&&req.method==='GET'){
    if(!['marked','answers'].includes(assetId))throw fail(404,'报告不存在。');
    const current=await store.get(id),job=current.data;if(!job.result?.questions.length)throw fail(422,'尚无逐题结果。');
    const questionAssets=await store.questionAssets(job);
    const html=await createAnswersHtml(job,{scoreRevision:job.scoreRevision??current.revision,kind:assetId,online:true,questionAssets,loadAsset:p=>fs.readFile(path.join(store.folder(id),'assets',p.id))});
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':ONLINE_REPORT_CSP,'Referrer-Policy':'no-referrer'});res.end(html);return;
   }
   if(!action&&req.method==='DELETE')return send(200,await store.update(id,await json(req),job=>{job.deletedAt=new Date().toISOString();},{preserveScoreRevision:true}));
   if(action==='restore'&&!assetId&&req.method==='POST')return send(200,await store.update(id,await json(req),job=>{if(!job.deletedAt)throw fail(409,'这份试卷未删除，请重新读取列表。');delete job.deletedAt;},{includeDeleted:true,preserveScoreRevision:true}));
   if(action==='exports'){
    const current=await store.get(id),revision=current.revision,scoreRevision=current.data.scoreRevision??revision;
    const kinds=['marked','answers','answers-html','marked-html'],folder=path.join(store.folder(id),'exports');
    const exportFile=kind=>path.join(folder,scoreRevision+'-'+(kind.endsWith('-html')?HTML_RENDERER+'-'+kind.replace('-html','')+'.html':PDF_RENDERER+'-'+kind+'.pdf'));
    if(!assetId&&req.method==='GET'){
     const files={};for(const kind of kinds){try{const info=await fs.stat(exportFile(kind));files[kind]=info.isFile()&&info.size>0;}catch(error){if(error.code!=='ENOENT')throw error;files[kind]=false;}}
     return send(200,{revision,renderer:PDF_RENDERER,htmlRenderer:HTML_RENDERER,files});
    }
    if(!kinds.includes(assetId))throw fail(404,'导出类型不存在。');
    const file=exportFile(assetId);
    if(assetId.endsWith('-html')){
     if(req.method==='POST'){
      const input=await json(req);
      if(input.baseRevision!==revision)throw fail(409,'评分已更新，请重新读取后生成解答。');
      if(!current.data.result?.questions.length)throw fail(422,'尚无逐题批改结果。');
      const questionAssets=await store.questionAssets(current.data);
      const html=await createAnswersHtml(current.data,{scoreRevision,kind:assetId.replace('-html',''),questionAssets,loadQuestionAsset:asset=>store.questionAsset(id,asset),loadAsset:async asset=>{
       if(!UUID.test(asset.id))throw fail(422,'原卷页面标识无效。');
       try{return await fs.readFile(path.join(store.folder(id),'assets',asset.id));}catch(error){if(error.code==='ENOENT')throw fail(422,'原卷页面缺失，解答未生成；请恢复对应材料。');throw error;}
      }});
      if((await store.get(id)).revision!==revision)throw fail(409,'评分已更新，请重新生成解答。');
      await fs.mkdir(folder,{recursive:true});const temp=path.join(folder,crypto.randomUUID()+'.tmp');
      try{await fs.writeFile(temp,html,{flag:'wx',mode:0o600});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
      return send(201,{revision,scoreRevision,kind:assetId});
     }
     if(req.method==='GET'){
      let bytes;try{bytes=await fs.readFile(file);}catch(error){if(error.code==='ENOENT')throw fail(404,'当前评分版本的HTML解答尚未生成。');throw error;}
      const name=current.data.title+(assetId==='marked-html'?' · 批改卷':' · 详细解答')+'.html',disposition=url.searchParams.get('download')==='1'?'attachment':'inline';
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':disposition+'; filename="answers.html"; filename*=UTF-8\'\''+encodeURIComponent(name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16)),'Content-Security-Policy':REPORT_CSP,'Referrer-Policy':'no-referrer'});res.end(bytes);return;
     }
     throw fail(405,'不支持此方法。');
    }
    if(req.method==='POST'){
     if(Number(req.headers['x-base-revision'])!==revision)throw fail(409,'评分已更新，请重新读取后生成 PDF。');
     if(!current.data.result?.questions.length)throw fail(422,'尚无逐题批改结果。');
     if(!/^application\/pdf(?:;|$)/i.test(req.headers['content-type']||''))throw fail(415,'仅接受 PDF。');
     const bytes=await body(req,64*1024*1024);if(signature(bytes)!=='application/pdf'||!bytes.subarray(-1024).includes(Buffer.from('%%EOF')))throw fail(415,'PDF 内容不完整。');
     if((await store.get(id)).revision!==revision)throw fail(409,'评分已更新，请重新生成 PDF。');
     await fs.mkdir(folder,{recursive:true});const temp=path.join(folder,crypto.randomUUID()+'.tmp');
     try{await fs.writeFile(temp,bytes,{flag:'wx',mode:0o600});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
     return send(201,{revision,kind:assetId});
    }
    if(req.method==='GET'){
     let bytes;try{bytes=await fs.readFile(file);}catch(error){if(error.code==='ENOENT')throw fail(404,'当前评分版本的 PDF 尚未生成，请点击生成 PDF。');throw error;}
     const name=current.data.title+(assetId==='marked'?' · 批改卷':' · 详细解答')+'.pdf';
     res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'attachment; filename="'+assetId+'.pdf"; filename*=UTF-8\'\''+encodeURIComponent(name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16)),'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"});res.end(bytes);return;
    }
    throw fail(405,'不支持此方法。');
   }
   if(action==='assets'&&req.method==='POST')return send(201,await store.upload(id,req,url));
   if(action==='files'&&req.method==='GET'){
    const job=(await store.get(id)).data,asset=[...job.files,...job.pages].find(f=>f.id===assetId);if(!asset)throw fail(404,'文件不存在。');
    const bytes=await fs.readFile(path.join(store.folder(id),'assets',asset.id));
    res.writeHead(200,{'Content-Type':asset.type,'Content-Length':bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':(url.searchParams.has('download')?'attachment':'inline')+'; filename="paper'+path.extname(asset.name)+'"; filename*=UTF-8\'\''+encodeURIComponent(asset.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16)),'Content-Security-Policy':"default-src 'none'; frame-ancestors 'self'"});res.end(bytes);return;
   }
   if(action==='complete'&&req.method==='POST'){
    const input=await json(req);return send(200,await store.update(id,input,job=>{
     const file=job.files.find(f=>f.id===input.sourceId),pages=job.pages.filter(p=>p.sourceId===input.sourceId);
     if(!file||!Number.isInteger(input.pageCount)||input.pageCount<1||input.pageCount>30||pages.length!==input.pageCount||Array.from({length:input.pageCount},(_,i)=>i+1).some(n=>!pages.some(p=>p.pageNumber===n)))throw fail(422,'阅读页未完整生成，请重新上传整份文件。');
     file.complete=true;file.pageCount=input.pageCount;
    }));
   }
   if(action==='result'&&req.method==='POST'){
    const input=await json(req);return send(200,await store.update(id,input,job=>{
     let result;try{result=G.validateResult(input.result,job.pages);}catch(error){throw fail(422,error.message);}
     if(!result.reviewedPageIds.length)throw fail(422,'请声明本批实际读取的页面。');
     if(input.mode!==undefined&&!['merge','replace'].includes(input.mode))throw fail(422,'批改保存模式无效。');
     const previous=input.mode==='replace'?null:job.result;
     if(input.mode==='replace'){job.reviews={};job.regionOverrides={};}
     if(previous){const questions=new Map(previous.questions.map(q=>[q.id,q]));for(const q of result.questions){questions.set(q.id,q);delete job.reviews[q.id];if(job.regionOverrides)delete job.regionOverrides[q.id];}const topics=new Map(previous.knowledgeSummary.map(k=>[k.topic,k]));for(const k of result.knowledgeSummary)topics.set(k.topic,k);result={...result,reviewedPageIds:[...new Set([...previous.reviewedPageIds,...result.reviewedPageIds])],questions:[...questions.values()],knowledgeSummary:[...topics.values()],overallFeedback:result.overallFeedback||previous.overallFeedback};}
     job.result=G.validateResult(result,job.pages);
    }));
   }
   if(action==='positions'&&!assetId&&req.method==='POST'){
    const input=await json(req);return send(200,await store.update(id,input,job=>{
     const q=job.result?.questions.find(q=>q.id===input.questionId),index=input.regionIndex;
     if(!q||['__proto__','constructor','prototype'].includes(q.id)||!Number.isInteger(index)||index<0||index>=q.regions.length)throw fail(422,'请选择有效的题目位置。');
     const r=q.regions[index];job.regionOverrides??={};job.regionOverrides[q.id]??=[];
     if(input.reset===true){job.regionOverrides[q.id][index]=null;return;}
     const p=input.position;if(!p||p.pageId!==r.pageId||![p.x,p.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw fail(422,'位置必须在当前题目的原卷页面范围内。');
     job.regionOverrides[q.id][index]={pageId:r.pageId,x:p.x,y:p.y,updatedAt:new Date().toISOString()};
    }));
   }
   if(action==='review'&&req.method==='POST'){
    const input=await json(req);return send(200,await store.update(id,input,job=>{
     const q=job.result?.questions.find(q=>q.id===input.questionId);if(!q)throw fail(404,'题目不存在。');
     const {score,maxScore}=input;if(score!==null&&(!Number.isFinite(score)||score<0)||maxScore!==null&&(!Number.isFinite(maxScore)||maxScore<=0||maxScore>1000)||score!==null&&(maxScore===null||score>maxScore))throw fail(422,'人工复核的得分或满分无效。');
     const note=bounded(input.note,'复核说明',5000,true),studentAnswer=bounded(input.studentAnswer,'核对后的作答',12000);
     job.reviews[q.id]={score,maxScore,note,studentAnswer,updatedAt:new Date().toISOString()};
    }));
   }
   throw fail(405,'不支持此方法。');
  }catch(error){req.resume();if(!error.status)console.error('GRADING_FAILURE',error.code||'OTHER');if(!res.headersSent)send(error.status||503,{error:error.status?error.message:'本地批改存储暂时不可用。'});else res.destroy();}
 };
}
module.exports={GradingStore,createGradingService};
