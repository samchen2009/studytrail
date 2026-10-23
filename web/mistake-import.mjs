import {TandixGrader,explain} from './grading-tandix.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let current=null;
function dialog(){let d=document.getElementById('mnAutoImport');if(!d){d=document.createElement('dialog');d.id='mnAutoImport';d.className='mn-editor mn-auto-import';document.body.append(d);}return d;}
function shell(title){const d=dialog();d.innerHTML=`<div class="dialog-head"><div><span class="eyebrow">自动整理错题</span><h2>${esc(title)}</h2></div><button class="close" data-auto-close aria-label="关闭自动整理">×</button></div><div data-auto-body></div>`;d.querySelector('[data-auto-close]').onclick=()=>d.close();if(!d.open)d.showModal();return d;}
function status(message){if(current?.dialog?.open){const p=current.dialog.querySelector('[data-auto-progress]');if(p)p.textContent=message;}}

export async function renderFilePages(file,{pageNumber,onProgress=()=>{}}={}){
 if(file.size>20*1024*1024)throw Error('原文件不能超过 20 MB。');
 if(file.type!=='application/pdf'&&!/\.pdf$/i.test(file.name)){
  const image=await createImageBitmap(file);try{const scale=Math.min(1,2000/image.width,2600/image.height),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',.94);canvas.width=canvas.height=0;return [{name:file.name,pageNumber:1,data}];}finally{image.close();}
 }
 const pdf=await import('/vendor/pdfjs/build/pdf.mjs');pdf.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/build/pdf.worker.mjs';
 const task=pdf.getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/',iccUrl:'/vendor/pdfjs/iccs/',isEvalSupported:false,enableXfa:false});
 try{const doc=await task.promise;if(!pageNumber&&doc.numPages>10)throw Error('PDF 超过 10 页，请在附件中打开需要的页面后点击加入错题本。');if(pageNumber&&(pageNumber<1||pageNumber>doc.numPages))throw Error('PDF 页码无效。');const numbers=pageNumber?[pageNumber]:Array.from({length:doc.numPages},(_,i)=>i+1),pages=[];
  for(const n of numbers){onProgress('正在读取 PDF 第 '+n+' 页…');const p=await doc.getPage(n),base=p.getViewport({scale:1}),vp=p.getViewport({scale:Math.min(2,1800/base.width)}),canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);await p.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;pages.push({name:file.name+' · 第 '+n+' 页',pageNumber:n,data:canvas.toDataURL('image/jpeg',.94)});canvas.width=canvas.height=0;}return pages;
 }finally{await task.destroy();}
}

