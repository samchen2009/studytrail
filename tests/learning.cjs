'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const L=require('../web/learning-core'),Core=require('../web/core'),{LocalJsonStore}=require('../api/store'),{createService}=require('../api/server');
const blank=()=>({version:1,exams:[],targets:Object.fromEntries(L.subjects.map(s=>[s,60]))});
function daily(date='2026-10-14',subject='数学'){return {date,subject,steps:{preview:'已完成',lesson:'已完成',homework:'待完成',review:'不适用'},questions:20,avoidable:2,reminders:1,note:'漏看整数条件，下一次标范围'};}
function issue(){return {id:crypto.randomUUID(),kind:'错题',subject:'数学',date:'2026-10-12',due:'2026-10-15',title:'移项漏负号',location:'作业第 8 题',stuck:'第二步符号变化',cause:'计算',reason:'连续跳步',basis:'等式两边同加同减',prevention:'移项单独写一步',help:'家长提示',attempts:[]};}
function attempt(date,changes={}){return {id:crypto.randomUUID(),date,independent:true,correct:true,variant:false,note:'',...changes};}
function weekly(){return {week:'2026-10-12',subject:'数学',focus:'负号、题目范围',targetMinutes:25,mixedMinutes:30,questions:10,correct:8,checkMinutes:5,knowledgeLoss:3,avoidableLoss:2,timeLoss:null,strategy:'卡住先跳过，第二轮返回',reflection:'检查找出一个漏解',nextFocus:'标范围；核对符号',examId:''};}
function invalid(mutate,pattern){const l=L.defaults();l.config.startDate='2026-10-12';l.daily.push(daily());l.issues.push(issue());l.weekly.push(weekly());mutate(l);assert.throws(()=>L.validate(l),pattern);assert.throws(()=>require('../api/core').validateData({...blank(),learning:l}),pattern);}
async function run(){
 assert.equal(await fs.readFile(path.join(__dirname,'../web/learning-core.js'),'utf8'),await fs.readFile(path.join(__dirname,'../api/learning-core.js'),'utf8'));
 assert.equal(await fs.readFile(path.join(__dirname,'../web/core.js'),'utf8'),await fs.readFile(path.join(__dirname,'../api/core.js'),'utf8'));
 assert.deepEqual(Core.validateData(blank()),blank()); // Old backups and no-exam records remain usable.
 assert.equal(L.weekStart('2026-10-18'),'2026-10-12');assert.equal(L.addDays('2026-12-31',1),'2027-01-01');assert.equal(L.validDate('2026-02-30'),false);assert.equal(L.stage('2026-10-01','2026-10-22'),4);
 const l=L.defaults();l.config.startDate='2026-10-12';l.daily.push(daily());l.issues.push(issue());l.weekly.push(weekly());L.validate(l);
 l.checked=['preview-basics','homework-check'];
 l.entries=[{id:crypto.randomUUID(),createdAt:'2026-10-14T02:00:00.000Z',text:'计算错误减少，下一步练主动求助。',checked:[...l.checked]}];
 L.validate(l);
 l.checked=['preview-basics'];assert.deepEqual(l.entries[0].checked,['preview-basics','homework-check']);
 const legacy=structuredClone(l);delete legacy.checked;delete legacy.entries;L.validate(legacy);
 invalid(x=>x.checked=['unknown'],/清单/);
 invalid(x=>x.checked=['preview-basics','preview-basics'],/清单/);
 invalid(x=>x.entries=[{id:'entry',createdAt:'2026-02-30T02:00:00.000Z',text:'进展',checked:[]}],/时间/);
 invalid(x=>x.entries=[{id:'entry',createdAt:'2026-10-14T02:00:00.000Z',text:' ',checked:[]}],/跟踪内容/);
 invalid(x=>x.entries=[{id:'entry',createdAt:'2026-10-14T02:00:00.000Z',text:'进展',checked:['unknown']}],/清单/);
 invalid(x=>x.entries=Array(2).fill({id:'entry',createdAt:'2026-10-14T02:00:00.000Z',text:'进展',checked:[]}),/重复/);
 invalid(x=>x.daily[0].date='2026-02-30',/有效日期/);invalid(x=>x.daily.push(daily()),/重复/);invalid(x=>x.daily[0].avoidable=21,/不能超过/);invalid(x=>x.daily[0].questions=null,/一起/);invalid(x=>x.daily[0].reminders=-1,/非负/);invalid(x=>x.daily[0].steps.preview='完成',/状态/);invalid(x=>x.issues[0].cause='粗心',/类别/);invalid(x=>x.issues[0].due='2026-10-11',/早于/);invalid(x=>x.issues[0].attempts=[attempt('2026-10-11')],/早于/);invalid(x=>x.weekly[0].correct=11,/不能超过/);invalid(x=>x.weekly[0].week='2026-10-14',/周一/);invalid(x=>x.config.subjects=[],/重点学科/);invalid(x=>x.issues[0].attempts=[attempt('2026-10-14',{independent:'true'})],/复测结果/);
 const r=l.issues[0];assert.equal(L.issueState(r),'待复测');r.attempts.push(attempt('2026-10-14'));assert.equal(L.mastery(r),false);
 r.attempts.push(attempt('2026-10-14',{variant:true}));assert.equal(L.mastery(r),false); // Same-day repeats do not satisfy spacing.
 r.attempts.push(attempt('2026-10-16',{independent:false,variant:true}));assert.equal(L.mastery(r),false);
 r.attempts.push(attempt('2026-10-17',{variant:true}));assert.equal(L.issueState(r),'已掌握');
 r.attempts.push(attempt('2026-10-18',{correct:false}));assert.equal(L.issueState(r),'待巩固');
 r.attempts.push(attempt('2026-10-19',{variant:true}));assert.equal(L.mastery(r),false);assert.equal(L.nextReview(r,'2026-10-19',true),'2026-10-22'); // Relearn after regression.
 r.attempts.push(attempt('2026-10-20'));assert.equal(L.mastery(r),true);
 assert.equal(L.nextReview(r,'2026-10-20',false),'2026-10-21');
 const q=issue();q.kind='疑问';q.attempts=[attempt('2026-10-14',{independent:false})];assert.equal(L.mastery(q),false);q.attempts.push(attempt('2026-10-15'));assert.equal(L.mastery(q),true);
 const sum=L.summary(l,'2026-10-12');assert.equal(sum.completed,2);assert.equal(sum.eligible,3);assert.equal(sum.errorRate,2);assert.equal(sum.reminderAverage,1);assert.equal(sum.attempts,4);assert.equal(sum.correct,3);assert.equal(sum.open,0);
 assert.equal(L.summary(l,'2026-10-12','英语').errorRate,null);const empty=L.defaults();empty.daily.push({...daily(),questions:null,avoidable:null,reminders:null});assert.equal(L.summary(empty,'2026-10-12').errorRate,null);assert.equal(L.summary(empty,'2026-10-12').reminderAverage,null);
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'learning-store-test-'));let store=new LocalJsonStore(folder);
 const server=http.createServer((req,res)=>createService({store,demo:true})(req,res));
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const url='http://127.0.0.1:'+server.address().port;
  async function post(value,revision){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:value,baseRevision:revision,requestId:crypto.randomUUID()})});}
  assert.equal((await post(blank(),0)).status,200);
  const saved={...blank(),learning:l};assert.equal((await post(saved,1)).status,200);
  store=new LocalJsonStore(folder);assert.deepEqual((await (await fetch(url)).json()).data,saved);
  assert.equal((await post(saved,1)).status,409);
  const broken=structuredClone(saved);broken.learning.daily[0].avoidable=200;assert.equal((await post(broken,2)).status,422);
  assert.deepEqual((await (await fetch(url)).json()).data,saved);
  const historical=JSON.parse(await fs.readFile(path.join(folder,'000000000001.json'),'utf8'));assert.deepEqual(historical.data,blank());
  console.log('PASS: checklist and note validation, historical checklist snapshots, legacy learning records, save/restart round-trip, history and stale-write protection.');
 }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(folder,{recursive:true,force:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
