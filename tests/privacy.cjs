'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {checkWorkingTree,checkHistory,seedIsEmpty,privatePath}=require('../scripts/privacy-check.cjs');
assert.ok(checkWorkingTree().length>0);
assert.equal(seedIsEmpty(fs.readFileSync(path.join(__dirname,'../web/seed.js'),'utf8')),true);
assert.equal(seedIsEmpty('window.SEED={student:"模拟同学",exams:[]}'),false);
for(const file of ['.data/records.json','.data/attachments/file.bin','data/a.json','data/attachments/file.bin','tmp/report.txt','output/a.pdf','work/notes.md','.env','.env.local','exam.xlsx','backup.zip'])assert.equal(privatePath(file),true,file);
for(const file of ['web/index.html','api/instance.js','.env.example','tests/fixtures/grades.cjs'])assert.equal(privatePath(file),false,file);
// Even if the current source is clean, an older commit with a student must block release.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studytrail-privacy-'));
const git=args=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});
try{
 git(['init','-q']);git(['config','user.name','Test']);git(['config','user.email','test@example.invalid']);
 fs.mkdirSync(path.join(dir,'web'));fs.writeFileSync(path.join(dir,'web/seed.js'),'window.SEED={student:"模拟同学",exams:[]}');git(['add','.']);git(['commit','-qm','synthetic private data']);
 fs.copyFileSync(path.join(__dirname,'../web/seed.js'),path.join(dir,'web/seed.js'));git(['add','.']);git(['commit','-qm','empty source']);
 assert.throws(()=>checkHistory(dir),/个人初始档案/);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('PASS: empty initial dataset, local-material exclusions and historical privacy regression detection.');
