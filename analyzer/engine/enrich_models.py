"""Expand reverse models using controller→application traces, DTO contracts and Java control flow.
All derived flow expressions remain source-level predicates; no executable BPMN claim.
"""
import re,json,os
from java_introspection import JavaIndex,masked,close,split_args,fields

def typ(t):
 return {'int':'Integer','long':'Integer','Integer':'Integer','Long':'Integer','boolean':'Boolean','Boolean':'Boolean','BigDecimal':'Decimal','LocalDate':'Date','LocalDateTime':'DateTime','YearMonth':'String','String':'String','UUID':'String'}.get(t,'Object')

class SourceFlow:
 def __init__(self,m,evidence):self.m=m;self.s=m['body'];self.mask=masked(self.s);self.ev=evidence
 def block(self,start=0,end=None):
  end=len(self.s) if end is None else end;arr=[];i=start
  while i<end:
   while i<end and self.mask[i].isspace():i+=1
   if i>=end:break
   n,i=self.statement(i,end);arr.append(n)
  return arr
 def statement(self,i,end):
  start=i
  if self.mask[i]=='{':
   e=close(self.mask,i,'{','}');return dict(kind='block',children=self.block(i+1,e),start=i,end=e+1),e+1
  m=re.match(r'(if|for|while|synchronized)\b',self.mask[i:])
  if m:
   kind=m[1];p=self.mask.index('(',i);pe=close(self.mask,p);j=pe+1
   while j<end and self.mask[j].isspace():j+=1
   child,k=self.statement(j,end);n=dict(kind=kind,condition=self.s[p+1:pe].strip(),yes=child,start=start,end=k)
   z=k
   while z<end and self.mask[z].isspace():z+=1
   if kind=='if' and re.match(r'else\b',self.mask[z:]):
    z+=4
    while z<end and self.mask[z].isspace():z+=1
    no,k=self.statement(z,end);n['no']=no;n['end']=k
   return n,k
  if re.match(r'try\b',self.mask[i:]):
   j=i+3
   while j<end and self.mask[j].isspace():j+=1
   if self.mask[j]=='(':j=close(self.mask,j)+1
   while j<end and self.mask[j].isspace():j+=1
   child,k=self.statement(j,end);catches=[];final=None
   while k<end:
    z=k
    while z<end and self.mask[z].isspace():z+=1
    if re.match(r'catch\b',self.mask[z:]):
     p=self.mask.index('(',z);pe=close(self.mask,p);st=pe+1
     while st<end and self.mask[st].isspace():st+=1
     ch,k=self.statement(st,end);catches.append((self.s[p+1:pe].strip(),ch))
    elif re.match(r'finally\b',self.mask[z:]):
     st=z+7
     while st<end and self.mask[st].isspace():st+=1
     final,k=self.statement(st,end)
    else:break
   return dict(kind='try',yes=child,catches=catches,final=final,start=start,end=k),k
  # opaque statement: balance lambda/initializer/switch bodies until the outer semicolon
  j=i;dp=db=dc=0
  while j<end:
   ch=self.mask[j]
   if ch=='(':dp+=1
   elif ch==')':dp-=1
   elif ch=='[':db+=1
   elif ch==']':db-=1
   elif ch=='{':dc+=1
   elif ch=='}':
    if dc==0:break
    dc-=1
   if ch==';' and dp==db==dc==0:j+=1;break
   j+=1
  if j==i:j+=1
  return dict(kind='statement',start=start,end=j,text=self.s[start:j].strip()),j
 def build(self):
  acts=[];i=0
  def add(name,t='SYSTEM_TASK',n=None,**kw):
   nonlocal i;i+=1;id='A'+str(i);d=dict(activityId=id,name=name,activityType=t,nextActivities=[],**kw)
   if n:d['evidence']=[self.ev(self.m['cls']['path'],self.m['cls']['text'][:self.m['bodyStart']+1+n['start']].count('\n')+1,self.s[n['start']:n['end']])]
   acts.append(d);return d
  ok=add('返回结果 / 正常结束','END',outcome='SUCCESS');err=add('异常退出（事务效果以源码边界为准）','END',outcome='ERROR')
  def compile(n,nxt,handlers=None,loop=None):
   kind=n['kind']
   if kind=='block':
    for child in reversed(n['children']):nxt=compile(child,nxt,handlers,loop)
    return nxt
   if kind in ['if','for','while']:
    gate=add(('条件判断' if kind=='if' else '迭代判断')+'：'+n['condition'][:90],'GATEWAY',n,conditionExpression=n['condition'],expressionLanguage='JAVA_SOURCE',branches=[])
    yes=compile(n['yes'],nxt if kind=='if' else gate['activityId'],handlers,loop if kind=='if' else (nxt,gate['activityId']))
    no=compile(n['no'],nxt,handlers,loop) if 'no'in n else nxt
    gate['branches']=[dict(branchName='条件成立' if kind=='if' else '存在下一次迭代',conditionExpression=n['condition'],targetActivity=yes),dict(branchName='条件不成立 / 迭代结束',isDefault=True,targetActivity=no)]
    return gate['activityId']
   if kind=='synchronized':return compile(n['yes'],nxt,handlers,loop)
   if kind=='try':
    if n['final']:nxt=compile(n['final'],nxt,handlers,loop)
    hs=[dict(exceptionType=c,targetActivity=compile(ch,nxt,handlers,loop)) for c,ch in n['catches']]
    entry=compile(n['yes'],nxt,hs or handlers,loop);d=add('进入异常捕获范围',n=n,exceptionHandlers=hs);d['nextActivities']=[entry];return d['activityId']
   txt=n['text'];calls=re.findall(r'\b(\w+)\.(\w+)\(',masked(txt));meaning=[f'{x}.{y}' for x,y in calls if not x[:1].isupper() and y not in ['toString','now','trim','name','getMessage']]
   label=('返回：' if txt.startswith('return ') else '拒绝：' if txt.startswith('throw ') else '执行：')+(' → '.join(meaning[:3]) or re.sub(r'\s+',' ',txt)[:90])
   d=add(label,n=n,sourceCode=txt,exceptionHandlers=handlers or [])
   if txt in ['continue;','break;'] and loop:d['nextActivities']=[loop[1] if txt=='continue;' else loop[0]]
   elif txt.startswith('return '):d['nextActivities']=[ok['activityId']]
   elif txt.startswith('throw '):
    ex=re.search(r'throw new (\w+)',txt);target=next((h['targetActivity']for h in handlers or [] if ex and (ex[1] in h['exceptionType'] or h['exceptionType'].startswith(('Exception ','RuntimeException ','Throwable ')))),err['activityId']);d['nextActivities']=[target];d['outcome']='THROW'
   else:d['nextActivities']=[nxt]
   return d['activityId']
  root=dict(kind='block',children=self.block(),start=0,end=len(self.s));entry=compile(root,ok['activityId']);start=add('开始','START');start['nextActivities']=[entry];start['exceptionHandlers']=[dict(exceptionType='未捕获的调用或校验异常（流程边界）',targetActivity=err['activityId'])]
  # source order for display; topology uses explicit references
  acts.sort(key=lambda a: (0 if a['activityType']=='START' else 2 if a['activityType']=='END' else 1, a.get('evidence',[{}])[0].get('line',99999)))
  # remove unreachable END (e.g. no explicit throw) while keeping a documented implicit exception boundary
  active={a['activityId']:a for a in acts};seen=set()
  def visit(x):
   if x in seen:return
   seen.add(x);a=active[x]
   for y in a.get('nextActivities',[]):visit(y)
   for b in a.get('branches',[]):visit(b['targetActivity'])
   for h in a.get('exceptionHandlers',[]):visit(h['targetActivity'])
  visit(start['activityId']);acts=[a for a in acts if a['activityId']in seen]
  return dict(startActivity=start['activityId'],endActivities=[a['activityId'] for a in acts if a['activityType']=='END'],activities=acts,unmodeledImplicitExceptionExit=err['activityId']not in seen)

