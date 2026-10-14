"""Server-only vector/text PDF renderer, release V2.12.
Reads one authorized presentation JSON from stdin, writes PDF bytes to stdout.
No browser, network, shell, external font loading or report files on disk.
"""
import io, json, math, re, sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import ttfonts
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle
# ReportLab 3.x/4.x formats supplementary codepoints as raw hex in ToUnicode.
# PDF CMaps require UTF-16BE, including surrogate pairs, for searchable rare names.
_original_cmap=ttfonts.makeToUnicodeCMap
def unicode_cmap(fontname,subset):
 result=_original_cmap(fontname,subset)
 for i,codepoint in enumerate(subset):
  if codepoint>0xFFFF:
   result=result.replace(f'<{i:02X}> <{codepoint:04X}>',f'<{i:02X}> <{chr(codepoint).encode("utf-16-be").hex().upper()}>')
 return result
ttfonts.makeToUnicodeCMap=unicode_cmap
BASE=Path(__file__).resolve().parent
S=json.load(sys.stdin);R=S['report'];REPORT_VERSION=R.get('displayVersion','2.12');D={v['code']:v for v in R['dimensions']}
for weight,name in [('Regular','CN'),('Bold','CNBold')]:
 pdfmetrics.registerFont(TTFont(name,str(BASE/'fonts'/('DurenReportCJK-'+weight+'.ttf'))))
pdfmetrics.registerFontFamily('CN',normal='CN',bold='CNBold')
class NumberedCanvas(canvas.Canvas):
 def __init__(self,*args,**kwargs):
  super().__init__(*args,**kwargs);self.saved_states=[]
 def showPage(self):
  self.saved_states.append(dict(self.__dict__));self._startPage()
 def save(self):
  total=len(self.saved_states)
  for state in self.saved_states:
   self.__dict__.update(state)
   line(H-42)
   text(M,H-31,'测评结果报告 · V'+REPORT_VERSION,8,MUTED)
   right(W-M,H-31,f'{self._pageNumber:02d} / {total:02d}',8,MUTED)
   canvas.Canvas.showPage(self)
  canvas.Canvas.save(self)
W,H=595.2756,841.8898; M=43; CW=W-2*M
NAVY=HexColor('#28465F'); BLUE=HexColor('#627F97'); INK=HexColor('#172A39'); MUTED=HexColor('#657887'); RULE=HexColor('#D9E1E6'); PALE=HexColor('#EDF2F6'); WHITE=HexColor('#FFFFFF')
OUT=io.BytesIO()
c=NumberedCanvas(OUT,pagesize=(W,H),pageCompression=1)
c.setTitle('渡仁 职业与心理健康测评 测评结果报告');c.setAuthor('渡仁');c.setSubject('测评结果报告 · V'+REPORT_VERSION)
PAGE=0; LOG=[]; TITLE=''; SUB=''; BOTTOM=H-53
def finite(v):return isinstance(v,(int,float)) and math.isfinite(v)
def nf(v):return str(Decimal.from_float(float(v)).quantize(Decimal('0.1'),rounding=ROUND_HALF_UP)) if finite(v) else '—'
def text(x,y,s,size=10,color=INK,bold=False):
 c.setFont('CNBold' if bold else 'CN',size);c.setFillColor(color);c.drawString(x,H-y-size*0.84,str(s))
def right(x,y,s,size=10,color=INK,bold=False):
 c.setFont('CNBold' if bold else 'CN',size);c.setFillColor(color);c.drawRightString(x,H-y-size*.84,str(s))
def center(x,y,s,size=10,color=INK,bold=False):
 c.setFont('CNBold' if bold else 'CN',size);c.setFillColor(color);c.drawCentredString(x,H-y-size*.84,str(s))
def paragraph(s,width,size,lead,color):
 sty=ParagraphStyle('p',fontName='CN',fontSize=size,leading=lead,textColor=color,wordWrap='CJK',splitLongWords=1,rightIndent=size if '<b>' in s else 0)
 return Paragraph(s,sty)
def para(x,y,s,width=CW,size=10.3,lead=16,color=INK):
 p=paragraph(s,width,size,lead,color)
 while True:
  _,hh=p.wrap(width,100000)
  if y+hh <= BOTTOM:
   p.drawOn(c,x,H-y-hh);return y+hh
  parts=p.split(width,max(0,BOTTOM-y))
  if parts:
   first=parts.pop(0);_,hh=first.wrap(width,100000);first.drawOn(c,x,H-y-hh)
   if not parts:return y+hh
   p=parts[0]
  y=continuation()
