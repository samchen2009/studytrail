"""Convert explicitly selected, local answer PDFs into versioned HTML report assets.
Requires pypdfium2 and Pillow. Configuration and student data stay outside Git.
Original attachment bytes and metadata are never modified.
"""
import argparse, hashlib, io, json, re
from pathlib import Path
import pypdfium2 as pdfium
from PIL import Image


def lines_of(page):
    tp = page.get_textpage(); result = []; cursor = 0; height = page.get_height()
    for line in tp.get_text_range().splitlines():
        if not line.strip(): continue
        hit = tp.search(line, index=cursor, match_case=True).get_next()
        if not hit: continue
        cursor = hit[0] + hit[1]
        boxes = [tp.get_charbox(i) for i in range(hit[0], cursor) if tp.get_text_range(i, 1).strip()]
        if not boxes: continue
        result.append(dict(text=line, top=height-max(b[3] for b in boxes), bottom=height-min(b[1] for b in boxes), left=min(b[0] for b in boxes), height=max(b[3]-b[1] for b in boxes)))
    tp.close(); return result


def convert_key(root, config):
    """A scanned answer key uses visually checked regions and the matching paper's question images."""
    aid=config['id'];folder=root/'attachments'/aid;meta=json.loads((folder/'meta.json').read_text())
    if (folder/'deleted').exists() or meta['kind'] in ['paper','answer'] or meta['type']!='application/pdf':raise ValueError('Not an answer report')
    other=root/'attachments'/config['reuseQuestionImages'];other_meta=json.loads((other/'meta.json').read_text())
    if other_meta['examId']!=meta['examId'] or other_meta['subject']!=meta['subject']:raise ValueError('Question source mismatch')
    original=json.loads((other/'html-report/manifest.json').read_text());source=folder/'file.bin'
    document=pdfium.PdfDocument(str(source));output=folder/'html-report';(output/'assets').mkdir(parents=True,exist_ok=True)
    def crop(page_number, rect, name):
        page=document[page_number-1];image=page.render(scale=2).to_pil().convert('RGB');page.close();W,H=image.size
        x,y,w,h=rect;image=image.crop((round(x*W),round(y*H),round((x+w)*W),round((y+h)*H)))
        buf=io.BytesIO();image.save(buf,format='JPEG',quality=93);data=buf.getvalue();key=hashlib.sha256(data).hexdigest();(output/'assets'/(key+'.jpg')).write_bytes(data)
        return dict(hash=key,type='image/jpeg',name=name,width=image.width,height=image.height,size=len(data),origin=dict(pageNumber=page_number,rect=rect,rotation=0))
    questions=[]
    for spec in config['questions']:
        q=dict(next(q for q in original['questions'] if q['number']==str(spec['number'])))
        q['title']='第 '+q['number']+' 题 · 参考答案';q['answer']=spec['answer'];q['content']=[crop(spec.get('pageNumber',1),spec['rect'],'原参考答案 · 第 '+q['number']+' 题')]
        for a in q['images']:(output/'assets'/(a['hash']+'.jpg')).write_bytes((other/'html-report/assets'/(a['hash']+'.jpg')).read_bytes())
        questions.append(q)
    if sorted(q['number'] for q in questions)!=sorted(map(str,config['expected'])):raise ValueError('Question coverage mismatch')
    sections=[dict(pageNumber=n,title='参考答案及评分标准',text='',image=crop(n,[0,0,1,1],'原参考答案第 '+str(n)+' 页'))for n in range(1,len(document)+1)]
    manifest=dict(schemaVersion=1,id=aid,title=Path(meta['name']).stem,subject=meta['subject'],sourceName=meta['name'],sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pageCount=len(document),questions=questions,sections=sections)
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False));document.close()
    print(json.dumps(dict(id=aid,questions=len(questions),pages=len(sections))),flush=True)


