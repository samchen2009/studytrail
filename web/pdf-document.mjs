// Small image-only PDF writer. All fonts/layout are rendered locally by the browser.
// No native runtime, external font service, or cloud PDF conversion is needed.
const ascii=text=>new TextEncoder().encode(text);
export function imagePdf(pages){
 if(!pages.length||pages.length>500)throw Error('PDF 页数须在 1～500 之间，请拆分过长的解析。');
 const parts=[],offsets=[0];let length=0;
 const push=value=>{const b=typeof value==='string'?ascii(value):value;parts.push(b);length+=b.byteLength;};
 const object=(id,body)=>{offsets[id]=length;push(id+' 0 obj\n');for(const part of body)push(part);push('\nendobj\n');};
 push('%PDF-1.4\n%StudyTrail\n');
 object(1,['<< /Type /Catalog /Pages 2 0 R >>']);
 object(2,['<< /Type /Pages /Count '+pages.length+' /Kids ['+pages.map((_,i)=>(3+i*3)+' 0 R').join(' ')+'] >>']);
 pages.forEach((p,i)=>{
  if(!(p.bytes instanceof Uint8Array)||p.bytes[0]!==255||p.bytes[1]!==216||!Number.isInteger(p.width)||!Number.isInteger(p.height)||p.width<1||p.height<1)throw Error('PDF 页面必须是有效 JPEG 图片。');
  const id=3+i*3,w=p.width>p.height?841.89:595.28,h=p.width>p.height?595.28:841.89;
  object(id,['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+w+' '+h+'] /Resources << /XObject << /Im0 '+(id+1)+' 0 R >> >> /Contents '+(id+2)+' 0 R >>']);
  object(id+1,['<< /Type /XObject /Subtype /Image /Width '+p.width+' /Height '+p.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+p.bytes.length+' >>\nstream\n',p.bytes,'\nendstream']);
  const commands='q\n'+w+' 0 0 '+h+' 0 0 cm\n/Im0 Do\nQ\n';
  object(id+2,['<< /Length '+ascii(commands).length+' >>\nstream\n',commands,'endstream']);
 });
 const xref=length;push('xref\n0 '+offsets.length+'\n0000000000 65535 f \n');
 for(let i=1;i<offsets.length;i++)push(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
 push('trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
 if(length>64*1024*1024)throw Error('PDF 超过 64 MiB，请拆分试卷或解析。');
 return new Blob(parts,{type:'application/pdf'});
}