def continuation():return page(TITLE,SUB,True)
def ensure(y,height):return continuation() if y+height>BOTTOM else y

def line(y,x=M,width=CW,color=RULE):
 c.setStrokeColor(color);c.setLineWidth(.6);c.line(x,H-y,x+width,H-y)
BANDS={'较低':('#174a7e','#e2edf9','#b9cfea'),'稍低':('#356789','#f0f7fb','#d2e5ef'),'平均':('#52606d','#f1f3f5','#dce1e5'),'稍高':('#97511e','#fff3e5','#f6d9b5'),'较高':('#9a4116','#fbe7d9','#edbea0')}
def badge(x,y,label):
 fg,bg,border=map(HexColor,BANDS.get(label,BANDS['平均']));c.setFillColor(bg);c.setStrokeColor(border);c.setLineWidth(.5);c.roundRect(x,H-y-17,37,17,8.5,fill=1,stroke=1);center(x+18.5,y+3.7,label,9,fg,True)

def page(title,sub='',continued=False):
 global PAGE,TITLE,SUB
 if not continued:TITLE,SUB=title,sub
 if PAGE:c.showPage()
 PAGE+=1
 text(M,27,'渡仁心理',15,NAVY,True);right(W-M,31,'职业与心理健康测评',8.5,MUTED)
 line(52)
 if title:
  text(M,72,title,21,INK,True)
  c.bookmarkPage('p'+str(PAGE));c.addOutlineEntry(title,'p'+str(PAGE),0,False)
 if sub:para(M,105,escape(sub),size=9.5,lead=14,color=MUTED)
 return 132 if sub else 111

def scorebar(x,y,w,v):
 c.setFillColor(PALE);c.rect(x,H-y-5,w,5,fill=1,stroke=0)
 pct=lambda n:max(0,min(100,n))/100
 if finite(v.get('lower')) and finite(v.get('upper')):
  c.setFillColor(HexColor('#C3D1DC'));c.rect(x+w*pct(v['lower']),H-y-7,w*max(0,pct(v['upper'])-pct(v['lower'])),9,fill=1,stroke=0)
 if finite(v.get('mean')):
  c.setStrokeColor(MUTED);c.setLineWidth(1);c.line(x+w*pct(v['mean']),H-y+4,x+w*pct(v['mean']),H-y-11)
 if finite(v.get('score')):
  c.setFillColor(NAVY);c.circle(x+w*pct(v['score']),H-y-2.5,3.2,fill=1,stroke=0)

def metric(v,x,y,width,sz=10.2,lead=15.4):
 y=ensure(y,82);start=y
 text(x,y,v['name'],13.5,INK,True);right(x+width,y,f"{nf(v['score'])}",16,NAVY,True)
 badge(x,y+22,v['label'])
 meta=f"参照中心 {nf(v['mean'])}  ·  参照区间 {nf(v['lower'])}-{nf(v['upper'])}"
 right(x+width,y+25,meta,8.1,MUTED)
 scorebar(x,y+45,width,v);y+=62
 if v.get('modelNote'):y=para(x,y,escape(v['modelNote']),width,9.2,13,MUTED)+5
 if v.get('definition'):y=para(x,y,escape(v['definition']),width,sz,lead)+5
 for name,key in [('较高','highMeaning'),('较低','lowMeaning')]:
  if v.get(key):y=para(x,y,'<b>'+name+'：</b>'+escape(v[key]),width,sz,lead)+4
 for key in ['unavailableReason','limitation','referenceNote']:
  if v.get(key):y=para(x,y,escape(v[key]),width,9.0,13.3,MUTED)+5
 if v.get('coverage'):
  y=para(x,y,f"已完成 {v['coverage']['answered']} / {v['coverage']['total']}",width,8.7,12.5,MUTED)+2
 LOG.append({'page':PAGE,'metric':v['code'],'x':x,'y':start,'bottom':y,'width':width})
 return y

def metric_height(v,width,sz,lead):
 h=62
 for key,size,leading,extra in [('modelNote',9.2,13,5),('definition',sz,lead,5),('highMeaning',sz,lead,4),('lowMeaning',sz,lead,4),('unavailableReason',9,13.3,5),('limitation',9,13.3,5),('referenceNote',9,13.3,5)]:
  if v.get(key):
   prefix='<b>较高：</b>' if key=='highMeaning' else '<b>较低：</b>' if key=='lowMeaning' else ''
   _,hh=paragraph(prefix+escape(str(v[key])),width,size,leading,INK).wrap(width,100000);h+=hh+extra
 if v.get('coverage'):h+=14.5
 return h

