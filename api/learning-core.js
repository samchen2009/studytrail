(function(root){
'use strict';
const subjects=['语文','数学','英语','物理','化学','地理'];
const steps=['preview','lesson','homework','review'];
const causes=['审题','概念','方法','计算','表达','时间'];
const helpModes=['独立解决','查课本 / 例题','请教老师 / 同学','家长提示','家长讲解'];
const checklistGroups=[
 {title:'课前预习',items:[
  {id:'preview-basics',text:'阅读概念与例题，尝试一道基础题'},
  {id:'preview-questions',text:'把不懂的地方写成具体问题，带到课堂'}]},
 {title:'上课听讲',items:[
  {id:'lesson-method',text:'听清为什么用这个方法，记下关键步骤'},
  {id:'lesson-resolve',text:'课后复述要点，未解决的疑问主动求助'}]},
 {title:'课后作业',items:[
  {id:'homework-read',text:'读完整题和所有小问，标出范围、单位等条件'},
  {id:'homework-check',text:'关键步骤不跳步，草稿有序，检查符号、计算与漏解'}]},
 {title:'错题整理',items:[
  {id:'mistake-reason',text:'写清错因、正确依据和下次的具体改进动作'},
  {id:'mistake-retest',text:'合上答案独立重做，隔一段时间再做变式题'}]},
 {title:'周末集中练习',items:[
  {id:'weekend-focus',text:'针对一两个主要漏洞，练基础题和变式题'},
  {id:'weekend-review',text:'做限时混合练习，回顾进展并确定下一步'}]},
 {title:'考试技巧',items:[
  {id:'exam-priority',text:'先拿有把握的分，卡住先标记，后面再返回'},
  {id:'exam-check',text:'按题型分配时间，预留检查，优先查漏题和高频错误'}]}
];
const checklistIds=checklistGroups.flatMap(group=>group.items.map(item=>item.id));
const DAY=86400000;
function today(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());}
function validDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
function addDays(s,n){return new Date(Date.parse(s+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);}
function weekStart(s){const day=new Date(s+'T00:00:00Z').getUTCDay();return addDays(s,-((day+6)%7));}
function defaults(){return {version:1,config:{startDate:today(),subjects:['数学'],focus:['读完整题干与最后一问','每天独立重做一道代表性错题']},daily:[],issues:[],weekly:[],checked:[],entries:[]};}
function stage(start,date=today()){return Math.max(1,Math.min(4,Math.floor((Date.parse(date)-Date.parse(start))/(7*DAY))+1));}
function mastery(issue){
 const ordered=issue.attempts.slice().sort((a,b)=>a.date.localeCompare(b.date));
 const last=ordered.at(-1);
 if(!last?.independent||!last.correct)return false;
 const failed=ordered.findLastIndex(a=>!a.correct);
 const good=ordered.slice(failed+1).filter(a=>a.independent&&a.correct);
 const dates=new Set(good.map(a=>a.date));
 return issue.kind==='疑问'?good.length>0:dates.size>=2&&good.some(a=>a.variant);
}
function issueState(issue){
 const last=issue.attempts.slice().sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
 if(last&&!last.correct)return '待巩固';
 if(mastery(issue))return '已掌握';
 return issue.basis.trim()?'待复测':'待解决';
}
function nextReview(issue,date,correct){
 if(!correct)return addDays(date,1);
 const ordered=issue.attempts.slice().sort((a,b)=>a.date.localeCompare(b.date));
 const count=ordered.slice(ordered.findLastIndex(a=>!a.correct)+1).filter(a=>a.independent&&a.correct).length;
 return addDays(date,count<=1?3:count===2?7:14);
}
function object(v){return !!v&&typeof v==='object'&&!Array.isArray(v);}
function assert(ok,message){if(!ok)throw Error(message);}
function string(v,label,max=3000,required=false){assert(typeof v==='string'&&v.length<=max&&(!required||v.trim()),label+'无效或超出长度限制。');}
function date(v,label,optional=false){assert((optional&&v==='')||validDate(v),label+'须为有效日期。');}
function number(v,label,max=10000,integer=true){assert(v===null||(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max&&(!integer||Number.isInteger(v))),label+'须为非负'+(integer?'整数':'数字')+'，或留空。');}
function list(v,label,max){assert(Array.isArray(v)&&v.length<=max,label+'格式无效或记录过多。');}
function subject(v){assert(subjects.includes(v),'学习记录科目无效。');}
function unique(rows,label,key=r=>r.id){const seen=new Set();for(const r of rows){assert(object(r),label+'格式无效。');const id=key(r);string(id,label+'编号',100,true);assert(!seen.has(id),label+'重复。');seen.add(id);}}
function validateChecked(checked){list(checked,'学习清单',checklistIds.length);assert(new Set(checked).size===checked.length&&checked.every(id=>checklistIds.includes(id)),'学习清单选项无效或重复。');}
function timestamp(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;}
function validate(l){
 assert(object(l)&&l.version===1&&object(l.config),'学习提升记录格式无效。');
 if(l.checked!==undefined)validateChecked(l.checked);
 if(l.entries!==undefined){list(l.entries,'跟踪记录',3000);unique(l.entries,'跟踪记录');for(const entry of l.entries){string(entry.id,'跟踪记录编号',100,true);assert(timestamp(entry.createdAt),'跟踪记录时间无效。');string(entry.text,'跟踪内容',5000,true);validateChecked(entry.checked);}}
 date(l.config.startDate,'计划开始日期');list(l.config.subjects,'重点学科',6);assert(l.config.subjects.length>0&&new Set(l.config.subjects).size===l.config.subjects.length,'请选择不重复的重点学科。');l.config.subjects.forEach(subject);
 list(l.config.focus,'本阶段重点',2);assert(l.config.focus.length===2,'请填写两项本阶段重点。');l.config.focus.forEach(v=>string(v,'本阶段重点',150,true));
 list(l.daily,'每日记录',5000);unique(l.daily,'每日记录',r=>r.date+'|'+r.subject);
 for(const r of l.daily){date(r.date,'记录日期');subject(r.subject);assert(object(r.steps),'学习环节记录无效。');for(const key of steps)assert(['待完成','已完成','不适用'].includes(r.steps[key]),'学习环节状态无效。');
  for(const key of ['questions','avoidable','reminders'])number(r[key],key==='questions'?'练习题量':key==='avoidable'?'可避免错误数':'家长提醒次数');
  assert((r.questions===null)===(r.avoidable===null),'题量和可避免错误数须一起填写，或一起留空。');assert(r.questions===null||r.avoidable<=r.questions,'可避免错误数不能超过练习题量。');string(r.note,'每日记录说明');
 }
 list(l.issues,'疑问与错题',3000);unique(l.issues,'疑问与错题');
 for(const r of l.issues){string(r.id,'问题编号',100,true);assert(['疑问','错题'].includes(r.kind),'问题类型无效。');subject(r.subject);date(r.date,'发现日期');date(r.due,'复测日期',true);assert(!r.due||r.due>=r.date,'复测日期不能早于发现日期。');string(r.title,'问题 / 知识点',150,true);
  for(const key of ['location','stuck','reason','basis','prevention'])string(r[key],'问题详情');assert(causes.includes(r.cause),'错误类别无效。');assert(helpModes.includes(r.help),'解决方式无效。');
  list(r.attempts,'复测记录',200);unique(r.attempts,'复测记录');
  for(const a of r.attempts){string(a.id,'复测编号',100,true);date(a.date,'复测日期');assert(a.date>=r.date,'复测日期不能早于发现日期。');for(const key of ['independent','correct','variant'])assert(typeof a[key]==='boolean','复测结果无效。');string(a.note,'复测说明',1000);}
 }
 list(l.weekly,'周末复盘',1000);unique(l.weekly,'周末复盘',r=>r.week+'|'+r.subject);
 for(const r of l.weekly){date(r.week,'周起始日期');assert(weekStart(r.week)===r.week,'周起始日期须为周一。');subject(r.subject);
  for(const key of ['focus','reflection','nextFocus','strategy'])string(r[key],'周末复盘内容');string(r.examId,'关联考试',100);
  for(const key of ['targetMinutes','mixedMinutes','questions','correct','checkMinutes'])number(r[key],key==='questions'?'小测题量':key==='correct'?'小测正确题数':'练习时间');
  assert((r.questions===null)===(r.correct===null),'小测题量和正确题数须一起填写，或一起留空。');assert(r.questions===null||r.correct<=r.questions,'正确题数不能超过小测题量。');
  for(const key of ['knowledgeLoss','avoidableLoss','timeLoss'])number(r[key],'失分',1000,false);
 }
 return l;
}
function summary(l,start,subject='全部学科'){
 const end=addDays(start,6),match=r=>subject==='全部学科'||r.subject===subject;
 const logs=l.daily.filter(r=>r.date>=start&&r.date<=end&&match(r));
 const eligible=logs.flatMap(r=>steps.map(k=>r.steps[k])).filter(v=>v!=='不适用');
 const measured=logs.filter(r=>r.questions!==null&&r.avoidable!==null);
 const questions=measured.reduce((n,r)=>n+r.questions,0),avoidable=measured.reduce((n,r)=>n+r.avoidable,0);
 const reminders=logs.filter(r=>r.reminders!==null);
 const attempts=l.issues.filter(match).flatMap(r=>r.attempts).filter(a=>a.date>=start&&a.date<=end&&a.independent);
 return {logs:logs.length,days:new Set(logs.map(r=>r.date)).size,completed:eligible.filter(v=>v==='已完成').length,eligible:eligible.length,questions,avoidable,errorRate:questions?avoidable/questions*20:null,
  reminderAverage:reminders.length?reminders.reduce((n,r)=>n+r.reminders,0)/reminders.length:null,
  attempts:attempts.length,correct:attempts.filter(a=>a.correct).length,
  issues:l.issues.filter(match),open:l.issues.filter(r=>match(r)&&issueState(r)!=='已掌握').length,
  weekly:l.weekly.filter(r=>r.week===start&&match(r))};
}
const api={subjects,steps,causes,helpModes,checklistGroups,checklistIds,today,validDate,addDays,weekStart,defaults,stage,mastery,issueState,nextReview,validate,summary};
root.LearningCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
