import {SEVEN,ELEVEN,EXTRA} from './modeling-methods.mjs';
export const MODEL_FILES={M1:['m1-object-model.yaml','aggregates','OBJECT'],M2:['m2-behavior-model.yaml','behaviors','BEHAVIOR'],M3:['m3-rule-model.yaml','rules','RULE'],M5:['m5-actor-model.yaml','roles','ACTOR'],M6:['m6-flow-model.yaml','flows','FLOW'],M7:['m7-report-model.yaml','query_reports','REPORT'],MU:['mu-ui-model.yaml','screens','UI'],...EXTRA};
const refs={sourceObjectRef:['M1'],sourceAggregate:['M1'],targetObject:['M1'],targetAggregate:['M1'],ownerEntity:['M1'],targetAggregate:['M1'],objectRef:['M1'],behaviorRef:['M2'],producerBehaviorRef:['M2'],producerEntityRef:['M1'],ruleRef:['M3'],triggerEventRef:['ME'],eventRef:['ME'],roleRef:['M5'],role_ref:['M5'],subFlowRef:['M6'],queryReportRef:['M7'],screenRef:['MU'],interfaceRef:['MI']};
export function validateModels(data){
 const issues=[],nodes=data.nodes||[],byId=new Map(nodes.map(n=>[n.id,n])),add=(code,nodeId,path,message)=>issues.push({code,nodeId,path,message,severity:'error'});
 if(byId.size!==nodes.length)add('DUPLICATE_ID',null,'id','存在重复模型ID');
 const allowed=data.project?.modeling_method==='seven'||data.manifest?.modeling_method==='seven'?SEVEN:ELEVEN;
 const globalIds=new Map(nodes.map(n=>[n.id,n.model]));
 for(const model of Object.values(data.models||{}))for(const list of Object.values(model).filter(Array.isArray))for(const item of list)if(item&&typeof item==='object'){const id=item.id||item.roleId||item.permissionId||item.screenId||item.eventId||item.interfaceId;if(id&&!globalIds.has(id))globalIds.set(id,model.model_type==='ACTOR'?'M5':null)}
 function check(owner,value,path=''){
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){value.forEach((v,i)=>check(owner,v,path+'['+i+']'));return}
  for(const[k,v]of Object.entries(value)){
   if(['evidence','sourceDefinition','sourceDeclaration','implementation'].includes(k))continue;
   const at=path?path+'.'+k:k;
   if(refs[k]&&v!==null&&v!==undefined&&typeof v!=='string')add('REFERENCE_FORMAT',owner.id,at,'引用需要稳定ID文本');
   if(refs[k]&&typeof v==='string'&&v){if(!globalIds.has(v))add('DANGLING_REFERENCE',owner.id,at,'引用不存在：'+v);else if(globalIds.get(v)&&!refs[k].includes(globalIds.get(v)))add('REFERENCE_TYPE',owner.id,at,'引用类型不匹配：'+v)}
   if(['appliedRules','requiredPermissions','roleRefs','businessObjectRefs','targetObjectRefs','inheritsFrom'].includes(k)&&Array.isArray(v))for(const id of v){if(typeof id!=='string')add('REFERENCE_FORMAT',owner.id,at,'引用列表必须为稳定ID文本');else if(!globalIds.has(id))add('DANGLING_REFERENCE',owner.id,at,'引用不存在：'+id);}
   check(owner,v,at);
  }
 }
 for(const n of nodes){if(n.model==='CTX')continue;if(!allowed.includes(n.model))add('MODEL_NOT_ALLOWED',n.id,'model','模型不属于当前建模方法');check(n,n);
  if(!String(n.label||n.name||'').trim())add('LABEL_REQUIRED',n.id,'label','定义名称不能为空');
  if(n.model==='M1'){const names=(n.attributes||[]).map(a=>a.name);if(names.some(x=>!x)||new Set(names).size!==names.length)add('FIELD_ID',n.id,'attributes','字段名称不能为空或重复')}
  if(n.model==='M4')for(const step of n.steps||[])if(['GATEWAY','USER_TASK','APPROVAL_TASK','SUB_FLOW_CALL'].includes(step.stepType)||step.roleRef)add('SCENARIO_FLOW_MIXED',n.id,'steps','人工审批、网关和角色分配应建在M6')
  if(n.model==='MU'){
   const scan=value=>{if(!value||typeof value!=='object')return;if(Array.isArray(value.callChain)){const seen=new Set();for(const step of value.callChain){if(step.behaviorRef)seen.add(step.behaviorRef);if(step.eventRef){const event=byId.get(step.eventRef);if(event?.producerBehaviorRef&&!seen.has(event.producerBehaviorRef))add('UI_EVENT_ORDER',n.id,'callChain','发布事件之前需要调用其生产行为')}}}for(const [key,child]of Object.entries(value))if(key!=='evidence'&&child&&typeof child==='object')Array.isArray(child)?child.forEach(scan):scan(child)};scan(n)
  }
  if(n.model==='M7'&&n.behaviorRef){const b=byId.get(n.behaviorRef);if(b&&(b.queryReportRef!==n.id||b.behaviorType!=='QUERY'))add('QUERY_BINDING',n.id,'behaviorRef','M7必须与M2查询行为双向绑定')}
  if(n.model==='M2'&&n.queryReportRef&&byId.get(n.queryReportRef)?.behaviorRef!==n.id)add('QUERY_BINDING',n.id,'queryReportRef','查询报表没有反向绑定此行为');
 }
 const visiting=new Set(),done=new Set();function visit(id){if(visiting.has(id)){add('FLOW_CYCLE',id,'subFlowRef','子流程引用存在环');return}if(done.has(id))return;visiting.add(id);const walk=v=>{if(!v||typeof v!=='object')return;if(v.subFlowRef&&byId.has(v.subFlowRef))visit(v.subFlowRef);for(const x of Object.values(v))if(typeof x==='object')Array.isArray(x)?x.forEach(walk):walk(x)};walk(byId.get(id));visiting.delete(id);done.add(id)}nodes.filter(n=>n.model==='M6').forEach(n=>visit(n.id));
 const roleVisiting=new Set(),roleDone=new Set();function visitRole(id){if(roleVisiting.has(id)){add('ROLE_CYCLE',id,'inheritsFrom','角色继承存在环');return}if(roleDone.has(id))return;roleVisiting.add(id);for(const parent of byId.get(id)?.inheritsFrom||[])if(byId.get(parent)?.model==='M5')visitRole(parent);roleVisiting.delete(id);roleDone.add(id)}nodes.filter(n=>n.model==='M5').forEach(n=>visitRole(n.id));
 const completeness=Object.keys(MODEL_FILES).filter(k=>allowed.includes(k)).map(model=>({model,count:nodes.filter(n=>n.model===model).length,status:data.manifest?.modelDecisions?.[model]?.status||(nodes.some(n=>n.model===model)?'discovered':'unknown'),reason:data.manifest?.modelDecisions?.[model]?.reason||''}));
 return {issues,valid:!issues.length,completeness};
}
export function syncModels(data){referenceEdges(data);data.counts={...data.counts,services:Object.keys(data.contexts||{}).length,...Object.fromEntries(Object.entries({M1:'objects',M2:'behaviors',M3:'rules',M6:'flows',M7:'queries',MU:'screens'}).map(([k,v])=>[v,data.nodes.filter(n=>n.model===k).length]))};for(const[type,[file,list,kind]]of Object.entries(MODEL_FILES)){if(!data.models[file]&&!data.nodes.some(n=>n.model===type))continue;data.models[file]={model_type:kind,version:'1.0',...(data.models[file]||{}),[list]:data.nodes.filter(n=>n.model===type)}}return data}

