'use strict';
const assert=require('node:assert/strict'),{renderTex}=require('../api/tex-content'),{enhancePaper}=require('../api/document-image'),sharp=require('sharp');
(async()=>{
 const r=renderTex(String.raw`\step{解题思路}\textbf{能量守恒}：$E=mc^2$。\ans{\frac{1}{2}mv^2}\begin{itemize}\item 第一项\item \ce{H_2O}\end{itemize}\begin{tabular}{cc}条件&结论\\ A&B\end{tabular}\begin{picture}(40,30){\color{bad}\linethickness{1pt}\qbezier(0,0)(20,30)(40,0)}\put(20,15){\makebox(0,0){$F_e$}}\end{picture}<script>alert(1)</script>`);
 assert.equal(r.issues.length,0);assert.equal(r.formulas.length,4);assert.match(r.html,/class="katex/);assert.match(r.html,/<table>/);assert.match(r.html,/<foreignObject/);assert.match(r.html,/Q20,0 40,30/);assert.doesNotMatch(r.html,/<script>/);assert.match(r.html,/&lt;script&gt;/);assert.match(r.text,/\\\(E=mc\^2\\\)/);
 for(const tex of [String.raw`\input{/etc/passwd}`,String.raw`\write18{touch forbidden}`,String.raw`\unknown{silent loss}`,String.raw`$\badformula$`])assert.throws(()=>renderTex(tex));
 assert.throws(()=>renderTex(String.raw`\includegraphics{missing.png}`),/Missing/);
 const list=renderTex(String.raw`\begin{enumerate}[leftmargin=2em,itemsep=5pt]\item 第一问\item 第二问\end{enumerate}`);assert.equal((list.html.match(/<li>/g)||[]).length,2);assert.doesNotMatch(list.html,/leftmargin|itemsep/);
 const layout=renderTex('\\step{思路}\n\n正文\n\n\\step{说明}\n\n参见第\\pageref{q2} 页和第\\pageref{memo-a}页。\\memo{附录}{memo-a}');
 assert.doesNotMatch(layout.html,/<br>\s*<h|<\/h3>\s*<br>|第相关章节页/);assert.match(layout.html,/href="#tex-q2">第2题/);assert.match(layout.html,/id="tex-memo-a"/);
 const width=256,height=128,data=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let value=150+x/5;if(x>40&&x<45)value=45;if(x>100&&x<103)value=115;for(let c=0;c<3;c++)data[(y*width+x)*3+c]=value;}
 const source=await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer(),result=await enhancePaper(source),raw=await sharp(result.bytes).raw().toBuffer();
 const at=x=>raw[(64*width+x)*3];assert.equal(result.width,width);assert.equal(result.height,height);assert.ok(at(15)>=235&&at(240)>=235,'both shadowed and bright paper become light');assert.ok(at(42)<30,'dark fine stroke remains dark');assert.ok(at(101)<190,'faint stroke remains visible');assert.ok(at(99)>at(101)+30,'no threshold erases light markings');
 assert.deepEqual(await sharp(source).raw().toBuffer(),data,'source bytes never change');
 const color=await sharp({create:{width:40,height:40,channels:3,background:'blue'}}).png().toBuffer();assert.deepEqual((await enhancePaper(color)).bytes,color,'saturated illustrations are preserved');
 console.log('PASS: safe native TeX paragraphs, formulas, tables, vector drawings, rejected commands and paper illumination correction preserving fine/faint strokes, color and originals.');
})().catch(e=>{console.error(e);process.exitCode=1;});
