export const SEVEN=['M1','M2','M3','M5','M6','M7','MU'];
export const EXTRA={ME:['me-event-model.yaml','events','EVENT'],M4:['m4-scenario-model.yaml','event_scenarios','SCENARIO'],MM:['mm-mapping-model.yaml','mappings','MAPPING'],MI:['mi-interface-model.yaml','interfaces','INTERFACE']};
export const ELEVEN=[...SEVEN,'ME','M4','MM','MI'];
export function method(value='seven'){if(value==='nine')value='eleven';if(!['seven','eleven'].includes(value))throw Error('建模方法必须为 seven 或 eleven');return value}
export function prepareModels(data,project){
 const scheme=method(project.modeling_method||'seven');data.manifest={...data.manifest,modeling_method:scheme,modeling_framework:scheme==='eleven'?'v6-eleven':'v9-seven'};
 if(scheme==='seven')return data;
 for(const [type,[file,list,kind]]of Object.entries(EXTRA)){
  const candidates=data.nodes.filter(n=>n.model===type);for(const n of candidates){if(type==='ME'){n.eventId=n.eventId||n.id;n.eventName=n.eventName||n.label}if(type==='MI')n.interfaceId=n.interfaceId||n.id;}
  data.models[file]={model_type:kind,version:'1.0',domain:project.name,modelingMode:'EVIDENCE_CANDIDATE',...(data.models[file]||{}),[list]:candidates};
 }
 data.manifest.model_files=Object.keys(data.models);
 data.manifest.modeling_limits=['v6十一模型。新增模型只保留明确文档候选或人工定义；源码适配器暂不自动识别事件投递、场景链路与持久化映射。空集合不是已完成建模。','不将同步调用自动认定为事件协同，M4事件场景与M6人工流程分开。完整v6语义检查尚未实现。'];
 data.manifest.source_framework=data.manifest.source_framework||data.manifest.framework;data.manifest.framework='ontology_modeling_framework_v6.md';data.manifest.limitations=[...new Set([...(data.manifest.limitations||[]),...data.manifest.modeling_limits])];
 data.counts={...data.counts,...Object.fromEntries(Object.keys(EXTRA).map(k=>[k,data.nodes.filter(n=>n.model===k).length]))};
 return data;
}
