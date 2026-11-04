const NOISE=new Set(['evidence','sourceLine','sha256','excerpt','created_at','updated_at','humanEdited']);
function semantic(value){
 if(Array.isArray(value))return value.map(semantic);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>!NOISE.has(k)).map(k=>[k,semantic(value[k])]));
 return value;
}
const encoded=value=>JSON.stringify(value);
function evidence(value,out=[]){
 if(!value||typeof value!=='object')return out;
 if(value.path&&Number.isFinite(value.line))out.push({path:value.path,line:value.line,sha256:value.sha256||null});
 if(Array.isArray(value))for(const item of value)evidence(item,out);else for(const item of Object.values(value))if(item&&typeof item==='object')evidence(item,out);
 return [...new Map(out.map(e=>[encoded(e),e])).values()].sort((a,b)=>encoded(a).localeCompare(encoded(b)));
}
function fields(before,after,path='',out=[]){
 if(encoded(before)===encoded(after))return out;
 const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
 if(object(before)&&object(after))for(const key of [...new Set([...Object.keys(before),...Object.keys(after)])].sort())fields(before[key],after[key],path?path+'.'+key:key,out);
 else if(Array.isArray(before)&&Array.isArray(after)){
  // Pair named model members so insertions don't masquerade as unrelated field changes.
  const key=['activityId','id','name','actionId','screenId'].find(k=>[...before,...after].every(v=>v&&typeof v==='object'&&typeof v[k]==='string')&&new Set(before.map(v=>v[k])).size===before.length&&new Set(after.map(v=>v[k])).size===after.length);
  if(key){if(before.length===after.length&&before.every(v=>after.some(w=>w[key]===v[key]))&&encoded(before.map(v=>v[key]))!==encoded(after.map(v=>v[key])))out.push({path:path+'[顺序]',before:before.map(v=>v[key]),after:after.map(v=>v[key])});const a=new Map(before.map(v=>[v[key],v])),b=new Map(after.map(v=>[v[key],v]));for(const id of new Set([...a.keys(),...b.keys()]))fields(a.get(id),b.get(id),`${path}[${id}]`,out);}
  else if(before.length<100&&after.length<100)for(let i=0;i<Math.max(before.length,after.length);i++)fields(before[i],after[i],`${path}[${i}]`,out);
  else out.push({path,before:before??null,after:after??null});
 }else out.push({path:path||'定义',before:before??null,after:after??null});
 return out;
}
const edgeKey=e=>encoded([e.source,e.target,e.label]);
export function compareSnapshots(before,after,{from,to,mode='source'}={}){
 const left=new Map((before.nodes||[]).map(n=>[n.id,n])),right=new Map((after.nodes||[]).map(n=>[n.id,n])),changes=[],evidenceChanges=[];
 for(const id of [...new Set([...left.keys(),...right.keys()])].sort()){
  const a=left.get(id),b=right.get(id),n=b||a;
  if(!a||!b)changes.push({id,kind:a?'removed':'added',model:n.model,context:n.context,label:n.label,before:a||null,after:b||null,fields:[]});
  else{
   const semA=semantic(a),semB=semantic(b),diff=fields(semA,semB);
   if(diff.length)changes.push({id,kind:'modified',model:n.model,context:n.context,label:n.label,before:a,after:b,fields:diff});
   if(encoded(evidence(a))!==encoded(evidence(b)))evidenceChanges.push({id,model:n.model,context:n.context,label:n.label,semanticChanged:!!diff.length,before:evidence(a),after:evidence(b)});
  }
 }
 const oldEdges=new Map((before.edges||[]).map(e=>[edgeKey(e),e])),newEdges=new Map((after.edges||[]).map(e=>[edgeKey(e),e])),relations=[];
 for(const key of [...new Set([...oldEdges.keys(),...newEdges.keys()])].sort()){
  const a=oldEdges.get(key),b=newEdges.get(key);
  if(!a||!b||encoded(semantic(a))!==encoded(semantic(b))){const source=right.get((b||a).source)||left.get((b||a).source);relations.push({kind:!a?'added':!b?'removed':'modified',context:source?.context,model:source?.model,before:a||null,after:b||null});}
 }
 const changedIds=new Set(changes.map(n=>n.id)),affected=new Set();
 for(const e of [...(before.edges||[]),...(after.edges||[])]){
  if(changedIds.has(e.source)&&!changedIds.has(e.target))affected.add(e.target);
  if(changedIds.has(e.target)&&!changedIds.has(e.source))affected.add(e.source);
 }
 const impacted=[...affected].map(id=>right.get(id)||left.get(id)).filter(Boolean).map(n=>({id:n.id,label:n.label,model:n.model,context:n.context}));
 const summary={added:changes.filter(c=>c.kind==='added').length,removed:changes.filter(c=>c.kind==='removed').length,modified:changes.filter(c=>c.kind==='modified').length,evidenceOnly:evidenceChanges.filter(c=>!c.semanticChanged).length,relations:relations.length,impacted:impacted.length};
 const byModel=Object.fromEntries([...new Set(changes.map(n=>n.model))].map(t=>[t,{added:changes.filter(n=>n.model===t&&n.kind==='added').length,removed:changes.filter(n=>n.model===t&&n.kind==='removed').length,modified:changes.filter(n=>n.model===t&&n.kind==='modified').length}]));
 return {version:1,from,to,mode,summary,byModel,changes,evidenceChanges,relations,impacted,notice:'按稳定模型 ID 比较提取结果；重命名可能表现为删除与新增。证据变化单独列出，未提取出模型变化不代表业务行为未变。关联复核范围来自一层静态图边，不是运行时影响证明。'};
}