def pair_rows(rows,start,gap=25,sz=10.2,lead=15.4):
 y=start;col=(CW-gap)/2
 for i in range(0,len(rows),2):
  pair=rows[i:i+2];height=max(metric_height(v,col,sz,lead) for v in pair)
  if height > BOTTOM-(132 if SUB else 111):
   # Oversize future prose is losslessly continued at full width, never clipped.
   for v in pair:y=metric(v,M,y,CW,sz,lead)+18
  else:
   y=ensure(y,height)
   bottoms=[metric(v,M+j*(col+gap),y,col,sz,lead) for j,v in enumerate(pair)]
   y=max(bottoms)+18
 return y

def table(headers,rows,y,widths,fs=9.5,leading=14,padding=8):
 style=ParagraphStyle('table',fontName='CN',fontSize=fs,leading=leading,textColor=INK,wordWrap='CJK')
 head=ParagraphStyle('head',parent=style,fontName='CNBold',textColor=WHITE)
 data=[[Paragraph(escape(str(s)),head) for s in headers]]+[[Paragraph(escape(str(s)),style) for s in r] for r in rows]
 t=Table(data,colWidths=widths,hAlign='LEFT',repeatRows=1,splitByRow=1,splitInRow=1)
 t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),NAVY),('ROWBACKGROUNDS',(0,1),(-1,-1),[WHITE,PALE]),('GRID',(0,0),(-1,-1),.45,RULE),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),padding),('BOTTOMPADDING',(0,0),(-1,-1),padding)]))
 while True:
  _,hh=t.wrap(CW,100000)
  if y+hh<=BOTTOM:t.drawOn(c,M,H-y-hh);return y+hh
  parts=t.split(CW,max(0,BOTTOM-y))
  if parts:
   first=parts.pop(0);_,hh=first.wrap(CW,100000);first.drawOn(c,M,H-y-hh)
   if not parts:return y+hh
   t=parts[0]
  elif y <= (132 if SUB else 111):
   raise ValueError('Table content cannot fit a page')
  y=continuation()


def radar_row(title,items,y,height=265,radius=82):
 y=ensure(y,height)
 if len(items)<3:return para(M,y,escape(title+'：本记录缺少足够的分项，暂无法绘制轮廓。'))+18
 text(M,y,title,13,INK,True)
 cx=M+139;cy=y+height/2+4;r=radius;n=len(items)
 def pts(values,rad=r):return [(cx+math.sin(2*math.pi*i/n)*rad*max(0,min(100,v))/100,H-(cy-math.cos(2*math.pi*i/n)*rad*max(0,min(100,v))/100)) for i,v in enumerate(values)]
 def poly(points,col,width=1):
  p=c.beginPath();p.moveTo(*points[0]);[p.lineTo(*xy) for xy in points[1:]];p.close();c.setStrokeColor(col);c.setLineWidth(width);c.drawPath(p,stroke=1,fill=0)
 for level in [20,40,60,80,100]:
  poly(pts([level]*n),RULE,.5);text(cx+3,cy-r*level/100-4,str(level),6.5,MUTED)
 for i,v in enumerate(items):
  x2,y2=pts([100]*n)[i];c.setStrokeColor(RULE);c.line(cx,H-cy,x2,y2)
  angle=2*math.pi*i/n;tx=cx+math.sin(angle)*(r+31);ty=cy-math.cos(angle)*(r+23)
  name=v['name'];parts=[name[j:j+6] for j in range(0,len(name),6)]
  for j,part in enumerate(parts):center(tx,ty+(j-(len(parts)-1)/2)*11-4,part,8.8,MUTED)
 if all(finite(v.get('mean')) for v in items):
  c.setDash([3,2]);poly(pts([v['mean'] for v in items]),BLUE,1.1);c.setDash([])
 if all(finite(v.get('score')) for v in items):
  poly(pts([v['score'] for v in items]),NAVY,1.5);c.setFillColor(NAVY)
  for xy in pts([v['score'] for v in items]):c.circle(*xy,2.3,fill=1,stroke=0)
 tx=M+303;tw=CW-303;hy=y+35
 text(tx,hy,'指标',8.5,MUTED);right(tx+tw-45,hy,'得分',8.5,MUTED);right(tx+tw,hy,'中心',8.5,MUTED)
 line(hy+17,tx,tw)
 for j,v in enumerate(items):
  yy=hy+28+j*22;text(tx,yy,v['name'],8.5,INK);right(tx+tw-45,yy,nf(v.get('score')),9.3,NAVY,True);right(tx+tw,yy,nf(v.get('mean')),8.7,MUTED)
 return y+height

