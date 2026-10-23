(function(root){
'use strict';
const G=root.GradingCore,roles={student:'学生作答',paper:'空白试卷',reference:'参考答案'};
let jobs=[],deletedJobs=[],trashOpen=false,deleteTarget=null,active=null,loaded=false,loading=false,busy=false,message='',bad=false,pdfPromise=null,readerIndex=0,showMarks=true,zoom=1;
let readerRotation=0,readerImage=null,readerReady=false,readerVersion=0,readerEditing=false,readerSelection=null,readerSaving=false;
let apiModule=null,apiRunner=null,apiDetected=false,apiPhase='idle',apiText='正在检测 Tandix…',apiProgress='',aiRunning=false,aiCancelRequested=false,aiMode='pages',aiTimeoutMs=600000;
let aiRun=null,aiRunJobId=null,runWriteQueue=Promise.resolve(),progressTimer=null,apiCheckpoint={},aiResuming=false;
const resumeRequirements=new Map();
const blockedRunStates=new Set(['preparing','submitting','running','interrupted','resuming','received']);
const pendingResults=new Map(),pendingModes=new Map(),extraRequirements=new Map();
let exportFiles={jobId:null,revision:0,files:{}};
const draft={title:'',subject:'数学',grade:'',expectedMax:'',instructions:'',autoCollectMistakes:true,files:{student:[],paper:[],reference:[]}};
const node=id=>document.getElementById(id),e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=value=>value===null?'待核':String(G.round(value));
const url=asset=>'/api/grading/jobs/'+active.data.id+'/files/'+asset.id;
function redraw(){if(typeof page!=='undefined'&&page==='grading')render();}
function status(value,error=false){message=value;bad=error;redraw();}
async function request(path,options={}){const r=await fetch('/api/grading/'+path,{cache:'no-store',...options});let value;try{value=await r.json();}catch{throw Error('批改接口返回无效，请重启本地服务后重试。');}if(!r.ok)throw Object.assign(Error(value.error||'批改请求失败。'),{status:r.status});return value;}
const post=(path,body)=>request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function refresh(){if(loading)return;loading=true;try{const result=await request('jobs');jobs=result.jobs;deletedJobs=result.deletedJobs||[];loaded=true;if(!active&&!busy){let previous;try{previous=localStorage.getItem('studytrail-grading-selected');}catch{}if(jobs.some(j=>j.id===previous))queueMicrotask(()=>select(previous));}}catch(error){message=error.message;bad=true;}finally{loading=false;redraw();}}
async function select(id){
 if(busy)return;busy=true;
 try{active=await request('jobs/'+id);if(active.data.result)try{active.questionAssets=await request('jobs/'+id+'/questions');}catch{}await readRun(id);await refreshExports();readerIndex=0;message='已读取本地批改任务';bad=false;try{localStorage.setItem('studytrail-grading-selected',id);}catch{}}
 catch(error){message=error.message;bad=true;}
 finally{busy=false;redraw();}
 if(active?.data.id===id&&aiRun?.data.providerProtocol==='tandix-recovery-v1'&&['submitting','running','interrupted','resuming'].includes(aiRun.data.status))queueMicrotask(()=>recoverTask(false));
}
function renderGrading(){
 queueMicrotask(()=>root.MistakeNotebook?.decorate());
 queueMicrotask(()=>import('/grading-math.mjs').then(m=>m.renderReportMath(node('gradingReport'))).catch(()=>{}));
 if(!loaded&&!loading)queueMicrotask(refresh);
 if(!apiDetected){apiDetected=true;queueMicrotask(detectTandix);}
 return `<div class="lead"><div><h2>试卷批改</h2><p>把手写过程看清楚，把每一分讲明白。</p></div><button class="secondary small" data-grading="refresh" ${busy?'disabled':''}>重新读取</button></div><p id="gradingStatusInline" class="grading-status ${bad?'down':''}" role="status">${e(message||'原卷与批改记录保存在本机 .data/grading/。')}</p><section class="card grading-guide"><div><span class="eyebrow">TANDIX WEB API</span><h2>上传图片 / PDF → HTML 批改卷与解答</h2><p>使用已安装新版 Tandix 的 Chrome / Edge，选择并登录 Codex。上传试卷后点击“开始 AI 批改”，首次在扩展授权页允许当前站点，之后自动批改，在本机生成 HTML 批改卷与解答，题图独立保存，可逐题一键加入错题本；需要 PDF 时再打印保存。</p><p class="hint">点击开始后，仅本任务选择发送的卷面和批改要求会交给 Tandix，并可能发送给 Codex 所用的模型服务。原卷未标分值时，每题按 10 分估算，并显示折合成绩；字迹不清的题保留待核。</p></div></section><div class="grading-workspace"><aside class="card grading-library"><div class="card-head"><h2>本地试卷</h2><button class="text-btn" data-grading="new" ${busy?'disabled':''}>＋ 新建</button></div>${jobs.length?jobs.map(j=>`<button class="grading-job ${active?.data.id===j.id?'selected':''}" data-grading-job="${e(j.id)}" ${busy?'disabled':''}><strong>${e(j.title)}</strong><small>${e(j.subject)} · ${j.pages} 页 · ${j.summary.questionCount} 题</small><span>${j.summary.complete?(j.summary.estimated?'估算 ':'总分 ')+n(j.summary.score)+' / '+n(j.summary.maxScore):j.summary.questionCount?'待核 '+j.summary.pending+' 题':'等待批改'}</span></button>`).join(''):`<div class="empty">${loading?'正在读取…':'还没有批改任务。上传第一份试卷开始。'}</div>`}${trashView()}</aside><div class="grading-main">${active?jobView():createForm()}</div></div>`;
}
function createForm(){return `<section class="card"><h2>上传一份试卷</h2><p class="hint">可混合上传图片和 PDF。每份任务最多 10 个原文件、30 页，每个文件不超过 20 MB。文件顺序即阅读顺序。</p><form id="gradingCreateForm"><fieldset ${busy?'disabled':''}><div class="form-grid"><label>试卷名称<input name="title" value="${e(draft.title)}" required maxlength="100" placeholder="例如：数学周测"></label><label>科目<select name="subject">${['数学','语文','英语','物理','化学','地理'].map(s=>`<option ${draft.subject===s?'selected':''}>${s}</option>`).join('')}</select></label><label>年级<select name="grade">${['高一','高二','高三'].map(g=>`<option ${(draft.grade||(typeof data!=='undefined'?data.profile?.grade:''))===g?'selected':''}>${g}</option>`).join('')}</select></label><label>整卷满分（选填）<input name="expectedMax" value="${e(draft.expectedMax)}" type="number" min="0.01" max="2000" step="0.01" placeholder="留空则从卷面识别"></label></div><label>批改要求 / 评分标准（选填）<textarea name="instructions" maxlength="10000" rows="3" placeholder="例如：按过程给分；几何题尽量提供坐标法与综合法；答案跨页时请合并同一题。">${e(draft.instructions)}</textarea></label>${Object.entries(roles).map(([role,label])=>`<label>${label}${role==='student'?'（必选）':'（选填）'}<input type="file" name="${role}" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple ${role==='student'&&!draft.files.student.length?'required':''}><small>${draft.files[role].map(f=>e(f.name)).join('、')}</small></label>`).join('')}<p class="hint">学生作答应含题干；若只有答题纸，请同时上传空白试卷。PDF 在本机转换为阅读图片，原文件完整保留。</p><label class="mn-check"><input type="checkbox" name="autoCollectMistakes" ${draft.autoCollectMistakes?'checked':''}>批改完成后自动收集错题</label><button class="primary" type="submit">${busy?'正在处理文件…':'保存文件并准备批改'}</button></fieldset></form></section>`;}
function jobView(){const j=active.data,s=G.scoreReport(j);return `<section class="card"><div class="card-head"><div><span class="eyebrow">${e(j.grade)} · ${e(j.subject)}</span><h2>${e(j.title)}</h2><p>${j.files.length} 个原文件 · ${j.pages.length} 页 · 本地版本 ${active.revision}</p></div><div class="grading-actions"><button class="primary" data-grading="start-ai" ${!j.pages.length||busy||aiRunJobId===j.id&&blockedRunStates.has(aiRun?.data.status)?'disabled':''}>${j.result?'重新 AI 批改':'开始 AI 批改'}</button><button class="secondary" data-grading="cancel-ai" ${!aiRunning||apiPhase==='saving'?'disabled':''}>取消批改</button><button class="danger" data-grading="delete-job" ${busy?'disabled':''}>删除试卷</button></div></div>${j.instructions?`<div class="banner grading-prose">${e(j.instructions)}</div>`:''}${apiControls()}<div class="grading-source-list">${j.files.map(f=>`<a href="${url(f)}?download=1" download>${e(roles[f.role])} · ${e(f.name)}</a>`).join('')}</div>${j.files.some(f=>!f.complete)?'<p class="down">有原文件尚未生成阅读页，请新建任务重新上传该文件，不能把当前任务当作完整试卷。</p>':''}<div class="grading-page-grid">${j.pages.map((p,i)=>`<button class="grading-page" data-grading-read="${i}"><img src="${url(p)}" alt="${e(roles[p.role]+' '+p.name)}" loading="lazy"><span>${e(roles[p.role])} · 第 ${p.pageNumber} 页</span><small>${e(p.id)}</small></button>`).join('')}</div><p class="hint">点击页面可核对原卷与批改位置。API 会接收所选附件及页码映射，参考答案页面不计入学生得分。</p></section><section class="grading-scoreboard card"><div><span>${e(s.title)}</span><strong>${e(s.value)}</strong>${s.outOfTen?`<p class="grading-normalized">折合 <b>${e(s.outOfTen)}</b></p>`:''}<p>${e(s.note)}</p></div><div class="grading-score-facts"><span class="grade-correct">✓ 全对 ${s.correct}</span><span class="grade-incorrect">× 错误 ${s.incorrect}</span><span>部分得分 ${s.partial}</span><span>待核 ${s.pending}</span><span>未批 ${s.missingPages} 页</span><span>共 ${s.questionCount} 题</span></div>${s.unknownMax?'<p class="hint">这份旧结果未给分值，待核题以每题 10 分显示范围。请点击“重新 AI 批改”，按新的估算评分规则补充逐题得分。</p>':''}</section>${j.result?`<section class="card"><div class="card-head"><div><h2>本卷错题</h2><p class="hint">${j.autoCollectMistakes===false?'本卷未开启自动收集，可手动整理。':'已确认失分题在评分保存后自动整理。'}不确定的判题仍在本页核对。</p></div><div class="mn-actions"><button class="primary small" data-mn-view-subject="${e(j.subject)}" data-mn-source="${e(j.id)}">查看本卷错题</button><button class="secondary small" data-mn-sync-job="${e(j.id)}">整理 / 重试收集</button></div></div></section>`:''}${j.result?exportOutputs():''}<details class="card grading-result-input"><summary>高级：结果检查与恢复</summary><p class="hint">API 返回结果会自动校验并保存。若模型格式有误或保存冲突，原始 JSON 会保留在这里供修正重试，无需重新调用模型。手动提交相同题目标识会更新结果并清除该题旧人工复核。</p><details><summary>批改结果格式与评分约定</summary><pre class="grading-contract">${e(contract())}</pre></details><form id="gradingResultForm"><label>批改结果 JSON<textarea id="gradingResultJson" name="result" rows="6" placeholder="API 结果将自动保存；失败时可在此修正 JSON 后重试" ${busy?'disabled':''} required>${e(pendingResultText())}</textarea></label><div class="grading-actions"><button type="submit" class="primary" ${busy?'disabled':''}>校验并保存批改结果</button><button type="button" class="secondary" data-grading="export-pending" ${!pendingResultText()?'disabled':''}>下载待保存 JSON</button></div></form></details>${j.result?`<section class="grading-report" id="gradingReport"><div class="card grading-report-head"><div><h2>逐题答案与解析</h2><p class="hint">绿色 ✓ 为全对，红色 × 为错误，橙色 △ 为部分得分，黄色 ? 为待核。AI 位置仅供参考，可在查看器中选题号后点击卷面校准。</p></div><div class="grading-actions"><button class="secondary small" data-grading="export-json" ${busy?'disabled':''}>导出 JSON</button><button class="secondary small" data-grading="export-report" ${busy?'disabled':''}>下载离线解答 HTML</button></div></div>${j.result.questions.map(questionCard).join('')}<section class="card grading-knowledge"><h2>知识点总结</h2>${j.result.knowledgeSummary.map(k=>`<article><h3>${e(k.topic)}</h3><p class="grading-prose">${e(k.summary)}</p>${k.commonMistakes.length?`<h4>常见误区</h4>${bullets(k.commonMistakes)}`:''}${k.practice.length?`<h4>巩固练习与方法</h4>${bullets(k.practice)}`:''}</article>`).join('')||'<p>尚未提供知识点总结，可让 Tandix 补充后再次提交。</p>'}<h3>教师建议</h3><p class="grading-prose">${e(j.result.overallFeedback)}</p></section></section>`:''}`;}
function bullets(items){return '<ul>'+items.map(t=>'<li class="grading-prose">'+e(t)+'</li>').join('')+'</ul>';}
function questionPictures(q){const item=active.questionAssets?.questions.find(item=>item.questionId===q.id),images=item?.assets.filter(a=>a.role==='question')||[];return `${images.some(a=>a.kind==='full')?'':`<p class="grading-prose">${e(q.stem)}</p>`}${images.map(a=>`<img class="grading-question-image" src="${e(a.url)}" alt="第 ${e(q.number)} 题原图" loading="lazy">`).join('')}`;}
function questionCard(q){const review=active.data.reviews[q.id],s=G.questionState(q,review),label=G.statusStyle[s.status].mark+' '+G.statusStyle[s.status].label;return `<details class="card grading-question" id="grading-question-${e(q.id)}"><summary><span class="grade-${s.status}">${label}</span><strong>第 ${e(q.number)} 题</strong><span>${e(G.scoreLabel(s))}${s.manual?' · 人工复核':''}</span></summary><div class="grading-question-body"><div class="mn-actions"><button type="button" class="secondary small" data-mn-collect-job="${e(active.data.id)}" data-mn-collect-question="${e(q.id)}">加入错题本</button></div><h3>题干</h3>${questionPictures(q)}<div class="grading-answer-comparison"><div><h3>识别到的手写作答</h3><p class="grading-prose">${e(q.studentAnswer)||'（未识别到作答）'}</p><small>识别置信度 ${Math.round(q.confidence*100)}%</small></div><div><h3>参考答案</h3><p class="grading-prose">${e(q.answer)}</p></div></div>${q.needsReview?`<p class="banner">${review?'AI 原始待核说明':'待核说明'}：${e(q.reviewReason||'字迹、评分依据或分值需要人工确认。')}</p>`:''}${s.estimated?`<p class="hint">估算评分：${e(q.scoringNote||'未标原卷分值，每题按 10 分参考评分。')}</p>`:''}<h3>教师评语</h3><p class="grading-prose">${e(q.feedback)}</p>${q.rubric.length?`<div class="table-scroll"><table><thead><tr><th>评分点</th><th>满分</th><th>AI 给分</th></tr></thead><tbody>${q.rubric.map(r=>`<tr><td>${e(r.criterion)}${r.evidence?`<p class="hint">作答证据：${e(r.evidence)}</p>`:''}${r.reason?`<p class="hint">给分理由：${e(r.reason)}</p>`:''}</td><td>${n(r.maxScore)}</td><td>${n(r.score)}</td></tr>`).join('')}</tbody></table></div>`:''}${q.methods.map((m,i)=>`<section class="grading-method"><h3>方法 ${i+1} · ${e(m.title)}</h3><ol>${m.steps.map(step=>'<li class="grading-prose">'+e(step)+'</li>').join('')}</ol></section>`).join('')}${q.diagrams.map(diagramSvg).join('')}<div class="tags">${q.knowledgePoints.map(k=>'<span>'+e(k)+'</span>').join('')}</div>${review?`<div class="banner grading-prose">人工复核：${e(review.note)}<br>核对后作答：${e(review.studentAnswer)}<br>复核时间：${e(new Date(review.updatedAt).toLocaleString('zh-CN'))}</div>`:''}<details class="grading-review"><summary>核对字迹与人工调整得分</summary><p class="hint">核对原卷、答案与评分依据后再提交；复核说明会随报告保存。如果作答识别有误，请先要求 Tandix 基于正确作答重新批改，再决定得分。</p><form data-grading-review="${e(q.id)}"><label>核对后的作答<textarea name="studentAnswer" rows="3" maxlength="12000">${e(review?.studentAnswer??q.studentAnswer)}</textarea></label><div class="form-grid"><label>得分（留空仍待核）<input name="score" type="number" min="0" max="1000" step="0.01" value="${s.score??''}"></label><label>满分（留空仍待核）<input name="maxScore" type="number" min="0.01" max="1000" step="0.01" value="${s.maxScore??''}"></label></div><label>复核依据与修改说明<textarea name="note" rows="2" maxlength="5000" required>${e(review?.note||'')}</textarea></label><button class="secondary" ${busy?'disabled':''}>保存人工复核</button></form></details></div></details>`;}
const colors={ink:'#263f3a',green:'#16834c',red:'#d33b42',blue:'#2563b8',gray:'#7c8785'};
function diagramSvg(d){const shape=s=>{const color=colors[s.color]||colors.ink;if(s.type==='text')return `<text x="${s.x}" y="${s.y}" fill="${color}" font-size="16">${e(s.text)}</text>`;if(s.type==='polyline')return `<polyline points="${s.points.map(p=>p.join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`;const keys=s.type==='line'?['x1','y1','x2','y2']:s.type==='circle'?['cx','cy','r']:['x','y','width','height'];return `<${s.type} ${keys.map(k=>k+'="'+s[k]+'"').join(' ')} fill="none" stroke="${color}" stroke-width="2"/>`;};return `<figure class="grading-diagram"><figcaption>${e(d.title)}</figcaption><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" role="img" aria-label="${e(d.title)}">${d.shapes.map(shape).join('')}</svg><p class="hint">${e(d.description)}</p></figure>`;}
function contract(){const p=active?.data.pages.find(p=>p.role!=='reference');return JSON.stringify({schemaVersion:G.SCHEMA,reviewedPageIds:p?[p.id]:[],questions:[{id:'q1',number:'1',stem:'完整题干（含小问）',studentAnswer:'如实转写手写作答，不补写未写步骤',answer:'正确答案',maxScore:10,score:6,scoreBasis:'estimated',scoringNote:'原卷未标分值，本题按 10 分，按步骤分配 6+4 分',confidence:0.95,needsReview:false,reviewReason:'',feedback:'指出正确步骤、具体错误及改进方法',regions:[{pageId:p?.id||'页面ID',x:0.35,y:0.4,anchorText:'附近实际可见的题号、公式或作答片段'}],rubric:[{criterion:'评分点一',maxScore:6,score:6,evidence:'学生实际写出的正确步骤',reason:'满足本评分点'},{criterion:'评分点二',maxScore:4,score:0,evidence:'学生实际错误或缺失的步骤',reason:'指出具体错误与扣分依据'}],methods:[{title:'常规方法',steps:['说明用到的条件与公式','逐步推导，写出关键中间结果','检验、单位、结论']},{title:'另一种适用方法',steps:['给出确实适用的另一思路及完整推导；不存在时只保留常规方法']}],knowledgePoints:['知识点名称'],diagrams:[{title:'原理示意图（仅在有帮助时）',description:'图形元素支持 line/polyline/circle/rect/text，坐标范围 0～600，画布 600×600。不得填 SVG 或 HTML。',shapes:[{type:'line',x1:80,y1:500,x2:520,y2:500,color:'ink'},{type:'text',x:100,y:470,text:'示意图',color:'blue'}]}]}],knowledgeSummary:[{topic:'知识点',summary:'定义、核心关系、适用条件及本卷联系',commonMistakes:['本卷暴露的误区与修正'],practice:['有针对性的复习与练习建议']}],overallFeedback:'整卷建议'},null,2)+'\n约定：先检查完整题干、手写痕迹和跨页关系。题目标识在任务中唯一，同一题跨页合并 regions，分次提交保持 id 不变。\n卷面明确标注分值时 scoreBasis=paper。原卷未标分值时，全部题目按每题 10 分的统一参考量表评分，scoreBasis=estimated，scoringNote 说明各步骤如何分配 10 分；不得仅因缺少原卷分值把 score/maxScore 留空或标记待核。题目应给出具体得分如 8/10；只有作答无法辨认、题干不全或答案仍无法判断时 score=null、needsReview=true，并保留数字 maxScore。识别置信度低于 0.8 自动待核。评分点之和必须等于本题满分、得分。部分正确按步骤给分，不猜测隐含步骤。\n页位置 x/y 是完整原图宽/高的比例（0～1），不是浏览器屏幕坐标。所有 regions 的页必须在本批 reviewedPageIds 中。参考答案不是学生作答，不可标记或计分。图形颜色只允许 ink/green/red/blue/gray。公式可使用Unicode，或用LaTeX数学分隔符 \\( ... \\) / \\[ ... \\]；化学方程式在数学分隔符中使用 \\ce{...}。JSON字符串中的反斜杠须按JSON规范转义。不输出完整TeX文档、HTML或脚本。\n参考答案与推导矛盾时明确指出并待核；不能仅照抄参考答案。尽可能提供适用的多种解法和帮助理解的图形，不为凑数编造。';}
async function decodeImage(file){const objectUrl=URL.createObjectURL(file);try{const image=new Image();image.src=objectUrl;await image.decode();if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>80_000_000)throw Error('图片过大或无法读取。');return image;}finally{URL.revokeObjectURL(objectUrl);}}
async function renderPages(file,onPage){
 if(file.name.toLowerCase().endsWith('.pdf')){
  pdfPromise??=import('/vendor/pdfjs/build/pdf.mjs');const pdf=await pdfPromise;pdf.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/build/pdf.worker.mjs';
  const loading=pdf.getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/',iccUrl:'/vendor/pdfjs/iccs/',isEvalSupported:false,enableXfa:false});
  let document;try{document=await loading.promise;if(document.numPages>30)throw Error('单份 PDF 超过 30 页，请先拆分。');for(let i=1;i<=document.numPages;i++){const p=await document.getPage(i),raw=p.getViewport({scale:1}),scale=Math.min(2.5,2400/Math.max(raw.width,raw.height));const viewport=p.getViewport({scale}),canvas=window.document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await p.render({canvasContext:canvas.getContext('2d'),viewport,background:'white'}).promise;await onPage(await toBlob(canvas),i,{width:canvas.width,height:canvas.height});p.cleanup();canvas.width=0;canvas.height=0;}return document.numPages;}finally{await loading.destroy();}
 }else{const image=await decodeImage(file),scale=Math.min(1,3200/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);await onPage(await toBlob(canvas),1,{width:canvas.width,height:canvas.height});return 1;}
}
const toBlob=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('图像转换失败。')),'image/jpeg',0.94));
async function create(form){
 if(busy)return;const inputs=['student','paper','reference'].flatMap(role=>[...(form.elements[role].files.length?form.elements[role].files:draft.files[role])].map(file=>({file,role})));
 if(!inputs.some(x=>x.role==='student'))return status('请上传学生作答。',true);
 if(inputs.length>10||inputs.some(x=>!x.file.size||x.file.size>20*1024*1024||!(/\.(pdf|png|jpg|jpeg|webp)$/i.test(x.file.name))))return status('请选择不超过 10 份有效文件，每份不超过 20 MB。',true);
 const fields={title:form.elements.title.value.trim(),subject:form.elements.subject.value,grade:form.elements.grade.value,instructions:form.elements.instructions.value,expectedMax:form.elements.expectedMax.value===''?null:Number(form.elements.expectedMax.value),autoCollectMistakes:form.elements.autoCollectMistakes.checked};
 busy=true;status('正在创建任务并处理文件…');
 try{
  active=await post('jobs',fields);try{localStorage.setItem('studytrail-grading-selected',active.data.id);}catch{}aiRun=null;aiRunJobId=active.data.id;apiProgress='';
  for(const {file,role}of inputs){
   status('正在保存 '+file.name+'…');
   const beforeIds=new Set(active.data.files.map(f=>f.id));
   active=await request('jobs/'+active.data.id+'/assets?'+new URLSearchParams({kind:'original',role,name:file.name}),{method:'POST',headers:{'X-Base-Revision':String(active.revision)},body:file});
   const source=active.data.files.find(f=>!beforeIds.has(f.id));
   const pageCount=await renderPages(file,async(blob,pageNumber,size)=>{status('正在生成 '+file.name+' 第 '+pageNumber+' 页…');active=await request('jobs/'+active.data.id+'/assets?'+new URLSearchParams({kind:'page',role,name:source.id+'-'+pageNumber+'.jpg',sourceId:source.id,pageNumber:String(pageNumber),width:String(size.width),height:String(size.height)}),{method:'POST',headers:{'X-Base-Revision':String(active.revision)},body:blob});});
   active=await post('jobs/'+active.data.id+'/complete',{baseRevision:active.revision,sourceId:source.id,pageCount});
  }
  message='文件已在本机保存。点击“开始 AI 批改”可通过 Tandix Web API 自动批改并保存结果。';bad=false;
 }catch(error){message='上传未完成：'+error.message+' 已保存的原文件保留在任务中，请重新建立完整任务；不完整试卷不能给出最终总分。';bad=true;}
 finally{busy=false;await refresh();redraw();}
}
function marksFor(p){return G.pageMarks(active.data,p).map(item=>({...item,s:item.state}));}
function readerControls(){
 const count=active?.data.pages.length||0;
 node('gradingReaderPrevious').disabled=readerSaving||readerIndex<=0;node('gradingReaderNext').disabled=readerSaving||readerIndex>=count-1;
 for(const id of ['gradingRotateLeft','gradingRotateRight','gradingZoomFit','gradingShowMarks','gradingDownloadImage'])node(id).disabled=!readerReady||readerSaving;
 node('gradingRotationReset').disabled=!readerReady||readerSaving||readerRotation===0;
 node('gradingEditPositions').disabled=!readerReady||busy||!marksFor(active.data.pages[readerIndex]).length;node('gradingEditPositions').textContent=readerEditing?'完成位置校准':'校准标记位置';node('gradingResetPosition').hidden=!readerEditing;node('gradingResetPosition').disabled=busy||!readerSelection;
 node('gradingZoomOut').disabled=!readerReady||readerSaving||zoom<=0.25;node('gradingZoomIn').disabled=!readerReady||readerSaving||zoom>=4;
 node('gradingRotation').textContent=readerRotation+'°';node('gradingZoom').textContent=Math.round(zoom*100)+'%';
 node('gradingShowMarks').textContent=showMarks?'阅读原图（隐藏标记）':'显示批改标记';
}
function readerPosition(){const stage=node('gradingReaderStage');return {left:stage.scrollLeft,top:stage.scrollTop,width:stage.clientWidth,height:stage.clientHeight};}
function readerAnnotations(layout){
 const layer=node('gradingReaderStage').querySelector('.grading-reader-annotations');if(!layer)return;
 layer.innerHTML=showMarks?`<svg width="${layout.width}" height="${layout.height}" aria-label="题号与卷面位置连线">${layout.items.map(item=>{const color=G.statusStyle[item.state.status].color;return `<line x1="${item.anchorX}" y1="${item.anchorY}" x2="${item.labelX}" y2="${item.labelY+layout.labelHeight/2}" stroke="${color}" ${item.confirmed?'':'stroke-dasharray="4 3"'}/><circle cx="${item.anchorX}" cy="${item.anchorY}" r="4" fill="${color}" stroke="white"/>`;}).join('')}</svg>${layout.items.map(item=>{const style=G.statusStyle[item.state.status],selected=readerSelection?.questionId===item.q.id&&readerSelection.regionIndex===item.index;return `<button class="grading-mark-card ${selected?'selected':''}" data-mark-question="${e(item.q.id)}" data-mark-region="${item.index}" style="left:${item.labelX}px;top:${item.labelY}px;width:${layout.labelWidth}px;height:${layout.labelHeight}px;color:${style.color}" aria-label="${readerEditing?'校准':'查看'}第 ${e(item.q.number)} 题的位置"><strong>${style.mark} 第 ${e(item.q.number)} 题 · ${style.label}</strong><span>${e(G.scoreLabel(item.state))}</span><small>${item.confirmed?'位置已校准':'AI 位置 · 待核对'}</small></button>`;}).join('')}`:'';
}
function layoutReader({position=null,ratio=1}={}){
 if(!readerReady||!readerImage?.naturalWidth)return;
 const stage=node('gradingReaderStage'),sideways=readerRotation%180!==0,p=active.data.pages[readerIndex],hasMarks=showMarks&&marksFor(p).length;
 const gutter=hasMarks?192:0,scale=Math.max(1,stage.clientWidth-30-gutter)/(sideways?readerImage.naturalHeight:readerImage.naturalWidth)*zoom;
 const width=readerImage.naturalWidth*scale,height=readerImage.naturalHeight*scale,paper=readerImage.parentElement,box=paper.parentElement,frame=box.parentElement;
 const rotatedWidth=sideways?height:width,rotatedHeight=sideways?width:height;
 const layout=hasMarks?G.annotationLayout(active.data,p,readerRotation,rotatedWidth,rotatedHeight):{width:rotatedWidth,height:rotatedHeight,items:[]};
 box.style.width=rotatedWidth+'px';box.style.height=rotatedHeight+'px';box.classList.toggle('calibrating',readerEditing);
 frame.style.width=layout.width+'px';frame.style.height=layout.height+'px';
 paper.style.width=width+'px';paper.style.height=height+'px';paper.style.transform='translate(-50%, -50%) rotate('+readerRotation+'deg)';
 readerAnnotations(layout);
 stage.scrollLeft=position?(position.left+position.width/2)*ratio-stage.clientWidth/2:0;
 stage.scrollTop=position?(position.top+position.height/2)*ratio-stage.clientHeight/2:0;
 readerControls();
}
function selectReaderMark(questionId,regionIndex){
 if(busy||!readerReady)return;
 const q=active.data.result?.questions.find(q=>q.id===questionId);if(!q?.regions[regionIndex])return;
 readerEditing=true;showMarks=true;readerSelection={questionId,regionIndex,pageId:active.data.pages[readerIndex].id};
 node('gradingReaderStatus').textContent='第 '+q.number+' 题：请在原卷该题作答旁单击。定位依据：'+(q.regions[regionIndex].anchorText||q.studentAnswer).slice(0,150);
 const position=readerPosition();layoutReader({position});
}
async function saveReaderPosition(event,reset=false){
 if(!readerEditing||!readerSelection||busy||!readerReady)return;
 const box=node('gradingReaderStage').querySelector('.grading-reader-imagebox');if(!reset&&!event.target.closest('.grading-reader-imagebox'))return;
 const target={...readerSelection},revision=active.revision,id=active.data.id,version=readerVersion;
 let point;
 if(!reset){const rect=box.getBoundingClientRect();point=G.unrotatePoint({x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height},readerRotation);if(![point.x,point.y].every(v=>v>=0&&v<=1))return;}
 busy=true;readerSaving=true;readerControls();node('gradingReaderStatus').textContent='正在保存标记位置…';
 try{
  const next=await post('jobs/'+id+'/positions',{baseRevision:revision,...target,...(reset?{reset:true}:{position:{pageId:target.pageId,...point}})});
  if(active?.data.id===id)active=next;await refreshExports();
  message='标记位置已保存。已有 PDF 需重新生成以应用新位置。';bad=false;
  if(version===readerVersion&&node('gradingReader').open){node('gradingReaderStatus').textContent=reset?'已恢复这处 AI 位置，可再次点击卷面校准。':'位置已校准并保存；可选择另一题继续校准。PDF 请在关闭查看器后重新生成。';const position=readerPosition();layoutReader({position});}
  await refresh();
 }catch(error){node('gradingReaderStatus').textContent='位置保存失败：'+error.message;}
 finally{busy=false;readerSaving=false;if(node('gradingReader').open)readerControls();redraw();}
}
function rotateReader(degrees){if(!readerReady)return;readerRotation=(readerRotation+degrees+360)%360;layoutReader();}
function setReaderZoom(value){if(!readerReady)return;const next=Math.min(4,Math.max(0.25,Math.round(value*100)/100)),position=readerPosition(),ratio=next/zoom;zoom=next;layoutReader({position,ratio});}
function navigateReader(step){const pages=active?.data.pages||[],next=readerIndex+step;if(next<0||next>=pages.length)return;if(pages[next].sourceId!==pages[readerIndex].sourceId){zoom=1;readerRotation=0;}readerIndex=next;readerSelection=null;renderReader();}
function toggleReaderMarks(){if(!readerReady)return;showMarks=!showMarks;readerEditing=false;readerSelection=null;node('gradingReaderStatus').textContent='';layoutReader();}
function openReader(index){if(!active?.data.pages[index])return;readerIndex=index;zoom=1;readerRotation=0;showMarks=true;readerEditing=false;readerSelection=null;if(!node('gradingReader').open)node('gradingReader').showModal();renderReader();}
function renderReader(){
 const p=active?.data.pages[readerIndex];if(!p)return;
 const source=active.data.files.find(f=>f.id===p.sourceId),version=++readerVersion;readerReady=false;readerImage=null;
 node('gradingReaderTitle').textContent=roles[p.role]+' · 第 '+p.pageNumber+' 页（'+(readerIndex+1)+' / '+active.data.pages.length+'）';
 node('gradingReaderId').textContent=(source?.name||p.name)+' · '+(source?.pageCount||1)+' 页';
 node('gradingReaderStatus').textContent='正在加载卷面…';node('gradingOpenOriginal').href=url(source||p);node('gradingDownloadOriginal').href=url(source||p)+'?download=1';
 node('gradingReaderStage').innerHTML=`<div class="grading-reader-page"><div class="grading-reader-imagebox"><div class="grading-paper"><img id="gradingReaderImage" src="${url(p)}" alt="${e(roles[p.role]+'原始卷面，第'+p.pageNumber+'页')}" draggable="false"></div></div><div class="grading-reader-annotations"></div></div>`;
 const image=node('gradingReaderImage');readerImage=image;
 image.addEventListener('load',()=>{if(version!==readerVersion||!node('gradingReader').open)return;p.width=image.naturalWidth;p.height=image.naturalHeight;readerReady=true;node('gradingReaderStatus').textContent='';layoutReader();},{once:true});
 image.addEventListener('error',()=>{if(version!==readerVersion)return;readerReady=false;readerControls();node('gradingReaderStatus').textContent='卷面加载失败，可打开或下载原文件查看。';},{once:true});
 readerControls();
}
async function exportImage(){
 if(!readerReady)return;const p=active.data.pages[readerIndex],img=readerImage,rotation=readerRotation,version=readerVersion;await img.decode();if(version!==readerVersion)throw Error('卷面已切换，请重新下载当前页。');
 const sideways=rotation%180!==0,width=sideways?img.naturalHeight:img.naturalWidth,height=sideways?img.naturalWidth:img.naturalHeight,scale=width/1000;
 const layout=G.annotationLayout(active.data,p,rotation,width,height,{labelWidth:200*scale,labelHeight:58*scale,gap:12*scale});
 const output=document.createElement('canvas');output.width=Math.ceil(layout.width);output.height=Math.ceil(layout.height);const ctx=output.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,output.width,output.height);
 ctx.save();ctx.translate(width/2,height/2);ctx.rotate(rotation*Math.PI/180);ctx.drawImage(img,-img.naturalWidth/2,-img.naturalHeight/2);ctx.restore();
 root.GradingAnnotations.draw(ctx,layout,{scale});downloadFile('批改-'+(readerIndex+1)+'-'+rotation+'度.jpg',await toBlob(output));output.width=0;output.height=0;
}
function downloadFile(name,blob){const a=document.createElement('a'),objectUrl=URL.createObjectURL(blob);a.href=objectUrl;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),2000);}
async function exportReport(){
 if(!active?.data.result)return;busy=true;const snapshot=structuredClone(active);
 try{await generateOutputs({kinds:['answers-html']});const response=await fetch('/api/grading/jobs/'+snapshot.data.id+'/exports/answers-html?download=1',{cache:'no-store'});if(!response.ok)throw Error('读取当前版本的HTML解答失败，请重新读取后重试。');downloadFile(snapshot.data.title+' · 详细解答.html',await response.blob());status('离线解答已下载，含公式、字体与原图，可直接打开或打印为PDF。');}
 catch(error){status('解答导出失败：'+error.message,true);}finally{busy=false;redraw();}
}
document.addEventListener('click',async event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.dataset.markQuestion){selectReaderMark(button.dataset.markQuestion,Number(button.dataset.markRegion));return;}
 if(button.dataset.gradingRead!==undefined){openReader(Number(button.dataset.gradingRead));return;}
 if(button.dataset.gradingJob){await select(button.dataset.gradingJob);return;}
 const action=button.dataset.grading;
 if(action==='resume-ai'){await resumeAI();return;}
 if(action==='cancel-ai'){if(aiRunning&&apiPhase!=='saving'){aiCancelRequested=true;apiPhase='cancelling';apiText='正在取消 Tandix 批改…';redraw();try{await apiRunner?.cancel();}catch(error){apiText=error.message;redraw();}}return;}
 if(!action||busy)return;
 if(action==='delete-job'){confirmDeleteJob();return;}
 if(action==='restore-job'){await restoreJob(button.dataset.jobId);return;}
 if(action==='start-ai'){await startAI();return;}
 if(action==='recover-ai'){await recoverAI();return;}
 if(action==='connect-ai'){await recoverTask(true);return;}
 if(action==='detect-tandix'){await detectTandix();return;}
 if(action==='refresh'){if(active)await select(active.data.id);await refresh();}
 if(action==='new'){try{localStorage.removeItem('studytrail-grading-selected');}catch{}active=null;message='';draft.files={student:[],paper:[],reference:[]};draft.title='';draft.instructions='';draft.expectedMax='';redraw();}
 if(action==='export-pending')downloadFile('待保存批改结果.json',new Blob([pendingResultText()],{type:'application/json'}));
 if(action==='export-json')downloadFile('试卷批改记录.json',new Blob([JSON.stringify(active,null,2)],{type:'application/json'}));
 if(action==='export-report')await exportReport();
 if(action==='generate-outputs'){busy=true;try{await generateOutputs({force:button.dataset.force==='true'});status('HTML批改卷和详细解答已保存在本机，可分别打开或下载。');}catch(error){status('导出未全部完成：'+error.message+' 批改记录已保留，可以重试失败项。',true);}finally{busy=false;redraw();}}
});
function rememberDraft(event){const input=event.target;if(input.id==='gradingResumePrompt'&&active){resumeRequirements.set(active.data.id,input.value);return;}if(input.id==='gradingAiTimeout'){aiTimeoutMs=Number(input.value);return;}if(input.id==='gradingApiMode'){aiMode=input.value;return;}if(input.id==='gradingAiExtra'&&active){extraRequirements.set(active.data.id,input.value);return;}if(input.id==='gradingResultJson'&&active){rememberResult(input.value);return;}if(input.form?.id!=='gradingCreateForm')return;if(input.type==='file')draft.files[input.name]=[...input.files];else if(input.name in draft)draft[input.name]=input.type==='checkbox'?input.checked:input.value;}
document.addEventListener('input',rememberDraft);document.addEventListener('change',rememberDraft);
document.addEventListener('submit',async event=>{
 const form=event.target;if(form.id==='gradingCreateForm'){event.preventDefault();await create(form);return;}
 if(form.id!=='gradingResultForm'&&!form.dataset.gradingReview)return;
 event.preventDefault();if(busy||!active)return;
 const questionId=form.dataset.gradingReview;let payload;
 try{payload=questionId?{questionId,studentAnswer:form.elements.studentAnswer.value,note:form.elements.note.value,score:form.elements.score.value===''?null:Number(form.elements.score.value),maxScore:form.elements.maxScore.value===''?null:Number(form.elements.maxScore.value)}:{mode:pendingResultMode(),result:JSON.parse(form.elements.result.value.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''))};}catch{node('gradingStatusInline').textContent='JSON 无法解析，请检查格式后重试。';return;}
 busy=true;buttonLock(form,true);
 try{active=await post('jobs/'+active.data.id+'/'+(questionId?'review':'result'),{baseRevision:active.revision,...payload});if(!questionId){forgetResult(active.data.id);if(aiRunJobId===active.data.id&&aiRun?.data.status==='received')await recordRun({status:'saved'});}message=questionId?'人工复核已保存，卷面标记与分数已重新计算。':'批改结果已校验并保存，逐题分数由程序重新合计。';root.MistakeNotebook?.invalidate(active.data.id);if(active.mistakeSync)message+=active.mistakeSync.ok?' 错题本已同步，新增 '+active.mistakeSync.collected+' 题。':' '+active.mistakeSync.message;bad=false;try{await generateOutputs();message+=' HTML批改卷和解答已更新。';}catch(error){message+=' 导出未全部完成：'+error.message+' 可点击生成成果重试失败项。';bad=true;}busy=false;await refresh();redraw();if(questionId)document.getElementById('grading-question-'+questionId).open=true;}
 catch(error){message='保存失败：'+error.message;bad=true;const inline=node('gradingStatusInline');if(inline)inline.textContent=message;}
 finally{busy=false;buttonLock(form,false);}
});
function pendingResultText(){if(!active)return '';const id=active.data.id;if(pendingResults.has(id))return pendingResults.get(id);try{return localStorage.getItem('studytrail-grading-pending:'+id)||'';}catch{return '';}}
function pendingResultMode(){if(!active)return 'merge';if(pendingModes.has(active.data.id))return pendingModes.get(active.data.id);try{return localStorage.getItem('studytrail-grading-pending-mode:'+active.data.id)||'merge';}catch{return 'merge';}}
function rememberResult(text,mode=pendingResultMode()){if(!active)return;pendingModes.set(active.data.id,mode);pendingResults.set(active.data.id,text);try{localStorage.setItem('studytrail-grading-pending:'+active.data.id,text);localStorage.setItem('studytrail-grading-pending-mode:'+active.data.id,mode);}catch{}}
function forgetResult(id){pendingResults.delete(id);pendingModes.delete(id);try{localStorage.removeItem('studytrail-grading-pending:'+id);localStorage.removeItem('studytrail-grading-pending-mode:'+id);}catch{}}
async function readRun(id){
 const response=await request('jobs/'+id+'/ai-run');aiRun=response.run;aiRunJobId=id;
 apiProgress=aiRun?.data.progress||'';apiCheckpoint={};
 if(aiRun?.data.status==='received'&&aiRun.data.resultText&&!pendingResultText())rememberResult(aiRun.data.resultText,'replace');
}
function recordRun(patch){
 const id=aiRunJobId,runId=aiRun?.data.runId;if(!runId)return Promise.resolve();
 const payload={...apiCheckpoint,progress:apiProgress.slice(-32000),...patch};
 const pending=runWriteQueue.catch(()=>{}).then(async()=>{
  if(aiRunJobId!==id||aiRun?.data.runId!==runId)throw Error('AI 执行记录已切换，请重新读取。');
  for(let attempt=0;attempt<2;attempt++){
   try{const response=await post('jobs/'+id+'/ai-run',{baseRevision:aiRun.revision,runId,...payload});aiRun=response.run;return;}
   catch(error){
    if(error.status!==409||attempt)throw error;
    const latest=(await request('jobs/'+id+'/ai-run')).run;
    if(latest?.data.runId!==runId)throw error;aiRun=latest;
    // Multiple tabs may observe the same task; never regress the durable cursor or terminal result.
    if(['received','saved','failed','cancelled'].includes(latest.data.status)||payload.cursor!==undefined&&payload.cursor<(latest.data.cursor||0))return;
   }
  }
 });runWriteQueue=pending;return pending;
}
function queueProgress(){
 if(progressTimer)return;
 progressTimer=setTimeout(()=>{progressTimer=null;if(!aiRunning)return;recordRun({}).catch(()=>{apiText='正在观察原任务，但进度写入本机失败。请保持页面打开；不会新建模型任务。';const inline=node('gradingStatusInline');if(inline)inline.textContent=apiText;});},2000);
}
function liveRun(){const r=aiRun?.data;if(!r)return null;const combined={...r,...apiCheckpoint};if(aiRunning){if(combined.providerStatus==='interrupted')combined.status='interrupted';else if(['accepted','creating','ready','dispatching','running'].includes(combined.providerStatus))combined.status='running';}return combined;}
function runRecordView(){
 if(aiRunJobId!==active.data.id||!aiRun)return '';
 const r=liveRun(),labels={preparing:'准备中',submitting:'已记录提交，正在确认原任务',running:'正在观察原任务',interrupted:'任务中断，上下文保留',resuming:'继续操作已记录，等待原任务确认',received:'最终结果已收到，等待保存',saved:'结果已保存',failed:'已结束',cancelled:'已取消'};
 const pending=blockedRunStates.has(r.status)&&r.status!=='received',canResume=aiRunning&&r.providerStatus==='interrupted'&&r.resumable;
 return `<div class="banner"><strong>本地 AI 执行记录：${e(labels[r.status]||r.status)}</strong><p>原 Tandix 任务：${e(r.taskId||'旧版未记录')} · 第 ${r.attempt||1} 轮 · 已记录事件 ${r.cursor||0}</p>${r.sessionId?`<p class="hint">原会话：${e(r.sessionId)}</p>`:''}${r.errorCode?`<p class="hint">${e(r.errorMessage||r.errorCode)}</p>`:''}${r.providerProtocol!=='tandix-recovery-v1'&&pending?'<p>这是升级前的临时任务，Tandix 不支持仅凭旧 ID 自动迁移；不会重新提交。</p>':''}${!aiRunning&&pending&&r.providerProtocol==='tandix-recovery-v1'?'<button class="secondary" data-grading="connect-ai" '+(busy?'disabled':'')+'>连接原任务（不重新批改）</button>':''}${canResume||r.resumeRequest?.state==='pending'?`<label>继续要求（选填）<textarea id="gradingResumePrompt" rows="2" maxlength="6000" ${aiResuming||r.resumeRequest?.state==='pending'?'disabled':''} placeholder="例如：保留已完成的题目，继续剩余解析。">${e(resumeRequirements.get(active.data.id)||'')}</textarea></label><p class="hint">沿用原任务、原会话、附件及工作目录。继续请求确认丢失时复用同一个操作 ID；不会重新提交整卷。</p><button class="secondary" data-grading="resume-ai" ${!canResume||aiResuming?'disabled':''}>${r.resumeRequest?.state==='pending'?'核对并继续原任务':'继续原任务'}</button>`:''}${r.status==='interrupted'&&!r.resumable?'<p class="hint">Tandix 暂未确认原会话可继续，请恢复原 Codex 配置并连接原任务；不会另建会话。</p>':''}${r.status==='received'?'<button class="secondary" data-grading="recover-ai" '+(busy?'disabled':'')+'>恢复已收到的结果（不调用 AI）</button>':''}</div>`;
}
function apiControls(){return `<section class="grading-api"><div class="grading-api-heading"><strong>Tandix 连接与批改进度</strong><button class="text-btn" data-grading="detect-tandix" ${busy?'disabled':''}>重新检测</button></div><p role="status">${e(apiText)}</p>${runRecordView()}<div class="form-grid"><label>发送模式<select id="gradingApiMode" ${busy?'disabled':''}><option value="pages" ${aiMode==='pages'?'selected':''}>阅读图片 · 适合手写与扫描卷</option><option value="originals" ${aiMode==='originals'?'selected':''}>原文件 · PDF / 图片混合</option></select></label><div class="hint">每任务最多 10 个附件，合计 25 MiB；图片每份最多 10 MiB，每轮最长 10 分钟。阅读图片模式每页计一个附件；页数较多时可选原文件模式或拆卷。</div></div><label>每轮批改时限<select id="gradingAiTimeout" ${busy?'disabled':''}>${[120000,300000,600000].map(ms=>`<option value="${ms}" ${aiTimeoutMs===ms?'selected':''}>${ms/60000} 分钟</option>`).join('')}</select></label><p class="hint">刷新、关闭页面或连接断开后，重新连接会查询同一任务，补取进度和最终结果，不重新上传试卷。执行超时会保留原上下文，确认中断后可点击“继续原任务”。电脑完全断网期间不保证模型继续计算。</p><label>本次补充要求（选填）<textarea id="gradingAiExtra" rows="2" maxlength="6000" ${busy?'disabled':''} placeholder="例如：核对第二题字迹；严格按附带评分标准；几何题给出两种解法。">${e(extraRequirements.get(active.data.id)||'')}</textarea></label>${active.data.result?'<p class="hint">重新 AI 批改会新建一次完整批改并替换题目及人工复核；继续原任务沿用原会话。旧版本保存在本地。</p>':''}<details id="gradingApiProgressWrap" ${apiProgress?'':'hidden'}><summary>AI 进度记录（最近 32000 字符）</summary><pre id="gradingApiProgressText" class="grading-contract">${e(apiProgress)}</pre></details><p class="hint">需新版 Tandix 扩展及伴随程序（可恢复任务协议 v2）。任务仍由本机伴随程序管理，电脑断网、浏览器退出或进程重启可能中断执行；已持久保存的任务、会话与结果可查询恢复。<a href="https://github.com/samchen2009/tandix/blob/main/docs/web-api.md" target="_blank" rel="noopener">Tandix 接口能力与限制 ↗</a></p></section>`;}
async function runner(){
 apiModule??=import('/grading-tandix.mjs').catch(error=>{apiModule=null;throw error;});const module=await apiModule;
 apiRunner??=new module.TandixGrader({onCheckpoint:async patch=>{
  if(patch.status==='received'){clearTimeout(progressTimer);progressTimer=null;rememberResult(patch.resultText,'replace');}
  await recordRun(patch);
 },onState:(phase,text)=>{apiPhase=phase;apiText=text;redraw();},onProgress:event=>{
  const previous=apiCheckpoint,meta=event.checkpoint||{};
  apiCheckpoint={...apiCheckpoint,...meta};
  if(meta.providerStatus==='interrupted')apiCheckpoint.status='interrupted';
  else if(['accepted','creating','ready','dispatching','running'].includes(meta.providerStatus))apiCheckpoint.status='running';
  if(event.type==='snapshot')apiProgress=(event.text||'').slice(-32000);
  else if(event.type==='delta'&&typeof event.text==='string')apiProgress=(apiProgress+event.text).slice(-32000);
  if(!['received','saved'].includes(aiRun?.data.status))queueProgress();
  const wrap=node('gradingApiProgressWrap'),text=node('gradingApiProgressText');if(wrap)wrap.hidden=!apiProgress;if(text)text.textContent=apiProgress;
  if(previous.providerStatus!==apiCheckpoint.providerStatus||previous.resumable!==apiCheckpoint.resumable||previous.sessionId!==apiCheckpoint.sessionId||previous.attempt!==apiCheckpoint.attempt)redraw();
 }});return apiRunner;
}
async function detectTandix(){
 if(aiRunning)return;apiText='正在检测 Tandix…';if(active)redraw();
 try{const r=await runner(),{hello}=await r.connect();if(!aiRunning){apiPhase='ready';apiText=hello.authorized?'已检测到 Tandix 可恢复任务接口，当前站点已授权。':'已检测到 Tandix 可恢复任务接口；首次开始或恢复时需站点授权。';}}
 catch(error){if(!aiRunning){apiPhase='unavailable';apiText=apiModule?(await apiModule).explain(error):error.message;}}
 finally{if(active)redraw();}
}
async function finishAI(snapshot,result){
 rememberResult(JSON.stringify(result.data,null,2),'replace');apiPhase='saving';apiText='模型结果已收到，正在校验评分并保存到本机…';redraw();
 G.validateResult(result.data,snapshot.data.pages);
 active=await post('jobs/'+snapshot.data.id+'/result',{baseRevision:aiRun?.data.sourceRevision??snapshot.revision,mode:'replace',result:result.data});forgetResult(snapshot.data.id);
 if(aiRun?.data.status==='received')await recordRun({status:'saved'});
 apiText='批改结果已保存，正在本机生成HTML批改卷和解答…';redraw();
 try{await generateOutputs();message='HTML批改卷和详细解答已生成；解答可打开、下载或按需打印为PDF。';}catch(error){message='AI批改已保存；导出未全部完成：'+error.message+'。请点击生成成果重试失败项。';bad=true;}
 apiPhase='completed';apiText='批改结果已校验并保存。原 Tandix 任务 '+result.taskId;
}
async function recoverAI(){
 if(busy||!active)return;busy=true;bad=false;
 try{
  await readRun(active.data.id);if(aiRun?.data.status!=='received')throw Error('没有可恢复的最终结果。');
  if(aiRun.data.sourceRevision!==active.revision)throw Error('试卷版本已改变，原结果已放入“高级：结果检查与恢复”，请核对后保存。');
  await finishAI(structuredClone(active),{taskId:aiRun.data.taskId,data:JSON.parse(aiRun.data.resultText)});
 }catch(error){status(error.message,true);}finally{busy=false;await refresh();redraw();}
}
async function startAI(){
 if(busy||!active)return;
 const snapshot=structuredClone(active),extra=extraRequirements.get(snapshot.data.id)||'';busy=true;aiRunning=true;aiCancelRequested=false;bad=false;message='准备通过 Tandix Web API 批改当前试卷…';redraw();let created=false;
 try{
  try{localStorage.setItem('studytrail-grading-selected',snapshot.data.id);}catch{}await readRun(snapshot.data.id);
  if(blockedRunStates.has(aiRun?.data.status))throw Error('已有未确认结束或待保存的原任务，不会重新提交。请查看本地 AI 执行记录。');
  const response=await post('jobs/'+snapshot.data.id+'/ai-run',{start:true,sourceRevision:snapshot.revision,mode:aiMode,timeoutMs:aiTimeoutMs,extra});aiRun=response.run;created=true;apiProgress='';apiCheckpoint={};
  const r=await runner();if(aiCancelRequested)throw Object.assign(Error('已取消批改。'),{code:'cancelled'});const result=await r.run({job:snapshot.data,taskId:aiRun.data.taskId,mode:aiMode,timeoutMs:aiTimeoutMs,contract:contract(),extra,fetchAsset:asset=>fetch('/api/grading/jobs/'+snapshot.data.id+'/files/'+asset.id,{cache:'no-store'})});
  await finishAI(snapshot,result);
 }catch(error){
  clearTimeout(progressTimer);progressTimer=null;
  if(created&&!['received','saved'].includes(aiRun?.data.status)){
   const knownTerminal=['failed','cancelled'].includes(apiCheckpoint.providerStatus)||['invalid-json','empty-result','result-too-large','cancelled'].includes(error?.code);
   const uncertain=aiRun?.data.status!=='preparing'&&!knownTerminal;
   try{await recordRun({status:error?.code==='cancelled'?'cancelled':uncertain?'interrupted':'failed',errorCode:error?.code||'local-error'});}catch{/* Keep the last durable state; it continues to block duplicate runs. */}
  }
  apiPhase='failed';apiText=apiModule?(await apiModule).explain(error):error.message;message='批改未完成：'+apiText+(pendingResultText()?' 已保留收到的 JSON，可恢复或核对后保存，无需再次调用 AI。':'');bad=true;
 }finally{clearTimeout(progressTimer);progressTimer=null;aiRunning=false;busy=false;await refresh();redraw();}
}
async function recoverTask(allowAuthorize=false){
 if(busy||!active)return;
 const snapshot=structuredClone(active);busy=true;aiRunning=true;aiCancelRequested=false;bad=false;message='正在连接原任务并补取结果…';redraw();
 try{
  await readRun(snapshot.data.id);const saved=aiRun?.data;
  if(saved?.status==='received'){await finishAI(snapshot,{taskId:saved.taskId,data:JSON.parse(saved.resultText)});return;}
  if(saved?.providerProtocol!=='tandix-recovery-v1'||!saved.taskId)throw Error('此旧版任务没有持久映射，无法自动迁移，不会重新提交。');
  if(['saved','failed','cancelled'].includes(saved.status))throw Error('原任务已结束，请查看本地结果。');
  const r=await runner();if(aiCancelRequested)throw Object.assign(Error('已停止等待。'),{code:'cancelled'});
  const result=await r.recover({taskId:saved.taskId,cursor:saved.cursor||0,identity:{agentId:saved.agentId,sessionId:saved.sessionId},allowAuthorize});
  await finishAI(snapshot,result);
 }catch(error){
  clearTimeout(progressTimer);progressTimer=null;
  if(aiRun&&!['received','saved','failed','cancelled'].includes(aiRun.data.status)){
   const terminal=['failed','cancelled'].includes(apiCheckpoint.providerStatus)||['invalid-json','empty-result','result-too-large','cancelled'].includes(error?.code);
   try{await recordRun({status:error?.code==='cancelled'?'cancelled':terminal?'failed':'interrupted',errorCode:error?.code||'local-error'});}catch{}
  }
  apiPhase='failed';apiText=apiModule?(await apiModule).explain(error):error.message;message='原任务恢复未完成：'+apiText;bad=true;
 }finally{clearTimeout(progressTimer);progressTimer=null;aiRunning=false;busy=false;await refresh();redraw();}
}
async function resumeAI(){
 if(!aiRunning||aiResuming||!apiRunner?.task)return;
 const r=liveRun();if(r?.providerStatus!=='interrupted'||!r.resumable)return;
 aiResuming=true;bad=false;redraw();
 try{
  const prompt='保留原任务已完成的识别、评分与解题过程，只继续剩余题目、详细解析及知识点总结。不要重新批改已完成的题目。最终仍按原始 JSON 契约返回覆盖整卷的完整结果。'+(resumeRequirements.get(active.data.id)||'');
  await recordRun({status:'interrupted'});await recordRun({resume:true,resumePrompt:prompt});const request=aiRun.data.resumeRequest;
  if(!request)throw Error('继续操作 ID 未保存，尚未发送继续指令。');
  await apiRunner.resume({requestId:request.requestId,prompt:request.prompt});
  if(!['received','saved','failed','cancelled'].includes(aiRun?.data.status))await recordRun({resumeAcknowledged:true});
  message='已核对原任务并发送继续要求；沿用原会话，不重新上传附件。';
 }catch(error){apiText=apiModule?(await apiModule).explain(error):error.message;message='继续操作未确认：'+apiText+' 已保留本次操作 ID，重试将先核对原任务。';bad=true;}
 finally{aiResuming=false;redraw();}
}
window.addEventListener('offline',()=>{if(aiRunning){apiText='网络已离线，等待同一任务恢复；不会重新提交。完全断网期间不保证模型继续计算，原会话将保留。';const inline=node('gradingStatusInline');if(inline)inline.textContent=apiText;}});
window.addEventListener('online',()=>{if(aiRunning){apiText='网络已恢复，正在等待原任务；不会重新执行。';const inline=node('gradingStatusInline');if(inline)inline.textContent=apiText;}});

