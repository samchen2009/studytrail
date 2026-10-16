'use strict';
const {options}=require('./options.cjs');
async function main(){
 const major=Number(process.versions.node.split('.')[0]);
 if(major<22||(major===22&&Number(process.versions.node.split('.')[1])<13))throw Error('需要 Node.js 22.13 或更高版本，推荐 Node.js 24。');
 const config=options();
 if(config.help){console.log('学迹 StudyTrail\n启动：npm start\n选项：npm start -- --port 8768 --data-dir "./my-data"\n默认地址：http://127.0.0.1:8767/\n默认数据目录：项目下的 .data/');return;}
 if(await require('./data-directory.cjs').prepareDataDirectory(config.dataDir))console.log('已将原 data/ 完整迁移至 .data/，成绩版本及附件均保留。');
 process.env.LOCAL_JSON_DEMO='1';
 process.env.TRIAL_PORT=String(config.port);
 process.env.TRIAL_DATA_DIR=config.dataDir;
 await require('../api/server.js').start();
}
main().catch(error=>{
 console.error(error.code==='EADDRINUSE'?'端口已被占用。可运行 npm start -- --port 8768 更换端口。':error.message);
 process.exitCode=1;
});
