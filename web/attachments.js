'use strict';
let attachmentExamId='',attachmentItems=[],attachmentDeletedItems=[],attachmentBusy=false,attachmentKind='paper',attachmentReadVersion=0;
const attachmentLabels={paper:'试卷',answer:'答题卷',solution:'答案',practice:'练习'};
const attachmentSize=bytes=>bytes>=1024*1024?(bytes/1024/1024).toFixed(1)+' MB':Math.max(1,Math.ceil(bytes/1024))+' KB';
const attachmentUrl=id=>'/api/attachments/'+encodeURIComponent(id)+'/content';
function attachmentStatus(message,error=false){$('attachmentStatus').textContent=message;$('attachmentStatus').classList.toggle('down',error);}
function attachmentControls(){
 const saved=sharedExamIds.has(attachmentExamId);
 $('attachmentSaveNotice').hidden=saved;
 for(const id of ['uploadPaper','uploadAnswer','uploadSolution','uploadPractice'])$(id).disabled=attachmentBusy||!saved;
 $('attachmentSubject').disabled=attachmentBusy;
 $('attachmentDialog').querySelector('[data-close]').disabled=attachmentBusy;
 $('attachmentSaveExam').disabled=attachmentBusy||sharedBusy||!sharedReady;
 document.querySelectorAll('[data-delete-attachment],[data-restore-attachment],[data-view-attachment],#attachmentDeleteDialog button').forEach(button=>button.disabled=attachmentBusy);
}
async function attachmentRequest(url,options={}){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),120000);
 try{
  const response=await fetch(url,{...options,cache:'no-store',signal:controller.signal});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'附件请求失败。');
  return result;
 }catch(error){if(error.name==='AbortError')throw Error('附件请求超时，请检查文件列表后再重试。');throw error;}
 finally{clearTimeout(timeout);}
}
function renderAttachments(){
 const subject=$('attachmentSubject').value,trashOpen=$('attachmentTrash')?.open;
 $('attachmentList').innerHTML=Object.keys(attachmentLabels).map(kind=>{
  const items=attachmentItems.filter(item=>item.subject===subject&&item.kind===kind),label=attachmentLabels[kind];
  return `<section class="attachment-group"><div class="subject-title"><h3>${esc(subject)} · ${label}</h3><div class="attachment-group-actions"><span class="badge">${items.length} 份</span>${kind==='practice'?'<button type="button" class="secondary small" id="uploadPractice" data-upload-kind="practice" aria-label="上传练习">＋ 上传练习</button>':''}</div></div>${kind==='practice'?'<p class="hint">上传其他练习卷，按当前考试和科目归档。</p>':''}${items.length?`<ul class="attachment-files">${items.map(item=>`<li><span class="attachment-file-icon">${item.type==='application/pdf'?'PDF':'图'}</span><div class="attachment-file-info"><strong>${esc(item.name)}</strong><small>${attachmentSize(item.size)} · ${esc(new Date(item.createdAt).toLocaleString('zh-CN'))}</small></div><div class="attachment-file-actions"><button class="secondary small" data-view-attachment="${esc(item.id)}">查看</button><a class="text-btn" href="${attachmentUrl(item.id)}?download=1" download>下载</a><button class="text-btn attachment-delete" data-delete-attachment="${esc(item.id)}" aria-label="删除 ${esc(item.name)}">删除</button></div></li>`).join('')}</ul>`:`<p class="attachment-empty">还没有${label}，上传后可在这里点击查看。</p>`}</section>`;
 }).join('');
 const deleted=attachmentDeletedItems.filter(item=>item.subject===subject);
 $('attachmentList').insertAdjacentHTML('beforeend',`<details id="attachmentTrash" class="attachment-trash" ${trashOpen?'open':''}><summary>已删除附件（${deleted.length}）</summary><p class="hint">已删除的文件不再出现在正常列表中，恢复后可继续查看与下载。</p>${deleted.length?`<ul class="attachment-files">${deleted.map(item=>`<li><span class="attachment-file-icon">${item.type==='application/pdf'?'PDF':'图'}</span><div class="attachment-file-info"><strong>${esc(item.name)}</strong><small>${attachmentLabels[item.kind]||'附件'} · ${attachmentSize(item.size)} · 删除于 ${esc(new Date(item.deletedAt).toLocaleString('zh-CN'))}</small></div><button class="secondary small" data-restore-attachment="${esc(item.id)}" aria-label="恢复 ${esc(item.name)}">恢复</button></li>`).join('')}</ul>`:'<p class="attachment-empty">当前科目没有已删除附件。</p>'}</details>`);
 attachmentControls();
}
async function refreshAttachments(){
 const version=++attachmentReadVersion,id=attachmentExamId;
 if(!sharedExamIds.has(id)){attachmentItems=[];attachmentDeletedItems=[];renderAttachments();attachmentStatus('考试尚未保存，附件不会写入浏览器草稿。');return false;}
 attachmentStatus('正在读取附件…');
 try{
  const result=await attachmentRequest('/api/attachments?'+new URLSearchParams({examId:id}));
  if(version!==attachmentReadVersion)return false;
  attachmentItems=result.attachments;attachmentDeletedItems=result.deletedAttachments||[];renderAttachments();attachmentStatus('已读取 '+attachmentItems.length+' 份附件 · 切换科目查看相应资料');return true;
 }catch(error){if(version===attachmentReadVersion){renderAttachments();attachmentStatus('读取失败：'+error.message+' 当前显示上次已知的附件，可重新打开列表重试。',true);}return false;}
}
function openAttachments(id){
 if(attachmentBusy){toast('附件正在保存，请稍候。');return;}
 const exam=data.exams.find(item=>item.id===id);if(!exam)return;
 attachmentExamId=id;attachmentItems=[];attachmentDeletedItems=[];
 $('attachmentExamName').textContent=exam.grade+' · '+exam.name;
 $('attachmentSubject').innerHTML=S.map(subject=>`<option>${subject}</option>`).join('');
 renderAttachments();$('attachmentDialog').showModal();refreshAttachments();
}
async function uploadAttachments(files){
 if(!files.length||attachmentBusy)return;
 if(files.length>10){attachmentStatus('一次最多选择 10 个文件，请分批上传。',true);return;}
 if(!sharedExamIds.has(attachmentExamId)){attachmentStatus('请先保存考试记录。',true);return;}
 if(files.some(file=>file.size>20*1024*1024||!file.size)){attachmentStatus('请选择非空文件，每个文件不超过 20 MB。',true);return;}
 const examId=attachmentExamId,subject=$('attachmentSubject').value,kind=attachmentKind;
 attachmentBusy=true;attachmentControls();let saved=0;const errors=[];
 try{
  for(const [index,file]of files.entries()){
   attachmentStatus('正在上传 '+(index+1)+' / '+files.length+'：'+file.name);
   try{await attachmentRequest('/api/attachments?'+new URLSearchParams({examId,subject,kind,name:file.name}),{method:'POST',body:file});saved++;}
   catch(error){errors.push(file.name+'：'+error.message);}
  }
  await refreshAttachments();
  attachmentStatus('已保存 '+saved+' 份'+subject+attachmentLabels[kind]+(errors.length?'。'+errors.join('；'): '，点击“查看”即可打开。'),errors.length>0);
 }finally{attachmentBusy=false;attachmentControls();}
}
function rememberAttachment(item){
 attachmentItems=attachmentItems.filter(current=>current.id!==item.id);attachmentDeletedItems=attachmentDeletedItems.filter(current=>current.id!==item.id);
 (item.deletedAt?attachmentDeletedItems:attachmentItems).unshift(item);renderAttachments();
}
let pendingAttachmentDelete=null;
function confirmAttachmentDelete(id){
 if(attachmentBusy)return;
 const item=attachmentItems.find(item=>item.id===id);if(!item)return;
 pendingAttachmentDelete={id,examId:attachmentExamId,name:item.name};
 $('attachmentDeleteName').textContent=item.subject+' · '+(attachmentLabels[item.kind]||'附件')+' · '+item.name;
 $('attachmentDeleteError').textContent='';$('attachmentDeleteDialog').showModal();
}
async function deleteAttachment(){
 if(attachmentBusy||!pendingAttachmentDelete)return;
 const item=pendingAttachmentDelete;attachmentBusy=true;attachmentControls();
 try{
  const result=await attachmentRequest('/api/attachments/'+encodeURIComponent(item.id)+'?'+new URLSearchParams({examId:item.examId}),{method:'DELETE'});
  rememberAttachment(result.attachment);$('attachmentDeleteDialog').close();pendingAttachmentDelete=null;const refreshed=await refreshAttachments();
  $('attachmentTrash').open=true;attachmentStatus('已删除“'+item.name+'”，可在已删除附件中恢复。'+(refreshed?'':'最新列表读取失败，请重新打开核对。'),!refreshed);
 }catch(error){$('attachmentDeleteError').textContent='删除失败：'+error.message;}
 finally{attachmentBusy=false;attachmentControls();}
}
async function restoreAttachment(id){
 if(attachmentBusy)return;
 const item=attachmentDeletedItems.find(item=>item.id===id);if(!item)return;
 attachmentBusy=true;attachmentControls();attachmentStatus('正在恢复“'+item.name+'”…');
 try{
  const result=await attachmentRequest('/api/attachments/'+encodeURIComponent(id)+'/restore?'+new URLSearchParams({examId:attachmentExamId}),{method:'POST'});
  rememberAttachment(result.attachment);const refreshed=await refreshAttachments();attachmentStatus('已恢复“'+item.name+'”，可继续查看。'+(refreshed?'':'最新列表读取失败，请重新打开核对。'),!refreshed);
 }catch(error){attachmentStatus('恢复失败：'+error.message,true);}
 finally{attachmentBusy=false;attachmentControls();}
}
$('attachmentConfirmDelete').addEventListener('click',deleteAttachment);
$('attachmentDeleteDialog').addEventListener('cancel',event=>{if(attachmentBusy)event.preventDefault();});
let attachmentRotation=0,attachmentZoom=1,attachmentImage=null,attachmentPreviewReady=false;
function previewControls(){
 $('attachmentRotateLeft').disabled=!attachmentPreviewReady;$('attachmentRotateRight').disabled=!attachmentPreviewReady;
 $('attachmentRotationReset').disabled=!attachmentPreviewReady||attachmentRotation===0;$('attachmentRotationLabel').textContent=attachmentRotation+'°';
 $('attachmentZoomOut').disabled=!attachmentPreviewReady||attachmentZoom<=0.25;$('attachmentZoomIn').disabled=!attachmentPreviewReady||attachmentZoom>=4;
 $('attachmentZoomFit').disabled=!attachmentPreviewReady;$('attachmentZoomLabel').textContent=Math.round(attachmentZoom*100)+'%';
}
function previewPosition(){
 const preview=$('attachmentPreview');return {left:preview.scrollLeft,top:preview.scrollTop,width:preview.clientWidth,height:preview.clientHeight};
}
function restorePreviewPosition(position,ratio=1){
 const preview=$('attachmentPreview');
 preview.scrollLeft=position?(position.left+position.width/2)*ratio-preview.clientWidth/2:0;
 preview.scrollTop=position?(position.top+position.height/2)*ratio-preview.clientHeight/2:0;
}
function renderPreviewImage({position=null,ratio=1}={}){
 const image=attachmentImage;if(!image?.naturalWidth||!image.naturalHeight)return;
 const sideways=attachmentRotation%180!==0,width=Math.max(1,$('attachmentPreview').clientWidth-24);
 const scale=width/(sideways?image.naturalHeight:image.naturalWidth)*attachmentZoom;
 const imageWidth=image.naturalWidth*scale,imageHeight=image.naturalHeight*scale;
 const stage=image.parentElement;stage.style.width=(sideways?imageHeight:imageWidth)+'px';stage.style.height=(sideways?imageWidth:imageHeight)+'px';
 image.style.width=imageWidth+'px';image.style.height=imageHeight+'px';image.style.transform='translate(-50%, -50%) rotate('+attachmentRotation+'deg)';
 restorePreviewPosition(position,ratio);previewControls();
}
function rotateAttachment(degrees){
 if(!attachmentPreviewReady)return;attachmentRotation=(attachmentRotation+degrees+360)%360;
 if(attachmentImage)renderPreviewImage();else renderPdfPage();
}
function setAttachmentZoom(value){
 if(!attachmentPreviewReady)return;
 const next=Math.min(4,Math.max(0.25,Math.round(value*100)/100)),position=previewPosition(),ratio=next/attachmentZoom;
 attachmentZoom=next;
 if(attachmentImage)renderPreviewImage({position,ratio});else renderPdfPage({position,ratio});
}
$('attachmentZoomOut').addEventListener('click',()=>setAttachmentZoom(attachmentZoom-0.25));
$('attachmentZoomIn').addEventListener('click',()=>setAttachmentZoom(attachmentZoom+0.25));
$('attachmentZoomFit').addEventListener('click',()=>setAttachmentZoom(1));
$('attachmentRotateLeft').addEventListener('click',()=>rotateAttachment(-90));
$('attachmentRotateRight').addEventListener('click',()=>rotateAttachment(90));
$('attachmentRotationReset').addEventListener('click',()=>rotateAttachment(-attachmentRotation));
window.addEventListener('resize',()=>{if($('attachmentViewer').open&&attachmentImage&&attachmentPreviewReady)renderPreviewImage();});
let pdfModulePromise=null,pdfLoadingTask=null,pdfDocument=null,pdfRenderTask=null,pdfPageNumber=1,pdfPreviewVersion=0;
function closePdfPreview(){
 attachmentRotation=0;attachmentZoom=1;attachmentImage=null;attachmentPreviewReady=false;previewControls();
 pdfPreviewVersion++;if(pdfRenderTask)pdfRenderTask.cancel();pdfRenderTask=null;pdfDocument=null;
 if(pdfLoadingTask)pdfLoadingTask.destroy().catch(()=>{});pdfLoadingTask=null;
}
async function renderPdfPage({position=null,ratio=1}={}){
 if(!pdfDocument)return;
 const version=pdfPreviewVersion,document=pdfDocument,number=pdfPageNumber;
 attachmentPreviewReady=false;previewControls();
 $('pdfPrevious').disabled=true;$('pdfNext').disabled=true;
 $('attachmentPreviewStatus').textContent='正在显示第 '+number+' 页…';
 try{
  const page=await document.getPage(number);if(version!==pdfPreviewVersion)return;
  const rotation=(page.rotate+attachmentRotation)%360,viewport=page.getViewport({scale:1,rotation});
  const width=Math.max(1,$('attachmentPreview').clientWidth-24);
  const scale=width/viewport.width*attachmentZoom,scaled=page.getViewport({scale,rotation});
  // Keep high zoom readable without allocating an unbounded backing canvas.
  const pixelRatio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(16*1024*1024/(scaled.width*scaled.height)));
  const canvas=$('attachmentPreview').querySelector('canvas');
  canvas.width=Math.floor(scaled.width*pixelRatio);canvas.height=Math.floor(scaled.height*pixelRatio);
  canvas.style.width=Math.floor(scaled.width)+'px';canvas.style.height=Math.floor(scaled.height)+'px';
  pdfRenderTask=page.render({canvasContext:canvas.getContext('2d'),viewport:scaled,transform:pixelRatio!==1?[pixelRatio,0,0,pixelRatio,0,0]:null});
  await pdfRenderTask.promise;if(version!==pdfPreviewVersion)return;pdfRenderTask=null;
  canvas.setAttribute('aria-label','PDF 第 '+number+' 页，共 '+document.numPages+' 页，旋转 '+attachmentRotation+' 度');
  attachmentPreviewReady=true;
  $('pdfPageLabel').textContent=number+' / '+document.numPages+' 页';$('attachmentPreviewStatus').textContent='';
  restorePreviewPosition(position,ratio);
 }catch(error){if(version===pdfPreviewVersion&&error.name!=='RenderingCancelledException')$('attachmentPreviewStatus').textContent='预览失败，可下载原文件查看。';}
 finally{if(version===pdfPreviewVersion){$('pdfPrevious').disabled=number<=1;$('pdfNext').disabled=number>=document.numPages;previewControls();}}
}
let viewedAttachmentId='',viewedAttachmentSubject='';
function subjectAttachments(subject){
 return Object.keys(attachmentLabels).flatMap(kind=>attachmentItems.filter(item=>item.examId===attachmentExamId&&item.subject===subject&&item.kind===kind&&!item.deletedAt));
}
function updateAttachmentNavigation(){
 const items=subjectAttachments(viewedAttachmentSubject),index=items.findIndex(item=>item.id===viewedAttachmentId);
 $('attachmentPrevious').disabled=index<=0;
 $('attachmentNext').disabled=index<0||index>=items.length-1;
 $('attachmentPosition').textContent=index<0?'当前列表暂无附件':viewedAttachmentSubject+' · '+attachmentLabels[items[index].kind]+' · '+(index+1)+' / '+items.length+' 份';
}
function navigateAttachment(step){
 const items=subjectAttachments(viewedAttachmentSubject),index=items.findIndex(item=>item.id===viewedAttachmentId);
 if(index<0||index+step<0||index+step>=items.length)return;
 viewAttachment(items[index+step].id);
}
$('attachmentPrevious').addEventListener('click',()=>navigateAttachment(-1));
$('attachmentNext').addEventListener('click',()=>navigateAttachment(1));
async function viewAttachment(id){
 const item=attachmentItems.find(item=>item.id===id&&!item.deletedAt);if(!item)return;
 viewedAttachmentId=item.id;viewedAttachmentSubject=item.subject;updateAttachmentNavigation();
 closePdfPreview();const version=pdfPreviewVersion,url=attachmentUrl(id),isPdf=item.type==='application/pdf';
 $('attachmentViewerTitle').textContent=item.subject+' · '+item.name;
 const preview=$('attachmentPreview');preview.replaceChildren();$('attachmentPreviewStatus').textContent='';
 $('attachmentPdfControls').hidden=!isPdf;
 const element=document.createElement(isPdf?'canvas':'img');
 if(isPdf){element.setAttribute('role','img');$('pdfPrevious').disabled=true;$('pdfNext').disabled=true;$('pdfPageLabel').textContent='加载中';}
 else{
  attachmentImage=element;element.alt=item.name;
  element.addEventListener('load',()=>{if(version!==pdfPreviewVersion)return;attachmentPreviewReady=true;renderPreviewImage();});
  element.addEventListener('error',()=>{if(version!==pdfPreviewVersion)return;attachmentPreviewReady=false;previewControls();$('attachmentPreviewStatus').textContent='图片无法预览，请打开或下载原文件。';});
  element.src=url;
 }
 if(isPdf)preview.append(element);else{const stage=document.createElement('div');stage.className='attachment-image-stage';stage.append(element);preview.append(stage);}
 $('attachmentOpen').href=url;$('attachmentDownload').href=url+'?download=1';if(!$('attachmentViewer').open)$('attachmentViewer').showModal();
 if(!isPdf)return;
 $('attachmentPreviewStatus').textContent='正在加载 PDF…';
 try{
  pdfModulePromise??=import('/vendor/pdfjs/build/pdf.mjs').catch(error=>{pdfModulePromise=null;throw error;});
  const pdf=await pdfModulePromise;if(version!==pdfPreviewVersion)return;
  pdf.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/build/pdf.worker.mjs';
  pdfLoadingTask=pdf.getDocument({url,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/',iccUrl:'/vendor/pdfjs/iccs/',isEvalSupported:false,enableXfa:false});
  const loaded=await pdfLoadingTask.promise;if(version!==pdfPreviewVersion)return;
  pdfDocument=loaded;pdfPageNumber=1;await renderPdfPage();
 }catch(error){if(version===pdfPreviewVersion){$('attachmentPreviewStatus').textContent=error.name==='PasswordException'?'这是加密 PDF，请下载后输入密码查看。':'PDF 预览失败，请打开或下载原文件查看。';$('pdfPageLabel').textContent='无法预览';}}
}
$('pdfPrevious').addEventListener('click',()=>{if(pdfDocument&&pdfPageNumber>1){pdfPageNumber--;renderPdfPage();}});
$('pdfNext').addEventListener('click',()=>{if(pdfDocument&&pdfPageNumber<pdfDocument.numPages){pdfPageNumber++;renderPdfPage();}});
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.dataset.attachments)openAttachments(button.dataset.attachments);
 if(button.dataset.uploadKind)chooseAttachmentFiles(button.dataset.uploadKind);
 if(button.dataset.viewAttachment&&!attachmentBusy)viewAttachment(button.dataset.viewAttachment);
 if(button.dataset.deleteAttachment)confirmAttachmentDelete(button.dataset.deleteAttachment);
 if(button.dataset.restoreAttachment)restoreAttachment(button.dataset.restoreAttachment);
});
function chooseAttachmentFiles(kind){
 if(attachmentBusy||!sharedExamIds.has(attachmentExamId)||!Object.hasOwn(attachmentLabels,kind))return;
 attachmentKind=kind;$('attachmentFile').click();
}
for(const [id,kind]of [['uploadPaper','paper'],['uploadAnswer','answer'],['uploadSolution','solution']])$(id).addEventListener('click',()=>chooseAttachmentFiles(kind));
$('attachmentFile').addEventListener('change',event=>{const files=Array.from(event.target.files);event.target.value='';uploadAttachments(files);});
$('attachmentSubject').addEventListener('change',renderAttachments);
$('attachmentSaveExam').addEventListener('click',async()=>{await saveShared();attachmentControls();if(sharedExamIds.has(attachmentExamId))refreshAttachments();else attachmentStatus('考试尚未保存，请查看页面上的保存提示后重试。',true);});
// Keep the selected exam stable while an attachment is being saved.
$('attachmentDialog').addEventListener('cancel',event=>{if(attachmentBusy)event.preventDefault();});
$('attachmentViewer').addEventListener('close',()=>{closePdfPreview();viewedAttachmentId='';viewedAttachmentSubject='';$('attachmentPreview').replaceChildren();});
