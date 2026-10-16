'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
// Rename within the project filesystem, so existing versions and attachments move together.
// Explicit custom directories are used as-is; separate datasets are never merged.
async function prepareDataDirectory(dataDir,root=path.join(__dirname,'..')){
 const destination=path.join(root,'.data'),legacy=path.join(root,'data');
 if(path.resolve(dataDir)!==path.resolve(destination))return false;
 let entries;
 try{entries=await fs.readdir(legacy);}catch(error){if(error.code==='ENOENT')return false;throw error;}
 if(!entries.length)return false;
 try{await fs.lstat(destination);}catch(error){if(error.code!=='ENOENT')throw error;await fs.rename(legacy,destination);return true;}
 throw Error('同时发现 data/ 和 .data/。为避免混合档案，未自动迁移；请先备份，使用 --data-dir 明确选择数据目录。');
}
module.exports={prepareDataDirectory};
