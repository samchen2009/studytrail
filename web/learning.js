(function(root){
'use strict';
const L=LearningCore;
const LEGACY_DRAFT_KEY='learning-tracking-input-v1:'+location.pathname;
let DRAFT_KEY=LEGACY_DRAFT_KEY;
let noteDraft='',saveTimer=null,saveMessage='',visibleCount=10;
try{noteDraft=localStorage.getItem(DRAFT_KEY)||'';}catch{}
function model(){const l=data.learning||L.defaults();return {...l,checked:l.checked||[],entries:l.entries||[]};}
function ready(){try{return sharedReady;}catch{return false;}}
function formatTime(value){return new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
function saveInputDraft(){try{if(noteDraft)localStorage.setItem(DRAFT_KEY,noteDraft);else localStorage.removeItem(DRAFT_KEY);}catch{toast('输入草稿未能保存在浏览器，请及时保存跟踪记录。');}}
function setDraftScope(id,migrate){
 if(!id)return;
 DRAFT_KEY='studytrail-learning-input-v1:'+id;
 try{noteDraft=localStorage.getItem(DRAFT_KEY)??(migrate?localStorage.getItem(LEGACY_DRAFT_KEY):'')??'';if(noteDraft)localStorage.setItem(DRAFT_KEY,noteDraft);}catch{}
}
const methods={
 '课前预习':`<p class="learning-method-goal">用 5—10 分钟发现问题，让听课有重点。</p><ol>
 <li>浏览下一课的标题、核心概念和一两个例题，合上书用自己的话说出大意。</li>
 <li>尝试一道基础题，区分“看懂例题”和“自己能做”。</li>
 <li>留下 1—2 个具体疑问，例如“我知道公式，但不知道这道题为什么可以用”。</li>
 <li>把难点带到课堂，预习时不必解决所有难题，避免挤占作业和休息时间。</li>
 </ol><p class="learning-method-standard"><b>完成标准：</b>能说出明天学什么、自己具体哪里不懂。</p>`,
 '上课听讲':`<p class="learning-method-goal">抓住解题依据、关键转折和自己的疑问。</p><ol>
 <li>带着预习问题听课，听例题时问：题目有什么特征？为什么选这个方法？哪一步最容易错？</li>
 <li>笔记记录适用条件、关键步骤和未理解的地方。老师讲到关键步骤时，先预测下一步，再核对思路。</li>
 <li>课后用两分钟回忆核心内容，尝试解释一道例题，把仍不懂的问题写具体。</li>
 <li>主动解决卡点：先写已知条件和自己的尝试，再查课本或相近例题，仍不理解就带着卡点求助。听完讲解后，合上资料独立重做。</li>
 </ol><p class="learning-method-example"><b>提问示例：</b>“我列出了这个式子，但不理解为什么要舍去第二个解。”</p><p class="learning-method-standard"><b>完成标准：</b>预习疑问得到解答；仍未解决的问题有明确的求助或查阅安排。</p>`,
 '课后作业':`<p class="learning-method-goal">把会做的题做稳，形成固定的审题与检查习惯。</p><p>作业前先用两三分钟回忆当天的核心概念和例题方法，随后独立完成。</p>
 <dl class="learning-method-steps"><dt>读</dt><dd>看完整题干和所有小问，明确最后要求什么。</dd><dt>标</dt><dd>标出否定词、至少 / 至多、整数、范围和单位等容易看错的条件。</dd><dt>想</dt><dd>确定知识和方法；复杂题先画图或写关系式。</dd><dt>写</dt><dd>关键推导不跳步，草稿标注题号，计算按行排列。</dd><dt>查</dt><dd>核对漏条件、漏解、答非所问，以及结果是否合理。</dd></dl>
 <p><b>针对性检查：</b>负号和移项错误就核对符号；单位错误就检查换算；能验证的结果用代入、逆运算或估算检查，避免仅沿原思路再看一遍。</p>
 <p><b>先判断原因：</b>检查孩子能否独立解释和做对同类题。知识和计算方法不熟练时先补理解与练习，审题或书写失误则练对应的检查动作。</p>
 <p><b>训练重点：</b>每次优先纠正一两种高频错误。先练稳定性，再逐步加入限时要求。家长在完成后检查流程，让孩子先独立作答。</p>
 <p class="learning-method-standard"><b>完成标准：</b>保留真实作答痕迹，能说清错误发生在哪一步，并落实具体的检查动作。</p>`,
 '错题整理':`<p class="learning-method-goal">把错题变成可以解释、独立重做和迁移的知识。</p>
 <p>优先整理反复出错、涉及核心概念或具有代表性的题。题目可拍照、剪贴或记页码，把精力用于理解和重做。</p>
 <dl class="learning-method-steps"><dt>位置</dt><dd>哪一步错了，例如“第二步移项没有变号”。</dd><dt>原因</dt><dd>区分审题、概念、方法、计算、表达和时间问题，具体到错误行为。</dd><dt>依据</dt><dd>用自己的话说明正确方法为什么成立。</dd><dt>动作</dt><dd>写明下一次如何避免，例如“移项单独写一步，再核对符号”。</dd><dt>验证</dt><dd>合上答案重做，隔几天再做，再尝试一道变式题。</dd></dl>
 <p><b>复习节奏：</b>可从订正当天及约第 3、7、14 天复测开始；再次出错就提前复习，稳定掌握后延长间隔。这些间隔可按实际表现调整。</p>
 <p class="learning-method-standard"><b>掌握标准：</b>能解释方法，在不同日期独立做对两次，并能做对一道变式题。听懂或看答案会做后，仍需独立验证；过关后偶尔抽查。</p>`,
 '周末集中练习':`<p class="learning-method-goal">先修补漏洞，再检验综合表现。先为一门重点学科安排约 60—90 分钟，可拆成两段。</p>
 <ol><li><b>约 10 分钟：</b>回看近期错误和未解决问题，选出最值得解决的两个漏洞。</li>
 <li><b>约 20—30 分钟：</b>按“基础题 → 变式题”做针对练习。基础题还不理解时，先回到概念和例题；稳定后再增加难度。</li>
 <li><b>约 20—30 分钟：</b>混合新旧知识做限时小测，检验能否独立判断方法、分配时间和发现错误。</li>
 <li><b>约 10—20 分钟：</b>订正并回答：哪类错误减少了？哪个知识点仍不懂？哪些题耗时过多？下一阶段重点改变哪两个动作？</li></ol>
 <p class="learning-method-standard"><b>完成标准：</b>主要漏洞得到练习验证，并形成一两个明确的后续动作。</p>`,
 '考试技巧':`<p class="learning-method-goal">根据掌握程度和剩余时间取舍，优先把握能拿到的分数。平时用限时练习熟悉节奏。</p>
 <ol><li><b>第一轮：先做有把握的题。</b>路径清楚就完成；遇到卡点标记，避免长时间停留。</li>
 <li><b>第二轮：回到有突破方向的题。</b>结合剩余时间安排投入，区分“正在推进”和“反复读题但没有新进展”。</li>
 <li><b>第三轮：补步骤、尝试难题、检查。</b>按评分规则写出有依据的公式、关系式和推导；优先查漏题、漏小问和答题卡，再查个人高频错误。</li></ol>
 <p><b>跳过的时机：</b>数理题尝试两三分钟仍无新思路，可以先跳过；长阅读、作文和大题按各自的时间预算判断。</p>
 <p><b>检查与修改：</b>可先预留约考试时间的 10% 用于检查，再依据几次练习调整。修改答案应有明确理由，例如发现漏条件或计算错误。</p>
 <p class="learning-method-standard"><b>复盘重点：</b>区分不会做、会做却做错、没时间完成的失分，判断时间取舍是否有效。</p>`
};
function parentMethods(){return `<section class="learning-parent-methods"><div class="learning-group-title"><span>07</span><h3>家长辅导与监督</h3></div>
 <p class="learning-method-goal">先教会具体方法，再逐步减少提醒，让孩子学会主动解决问题。</p>
 <p><b>三个固定问题：</b>“你卡在哪一步？”“你已经试了什么？”“下一步准备怎么解决？”家长提供提示后，让孩子继续完成下一步；讲解后由孩子独立重做。</p>
 <div class="table-scroll"><table class="learning-parent-table"><thead><tr><th>推进阶段</th><th>家长怎么做</th><th>孩子怎么做</th></tr></thead><tbody>
 <tr><td>第 1 周：建立流程</td><td>示范审题、检查和解释错因</td><td>按提示完成，真实说出疑问</td></tr>
 <tr><td>第 2 周：主动发现</td><td>提示遗漏，让孩子提出下一步</td><td>主动标记卡点，选择查阅或求助</td></tr>
 <tr><td>第 3 周：自己安排</td><td>抽查一个知识点或一道错题</td><td>自己安排复测和问题处理</td></tr>
 <tr><td>第 4 周：自主执行</td><td>主要参与阶段复盘，薄弱环节继续支持</td><td>独立执行并汇报进展</td></tr>
 </tbody></table></div>
 <p>监督退出的速度根据实际表现调整。已经稳定做到的环节减少提醒，仍做不到的环节继续示范或指导。</p>
 <p><b>反馈具体行为：</b>“你发现了单位问题”“你把卡点说清楚了”“你主动找老师解决了疑问”。跟踪记录用于调整方法，帮助孩子看见进步。</p>
 <p class="learning-method-standard"><b>阶段跟踪看四件事：</b>可避免错误是否减少，未解决疑问是否积压，错题能否独立做对，家长提醒是否减少。可随时用跟踪输入框记录变化。</p>
 </section>`;}

function checklist(l){return `<section class="card learning-checklist"><div class="card-head"><div><h2>学习提升方法论与 checklist</h2><p>先了解具体做法，再勾选已经落实的行动。</p></div><span class="pill">已落实 ${l.checked.length} / ${L.checklistIds.length} 项</span></div><div class="learning-checklist-groups">${L.checklistGroups.map((group,index)=>`<section><div class="learning-group-title"><span>0${index+1}</span><h3>${group.title}</h3></div><div class="learning-method-body">${methods[group.title]}</div><p class="learning-execution-label">执行 checklist</p>${group.items.map(item=>`<label class="learning-check-item ${l.checked.includes(item.id)?'checked':''}"><input type="checkbox" data-learning-check="${item.id}" ${l.checked.includes(item.id)?'checked':''} ${ready()?'':'disabled'}><span>${esc(item.text)}</span></label>`).join('')}</section>`).join('')}</div>${parentMethods()}<p class="learning-method-foundation"><b>使用建议：</b>先选一两门重点学科执行。平日额外安排可从约 20—30 分钟开始，审题、步骤书写和检查融入原有作业；时间紧时缩短预习与整理，保留必要的独立重做。真正掌握要能独立解释、隔几天做对、换一种问法仍做对。</p><p class="hint">方法参考：<a href="https://ies.ed.gov/ncee/wwc/PracticeGuide/1" target="_blank" rel="noopener">IES 学习实践指南</a> · <a href="https://educationendowmentfoundation.org.uk/16-19/developing-independent-learners/metacognition-and-self-regulation" target="_blank" rel="noopener">EEF 自我管理学习指导</a>。时间和阶段安排可根据作业量与实际表现调整。</p></section>`;}
function noteForm(){return `<section class="card learning-note-card"><div class="card-head"><div><h2>跟踪记录</h2><p>有进展或发现问题时，随时写下一条。</p></div></div><form id="learningNoteForm"><label for="learningTrackingNote">这段时间的变化与下一步<textarea id="learningTrackingNote" name="note" rows="7" maxlength="5000" placeholder="例如：最近数学计算错误减少了，但遇到不懂的题还需要提醒。接下来重点练习主动求助和检查负号。" ${ready()?'':'disabled'}>${esc(noteDraft)}</textarea></label><div class="learning-note-footer"><small>保存时自动记录时间及当前清单状态。</small><button type="submit" class="primary" ${ready()?'':'disabled'}>保存跟踪记录</button></div><p id="learningNoteError" class="form-error" role="alert"></p><p id="learningSaveStatus" class="hint" role="status">${esc(saveMessage||'清单修改会自动保存；输入内容可留作草稿，写好后点击保存。')}</p></form></section>`;}
function history(l){const rows=l.entries.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return `<section class="card learning-tracking-history"><div class="card-head"><div><h2>历史跟踪记录</h2><p>${rows.length?'共 '+rows.length+' 条，最新的在前。':'记录会保存在这里，方便以后回看。'}</p></div></div>${rows.length?`<div class="learning-timeline">${rows.slice(0,visibleCount).map(entry=>`<article><div class="learning-entry-head"><time datetime="${entry.createdAt}">${formatTime(entry.createdAt)}</time><span class="badge">当时已落实 ${entry.checked.length} / ${L.checklistIds.length} 项</span></div><p>${esc(entry.text)}</p>${entry.checked.length?`<details><summary>查看当时勾选的做法</summary><ul>${L.checklistGroups.flatMap(group=>group.items.filter(item=>entry.checked.includes(item.id)).map(item=>`<li>${group.title}：${esc(item.text)}</li>`)).join('')}</ul></details>`:''}</article>`).join('')}</div>${rows.length>visibleCount?'<button class="secondary small" data-learning-more>显示更多记录</button>':''}`:'<div class="empty learning-history-empty">还没有跟踪记录。写下一点变化，开始积累学习过程。</div>'}${legacyHistory(l)}</section>`;}
function legacyHistory(l){const rows=[
 ...(l.daily||[]).map(r=>({date:r.date,text:r.subject+' · '+(r.note||L.steps.map(k=>({preview:'预习',lesson:'听讲',homework:'作业',review:'复测'})[k]+'：'+r.steps[k]).join('；'))})),
 ...(l.issues||[]).map(r=>({date:r.date,text:r.subject+' · '+r.title+'\n'+[['卡点',r.stuck],['错因',r.reason],['理解',r.basis],['下一步',r.prevention]].filter(([,v])=>v).map(([k,v])=>k+'：'+v).join('\n')})),
 ...(l.weekly||[]).map(r=>({date:r.week,text:r.subject+' · '+[['重点',r.focus],['发现',r.reflection],['下一步',r.nextFocus],['考试取舍',r.strategy]].filter(([,v])=>v).map(([k,v])=>k+'：'+v).join('\n')}))
 ].sort((a,b)=>b.date.localeCompare(a.date));
 return rows.length?`<details class="learning-previous-records"><summary>此前已有的记录（${rows.length} 条）</summary>${rows.map(r=>`<article><time>${esc(r.date)}</time><p>${esc(r.text)}</p></article>`).join('')}</details>`:'';
}
function renderLearning(){const l=model();return `<div class="lead"><div><h2>把学习方法落实到行动</h2><p>预习发现问题 → 课堂理解方法 → 作业检验掌握 → 错题修补漏洞 → 周末验证迁移。</p></div></div><div class="learning-simple-layout">${checklist(l)}${noteForm()}</div>${history(l)}`;}
function updateSaveMessage(text){saveMessage=text;const status=$('learningSaveStatus');if(status)status.textContent=text;}
function commit(l){C.validateData({...data,learning:l});data={...data,learning:l};persist();root.render();}
async function flushSave(){
 saveTimer=null;
 if(!ready()){updateSaveMessage('记录已保留为浏览器草稿，连接成功后可保存到本地 JSON。');return;}
 if(sharedBusy){saveTimer=setTimeout(flushSave,200);return;}
 if(!sharedDirty)return;
 updateSaveMessage('正在保存…');
 const success=await saveShared();
 if(success){updateSaveMessage('已保存'+(shareSettings.localTrial?'到本地 JSON':'到云端 JSON')+'，可以随时回来查看。');if(sharedDirty)scheduleSave();}
 else updateSaveMessage('保存未完成，浏览器草稿已保留。可点击页面顶部的保存按钮重试。');
}
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(flushSave,400);}
 document.addEventListener('change',event=>{const input=event.target;if(!input.dataset.learningCheck)return;try{const l=model();l.checked=input.checked?[...new Set([...l.checked,input.dataset.learningCheck])]:l.checked.filter(id=>id!==input.dataset.learningCheck);updateSaveMessage('清单已更新，正在保存…');commit(l);scheduleSave();}catch(error){toast(error.message);root.render();}});
 document.addEventListener('input',event=>{if(event.target.id==='learningTrackingNote'){noteDraft=event.target.value;saveInputDraft();const error=$('learningNoteError');if(error)error.textContent='';}});
 document.addEventListener('submit',event=>{if(event.target.id!=='learningNoteForm')return;event.preventDefault();const text=event.target.elements.note.value.trim();if(!text){$('learningNoteError').textContent='请先写下一点进展、问题或下一步安排。';return;}
  try{const l=model();l.entries=[...l.entries,{id:crypto.randomUUID(),createdAt:new Date().toISOString(),text,checked:[...l.checked]}];L.validate(l);noteDraft='';saveInputDraft();updateSaveMessage('跟踪记录已加入历史，正在保存…');commit(l);clearTimeout(saveTimer);flushSave();}catch(error){$('learningNoteError').textContent=error.message;}
 });
 document.addEventListener('click',event=>{if(event.target.closest('[data-learning-more]')){visibleCount+=10;root.render();}});
 root.LearningDiary={setDraftScope,render:renderLearning};
})(window);