def group(prefix):return [v for v in R.get('dimensions',[]) if v.get('code','').startswith(prefix)]
def heading(label,y,note=None):
 y=ensure(y,60);text(M,y,label,13,INK,True);y+=25
 if note:y=para(M,y,escape(note),size=9.3,lead=14,color=MUTED)+10
 return y

def employment_rows():
 E=R.get('employmentAnswers') or {};t=E.get('tenure') or {};months=t.get('months')
 rows=[['过去5年雇主经历',E.get('employersText') or '未填写 / 原记录不可用']]
 if t.get('noExperience'):rows.append(['工作经历','没有正式工作经历'])
 if isinstance(months,list) and len(months)==3:
  for i,m in enumerate(months):
   value='未填写' if m is None else '无' if m=='无' else str(m)+'个月'+('（无该段经历）' if m==0 else '')
   if i==0:value+=' · '+(t.get('status') or '未填写')
   rows.append([['最近一段','上一段','再上一段'][i],value])
 elif not t.get('noExperience'):
  known=t.get('recordedMonths') or []
  rows.append(['在职月数','已记录：'+' / '.join(map(str,known))+'个月；原记录未保留各段对应关系。' if known else '未填写 / 原记录未保留'])
  rows.append(['最近一段状态',t.get('status') or ('未填写' if E.get('source')=='completion' else '原记录未保留')])
 return rows

FIELDS={
 'INFO014':[('婚姻状况','status'),('其他说明','other')],
 'INFO016':[('配偶/对象工作地','place')],
 'INFO017':[('目前是否两地分居','status')],
 'INFO018':[('目前是否已有子女（选填）','children'),('需要说明的照料或支持安排（选填）','arrangement')],
 'INFO019':[('孩子年龄（岁；多孩可分别填写）','age')],
 'INFO020':[('家里最小的孩子上学了吗','stage')],
 'INFO022':[('平常谁带孩子（主要照顾人）','carer'),('保姆/其他说明','other')],
 'INFO023':[('老人目前居住地（选填）','place'),('年龄（可填多位）','age'),('是否与您同住','living')]
}
def family_rows():
 rows=[]
 for q in R.get('family',[]):
  fields=[];answer=q.get('answer') or {};qid=q.get('id')
  for label,key in FIELDS.get(qid,[]):
   value=answer.get(key)
   if value is None or not str(value).strip():continue
   value=str(value)
   empty='不适用' if qid=='INFO018' and key=='children' else '不适用/其他' if qid=='INFO023' and key=='living' else '无'
   if value.strip()=='不适用' or empty!='无' and value.strip()=='无':value=empty
   fields.append([label,value])
  rows.extend(fields or [[re.sub(r'[_＿]+','',q.get('stem','家庭与支持信息')).strip().rstrip('：'),'未填 / 无']])
 return rows or [['家庭与支持信息','未填 / 无']]

# Four-domain report; stable score IDs and unchanged server projection values.
y=page('测评结果报告')
text(M,y+3,'职业与心理健康测评',14,INK,True);y+=33
text(M,y,f"作答完成 {R.get('answered','—')} / {R.get('total','—')}",10.5,MUTED)
right(W-M,y,str(S.get('createdAt','未记录'))[:10].replace('-','.'),10.5,MUTED);y+=22
owner=S.get('owner') or {}
if owner:
 label='测评账户：'+str(owner.get('name') or '')+(' · '+str(owner['email']) if owner.get('email') else '')
 y=para(M,y,escape(label),size=9.3,lead=14,color=MUTED)+14
else:y+=14
overview=[v for code in ['ST','PF','MH'] for v in R.get('totals',[]) if v['code']==code]
summary=R.get('reportSummary') or {}
interpretations={v['code']:v.get('interpretation','') for v in summary.get('cards',[])}
y=heading('本次主要结果',y)
for v in overview:
 interpretation=interpretations.get(v['code']) or '本项概述暂不可用，请结合分项及原始作答核对。'
 width=CW-28
 _,body_height=paragraph(escape(interpretation),width,10.6,16,INK).wrap(width,100000)
 height=61+body_height
 y=ensure(y,height)
 c.setFillColor(PALE);c.roundRect(M,H-y-height,CW,height,7,fill=1,stroke=0)
 text(M+14,y+12,v['name'],13,INK,True)
 right(W-M-65,y+9,nf(v.get('score')),21,NAVY,True)
 badge(W-M-51,y+13,v.get('label','无参照'))
 text(M+14,y+35,f"参照中心 {nf(v.get('mean'))}  ·  参照区间 {nf(v.get('lower'))}-{nf(v.get('upper'))}",9.2,MUTED)
 para(M+14,y+55,escape(interpretation),width,10.6,16)
 y+=height+13

