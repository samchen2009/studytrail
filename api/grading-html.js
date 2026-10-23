'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const katex=require('katex');
require('katex/contrib/mhchem');
const G=require('./grading-core');
const HTML_RENDERER='reports-html-v3';
const ONLINE_REPORT_CSP="default-src 'none'; img-src 'self' data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const REPORT_CSP="sandbox allow-scripts allow-modals; default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statuses={correct:'全对',incorrect:'错题',partial:'部分得分',pending:'待核'};
const roles={student:'学生答卷',paper:'原题卷',reference:'参考答案'};
let stylesPromise;
async function mathStyles(){
 if(!stylesPromise)stylesPromise=(async()=>{
  const dist=path.dirname(require.resolve('katex'));
  let css=await fs.readFile(path.join(dist,'katex.min.css'),'utf8');
  const pattern=/src:url\((fonts\/[^)]+\.woff2)\)[^;]*;/g;
  const replacements=await Promise.all([...css.matchAll(pattern)].map(async m=>[m[0],`src:url(data:font/woff2;base64,${(await fs.readFile(path.join(dist,m[1]))).toString('base64')}) format("woff2");`]));
  for(const [from,to]of replacements)css=css.replace(from,to);
  if(/url\((?!data:)/.test(css))throw Error('公式字体未完整嵌入，无法生成离线解答。');
  return css;
 })().catch(error=>{stylesPromise=null;throw error;});
 return stylesPromise;
}

const {formatMath}=require('../web/math-format');
const rich=value=>formatMath(katex,value);
const prose=value=>`<p class="prose">${rich(value)}</p>`;
const bullets=items=>items?.length?`<ul>${items.map(s=>`<li>${rich(s)}</li>`).join('')}</ul>`:'';
const block=(title,value,cls='')=>`<section class="${cls}"><h3>${title}</h3>${prose(value||'未识别到内容。')}</section>`;

function diagram(d){
 const colors={ink:'#203b35',red:'#b32735',green:'#087b3c',blue:'#205cac',gray:'#687670'};
 const safe=G.validateDiagram(d);
 const shape=s=>{
  const color=colors[s.color];
  if(s.type==='text')return `<text x="${s.x}" y="${s.y}" fill="${color}" font-size="17">${escape(s.text)}</text>`;
  if(s.type==='polyline')return `<polyline points="${s.points.map(p=>p.join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`;
  const keys=s.type==='line'?['x1','y1','x2','y2']:s.type==='circle'?['cx','cy','r']:['x','y','width','height'];
  return `<${s.type} ${keys.map(k=>`${k}="${s[k]}"`).join(' ')} fill="none" stroke="${color}" stroke-width="2"/>`;
 };
 return `<figure class="diagram"><figcaption>${rich(safe.title)}</figcaption><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" role="img" aria-label="${escape(safe.title)}">${safe.shapes.map(shape).join('')}</svg>${prose(safe.description)}</figure>`;
}

