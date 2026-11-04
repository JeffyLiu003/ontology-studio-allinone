const TYPES=['M1','M2','M3','M5','M6','M7','MU'];
const evidenceValid=e=>!!e?.path&&Number.isInteger(e.line)&&e.line>0&&/^[a-f0-9]{64}$/i.test(e.sha256||'');
const rate=(n,d)=>d?Math.round(n/d*100):null;
export function modelQuality(data) {
 if(data.manifest?.adapter==='document-directory')return documentQuality(data);
 const nodes=data.nodes||[],edges=data.edges||[],manifest=data.manifest||{},scan=manifest.scanInventory||null,models=nodes.filter(n=>n.model!=='CTX'),byId=new Map(nodes.map(n=>[n.id,n]));
 const reviews=new Map((data.reviews||[]).map(r=>[r.node_id,r])),issues=[];
 const add=(code,severity,title,detail,extra={})=>issues.push({id:`${code}-${issues.length}`,code,severity,title,detail,...extra});
 const counts=Object.fromEntries(TYPES.map(t=>[t,models.filter(n=>n.model===t).length]));
 if(!models.length)add('MODULE_ONLY','error','仅识别到模块结构','当前没有对象、行为、规则、流程或查询等业务模型。任务完成不代表业务建模已覆盖。');
 if(!scan)add('SCAN_UNKNOWN','info','缺少原始扫描清单','这是旧版或导入快照，无法回算源码候选匹配率。重新分析可生成扫描清单。');
 for(const error of scan?.skipped||[])add('SCAN_SKIPPED','warning','源码扫描存在跳过项',error.message||error.reason,{path:error.path});
 const supportedLanguages=new Set(['Java']);
 for(const [language,files]of Object.entries(scan?.languages||{}))if(!supportedLanguages.has(language))add('LANGUAGE_LIMIT','info',`${language} 尚未进行深度语义分析`,`${files} 个文件仅计入语言清单，不计为业务模型已覆盖。`);
 for(const path of manifest.skipped_oversized_files||[])add('FILE_SKIPPED','warning','文件未进入分析','单文件超过 2MB，可能造成相关模型缺失。',{path});
 const modules=Object.entries(data.contexts||{}).map(([context,name])=>{
  const group=models.filter(n=>n.context===context),candidate=scan?.modules?.find(m=>m.context===context);
  const behaviors=group.filter(n=>n.model==='M2'),commands=behaviors.filter(b=>b.behaviorType==='COMMAND'),queries=behaviors.filter(b=>b.behaviorType==='QUERY'&&b.m7Applicability!=='TECHNICAL_TOKEN_VERIFICATION');
  const flows=group.filter(n=>n.model==='M6'),reports=group.filter(n=>n.model==='M7');
  const commandCovered=commands.filter(b=>flows.some(f=>f.trigger?.behaviorRef===b.id)).length;
  const queryCovered=queries.filter(b=>reports.some(q=>q.behaviorRef===b.id)).length;
  const objects=group.filter(n=>n.model==='M1'),entityCandidates=candidate?.entities||[],endpointCandidates=candidate?.endpoints||[];
  // Candidate matches are based on source anchors, not only equal counts.
  const objectMatches=entityCandidates.filter(e=>objects.some(n=>(n.evidence||[]).some(v=>v.path===e.path))).length;
  const endpointMatches=endpointCandidates.filter(e=>behaviors.some(n=>(n.evidence||[]).some(v=>v.path===e.path&&v.line===e.line))).length;
  if(!group.length)add('MODULE_EMPTY','warning',`${name} 仅有模块节点`,'可能是基础设施模块，也可能是当前解析器未覆盖；不能直接认定业务模型完整。',{context});
  for(const e of entityCandidates)if(!objects.some(n=>(n.evidence||[]).some(v=>v.path===e.path)))add('ENTITY_GAP','warning','实体候选未形成 M1 模型',`${name} 中的 @Entity 候选需要核查。`,{context,...e});
  for(const e of endpointCandidates)if(!behaviors.some(n=>(n.evidence||[]).some(v=>v.path===e.path&&v.line===e.line)))add('ENDPOINT_GAP','warning','REST 候选未形成 M2 模型','候选扫描基于词法规则；排除的技术入口或不支持的写法也会产生差异。',{context,...e});
  for(const b of commands)if(!flows.some(f=>f.trigger?.behaviorRef===b.id))add('FLOW_GAP','warning','命令行为缺少应用执行流程',b.label,{nodeId:b.id,context,evidence:b.evidence});
  for(const b of queries)if(!reports.some(q=>q.behaviorRef===b.id))add('QUERY_GAP','warning','查询行为缺少 M7 契约',b.label,{nodeId:b.id,context,evidence:b.evidence});
  return {context,name,counts:Object.fromEntries(TYPES.map(t=>[t,group.filter(n=>n.model===t).length])),models:group.length,commands:commands.length,commandCovered,queries:queries.length,queryCovered,scanKnown:!!scan,entityCandidates:entityCandidates.length,objectMatches,endpointCandidates:endpointCandidates.length,endpointMatches};
 });
 let withEvidence=0,confirmed=0,needsChanges=0;
 for(const n of models){
  if((n.evidence||[]).some(evidenceValid))withEvidence++;else add('EVIDENCE_GAP','warning','模型缺少完整的源码证据元数据',n.label,{nodeId:n.id,context:n.context,evidence:n.evidence});
  const review=reviews.get(n.id);if(review?.status==='confirmed')confirmed++;
  if(review?.status==='needs_changes'){needsChanges++;add('REVIEW_CHANGES','warning','人工评审要求修订',review.note||n.label,{nodeId:n.id,context:n.context,evidence:n.evidence});}
 }
 const lineage={};
 for(const n of models.filter(n=>n.model==='M7'))for(const c of n.resultColumns||[]){const key=c.mappingStatus||'UNKNOWN';lineage[key]=(lineage[key]||0)+1;}
 const unresolved=(lineage.NAME_MATCH_REVIEW||0)+(lineage.DTO_CONTRACT_ONLY||0)+(lineage.UNKNOWN||0);
 if(unresolved)add('LINEAGE_REVIEW','warning','查询字段血缘仍有待确认项',`${unresolved} 个返回字段只有候选映射、响应契约或未知状态；不计为已核验血缘。`);
 for(const problem of data.extractionIssues||[]){const n=byId.get(problem.id);add('EXTRACTION_GAP','warning',problem.issue==='NO_CONTROLLER_METHOD'?'控制器方法未能恢复':problem.issue==='NO_M1_QUERY_SOURCE'?'查询来源未能关联到业务对象':'解析缺口',problem.issue||JSON.stringify(problem),{nodeId:n?.id,context:n?.context,evidence:n?.evidence});}
 const checks=manifest.validation||[];
 for(const check of checks.filter(c=>!c.passed))add('VALIDATION_FAILED','error','结构校验未通过',check.check);
 const missingActors=!counts.M5;
 if(missingActors)add('ACTOR_LIMIT','info','主体与权限模型尚未恢复','M5 为空不等于系统没有权限控制；需要单独核对认证、授权与责任分工。');
 const status=!models.length?'insufficient':issues.some(i=>i.severity==='error')?'blocked':issues.some(i=>i.severity==='warning')?'review_required':'baseline';
 return {version:1,status,scanKnown:!!scan,counts,summary:{models:models.length,modules:modules.length,withEvidence,evidencePercent:rate(withEvidence,models.length),confirmed,needsChanges,pending:models.length-confirmed,checksPassed:checks.filter(c=>c.passed).length,checksTotal:checks.length,unresolvedColumns:unresolved,issues:issues.length},modules,lineage,issues,scan,adapter:manifest.adapter||'legacy',capabilities:[{scope:'Java / Spring REST / JPA',status:'partial',detail:'基于静态词法与源码模式，覆盖可识别的实体、端点、方法流程与 DTO 契约；不等同于完整 Java AST。'},{scope:'M5 角色与权限',status:missingActors?'not_recovered':'partial',detail:missingActors?'通用适配器未恢复角色权限。':'已提取主体信息仍需核对执行范围，不声明完整服务端授权。'},{scope:'跨端点生命周期',status:manifest.adapter==='carddemo'?'curated':'not_recovered',detail:'CardDemo 使用已核对的定向生命周期；通用仓库不自动补造。'},{scope:'其他语言 / 动态调用 / 运行时行为',status:'unsupported',detail:'未进行深度语义恢复；静态模型不证明运行时效果。'}],notice:'这些指标描述静态提取、证据和评审状态，不是业务准确率，也不证明业务需求已完整。'};
}

