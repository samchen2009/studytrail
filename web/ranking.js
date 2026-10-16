(function(root){
'use strict';
const typeNames={percent:'百分比排名',position:'名次',grade:'等级'};
function valueLabel(value,kind){return value===null?'未录入':kind==='percent'?'前 '+num(value)+'%':kind==='position'?'第 '+num(value)+' 名':value;}
function valueHint(raw,kind){if(!raw.raw)return '未录入';return raw[kind]===null?(raw.grade&&kind!=='grade'?'仅等级 '+raw.grade:'仅原文记录'):'';}
function chart(subject,kind){
 const a=exams(),mobile=window.innerWidth<=640,w=mobile?340:720,h=278,left=mobile?38:48,right=mobile?30:42,top=34,bottom=44,iw=w-left-right,ih=h-top-bottom;
 const values=a.map(e=>C.rankValue(e,subject,kind));
 const plotted=values.map(v=>v===null?null:kind==='grade'?C.rankGrades.indexOf(v):v);
 const min=kind==='position'?1:0,max=kind==='percent'?100:kind==='grade'?C.rankGrades.length-1:Math.max(2,...plotted.filter(v=>v!==null));
 const px=i=>a.length===1?left+iw/2:left+i*iw/(a.length-1),py=v=>top+ih*(v-min)/(max-min);
 const ticks=kind==='grade'?[0,3,6,9,12,15]:kind==='position'&&max<5?[1,max]:[min,min+(max-min)*.25,min+(max-min)*.5,min+(max-min)*.75,max];
 let out=`<svg class="chart ranking-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${subject}历次${typeNames[kind]}趋势，越靠上越好">`;
 for(const n of ticks){const y=py(n),label=kind==='grade'?C.rankGrades[n]:kind==='percent'?num(n)+'%':num(Math.round(n));out+=`<line x1="${left}" x2="${w-right}" y1="${y}" y2="${y}" stroke="#eef1eb"/><text x="${left-10}" y="${y+4}" text-anchor="end" font-size="10" fill="#9aa69e">${label}</text>`;}
 let segments=[],segment=[];plotted.forEach((v,i)=>{if(v===null){if(segment.length)segments.push(segment);segment=[];}else segment.push([px(i),py(v)]);});if(segment.length)segments.push(segment);
 for(const points of segments)out+=`<path d="${points.map(([x,y],i)=>`${i?'L':'M'}${x},${y}`).join(' ')}" fill="none" stroke="#317761" stroke-width="2.5" stroke-linejoin="round"/>`;
 a.forEach((e,i)=>{const x=px(i),v=plotted[i],raw=C.parseRank(e.ranks?.[subject]),label=e.name.length>8?e.name.slice(0,8):e.name;
  if(v!==null)out+=`<circle cx="${x}" cy="${py(v)}" r="${e.id===selectedId?5:4}" fill="${e.id===selectedId?'#216454':'white'}" stroke="#317761" stroke-width="2"><title>${esc(e.grade+' · '+e.name)}：${valueLabel(values[i],kind)}；原文 ${esc(raw.raw)}</title></circle><text x="${x}" y="${py(v)-13}" text-anchor="middle" fill="#567568" font-size="11">${kind==='percent'?num(values[i])+'%':kind==='position'?num(values[i])+' 名':values[i]}</text>`;
  else out+=`<text x="${x}" y="${top+ih-6}" text-anchor="middle" font-size="10" fill="#a0aaa2">${esc(valueHint(raw,kind))}</text>`;
  out+=`<text x="${x}" y="${h-13}" text-anchor="middle" font-size="10" fill="#939f97">${esc(label)}</text>`;
 });
 return out+'</svg>';
}
function body(subject,kind){const e=current(),prior=previous(e),value=C.rankValue(e,subject,kind),change=C.rankChange(e,prior,subject,kind),unit=kind==='percent'?'个百分点':kind==='position'?'名':'档';
 const direction=change===null?'暂无可比的上次记录':change===0?'与上次持平':`<span class="${change>0?'up':'down'}">${change>0?'前进':'后退'} ${num(Math.abs(change))} ${unit}</span>`;
 const all=exams(),known=all.filter(x=>C.rankValue(x,subject,kind)!==null);
 return `<div class="toolbar ranking-toolbar"><label>趋势科目<select id="rankSubject" aria-label="排名趋势科目">${S.map(s=>`<option ${subject===s?'selected':''}>${s}</option>`).join('')}</select></label><label>排名形式<select id="rankKind" aria-label="排名形式">${Object.entries(typeNames).map(([key,name])=>`<option value="${key}" ${kind===key?'selected':''}>${name}</option>`).join('')}</select></label></div><div class="ranking-current"><div><small>${esc(e.name)} · ${subject}</small><strong>${valueLabel(value,kind)}</strong></div><div>${direction}<small>${prior?'较 '+esc(prior.name):'记录下一次考试后可比较'}</small></div></div>${known.length?`<div class="chart-wrap">${chart(subject,kind)}</div>`:`<div class="empty ranking-empty"><h3>暂无${subject}${typeNames[kind]}数据</h3><p>可切换排名形式查看已有记录，或补充本次排名。</p></div>`}<div class="chart-summary"><span>${kind==='percent'?'年级前 X%，越小越好':kind==='position'?'名次越小越好':'按等级顺序展示'} · 图表越靠上越好</span><span>已录入 ${known.length} / ${all.length} 次</span></div><details class="ranking-history"><summary>查看各次排名原文与变化</summary><div class="table-scroll"><table><thead><tr><th>考试</th><th>${typeNames[kind]}</th><th>较上次</th><th>原文</th></tr></thead><tbody>${all.map((exam,i)=>{const v=C.rankValue(exam,subject,kind),d=C.rankChange(exam,all[i-1],subject,kind),raw=C.parseRank(exam.ranks?.[subject]);return `<tr><td>${esc(exam.grade+' · '+exam.name)}</td><td>${valueLabel(v,kind)}</td><td>${d===null?'—':d===0?'持平':`<span class="${d>0?'up':'down'}">${d>0?'前进':'后退'} ${num(Math.abs(d))} ${unit}</span>`}</td><td>${esc(raw.raw)||'—'}</td></tr>`;}).join('')}</tbody></table></div></details><p class="hint ranking-note">缺失或不同形式的排名会留空。年级前 X% 与具体名次分别比较，等级不换算为百分比。跨年级、参试人数或范围变化需结合考试背景判断。</p><button class="text-btn ranking-edit" data-edit="${esc(e.id)}">补充 / 编辑${subject}排名 ↗</button>`;
}
function preferredKind(subject,currentKind='percent'){return exams().some(e=>C.rankValue(e,subject,currentKind)!==null)?currentKind:['percent','position','grade'].find(kind=>exams().some(e=>C.rankValue(e,subject,kind)!==null))||'percent';}
root.RankingView={body,preferredKind};
})(window);
