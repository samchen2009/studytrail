(function(root){
'use strict';
const SCHEMA='studytrail.grading-result/v1';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function text(value,label,max=12000){if(typeof value!=='string'||value.length>max)throw Error(label+'须为 '+max+' 字以内的文字。');return value;}
function number(value,label,min=0,max=1000){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error(label+'超出有效范围。');return value;}
function list(value,label,max=200){if(!Array.isArray(value)||value.length>max)throw Error(label+'格式无效或过多。');return value;}
const round=value=>Math.round((value+Number.EPSILON)*100)/100;
function validateQuestionContent(input,pages){
 if(!object(input)||typeof input.complete!=='boolean')throw Error('题面完整性格式无效。');
 const map=new Map(pages.map(p=>[p.id,p]));
 const parts=list(input.parts||[],'题面截取区域',12).map(p=>{
  if(!object(p)||!map.has(p.pageId)||!['question','answer'].includes(p.role)||typeof p.clean!=='boolean'||!['full','figure'].includes(p.kind)||![0,90,180,270].includes(p.rotation??0))throw Error('题面截取区域格式无效。');
  if(p.role==='question'&&map.get(p.pageId).role==='reference')throw Error('参考答案页不能作为干净题面。');
  const rect=list(p.rect,'截题坐标',4);if(rect.length!==4)throw Error('截题坐标须为 x/y/宽/高。');
  rect.forEach(v=>number(v,'截题坐标',0,1));if(rect[2]<=0||rect[3]<=0||rect[0]+rect[2]>1.000001||rect[1]+rect[3]>1.000001)throw Error('截题范围超出原页。');
  return {pageId:p.pageId,rect:[...rect],role:p.role,clean:p.clean,kind:p.kind,rotation:p.rotation??0};
 });
 return {complete:input.complete,confidence:number(input.confidence,'题面识别置信度',0,1),parts};
}
function validateResult(input,pages){
 if(!object(input)||input.schemaVersion!==SCHEMA)throw Error('批改格式须为 '+SCHEMA+'。');
 const pageMap=new Map(pages.map(p=>[p.id,p]));
 const pageId=id=>{if(!pageMap.has(id)||pageMap.get(id).role==='reference')throw Error('题目页码不存在或指向参考答案。');return id;};
 const reviewedPageIds=[...new Set(list(input.reviewedPageIds,'已阅页码',30).map(pageId))];
 const ids=new Set(),numbers=new Set();
 const questions=list(input.questions,'题目',200).map(q=>{
  if(!object(q))throw Error('题目格式无效。');
  const id=text(q.id,'题目标识',80);if(!/^[a-zA-Z0-9_-]+$/.test(id)||['__proto__','constructor','prototype'].includes(id)||ids.has(id))throw Error('题目标识无效或重复。');ids.add(id);
  const questionNumber=text(q.number,'题号',60).trim(),normalizedNumber=questionNumber.replace(/\s/g,'');
  if(!normalizedNumber||numbers.has(normalizedNumber))throw Error('题号为空或重复；不同题组请在题号中保留组名，跨页同题合并。');numbers.add(normalizedNumber);
  const maxScore=q.maxScore===null?null:number(q.maxScore,'题目满分',0.01);
  const score=q.score===null?null:number(q.score,'题目得分');
  const scoreBasis=q.scoreBasis??(maxScore===null?'estimated':'paper');
  if(!['paper','estimated'].includes(scoreBasis))throw Error('评分依据须为 paper 或 estimated。');
  const scoringNote=text(q.scoringNote||(scoreBasis==='estimated'?'未提供原卷分值，采用每题 10 分的参考评分。':''),'评分依据说明',2000);
  if(scoreBasis==='estimated'&&!scoringNote.trim())throw Error('估算评分须说明分值分配依据。');
  if(score!==null&&(maxScore===null||score>maxScore))throw Error('得分不能超过满分；缺少满分时得分须为 null。');
  const confidence=number(q.confidence,'识别置信度',0,1);
  if(typeof q.needsReview!=='boolean')throw Error('请提供 needsReview 布尔值。');
  const regions=list(q.regions,'卷面位置',10).map(r=>{
   if(!object(r))throw Error('卷面位置格式无效。');
   return {pageId:pageId(r.pageId),x:number(r.x,'位置 x',0,1),y:number(r.y,'位置 y',0,1),anchorText:text(r.anchorText||'','定位依据',1000)};
  });
  if(!regions.length||regions.some(r=>!reviewedPageIds.includes(r.pageId)))throw Error('每道题必须标明已阅页面上的位置。');
  const methods=list(q.methods,'解法',6).map(m=>({title:text(m.title,'解法名称',120),steps:list(m.steps,'解法步骤',60).map(s=>text(s,'步骤',5000))}));
  if(!methods.length||methods.some(m=>!m.steps.length))throw Error('每道题至少提供一种有步骤的解析。');
  const rubric=list(q.rubric,'评分细则',40).map(r=>{const m=r.maxScore===null?null:number(r.maxScore,'评分点满分'),s=r.score===null?null:number(r.score,'评分点得分');if(s!==null&&(m===null||s>m))throw Error('评分点得分不能超过满分。');return {criterion:text(r.criterion,'评分点',2000),maxScore:m,score:s,evidence:text(r.evidence||'','作答证据',2000),reason:text(r.reason||'','给分理由',2000)};});
  if(score!==null&&(!rubric.length||rubric.some(r=>r.maxScore===null||r.score===null)||Math.abs(round(rubric.reduce((s,r)=>s+r.score,0))-score)>0.01||Math.abs(round(rubric.reduce((s,r)=>s+r.maxScore,0))-maxScore)>0.01))throw Error('评分细则的满分及得分合计须与本题一致。');
  let questionContent;if(q.questionContent){try{questionContent=validateQuestionContent(q.questionContent,pages);}catch{questionContent={complete:false,confidence:0,parts:[]};}}
  const diagrams=list(q.diagrams||[],'示意图',4).map(validateDiagram);
  return {id,number:questionNumber,stem:text(q.stem,'题干'),studentAnswer:text(q.studentAnswer,'识别作答'),answer:text(q.answer,'参考答案'),maxScore,score,scoreBasis,scoringNote,confidence,needsReview:q.needsReview||confidence<0.8||score===null||maxScore===null,reviewReason:text(q.reviewReason||'','待核说明',2000),feedback:text(q.feedback,'教师评语',5000),methods,rubric,knowledgePoints:list(q.knowledgePoints,'知识点',30).map(s=>text(s,'知识点',200)),regions,diagrams,...(questionContent?{questionContent}:{}),questionType:text(q.questionType||'','题型',80)};
 });
 const knowledgeSummary=list(input.knowledgeSummary||[],'知识总结',80).map(k=>({topic:text(k.topic,'主题',160),summary:text(k.summary,'知识总结',6000),commonMistakes:list(k.commonMistakes,'易错点',30).map(s=>text(s,'易错点',2000)),practice:list(k.practice,'练习建议',30).map(s=>text(s,'练习建议',2000))}));
 return {schemaVersion:SCHEMA,reviewedPageIds,questions,knowledgeSummary,overallFeedback:text(input.overallFeedback||'','总体建议',10000)};
}
function validateDiagram(d){
 if(!object(d))throw Error('示意图格式无效。');
 const shapes=list(d.shapes,'图形元素',100).map(s=>{
  if(!object(s)||!['line','polyline','circle','rect','text'].includes(s.type))throw Error('仅支持 line、polyline、circle、rect、text 图形元素。');
  const out={type:s.type,color:['ink','green','red','blue','gray'].includes(s.color)?s.color:'ink'};
  if(s.type==='polyline'){out.points=list(s.points,'折线点',150).map(p=>{if(!Array.isArray(p)||p.length!==2)throw Error('折线坐标无效。');return p.map(v=>number(v,'图形坐标',0,600));});}
  else{for(const key of s.type==='line'?['x1','y1','x2','y2']:s.type==='circle'?['cx','cy','r']:s.type==='rect'?['x','y','width','height']:['x','y'])out[key]=number(s[key],'图形坐标',0,600);}
  if(s.type==='text')out.text=text(s.text,'图形文字',200);
  return out;
 });
 return {title:text(d.title,'图名',200),description:text(d.description||'','图形说明',2000),shapes};
}
function questionState(q,review){
 const rawMax=review?review.maxScore:q.maxScore,maxScore=rawMax??10,score=review?review.score:q.score;
 const pending=review?review.score===null||review.maxScore===null:q.needsReview||q.confidence<0.8||score===null||maxScore===null;
 return {maxScore,score:pending?null:score,proposedScore:score,estimated:rawMax===null||q.scoreBasis==='estimated',status:pending?'pending':score===maxScore?'correct':score===0?'incorrect':'partial',manual:Boolean(review)};
}
function summarize(job){
 const result=job.result,questions=result?.questions||[],reviewed=new Set(result?.reviewedPageIds||[]);
 const missingPages=job.pages.filter(p=>p.role!=='reference'&&!reviewed.has(p.id)).length;
 const incompleteFiles=(job.files||[]).filter(f=>!f.complete).length;
 let score=0,maxScore=0,pendingMax=0,pending=0,unknownMax=0,estimated=0,correct=0,partial=0,incorrect=0;
 for(const q of questions){const s=questionState(q,job.reviews?.[q.id]);if(q.maxScore===null&&!job.reviews?.[q.id]?.maxScore)unknownMax++;maxScore+=s.maxScore;if(s.estimated)estimated++;if(s.status==='pending'){pending++;pendingMax+=s.maxScore;}else{score+=s.score;if(s.status==='correct')correct++;else if(s.status==='partial')partial++;else incorrect++;}}
 score=round(score);maxScore=round(maxScore);
 const maxMismatch=!estimated&&job.expectedMax!==null&&Math.abs(maxScore-job.expectedMax)>0.01;
 return {score,maxScore,upperScore:round(score+pendingMax),normalized:maxScore?round(score/maxScore*10):null,normalizedUpper:maxScore?round((score+pendingMax)/maxScore*10):null,pending,unknownMax,estimated,correct,partial,incorrect,missingPages,incompleteFiles,maxMismatch,questionCount:questions.length,complete:Boolean(questions.length)&&job.pages.some(p=>p.role==='student')&&!incompleteFiles&&!pending&&!unknownMax&&!missingPages&&!maxMismatch};
}
function scoreLabel(s){return (s.score??s.proposedScore??'待核')+'/'+s.maxScore+(s.estimated?'（估算）':'')+(s.status==='pending'&&s.proposedScore!==null?' · 待核':'');}
function scoreReport(job){const s=summarize(job),range=(a,b)=>a===b?String(a):a+'–'+b;return {...s,title:s.estimated?'估算成绩':s.complete?'总得分':'当前成绩范围',value:s.questionCount?range(s.score,s.upperScore)+'/'+s.maxScore:'等待批改',outOfTen:s.questionCount?range(s.normalized,s.normalizedUpper)+'/10':'',note:[s.estimated?'含参考分值；未标分值的题默认每题 10 分，不代表原卷官方成绩。':'按已识别的原卷分值计分。',s.pending?s.pending+' 题待核，范围下限仅计已确认得分，上限计入待核题满分。':'',s.missingPages?s.missingPages+' 页尚未批阅，当前成绩仅覆盖已识别题目。':'',s.incompleteFiles?'有文件未完成转换。':'',s.maxMismatch?'题目分值合计与设定满分不一致。':''].filter(Boolean).join(' ')};}
function rotatePoint({x,y},rotation){switch((rotation%360+360)%360){case 90:return {x:1-y,y:x};case 180:return {x:1-x,y:1-y};case 270:return {x:y,y:1-x};default:return {x,y};}}
function unrotatePoint(point,rotation){return rotatePoint(point,360-rotation);}
const statusStyle={correct:{mark:'✓',label:'全对',color:'#108341'},incorrect:{mark:'×',label:'错误',color:'#ce343e'},partial:{mark:'△',label:'部分得分',color:'#a26812'},pending:{mark:'?',label:'待核',color:'#8c661e'}};
function pageMarks(job,page){return (job.result?.questions||[]).flatMap(q=>q.regions.flatMap((r,index)=>{if(r.pageId!==page.id)return [];const override=job.regionOverrides?.[q.id]?.[index],confirmed=Boolean(override&&override.pageId===r.pageId);return [{key:q.id+':'+index,q,index,r:confirmed?override:r,confirmed,state:questionState(q,job.reviews?.[q.id])}];}));}
function annotationLayout(job,page,rotation,width,height,{labelWidth=180,labelHeight=52,gap=12,keys=null}={}){
 const items=pageMarks(job,page).filter(item=>!keys||keys.includes(item.key)).map(item=>{const p=rotatePoint(item.r,rotation);return {...item,anchorX:p.x*width,anchorY:p.y*height};}).sort((a,b)=>a.anchorY-b.anchorY||a.key.localeCompare(b.key));
 const totalHeight=Math.max(height,items.length*(labelHeight+8)),minGap=labelHeight+8;
 let last=-minGap;
 for(const item of items){item.labelX=width+gap;item.labelY=Math.max(last+minGap,Math.min(totalHeight-labelHeight,item.anchorY-labelHeight/2));last=item.labelY;}
 for(let i=items.length-1;i>=0;i--)items[i].labelY=Math.min(items[i].labelY,totalHeight-labelHeight-(items.length-1-i)*minGap);
 return {width:width+(items.length?gap+labelWidth:0),height:totalHeight,imageWidth:width,imageHeight:height,labelWidth,labelHeight,items};
}
const api={SCHEMA,validateResult,validateQuestionContent,validateDiagram,questionState,summarize,scoreLabel,scoreReport,round,rotatePoint,unrotatePoint,statusStyle,pageMarks,annotationLayout};root.GradingCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
