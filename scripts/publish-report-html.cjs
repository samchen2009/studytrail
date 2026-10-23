'use strict';
// Publish only explicitly selected and reviewed manifests; original files remain intact.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createAttachmentHtml,validateReport,reportAssets}=require('../api/attachment-html');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function publish(root,configs){
 const results=[];
 for(const config of configs){
  if(!/^[a-f0-9-]{36}$/.test(config.id))throw Error('Invalid attachment ID');
  const folder=path.join(root,'attachments',config.id),dir=path.join(folder,'html-report');
  const meta=JSON.parse(await fs.readFile(path.join(folder,'meta.json'),'utf8'));
  if(meta.type!=='application/pdf'||['paper','answer'].includes(meta.kind))throw Error('Only answer reports can be published');
  try{await fs.stat(path.join(folder,'deleted'));throw Error('Deleted attachment cannot be published');}catch(error){if(error.code!=='ENOENT')throw error;}
  const report=validateReport(JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8')),config.id);
  if(digest(await fs.readFile(path.join(folder,'file.bin')))!==report.sourceSha256)throw Error('Original report changed');
  const numbers=report.questions.map(q=>q.number).sort();
  if(JSON.stringify(numbers)!==JSON.stringify(config.expected.map(String).sort()))throw Error('Question coverage mismatch');
  for(const q of report.questions)if(!q.content.length||q.images.length+q.content.length>12)throw Error('Invalid question images');
  const assets=new Map(reportAssets(report).map(a=>[a.hash,a]));
  for(const a of assets.values())if(digest(await fs.readFile(path.join(dir,'assets',a.hash+'.jpg')))!==a.hash)throw Error('Image checksum mismatch');
  const html=await createAttachmentHtml(report,{offline:true,loadAsset:a=>fs.readFile(path.join(dir,'assets',a.hash+'.jpg'))});
  await fs.writeFile(path.join(dir,'index.html.tmp'),html,{mode:0o600});await fs.rename(path.join(dir,'index.html.tmp'),path.join(dir,'index.html'));
  await fs.writeFile(path.join(dir,'active.json.tmp'),JSON.stringify({sourceSha256:report.sourceSha256}),{mode:0o600});await fs.rename(path.join(dir,'active.json.tmp'),path.join(dir,'active.json'));
  results.push({id:config.id,questions:report.questions.length,pages:report.pageCount,htmlBytes:Buffer.byteLength(html)});
 }
 return results;
}
module.exports={publish};
if(require.main===module)(async()=>{
 const {values}=require('node:util').parseArgs({options:{'data-dir':{type:'string'},config:{type:'string'}}});
 if(!values['data-dir']||!values.config)throw Error('Usage: node scripts/publish-report-html.cjs --data-dir DATA --config CONFIG.json');
 console.log(JSON.stringify(await publish(path.resolve(values['data-dir']),JSON.parse(await fs.readFile(values.config,'utf8')))));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
