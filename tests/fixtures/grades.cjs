'use strict';
module.exports=()=>({version:1,student:'测试同学',targets:Object.fromEntries(['语文','数学','英语','物理','化学','地理'].map(s=>[s,60])),exams:Array.from({length:5},(_,i)=>({id:'test-'+(i+1),name:'模拟考试 '+(i+1),grade:'高一',date:'',order:i+1,scores:{语文:90+i,数学:75+i,英语:95+i,物理:60+i,化学:55+i,地理:65+i},maxima:{语文:150,数学:150,英语:150,物理:100,化学:100,地理:100},ranks:{},equivalent:{},notes:{}}))});
