'use strict';
const sharp=require('sharp');

// Work in the original uploaded page coordinates. Rotate only the extracted result.
async function crop(bytes,part){
 const image=sharp(bytes,{limitInputPixels:36_000_000,failOn:'error'}),meta=await image.metadata();
 if(!meta.width||!meta.height)throw Error('无法读取原页尺寸。');
 const [x,y,w,h]=part.rect,left=Math.floor(x*meta.width+1e-7),top=Math.floor(y*meta.height+1e-7);
 const width=Math.max(1,Math.min(meta.width-left,Math.ceil((x+w)*meta.width-1e-7)-left));
 const height=Math.max(1,Math.min(meta.height-top,Math.ceil((y+h)*meta.height-1e-7)-top));
 let result=await image.extract({left,top,width,height}).rotate(part.rotation||0).flatten({background:'#fff'}).jpeg({quality:94}).toBuffer();
 if(part.role==='question')result=(await require('./document-image').enhancePaper(result)).bytes;
 if(result.length>5*1024*1024)throw Error('截取后的题图超过 5 MB。');
 return {bytes:result,width:(part.rotation||0)%180?height:width,height:(part.rotation||0)%180?width:height};
}

// Old grading results only contain answer anchors. Keep a local cropped reference
// automatically, but never mistake it for a clean, printable question.
function referenceParts(job,q){
 return q.regions.map(region=>{
  const peers=job.result.questions.flatMap(question=>question.regions.filter(r=>r.pageId===region.pageId).map(r=>({...r,id:question.id}))).filter(r=>Math.abs(r.x-region.x)<.34);
  const above=peers.filter(r=>r.id!==q.id&&r.y<region.y-.02).sort((a,b)=>b.y-a.y)[0];
  const below=peers.filter(r=>r.id!==q.id&&r.y>region.y+.02).sort((a,b)=>a.y-b.y)[0];
  const top=Math.max(0,above?(above.y+region.y)/2:region.y-.2),bottom=Math.min(1,below?(below.y+region.y)/2:region.y+.2);
  return {pageId:region.pageId,rect:[0,top,1,Math.max(.01,bottom-top)],rotation:0,role:'question',clean:false,kind:'full'};
 });
}
module.exports={crop,referenceParts};
