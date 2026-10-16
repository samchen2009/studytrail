'use strict';
function exportName(){return (data.student?.trim()||'学习档案').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_');}
function renderProfile(){
 const name=data.student?.trim()||'建立学习档案';
 document.getElementById('profileName').textContent=name;
 document.getElementById('profileAvatar').textContent=Array.from(data.student?.trim()||'学')[0];
 document.getElementById('profileDetail').textContent=[data.profile?.grade||C.sorted(data.exams).at(-1)?.grade||'高中',data.profile?.school||'六科学习跟踪'].join(' · ');
 document.title=(data.student?.trim()?data.student.trim()+' · ':'')+'学迹 StudyTrail';
}
function openProfile(){
 const first=!data.student?.trim(),form=document.getElementById('profileForm');
 form.elements.student.value=data.student||'';
 form.elements.grade.value=data.profile?.grade||C.sorted(data.exams).at(-1)?.grade||'高一';
 form.elements.school.value=data.profile?.school||'';
 document.getElementById('profileTitle').textContent=first?'欢迎使用学迹':'跟踪对象设置';
 document.getElementById('profileCancel').hidden=first;
 document.getElementById('profileError').textContent='';
 if(!document.getElementById('profileDialog').open)document.getElementById('profileDialog').showModal();
}
function ensureProfile(){if(!data.student?.trim())openProfile();}
document.getElementById('profileEdit').addEventListener('click',()=>{if(sharedReady&&!sharedBusy)openProfile();else toast('请先读取本地记录，再修改对象设置。');});
document.getElementById('profileCancel').addEventListener('click',()=>document.getElementById('profileDialog').close());
document.getElementById('profileDialog').addEventListener('cancel',event=>{if(!data.student?.trim()||sharedBusy)event.preventDefault();});
document.getElementById('profileImport').addEventListener('click',()=>document.getElementById('importFile').click());
document.getElementById('profileForm').addEventListener('submit',async event=>{
 event.preventDefault();if(sharedBusy||!sharedReady)return;
 const form=event.target,button=document.getElementById('profileSubmit');button.disabled=true;document.getElementById('profileError').textContent='';
 try{
  const next={...data,student:form.elements.student.value.trim(),profile:{...data.profile,grade:form.elements.grade.value,school:form.elements.school.value.trim()}};
  C.validateData(next);data=next;saveDraft();render();
  if(!await saveShared())throw Error('档案尚未写入本地文件，请检查连接后再次保存。');
  document.getElementById('profileDialog').close();
 }catch(error){document.getElementById('profileError').textContent=error.message;}
 finally{button.disabled=false;}
});
