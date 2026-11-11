import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

// First migration into the namespaced multi-material format. Never inherit approval.
export function carryLegacySupplements(before, data, sourceRoot, sourceMap) {
 const handled=new Set();
 if(before.manifest.materialVersions?.length)return handled;
 const ids=new Set(before.nodes.map(n=>n.id)), files=new Map(Object.entries(sourceMap).map(([key,path])=>[path,key]));
 const checks=new Map(), proofExists=e=>{const path='primary/'+e.path,key=files.get(path);if(!key)return false;if(!checks.has(key))try{checks.set(key,createHash('sha256').update(readFileSync(join(sourceRoot,key))).digest('hex'))}catch{checks.set(key,null)}return checks.get(key)===e.sha256};
 const proofs=v=>{if(!v||typeof v!=='object')return [];return [...(v.path&&v.line&&v.sha256?[v]:[]),...Object.values(v).flatMap(proofs)]};
 const rebase=v=>{if(typeof v==='string')return ids.has(v)?'primary:'+v:v;if(Array.isArray(v))return v.map(rebase);if(!v||typeof v!=='object')return v;const out=Object.fromEntries(Object.entries(v).map(([k,x])=>[k,rebase(x)]));if(typeof v.path==='string'&&files.has('primary/'+v.path))out.path='primary/'+v.path;if(typeof v.context==='string'&&Object.hasOwn(before.contexts,v.context))out.context='primary:'+v.context;return out};
 data.manifest.legacyCarryForward=[];data.manifest.pendingManualRevisions??=[];
 for(const n of before.nodes.filter(n=>n.humanEdited||n.aiAnalysis)){
  handled.add(n.id);const evidence=proofs(n);
  if(!evidence.length||!evidence.every(proofExists)){data.manifest.pendingManualRevisions.push({id:n.id,label:n.label,snapshot:before.snapshot.id,notice:'历史补充的来源无法在当前源码中逐一核验，原草稿保留于旧快照'});continue}
  const next={...rebase(n),materialId:'primary',sourceKind:n.aiAnalysis?'ai':'human',reviewRequired:true};
  const at=data.nodes.findIndex(x=>x.id===next.id);if(at>=0)data.nodes[at]=next;else data.nodes.push(next);
  if(n.context&&before.contexts[n.context]&&!data.contexts[next.context]){data.contexts[next.context]=before.contexts[n.context];const ctx=before.nodes.find(x=>x.model==='CTX'&&x.context===n.context);if(ctx&&!data.nodes.some(x=>x.id==='primary:'+ctx.id))data.nodes.push({...rebase(ctx),materialId:'primary',sourceKind:'ai'})}
  data.manifest.legacyCarryForward.push({from:before.snapshot.id,oldId:n.id,id:next.id,status:'SOURCE_HASH_VERIFIED_DRAFT',notice:'只迁移来源未变的草稿，不继承确认'});
 }
 const kept=new Set(data.manifest.legacyCarryForward.map(x=>x.oldId)),targets=new Set(data.nodes.map(n=>n.id));
 for(const edge of before.edges){if(!kept.has(edge.source)&&!kept.has(edge.target))continue;const next=rebase(edge);if(targets.has(next.source)&&targets.has(next.target)&&!data.edges.some(e=>e.source===next.source&&e.target===next.target&&e.label===next.label))data.edges.push(next)}
 return handled;
}