function documentQuality(data){
 const models=data.nodes.filter(n=>n.model!=='CTX'),reviews=new Map((data.reviews||[]).map(r=>[r.node_id,r])),counts=Object.fromEntries(TYPES.map(t=>[t,models.filter(n=>n.model===t).length])),issues=[];
 const add=(code,severity,title,detail,extra={})=>issues.push({id:code+'-'+issues.length,code,severity,title,detail,...extra});
 add('DOCUMENT_DRAFT','warning','文档候选需要领域评审','文档声明不代表系统已实现。对象边界、字段类型、规则表达式、权限、流程分支与查询血缘仍需核验。');
 for(const type of TYPES)if(!counts[type])add('DOCUMENT_MODEL_MISSING','warning',type+' 暂无明确模型定义','目录中未提取到此类候选；不表示业务不存在，也不补造该类型。');
 for(const n of models){if(!(n.evidence||[]).some(evidenceValid))add('EVIDENCE_GAP','warning','文档证据不完整',n.label,{nodeId:n.id});if(reviews.get(n.id)?.status==='needs_changes')add('REVIEW_CHANGES','warning','人工评审要求修订',reviews.get(n.id).note||n.label,{nodeId:n.id,context:n.context});}
 for(const file of data.manifest.documentInventory.files||[])if(!models.some(n=>(n.evidence||[]).some(e=>e.path===file.path)))add('DOCUMENT_NO_CANDIDATES','info','文档已读取但未提取独立业务候选',file.path+'：可能是辅助说明、非结构化资料或当前规则未覆盖，需要人工核验。',{path:file.path});
 for(const f of data.manifest.documentInventory.skipped||[])add('DOCUMENT_SKIPPED','warning','文档未进入建模',f.message,{path:f.path});
 for(const [ext,n]of Object.entries(data.manifest.documentInventory.unsupported||{}))add('FORMAT_UNSUPPORTED','info',ext+' 暂不支持',n+' 份文件未读取，需要转为支持的文本格式。');
 const checks=data.manifest.validation||[];for(const c of checks.filter(c=>!c.passed))add('VALIDATION_FAILED','error','文档引用校验未通过',c.check);
 const modules=Object.entries(data.contexts).map(([context,name])=>{const group=models.filter(n=>n.context===context),bs=group.filter(n=>n.model==='M2'),qs=group.filter(n=>n.model==='M7');return {context,name,counts:Object.fromEntries(TYPES.map(t=>[t,group.filter(n=>n.model===t).length])),models:group.length,commands:bs.filter(b=>b.behaviorType==='COMMAND').length,commandCovered:0,queries:bs.filter(b=>b.behaviorType==='QUERY').length,queryCovered:bs.filter(b=>qs.some(q=>q.behaviorRef===b.id)).length,scanKnown:false,entityCandidates:0,objectMatches:0,endpointCandidates:0,endpointMatches:0}});
 const confirmed=models.filter(n=>reviews.get(n.id)?.status==='confirmed').length,needsChanges=models.filter(n=>reviews.get(n.id)?.status==='needs_changes').length,withEvidence=models.filter(n=>(n.evidence||[]).some(evidenceValid)).length;
 return {version:1,status:checks.some(c=>!c.passed)?'blocked':'review_required',scanKnown:true,counts,summary:{models:models.length,modules:modules.length,withEvidence,evidencePercent:rate(withEvidence,models.length),confirmed,needsChanges,pending:models.length-confirmed,checksPassed:checks.filter(c=>c.passed).length,checksTotal:checks.length,unresolvedColumns:0,issues:issues.length},modules,lineage:{},issues,scan:{languages:{},scope:'只读文档目录；文档来源分组不等于已确认业务域。',analyzedFiles:data.manifest.analysis_files,analyzedJavaFiles:0},adapter:'document-directory',capabilities:[{scope:'Markdown / TXT / HTML / DOCX',status:'partial',detail:'识别明确的七模型标题、表格与声明，保留原始文件及提取文本证据。'},{scope:'M6 流程 / M7 查询 / M5 权限',status:'partial',detail:'保留文档描述及显式引用，不补造可执行流程、查询血缘和已实施授权。'},{scope:'PDF / 扫描件 / 任意自然语言推理',status:'unsupported',detail:'当前没有 OCR 或外部模型服务。'}],notice:'这是文档候选建模草稿，证据完整率与引用检查不等于业务准确率；尚未完成技能规定的需求探索人工确认。'};
}
