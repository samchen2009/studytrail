'use strict';
const assert=require('node:assert/strict'),C=require('../web/core');
const rank=(value)=>({ranks:{数学:value}});
assert.equal(C.parseRank('0.77').percent,77);assert.equal(C.parseRank(0).percent,0);assert.equal(C.parseRank('1').percent,100);
assert.equal(C.parseRank('77%').percent,77);assert.equal(C.parseRank('77%%').percent,77);assert.equal(C.parseRank('77%%').normalized,true);assert.equal(C.parseRank('77％').percent,77);
assert.deepEqual(C.parseRank('75%  C-'),{raw:'75%  C-',percent:75,position:null,grade:'C-',normalized:false});
assert.equal(C.parseRank('第 35 名').position,35);assert.equal(C.parseRank('35名').position,35);assert.equal(C.parseRank('35').position,35);assert.equal(C.parseRank('C+').grade,'C+');
for(const raw of ['',null,undefined,'未提供','101%','-1','0名','1.5','C++','第3名 / 第8名',{},Infinity]){const r=C.parseRank(raw);assert.equal(r.percent,null);assert.equal(r.position,null);assert.equal(r.grade,null);}
assert.equal(C.rankChange(rank('65%'),rank('77%%'),'数学'),12);assert.equal(C.rankChange(rank('82%'),rank('77%'),'数学'),-5);assert.equal(C.rankChange(rank('77%'),rank('77%'),'数学'),0);
assert.equal(C.rankChange(rank('第10名'),rank('第30名'),'数学','position'),20);assert.equal(C.rankChange(rank('C-'),rank('C+'),'数学','grade'),-2);
assert.equal(C.rankChange(rank('77%'),rank('第20名'),'数学'),null);assert.equal(C.rankChange(rank(''),rank('77%'),'数学'),null);assert.equal(C.rankChange(rank('77%'),null,'数学'),null);
assert.equal(C.rankValue(rank('75% C-'),'数学','grade'),'C-');assert.equal(C.rankValue(rank('C-'),'数学','percent'),null);
console.log('PASS: ranking percentages/fractions, raw-text preservation, duplicate-percent normalization, positions, grade order, improvement direction and incomparable/missing ranks.');
