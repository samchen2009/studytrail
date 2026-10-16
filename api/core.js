(function(root){
'use strict';
const subjects=['语文','数学','英语','物理','化学','地理'];
const defaults=Object.fromEntries(subjects.map((s,i)=>[s,i<3?150:100]));
const breakdowns={
 '语文':{key:'chinese',maxKey:'chineseMax',types:[['默写',5],['语言运用',5],['现代文阅读一',16],['现代文阅读二',17],['古诗鉴赏',7],['文言文阅读一',19],['文言文阅读二',11],['写作',70]]},
 '数学':{key:'math',maxKey:'mathMax',types:[['填空',54],['选择',16],['大题',80]]},
 '英语':{key:'english',maxKey:'englishMax',types:[['语法填空',10],['选词填空',10],['完形填空',15],['阅读选择',22],['六选四',8],['概要写作',10],['中译英',15],['书面表达',25],['听说测试',35],['校内听力',0]]}
};
const present=v=>typeof v==='number'&&Number.isFinite(v);
const sorted=exams=>[...exams].sort((a,b)=>a.order-b.order);
const rankGrades=['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','E+','E','E-','F'];
function parseRank(value){
 const raw=typeof value==='string'?value.trim():present(value)?String(value):'';
 const result={raw,percent:null,position:null,grade:null,normalized:false};
 if(!raw)return result;
 const text=raw.replace(/％/g,'%').toUpperCase();
 const percent=text.match(/^(\d+(?:\.\d+)?)%+(?:\s*([A-F][+-]?))?$/);
 if(percent){const n=Number(percent[1]);if(n<=100){result.percent=n;result.grade=rankGrades.includes(percent[2])?percent[2]:null;result.normalized=/%{2,}|％/.test(raw);}return result;}
 const position=text.match(/^第?\s*(\d+)\s*名$/);
 if(position){const n=Number(position[1]);if(Number.isSafeInteger(n)&&n>=1)result.position=n;return result;}
 if(/^\d+(?:\.\d+)?$/.test(text)){const n=Number(text);if(n>=0&&n<=1)result.percent=n*100;else if(Number.isSafeInteger(n)&&n>1)result.position=n;return result;}
 if(rankGrades.includes(text))result.grade=text;
 return result;
}
function rankValue(exam,subject,kind='percent'){return parseRank(exam.ranks?.[subject])[kind]??null;}
function rankChange(exam,prior,subject,kind='percent'){
 const current=rankValue(exam,subject,kind),previous=prior?rankValue(prior,subject,kind):null;
 if(current===null||previous===null)return null;
 return kind==='grade'?rankGrades.indexOf(previous)-rankGrades.indexOf(current):previous-current;
}
function aggregate(e,keys=subjects,mode='raw'){
 const values=(mode==='equivalent'?e.equivalent:e.scores)||{};
 const complete=keys.every(k=>present(values[k]));
 const known=keys.filter(k=>present(values[k]));
 return {complete,sum:known.reduce((v,k)=>v+values[k],0),max:mode==='raw'?known.reduce((v,k)=>v+e.maxima[k],0):null,count:known.length,rate:mode==='raw'&&complete?keys.reduce((v,k)=>v+values[k],0)/keys.reduce((v,k)=>v+e.maxima[k],0)*100:null};
}
function subjectRate(e,s){return present(e.scores[s])?e.scores[s]/e.maxima[s]*100:null;}
function change(a,b,s){const x=subjectRate(a,s),y=b?subjectRate(b,s):null;return x===null||y===null?null:x-y;}
function typeRate(e,s,t){const c=breakdowns[s],v=e?.[c.key]?.[t],m=e?.[c.maxKey]?.[t];return present(v)&&present(m)&&m>0?v/m*100:null;}
function breakdownSummary(e,s){
 const c=breakdowns[s],active=c.types.filter(([t,m])=>(e[c.maxKey]?.[t]??m)>0),known=active.filter(([t])=>present(e[c.key]?.[t]));
 return {active,known,count:known.length,complete:active.length>0&&known.length===active.length,sum:known.reduce((n,[t])=>n+e[c.key][t],0),max:active.reduce((n,[t,m])=>n+(e[c.maxKey]?.[t]??m),0)};
}
function validateBreakdown(e,s){
 const c=breakdowns[s],scores=e[c.key],maxima=e[c.maxKey];
 for(const value of [scores,maxima])if(value!==undefined&&value!==null&&(typeof value!=='object'||Array.isArray(value)))throw Error(s+'题型记录格式无效。');
 for(const [t] of c.types){const v=scores?.[t],m=maxima?.[t];
  if(m!==null&&m!==undefined&&(!present(m)||m<0||m>1000))throw Error(s+' '+t+'题型满分无效。');
  if(v!==null&&v!==undefined&&(!present(v)||!present(m)||m<=0||v<0||v>m))throw Error(s+' '+t+'得分须介于 0 与题型满分之间；不考的题型请留空。');
 }
 const b=breakdownSummary(e,s);
 if(present(e.scores[s])&&b.sum>e.scores[s]+0.001)throw Error(s+'已录入题型得分之和不能超过科目总分。');
 if(b.complete){if(!present(e.scores[s])||Math.abs(b.sum-e.scores[s])>0.001)throw Error(s+'题型得分之和须等于'+s+'分数。');if(Math.abs(b.max-e.maxima[s])>0.001)throw Error(s+'题型满分之和须等于'+s+'满分。');}
}
function validateExam(e){
 if(!e||typeof e.name!=='string'||!e.name.trim()||e.name.length>60)throw Error('请填写考试名称（最多 60 字）。');
 if(!['高一','高二','高三'].includes(e.grade))throw Error('年级无效。');
 if(!Number.isInteger(e.order)||e.order<1)throw Error('考试顺序须为正整数。');
 if(e.date&&!/^\d{4}-\d{2}-\d{2}$/.test(e.date))throw Error('考试日期格式无效。');
 let known=0;
 for(const s of subjects){if(!present(e.maxima?.[s])||e.maxima[s]<=0||e.maxima[s]>1000)throw Error(s+'满分须大于 0 且不超过 1000。');const v=e.scores?.[s];if(v!==null&&v!==undefined){if(!present(v)||v<0||v>e.maxima[s])throw Error(s+'分数须介于 0 与满分之间。');known++;}const q=e.equivalent?.[s];if(q!==null&&q!==undefined&&(!present(q)||q<0||q>1000))throw Error(s+'等价分无效。');}
 if(!known)throw Error('请至少录入一科原始分数。');
 const types=['填空','选择','大题'];
 for(const t of types){const v=e.math?.[t];if(v!==null&&v!==undefined&&(!present(v)||!present(e.mathMax?.[t])||e.mathMax[t]<=0||e.mathMax[t]>1000||v<0||v>e.mathMax[t]))throw Error(t+'题型分数或满分无效。');if(e.mathMax?.[t]!==null&&e.mathMax?.[t]!==undefined&&(!present(e.mathMax[t])||e.mathMax[t]<=0||e.mathMax[t]>1000))throw Error(t+'题型满分无效。');}
 if(types.every(t=>present(e.math?.[t]))){if(!present(e.scores['数学'])||Math.abs(types.reduce((v,t)=>v+e.math[t],0)-e.scores['数学'])>0.001)throw Error('数学题型得分之和须等于数学分数。');if(Math.abs(types.reduce((v,t)=>v+e.mathMax[t],0)-e.maxima['数学'])>0.001)throw Error('数学题型满分之和须等于数学满分。');}
 for(const s of ['语文','英语'])validateBreakdown(e,s);
 if(e.englishScope!==undefined&&!['custom','full','written'].includes(e.englishScope))throw Error('英语计分口径无效。');
 return e;
}
function validateData(d){
 if(!d||d.version!==1||!Array.isArray(d.exams)||d.exams.length>1000||!d.targets)throw Error('请选择本网页导出的 JSON 备份。');
 if(d.student!==undefined&&(typeof d.student!=='string'||d.student.length>60))throw Error('跟踪对象姓名须为 60 字以内的文字。');
 if(d.profile!==undefined){
  if(!d.profile||typeof d.profile!=='object'||Array.isArray(d.profile)||!d.student?.trim())throw Error('请填写跟踪对象姓名。');
  if(!['高一','高二','高三'].includes(d.profile.grade))throw Error('请选择有效年级。');
  if(typeof d.profile.school!=='string'||d.profile.school.length>100)throw Error('学校名称须为 100 字以内的文字。');
 }
 const ids=new Set(),orders=new Set();
 for(const e of d.exams){validateExam(e);if(typeof e.id!=='string'||!e.id||ids.has(e.id)||orders.has(e.order))throw Error('考试编号或考试顺序重复。');ids.add(e.id);orders.add(e.order);if(e.notes&&typeof e.notes!=='object')throw Error('复盘格式无效。');for(const n of Object.values(e.notes||{})){if(!n||typeof n!=='object'||typeof n.evidence!=='string'||typeof n.action!=='string'||!Array.isArray(n.tags)||n.tags.some(t=>typeof t!=='string')||!['待开始','进行中','已完成'].includes(n.status))throw Error('复盘格式无效。');}}
 for(const s of subjects)if(!present(d.targets[s])||d.targets[s]<0||d.targets[s]>100)throw Error('目标得分率须介于 0% 与 100%。');
 if(d.learning!==undefined)(root.LearningCore||(typeof require==='function'?require('./learning-core.js'):null)).validate(d.learning);
 return d;
}
function mergeSourceUpdates(saved,seed){
 const result=structuredClone(saved);
 const applied=new Set(Array.isArray(result.appliedSourceUpdates)?result.appliedSourceUpdates.filter(x=>typeof x==='string'):[]);
 for(const update of seed.sourceUpdates||[]){
  if(applied.has(update.id))continue;
  for(const id of update.examIds){
   if(result.exams.some(e=>e.id===id))continue;
   const source=seed.exams.find(e=>e.id===id);if(!source)continue;
   const incoming=structuredClone(source);
   if(result.exams.some(e=>e.order===incoming.order))for(const e of result.exams)if(e.order>=incoming.order)e.order++;
   result.exams.push(incoming);
  }
  applied.add(update.id);
 }
 result.appliedSourceUpdates=[...applied];
 return validateData(result);
}
const api={subjects,defaults,breakdowns,present,sorted,rankGrades,parseRank,rankValue,rankChange,aggregate,subjectRate,change,typeRate,breakdownSummary,validateExam,validateData,mergeSourceUpdates};
root.GradeCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