export function referenceEdges(data){
 const ids=new Set(data.nodes.map(n=>n.id)),edges=(data.edges||[]).filter(e=>!e.modelReference);
 for(const n of data.nodes){const link=(target,label)=>{if(target&&ids.has(target))edges.push({source:n.id,target,label,modelReference:true,status:n.humanEdited?'MAPPED':n.sourceKind==='document'?'DOCUMENT':'EXTRACTED',evidence:n.evidence||[]})};
 if(n.model==='M1')for(const a of n.attributes||[])link(a.targetAggregate,'属性引用对象');
 if(n.model==='M2'){link(n.ownerEntity,'行为所属对象');link(n.queryReportRef,'查询行为绑定报表');for(const id of n.appliedRules||[])link(id,'行为引用规则')}
 if(n.model==='M7'){link(n.behaviorRef,'查询承接行为');for(const s of n.sourceObjects||[])link(s.objectRef,'查询来源对象')}
 if(n.model==='MI')link(n.behaviorRef,'接口承接行为');if(n.model==='MM')link(n.objectRef,'映射业务对象');
 if(n.model==='ME'){link(n.producerBehaviorRef,'事件生产行为');for(const s of n.subscribers||[]){link(s.behaviorRef||s.handlerBehaviorRef,'事件订阅行为');link(s.ruleRef,'事件订阅规则')}}
 if(n.model==='M4'){link(n.triggerEventRef,'场景触发事件');link(n.sourceObjectRef,'场景来源对象');for(const id of n.targetObjectRefs||[])link(id,'场景目标对象');for(const step of n.steps||[]){link(step.behaviorRef,'场景引用行为');link(step.eventRef,'场景引用事件');link(step.ruleRef,'场景引用规则')}}
 if(n.model==='M5')for(const id of n.inheritsFrom||[])link(id,'角色继承');
 if(n.model==='M6'){for(const id of n.roleRefs||[])link(id,'流程参与角色');for(const activity of n.activities||[]){link(activity.behaviorRef,'流程引用行为');link(activity.roleRef,'活动参与角色');link(activity.subFlowRef,'引用子流程')}}
 if(n.model==='MU')for(const action of n.actions||[])link(action.behaviorRef,'界面调用行为');
 }
 data.edges=[...new Map(edges.map(e=>[[e.source,e.label,e.target,!!e.modelReference].join('|'),e])).values()];return data;
}