window.addEventListener('pagehide',()=>apiRunner?.close());
function trashView(){return `<details id="gradingTrash" class="grading-trash" ${trashOpen?'open':''}><summary>已删除试卷（${deletedJobs.length}）</summary><p class="hint">原卷、批改结果和 PDF 保留在本机，可随时恢复。</p>${deletedJobs.map(j=>`<article><strong>${e(j.title)}</strong><small>${e(j.subject)} · ${j.pages} 页 · ${e(new Date(j.deletedAt).toLocaleString('zh-CN'))}</small><button class="secondary small" data-grading="restore-job" data-job-id="${e(j.id)}" aria-label="恢复 ${e(j.title)}" ${busy?'disabled':''}>恢复</button></article>`).join('')||'<p class="hint">暂无已删除试卷。</p>'}</details>`;}
function confirmDeleteJob(){if(!active||busy)return;deleteTarget={id:active.data.id,revision:active.revision,title:active.data.title};node('gradingDeleteName').textContent=deleteTarget.title;node('gradingDeleteError').textContent='';node('gradingConfirmDelete').disabled=false;node('gradingDeleteDialog').showModal();}
async function deleteJob(){
 if(!deleteTarget||busy)return;const target={...deleteTarget};busy=true;node('gradingConfirmDelete').disabled=true;node('gradingDeleteError').textContent='';
 try{
  await request('jobs/'+target.id,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:target.revision})});
  if(active?.data.id===target.id){active=null;exportFiles={jobId:null,revision:0,files:{}};}
  node('gradingReader').close();node('gradingDeleteDialog').close();deleteTarget=null;trashOpen=true;
  message='已删除“'+target.title+'”，可在“已删除试卷”中恢复。';bad=false;await refresh();
 }catch(error){node('gradingDeleteError').textContent='删除失败：'+error.message;}
 finally{busy=false;node('gradingConfirmDelete').disabled=false;redraw();}
}
async function restoreJob(id){
 const item=deletedJobs.find(j=>j.id===id);if(!item||busy)return;busy=true;
 try{active=await post('jobs/'+id+'/restore',{baseRevision:item.revision});await refreshExports();message='已恢复“'+item.title+'”，原卷、批改结果和导出文件均保留。';bad=false;await refresh();}
 catch(error){message='恢复失败：'+error.message;bad=true;await refresh();}
 finally{busy=false;redraw();}
}
document.addEventListener('toggle',event=>{if(event.target.id==='gradingTrash')trashOpen=event.target.open;},true);
function exportOutputs(){
 const ready=exportFiles.jobId===active.data.id&&exportFiles.revision===active.revision?exportFiles.files:{},base='/api/grading/jobs/'+active.data.id,complete=ready['marked-html']&&ready['answers-html'];
 return `<section class="card grading-pdf-output"><span class="eyebrow">批改成果</span><h2>HTML 批改卷 · 详细解答</h2><p>直接查看批改、原题截图与解析，每题均可一键加入错题本。题图已独立保存，无需从 PDF 再次截图或上传。</p><div class="grading-actions"><a class="primary" href="${base}/reports/marked" target="_blank" rel="noopener">打开批改卷</a><a class="primary" href="${base}/reports/answers" target="_blank" rel="noopener">打开详细解答</a>${['marked','answers'].map(kind=>`<a class="secondary" href="${base}/reports/${kind}?print=1" target="_blank" rel="noopener">导出${kind==='marked'?'批改':'解答'} PDF</a>${ready[kind+'-html']?`<a class="text-btn" href="${base}/exports/${kind}-html?download=1" download>下载${kind==='marked'?'批改卷':'解答'} HTML</a>`:''}`).join('')}<button class="secondary" data-grading="generate-outputs" data-force="${Boolean(complete)}" ${busy?'disabled':''}>${busy?'正在处理…':complete?'重新生成离线 HTML':'生成离线 HTML / 重试'}</button></div><details><summary>已有 PDF 文件</summary>${ready.marked?`<a href="${base}/exports/marked" download>下载已有评分 PDF</a>`:''}${ready.answers?`<a href="${base}/exports/answers" download>下载已有解答 PDF</a>`:''}${!ready.marked&&!ready.answers?'<p class="hint">尚无 PDF，需要时使用上方导出按钮。</p>':''}</details><p class="hint">在线 HTML 使用独立题图；下载的 HTML 内含图片与字体，可离线阅读。生成和导出都复用已有评分，不重新批改。</p></section>`;
}
async function refreshExports(){if(!active)return;const id=active.data.id,revision=active.revision;try{const info=await request('jobs/'+id+'/exports');if(active?.data.id===id&&active.revision===revision)exportFiles={...info,jobId:id};}catch{exportFiles={jobId:id,revision,files:{}};}}
async function generateOutputs({kinds=['marked-html','answers-html'],force=false}={}){
 if(!active?.data.result)throw Error('请先完成批改。');
 const snapshot=structuredClone(active),base='jobs/'+snapshot.data.id,errors=[];
 if(exportFiles.jobId!==snapshot.data.id||exportFiles.revision!==snapshot.revision)exportFiles={jobId:snapshot.data.id,revision:snapshot.revision,files:{}};
 for(const kind of kinds){
  if(!force&&exportFiles.files[kind])continue;
  const title=kind==='marked-html'?'批改卷HTML':kind==='marked'?'评分PDF':'解答HTML';status('正在生成'+title+'…');
  try{
   if(kind.endsWith('-html'))await post(base+'/exports/'+kind,{baseRevision:snapshot.revision});
   else{
    const {createGradingPdf}=await import('/grading-pdf.mjs');
    const blob=await createGradingPdf(snapshot.data,'marked',{fetchAsset:asset=>fetch('/api/grading/'+base+'/files/'+asset.id,{cache:'no-store'}),onProgress:text=>{const inline=node('gradingStatusInline');if(inline)inline.textContent=title+'：'+text;}});
    await request(base+'/exports/marked',{method:'POST',headers:{'Content-Type':'application/pdf','X-Base-Revision':String(snapshot.revision)},body:blob});
   }
   if(active?.data.id===snapshot.data.id&&active.revision===snapshot.revision)exportFiles.files[kind]=true;
  }catch(error){errors.push(title+'：'+error.message);}
  redraw();
 }
 if(active?.data.id===snapshot.data.id&&active.revision===snapshot.revision){try{const latest=await request(base+'/questions');if(latest.scoreRevision===snapshot.data.scoreRevision)active.questionAssets=latest;}catch{}}
 if(errors.length)throw Error(errors.join('；'));
}
function buttonLock(form,value){form.querySelectorAll('button').forEach(b=>b.disabled=value);}
function init(){
 node('gradingConfirmDelete')?.addEventListener('click',deleteJob);const dialog=node('gradingReader');if(!dialog)return;
 node('gradingReaderPrevious').addEventListener('click',()=>navigateReader(-1));node('gradingReaderNext').addEventListener('click',()=>navigateReader(1));
 node('gradingShowMarks').addEventListener('click',toggleReaderMarks);
 node('gradingEditPositions').addEventListener('click',()=>{if(busy||!readerReady)return;readerEditing=!readerEditing;readerSelection=null;showMarks=true;node('gradingReaderStatus').textContent=readerEditing?'先选择右侧题号，再在卷面该题作答旁单击。':'';layoutReader();});
 node('gradingResetPosition').addEventListener('click',event=>saveReaderPosition(event,true));node('gradingReaderStage').addEventListener('click',event=>saveReaderPosition(event));
 node('gradingZoomIn').addEventListener('click',()=>setReaderZoom(zoom+0.25));node('gradingZoomOut').addEventListener('click',()=>setReaderZoom(zoom-0.25));node('gradingZoomFit').addEventListener('click',()=>setReaderZoom(1));
 node('gradingRotateLeft').addEventListener('click',()=>rotateReader(-90));node('gradingRotateRight').addEventListener('click',()=>rotateReader(90));node('gradingRotationReset').addEventListener('click',()=>rotateReader(-readerRotation));
 node('gradingDownloadImage').addEventListener('click',()=>exportImage().catch(error=>{node('gradingReaderStatus').textContent=error.message;}));
 dialog.addEventListener('close',()=>{readerVersion++;readerReady=false;readerImage=null;node('gradingReaderStage').replaceChildren();});
 window.addEventListener('resize',()=>{if(dialog.open&&readerReady)layoutReader();});
}

node('gradingAddMistake').addEventListener('click',()=>{if(!active)return;const p=active.data.pages[readerIndex];if(!p)return;root.MistakeNotebook.fromImage({subject:active.data.subject,url:url(p),name:p.name,sourceTitle:active.data.title,sourcePage:{jobId:active.data.id,pageId:p.id}});});
init();root.GradingView={render:renderGrading,refresh,open:select,diagram:diagramSvg};
})(window);