function question(job,q,index,{kind,online,scoreRevision,questionAssets}={}){
 const review=job.reviews?.[q.id],s=G.questionState(q,review),status=G.statusStyle[s.status];
 const prepared=questionAssets?.questions.find(item=>item.questionId===q.id),images=prepared?.assets.filter(a=>a.role==='question')||[],references=prepared?.assets.filter(a=>a.role==='source')||[];
 const picture=a=>`<figure class="question-image"><img src="${escape(a.src||a.url)}" alt="第 ${escape(q.number)} 题 · ${escape(a.name)}" width="${a.width}" height="${a.height}"></figure>`;
 const collect=online?`<div class="screen-only collect-actions"><button data-collect="${escape(q.id)}" data-job="${escape(job.id)}" data-revision="${escape(scoreRevision)}">加入错题本</button><span role="status"></span></div>`:'';
 const links=[...new Set(q.regions.map(r=>r.pageId))].map(id=>`<a href="#source-${escape(id)}">查看${escape(roles[job.pages.find(p=>p.id===id)?.role]||'卷面')}</a>`).join(' · ');
 return `<article id="question-${index}" class="question ${s.status}">
 <h2><a class="question-link" href="#scores">${status.mark} 第 ${escape(q.number)} 题</a><span class="score">${escape(G.scoreLabel(s))} · ${statuses[s.status]}</span></h2>
 ${collect}${s.estimated?prose('参考评分依据：'+q.scoringNote):''}
 ${images.some(a=>a.kind==='full')?'<h3>原题与选项</h3>'+images.map(picture).join(''):block('原题与选项',q.stem)+images.map(picture).join('')}${references.length?'<details><summary>原题与作答截图（含原作答，仅供核对）</summary>'+references.map(picture).join('')+'</details>':''}${prepared?.warning?prose(prepared.warning):''}${links?`<p class="source-links">${links}</p>`:''}
 ${block('学生作答',review?.studentAnswer??q.studentAnswer,s.status==='incorrect'?'wrong-answer':'')}
 ${block('参考答案',q.answer,'reference-answer')}
 <details class="explanation" open><summary>${kind==='marked'?'评语与评分依据':'详细解析与评分依据'}</summary>
 ${block('教师评语',q.feedback)}
 ${s.status==='pending'?block('待核说明',q.reviewReason||'作答或评分依据需要核对。','pending'):''}
 ${review?block('人工复核',review.note):''}
 ${q.rubric.length?`<h3>评分依据</h3><div class="table-scroll"><table><thead><tr><th>评分点</th><th>得分 / 满分</th><th>作答证据与理由</th></tr></thead><tbody>${q.rubric.map(r=>`<tr><td>${rich(r.criterion)}</td><td>${escape(r.score??'待核')} / ${escape(r.maxScore??'未定')}</td><td>${prose(r.evidence||'未提供原作答摘录。')}${prose(r.reason||'未提供逐点评分说明。')}</td></tr>`).join('')}</tbody></table></div>`:''}
 ${kind==='marked'?'':q.methods.map((m,i)=>`<section><h3>方法${i+1} · ${rich(m.title)}</h3><ol>${m.steps.map(step=>`<li class="prose">${rich(step)}</li>`).join('')}</ol></section>`).join('')}
 ${kind==='marked'?'':(q.diagrams||[]).map(diagram).join('')}
 ${q.knowledgePoints.length?`<p class="knowledge-tags">知识点：${q.knowledgePoints.map(rich).join(' · ')}</p>`:''}
 </details></article>`;
}

function markedPage(job,p,data){
 const items=G.pageMarks(job,p);
 if(!p.width||!p.height)return `<img class="legacy-source" src="${data}" alt="${escape(roles[p.role])}原图">${items.length?prose('本页未记录图像尺寸，按题号核对：'+items.map(i=>i.q.number+'题 '+G.scoreLabel(i.state)).join('；')):''}`;
 const scale=p.width/1000,layout=G.annotationLayout(job,p,0,p.width,p.height,{labelWidth:200*scale,labelHeight:60*scale,gap:12*scale});
 const marks=layout.items.map(i=>{
  const {color,mark}=G.statusStyle[i.state.status];
  return `<g fill="${color}"><line x1="${i.anchorX}" y1="${i.anchorY}" x2="${i.labelX}" y2="${i.labelY+layout.labelHeight/2}" stroke="${color}" stroke-width="${1.5*scale}" ${i.confirmed?'':'stroke-dasharray="5 4"'}/><circle cx="${i.anchorX}" cy="${i.anchorY}" r="${3*scale}"/><rect x="${i.labelX}" y="${i.labelY}" width="${layout.labelWidth}" height="${layout.labelHeight}" fill="white" stroke="${color}"/><text x="${i.labelX+6*scale}" y="${i.labelY+19*scale}" font-size="${14*scale}">${mark} 第${escape(i.q.number)}题</text><text x="${i.labelX+6*scale}" y="${i.labelY+38*scale}" font-size="${12*scale}">${escape(G.scoreLabel(i.state))}</text><text x="${i.labelX+6*scale}" y="${i.labelY+52*scale}" font-size="${9*scale}">${i.confirmed?'位置已校准':'AI位置·请对照'}</text></g>`;
 }).join('');
 return `<div class="sheet" style="aspect-ratio:${layout.width}/${layout.height}"><img src="${data}" alt="${escape(roles[p.role])}原图" style="width:${p.width/layout.width*100}%;height:${p.height/layout.height*100}%"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" aria-label="原卷题号与分数标记">${marks}</svg></div>`;
}

