import {imagePdf} from './pdf-document.mjs';
const G=globalThis.GradingCore;
const A=globalThis.GradingAnnotations;
const C={ink:'#203b35',muted:'#536761',green:'#087b3c',red:'#ce2838',amber:'#956015',blue:'#205cac',rule:'#d8e1dc',pale:'#eff5f0'};
const FONT='Arial,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
const W=794,H=1123,M=48,SCALE=2;
const labels={correct:'全对',incorrect:'错误',partial:'部分得分',pending:'待核'};
const color=s=>G.statusStyle[s.status].color;
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
function font(ctx,size=16,bold=false){ctx.font=(bold?'bold ':'')+size+'px '+FONT;ctx.textBaseline='alphabetic';}
export function wrapText(ctx,text,maxWidth){
 const out=[];
 for(const paragraph of String(text??'').replace(/\r/g,'').split('\n')){
  let line='';
  // Unicode code points preserve surrogate pairs and mathematical symbols.
  for(const ch of paragraph){if(line&&ctx.measureText(line+ch).width>maxWidth){out.push(line);line=ch;}else line+=ch;}
  out.push(line);
 }
 return out;
}
class Book{
 constructor(title,progress){this.title=title;this.progress=progress;this.pages=[];this.newPage();}
 newPage(width=W,height=H){
  this.width=width;this.height=height;this.canvas=document.createElement('canvas');this.canvas.width=width*SCALE;this.canvas.height=height*SCALE;
  this.ctx=this.canvas.getContext('2d');this.ctx.scale(SCALE,SCALE);this.ctx.fillStyle='white';this.ctx.fillRect(0,0,width,height);
  font(this.ctx,11);this.ctx.fillStyle=C.muted;this.ctx.fillText('STUDYTRAIL  /  '+this.title.slice(0,55),M,28);this.y=62;
 }
 async endPage(){
  const ctx=this.ctx;font(ctx,11);ctx.fillStyle=C.muted;ctx.fillText('学迹 · 本机生成  |  '+(this.pages.length+1),M,this.height-22);
  const blob=await new Promise((resolve,reject)=>this.canvas.toBlob(b=>b?resolve(b):reject(Error('PDF 页面渲染失败。')),'image/jpeg',0.94));
  this.pages.push({bytes:new Uint8Array(await blob.arrayBuffer()),width:this.canvas.width,height:this.canvas.height});
  this.canvas.width=0;this.canvas.height=0;
  if(this.pages.length>500)throw Error('解析超过 500 页，请拆分试卷。');
  this.progress?.('正在排版 PDF · '+this.pages.length+' 页');await pause();
 }
 async room(height){if(this.y+height>this.height-48){await this.endPage();this.newPage();}}
 async text(text,{size=16,bold=false,fill=C.ink,indent=0,gap=9}={}){
  font(this.ctx,size,bold);const lines=wrapText(this.ctx,text,this.width-M*2-indent),lineHeight=Math.ceil(size*1.65);
  for(const line of lines){await this.room(lineHeight);font(this.ctx,size,bold);this.ctx.fillStyle=fill;this.y+=lineHeight;this.ctx.fillText(line,M+indent,this.y-6);}
  this.y+=gap;
 }
 async heading(text,level=2,fill=C.ink){await this.room(level===1?110:90);this.y+=level===1?12:16;await this.text(text,{size:level===1?28:level===2?21:17,bold:true,fill,gap:8});}
 async rule(){await this.room(20);this.ctx.strokeStyle=C.rule;this.ctx.lineWidth=1;this.ctx.beginPath();this.ctx.moveTo(M,this.y);this.ctx.lineTo(this.width-M,this.y);this.ctx.stroke();this.y+=16;}
 async finish(){await this.endPage();return imagePdf(this.pages);}
}
async function intro(book,job,title){
 const summary=G.scoreReport(job);await book.heading(title,1);await book.text(job.title,{size:22,bold:true});
 await book.text(job.grade+' · '+job.subject+' · '+job.result.questions.length+' 题',{size:14,fill:C.muted});
 await book.heading(summary.title+'  '+summary.value,2,C.green);
 if(summary.outOfTen)await book.text('折合 '+summary.outOfTen,{size:23,bold:true,fill:C.green});
 await book.text(summary.note,{size:13,fill:C.muted});
 if(job.expectedMax!==null&&summary.estimated)await book.text('用户设定原卷满分：'+job.expectedMax+'；当前参考分采用逐题估算，不直接作为该满分下的正式成绩。',{size:13,fill:C.muted});
 await book.text('全对 '+summary.correct+' 题 · 错误 '+summary.incorrect+' 题 · 部分得分 '+summary.partial+' 题 · 待核 '+summary.pending+' 题',{size:14});
 await book.rule();
}
function state(job,q){return G.questionState(q,job.reviews?.[q.id]);}
async function marked(job,fetchAsset,progress){
 const book=new Book('试卷批改',progress);await intro(book,job,'试卷批改');
 await book.text('页边标注：绿勾 = 全对；红叉 = 错误；橙色三角 = 部分得分；问号 = 待核。标注通过引线对应卷面，虚线为 AI 估计位置，实线为人工校准位置。详细推导见独立解答册。',{size:14});
 await book.heading('逐题成绩');
 for(const q of job.result.questions){const s=state(job,q);await book.text('第 '+q.number+' 题   '+labels[s.status]+'   '+G.scoreLabel(s),{size:16,bold:true,fill:color(s)});if(s.status==='pending')await book.text(q.reviewReason||'识别或评分依据需要核对。',{size:13,fill:C.muted});}
 await book.heading('教师评语');await book.text(job.result.overallFeedback||'请结合解答册复盘本卷。',{size:14});
 const pages=job.pages.filter(p=>p.role!=='reference');
 for(const p of pages){
  const response=await fetchAsset(p);if(!response.ok)throw Error('读取原卷页面失败，PDF 未生成完整。');
  const image=await createImageBitmap(await response.blob());
  try{
   const landscape=image.width>image.height,pageHeight=landscape?W:H,capacity=Math.max(1,Math.floor((pageHeight-156)/60)),items=G.pageMarks(job,p),groups=[];
   for(let i=0;i<items.length;i+=capacity)groups.push(items.slice(i,i+capacity).map(item=>item.key));if(!groups.length)groups.push([]);
   for(let group=0;group<groups.length;group++){
   await book.endPage();book.newPage(landscape?H:W,pageHeight);
   const ctx=book.ctx,sum=G.scoreReport(job);font(ctx,18,true);ctx.fillStyle=C.ink;ctx.fillText('批改卷 · '+(sum.estimated?'估算 ':'')+sum.value,M,61);
   font(ctx,11);ctx.fillStyle=C.muted;ctx.fillText('折合 '+sum.outOfTen+'  |  待核 '+sum.pending+' 题  |  '+(sum.estimated?'分值含估算':'原卷分值'),M,81);
   const gutter=items.length?134:0,fit=Math.min((book.width-48-gutter)/image.width,(book.height-156)/image.height),width=image.width*fit,height=image.height*fit,y=100;
   const layout=G.annotationLayout(job,p,0,width,height,{labelWidth:126,labelHeight:52,gap:8,keys:groups[group]}),x=(book.width-layout.width)/2;
   ctx.drawImage(image,x,y,width,height);
   ctx.save();ctx.translate(x,y);A.draw(ctx,layout);ctx.restore();
   font(ctx,11);ctx.fillStyle=C.muted;const source=job.files.find(f=>f.id===p.sourceId);ctx.fillText((source?.name||'原卷').slice(0,55)+' · 第 '+p.pageNumber+' 页'+(groups.length>1?' · 标注组 '+(group+1)+'/'+groups.length:''),M,book.height-43);
   }
  }finally{image.close();}
 }
 return book.finish();
}
async function diagram(book,d){
 const size=Math.min(480,book.width-M*2);font(book.ctx,17,true);
 await book.room(size+wrapText(book.ctx,d.title,book.width-M*2).length*29+44);
 await book.heading(d.title,3);
 const ctx=book.ctx;ctx.save();ctx.translate((book.width-size)/2,book.y);ctx.scale(size/600,size/600);ctx.strokeStyle=C.rule;ctx.lineWidth=1;ctx.strokeRect(0,0,600,600);
 for(const s of d.shapes){ctx.fillStyle=C[s.color]||C.ink;ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=2.2;ctx.beginPath();
  if(s.type==='text'){font(ctx,17);const lines=wrapText(ctx,s.text,Math.max(40,595-s.x));lines.forEach((line,i)=>ctx.fillText(line,s.x,s.y+i*23));}
  else if(s.type==='line'){ctx.moveTo(s.x1,s.y1);ctx.lineTo(s.x2,s.y2);ctx.stroke();}
  else if(s.type==='polyline'){s.points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();}
  else if(s.type==='rect')ctx.strokeRect(s.x,s.y,s.width,s.height);
  else if(s.type==='circle'){ctx.arc(s.cx,s.cy,s.r,0,Math.PI*2);ctx.stroke();}
 }
 ctx.restore();book.y+=size+12;if(d.description)await book.text(d.description,{size:13,fill:C.muted});
}
async function answers(job,progress){
 const book=new Book('详细解答',progress);await intro(book,job,'详细解答与知识点总结');
 await book.text('本册包含所有题目的正确答案、学生作答对照、评分细则、适用的多种解法和图示。待核项保留原有不确定性，请核对后再作为最终成绩。',{size:14});
 for(const q of job.result.questions){
  const s=state(job,q),review=job.reviews?.[q.id];await book.rule();await book.heading('第 '+q.number+' 题 · '+labels[s.status]+' · '+G.scoreLabel(s),2,color(s));
  if(s.estimated)await book.text('估算依据：'+(q.scoringNote||'未标分值，每题按 10 分参考评分。'),{size:13,fill:C.muted});
  for(const [title,text]of [['题干',q.stem],['学生作答',review?.studentAnswer??q.studentAnswer],['正确答案',q.answer],['教师评语',q.feedback]]){await book.heading(title,3);await book.text(text||'未识别到作答。');}
  if(s.status==='pending'){await book.heading('待核说明',3,C.amber);await book.text(q.reviewReason||'请核对作答与评分依据。',{fill:C.amber});}
  if(review)await book.text('人工复核：'+review.note,{size:14,fill:C.blue});
  if(q.rubric.length){await book.heading('评分细则',3);for(const r of q.rubric){await book.text((r.score??'待核')+'/'+(r.maxScore??'未定')+'  '+r.criterion,{size:14});if(r.evidence)await book.text('作答证据：'+r.evidence,{size:13,fill:C.muted});if(r.reason)await book.text('给分理由：'+r.reason,{size:13,fill:C.muted});}}
  for(let i=0;i<q.methods.length;i++){const m=q.methods[i];await book.heading('方法 '+(i+1)+' · '+m.title,3);for(let k=0;k<m.steps.length;k++)await book.text((k+1)+'. '+m.steps[k],{indent:12});}
  for(const d of q.diagrams)await diagram(book,d);
  if(q.knowledgePoints.length)await book.text('知识点：'+q.knowledgePoints.join(' · '),{size:14,bold:true,fill:C.blue});
 }
 await book.rule();await book.heading('知识点总结',1);
 for(const k of job.result.knowledgeSummary){await book.heading(k.topic);await book.text(k.summary);for(const [title,items]of [['易错点',k.commonMistakes],['巩固建议',k.practice]]){if(items.length)await book.heading(title,3);for(const t of items)await book.text('• '+t);}}
 await book.heading('整卷复盘建议');await book.text(job.result.overallFeedback||'结合错题与待核项逐项复盘。');return book.finish();
}
export async function createGradingPdf(job,kind,{fetchAsset,onProgress}={}){
 if(!job.result?.questions.length)throw Error('尚无逐题批改结果，请先完成批改。');
 if(!['marked','answers'].includes(kind))throw Error('未知 PDF 类型。');
 if(document.fonts?.ready)await document.fonts.ready;
 return kind==='marked'?marked(job,fetchAsset,onProgress):answers(job,onProgress);
}
