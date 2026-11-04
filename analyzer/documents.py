"""Local document candidate modeling. Never executes document content or calls remote services."""
from pathlib import Path
import sys,os,re,json,hashlib,zipfile
from html.parser import HTMLParser
from xml.etree import ElementTree as ET
FORMATS={'.md','.markdown','.txt','.html','.htm','.docx'}
SKIP={'.git','node_modules','.runtime','.venv','venv','dist','build','__pycache__'}
def emit(stage,message,progress):print(json.dumps(dict(stage=stage,message=message,progress=progress),ensure_ascii=False),flush=True)
class HTMLText(HTMLParser):
 def __init__(self):super().__init__();self.parts=[];self.hidden=0
 def handle_starttag(self,tag,attrs):
  if tag in ('script','style'):self.hidden+=1
  if not self.hidden and tag in ('td','th'):self.parts.append('| ')
  if not self.hidden and tag in ('p','div','br','tr','li','h1','h2','h3','h4'):self.parts.append('\n'+('#'*int(tag[1])+' ' if re.fullmatch('h[1-4]',tag) else ''))
 def handle_endtag(self,tag):
  if tag in ('script','style'):self.hidden=max(0,self.hidden-1)
  elif not self.hidden and tag=='tr':self.parts.append('|\n')
  elif not self.hidden and tag in ('p','div','li','h1','h2','h3','h4'):self.parts.append('\n')
 def handle_data(self,data):
  if not self.hidden:self.parts.append(data)
def extract(p):
 if p.suffix.lower()=='.docx':
  with zipfile.ZipFile(p) as z:
   info=z.getinfo('word/document.xml')
   if info.file_size>12_000_000:raise ValueError('DOCX 解压文本超过12MB')
   root=ET.fromstring(z.read(info))
   ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
   blocks=[]
   for block in root.find('w:body',ns):
    if block.tag.endswith('}p'):
     style=block.find('w:pPr/w:pStyle',ns);value=style.get('{'+ns['w']+'}val','') if style is not None else ''
     heading=re.search(r'(?:Heading|标题)([1-6])',value,re.I)
     blocks.append(('#'*int(heading[1])+' ' if heading else '')+''.join(t.text or '' for t in block.findall('.//w:t',ns)))
    elif block.tag.endswith('}tbl'):
     for row in block.findall('w:tr',ns):blocks.append('| '+' | '.join(''.join(t.text or '' for t in cell.findall('.//w:t',ns)) for cell in row.findall('w:tc',ns))+' |')
     blocks.append('')
   return '\n'.join(blocks)
 text=p.read_text(encoding='utf-8-sig')
 if p.suffix.lower() in ('.html','.htm'):
  parser=HTMLText();parser.feed(text);return ''.join(parser.parts)
 return text
RULES=[('M1',r'业务对象|对象模型|对象及约束|^对象$|^实体$'),('M2',r'行为模型|^行为|业务功能清单|功能详述'),('M3',r'规则模型|^规则$|业务规则'),('M5',r'主体.*角色|角色.*权限|^角色$|岗位角色'),('M6',r'流程模型|协同流|审批流|^流程$|端到端.*流程'),('M7',r'查询报表|查询统计|^REP$|^报表$'),('MU',r'界面模型|^界面$|^页面$|^屏幕$|MU 界面')]
def category(s):
 explicit=re.search(r'\b(M[123567]|MU)\b',s)
 if explicit:return explicit[1]
 return next((m for m,p in RULES if re.search(p,s)),None)