const CSS=`.question-image img{display:block;max-width:100%;height:auto;margin:auto}.question-image{margin:16px 0}.collect-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.collect-actions span{font-size:14px;color:#17665c}:root{color-scheme:light;--ink:#203b35;--green:#087b3c;--red:#b32735;--muted:#5b6c66}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:70px}body{margin:0;background:#f3f6f3;color:var(--ink);font:16px/1.8 system-ui,"Microsoft YaHei","PingFang SC",sans-serif}main{max-width:1000px;margin:auto;padding:28px 22px 70px}header,article,.panel{background:#fff;border:1px solid #d6e1da;border-radius:12px;padding:25px;margin:18px 0}h1,h2,h3{line-height:1.4;overflow-wrap:anywhere}h1{font-size:30px;margin:12px 0}h2{font-size:22px}h3{font-size:17px;margin:22px 0 8px}p{margin:9px 0}a{color:#17665c;text-underline-offset:3px}nav{display:flex;flex-wrap:wrap;gap:8px}nav a{padding:4px 11px;border:1px solid #d6e1da;border-radius:6px;text-decoration:none}.prose{white-space:pre-wrap;overflow-wrap:anywhere}.toolbar{position:sticky;top:0;z-index:2;display:flex;gap:10px;flex-wrap:wrap;justify-content:center;background:#e8efebf5;padding:10px}button{padding:7px 15px;border:1px solid #90aaa0;background:white;border-radius:6px;font:inherit;color:var(--ink);cursor:pointer}.meta,.source-links{color:var(--muted);font-size:14px}.total{font-size:27px;font-weight:700;color:var(--green)}.score{float:right;font-size:16px;margin:4px 0 4px 15px}.question.incorrect>h2,.wrong-answer,.question.partial>h2{color:var(--red)}.question.correct>h2,.reference-answer{color:var(--green)}.pending,.math-error{color:#8c6011}.math-error{display:inline-block;background:#fff5d9;border:1px solid #e3cc91;padding:2px 6px;white-space:pre-wrap}.question-link{color:inherit;text-decoration:none}.question h2:after{content:"";display:block;clear:both}.explanation{margin-top:20px;border-top:1px solid #d6e1da;padding-top:15px}summary{font-weight:650;cursor:pointer}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;margin:15px 0;font-size:14px}td,th{border:1px solid #d6e1da;padding:9px;text-align:left;vertical-align:top}th{background:#eef5ef}.score-cell{white-space:nowrap}.question li{margin:9px 0}.diagram{max-width:620px;margin:20px auto}.diagram svg{width:100%;max-height:500px;border:1px solid #d6e1da}figcaption{font-weight:600;margin:8px 0}.sheet{position:relative;width:100%;background:white}.sheet img{position:absolute;top:0;left:0}.sheet svg{position:absolute;inset:0;width:100%;height:100%}.legacy-source{display:block;width:100%}.source{margin:24px 0}.knowledge-tags{color:#205cac}.katex-display{overflow-x:auto;overflow-y:hidden;padding:6px 0}.katex{font-size:1.08em}footer{color:var(--muted);font-size:13px;text-align:center}code{overflow-wrap:anywhere}#sources{background:white}@media(max-width:600px){main{padding:10px}header,article,.panel{padding:17px}.score{float:none;display:block;margin:6px 0}h1{font-size:25px}}@media print{@page{size:A4;margin:16mm}html{scroll-behavior:auto}body{background:white;font-size:11pt}.toolbar,.screen-only{display:none!important}main{max-width:none;padding:0}header,article,.panel{border:0;border-radius:0;padding:0;margin:0 0 8mm}h1,h2,h3,summary{break-after:avoid}h2{font-size:16pt}h3{font-size:12pt}tr,figure,.source,.katex-display{break-inside:avoid}thead{display:table-header-group}a{color:inherit;text-decoration:none}.question{break-before:page}.table-scroll,.katex-display{overflow:visible}details{border:0}.prose{orphans:3;widows:3}}`;
const COLLECTION_CONTROLS=`document.querySelectorAll('[data-collect]').forEach(button=>{button.onclick=async()=>{const message=button.nextElementSibling;button.disabled=true;message.textContent='正在加入…';try{const response=await fetch('/api/mistakes/collect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId:button.dataset.job,questionId:button.dataset.collect,scoreRevision:Number(button.dataset.revision)})});const result=await response.json();if(!response.ok)throw Error(result.error||'保存失败');button.textContent='已加入错题本';message.textContent=result.data.extractionNeeded?'已保存，原题截图可在错题本中自动补齐。':'题图与解答已保存。';const link=document.createElement('a');link.href='/?mistake='+encodeURIComponent(result.data.id)+'#mistakes';link.target='_blank';link.rel='noopener';link.textContent='查看错题本';message.append(' ',link);}catch(error){message.textContent=error.message;button.disabled=false;}}});`;
const CONTROLS=`const all=()=>document.querySelectorAll('details');document.getElementById('expand').onclick=()=>all().forEach(d=>d.open=true);document.getElementById('collapse').onclick=()=>document.querySelectorAll('.explanation').forEach(d=>d.open=false);let previous;window.addEventListener('beforeprint',()=>{previous=[...all()].map(d=>d.open);all().forEach(d=>d.open=true)});window.addEventListener('afterprint',()=>{if(previous)all().forEach((d,i)=>d.open=previous[i]);previous=null});document.getElementById('print').onclick=async()=>{await document.fonts.ready;await Promise.all([...document.images||[]].map(i=>i.decode?.().catch(()=>{})));window.print()};if(new URLSearchParams(location.search).get('print')==='1')document.fonts.ready.then(()=>document.getElementById('print').onclick());`;

