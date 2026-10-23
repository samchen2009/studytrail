'use strict';
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const Core=require('./core.js');
const {LocalJsonStore,CloudBaseJsonStore}=require('./store.js');
const {AttachmentStore,createAttachmentService}=require('./attachments.js');
const MAX_BYTES=2*1024*1024;
function validEnvelope(value){
 if(!value||!Number.isSafeInteger(value.revision)||value.revision<1||value.revision>=1e12)throw Error('Invalid stored revision');
 Core.validateData(value.data);return value;
}
function digest(value){return crypto.createHash('sha256').update(value).digest();}
function createService({store,editorHash='',demo=false,origins=[],instance=null}){
 const allowedOrigins=new Set(origins);
 return async(req,res)=>{
  const origin=req.headers.origin;
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
  if(origin&&allowedOrigins.has(origin))headers['Access-Control-Allow-Origin']=origin;
  const send=(status,body)=>{res.writeHead(status,headers);res.end(JSON.stringify(body));};
  if(origin&&!allowedOrigins.has(origin))return send(403,{error:'此网站不在允许的来源中。'});
  if(req.method==='OPTIONS'){headers['Access-Control-Allow-Methods']='GET, POST, OPTIONS';headers['Access-Control-Allow-Headers']='Content-Type, Authorization';return send(204,null);}
  try{
   if(req.method==='GET'){
    const latest=await store.latest();if(latest)validEnvelope(latest);
    return send(200,{...(latest||{revision:0,data:null,updatedAt:null}),...(instance?{instanceId:instance.id,migrateLegacyDraft:instance.migrateLegacyDraft}:{})});
   }
   if(req.method!=='POST')return send(405,{error:'不支持此请求方法。'});
   if(!demo){
    if(!/^[a-f0-9]{64}$/i.test(editorHash))return send(503,{error:'保存接口尚未配置编辑口令，目前只读。'});
    const credential=String(req.headers.authorization||'').replace(/^Bearer /,'');
    if(credential.length<20||credential.length>256||!crypto.timingSafeEqual(digest(credential),Buffer.from(editorHash,'hex')))return send(401,{error:'编辑口令不正确。'});
   }
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return send(415,{error:'仅接受 JSON 数据。'});
   const chunks=[];let bytes=0;
   for await(const chunk of req){bytes+=chunk.length;if(bytes>MAX_BYTES)return send(413,{error:'记录不能超过 2 MB。'});chunks.push(chunk);}
   let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{error:'JSON 格式无效。'});}
   if(!Number.isSafeInteger(input.baseRevision)||input.baseRevision<0||input.baseRevision>=1e12-1||typeof input.requestId!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(input.requestId))return send(400,{error:'版本号或请求编号无效。'});
   try{Core.validateData(input.data);}catch(error){return send(422,{error:error.message});}
   const latest=await store.latest();if(latest)validEnvelope(latest);
   const revision=latest?.revision||0;
   const sameRequest=latest?.requestId===input.requestId;
   if(sameRequest){
    if(JSON.stringify(latest.data)!==JSON.stringify(input.data))return send(409,{error:'请求编号已用于另一份数据。',revision});
    return send(200,latest);
   }
   if(revision!==input.baseRevision)return send(409,{error:'另一台设备已更新。请先导出当前草稿，再读取最新记录进行修改。',revision});
   const envelope={format:'studytrail-json-v1',revision:revision+1,requestId:input.requestId,updatedAt:new Date().toISOString(),data:input.data};
   if(!await store.create(envelope))return send(409,{error:'另一台设备正在保存，当前草稿已保留。请读取最新记录。'});
   return send(200,envelope);
  }catch(error){
   const message=String(error?.message||'');
   const category=/signature|sign|credential|auth|permission|policy|RLS|denied/i.test(message)?'AUTH_OR_POLICY':/mime|content.?type/i.test(message)?'MIME':/body|payload|multipart|format/i.test(message)?'PAYLOAD':/time.?out/i.test(message)?'TIMEOUT':'OTHER';
   console.error('JSON_STORAGE_FAILURE',JSON.stringify({stage:error?.storageStage||'read',status:Number(error?.statusCode||error?.status)||0,category}));
   return send(503,{error:'共享存储暂时不可用（'+(error?.storageStage||'read')+'/'+(Number(error?.statusCode||error?.status)||0)+'/'+category+'），当前草稿不会被覆盖。'});
  }
 };
}
async function start(){
 const cloudRuntime=Boolean(process.env.TCB_ENV||process.env.SCF_NAMESPACE||process.env.TENCENTCLOUD_RUNENV||process.env.TENCENTCLOUD_SECRETID);
 const demo=process.env.LOCAL_JSON_DEMO==='1'&&!cloudRuntime;
 if(process.env.LOCAL_JSON_DEMO==='1'&&cloudRuntime)throw Error('Local demo mode is forbidden in a cloud runtime');
 const port=demo?Number(process.env.TRIAL_PORT||8767):9000;
 let store;
 if(demo)store=new LocalJsonStore(path.resolve(process.env.TRIAL_DATA_DIR||path.join(__dirname,'../.data')));
 else{
  if(!process.env.CLOUDBASE_ENV_ID||!process.env.GRADES_BUCKET)throw Error('Cloud mode requires CLOUDBASE_ENV_ID and GRADES_BUCKET');
  const cloudbase=require('@cloudbase/js-sdk');
  const app=cloudbase.init({env:process.env.CLOUDBASE_ENV_ID,region:'ap-shanghai'});
  store=new CloudBaseJsonStore(app.storage.from(process.env.GRADES_BUCKET));
 }
 const origins=(process.env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
 if(demo)origins.push('http://127.0.0.1:'+port,'http://localhost:'+port);
 const instance=demo?await require('./instance').localInstance(store.directory,Boolean(await store.latest())):null;
 const service=createService({store,demo,origins,instance,editorHash:process.env.EDITOR_PASSWORD_SHA256||''});
 const attachmentStore=demo?new AttachmentStore(path.join(store.directory,'attachments')):null;
 const attachments=demo?createAttachmentService({store:attachmentStore,grades:store,origins:['http://127.0.0.1:'+port,'http://localhost:'+port]}):null;
 const gradingStore=demo?new (require('./grading').GradingStore)(path.join(store.directory,'grading')):null;
 const mistakeStore=demo?new (require('./mistakes').MistakeStore)(path.join(store.directory,'mistakes'),{grading:gradingStore,attachments:attachmentStore,grades:store,instanceId:instance.id}):null;
 if(mistakeStore){await mistakeStore.init();try{await mistakeStore.reconcile();}catch(error){console.error('MISTAKE_RECONCILE_FAILURE',error.code||'OTHER');}gradingStore.onSaved=value=>mistakeStore.syncJob(value);}
 const mistakes=demo?require('./mistakes').createMistakeService({store:mistakeStore,origins}):null;
 const grading=demo?require('./grading').createGradingService({store:gradingStore,origins}):null;
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.endsWith('/api/health')&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({service:'studytrail',credentialAvailable:Boolean(process.env.CLOUDBASE_APIKEY||(process.env.TENCENTCLOUD_SECRETID&&process.env.TENCENTCLOUD_SECRETKEY)),storageBackend:demo?'local-json':'cloudbase-pg'}));return;}
  if(url.pathname.endsWith('/api/grades'))return service(req,res);
  if(demo&&(url.pathname==='/api/attachments'||url.pathname.startsWith('/api/attachments/')))return attachments(req,res);
  if(demo&&url.pathname.startsWith('/api/grading/'))return grading(req,res);
  if(demo&&url.pathname.startsWith('/api/mistakes/'))return mistakes(req,res);
  if(!demo){res.writeHead(404);res.end('Not found');return;}
  const mathAsset=url.pathname.match(/^\/vendor\/katex\/(katex\.min\.(?:js|css)|contrib\/mhchem\.min\.js|fonts\/[A-Za-z0-9_-]+\.woff2)$/);
  if(mathAsset){
   try{const body=await fs.readFile(path.join(path.dirname(require.resolve('katex')),mathAsset[1]));res.writeHead(200,{'Content-Type':mathAsset[1].endsWith('.css')?'text/css':mathAsset[1].endsWith('.woff2')?'font/woff2':'text/javascript','X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=86400'});res.end(body);}catch{res.writeHead(404);res.end('Math asset unavailable; run npm ci');}return;
  }
  const pdfAsset=url.pathname.match(/^\/vendor\/pdfjs\/(build\/(?:pdf|pdf\.worker)\.mjs|(?:cmaps|standard_fonts|wasm|iccs)\/[a-zA-Z0-9_-]+\.(?:bcmap|pfb|ttf|wasm|js|icc))$/);
  if(pdfAsset){
   try{const body=await fs.readFile(path.join(__dirname,'../node_modules/pdfjs-dist',pdfAsset[1]));const ext=path.extname(pdfAsset[1]);res.writeHead(200,{'Content-Type':['.mjs','.js'].includes(ext)?'text/javascript':ext==='.wasm'?'application/wasm':'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=86400'});res.end(body);}catch{res.writeHead(404);res.end('PDF asset unavailable; run npm ci');}return;
  }
  const names={'/cloud.html':'cloud.html','/':'index.html','/app.js':'app.js','/seed.js':'seed.js','/core.js':'core.js','/learning-core.js':'learning-core.js','/learning.js':'learning.js','/ranking.js':'ranking.js','/style.css':'style.css','/grading-tandix.mjs':'grading-tandix.mjs','/vendor/tandix/tandix.mjs':'vendor/tandix/tandix.mjs','/vendor/tandix/protocol.mjs':'vendor/tandix/protocol.mjs','/grading-core.js':'grading-core.js','/grading.js':'grading.js','/grading.css':'grading.css','/profile.js':'profile.js','/shared.js':'shared.js','/attachments.js':'attachments.js','/favicon.svg':'favicon.svg'};
  names['/grading-pdf.mjs']='grading-pdf.mjs';names['/pdf-document.mjs']='pdf-document.mjs';
  names['/grading-annotations.js']='grading-annotations.js';
  names['/math-format.js']='math-format.js';names['/grading-math.mjs']='grading-math.mjs';
  for(const file of ['mistakes.js','mistakes.css','mistake-crop.mjs','mistake-import.mjs','mistake-preparation.mjs'])names['/'+file]=file;
  const name=names[url.pathname];if(!name){res.writeHead(404);res.end();return;}
  try{const body=await fs.readFile(path.join(__dirname,'../web',name));res.writeHead(200,{'Content-Type':(name.endsWith('.js')||name.endsWith('.mjs'))?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(body);}catch{res.writeHead(500);res.end('Preview unavailable');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,demo?'127.0.0.1':'0.0.0.0',resolve);});
 console.log(demo?'本地成绩跟踪已启动：http://127.0.0.1:'+port:'JSON API listening on port 9000');
 if(demo)console.log('成绩 JSON 目录：'+store.directory);
 return server;
}
module.exports={createService,start};if(require.main===module)start().catch(()=>{console.error('JSON service could not start; check configuration.');process.exit(1);});
