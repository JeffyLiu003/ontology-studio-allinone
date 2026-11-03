# -*- coding: utf-8 -*-
"""Evidence-first static reverse modeling; no Java compilation or runtime assertions."""
from pathlib import Path
import re,json,hashlib,subprocess,os,sys
ROOT=Path(sys.argv[1]).resolve(); OUT=Path(sys.argv[2]).resolve(); OUT.mkdir(parents=True,exist_ok=True); Y=OUT/'yaml';Y.mkdir(exist_ok=True)
DOMAIN=os.environ.get('ONTOLOGY_DOMAIN','代码仓库业务本体'); nodes=[];edges=[]; seen=set()
IS_CARDDEMO=os.environ.get('ONTOLOGY_PROFILE')=='carddemo'
CN=dict(iam='身份与用户',customer='客户',card='卡片',account='账户',transaction='交易与过账',authorization='授权',ledger='总账',reconciliation='对账与日终',payment='支付',billing='账单',limit='限额',fx='外汇',loan='贷款',fraud='欺诈风控',aml='反洗钱',dispute='争议',collections='催收',batch='批处理',reporting='报表',notification='通知',document='文档',workflow='流程',audit='审计',reference='参考数据',bff='客户全景',search='统一搜索',installment='分期',web='业务门户')
NAMES={'Customer':'客户','Card':'信用卡','CardXref':'卡客账映射','Account':'账户','AccountHold':'账户资金冻结','AccountProduct':'账户产品','TransactionRecord':'交易记录','PostingBatch':'过账批次','PostingLeg':'过账分录行','JournalEntry':'总账凭证','JournalLine':'凭证明细','LedgerAccount':'会计科目','AccountingPeriod':'会计期间','PaymentOrder':'支付指令','Statement':'账单','LimitDefinition':'限额定义','LoanApplication':'贷款申请','Loan':'贷款','RepaymentSchedule':'还款计划','AuthorizationCase':'授权明细','AuthorizationSummary':'授权汇总','CardFraudFlag':'卡片欺诈标记','ReconciliationRun':'对账运行','ReconciliationItem':'对账差异项','EodRun':'日终运行','User':'用户','FraudRule':'欺诈规则','FraudAlert':'欺诈告警','AmlAlert':'反洗钱告警','SanctionsEntry':'制裁名单条目','DisputeCase':'争议案件','DelinquencyCase':'催收案件','FxRate':'汇率','FxQuote':'外汇报价','FxConversion':'外汇兑换','JobDefinition':'批任务定义','JobRun':'批任务运行','ReportDefinition':'报表定义','ReportRun':'报表运行','NotificationTemplate':'通知模板','Notification':'通知','DocumentMetadata':'文档元数据','WorkflowDefinition':'工作流定义','WorkflowTask':'工作流任务','AuditEvent':'审计事件','ReferenceItem':'参考数据项','DailyTransaction':'日交易','TranCategoryBalance':'交易分类余额','TranType':'交易类型','TranCategory':'交易分类','PostingRule':'过账规则','PostingType':'过账类型'}
def evidence(p,line=1,excerpt=None):
 d={'path':str(p.relative_to(ROOT)),'line':line,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
 if excerpt:d['excerpt']=excerpt[:1800]
 return d
def node(id,label,model,ctx='',**kw):
 if id not in seen:nodes.append(dict(id=id,label=label,model=model,context=ctx,**kw));seen.add(id)
 return id
def edge(s,t,label,status='CODE',**kw):
 if s in seen and t in seen and s!=t and not any(e['source']==s and e['target']==t and e['label']==label for e in edges):edges.append(dict(source=s,target=t,label=label,status=status,**kw))
def model(t,**kw):return dict(model_type=t,version='1.0',domain=DOMAIN,modelingMode='REVERSE_ENGINEERED',**kw)
files=sorted((ROOT/'services').glob('*/src/main/java/**/*.java')); services=sorted(p for p in (ROOT/'services').iterdir() if p.is_dir());contexts={};texts={p:p.read_text() for p in files}
modules=re.findall(r'<module>services/(.*?)</module>',(ROOT/'pom.xml').read_text())
for s in services:
 c=s.name.removesuffix('-service').replace('reference-data','reference').replace('web-ui','web');contexts[s.name]=c
 node('CTX-'+c,CN.get(c,c),'CTX',c,status='CODE' if s.name in modules else 'WIP',description='父 POM 中的模块' if s.name in modules else '目录存在，未纳入父 POM',evidence=[evidence(s/'pom.xml')] if (s/'pom.xml').exists() else [])
CN={c:CN.get(c,c) for c in contexts.values()}
# Parse model declarations and fields, preserving source evidence. Persistence entities are candidate aggregate roots, not blindly all roots.
objs=[];vals=[];enums=[];byalias={};children={'JournalLine':'JournalEntry','PostingLeg':'PostingBatch','ReconciliationItem':'ReconciliationRun','RepaymentSchedule':'Loan'} if IS_CARDDEMO else {}
for p,s in texts.items():
 if '/domain/model/' not in str(p) and not re.search(r'@Entity\b',s):continue
 c=contexts[p.relative_to(ROOT).parts[1]];alias=p.stem
 enum=re.search(r'public enum \w+\s*\{([\s\S]*?)(?:;|\})',s)
 if enum:
  items=re.findall(r'\b([A-Z][A-Z0-9_]+)\s*(?:\([^;]*?\))?\s*(?:,|$)',enum[1]);enums.append(dict(id=f'DICT-{c}-{alias}',name=alias,context=c,values=items,evidence=[evidence(p)]));continue
 if not re.search(r'\b(?:class|record)\s+'+alias+r'\b',s):continue
 attrs=[]
 for m in re.finditer(r'((?:\s*@[\w.]+(?:\([^;]*?\))?\s*)*)private\s+(?!static\b)(?:final\s+)?([\w<>?,. ]+)\s+(\w+)\s*(?:=[^;]*)?;',s):
  ann,typ,name=m.groups();typ=typ.strip();mapped={'String':'String','BigDecimal':'Decimal','LocalDate':'Date','LocalDateTime':'DateTime','Instant':'DateTime','int':'Integer','long':'Integer','Integer':'Integer','Long':'Integer','boolean':'Boolean'}
  at=dict(name=name,label=name,type=mapped.get(typ,'Enum' if '@Enumerated' in ann else 'String'),javaType=typ,required='nullable = false' in ann or bool(re.search(r'@(Id|EmbeddedId)\b',ann)),sourceLine=s[:m.start()].count('\n')+1)
  attrs.append(at)
 statusfield=next((x for x in attrs if x['name']=='status'),None);life=[]
 if statusfield:
  en=next((e for e in enums if e['context']==c and e['name']==statusfield['javaType']),None)
  # enum files may occur later: use direct source
  ep=p.parent/(statusfield['javaType']+'.java')
  if ep.exists():life=re.findall(r'^\s*([A-Z][A-Z0-9_]+)\s*[,;]?',ep.read_text(),re.M)
 comments=re.search(r'/\*\*([\s\S]*?)\*/',s);desc=re.sub(r'\s*\*\s*',' ',re.sub(r'<[^>]+>|\{@link ([^}]+)\}',r'\1',comments[1])).strip()[:600] if comments else '由源码结构反向识别；业务名称/边界待评审'
 if re.search(r'@Entity\b',s):
  id=f'AGG-{c}-{alias}';obj=dict(id=id,name=NAMES.get(alias,alias),alias=alias,context=c,aggregateType='ENTITY' if alias in children else 'AGGREGATE_ROOT',description=desc,lifecycle=life,attributes=attrs,entities=[],valueObjects=[],invariants=[],evidence=[evidence(p,s[:s.index('public class')].count('\n')+1 if 'public class' in s else 1)],confidence='CODE_STRUCTURE',reviewRequired=True)
  objs.append(obj);byalias[(c,alias)]=obj;node(id,obj['name'],'M1',c,**{k:v for k,v in obj.items() if k not in ('id','name','context')});edge('CTX-'+c,id,'包含对象')
 else:
  v=dict(id=f'VO-{c}-{alias}',name=alias,context=c,immutable='record '+alias in s,attributes=attrs,evidence=[evidence(p)],description=desc);vals.append(v)
# child composition + scalar references
assocs=[]
for o in objs:
 c=o['context'];alias=o['alias']
 if alias in children and (c,children[alias]) in byalias:
  parent=byalias[(c,children[alias])];parent['entities'].append(dict(name=o['name'],alias=alias,cardinality='ZERO_OR_MORE',evidence=o['evidence']));edge(parent['id'],o['id'],'组合明细')
 for v in vals:
  if v['context']==c and any(v['name'] in a['javaType'] for a in o['attributes']):o['valueObjects'].append(v)
refs={'customerId':('customer','Customer'),'accountId':('account','Account'),'debtorAccountId':('account','Account'),'cardNumber':('card','Card'),'productCode':('account','AccountProduct'),'transactionBatchId':('transaction','PostingBatch'),'entryId':('ledger','JournalEntry'),'reversalOf':('ledger','JournalEntry')}
if not IS_CARDDEMO:refs={}
for o in objs:
 for a in o['attributes']:
  if a['name'] not in refs:continue
  target=byalias.get((o['context'],o['alias'])) if a['name']=='reversalOf' else byalias.get(refs[a['name']]);
  if not target or target['id']==o['id']:continue
  a.update(type='AggregateRootRef',targetAggregate=target['id'])
  rel=dict(id='ASSOC-'+str(len(assocs)+1),sourceAggregate=o['id'],targetAggregate=target['id'],associationType='REFERENCE',referenceField=a['name'],cardinality='MANY_TO_ONE',evidence=o['evidence'],reviewRequired=True,description='标量标识语义映射；非数据库外键，基数按模型解释待评审')
  assocs.append(rel);edge(o['id'],target['id'],a['name']+' 引用','MAPPED',evidence=o['evidence'])
# Local guards belong in M1 invariants, NOT reusable M3 by default.
for o in objs:
 p=ROOT/o['evidence'][0]['path'];s=texts[p]
 for m in re.finditer(r'throw new (?:BusinessRuleException|ValidationException)\s*\(\s*"([^"\n]+)"([\s\S]*?)\);',s):
  o['invariants'].append(dict(name=m[1],description='源码拒绝条件（非完整形式化表达式）',sourceFragment=s[max(0,s.rfind('if (',0,m.start())):m.end()][-1100:],evidence=[evidence(p,s[:m.start()].count('\n')+1)]))
# Reusable policies/calculators M3
rules=[]
for p,s in texts.items():
 if '/domain/service/' not in str(p) and p.stem!='ScheduleCalculator':continue
 if not re.search(r'public (?:final )?class',s):continue
 c=contexts[p.relative_to(ROOT).parts[1]];rid='RULE-'+c+'-'+p.stem
 r=dict(id=rid,name=p.stem,ruleType='CALCULATION' if 'Calculator' in p.stem else 'VALIDATION',description='源码中的领域策略/计算组件；表达式未转换为规则引擎 DSL',implementationType='JAVA',expression=None,formalizationStatus='SOURCE_BACKED_NOT_EXECUTABLE_DSL',inputParams=[],outputType='SeeJavaSignature',reusedBy=[],context=c,evidence=[evidence(p,1,s[:1600])]);rules.append(r);node(rid,p.stem,'M3',c,**{k:v for k,v in r.items() if k not in ('id','context')});edge('CTX-'+c,rid,'领域策略')
# endpoint behaviors: controller public methods and annotation evidence
beh=[];queries=[];screens=[]
for p,s in texts.items():
 if '@RestController' not in s or p.stem in ['GlobalExceptionHandler','ApiProxyController']:continue
 c=contexts[p.relative_to(ROOT).parts[1]];base=re.search(r'@RequestMapping\(\s*"([^"]+)"',s);base=base[1] if base else ''
 for m in re.finditer(r'@(Get|Post|Put|Patch|Delete)Mapping\b',s):
  tail=s[m.end():];end=re.search(r'\bpublic\s+([\w<>?,.\[\] ]+)\s+(\w+)\s*\(',tail)
  if not end:continue
  part=tail[:end.start()];path=re.match(r'\s*\(\s*"([^"]*)"',part);url=base+(path[1] if path else '');method=m[1].upper();name=end[2];bid=f'{c}_{p.stem}_{name}';line=s[:m.start()].count('\n')+1
  prior=s[s.rfind('Mapping',0,m.start())+7:m.start()];summary=re.findall(r'summary\s*=\s*"([^"]+)"',prior);label=summary[-1] if summary else f'{p.stem.removesuffix("Controller")} · {name}'
  candidates=[o for o in objs if o['context']==c and o['aggregateType']=='AGGREGATE_ROOT'];matches=sorted(candidates,key=lambda o:len(set(re.findall('[A-Z][a-z]+',p.stem))&set(re.findall('[A-Z][a-z]+',o['alias']))),reverse=True);owner=matches[0]['id'] if matches else None
  b=dict(id=bid,name=label,ownerEntity=owner,behaviorType='QUERY' if method=='GET' else 'COMMAND',triggerType='USER_ACTION',preconditions=[],postconditions=[],appliedRules=[],requiredPermissions=[],syncTriggers=[],endpoint=dict(method=method,path=url),context=c,ownershipStatus='NAME_MAPPED_REVIEW' if owner else 'READ_MODEL_OR_TECHNICAL',evidence=[evidence(p,line)],notes='REST 操作入口，不代表用户已实际执行；权限和事务需运行时另验')
  # Rule wiring is added selectively below after manual source verification
  if method=='GET' and re.search(r'report|trial.balance|summary|overview|search',url,re.I):
   qid='QR-'+bid;b['queryReportRef']=qid;q=dict(id=qid,name=label,alias=name,objectType='STATISTICAL_QUERY',behaviorRef=bid,sourceObjects=[dict(objectRef=owner,alias='primary',primary=True)] if owner else [],joins=[],parameters=[],resultColumns=[],context=c,evidence=b['evidence'],notes='查询入口已确认；结果列与参数仍以 DTO / 方法签名为准，尚未完整形式化');queries.append(q);node(qid,label,'M7',c,**{k:v for k,v in q.items() if k not in ('id','name','context')})
  beh.append(b);node(bid,label,'M2',c,**{k:v for k,v in b.items() if k not in ('id','name','context')});edge(owner or 'CTX-'+c,bid,'提供行为');
  if 'queryReportRef' in b:edge(bid,b['queryReportRef'],'查询报表')
 # actual per-service Swagger console. Do not conflate with web-ui feature coverage.
 bs=[b for b in beh if b['evidence'][0]['path']==str(p.relative_to(ROOT))]
 if bs:
  sid='UI-API-'+c+'-'+p.stem;screen=dict(screenId=sid,name=CN.get(c,c)+' / '+p.stem+' API 控制台',screenType='LIST_MAINTENANCE',layout='[Swagger UI]\n[HTTP method + endpoint]\n[Parameters] [Try it out] [Response]',elements=[],actions=[dict(actionId='ACT-'+b['id'],name=b['name'],behaviorRef=b['id']) for b in bs],context=c,evidence=[evidence(p)],presentation='API_CONSOLE',notes='Swagger 操作分组的反向模型；不表示门户存在对应按钮')
  screens.append(screen);node(sid,screen['name'],'MU',c,**{k:v for k,v in screen.items() if k not in ('name','context')});edge('CTX-'+c,sid,'API 控制台');
  for b in bs:edge(sid,b['id'],'可调用')
if not IS_CARDDEMO:
 for screen in screens:
  screen.update(name=screen['name'].replace('API 控制台','API 操作契约'),presentation='API_CONTRACT',notes='由 REST 入口形成的候选交互契约；未证明存在 Swagger UI 或实际业务页面。')
  for n in nodes:
   if n['id']==screen['screenId']:n.update(label=screen['name'],presentation=screen['presentation'],notes=screen['notes'])
# Physical REST dependency: configuration @Value and URLs only, not business object identity
integrations=[]
for p,s in texts.items():
 if '/infrastructure/client/' not in str(p):continue
 c=contexts[p.relative_to(ROOT).parts[1]]
 for service,tc in contexts.items():
  if re.search(r'[\"\']'+re.escape(service)+r'[\"\']',s) or (service+':' in ((ROOT/'services'/p.relative_to(ROOT).parts[1]/'src/main/resources/application.yml').read_text() if (ROOT/'services'/p.relative_to(ROOT).parts[1]/'src/main/resources/application.yml').exists() else '') and p.stem.lower().startswith(tc.replace('-',''))):
   integrations.append(dict(source=c,target=tc,evidence=[evidence(p)],type='REST_CLIENT'));edge('CTX-'+c,'CTX-'+tc,'REST 依赖',evidence=[evidence(p)])
# Verified user roles, only UI scope. No invented backend permission matrix.
u=next((p for p in files if '/iam/' in str(p) and p.stem=='User'),None);ui=ROOT/'services/web-ui/src/main/resources/static/app.js';us=ui.read_text() if ui.exists() else ''
roles=[dict(roleId='ROLE-ADMIN',name='管理员',permissions=[],userType='A',evidence=[evidence(u,25) if u else {}],enforcement='UI_MENU_ONLY'),dict(roleId='ROLE-USER',name='普通用户',permissions=[],userType='U',evidence=[evidence(u,26) if u else {}],enforcement='UI_MENU_ONLY')]
if u is None or not IS_CARDDEMO:roles=[]
for r in roles:node(r['roleId'],r['name'],'M5','iam',**{k:v for k,v in r.items() if k!='name'});edge('CTX-iam',r['roleId'],'定义角色')
webscreens=[]
for m in re.finditer(r"\{ key: '([^']+)', href: '([^']+)', icon: '[^']*', label: '([^']+)'([^}]*)\}",us):
 sid='UI-WEB-'+m[1];admin='adminOnly: true' in m[4] or m[1] in ['ledger','reconciliation','limits','operations','users'];sc=dict(screenId=sid,name=m[3],screenType='QUERY_LIST',layout='[侧边导航] [业务工作区]',elements=[],actions=[],route=m[2],context='web',adminOnly=admin,evidence=[evidence(ui,us[:m.start()].count('\n')+1)],presentation='BUSINESS_PORTAL');webscreens.append(sc);node(sid,sc['name'],'MU','web',**{k:v for k,v in sc.items() if k not in ('name','context')});edge('CTX-web',sid,'门户页面');edge('ROLE-ADMIN',sid,'菜单可见');
 if not admin:edge('ROLE-USER',sid,'菜单可见')
screens+=webscreens
# Model explicit payment lifecycle with exact endpoint references and rejection/return alternatives
flows=[];pb={b['id'].rsplit('_',1)[-1]:b for b in beh if IS_CARDDEMO and b['context']=='payment'}
if all(k in pb for k in ['create','accept','settle','returnPayment']):
 seq=['create','accept','settle','returnPayment'];acts=[dict(activityId='START',name='开始',activityType='START',nextActivities=['P1'])]
 for i,k in enumerate(seq):acts.append(dict(activityId='P'+str(i+1),name=pb[k]['name'],activityType='BEHAVIOR_CALL',behaviorRef=pb[k]['id'],nextActivities=['P'+str(i+2)] if i<3 else ['END']))
 acts.append(dict(activityId='END',name='退汇路径结束',activityType='END',nextActivities=[]))
 f=dict(id='FLOW-PAYMENT-RETURN',name='支付受理—接受—清算—退汇示例路径',flowType='COLLABORATION',businessObjectRefs=[byalias[('payment','PaymentOrder')]['id']],roleRefs=[],trigger=dict(triggerType='MANUAL'),startActivity='START',endActivities=['END'],activities=acts,context='payment',evidence=[evidence(ROOT/'services/payment-service/src/main/java/com/carddemo/payment/application/PaymentOrderService.java',60)],notes='源码端点及状态约束组合的合法示例路径；非强制退汇，非 workflow-service 已部署编排；受理可能拒绝，退汇也允许从 ACCEPTED 分支执行',status='MODELED_PATH');flows.append(f);node(f['id'],f['name'],'M6','payment',**{k:v for k,v in f.items() if k not in ('id','name','context')});
 for a in acts:
  if 'behaviorRef'in a:edge(f['id'],a['behaviorRef'],'路径节点','MAPPED')
# Verified payment cross-aggregate coordination rules; two concrete syncTriggers only.
pp=ROOT/'services/payment-service/src/main/java/com/carddemo/payment/application/PaymentOrderService.java'
for action,state,target,title,line in [('settle','ACCEPTED','transaction_PostingBatchController_create','支付清算过账条件',128),('returnPayment','SETTLED','transaction_PostingBatchController_reverse','已清算退汇冲正条件',149)]:
 if action not in pb or target not in {b['id'] for b in beh}:continue
 bid=pb[action]['id'];rid='RULE-PAYMENT-'+action.upper()
 r=dict(id=rid,name=title,ruleType='VALIDATION',description='跨聚合同步调用的条件：'+title,expression="status == '"+state+"'",inputParams=[dict(name='status',type='String',sourceField='PaymentOrder.status',required=True)],outputType='Boolean',reusedBy=[bid],context='payment',evidence=[evidence(pp,line)],formalizationStatus='MODELED_FROM_SOURCE',notes='规则表达式为静态语义提炼，未在规则引擎中运行；不代表分布式事务')
 rules.append(r);node(rid,title,'M3','payment',**{k:v for k,v in r.items() if k not in ('id','name','context')});pb[action]['appliedRules'].append(rid);pb[action]['syncTriggers'].append(dict(ruleRef=rid,behaviorRef=target,description=title,evidence=[evidence(pp,line)]));edge(bid,rid,'按条件判定','MAPPED');edge(rid,target,'条件满足后调用','MAPPED');edge(bid,target,'同步 REST 调用',evidence=[evidence(pp,line)])
for a,b,label in [('create','accept','筛查通过后可接受'),('accept','settle','接受后可清算'),('settle','returnPayment','清算后可退汇'),('accept','returnPayment','亦可直接退汇')]:
 if a in pb and b in pb:edge(pb[a]['id'],pb[b]['id'],label,'MAPPED',evidence=[evidence(pp)])

from enrich_models import enrich
enrichment=enrich(ROOT,objs,vals,beh,rules,flows,screens,nodes,edges,node,edge,evidence,CN)
queries=enrichment['queries'];flows=enrichment['flows'];seen.clear();seen.update(n['id'] for n in nodes)

# reference evidence snippets for UI
for n in nodes:
 for e in n.get('evidence',[]):
  if 'excerpt' not in e:
   lines=(ROOT/e['path']).read_text().splitlines();idx=e['line']-1;e['excerpt']='\n'.join(f'{j+1}: {lines[j]}' for j in range(max(0,idx-2),min(len(lines),idx+17)))
models={'m1-object-model.yaml':model('OBJECT',aggregates=[o for o in objs if o['aggregateType']=='AGGREGATE_ROOT'],entities=[o for o in objs if o['aggregateType']=='ENTITY'],valueObjectCatalog=vals,dictionaries=enums,associations=assocs),'m2-behavior-model.yaml':model('BEHAVIOR',behaviors=beh),'m3-rule-model.yaml':model('RULE',rules=rules),'m5-actor-model.yaml':model('ACTOR',actors=[dict(actorId='ACTOR-USER',name='系统使用者',actorType='HUMAN',roles=[r['roleId'] for r in roles])] if IS_CARDDEMO else [],roles=roles,permissions=[],notes='没有虚构服务端 RBAC；前端 adminOnly 不等于后端授权'),'m6-flow-model.yaml':model('FLOW',flows=flows),'m7-report-model.yaml':model('REPORT',query_reports=queries),'mu-ui-model.yaml':model('UI',application=dict(name=DOMAIN,menus=[dict(menuId='MENU-'+c,name=CN[c],children=[dict(menuId='MENU-'+s['screenId'],name=s['name'],screenRef=s['screenId']) for s in screens if s['context']==c]) for c in CN if any(s['context']==c for s in screens)]),screens=screens)}
# JSON serialization is valid YAML 1.2; convert to block YAML with local npm yaml if available in next step.
for name,m in models.items():(Y/name).write_text(json.dumps(m,ensure_ascii=False,indent=2))
checks=[]
def ck(name,ok,count):checks.append(dict(check=name,passed=bool(ok),count=count))
bids={b['id'] for b in beh};qids={q['id'] for q in queries};aids={o['id'] for o in objs};actions=[a for s in screens for a in s['actions']]
ck('M2 USER_ACTION → MU action coverage',all(any(a['behaviorRef']==b['id'] for a in actions) for b in beh),len(beh));ck('MU → M2 behavior existence',all(a['behaviorRef'] in bids for a in actions),len(actions));ck('M7 ↔ M2 one-to-one',all(sum(b.get('queryReportRef')==q['id'] and b['id']==q['behaviorRef'] for b in beh)==1 for q in queries),len(queries));ck('M6 behavior references',all(a.get('behaviorRef')in bids for f in flows for a in f['activities'] if 'behaviorRef'in a),sum(len(f['activities']) for f in flows));ck('M1 reference targets',all(a['targetAggregate']in aids for o in objs for a in o['attributes'] if 'targetAggregate'in a),len(assocs));ck('M2 syncTriggers references',all(t['ruleRef'] in {r['id'] for r in rules} and t['behaviorRef'] in bids for b in beh for t in b['syncTriggers']),sum(len(b['syncTriggers']) for b in beh));ck('Graph references',all(e['source']in seen and e['target']in seen for e in edges),len(edges));ck('Unique node identifiers',len(seen)==len(nodes),len(nodes))
from validate_models import validate
checks.extend(validate(models,nodes,edges))
if not all(c['passed'] for c in checks):
 (OUT/'validation.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2))
 raise SystemExit('Model validation failed; inspect ontology/validation.json')
limits=['本结果是源码反向建模基线，未经过需求探索人工确认；不声明业务规格已完整。','聚合边界按持久化结构和语义进行初判；外键语义与基数需要领域专家复核。','M3 只登记领域策略组件；局部拒绝条件归入 M1 invariants；尚未转换成可执行 DSL。','M2恢复静态应用调用链；M6依据源码生成，预置生命周期仅在对应行为存在时采用。Java谓词为解释视图，非可执行流程配置。','M7恢复可识别的查询契约；同名候选映射保留待评审，不是已经证明的列级血缘。','MU API 控制台分组用于入口追溯；门户页面尚未逐按钮绑定；API 可调用不等于门户支持。',('M5 仅确认 A/U 用户类型与前端菜单限制；不声明后端权限体系已执行。' if IS_CARDDEMO else '通用适配器未恢复角色权限体系，M5 保留为空；MU 为候选 API 交互契约，不声明实际业务页面存在。'),'未纳入父构建的模块和缺失的流程/报表不补造。各模块支持范围见coverage。','未运行 Maven 测试或业务环境；图中 CODE 表示静态源码证据，不表示运行验证成功。']
manifest=dict(model_type='MANIFEST',version='1.0',domain=DOMAIN,framework='ontology_modeling_framework_v9.md',model_files=list(models),source_root=str(ROOT),source_commit=os.environ.get('ONTOLOGY_COMMIT','unavailable'),source_status='源码只读快照；不执行仓库脚本或Git工作区钩子',scope='STATIC_REVERSE_MODELING_BASELINE',complete=False,limitations=limits,validation=checks)
(Y/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2));(OUT/'validation.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2));data=dict(nodes=nodes,edges=edges,contexts=CN,manifest=manifest,counts=dict(services=len(services),objects=len(objs),behaviors=len(beh),rules=len(rules),queries=len(queries),flows=len(flows),lifecycleFlows=sum(f.get('modelingLevel')=='BUSINESS_LIFECYCLE'for f in flows),screens=len(screens)),models=models,coverage=enrichment['coverage'],extractionIssues=enrichment['extractionIssues']);(OUT/'ontology-data.json').write_text(json.dumps(data,ensure_ascii=False,indent=2));print(json.dumps(data['counts']));print(checks)
