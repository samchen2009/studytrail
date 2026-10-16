'use strict';
const shareSettings=window.SHARED_JSON_SETTINGS||{api:'/api/grades',localTrial:true};
let sharedRevision=0,sharedReady=false,sharedDirty=false,sharedBusy=false,editorCredential='',pendingRequest=null;
let sharedExamIds=new Set();
const legacyDraftKey='highschool-grade-draft-v1:'+shareSettings.api;
let draftKey=legacyDraftKey;
function sharedStatus(message,error=false){$('sharedStatus').textContent=message;$('sharedStatus').classList.toggle('down',error);$('shareSave').disabled=sharedBusy||!sharedReady||!sharedDirty;$('shareRead').disabled=sharedBusy;}
function saveDraft(){
 sharedDirty=true;pendingRequest=null;
 try{localStorage.setItem(draftKey,JSON.stringify({data,baseRevision:sharedRevision,dirty:true}));storageError='';}
 catch{storageError='本机草稿保存失败，请导出备份。';}
 sharedStatus('有浏览器草稿待保存 · 当前版本 '+sharedRevision);
 return !storageError;
}
function cacheClean(){try{localStorage.setItem(draftKey,JSON.stringify({data,baseRevision:sharedRevision,dirty:false}));}catch{}}
async function sharedRequest(method,body){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);
 try{
  const response=await fetch(shareSettings.api,{method,cache:'no-store',signal:controller.signal,headers:method==='POST'?{'Content-Type':'application/json',...(editorCredential?{Authorization:'Bearer '+editorCredential}:{})}:{},...(body?{body:JSON.stringify(body)}:{})});
  let value;try{value=await response.json();}catch{throw Error('接口返回格式无效。');}
  if(!response.ok){const error=Error(value.error||'共享请求失败');error.status=response.status;throw error;}
  if(!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('共享版本号无效。');
  if(value.data)C.validateData(value.data);
  return value;
 }finally{clearTimeout(timeout);}
}
let confirmingDiscard=false;
async function confirmDiscardDraft(){
 if(confirmingDiscard)return false;confirmingDiscard=true;
 const dialog=$('discardDraftDialog');dialog.returnValue='cancel';
 try{return await new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(dialog.returnValue==='read'),{once:true});dialog.showModal();});}
 finally{confirmingDiscard=false;}
}
async function loadShared(initial=false){
 if(sharedBusy)return;
 if(!initial&&sharedDirty&&!await confirmDiscardDraft())return;
 sharedBusy=true;sharedStatus('正在读取共享 JSON…');
 try{
  const remote=await sharedRequest('GET');sharedReady=true;sharedExamIds=new Set((remote.data?.exams||[]).map(exam=>exam.id));
  let draft=null;if(initial){
   if(remote.instanceId)draftKey='studytrail-grade-draft-v1:'+shareSettings.api+':'+remote.instanceId;
   try{
    const cached=localStorage.getItem(draftKey);
    draft=JSON.parse(cached);
    if(!cached&&remote.migrateLegacyDraft){
     const legacy=JSON.parse(localStorage.getItem(legacyDraftKey));
     if(legacy?.dirty&&legacy.data?.student===remote.data?.student){draft=legacy;localStorage.setItem(draftKey,JSON.stringify(legacy));}
    }
    if(draft?.dirty)C.validateData(draft.data);
   }catch{draft=null;}
   window.LearningDiary.setDraftScope?.(remote.instanceId,remote.migrateLegacyDraft);
  }
  if(draft?.dirty&&Number.isSafeInteger(draft.baseRevision)){
   data=draft.data;sharedRevision=draft.baseRevision;sharedDirty=true;
   sharedStatus(remote.revision===sharedRevision?'已恢复未共享草稿 · 共享版本 '+sharedRevision:'草稿基于旧版本 '+sharedRevision+'，共享记录已到版本 '+remote.revision+'。请先导出备份。',remote.revision!==sharedRevision);
  }else{
   sharedRevision=remote.revision;data=remote.data||structuredClone(SEED);sharedDirty=false;
   if(remote.data)cacheClean();
   sharedStatus(remote.data?'已读取'+(shareSettings.localTrial?'本地':'共享')+'版本 '+sharedRevision+' · '+new Date(remote.updatedAt).toLocaleString('zh-CN'):'欢迎使用学迹 · 请先配置跟踪对象');
  }
  selectedId=C.sorted(data.exams).at(-1)?.id||'';storageError='';render();ensureProfile();
 }catch(error){sharedStatus('读取失败：'+error.message+' 当前记录仍保留在页面中。',true);}
 finally{sharedBusy=false;$('shareSave').disabled=!sharedReady||!sharedDirty;$('shareRead').disabled=false;}
}
async function saveShared(){
 if(sharedBusy||!sharedReady||!sharedDirty)return false;
 if(!shareSettings.localTrial&&!editorCredential){$('editorDialog').showModal();return false;}
 sharedBusy=true;sharedStatus('正在保存到共享 JSON…');
 const snapshot=structuredClone(data);
 // Reuse the request ID after timeouts, so retrying an acknowledged write is harmless.
 if(!pendingRequest||JSON.stringify(pendingRequest.data)!==JSON.stringify(snapshot))pendingRequest={requestId:crypto.randomUUID(),baseRevision:sharedRevision,data:snapshot};
 try{
  const remote=await sharedRequest('POST',pendingRequest);sharedExamIds=new Set(remote.data.exams.map(exam=>exam.id));
  sharedRevision=remote.revision;pendingRequest=null;
  sharedDirty=JSON.stringify(data)!==JSON.stringify(snapshot);
  if(!sharedDirty)cacheClean();else saveDraft();
  sharedStatus('已保存到'+(shareSettings.localTrial?'本地 JSON':'云端 JSON')+' · 版本 '+sharedRevision+(sharedDirty?' · 还有修改待保存':''));
  toast(shareSettings.localTrial?'已保存到本地 JSON，其他浏览器可读取最新记录。':'云端保存成功，其他设备可读取最新记录。');
  return true;
 }catch(error){
  if(error.status===401)editorCredential='';
  sharedStatus('未共享：'+error.message+' 本机草稿已保留。',true);
  return false;
 }finally{sharedBusy=false;$('shareSave').disabled=!sharedDirty||!sharedReady;$('shareRead').disabled=false;}
}
$('shareRead').addEventListener('click',()=>loadShared(false));
$('shareSave').addEventListener('click',saveShared);
$('editorForm').addEventListener('submit',event=>{event.preventDefault();editorCredential=$('editorPassword').value;$('editorPassword').value='';$('editorDialog').close();saveShared();});
window.addEventListener('beforeunload',event=>{if(sharedDirty){event.preventDefault();event.returnValue='';}});
loadShared(true);
