'use strict';
const path=require('node:path'),{parseArgs}=require('node:util');
function options(args=process.argv.slice(2),env=process.env){
 const {values}=parseArgs({args,options:{port:{type:'string'},'data-dir':{type:'string'},help:{type:'boolean',short:'h'}}});
 const port=Number(values.port??env.PORT??8767);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('端口必须是 1 至 65535 之间的整数。');
 return {port,dataDir:path.resolve(values['data-dir']||env.GRADES_DATA_DIR||path.join(__dirname,'../.data')),help:values.help};
}
module.exports={options};
