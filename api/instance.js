'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
// Scope browser drafts to this data directory, while allowing the original installation to recover old drafts.
async function localInstance(directory,hasRecords){
 await fs.mkdir(directory,{recursive:true});
 const file=path.join(directory,'instance.json');
 try{return await read();}catch(error){if(error.code!=='ENOENT')throw error;}
 const temporary=path.join(directory,'.instance-'+crypto.randomUUID()+'.tmp');
 try{
  await fs.writeFile(temporary,JSON.stringify({id:crypto.randomUUID(),migrateLegacyDraft:hasRecords}),{flag:'wx'});
  try{await fs.link(temporary,file);}catch(error){if(error.code!=='EEXIST')throw error;}
 }finally{await fs.rm(temporary,{force:true});}
 return read();
 async function read(){const value=JSON.parse(await fs.readFile(file,'utf8'));if(typeof value.id!=='string'||!/^[a-f0-9-]{36}$/.test(value.id))throw Error('本地实例配置损坏，请从备份恢复 instance.json。');return value;}
}
module.exports={localInstance};
