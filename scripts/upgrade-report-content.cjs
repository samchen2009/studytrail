'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp');
const {renderTex,group}=require('../api/tex-content'),{enhancePaper,VERSION}=require('../api/document-image');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
async function upgrade(root,configs){
 const results=[];
 for(const cfg of configs){
  if(!/^[a-f0-9-]{36}$/.test(cfg.id))throw Error('Invalid attachment ID');
  const dir=path.join(root,'attachments',cfg.id,'html-report'),file=path.join(dir,'manifest.json'),report=JSON.parse(await fs.readFile(file,'utf8'));
  // Snapshot manifests before the first upgrade; originals and previous assets stay recoverable.
  try{await fs.copyFile(file,path.join(dir,'manifest-before-source-upgrade.json'),require('node:fs').constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}
  const save=async(bytes,name,extra={})=>{const hash=digest(bytes),info=await sharp(bytes).metadata();await fs.writeFile(path.join(dir,'assets',hash+'.jpg'),bytes);return {hash,name,type:'image/jpeg',width:info.width,height:info.height,size:bytes.length,...extra};};
  const enhance=async a=>{
   if(a.toneVersion===VERSION)return a;
   const originalHash=a.originalHash||a.hash,bytes=await fs.readFile(path.join(dir,'assets',originalHash+'.jpg')),enhanced=await enhancePaper(bytes);
   const value=await save(enhanced.bytes,a.name);return {...a,...value,originalHash,toneVersion:VERSION};
  };
  for(const q of report.questions)q.images=await Promise.all(q.images.map(enhance));
  let formulas=0;
  if(cfg.texPath){
   const sourceFile=path.resolve(cfg.texPath),source=await fs.readFile(sourceFile,'utf8'),body=source.split('\\begin{document}')[1]?.split('\\end{document}')[0];if(!body)throw Error('Missing TeX document body');
   const starts=[];for(const match of body.matchAll(/\\question(?=\{)/g)){const n=group(body,match.index+9),title=group(body,n.end);starts.push({number:n.value.replace(/^([一二三四五])(?=\d)/,'$1.'),title:title.value,start:match.index,end:title.end});}
   if(JSON.stringify(starts.map(x=>x.number).sort())!==JSON.stringify(report.questions.map(q=>q.number).sort()))throw Error('TeX question coverage mismatch');
   const last=starts.at(-1),endQuestions=body.indexOf('\\memo{',last.end);if(endQuestions<0)throw Error('Missing knowledge boundary');
   report.texAssets={};
   for(const match of body.matchAll(/\\(?:includegraphics|orig|original)(?:\[[^\]]*\])?\{([^}]+)\}/g)){
    const name=match[1];if(report.texAssets[name])continue;
    const sourceImage=path.resolve(path.dirname(sourceFile),name);if(!sourceImage.startsWith(path.dirname(sourceFile)+path.sep))throw Error('TeX image outside source directory');
    const bytes=await sharp(await fs.readFile(sourceImage)).flatten({background:'#fff'}).jpeg({quality:95,chromaSubsampling:'4:4:4'}).toBuffer();
    let asset=await save(bytes,path.basename(name));if(/(?:question|common)-/.test(name))asset=await enhance(asset);report.texAssets[name]=asset;
   }
   const assets=Object.fromEntries(Object.entries(report.texAssets).map(([name,a])=>[name,{...a,url:'/api/attachments/'+cfg.id+'/report-assets/'+a.hash+'.jpg'}]));
   for(let i=0;i<starts.length;i++){
    const part=starts[i],q=report.questions.find(q=>q.number===part.number);let tex=body.slice(part.end,i+1<starts.length?starts[i+1].start:endQuestions);
    // The report already displays its independent original question images immediately above.
    tex=tex.replace(/\\step\{原题、完整选项与原图\}[\s\S]*?(?=\\step\{)/,'');
    const rendered=renderTex(tex,{assets});q.explanationTex=tex;q.answer=rendered.text;q.title='第 '+q.number+' 题：'+part.title;formulas+=rendered.formulas.length;
   }
   report.introTex=body.slice(0,starts[0].start);report.supplementTex=body.slice(endQuestions);
   formulas+=renderTex(report.introTex,{assets}).formulas.length+renderTex(report.supplementTex,{assets}).formulas.length;
   report.texSource={name:path.basename(sourceFile),sha256:digest(source),formulaCount:formulas};await fs.mkdir(path.join(dir,'source'),{recursive:true});await fs.writeFile(path.join(dir,'source','report.tex'),source,{mode:0o600});
  }
  await fs.writeFile(file+'.tmp',JSON.stringify(report),{mode:0o600});await fs.rename(file+'.tmp',file);
  results.push({id:cfg.id,questions:report.questions.length,tex:Boolean(report.texSource),formulas,tone:VERSION});
 }
 return results;
}
module.exports={upgrade};
if(require.main===module)(async()=>{const {values}=require('node:util').parseArgs({options:{'data-dir':{type:'string'},config:{type:'string'}}});if(!values['data-dir']||!values.config)throw Error('Specify --data-dir and --config');console.log(JSON.stringify(await upgrade(path.resolve(values['data-dir']),JSON.parse(await fs.readFile(values.config,'utf8')))));})().catch(e=>{console.error(e);process.exitCode=1;});
