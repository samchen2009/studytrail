(function(root){
'use strict';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function formatMath(katex,value){
 const input=String(value??''),pattern=/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)(?<!\\)\$/g;
 let out='',last=0;
 for(const m of input.matchAll(pattern)){
  out+=escape(input.slice(last,m.index));
  const tex=m[1]??m[2]??m[3]??m[4],displayMode=m[1]!==undefined||m[2]!==undefined;
  try{out+=katex.renderToString(tex,{displayMode,throwOnError:true,trust:false,maxExpand:1000,maxSize:20,strict:'ignore',output:'htmlAndMathml'});}
  catch{out+=`<span class="math-error" role="note">公式待核：<code>${escape(m[0])}</code></span>`;}
  last=m.index+m[0].length;
 }
 return out+escape(input.slice(last));
}
const api={formatMath};if(typeof module!=='undefined')module.exports=api;else root.MathFormat=api;
})(typeof window!=='undefined'?window:globalThis);