def convert(root, config):
    aid = config['id']; folder = root/'attachments'/aid
    meta = json.loads((folder/'meta.json').read_text()); source = folder/'file.bin'
    if (folder/'deleted').exists() or meta['type'] != 'application/pdf' or meta['kind'] in ['paper', 'answer']:
        raise ValueError('Refusing non-report or deleted attachment: '+aid)
    output = folder/'html-report'; (output/'assets').mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    document = pdfium.PdfDocument(str(source)); pages=[]; starts=[]; found=set(); mode=config['mode']
    for index in range(len(document)):
        page=document[index]; lines=lines_of(page); w,h=page.get_size()
        item=dict(index=index,width=w,height=h,lines=lines,images=[])
        for obj in page.get_objects():
            if obj.type == 3:
                x0,y0,x1,y1=obj.get_bounds()
                if x1-x0>50 and y1-y0>20:item['images'].append([x0,h-y1,x1,h-y0])
        pages.append(item)
        for line in lines:
            t=line['text'].strip(); number=None
            if mode in ['physics','chemistry','math'] and 45<line['top']<130 and line['height']>=12:
                if mode=='chemistry':
                    m=re.match(r'^([一二三四五])\s*(\d+)\s*[：:]',t)
                    if m:number=m[1]+'.'+m[2]
                else:
                    m=re.match(r'^第\s*(\d+)\s*题(?:[（(].*?[）)])?\s*[：:｜]',t)
                    if m:number=m[1]
            if mode=='math' and index+1 in [2,4,5,14]:
                m=re.match(r'^(\d+)[．.]',t)
                if m and line['height']>9:number=m[1]
            if mode=='english-local' and 2<=index<=32:
                m=re.match(r'^(\d+)\.\s*',t)
                if m and 21<=int(m[1])<=79 and line['left']<80:number=m[1]
                if index==32 and t.startswith('七、作文'):number='80'
            if mode=='english-practice':
                m=re.match(r'^第(\d+)题$',t)
                if m:number=m[1]
            if number and number not in found:
                found.add(number);starts.append(dict(number=number,title=t,page=index,top=max(40,line['top']-5)))
        page.close()
    if found != set(map(str,config['expected'])):
        raise ValueError(f'{aid}: question coverage mismatch missing={set(map(str,config["expected"]))-found} extra={found-set(map(str,config["expected"]))}')
    starts.sort(key=lambda x:(x['page'],x['top'])); image_cache={}
    def save_crop(pi,rect,role):
        p=pages[pi]; x0,y0,x1,y1=rect
        rect=[max(0,x0),max(0,y0),min(p['width'],x1),min(p['height'],y1)]
        if rect[3]-rect[1]<3:raise ValueError('Empty crop')
        if pi not in image_cache:
            page=document[pi];image_cache.clear();image_cache[pi]=page.render(scale=2).to_pil().convert('RGB');page.close()
        image=image_cache[pi].crop(tuple(round(v*2) for v in rect)); buffer=io.BytesIO();image.save(buffer,format='JPEG',quality=93)
        data=buffer.getvalue(); key=hashlib.sha256(data).hexdigest();file=output/'assets'/(key+'.jpg')
        if not file.exists():file.write_bytes(data)
        return dict(hash=key,type='image/jpeg',name=('题目截图' if role=='question' else '解答')+' · 原第 '+str(pi+1)+' 页',role=role,pageNumber=pi+1,width=image.width,height=image.height,size=len(data),origin=dict(pageNumber=pi+1,rect=[rect[0]/p['width'],rect[1]/p['height'],(rect[2]-rect[0])/p['width'],(rect[3]-rect[1])/p['height']],rotation=0))
    questions=[]; sections=[]
    for i,start in enumerate(starts):
        boundary=starts[i+1] if i+1<len(starts) else dict(page=config['questionEndPage'],top=40)
        end_page=boundary['page']; q=dict(id='q'+hashlib.sha256(start['number'].encode()).hexdigest()[:16],number=start['number'],title=start['title'],stem='',answer='',images=[],content=[])
        pi=start['page']; p=pages[pi]; own_end=boundary['top'] if end_page==pi else p['height']-42
        markers=[l for l in p['lines'] if start['top']<l['top']<own_end and re.match(r'^(学生作答|参考答案|错题｜|正确｜|失分｜|答案[：:]|示例答案|解题思路|以下直接嵌入|方法[一二三123]|The Last Calligrapher)',l['text'].strip())]
        stem_end=min((l['top']-4 for l in markers),default=min(own_end,start['top']+180))
        # Reports containing original crop objects retain all question/material images before answers.
        original_images=[r for r in p['images'] if r[1]>start['top'] and r[3]<stem_end+2]
        if original_images:
            q['images']=[save_crop(pi,r,'question') for r in original_images]
        elif mode!='physics' or not config.get('reuseQuestionImages'):
            q['images']=[save_crop(pi,[45,start['top'],p['width']-40,max(start['top']+22,stem_end)],'question')]
        q['stem']='\n'.join(l['text'] for l in p['lines'] if start['top']<=l['top']<stem_end)
        # Preserve exact answer layout, formulas, diagrams and annotations in per-question fragments.
        for k in range(pi,min(end_page+1,len(pages))):
            pg=pages[k]; top=start['top'] if k==pi else 43; bottom=boundary['top'] if k==end_page else pg['height']-42
            if bottom-top<4:continue
            q['content'].append(save_crop(k,[40,top,pg['width']-35,bottom],'answer'))
            q['answer']+='\n'+'\n'.join(l['text'] for l in pg['lines'] if top<=l['top']<bottom)
        # Keep shared reading passages with each English question for later reuse.
        for context in config.get('contexts',[]):
            if context['from']<=int(start['number'])<=context['to']:
                for page_number in context['pages']:
                    cp=pages[page_number-1]
                    for rect in cp['images']:
                        q['images'].insert(0,save_crop(page_number-1,rect,'question'))
        if config.get('reuseQuestionImages'):
            other=root/'attachments'/config['reuseQuestionImages']/'html-report'
            original=json.loads((other/'manifest.json').read_text()); existing=next(x for x in original['questions'] if x['number']==q['number'])
            q['images']=existing['images']
            for asset in q['images']:(output/'assets'/(asset['hash']+'.jpg')).write_bytes((other/'assets'/(asset['hash']+'.jpg')).read_bytes())
        # Explicit, visually checked original-paper crops can fill missing report statements.
        if q['number'] in config.get('questionImageOverrides', {}):
            q['images']=[]
            q['title']='第 '+q['number']+' 题';q['stem']=q['title']+'（完整题目见题图）'
            for spec in config['questionImageOverrides'][q['number']]:
                sid=spec['attachmentId']
                if not re.fullmatch(r'[a-f0-9-]{36}', sid):raise ValueError('Invalid image attachment')
                original=Image.open(root/'attachments'/sid/'file.bin').convert('RGB')
                x,y,w,h=spec['rect']; W,H=original.size
                if min(x,y,w,h)<0 or w<=0 or h<=0 or x+w>1.000001 or y+h>1.000001:raise ValueError('Invalid original crop')
                rotation=spec.get('rotation',0)
                if rotation not in [0,90,180,270]:raise ValueError('Invalid rotation')
                image=original.crop((round(x*W),round(y*H),round((x+w)*W),round((y+h)*H))).rotate(-rotation,expand=True)
                buffer=io.BytesIO();image.save(buffer,format='JPEG',quality=95);data=buffer.getvalue();key=hashlib.sha256(data).hexdigest()
                (output/'assets'/(key+'.jpg')).write_bytes(data)
                q['images'].append(dict(hash=key,type='image/jpeg',name='原卷第 '+q['number']+' 题',role='question',width=image.width,height=image.height,size=len(data),sourceAttachmentId=sid,origin=dict(pageNumber=spec.get('pageNumber',1),rect=spec['rect'],rotation=rotation)))
        q['images']=list({a['hash']:a for a in q['images']}.values())
        if not q['images']:raise ValueError('No question image: '+q['number'])
        # Legacy photos may contain handwriting; never silently certify a clean printable question.
        q['printReady']=False
        questions.append(q)
    # Preserve every original page, including overview, common passages and knowledge summaries.
    # These reference pages are separate from the per-question notebook data.
    for pi,p in enumerate(pages):
        text='\n'.join(l['text'] for l in p['lines']); title=next((l['text'] for l in p['lines'] if l['top']>43 and l['height']>=11),'原第 '+str(pi+1)+' 页')
        sections.append(dict(pageNumber=pi+1,title=title,text=text,image=save_crop(pi,[30,40,p['width']-25,p['height']-28],'reference')))
    manifest=dict(schemaVersion=1,sourceSha256=digest,sourceName=meta['name'],id=aid,title=Path(meta['name']).stem,subject=meta['subject'],questions=questions,sections=sections,pageCount=len(document))
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False))
    document.close();print(json.dumps(dict(id=aid,questions=len(questions),pages=len(pages)),ensure_ascii=False),flush=True)
    return manifest

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--data-dir',required=True);parser.add_argument('--config',required=True);args=parser.parse_args()
    root=Path(args.data_dir);config=json.loads(Path(args.config).read_text())
    for item in config:
        if item['mode']=='reference-key':convert_key(root,item)
        else:convert(root,item)