export async function startImport(input,{api,onSaved=()=>{}}){
 if(current?.running){if(!current.dialog.open)current.dialog.showModal();return;}
 const d=shell(input.entryId?'正在自动截取并补齐题面':'正在识别题目');
 const state={dialog:d,running:true,record:null,run:null,runner:null,chain:Promise.resolve()};current=state;
 const post=(route,body)=>api(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 d.querySelector('[data-auto-body]').innerHTML='<div class="mn-auto-progress"><span class="mn-auto-spinner" aria-hidden="true"></span><p data-auto-progress role="status">正在读取已有文件…</p></div><p class="hint">系统自动截题、识别题干、归类并保存。当前材料会通过 Tandix 交给已配置的 Codex；关闭此窗口仍会继续整理。</p>';
 async function checkpoint(patch){const record=state.record;state.chain=state.chain.then(async()=>{state.run=await post('imports/'+record.data.id+'/run',{baseRevision:state.run.revision,runId:state.run.data.runId,...patch});});return state.chain;}
 function done(entries){state.running=false;d.querySelector('h2').textContent='已自动保存到'+entries[0].data.subject+'错题本';onSaved(entries);const body=d.querySelector('[data-auto-body]');body.innerHTML=`<div class="mn-auto-success">✓</div><h3>已加入 ${entries.length} 道题</h3><p>题面、学科、来源及已识别的解答已自动保存。</p><div class="dialog-foot"><button class="secondary" data-done-close>继续查看</button><button class="primary" data-done-view>打开错题本</button></div>`;body.querySelector('[data-done-close]').onclick=()=>d.close();body.querySelector('[data-done-view]').onclick=async()=>{document.querySelectorAll('dialog[open]').forEach(x=>x.close());await window.MistakeNotebook.open(entries[0].data.subject);await window.MistakeNotebook.openEntry(entries[0].data.id);};}
 async function save(ids){status('正在自动截题并写入本机…');const r=await post('imports/'+state.record.data.id+'/collect',{ids});done(r.entries);}
 function candidates(record){
  state.running=false;const qs=record.data.result.questions;d.querySelector('h2').textContent=(record.data.result.subject||record.data.subject)+' · 选择要加入的题目';
  if(record.data.target||qs.length===1){state.running=true;return save([qs[0].id]);}
  const body=d.querySelector('[data-auto-body]');body.innerHTML=`<p>已识别 ${qs.length} 道题。选择要收录的题目，其余信息由系统填写。</p><form data-auto-pick>${qs.map(q=>`<label class="mn-auto-question"><input type="checkbox" name="question" value="${esc(q.id)}" checked><span><strong>${esc(q.title)}</strong>${q.questionContent.parts.some(p=>p.role==='question')?`<img src="/api/mistakes/imports/${record.data.id}/preview/${encodeURIComponent(q.id)}" alt="系统自动截取的题目" loading="lazy">`:''}<span class="mn-auto-stem">${esc(q.stem)}</span><small>${q.knowledgePoints.map(esc).join(' · ')}${q.questionContent.complete?'':' · 原题材料可能不完整，仍可先保存'}</small></span></label>`).join('')}<p data-auto-progress role="status"></p><div class="dialog-foot"><button type="button" class="secondary" data-pick-close>稍后选择</button><button class="primary">加入所选题目</button></div></form>`;
  body.querySelector('[data-pick-close]').onclick=()=>d.close();body.querySelector('form').onsubmit=async e=>{e.preventDefault();if(state.running)return;const ids=[...body.querySelectorAll('[name=question]:checked')].map(i=>i.value);if(!ids.length)return status('请至少选择一道题。');state.running=true;const b=e.target.querySelector('button.primary');b.disabled=true;try{await save(ids);}catch(e){status(e.message);}finally{state.running=false;if(b.isConnected)b.disabled=false;}};
 }
 try{
  if(input.file){input={...input,name:input.file.name,pages:await renderFilePages(input.file,{onProgress:status})};delete input.file;}
  if(input.attachmentId&&/\.pdf$/i.test(input.name||'')){const r=await fetch(input.url,{cache:'no-store'});if(!r.ok)throw Error('无法读取当前 PDF。');const file=new File([await r.blob()],input.name,{type:'application/pdf'});input={...input,pages:await renderFilePages(file,{pageNumber:input.pageNumber,onProgress:status})};}
  state.record=input.importId?await api('imports/'+input.importId):await post('imports',input);
  if(!state.record.job)state.record=await api('imports/'+state.record.data.id);
  state.run=state.record.run;if(['failed','cancelled'].includes(state.run.data.status))state.run=await post('imports/'+state.record.data.id+'/run',{start:true});
  if(state.record.data.result){state.running=false;return await candidates(state.record);}
  if(state.run.data.status!=='received'){
   let resuming=false;const runner=new TandixGrader({onState:(phase,text)=>{status(text.replace(/批改/g,'识题'));if(phase==='interrupted'&&input.resume&&!resuming){resuming=true;queueMicrotask(async()=>{try{await checkpoint({resume:true,resumePrompt:'继续整理本次原附件与指定题目，不改变原评分，完成剩余截题并返回约定的完整 JSON。'});const request=state.run.data.resumeRequest;await runner.resume({requestId:request.requestId,prompt:request.prompt});}catch(e){status(explain(e));}});}},onProgress:()=>{},onCheckpoint:checkpoint});state.runner=runner;
   if(state.run.data.status==='preparing')await runner.run({job:state.record.job,taskId:state.run.data.taskId,prompt:state.record.prompt,fetchAsset:p=>fetch('/api/mistakes/imports/'+state.record.data.id+'/pages/'+p.id,{cache:'no-store'})});
   else await runner.recover({taskId:state.run.data.taskId,cursor:state.run.data.cursor||0,identity:{agentId:state.run.data.agentId,sessionId:state.run.data.sessionId},allowAuthorize:true});
  }
  await state.chain;const record=await post('imports/'+state.record.data.id+'/result',{});await candidates(record);
 }catch(error){
  try{await state.chain;if(state.run&&['preparing','submitting','running','interrupted'].includes(state.run.data.status))await checkpoint({status:state.runner?.submitted&&error.code!=='invalid-json'?'interrupted':'failed',errorCode:error.code||'local-error',errorMessage:explain(error).slice(0,2000)});}catch{}
  state.running=false;const body=d.querySelector('[data-auto-body]');body.innerHTML=`<h3>自动整理暂未完成</h3><p class="mn-prose">${esc(explain(error).replace(/批改/g,'识题'))}</p><p class="hint">原文件和已加入的题目仍保留，无需手动截题或重新填写信息。</p><div class="dialog-foot"><button class="secondary" data-auto-fallback>手动调整</button><button class="primary" data-auto-retry>继续自动整理</button></div>`;
  body.querySelector('[data-auto-retry]').onclick=()=>{d.close();return startImport(error.status===409&&state.record?.data.target?{entryId:state.record.data.target.id}:state.record?{importId:state.record.data.id,resume:true}:input,{api,onSaved});};body.querySelector('[data-auto-fallback]').onclick=async()=>{d.close();return window.MistakeNotebook.openEditor(input.entryId?{entry:await api('entries/'+input.entryId)}:input);};
 }
}
