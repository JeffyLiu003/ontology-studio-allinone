import test from 'node:test';
import assert from 'node:assert/strict';
import { modelQuality } from '../server/model-quality.mjs';
import { compareSnapshots } from '../server/snapshot-diff.mjs';
const ev=(sha='a',line=1)=>[{path:'src/main/java/Account.java',line,sha256:sha.repeat(64)}];
const base=()=>({contexts:{account:'账户'},nodes:[{id:'ctx',model:'CTX',context:'account',label:'账户'},{id:'object',model:'M1',context:'account',label:'账户',attributes:[{name:'amount',javaType:'BigDecimal',sourceLine:7}],evidence:ev()},{id:'command',model:'M2',context:'account',label:'记账',behaviorType:'COMMAND',endpoint:{method:'POST',path:'/accounts'},evidence:ev()},{id:'flow',model:'M6',context:'account',label:'执行流程',trigger:{behaviorRef:'command'},activities:[{activityId:'A1',conditionExpression:'amount > 0',evidence:ev()}],evidence:ev()},{id:'rule',model:'M3',context:'account',label:'规则',expression:'amount > 0',evidence:ev()},{id:'query',model:'M7',context:'account',label:'账户查询',parameters:[{name:'id',required:true}],resultColumns:[{name:'amount',javaType:'BigDecimal',mappingStatus:'DTO_CONSTRUCTOR_VERIFIED'}],evidence:ev()}],edges:[{source:'command',target:'object',label:'操作对象',status:'CODE'}],manifest:{validation:[{check:'references',passed:true}],scanInventory:{languages:{Java:2,TypeScript:1},modules:[{context:'account',entities:[{path:'src/main/java/Account.java',line:1}],endpoints:[{path:'src/main/java/Account.java',line:1}]}]}} });
test('Quality distinguishes structural evidence, candidate matches and business review',()=>{
 const data=base();data.reviews=[{node_id:'object',status:'confirmed'}];const q=modelQuality(data);
 assert.equal(q.summary.models,5);assert.equal(q.summary.confirmed,1);assert.equal(q.summary.withEvidence,5);assert.equal(q.modules[0].objectMatches,1);assert.equal(q.modules[0].endpointMatches,1);assert.equal(q.modules[0].commandCovered,1);assert.ok(q.issues.some(i=>i.code==='LANGUAGE_LIMIT'));assert.ok(!('accuracy' in q));
 data.nodes.find(n=>n.id==='flow').trigger.behaviorRef='missing';assert.ok(modelQuality(data).issues.some(i=>i.code==='FLOW_GAP'));
});
test('Module-only and legacy results never receive fabricated source coverage',()=>{
 const q=modelQuality({nodes:[{id:'module',model:'CTX',context:'x'}],contexts:{x:'仅模块'},manifest:{validation:[{passed:true}]}});
 assert.equal(q.status,'insufficient');assert.equal(q.scanKnown,false);assert.equal(q.summary.evidencePercent,null);assert.equal(q.modules[0].scanKnown,false);assert.ok(q.issues.some(i=>i.code==='MODULE_ONLY'));
});
test('Quality exposes unresolved extraction and lineage with source/model anchors',()=>{
 const data=base();data.extractionIssues=[{id:'command',issue:'NO_CONTROLLER_METHOD'}];data.nodes.find(n=>n.id==='query').resultColumns[0].mappingStatus='NAME_MATCH_REVIEW';data.manifest.scanInventory.skipped=[{path:'broken.java',reason:'SOURCE_UNREADABLE',message:'encoding'}];data.manifest.skipped_oversized_files=['large.java'];
 const q=modelQuality(data);assert.equal(q.summary.unresolvedColumns,1);assert.ok(q.issues.some(i=>i.code==='EXTRACTION_GAP'&&i.nodeId==='command'&&i.evidence.length));assert.ok(q.issues.some(i=>i.code==='SCAN_SKIPPED'));assert.ok(q.issues.some(i=>i.code==='FILE_SKIPPED'));
});
test('Snapshot diff excludes evidence noise and tracks each model contract independently',()=>{
 const a=base(),b=structuredClone(a);b.nodes.reverse();b.nodes.find(n=>n.id==='object').attributes[0].sourceLine=100;b.nodes.find(n=>n.id==='object').evidence=ev('b',90);
 let d=compareSnapshots(a,b);assert.equal(d.summary.modified,0);assert.equal(d.summary.evidenceOnly,1);
 b.nodes.find(n=>n.id==='object').attributes[0].javaType='String';b.nodes.find(n=>n.id==='command').endpoint.path='/accounts/post';b.nodes.find(n=>n.id==='rule').expression='amount >= 0';b.nodes.find(n=>n.id==='flow').activities[0].conditionExpression='amount >= 0';b.nodes.find(n=>n.id==='query').resultColumns[0].javaType='String';
 d=compareSnapshots(a,b);assert.equal(d.summary.modified,5);assert.equal(d.summary.evidenceOnly,0);assert.ok(d.changes.find(n=>n.id==='object').fields.some(f=>f.path==='attributes[amount].javaType'));assert.ok(d.changes.find(n=>n.id==='command').fields.some(f=>f.path==='endpoint.path'));
});
test('Snapshot diff preserves removed definitions, relation changes and real one-hop impact',()=>{
 const a=base(),b=structuredClone(a);b.nodes=b.nodes.filter(n=>n.id!=='rule');b.nodes.push({id:'new',model:'M1',context:'account',label:'新对象'});b.nodes.find(n=>n.id==='command').label='新名称';b.edges.push({source:'new',target:'object',label:'引用',status:'MAPPED'});
 const d=compareSnapshots(a,b);assert.equal(d.summary.added,1);assert.equal(d.summary.removed,1);assert.equal(d.summary.modified,1);assert.equal(d.summary.relations,1);assert.equal(d.changes.find(n=>n.kind==='removed').before.expression,'amount > 0');assert.ok(d.impacted.some(n=>n.id==='object'));assert.equal(d.impacted.some(n=>n.id==='ctx'),false);
 assert.equal(compareSnapshots(a,a).changes.length,0);
});