async function createAnswersHtml(job,{loadAsset,loadQuestionAsset,scoreRevision,questionAssets,online=false,kind='answers'}={}){
 if(!job.result?.questions.length)throw Error('尚无逐题结果，不能生成详细解答。');
 const label=kind==='marked'?'批改卷':'详细解答';
 questionAssets=questionAssets?structuredClone(questionAssets):null;
 if(!online&&questionAssets){for(const q of questionAssets.questions)for(const a of q.assets)a.src='data:'+a.type+';base64,'+(await loadQuestionAsset(a)).toString('base64');}
 const mathCss=await mathStyles(),nonce=crypto.randomBytes(18).toString('base64'),s=G.scoreReport(job),sources=[];
 let size=Buffer.byteLength(mathCss);
 for(const p of job.pages){
  if(!['image/png','image/jpeg','image/webp'].includes(p.type))throw Error('原卷页面类型不支持，请核对阅读页。');
  const bytes=online?Buffer.alloc(0):await loadAsset(p);size+=Math.ceil(bytes.length/3)*4;
  if(size>60*1024*1024)throw Object.assign(Error('离线解答包含的原图过大，请拆分试卷。'),{status:413});
  const source=job.files.find(f=>f.id===p.sourceId),data=online?'/api/grading/jobs/'+job.id+'/files/'+p.id:`data:${p.type};base64,${bytes.toString('base64')}`;
  sources.push(`<figure class="source" id="source-${escape(p.id)}"><figcaption>${escape(roles[p.role])} · ${escape(source?.name||p.name)} · 第${p.pageNumber}页</figcaption>${markedPage(job,p,data)}</figure>`);
 }
 const rows=job.result.questions.map((q,i)=>{const st=G.questionState(q,job.reviews?.[q.id]);return `<tr><td><a href="#question-${i}">${escape(q.number)}</a></td><td class="score-cell">${escape(G.scoreLabel(st))}</td><td class="${st.status==='incorrect'?'wrong-answer':st.status}">${statuses[st.status]}</td><td>${rich(st.status==='pending'?q.reviewReason:q.feedback)}</td></tr>`;}).join('');
 const html=`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="studytrail-renderer" content="${HTML_RENDERER}"><meta name="studytrail-score-revision" content="${escape(scoreRevision??job.scoreRevision??'')}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${online?"'self' data:":'data:'}; font-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${online?"'self'":"'none'"}; base-uri 'none'; form-action 'none'"><title>${escape(job.title)} · ${label}</title><style>${mathCss}\n${CSS}</style></head><body><div class="toolbar"><button id="expand">展开全部</button><button id="collapse">收起解析</button><button id="print">打印 / 另存 PDF</button><a href="#scores">得分表</a>${kind==='marked'?'':'<a href="#knowledge">知识点</a>'}<a href="#sources">原卷</a></div><main><header id="scores"><p class="meta">STUDYTRAIL · ${label}${online?'':' · 离线版'}</p><h1>${escape(job.title)}</h1><p>${escape(job.grade)} · ${escape(job.subject)} · ${job.result.questions.length}题</p><p class="total">${escape(s.title)} ${escape(s.value)}</p><p>折合 ${escape(s.outOfTen)} · 全对${s.correct}题 · 部分得分${s.partial}题 · 错误${s.incorrect}题 · 待核${s.pending}题</p>${prose(s.note)}<p class="meta">${online?'题图独立保存在本机，可逐题一键加入错题本；打印时自动展开内容。':'本文件已包含原图、公式和字体，可离线打开；文字可搜索、复制。打印时自动展开全部内容。加入错题本请在应用中打开此报告。'}评分版本：${escape(scoreRevision??job.scoreRevision??'未记录')}。</p><div class="table-scroll"><table><thead><tr><th>题号</th><th>得分 / 满分</th><th>状态</th><th>分析与建议</th></tr></thead><tbody>${rows}</tbody></table></div><nav aria-label="题号导航">${job.result.questions.map((q,i)=>`<a href="#question-${i}">${escape(q.number)}</a>`).join('')}</nav></header>${job.result.questions.map((q,i)=>question(job,q,i,{kind,online,scoreRevision,questionAssets})).join('')}${kind==='marked'?'':`<section class="panel" id="knowledge"><h2>知识点与解题技巧</h2>${job.result.knowledgeSummary.map(k=>`<section><h3>${rich(k.topic)}</h3>${prose(k.summary)}<h4>易错点</h4>${bullets(k.commonMistakes)}<h4>巩固与迁移</h4>${bullets(k.practice)}</section>`).join('')}${block('整卷建议',job.result.overallFeedback)}</section>`}<details class="panel" id="sources" ${kind==='marked'?'open':''}><summary>原题、学生答卷与参考材料（${job.pages.length}页）</summary><p class="meta">原图保留；连线表示题目位置，AI位置请结合题号核对。</p>${sources.join('')}</details><footer>StudyTrail · 本机生成 · KaTeX ${escape(katex.version)} · 原始材料与评分分别保留</footer></main><script nonce="${nonce}">${CONTROLS}</script>${online?`<script nonce="${nonce}">${COLLECTION_CONTROLS}</script>`:''}</body></html>`;
 if(Buffer.byteLength(html)>64*1024*1024)throw Object.assign(Error('离线解答超过64 MiB，请拆分试卷。'),{status:413});
 return html;
}
module.exports={createAnswersHtml,rich,mathStyles,diagram,HTML_RENDERER,REPORT_CSP,ONLINE_REPORT_CSP};
