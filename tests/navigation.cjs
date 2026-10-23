'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=require('../web/core');
function app(notebook){
 const nodes=new Map(),listeners=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',style:{},addEventListener(){},classList:{toggle(){}},insertAdjacentHTML(){}});return nodes.get(id);};
 const buttons=['overview','subjects','records','review','learning','grading','mistakes'].map(page=>({dataset:{page},classList:{toggle(){}},hasAttribute(){return false;}}));
 let reloads=0;
 const sandbox={GradeCore:core,SEED:{version:1,student:'合成导航测试',exams:[],targets:Object.fromEntries(core.subjects.map(s=>[s,60]))},structuredClone,renderProfile(){},location:{hash:'#overview',reload(){reloads++;}},history:{replaceState(_state,_title,hash){sandbox.location.hash=hash;}},innerWidth:1280,scrollTo(){},addEventListener(){},document:{getElementById:node,querySelector:node,querySelectorAll(){return buttons;},addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);}},GradingView:{render:()=>'<h2>批改内容</h2>'},LearningDiary:{render:()=>'<h2>学习内容</h2>'},MistakeNotebook:notebook};
 sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8'),sandbox);
 return {nodes,click(page){const button=typeof page==='string'?buttons.find(b=>b.dataset.page===page):page;for(const fn of listeners.get('click'))fn({target:{closest:()=>button}});},reloads:()=>reloads};
}
for(const initial of ['overview','subjects','records','review','learning','grading']){
 const missing=app(undefined);missing.click(initial);const previous=missing.nodes.get('content').innerHTML;missing.click('mistakes');
 assert.equal(missing.nodes.get('pageTitle').textContent,'错题本');assert.notEqual(missing.nodes.get('content').innerHTML,previous);assert.match(missing.nodes.get('content').innerHTML,/错题本未能加载/);assert.match(missing.nodes.get('content').innerHTML,/重启学迹服务/);
 missing.click({dataset:{},hasAttribute:name=>name==='data-reload-app'});assert.equal(missing.reloads(),1);
 const available=app({render:()=>'<h2>六科错题内容</h2>'});available.click(initial);available.click('mistakes');assert.match(available.nodes.get('content').innerHTML,/六科错题内容/);available.click(initial);available.click('mistakes');assert.match(available.nodes.get('content').innerHTML,/六科错题内容/);
}
console.log('PASS: all six preceding tabs switch to the notebook; missing scripts show an actionable error instead of stale content.');