IDENTIFIER=r'\b(?:(?:BR|NR)-[A-Z]+-\d+|F-\d+-\d+|(?:FUNC|PROC(?:-APP)?|ROLE|REP|Q|R|B(?:-APP)?)-\d+)\b'
def clean(s):return re.sub(r'[`*_]','',s).strip()
def main():
 source=Path(sys.argv[1]).resolve();run=Path(sys.argv[2]).resolve();name=sys.argv[3];out=run/'artifacts';snap=run/'source';out.mkdir(parents=True,exist_ok=True);snap.mkdir(parents=True,exist_ok=True)
 emit('扫描知识目录','只读扫描文档，排除隐藏目录、依赖与符号链接',12)
 docs=[];skipped=[];total=0;unsupported={};filecount=0
 def walk_error(e):skipped.append(dict(path=str(e.filename),reason='UNREADABLE',message=str(e)))
 for folder,dirs,files in os.walk(source,followlinks=False,onerror=walk_error):
  dirs[:]=sorted(d for d in dirs if d not in SKIP and not d.startswith('.') and not (Path(folder)/d).is_symlink())
  for f in sorted(files):
   p=Path(folder)/f;rel=p.relative_to(source).as_posix()
   if p.is_symlink() or f.startswith('.'):continue
   ext=p.suffix.lower()
   if ext not in FORMATS:
    if ext in ('.pdf','.doc','.xlsx','.pptx','.png','.jpg'):unsupported[ext]=unsupported.get(ext,0)+1
    continue
   filecount+=1
   if filecount>500:raise ValueError('文档目录最多支持500个候选文件，请缩小范围')
   try:
    size=p.stat().st_size
    if size>2_000_000:raise ValueError('单文件超过2MB')
    total+=size
    if total>20_000_000:raise RuntimeError('文档输入超过20MB，请缩小目录')
    text=extract(p)
    if not text.strip():raise ValueError('没有可读取文本')
    if len(text.encode())>2_000_000:raise ValueError('提取文本超过2MB')
    docs.append((rel,text,hashlib.sha256(p.read_bytes()).hexdigest()))
   except RuntimeError:raise
   except Exception as e:skipped.append(dict(path=rel,reason='DOCUMENT_UNREADABLE',message=str(e)))
 if not docs:raise ValueError('目录中没有可读取的文档。支持 UTF-8 Markdown / TXT / HTML / DOCX；PDF、扫描件和旧版 DOC 暂不支持。'+json.dumps(skipped[:3],ensure_ascii=False))
 emit('建立文档快照',f'已读取 {len(docs)} 份文档，正在识别显式业务定义',32)
 nodes=[];edges=[];contexts={};bykey={};mapping={};inventory=[]
 def add(model,label,ctx,ev,description='',cells=None):
  label=clean(label);label=re.sub(r'^(?:[A-Z]\.)?\d+(?:\.\d+)*\.?\s+','',label);label=label.strip(' ：:')
  if not label or len(label)>100 or re.search(r'[~～]|待确认|对象关系|覆盖索引',label):return None
  external=re.search(IDENTIFIER,label)
  if model=='M1':label=re.sub(r'[（(].*?[）)]','',label).strip()
  key=(model,external[0] if external else label)
  if key in bykey:
   n=bykey[key]
   if ev not in n['evidence']:n['evidence'].append(ev)
   if cells:n['sourceDefinition']=cells;n['description']=description[:2400]
   return n
  id=model+'-DOC-'+hashlib.sha256((model+(external[0] if external else label)).encode()).hexdigest()[:14]
  external=re.search(IDENTIFIER,label)
  n=dict(id=id,label=label,name=label,model=model,context=ctx,description=description[:2400],evidence=[ev],confidence='DOCUMENT_EXPLICIT_CANDIDATE',reviewRequired=True,status='DOCUMENT',sourceDefinition=cells or {})
  if external:n['documentId']=external[0]
  if model=='M1':n.update(alias=id,aggregateType='CANDIDATE',attributes=[],entities=[],valueObjects=[],invariants=[],lifecycle=[],boundaryStatus='REVIEW_REQUIRED')
  if model=='M2':n.update(behaviorType='QUERY' if (cells or {}).get('类型')=='QUERY' or re.search(r'^Q-\d|查询|统计|报表',label) else 'COMMAND',triggerType='SYSTEM' if (cells or {}).get('类型')=='AUTOMATIC' else 'USER_ACTION',triggerStatus='DOCUMENT_CANDIDATE',ownerEntity=None,preconditions=[],postconditions=[],appliedRules=[],requiredPermissions=[],syncTriggers=[])
  if model=='M3':n.update(ruleType='VALIDATION',ruleBoundary='LOCAL_OR_REUSABLE_REVIEW_REQUIRED',expression=None,formalizationStatus='DOCUMENT_NOT_EXECUTABLE',inputParams=[],outputType='待确认')
  if model=='M5':n.update(roleId=id,permissions=[],enforcement='DOCUMENT_DECLARED_NOT_IMPLEMENTED')
  if model=='M6':n.update(flowType='COLLABORATION',modelingLevel='DOCUMENT_DRAFT',activities=[],roleRefs=[],businessObjectRefs=[],formalizationStatus='DOCUMENT_NARRATIVE_ONLY',startActivity=None,endActivities=[])
  if model=='M7':n.update(objectType='DETAIL_QUERY',sourceObjects=[],joins=[],parameters=[],resultColumns=[],formalizationStatus='DOCUMENT_CONTRACT_DRAFT')
  if model=='MU':n.update(screenId=id,screenType='DOCUMENT_DRAFT',actions=[],elements=[],layout='',presentation='DOCUMENT_DECLARED_NOT_IMPLEMENTED')
  nodes.append(n);bykey[key]=n;edges.append(dict(source=ctx,target=id,label='文档定义候选',status='DOCUMENT',evidence=[ev]));return n
 for rel,text,rawhash in docs:
  target=snap/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text);mapping[rel]=rel
  sha=hashlib.sha256(text.encode()).hexdigest();inventory.append(dict(path=rel,sha256=sha,originalSha256=rawhash,bytes=len(text.encode())))
  ctx='DOC-'+hashlib.sha256(rel.encode()).hexdigest()[:12];contexts[ctx]=Path(rel).stem
  nodes.append(dict(id=ctx,label=Path(rel).stem,model='CTX',context=ctx,status='DOCUMENT',description='知识文档；不等于已确认的业务域',evidence=[dict(path=rel,line=1,sha256=sha)]))
  lines=text.splitlines();current=None;sections={};headers=[];fence=False;object_node=None
  for i,line in enumerate(lines):
   ev=dict(path=rel,line=i+1,sha256=sha,excerpt=line[:1500],sourceType='document',lineBasis='EXTRACTED_TEXT' if Path(rel).suffix.lower() in ('.docx','.html','.htm') else 'ORIGINAL_TEXT')
   if re.match(r'^\s*(```|~~~)',line):fence=not fence;continue
   if fence:continue
   h=re.match(r'^\s*(#{1,6})\s+(.+)',line)
   if h:
    title=clean(h[2]);kind=category(title);headers=[]
    level=len(h[1]);sections={k:v for k,v in sections.items() if k<level}
    current=kind or next((sections[k] for k in sorted(sections,reverse=True) if sections[k]),None);sections[level]=current;object_node=None
    if level==1:continue
    journey=bool(re.search(r'(?:\bJ\d+\s+.+旅程|^[\d. ]+.+(?:业务流程|审批流程|处理流程))',title))
    # Explicit element headings or child headings in an object section.
    explicit=re.search(IDENTIFIER,title)
    mt=('M6' if title.find('PROC-')>=0 else 'M5' if title.find('ROLE-')>=0 else 'M7' if title.find('REP-')>=0 else 'M3' if re.search(r'\b(?:R-\d|(?:BR|NR)-[A-Z]+-\d)',title) else 'M2') if explicit else current
    section=[]
    for following in lines[i+1:]:
     next_heading=re.match(r'^\s*(#{1,6})\s',following)
     if next_heading and (not journey or len(next_heading[1])<=level):break
     section.append(following)
     if len(section)>=100:break
    if journey:mt='M6'
    if explicit or journey or (not kind and any(re.match(r'^\s*\|\s*列\s*\|',v) for v in section)) or (current=='M1' and not kind and any(re.match(r'^\s*\|\s*(属性|字段)\s*\|',v) for v in section)) or (re.search(r'\S+(?:界面|页面|屏幕)(?:[（(]|$)',title) and not re.search(r'确认|规范|映射|索引|模型|\bMU\b',title)):
     if not explicit and re.search(r'界面|页面|屏幕',title):mt='MU'
     if not explicit and not journey and any(re.match(r'^\s*\|\s*列\s*\|',v) for v in section):mt='M1'
     object_node=add(mt,title,ctx,ev,'\n'.join(section)[:2400])
    continue
   # Plain-text explicit declarations are also accepted.
   declaration=re.match(r'^\s*(业务对象|对象|行为|业务规则|规则|角色|流程|查询报表|报表|页面|界面)\s*[:：]\s*(.{1,90})$',line)
   if declaration:add(category(declaration[1]) or {'业务规则':'M3','业务对象':'M1'}.get(declaration[1]),declaration[2],ctx,ev,line)
   if line.strip().startswith('|'):
    cells=[clean(c) for c in line.strip().strip('|').split('|')]
    if all(re.fullmatch(r':?-+:?',c) for c in cells):continue
    if not headers:headers=cells;continue
    if len(cells)!=len(headers):continue
    kind=category(headers[0]) or current
    row=dict(zip(headers,cells));description='；'.join(a+'：'+b for a,b in row.items())
    if '聚合根' in row:
     for alias in re.split(r'\s*/\s*|、',row['聚合根']):
      if re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{1,70}',alias):
       obj=add('M1',alias,ctx,ev,description,row)
       if obj:obj['alias']=alias;obj['declaredContext']=row.get('上下文');obj['declaredService']=row.get('服务')
    if '编号' in row and '功能' in row and re.fullmatch(r'F-\d+-\d+',row['编号']):add('M2',row['编号']+' '+row['功能'],ctx,ev,description,row)
    endpoint=re.fullmatch(r'(GET|POST|PUT|DELETE|PATCH)\s+(/\S+)',row.get('方法路径',''))
    if endpoint:
     b=add('M2',endpoint[0],ctx,ev,description,row)
     if b:
      b['endpoint']=dict(method=endpoint[1],path=endpoint[2]);b['behaviorType']='QUERY' if endpoint[1]=='GET' else 'COMMAND';b['implementationStatus']='DOCUMENT_DECLARED_NOT_VERIFIED'
      if endpoint[1]=='GET':
       q=add('M7',endpoint[0]+' · 查询契约',ctx,ev,description,row)
       if q:q['documentBehaviorRef']=b['id']
    if object_node and object_node['model']=='M1' and headers[0] in ('属性','字段','列'):
     row=dict(zip(headers,cells));object_node['attributes'].append(dict(name=cells[0],label=cells[0],type=row.get('类型','待确认'),required=row.get('必填')=='是',description=row.get('说明/约束',''),evidence=[ev]))
    if kind and headers[0] in ('对象','实体','行为','功能','规则','角色','流程','REP','报表','页面','界面','屏幕'):
     add(kind,cells[0],ctx,ev,'；'.join(a+'：'+b for a,b in zip(headers,cells)),dict(zip(headers,cells)))
   elif line.strip():headers=[]
   if len(nodes)>1500:raise ValueError('候选模型超过1500个，请缩小知识目录')
 models_only=[n for n in nodes if n['model']!='CTX']
 if not models_only:raise ValueError('文档已读取，但未发现明确的业务模型定义。请采用技能 V9 的对象/行为/规则/角色/流程/查询表格，或“业务对象：合同”等明确标题。当前为本地规则提取原型，不具备任意自然语言推理能力。')
 emit('生成七模型',f'提取到 {len(models_only)} 个待评审候选，建立有依据的关联',65)
 external={n['documentId']:n for n in models_only if n.get('documentId')}
 objects=[n for n in models_only if n['model']=='M1']
 for n in models_only:
  if n['model']=='M2':
   owner=n['sourceDefinition'].get('主对象');o=next((o for o in objects if o['label']==owner),None)
   if o:n['ownerEntity']=o['id'];edges.append(dict(source=o['id'],target=n['id'],label='文档声明主对象',status='DOCUMENT',evidence=n['evidence']))
  for ref in set(re.findall(IDENTIFIER,n['description'])):
   other=external.get(ref)
   if other and other['id']!=n['id'] and (n['model']!='M7' or other['model'] in ('M1','M2')):edges.append(dict(source=n['id'],target=other['id'],label='文档引用（非执行关系）',status='DOCUMENT',evidence=n['evidence']))
 # Query contracts must always bind to exactly one query behavior. A synthesized binding is explicit metadata, not claimed implementation.
 for q in [n for n in models_only if n['model']=='M7']:
  ref=q['sourceDefinition'].get('唯一 Q','');b=next((n for n in nodes if n['id']==q.get('documentBehaviorRef')),None) or external.get(ref)
  if not b or b['model']!='M2' or b.get('queryReportRef'):
   b=add('M2',q['label'][:80]+' · 查询行为',q['context'],q['evidence'][0],'由查询报表定义派生的建模绑定；待确认，非已实现接口');b['derivedFrom']=q['id'];b['confidence']='DERIVED_REVIEW_REQUIRED'
  b['behaviorType']='QUERY';b['queryReportRef']=q['id'];q['behaviorRef']=b['id'];edges.append(dict(source=b['id'],target=q['id'],label='查询建模绑定（待确认）',status='DOCUMENT',evidence=q['evidence']))
 lists={m:[n for n in nodes if n['model']==m] for m in ['M1','M2','M3','M5','M6','M7','MU']}
 def model(t,**kw):return dict(model_type=t,version='1.0',domain=name,modelingMode='DOCUMENT_DRAFT',**kw)
 models={'m1-object-model.yaml':model('OBJECT',aggregates=lists['M1'],entities=[],valueObjectCatalog=[],dictionaries=[],associations=[]),'m2-behavior-model.yaml':model('BEHAVIOR',behaviors=lists['M2']),'m3-rule-model.yaml':model('RULE',rules=lists['M3']),'m5-actor-model.yaml':model('ACTOR',actors=[],roles=lists['M5'],permissions=[]),'m6-flow-model.yaml':model('FLOW',flows=lists['M6']),'m7-report-model.yaml':model('REPORT',query_reports=lists['M7']),'mu-ui-model.yaml':model('UI',application=dict(name=name,menus=[]),screens=lists['MU'])}
 ids={n['id'] for n in nodes};checks=[dict(check='Document graph references',passed=all(e['source'] in ids and e['target'] in ids for e in edges),count=len(edges)),dict(check='Document evidence anchors',passed=all(n['evidence'] for n in nodes),count=len(nodes)),dict(check='Document M7 ↔ M2 binding',passed=all(sum(b.get('queryReportRef')==q['id'] and b['id']==q['behaviorRef'] for b in lists['M2'])==1 for q in lists['M7']),count=len(lists['M7']))]
 limits=['基于 ontology-driven-dev V9 的文档候选提取，不等同于完整执行技能需求探索与人工确认。','仅识别明确标题与表格，不调用外部大模型；任意自然语言、图片和复杂表格可能无法识别。','文档中的已确认标记不自动转成平台人工确认。所有元素须重新评审。','M6 保留流程原文，不补造活动、分支和审批图；M7 保留查询原文，不补造字段血缘；M5 不代表已执行权限。','七模型文件齐备不表示每种模型都有内容；缺失类型不补造。','DOCX/HTML 证据行号对应提取文本；Markdown/TXT 对应原文行号。','PDF、扫描件、旧版 DOC、表格和演示文稿暂不支持。']
 manifest=dict(model_type='MANIFEST',version='1.0',domain=name,framework='ontology_modeling_framework_v9.md',model_files=list(models),adapter='document-directory',scope='DOCUMENT_MODELING_DRAFT',complete=False,source_root=str(source),source_status='只读文档快照；待领域评审',source_commit='not-applicable',source_fingerprint=hashlib.sha256(json.dumps(inventory,sort_keys=True).encode()).hexdigest(),analysis_files=len(docs),limitations=limits,validation=checks,documentInventory=dict(files=inventory,skipped=skipped,unsupported=unsupported),scanInventory=dict(version=1,languages={},modules=[],skipped=skipped,scope='文档目录候选提取，非源码扫描'))
 counts=dict(services=len(contexts),objects=len(lists['M1']),behaviors=len(lists['M2']),rules=len(lists['M3']),queries=len(lists['M7']),flows=len(lists['M6']),lifecycleFlows=0,screens=len(lists['MU']))
 data=dict(nodes=nodes,edges=edges,contexts=contexts,manifest=manifest,counts=counts,models=models,coverage=[],extractionIssues=[])
 for file,obj in [('ontology-data.json',data),('source-map.json',mapping),('source-manifest.json',inventory),('validation.json',checks)]: (out/file).write_text(json.dumps(obj,ensure_ascii=False,indent=2))
 (out/'yaml').mkdir(exist_ok=True)
 for file,obj in {**models,'manifest.json':manifest}.items():(out/'yaml'/file).write_text(json.dumps(obj,ensure_ascii=False,indent=2))
 emit('完成',f'已生成 {len(nodes)} 个节点与 {len(edges)} 条关系，全部为待评审草稿',100)
 print(json.dumps(dict(result=str(out/'ontology-data.json'),adapter='document-directory')),flush=True)
if __name__=='__main__':
 try:main()
 except Exception as e:print(json.dumps(dict(error=str(e)),ensure_ascii=False),flush=True);sys.exit(1)
