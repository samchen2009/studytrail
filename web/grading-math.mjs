import './math-format.js';
let resources;
function script(src){return new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.onload=resolve;el.onerror=()=>reject(Error('公式资源加载失败。'));document.head.append(el);});}
function ready(){
 if(!resources)resources=(async()=>{
  if(!document.getElementById('grading-math-css')){
   const css=document.createElement('link');css.id='grading-math-css';css.rel='stylesheet';css.href='/vendor/katex/katex.min.css';document.head.append(css);
  }
  await script('/vendor/katex/katex.min.js');await script('/vendor/katex/contrib/mhchem.min.js');
 })().catch(error=>{resources=null;throw error;});
 return resources;
}
export async function renderReportMath(target){
 if(!target)return;
 const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT),nodes=[];
 while(walker.nextNode()){
  const n=walker.currentNode;
  if(n.parentElement.closest('form,textarea,pre,code,svg,script,style,.katex,.math-error'))continue;
  if(/\\[([]|\$/.test(n.data))nodes.push(n);
 }
 if(!nodes.length)return;
 await ready();if(!target.isConnected)return;
 for(const n of nodes){
  const wrapper=document.createElement('span');wrapper.innerHTML=globalThis.MathFormat.formatMath(globalThis.katex,n.data);n.replaceWith(wrapper);
 }
}