def enrich(ROOT,objs,vals,beh,rules,flows,screens,nodes,edges,node,edge,evidence,CN):
 j=JavaIndex(ROOT); byid={o['id']:o for o in objs}; roots={o['id']:o for o in objs if o['aggregateType']=='AGGREGATE_ROOT'}; byalias={(o['context'],o['alias']):o for o in objs}; nodeby={n['id']:n for n in nodes};methodmap={};implmap={};traces={};issues=[]
 def sync(b):nodeby[b['id']].update({k:v for k,v in b.items() if k not in ['id','name']})
 for o in objs:
  for ent in o.get('entities',[]):
   child=byalias.get((o['context'],ent['alias']))
   if child:ent['attributes']=child['attributes']
 # Fill record value object fields missed by previous persistence-only extractor.
 for v in vals:
  cl=j.classes.get(v['evidence'][0]['path'])
  if cl:v['attributes']=[dict(name=f['name'],label=f['name'],type=typ(f['javaType']),javaType=f['javaType'],sourceLine=f['line']) for f in cl['fields']]
 for b in beh:
  cl=j.classes[b['evidence'][0]['path']];cm=j.findmethod(cl,b['id'].rsplit('_',1)[-1]);methodmap[b['id']]=cm
  if b['context']=='iam' and b['id'].endswith('AuthController_verify'):
   b['behaviorType']='QUERY';b['m7Applicability']='TECHNICAL_TOKEN_VERIFICATION'
  if not cm:issues.append(dict(id=b['id'],issue='NO_CONTROLLER_METHOD'));continue
  app=next((c['method'] for c in j.calls(cm) if '/application/'in c['target']['key'] and c['method']),None);implmap[b['id']]=app
  tr=j.trace(app,4) if app else [];traces[b['id']]=tr
  b['implementation']=[dict(className=m['cls']['name'],method=m['name'],evidence=[evidence(m['cls']['path'],m['line'])]) for m in tr]
  if app:
   candidates=[o for o in roots.values() if o['context']==b['context']]
   direct=[o for o in candidates if re.search(r'\b'+o['alias']+r'\b',app['returnType'])]
   if len(direct)==1:
    previous=b['ownerEntity'];b['ownerEntity']=direct[0]['id'];b['ownershipStatus']='APPLICATION_RETURN_TYPE'
    if previous!=b['ownerEntity']:
     edges[:]=[e for e in edges if not(e['target']==b['id'] and e['label']=='提供行为')];edge(b['ownerEntity'],b['id'],'提供行为')
  errors=[]
  for m in tr:
   for mt in re.finditer(r'throw new (\w+)\s*\(\s*"([^"\n]+)"',m['body']):errors.append(dict(exceptionType=mt[1],code=mt[2],evidence=[evidence(m['cls']['path'],m['cls']['text'][:m['bodyStart']+1+mt.start()].count('\n')+1)]))
  b['exceptionPaths']=errors
  for r in rules:
   if r['context']==b['context'] and any(m['cls']['name']==r['name'] for m in tr):
    if r['id'] not in b['appliedRules']:b['appliedRules'].append(r['id'])
    if b['id'] not in r['reusedBy']:r['reusedBy'].append(b['id'])
    edge(b['id'],r['id'],'调用领域策略')
  sync(b)
 # Remove old skeletal M7; rebuild full query contracts.
 oldq={n['id'] for n in nodes if n['model']=='M7'};nodes[:]=[n for n in nodes if n['model']!='M7'];edges[:]=[e for e in edges if e['source']not in oldq and e['target']not in oldq]
 # node() in original exporter closes over seen; remove ids from the original set through helper caller below.
 usedids={n['id'] for n in nodes}
 def append_node(id,label,model,c,**attrs):
  n=dict(id=id,label=label,model=model,context=c,**attrs);nodes.append(n);usedids.add(id);return n
 def append_edge(a,b,label,status='CODE',**kw):
  if a in usedids and b in usedids and a!=b and not any(e['source']==a and e['target']==b and e['label']==label for e in edges):edges.append(dict(source=a,target=b,label=label,status=status,**kw))
 def sources(b,tr):
  found={};c=b['context']
  for m in tr:
   text=m['body']+' '+m['returnType'];called={x['receiver'] for x in j.calls(m)}
   for f in m['cls']['fields']:
    if f['name']in called:text+=' '+f['javaType']
   for o in roots.values():
    if o['context']==c and (re.search(r'\b'+o['alias']+r'\b',text) or o['alias']+'Repository'in text):found[o['id']]=o
  if c=='bff':
   for pair in [('account','Account'),('card','Card'),('customer','Customer'),('transaction','TransactionRecord')]:
    if pair in byalias:found[byalias[pair]['id']]=byalias[pair]
  if c=='search':
   for pair in [('customer','Customer'),('transaction','TransactionRecord')]:
    if pair in byalias:found[byalias[pair]['id']]=byalias[pair]
  if not found and b['ownerEntity']in roots:found[b['ownerEntity']]=roots[b['ownerEntity']]
  return list(found.values())
 def schema(t,c,prefix='',depth=0,stack=(),bindings=None):
  bindings=bindings or {};t=t.strip();base=t.split('<')[0];inner=t[len(base)+1:-1] if '<'in t else ''
  if t in bindings:t=bindings[t];base=t.split('<')[0];inner=t[len(base)+1:-1] if '<'in t else ''
  if base in ['ResponseEntity','Optional']:return schema(inner,c,prefix,depth,stack,bindings)
  if base in ['List','Collection','Set']:return schema(inner,c,prefix+'[]',depth,stack,bindings)
  if base=='Map':
   parts=split_args(inner);return schema(parts[-1],c,prefix+'{key}',depth+1,stack,bindings) if len(parts)>1 else [dict(name=prefix or 'value',javaType=t,dataType='Object')]
  cl=j.resolve(c,base)
  if depth>4 or not cl or base in stack or not cl['fields']:return [dict(name=prefix or 'value',javaType=t,dataType=typ(t),evidence=[])]
  # generic record binding, e.g. PageResponse<T>
  generic=re.search(r'\brecord\s+'+re.escape(base)+r'<([^>]+)>',cl['text'])
  if generic:bindings={**bindings,**dict(zip(split_args(generic[1]),split_args(inner)))}
  result=[]
  for f in cl['fields']:
   cols=schema(f['javaType'],c,(prefix+'.' if prefix else '')+f['name'],depth+1,stack+(base,),bindings)
   for col in cols:
    if not col.get('evidence'):
     col['evidence']=[evidence(cl['path'],f['line'])];col['declaringType']=cl['name'];col['dtoField']=f['name']
   result+=cols
  return result
 def parameters(cm):
  arr=[]
  for part in split_args(cm['params']):
   clean=re.sub(r'@\w+(?:\([^)]*\))?','',part).strip();mt=re.search(r'([\w<>,. ?\[\]]+)\s+(\w+)$',clean)
   if not mt:continue
   jt,name=mt[1].strip(),mt[2];binding='PATH' if '@PathVariable'in part else 'QUERY' if '@RequestParam'in part else 'BODY';default=re.search(r'defaultValue\s*=\s*"([^"]*)"',part)
   arr.append(dict(name=name,label=name,dataType=typ(jt),javaType=jt,required=not bool(re.search(r'required\s*=\s*false',part)) and not default,binding=binding,allowedOperators=['EQ'],**({'defaultValue':default[1]}if default else{}),evidence=[evidence(cm['cls']['path'],cm['line'])]))
  return arr
 queries=[]
 for b in beh:
  b.pop('queryReportRef',None);cm=methodmap.get(b['id']);app=implmap.get(b['id']);tr=traces.get(b['id'],[])
  if not cm or b['behaviorType']!='QUERY' or b.get('m7Applicability')=='TECHNICAL_TOKEN_VERIFICATION':continue
  src=sources(b,tr)
  if not src:issues.append(dict(id=b['id'],issue='NO_M1_QUERY_SOURCE'));continue
  primary=next((o for o in src if o['id']==b['ownerEntity']),src[0]);src.sort(key=lambda o:o['id']!=primary['id']);als={o['id']:'s'+str(i+1) for i,o in enumerate(src)};cols=schema(cm['returnType'],b['context']);pars=parameters(cm);qid='QR-'+b['id']
  # Same-name matching is a candidate lineage, not a proven formula. Keep provenance separate.
  for col in cols:
   leaf=re.sub(r'\[\]|\{key\}','',col['name']).split('.')[-1];candidates=[als[o['id']]+'.'+leaf for o in src if any(a['name']==leaf for a in o['attributes'])]
   col.update(label=leaf,aggregateFunction='NONE',visible=True,sortable=False,sourceExpression=None,mappingStatus='DTO_CONTRACT_ONLY',sourceCandidates=candidates)
   if len(candidates)==1:col.update(sourceExpression=candidates[0],mappingStatus='NAME_MATCH_REVIEW')
  qo=dict(id=qid,name=b['name'],alias=cm['name'],objectType='DETAIL_QUERY',behaviorRef=b['id'],description='由控制器、应用服务及响应 DTO 恢复的查询契约；来源关联与未决列级映射分别记录',sourceObjects=[dict(objectRef=o['id'],alias=als[o['id']],primary=i==0) for i,o in enumerate(src)],joins=[],parameters=pars,conditions=[],resultColumns=cols,groupBy=[],having=[],orderBy=[],pagination=dict(enabled=any(p['name']=='page'for p in pars),parameters=[p['name']for p in pars if p['name']in ['page','size','limit']],indexBase=0),context=b['context'],endpoint=b['endpoint'],responseJavaType=cm['returnType'],queryScope='SINGLE_AGGREGATE_CONTRACT' if len(src)==1 else 'COMPOSITE_QUERY',evidence=[evidence(cm['cls']['path'],cm['line'])]+([evidence(app['cls']['path'],app['line'])]if app else[]),implementation=[dict(method=m['cls']['name']+'.'+m['name'],evidence=[evidence(m['cls']['path'],m['line'],m['body'][:1300])])for m in tr if '/application/'in m['cls']['key']],lineageStatus='PARTIAL_STATIC',reviewRequired=True,version='1.1',notes='简单单聚合查询以可选查询契约纳入覆盖目录；不据此虚构跨对象 Join。sourceCandidates 不是已证实的血缘。')
  if cm['name'].lower().startswith(('list','search','findall','definitions','transactiontypes','transactioncategories')) or cm['name'] in ['items','schedule']:qo['objectType']='LIST_QUERY'
  for p in pars:
   matches=[als[o['id']]+'.'+p['name']for o in src if any(a['name']==p['name']for a in o['attributes'])]
   if len(matches)==1:p['sourceField']=matches[0]
  b['queryReportRef']=qid;sync(b);queries.append(qo);append_node(qid,qo['name'],'M7',b['context'],**{k:v for k,v in qo.items()if k not in ['id','name','context']});append_edge(b['id'],qid,'定义查询契约')
  for o in src:append_edge(qid,o['id'],'查询数据来源')
 # Prove direct DTO constructor mappings; never promote same-name matching alone.
 for q in queries:
  aliases={o['objectRef']:o['alias']for o in q['sourceObjects']}
  for col in q['resultColumns']:
   decl=col.get('declaringType');fp=(col.get('evidence')or[{}])[0].get('path')
   if not decl or fp not in j.classes:continue
   cl=j.classes[fp];source=cl['text'];sc=masked(source);rec=re.search(r'\brecord\s+'+re.escape(decl)+r'(?:<[^>]+>)?\s*\(',source)
   if not rec:continue
   ps=source.index('(',rec.start());pe=close(masked(source),ps);components=fields(source[rec.start():])
   fieldnames=[f['name']for f in components]
   if col.get('dtoField')not in fieldnames:continue
   index=fieldnames.index(col['dtoField']);mapping=None
   for ctor in re.finditer(r'\bnew\s+'+re.escape(decl)+r'\s*\(',sc):
    cs=sc.index('(',ctor.start());ce=close(sc,cs);args=split_args(source[cs+1:ce])
    if len(args)==len(fieldnames) and index<len(args):mapping=args[index];break
   if not mapping:continue
   getter=re.fullmatch(r'(\w+)\.(get|is)([A-Z]\w*)\(\)(?:\.name\(\))?',mapping.strip())
   if not getter:continue
   var,prefix,cap=getter.groups();attr=cap[0].lower()+cap[1:];types=set(re.findall(r'\b([A-Z][\w.]*)\s+'+re.escape(var)+r'\b',source));candidates=[]
   for o in objs:
    if o['context']!=q['context'] or o['alias']not in {t.rsplit('.',1)[-1]for t in types}:continue
    if not any(a['name']==attr for a in o['attributes']):continue
    if o['id']in aliases:candidates.append(aliases[o['id']]+'.'+attr)
    else:
     for parent in roots.values():
      if parent['id']not in aliases:continue
      for ent in parent['entities']:
       if ent['alias']==o['alias']:
        field=next((a['name']for a in parent['attributes']if o['alias']in a['javaType']),ent['alias']);candidates.append(aliases[parent['id']]+'.'+field+'.'+attr)
   if len(candidates)==1:col.update(sourceExpression=candidates[0],conversionExpression=mapping,mappingStatus='DTO_CONSTRUCTOR_VERIFIED')
 # Exact business semantics for important composite/statistical queries.
 def getq(c,fragment):return None if os.environ.get('ONTOLOGY_PROFILE')!='carddemo' else next((q for q in queries if q['context']==c and fragment in q['behaviorRef']),None)
 q=getq('transaction','ReportController')
 if q:
  q['name']='交易明细与三级汇总报表'
  aliases={o['objectRef']:o['alias']for o in q['sourceObjects']};base=aliases.get('AGG-transaction-TransactionRecord','s1');q.update(objectType='STATISTICAL_QUERY',description='按处理时间戳日期闭区间过滤，按卡号汇总；分页仅截取明细，pageTotal 为当前页，grandTotal 与 accountTotals 基于全量过滤结果',groupBy=[base+'.cardNumber'],conditions=[dict(conditionId='DATE_FROM',leftExpression=base+'.processedTimestamp',operator='GE',parameterRef='startDate',description='startDate.atStartOfDay()'),dict(conditionId='DATE_TO',leftExpression=base+'.processedTimestamp',operator='LE',parameterRef='endDate',description='endDate.atTime(LocalTime.MAX)')],aggregationSemantics=dict(pageTotal='SUM(pageRows.amount)',grandTotal='SUM(filteredRows.amount)',accountTotals='GROUP BY cardNumber; SUM(filteredRows.amount)',referenceIntegrity='类型或分类缺失时整份报表失败'),lineageStatus='CURATED_SOURCE_VERIFIED')
  for col in q['resultColumns']:
   if col['name']=='pageTotal':col.update(sourceExpression='SUM(PAGE('+base+').amount)',aggregateFunction='SUM',mappingStatus='SOURCE_VERIFIED')
   elif col['name']=='grandTotal':col.update(sourceExpression='SUM('+base+'.amount)',aggregateFunction='SUM',mappingStatus='SOURCE_VERIFIED')
   elif col['name']=='accountTotals[].total':col.update(sourceExpression='SUM('+base+'.amount) GROUP BY '+base+'.cardNumber',aggregateFunction='SUM',mappingStatus='SOURCE_VERIFIED')
 q=getq('ledger','TrialBalanceController')
 if q:
  q.update(objectType='STATISTICAL_QUERY',description='按 postedAt 的月初到下月初半开区间汇总科目借贷发生额；包含被冲正原分录及其反向分录，不包含期初余额',groupBy=[next((x['alias'] for x in q['sourceObjects'] if x['objectRef']=='AGG-ledger-JournalEntry'),'s2')+'.lines.accountCode'],aggregationSemantics=dict(debitTotal='SUM(lines.amount WHERE direction=DR)',creditTotal='SUM(lines.amount WHERE direction=CR)',netAmount='debitTotal - creditTotal',balanced='totalDebit.compareTo(totalCredit) == 0'),lineageStatus='CURATED_SOURCE_VERIFIED')
 q=getq('bff','CustomerOverviewController')
 if q:q.update(objectType='DETAIL_QUERY',description='以 accountId 获取账户额度骨架；取卡列表中第一张含 customerId 的卡定位客户；最近交易最多5条。账户失败终止，其他下游异常降级',composition=dict(strategy='REST_SERIAL_AGGREGATION',customerSelection='first nonblank CardSummary.customerId',recentTransactions=5,requiredSource='account-service',optionalSources=['card-service','customer-service','transaction-service']),lineageStatus='CURATED_SOURCE_VERIFIED')
 q=getq('search','SearchController')
 if q:q.update(objectType='LIST_QUERY',description='客户在本地按ID/姓名包含过滤；交易仅在q为11位账户号或16位卡号时查询。ALL部分失败降级，全失败或指定类型下游失败返回503',composition=dict(strategy='UNION_TYPED_RESULTS',join=False,transactionQuery='q matches 11 digits OR 16 digits',limit='first limit results; total before truncation'),lineageStatus='CURATED_SOURCE_VERIFIED')
 q=getq('reporting','ReportRunController_get')
 if q:q.update(objectType='REPORT',description='已生成报表运行及固定结果行：dimension、amount、detail。此查询读取已落库结果，不触发重新生成',reportOptions=dict(title='已生成报表结果',layout='TABLE',groupFields=[],subtotalFields=[],totalFields=[],exportFormats=[],emptyValueDisplay=''),notes='REPORT 表示固定结果结构；当前服务没有 XLSX/CSV/PDF 导出端点，不虚构导出能力。')
 for q in queries:
  if q['behaviorRef']=='transaction_ReportController_transactions':
   for p in q['parameters']:
    if p['name']in ['startDate','endDate']:p.update(allowedOperators=['GE']if p['name']=='startDate'else['LE'],sourceField='s1.processedTimestamp')
 # joins are only declared where a key relationship is evidenced; retrieval is application-side, never cross-DB SQL.
 join_specs={'bff':[('account','Account','card','Card','accountId','accountId','REST_ASSOCIATION'),('card','Card','customer','Customer','customerId','customerId','FIRST_CARD_CUSTOMER_LOOKUP'),('account','Account','transaction','TransactionRecord','accountId','accountId','REST_RECENT_TRANSACTIONS')], 'reporting':[('reporting','ReportRun','reporting','ReportRow','runId','runId','REPOSITORY_LOOKUP')], 'notification':[('notification','Notification','notification','NotificationTemplate','templateCode','templateCode','TEMPLATE_LOOKUP')], 'transaction':[('transaction','TransactionRecord','transaction','TranType','typeCode','typeCode','REFERENCE_LOOKUP')]}
 for q in queries:
  aliases={o['objectRef']:o['alias']for o in q['sourceObjects']}
  for ac,an,bc,bn,af,bf,strategy in (join_specs.get(q['context'],[]) if os.environ.get('ONTOLOGY_PROFILE')=='carddemo' else []):
   aa=byalias.get((ac,an));bb=byalias.get((bc,bn))
   if aa and bb and aa['id']in aliases and bb['id']in aliases:q['joins'].append(dict(joinId='J'+str(len(q['joins'])+1),joinType='LEFT',leftSource=aliases[aa['id']],rightSource=aliases[bb['id']],conditionExpression=aliases[aa['id']]+'.'+af+' == '+aliases[bb['id']]+'.'+bf,executionStrategy=strategy,notes='应用层读取关联，不是数据库跨库 JOIN'))
  if os.environ.get('ONTOLOGY_PROFILE')=='carddemo' and q['context']=='transaction' and 'AGG-transaction-TransactionRecord'in aliases and 'AGG-transaction-TranCategory'in aliases:
   left=aliases['AGG-transaction-TransactionRecord'];right=aliases['AGG-transaction-TranCategory'];q['joins'].append(dict(joinId='J'+str(len(q['joins'])+1),joinType='LEFT',leftSource=left,rightSource=right,conditionExpression=left+'.typeCode == '+right+'.typeCode AND '+left+'.categoryCode == '+right+'.categoryCode',executionStrategy='COMPOSITE_REFERENCE_LOOKUP'))
  n=next(n for n in nodes if n['id']==q['id']);n['label']=q['name'];n.update({k:v for k,v in q.items()if k not in ['id','name','context']})
 # M6: replace single illustrative flow with source-level application workflows, including real conditions and catch paths.
 oldf={n['id']for n in nodes if n['model']=='M6'};nodes[:]=[n for n in nodes if n['model']!='M6'];edges[:]=[e for e in edges if e['source']not in oldf and e['target']not in oldf];usedids.difference_update(oldf);flows=[]
 for b in beh:
  m=implmap.get(b['id'])
  if not m:continue
  # read-only endpoints do not acquire fictitious lifecycle flows; channel aggregation is an actual multi-service orchestration.
  if b['behaviorType']=='QUERY' and b['context']not in ['bff','search']:continue
  cfg=SourceFlow(m,evidence).build();fid='FLOW-'+b['id'];src=sources(b,traces.get(b['id'],[]))
  f=dict(id=fid,name=b['name']+' · 执行流程',flowType='COLLABORATION',description='从应用服务 '+m['cls']['name']+'.'+m['name']+' 恢复的控制流；调用内部实现及领域规则见 M2 implementation，不等同于引擎运行实例',businessObjectRefs=[o['id']for o in src],roleRefs=[],trigger=dict(triggerType='BEHAVIOR',behaviorRef=b['id']),preconditions=['遵循触发行为的接口校验与领域约束'],postconditions=['正常返回或按源码拒绝/异常结束；状态以实际持久化与事务为准'],version='1.1',context=b['context'],modelingLevel='APPLICATION_ORCHESTRATION',flowInterpretation='源码控制流的解释模型，非运行时追踪，非可直接执行审批配置',expressionLanguage='JAVA_SOURCE_NOT_RULE_DSL',evidence=[evidence(m['cls']['path'],m['line'])],exceptionPaths=b.get('exceptionPaths',[]),reviewRequired=True,**cfg)
  flows.append(f);append_node(fid,f['name'],'M6',b['context'],**{k:v for k,v in f.items()if k not in ['id','name','context']});append_edge(fid,b['id'],'由行为触发');
  for o in src:append_edge(fid,o['id'],'涉及业务对象')
 from lifecycle_flows import lifecycle_models
 for f in (lifecycle_models(beh,flows,objs) if os.environ.get('ONTOLOGY_PROFILE')=='carddemo' else []):
  flows.append(f);append_node(f['id'],f['name'],'M6',f['context'],**{k:v for k,v in f.items() if k not in ['id','name','context']})
  for a in f['activities']:
   if a.get('subFlowRef'):append_edge(f['id'],a['subFlowRef'],'调用执行子流程','MAPPED')

 # API screens now include query data-source binding, directly traceable by behavior.
 for screen in screens:
  qrefs=[b['queryReportRef']for b in beh if b.get('queryReportRef') and any(a['behaviorRef']==b['id']for a in screen['actions'])]
  if qrefs:
   screen['queryReportRefs']=qrefs;nodeby[screen['screenId']]['queryReportRefs']=qrefs
   for ref in qrefs:append_edge(screen['screenId'],ref,'查询展示来源')
 # coverage explicitly classifies unsupported/inapplicable modules, not padded records.
 coverage=[]
 for c,label in CN.items():
  commands=[b for b in beh if b['context']==c and b['behaviorType']=='COMMAND'];qb=[b for b in beh if b['context']==c and b['behaviorType']=='QUERY' and b.get('m7Applicability')!='TECHNICAL_TOKEN_VERIFICATION'];fs=[f for f in flows if f['context']==c];qs=[q for q in queries if q['context']==c]
  status='SOURCE_ENTRY_COVERED' if all(any(f['trigger'].get('behaviorRef')==b['id'] for f in fs) for b in commands) and len(qs)==len(qb) else 'REVIEW_REQUIRED'
  if c=='installment':status='WIP_NO_ENDPOINTS'
  elif c=='web':status='UI_ONLY_NO_OWN_BUSINESS_FLOW'
  elif c in ['bff','search']:status='READ_ORCHESTRATION'
  coverage.append(dict(context=c,name=label,commands=len(commands),queries=len(qb),flows=len(fs),lifecycleFlows=sum(f['modelingLevel']=='BUSINESS_LIFECYCLE' for f in fs),queryModels=len(qs),m6Status=status,m7Status='SOURCE_CONTRACT_COVERED' if len(qb)==len(qs) and qb else 'NOT_APPLICABLE' if c in ['web','installment']else 'REVIEW_REQUIRED'))
 return dict(queries=queries,flows=flows,coverage=coverage,extractionIssues=issues,index=j,methodmap=methodmap)
