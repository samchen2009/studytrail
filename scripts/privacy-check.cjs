'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const privatePath=file=>/^(?:\.data|data|work|outputs?|tmp|backups|node_modules)(?:\/|$)/.test(file)||/(?:^|\/)\.env(?:\..*)?$/.test(file)&&file!=='.env.example'||/\.(?:pdf|xlsx|docx|zip|tar|gz)$/i.test(file);
function git(args,cwd=root){return execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:32*1024*1024});}
function seedIsEmpty(text){const context={window:{}};vm.runInNewContext(text,context,{timeout:1000});const seed=context.window.SEED;return seed?.student===''&&Array.isArray(seed.exams)&&seed.exams.length===0&&!seed.sourceFile;}
function checkWorkingTree(cwd=root){
 const files=[...new Set(git(['ls-files','--cached','--others','--exclude-standard','-z'],cwd).split('\0').filter(Boolean))];
 const unsafe=files.filter(privatePath);
 if(unsafe.length)throw Error('发布文件包含本地资料：'+unsafe.join(', '));
 if(!seedIsEmpty(fs.readFileSync(path.join(cwd,'web/seed.js'),'utf8')))throw Error('前端初始数据必须为空，个人档案只能存入本地 .data/。');
 return files;
}
function checkHistory(cwd=root){
 const commits=git(['rev-list','--all'],cwd).trim().split('\n').filter(Boolean);
 for(const commit of commits){
  const files=git(['ls-tree','-r','--name-only',commit],cwd).trim().split('\n');
  if(files.some(privatePath))throw Error('Git 历史包含本地资料（提交 '+commit.slice(0,8)+'）。请先备份并清理历史。');
  if(files.includes('web/seed.js')&&!seedIsEmpty(git(['show',commit+':web/seed.js'],cwd)))throw Error('Git 历史仍包含个人初始档案（提交 '+commit.slice(0,8)+'）。禁止直接推送；请先备份并建立干净历史。');
 }
 return commits.length;
}
if(require.main===module){try{const files=checkWorkingTree();const commits=checkHistory();console.log('PASS: '+files.length+' source files and '+commits+' historical commits contain no bundled student data or local material.');}catch(error){console.error('隐私检查失败：'+error.message);process.exitCode=1;}}
module.exports={checkWorkingTree,checkHistory,seedIsEmpty,privatePath};