y=heading('本次总体概述',y+1)
for paragraph_text in (summary.get('overview') or '本次综合概述暂不可用，请结合分项与作答质量核对。').split('\n\n'):
 y=para(M,y,escape(paragraph_text),width=CW-10.6,size=10.6,lead=17)+6
y+=7
# Only essential interpretation boundaries are repeated on the overview page.
for note in [R.get('rescoringNotice'),R.get('pfReinterpretationNotice')]:
 if note:y=para(M,y,escape(note),size=9.3,lead=14,color=MUTED)+6

y=page('职业稳定性','职业承诺、留任倾向与三项工作价值偏好。')
y=radar_row('职业稳定性 · 五项维度',group('ST')+group('WV_'),y,270,82)+8
y=pair_rows(group('ST'),y,25,10,14.7)
y=page('职业稳定性','工作价值观三项为独立得分，不相加为100。')
y=heading('工作价值观',y,R.get('workValueNotice') or R.get('workValueUnavailable'))
if R.get('workValueDerivationNotice'):y=para(M,y,escape(R['workValueDerivationNotice']),size=9.3,lead=14,color=MUTED)+8
y=pair_rows(group('WV_'),y,25,10.3,15.5)

y=page('职业性格','十项维度呈现工作方式与判断倾向，不直接代表能力或胜任程度。')
y=radar_row('职业性格 · 十项维度',group('PF')+group('SJ'),y,310,96)+8
y=pair_rows(group('PF')[:2],y,27,10.2,15)
y=page('职业性格','分项呈现工作方式偏好，应结合具体经历和实际任务理解。')
y=pair_rows(group('PF')[2:6],y,27,10.5,16)
y=page('职业性格','计划统筹与现场情境中的判断倾向。')
y=pair_rows(group('PF')[6:]+group('SJ'),y,27,10.5,16)

y=page('心理困扰倾向','反映主观困扰线索。高分表示更多困扰，不用于疾病诊断或岗位资格判断。')
y=radar_row('心理困扰倾向 · 六项维度',group('MH'),y,265,80)+8
y=pair_rows(group('MH')[:2],y,25,10.1,14.5)
y=page('心理困扰倾向','结合近期体验及支持需求理解，不作临床诊断。')
y=pair_rows(group('MH')[2:],y,25,10.4,15.4)

y=page('掩饰性与作答质量','先理解作答过程，再结合具体经历使用其他结果。')
rv=next((v for v in R.get('totals',[]) if v['code']=='RV'),None)
if rv:
 y=para(M,y,f"作答质量综合分：{nf(rv.get('score'))} / 100（{escape(rv.get('label','无参照'))}）。该综合分高不表示掩饰程度高。",size=9.3,lead=14,color=MUTED)+16
for v in group('RV'):
 y=ensure(y,metric_height(v,CW,10.3,16));y=metric(v,M,y,CW,10.3,16)+22
if R.get('timingNotice'):y=para(M,y,escape(R['timingNotice']),size=9.3,lead=14,color=MUTED)

y=page('信息记录与报告使用说明')
y=heading('工作经历',y)
y=table(['信息项目','原始作答'],employment_rows(),y,[180,CW-180],9.5,14)+25
y=heading('家庭与支持信息',y,'仅作信息记录，不计分')
y=table(['信息项目','原始作答'],family_rows(),y,[CW*.52,CW*.48],9.2,13,padding=5)+24
notes=R.get('interpretationNotes',[])
notes_height=25+sum(paragraph(escape(note),CW,9.3,14,MUTED).wrap(CW,100000)[1]+6 for note in notes)
if notes_height<=BOTTOM-111:y=ensure(y,notes_height)
y=heading('报告使用说明',y)
for note in notes:y=para(M,y,escape(note),size=9.3,lead=14,color=MUTED)+6
c.showPage();c.save();sys.stdout.buffer.write(OUT.getvalue())
