'use strict';
// A deliberately limited, non-executing reader for local report TeX. No TeX commands,
// file includes, shell escapes or arbitrary HTML are evaluated.
const katex=require('katex');
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const COLORS={navy:'#173650',muted:'#596b78',accent:'#b65a27',bad:'#b72a37',good:'#20724f',white:'#fff',black:'#111',shade:'#e5eff5',amber:'#91610b',questionstate:'#173650'};
function group(s,i,open='{',close='}'){
 while(/\s/.test(s[i]||'')&&i<s.length)i++;
 if(s[i]!==open)throw Error('Expected '+open+' near '+s.slice(i,i+50));
 const start=++i;let depth=1;
 for(;i<s.length;i++){if(s[i]==='\\'){i++;continue;}if(s[i]===open)depth++;if(s[i]===close&&!--depth)return {value:s.slice(start,i),end:i+1};}
 throw Error('Unclosed TeX group');
}
function cleanTex(s){return s.replace(/(?<!\\)%[^\n]*(?:\n|$)/g,'').replace(/\\begin\{document\}/,'').replace(/\\end\{document\}/,'').replace(/第\s*\\pageref\{q([^}]+)\}\s*页/g,(_,n)=>'\\hyperref[q'+n+']{第'+n+'题}').replace(/第\s*\\pageref\{([^}]+)\}\s*页/g,(_,target)=>'\\hyperref['+target+']{相关章节}');}
function renderTex(source,{assets={},strict=true}={}){
 const issues=[],text=[],math=[];
 const fail=message=>{issues.push(message);if(strict)throw Error(message);};
 const formula=(value,display=false)=>{
  const tex=value.replace(/\\ce\s*\{/g,'\\mathrm{');
  text.push((display?'\n\\[':'\\(')+tex+(display?'\\]\n':'\\)'));
  try{const html=katex.renderToString(tex,{displayMode:display,throwOnError:true,trust:false,maxExpand:1000,maxSize:20,strict:'ignore',macros:{'\\vect':'\\overrightarrow{#1}','\\norm':'\\left\\lVert#1\\right\\rVert','\\dd':'\\,\\mathrm{d}'}});math.push(tex);return html;}
  catch(e){fail('Formula: '+tex+' / '+e.message);return '<code>'+escape(value)+'</code>';}
 };
 const image=(name)=>{const a=assets[name];if(!a){fail('Missing TeX image: '+name);return '';}return `<img class="tex-image" src="${escape(a.url)}" alt="${escape(a.name||'原图')}" width="${Number(a.width)}" height="${Number(a.height)}" loading="lazy">`;};
 function picture(s,dim){
  const [w,h]=dim.split(',').map(Number);if(!(w>0&&h>0))throw Error('Invalid picture size');
  const shapes=[];let color='navy',stroke=.18;
  const pair=(at)=>{const g=group(s,at,'(',')');const v=g.value.split(',').map(Number);if(v.length!==2||v.some(n=>!Number.isFinite(n)))throw Error('Invalid coordinate');return {...g,v};};
  for(let i=0;i<s.length;){
   if(s[i]!=='\\'){i++;continue;}const m=s.slice(i).match(/^\\([a-zA-Z]+)\*?/);if(!m){i++;continue;}i+=m[0].length;const cmd=m[1];
   if(cmd==='color'){const g=group(s,i);color=g.value;i=g.end;continue;}
   if(cmd==='linethickness'){const g=group(s,i);stroke=parseFloat(g.value)*.3528;i=g.end;continue;}
   if(cmd==='qbezier'){const a=pair(i),b=pair(a.end),c=pair(b.end);i=c.end;shapes.push(`<path d="M${a.v[0]},${h-a.v[1]} Q${b.v[0]},${h-b.v[1]} ${c.v[0]},${h-c.v[1]}" fill="none" stroke="${COLORS[color]||COLORS.navy}" stroke-width="${stroke}"/>`);continue;}
   if(cmd==='put'){
    const p=pair(i),g=group(s,p.end);i=g.end;const [x,y]=p.v,body=g.value,ink=COLORS[color]||COLORS.navy;
    const line=body.match(/^\\(?:line|vector)\(([-\d.]+),([-\d.]+)\)\{([-\d.]+)\}/);
    if(line){const dx=Number(line[1]),dy=Number(line[2]),len=Number(line[3]),xx=x+(dx?Math.sign(dx)*len:0),yy=y+(dx?dy/Math.abs(dx)*len:Math.sign(dy)*len);shapes.push(`<path d="M${x},${h-y} L${xx},${h-yy}" stroke="${ink}" stroke-width="${stroke}"/>`);continue;}
    const graphics=body.match(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/);
    if(graphics){const a=assets[graphics[1]];if(!a){fail('Missing picture image: '+graphics[1]);continue;}const width=Number(body.match(/width=([\d.]+)mm/)?.[1]||w),height=width*a.height/a.width;shapes.push(`<image x="${x}" y="${h-y-height}" width="${width}" height="${height}" href="${escape(a.url)}"/>`);continue;}
    const box=body.match(/^\\makebox\(([^)]+)\)(?:\[([lrc])\])?/);let label=body,align='center';
    if(box){label=group(body,box[0].length).value;align=box[2]==='l'?'left':box[2]==='r'?'right':'center';}
    const width=Math.max(w,80),height=14,left=align==='left'?x:align==='right'?x-width:x-width/2;
    shapes.push(`<foreignObject x="${left}" y="${h-y-height/2}" width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:3.6px;color:${ink};height:100%;display:flex;align-items:center;justify-content:${align==='center'?'center':align==='left'?'flex-start':'flex-end'};white-space:nowrap">${parse(label)}</div></foreignObject>`);continue;
   }
   if(!['normalsize','small','scriptsize','bfseries','thinlines','thicklines'].includes(cmd))fail('Unsupported picture command: '+cmd);
  }
  return `<figure class="tex-diagram"><svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ${w+8} ${h+8}" style="width:${Math.min(950,w*4)}px;max-width:100%;overflow:visible" role="img" aria-label="原 LaTeX 图示">${shapes.join('')}</svg></figure>`;
 }
 function parse(s){
  let out='',i=0;
  const arg=()=>{const g=group(s,i);i=g.end;return g.value;};
  const option=()=>{while(/\s/.test(s[i]||'')&&i<s.length)i++;if(s[i]==='['){const g=group(s,i,'[',']');i=g.end;return g.value;}return '';};
  while(i<s.length){
   if(s.startsWith('$$',i)||s.startsWith('\\[',i)||s.startsWith('\\(',i)||s[i]==='$'){
    const open=s.startsWith('$$',i)?'$$':s.startsWith('\\[',i)?'\\[':s.startsWith('\\(',i)?'\\(':'$',close=open==='\\['?'\\]':open==='\\('? '\\)':open,start=i+open.length,end=s.indexOf(close,start);
    if(end<0)throw Error('Unclosed formula');out+=formula(s.slice(start,end),['$$','\\['].includes(open));i=end+close.length;continue;
   }
   if(s[i]==='{'){out+=parse(arg());continue;}
   if(s[i]!=='\\'){
    const start=i;while(i<s.length&&!['\\','{','$'].includes(s[i]))i++;const v=s.slice(start,i);text.push(v);out+=escape(v).replace(/\n\s*\n/g,'<br><br>');continue;
   }
   const m=s.slice(i).match(/^\\([a-zA-Z]+)\*?|^\\(.)/s);if(!m)throw Error('Invalid TeX escape');i+=m[0].length;const c=m[1]||m[2];
   if(!m[1]){if(c==='\\'){option();out+='<br>';text.push('\n');}else{const v={',':' ',';':' ',':':' ','!':'',' ':' '}[c]??c;out+=escape(v);text.push(v);}continue;}
   if(['step','sheet','section','subsection','subsubsection'].includes(c)){const v=arg();text.push('\n');out+='<h3>'+parse(v)+'</h3>';text.push('\n');continue;}
   if(c==='question'){const n=arg(),t=arg();out+='<h2>'+escape(n)+' '+parse(t)+'</h2>';continue;}
   if(c==='memo'){const t=arg(),target=arg();out+='<h2 id="tex-'+escape(target)+'">'+parse(t)+'</h2>';continue;}
   if(c==='ans'){out+=formula('\\boxed{\\displaystyle '+arg()+'}',true);continue;}
   if(c==='ensuremath'||c==='ce'){out+=formula(c==='ce'?'\\mathrm{'+arg()+'}':arg());continue;}
   if(['textbf','emph','textit','underline','figcap','issue','warning','good'].includes(c)){const tags={textbf:'strong',emph:'em',textit:'em',underline:'u',figcap:'figcaption',issue:'div',warning:'div',good:'span'},tag=tags[c],className=['issue','warning'].includes(c)?'tex-bad':c==='good'?'tex-good':'';out+=`<${tag} class="${className}">${parse(arg())}</${tag}>`;continue;}
   if(c==='textcolor'){const color=arg();out+=`<span style="color:${COLORS[color]||COLORS.navy}">${parse(arg())}</span>`;continue;}
   if(c==='color'){arg();continue;}
   if(c==='orig'||c==='original'){const name=arg(),caption=arg();out+='<figure>'+image(name)+'<figcaption>'+parse(caption)+'</figcaption></figure>';continue;}
   if(c==='includegraphics'){option();out+=image(arg());continue;}
   if(c==='begin'){
    const env=arg();let parameter='';if(env==='itemize'||env==='enumerate')option();if(env==='tabular')parameter=arg();if(env==='picture'){const g=group(s,i,'(',')');i=g.end;parameter=g.value;}
    const start=i;let depth=1,end=-1;const token=new RegExp('\\\\(begin|end)\\{'+env+'\\}','g');token.lastIndex=i;let match;
    while((match=token.exec(s))){depth+=match[1]==='begin'?1:-1;if(!depth){end=match.index;i=token.lastIndex;break;}}
    if(end<0)throw Error('Unclosed environment '+env);const body=s.slice(start,end);
    if(env==='picture'){out+=picture(body,parameter);continue;}
    if(['center','quote'].includes(env)){out+=`<div class="tex-${env}">${parse(body)}</div>`;continue;}
    if(['itemize','enumerate'].includes(env)){const tag=env==='enumerate'?'ol':'ul';out+=`<${tag}>`+body.split(/\\item(?:\[[^\]]*\])?/).filter(t=>t.trim()).map(t=>'<li>'+parse(t)+'</li>').join('')+`</${tag}>`;continue;}
    if(env==='tabular'){out+='<div class="tex-table"><table>'+body.replace(/\\hline/g,'').split(/\\\\(?:\[[^\]]*\])?/).filter(t=>t.trim()).map(row=>'<tr>'+row.split(/(?<!\\)&/).map(cell=>'<td>'+parse(cell)+'</td>').join('')+'</tr>').join('')+'</table></div>';continue;}
    if(['equation','align','aligned','gathered','array'].includes(env)){out+=formula('\\begin{'+env+'}'+body+'\\end{'+env+'}',true);continue;}
    fail('Unsupported environment '+env);continue;
   }
   if(['setlength','renewcommand'].includes(c)){arg();arg();continue;}
   if(c==='def'){const macro=s.slice(i).match(/^\\[a-zA-Z]+/);if(!macro)throw Error('Invalid definition');i+=macro[0].length;arg();continue;}
   if(c==='label'){out+='<span id="tex-'+escape(arg())+'"></span>';continue;}
   if(['markright','hspace','vspace','addcontentsline'].includes(c)){arg();if(c==='addcontentsline'){arg();arg();}continue;}
   if(c==='hyperref'){const target=option();out+='<a href="#tex-'+escape(target)+'">'+parse(arg())+'</a>';continue;}
   if(c==='pageref'||c==='ref'){const target=arg();out+='<a href="#tex-'+escape(target)+'">相关章节</a>';continue;}
   if(['par','smallskip','medskip','bigskip','clearpage','newpage'].includes(c)){out+='<br><br>';text.push('\n\n');continue;}
   if(['noindent','normalsize','small','large','Large','scriptsize','bfseries','sffamily','raggedright','tableofcontents','phantomsection'].includes(c))continue;
   if(['quad','qquad'].includes(c)){out+='　';text.push(' ');continue;}
   if(c==='shortstack'){out+=parse(arg());continue;}
   fail('Unsupported TeX command: '+c);out+=escape('\\'+c);
  }
  return out;
 }
 const html=parse(cleanTex(source)).replace(/(?:<br>\s*)+(?=<(?:h[1-6]|figure|div|ul|ol|table)\b)/g,'').replace(/(<\/(?:h[1-6]|figure|div|ul|ol|table)>)(?:\s*<br>)+/g,'$1').replace(/^(?:\s*<br>)+|(?:<br>\s*)+$/g,'');return {html,text:text.join('').replace(/\n{3,}/g,'\n\n').trim(),formulas:math,issues};
}
module.exports={renderTex,cleanTex,group};
