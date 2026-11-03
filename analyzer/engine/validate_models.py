"""Independent consistency and source-backed regression checks for the ontology bundle."""
import json,re
from pathlib import Path

def validate(models,nodes,edges):
 result=[]
 def check(name,ok,count=1):
  result.append(dict(check=name,passed=bool(ok),count=count))
 m1=models['m1-object-model.yaml'];aggs={o['id']:o for o in m1['aggregates']};bs={b['id']:b for b in models['m2-behavior-model.yaml']['behaviors']};qs=models['m7-report-model.yaml']['query_reports'];fs=models['m6-flow-model.yaml']['flows'];fmap={f['id']:f for f in fs};roles={r['roleId']for r in models['m5-actor-model.yaml']['roles']};rules={r['id']for r in models['m3-rule-model.yaml']['rules']}
 check('M6 one START and valid END activities',all(sum(a['activityType']=='START'for a in f['activities'])==1 and f['startActivity']in {a['activityId']for a in f['activities']if a['activityType']=='START'} and f['endActivities'] and all(e in {a['activityId']for a in f['activities']if a['activityType']=='END'}for e in f['endActivities'])for f in fs),len(fs))
 refs=True;reachable=True;ends=True;gate=True;roleok=True;objok=True
 for f in fs:
  am={a['activityId']:a for a in f['activities']};adj={a['activityId']:a.get('nextActivities',[])+[x['targetActivity']for x in a.get('branches',[])]+[x['targetActivity']for x in a.get('exceptionHandlers',[])]for a in f['activities']}
  refs&=all(t in am for v in adj.values()for t in v)
  refs&=all((not a.get('behaviorRef')or a['behaviorRef']in bs)and(not a.get('subFlowRef')or a['subFlowRef']in fmap)and(not a.get('ruleRef')or a['ruleRef']in rules)for a in am.values())
  if not refs:continue
  def visit(start):
   seen=set();stack=[start]
   while stack:
    x=stack.pop()
    if x in seen:continue
    seen.add(x);stack+=adj[x]
   return seen
  reachable&=len(visit(f['startActivity']))==len(am)
  ends&=all(bool(visit(a)&set(f['endActivities']))for a in am)
  gate&=all(len(a.get('branches',[]))>=2 and sum(b.get('isDefault',False)for b in a['branches'])<=1 and all(b.get('isDefault')or b.get('conditionExpression')or b.get('approvalOutcome')or b.get('ruleRef')for b in a['branches'])for a in am.values()if a['activityType']=='GATEWAY')
  roleok&=all(a.get('roleRef')in roles and a['roleRef']in f['roleRefs']for a in am.values()if a['activityType']in ['USER_TASK','APPROVAL_TASK'])
  objok&=all(o in aggs for o in f['businessObjectRefs'])
 check('M6 activity, behavior, subflow and rule references',refs,len(fs));check('M6 all activities reachable',reachable,len(fs));check('M6 all activity paths can reach an END',ends,len(fs));check('M6 gateways have conditional/default branches',gate,sum(a['activityType']=='GATEWAY'for f in fs for a in f['activities']));check('M6 role references',roleok,len(fs));check('M6 business object references are roots',objok,len(fs))
 graph={f['id']:[a['subFlowRef']for a in f['activities']if a.get('subFlowRef')]for f in fs};finished=set();current=set()
 def acyclic(k):
  if k in current:return False
  if k in finished:return True
  current.add(k)
  if not all(acyclic(v)for v in graph[k]):return False
  current.remove(k);finished.add(k);return True
 check('M6 SUB_FLOW_CALL graph is acyclic',all(acyclic(k)for k in graph),len(fs))
 check('M7 unique QUERY behavior and bidirectional binding',len({q['behaviorRef']for q in qs})==len(qs)and all(q['behaviorRef']in bs and bs[q['behaviorRef']]['behaviorType']=='QUERY'and bs[q['behaviorRef']].get('queryReportRef')==q['id']for q in qs),len(qs))
 check('M7 valid root sources and exactly one primary',all(q['sourceObjects']and sum(bool(o.get('primary'))for o in q['sourceObjects'])==1 and all(o['objectRef']in aggs for o in q['sourceObjects'])for q in qs),len(qs))
 check('M7 source aliases and join references',all(len({o['alias']for o in q['sourceObjects']})==len(q['sourceObjects'])and all(j['leftSource']in {o['alias']for o in q['sourceObjects']}and j['rightSource']in {o['alias']for o in q['sourceObjects']}for j in q['joins'])for q in qs),len(qs))
 check('M7 parameter and response contract populated',all(q['resultColumns']and len({p['name']for p in q['parameters']})==len(q['parameters'])and len({c['name']for c in q['resultColumns']})==len(q['resultColumns'])for q in qs),len(qs))
 check('M7 contains no role/rule/flow permission references',all(not any(k in q for k in ['ruleRefs','roleRefs','flowRefs','requiredPermissions'])for q in qs),len(qs))
 # Verified DTO mappings must resolve to real M1 fields, including composed child attributes.
 objects={o['id']:o for o in m1['aggregates']+m1['entities']};byalias={(o['context'],o['alias']):o for o in objects.values()}
 def fieldpath(q,expression):
  parts=expression.split('.');sources={o['alias']:objects[o['objectRef']]for o in q['sourceObjects']}
  obj=sources.get(parts[0])
  if not obj:return False
  for i,part in enumerate(parts[1:]):
   attr=next((a for a in obj['attributes']if a['name']==part),None)
   if i==len(parts[1:])-1:return attr is not None
   child=next((ent for ent in obj.get('entities',[])if ent['alias']==part or attr and ent['alias']in attr['javaType']),None)
   if not child:return False
   obj=byalias.get((obj['context'],child['alias']))
   if not obj:return False
  return False
 proven=[(q,c)for q in qs for c in q['resultColumns']if c['mappingStatus']=='DTO_CONSTRUCTOR_VERIFIED']
 check('M7 proven DTO mappings resolve to M1 fields',all(fieldpath(q,c['sourceExpression'])for q,c in proven),len(proven))
 check('M7 REPORT objects include reportOptions',all(q.get('reportOptions')for q in qs if q['objectType']=='REPORT'),sum(q['objectType']=='REPORT'for q in qs))
 # Targeted behavioral regressions, not just shape assertions.
 pay=fmap.get('FLOW-payment_PaymentOrderController_settle',{});acts=pay.get('activities',[])
 if 'payment_PaymentOrderController_settle' in bs:check('Payment SETTLED idempotence and ACCEPTED guard preserved',any(a.get('conditionExpression')=='order.getStatus() == PaymentStatus.SETTLED'for a in acts)and any(a.get('conditionExpression')=='order.getStatus() != PaymentStatus.ACCEPTED'for a in acts))
 if 'reporting_ReportRunController_generate' in bs:check('Report generation retains failure-write and rethrow',any('run.fail('in a.get('sourceCode','')for f in fs if 'ReportRunController_generate'in f['id']for a in f['activities'])and any(a.get('outcome')=='THROW'for f in fs if 'ReportRunController_generate'in f['id']for a in f['activities']))
 rpt=next((q for q in qs if q['behaviorRef']=='transaction_ReportController_transactions'),{})
 if 'transaction_ReportController_transactions' in bs:check('Transaction report distinguishes page and global sums',rpt.get('aggregationSemantics',{}).get('pageTotal')=='SUM(pageRows.amount)'and rpt.get('aggregationSemantics',{}).get('grandTotal')=='SUM(filteredRows.amount)')
 if 'reporting_ReportRunController_generate' in bs:check('POST report generation remains COMMAND',bs.get('reporting_ReportRunController_generate',{}).get('behaviorType')=='COMMAND')
 return result

if __name__=='__main__':
 data=json.loads((Path(__file__).parent/'ontology-data.json').read_text());r=validate(data['models'],data['nodes'],data['edges']);print(json.dumps(r,ensure_ascii=False,indent=2));raise SystemExit(0 if all(c['passed']for c in r)else 1)
