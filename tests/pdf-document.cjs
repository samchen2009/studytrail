'use strict';
const assert=require('node:assert/strict');
async function run(){
 const {imagePdf}=await import('../web/pdf-document.mjs');
 const image={bytes:new Uint8Array([255,216,255,0,255,217]),width:1588,height:2246};
 const pdf=imagePdf([image,{...image,width:2246,height:1588}]);
 assert.equal(pdf.type,'application/pdf');const bytes=Buffer.from(await pdf.arrayBuffer()),text=bytes.toString('latin1');
 assert.match(text,/\/Count 2/);assert.match(text,/MediaBox \[0 0 595.28 841.89\]/);assert.match(text,/MediaBox \[0 0 841.89 595.28\]/);
 const start=Number(text.match(/startxref\n(\d+)/)[1]);assert.equal(bytes.subarray(start,start+4).toString(),'xref');
 const entries=text.slice(start).split('\n');for(let id=1;id<=8;id++){const offset=Number(entries[2+id].slice(0,10));assert.ok(text.slice(offset).startsWith(id+' 0 obj\n'),'xref byte offset '+id);}
 assert.throws(()=>imagePdf([]));assert.throws(()=>imagePdf([{...image,bytes:new Uint8Array([0])}]));
 console.log('PASS: PDF binary structure, image streams, page orientation and exact cross-reference byte offsets. Browser rendering is verified separately.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
