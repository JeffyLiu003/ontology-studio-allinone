import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync, renameSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createStudio, validateRepository } from '../server/index.mjs';
import { JobDeletion } from '../server/job-deletion.mjs';
import { retrieve } from '../server/assistant.mjs';
function fixture(root){const base=join(root,'source','src/main/java/example');for(const p of ['domain/model','application','interfaces/rest'])mkdirSync(join(base,p),{recursive:true});writeFileSync(join(base,'domain/model/Widget.java'),`package example.domain.model;
@Entity
public class Widget {
 @Id
 private String id;
 private String name;
 public Widget(String name) { this.id="demo"; this.name=name; }
 public String getId() { return id; }
 public String getName() { return name; }
}`);writeFileSync(join(base,'application/WidgetService.java'),`package example.application;
import example.domain.model.Widget;
public class WidgetService {
 public List<Widget> list() { return List.of(new Widget("sample")); }
 public Widget create(String name) {
  if (name == null) { throw new IllegalArgumentException("NAME_REQUIRED"); }
  return new Widget(name);
 }
}`);writeFileSync(join(base,'interfaces/rest/WidgetController.java'),`package example.interfaces.rest;
import example.application.WidgetService;
@RestController
@RequestMapping("/api/widgets")
public class WidgetController {
 private final WidgetService widgets;
 public WidgetController(WidgetService widgets) { this.widgets=widgets; }
 @GetMapping
 public List<Widget> list() { return widgets.list(); }
 @PostMapping
 public Widget create(@RequestParam String name) { return widgets.create(name); }
}`);return join(root,'source')}
async function listen(app){await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+app.server.address().port}
async function waitForJob(url,id){for(let i=0;i<200;i++){const jobs=await(await fetch(url+'/api/jobs')).json(),job=jobs.find(j=>j.id===id);if(['completed','failed','cancelled'].includes(job.status))return job;await delay(100)}throw Error('Timed out waiting for analysis')}
test('Repository input rejects credential-bearing URLs and invalid roots',()=>{assert.throws(()=>validateRepository('https://user:secret@example.com/repo.git'));assert.throws(()=>validateRepository('https://127.0.0.1/repo'));assert.throws(()=>validateRepository('/'));assert.throws(()=>validateRepository('relative/path'));assert.equal(validateRepository('https://github.com/example/repo.git').type,'git')});
test('New Java repository produces its own ontology, immutable source, reviews and exports',{timeout:30000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'ontology-platform-test-')),source=fixture(root),runtime=join(root,'runtime');let app=createStudio({runtime,noSeed:true}),url=await listen(app);try{
  let response=await fetch(url+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Widget业务',repository:source})});assert.equal(response.status,201);const {project,job}=await response.json(),done=await waitForJob(url,job.id);assert.equal(done.status,'completed',done.error);
  const data=await(await fetch(url+`/api/projects/${project.id}/data`)).json();assert.equal(data.counts.services,1);assert.equal(data.counts.objects,1);assert.equal(data.counts.behaviors,2);assert.equal(data.counts.flows,1);assert.equal(data.counts.queries,1);assert.equal(data.manifest.adapter,'java-spring');assert.ok(data.nodes.some(n=>n.alias==='Widget'));assert.ok(!data.nodes.some(n=>n.context==='payment'));assert.ok(data.manifest.validation.every(c=>c.passed));
  const widget=data.nodes.find(n=>n.alias==='Widget'),snap=data.snapshot.id,evidence=widget.evidence[0];let src=await(await fetch(url+`/api/projects/${project.id}/source?snapshot=${snap}&path=${encodeURIComponent(evidence.path)}&line=${evidence.line}`)).json();assert.equal(src.snapshotSource,true);assert.match(src.code,/public class Widget/);assert.equal(src.modified,false);
  writeFileSync(join(source,'src/main/java/example/domain/model/Widget.java'),'changed after analysis');src=await(await fetch(url+`/api/projects/${project.id}/source?snapshot=${snap}&path=${encodeURIComponent(evidence.path)}`)).json();assert.match(src.code,/public class Widget/);
  response=await fetch(url+`/api/projects/${project.id}/source?path=${encodeURIComponent('../outside.txt')}`);assert.equal(response.status,400);
  response=await fetch(url+`/api/projects/${project.id}/reviews/${encodeURIComponent(widget.id)}?snapshot=${snap}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'confirmed',note:'Reviewed'})});assert.equal(response.status,200);
  response=await fetch(url+`/api/projects/${project.id}/nodes/${encodeURIComponent(widget.id)}?snapshot=${snap}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:'部件',description:'人工确认的业务定义'})});assert.equal(response.status,200);
  const exported=await(await fetch(url+`/api/projects/${project.id}/export?format=json&snapshot=${snap}`)).json();assert.equal(exported.nodes.find(n=>n.id===widget.id).label,'部件');assert.equal(exported.models['m1-object-model.yaml'].aggregates[0].name,'部件');assert.equal(exported.reviews[0].status,'confirmed');
  response=await fetch(url+`/api/projects/${project.id}/export?format=yaml&file=m1-object-model.yaml&snapshot=${snap}`);assert.equal(response.status,200);assert.equal(JSON.parse(await response.text()).aggregates[0].name,'部件');
  const offline=await(await fetch(url+`/api/projects/${project.id}/export?format=html`)).text();assert.ok(offline.includes('Widget业务'));assert.ok(!offline.includes('__ONTOLOGY_DATA__'));
  response=await fetch(url+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:'{}'});assert.equal(response.status,403);
  await app.close();app=createStudio({runtime,noSeed:true});url=await listen(app);const persisted=await(await fetch(url+`/api/projects/${project.id}/data`)).json();assert.equal(persisted.nodes.find(n=>n.id===widget.id).label,'部件');assert.equal(persisted.reviews[0].status,'confirmed');
 }finally{await app.close();rmSync(root,{recursive:true,force:true})}
});
test('Unsupported repositories fail explicitly instead of returning fake models',{timeout:15000},async()=>{const root=mkdtempSync(join(tmpdir(),'ontology-unsupported-')),source=join(root,'source');mkdirSync(source);writeFileSync(join(source,'index.js'),'console.log("hello")');const app=createStudio({runtime:join(root,'runtime'),noSeed:true}),url=await listen(app);try{const p=await(await fetch(url+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'JS repo',repository:source})})).json(),job=await waitForJob(url,p.job.id);assert.equal(job.status,'failed');assert.match(job.error,/Java/);assert.equal((await fetch(url+`/api/projects/${p.project.id}/data`)).status,404)}finally{await app.close();rmSync(root,{recursive:true,force:true})}});
test('Evidence assistant returns traceable local model references',()=>{const data={contexts:{payment:'支付'},nodes:[{id:'flow-one',model:'M6',context:'payment',label:'支付流程'}],edges:[]},r=retrieve(data,'支付有哪些流程');assert.equal(r.top[0].id,'flow-one');assert.match(r.text,/本地语义注册表/)});

test('Running and queued analysis can be cancelled without creating a snapshot',{timeout:15000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'ontology-cancel-')),source=fixture(root),stub=join(root,'slow-analyzer');writeFileSync(stub,'#!/usr/bin/env node\nsetInterval(()=>{},1000);\n');chmodSync(stub,0o755);const app=createStudio({runtime:join(root,'runtime'),noSeed:true,python:stub}),url=await listen(app);try{
  const first=await(await fetch(url+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Slow',repository:source})})).json();const queued=app.store.createJob(first.project.id);assert.equal((await fetch(url+'/api/jobs/'+queued.id+'/cancel',{method:'POST'})).status,200);assert.equal(app.store.job(queued.id).status,'cancelled');assert.equal((await fetch(url+'/api/jobs/'+first.job.id+'/cancel',{method:'POST'})).status,200);assert.equal((await waitForJob(url,first.job.id)).status,'cancelled');assert.equal(app.store.snapshots(first.project.id).length,0);
 }finally{await app.close();rmSync(root,{recursive:true,force:true})}
});

test('Deleting tasks cleans snapshots, reviews, overrides and files while preserving source and fallback',{timeout:30000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'ontology-delete-')),source=fixture(root),runtime=join(root,'runtime');const app=createStudio({runtime,noSeed:true}),url=await listen(app);
 const request=(path,method='GET',body)=>fetch(url+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try{
  const created=await(await request('/api/projects','POST',{name:'删除测试',repository:source})).json(),project=created.project;
  assert.equal((await waitForJob(url,created.job.id)).status,'completed');
  const first=await(await request(`/api/projects/${project.id}/data`)).json();
  const node=first.nodes.find(n=>n.model==='M1');
  await request(`/api/projects/${project.id}/reviews/${node.id}`,'PUT',{status:'confirmed',note:'保留的评审'});
  await request(`/api/projects/${project.id}/nodes/${node.id}`,'PATCH',{label:'保留的修订'});
  const next=await(await request(`/api/projects/${project.id}/analyze`,'POST')).json();assert.equal((await waitForJob(url,next.id)).status,'completed');
  const second=await(await request(`/api/projects/${project.id}/data`)).json();
  await request(`/api/projects/${project.id}/reviews/${node.id}`,'PUT',{status:'confirmed',note:'删除的评审'});
  await request(`/api/projects/${project.id}/nodes/${node.id}`,'PATCH',{label:'删除的修订'});
  const original=readFileSync(join(source,'src/main/java/example/domain/model/Widget.java'),'utf8');
  let response=await request('/api/jobs/'+next.id,'DELETE');assert.equal(response.status,200);const result=await response.json();assert.equal(result.cleanupPending,false);assert.equal(result.activeSnapshot,first.snapshot.id);
  assert.equal(existsSync(join(runtime,'runs',next.id)),false);assert.equal(existsSync(join(runtime,'.job-cleanup',next.id)),false);
  assert.equal(app.store.job(next.id),null);assert.equal(app.store.one('SELECT count(*) n FROM reviews WHERE snapshot_id=?',second.snapshot.id).n,0);assert.equal(app.store.one('SELECT count(*) n FROM overrides WHERE snapshot_id=?',second.snapshot.id).n,0);
  assert.equal((await request(`/api/projects/${project.id}/data?snapshot=${second.snapshot.id}`)).status,404);
  const fallback=await(await request(`/api/projects/${project.id}/data`)).json();assert.equal(fallback.nodes.find(n=>n.id===node.id).label,'保留的修订');assert.equal(fallback.reviews[0].note,'保留的评审');
  assert.equal((await request('/api/jobs/'+next.id,'DELETE')).status,404);
  const keep=app.store.createJob(project.id);app.store.run("UPDATE jobs SET status='cancelled' WHERE id=?",keep.id);response=await request('/api/jobs/'+created.job.id,'DELETE');assert.equal(response.status,200);assert.equal((await response.json()).activeSnapshot,null);assert.equal((await request(`/api/projects/${project.id}/data`)).status,404);assert.ok(app.store.project(project.id));assert.equal(readFileSync(join(source,'src/main/java/example/domain/model/Widget.java'),'utf8'),original);
  const queued=app.store.createJob(project.id);mkdirSync(join(runtime,'runs',queued.id),{recursive:true});writeFileSync(join(runtime,'runs',queued.id,'partial.log'),'partial');assert.equal((await request('/api/jobs/'+queued.id,'DELETE')).status,200);assert.equal(existsSync(join(runtime,'runs',queued.id)),false);
  const failed=app.store.createJob(project.id);app.store.run("UPDATE jobs SET status='failed' WHERE id=?",failed.id);assert.equal((await request('/api/jobs/'+failed.id,'DELETE')).status,200);
  const cancelled=app.store.createJob(project.id);app.store.run("UPDATE jobs SET status='cancelled' WHERE id=?",cancelled.id);assert.equal((await request('/api/jobs/'+cancelled.id,'DELETE')).status,200);
  const running=app.store.createJob(project.id);app.store.run("UPDATE jobs SET status='running' WHERE id=?",running.id);assert.equal((await request('/api/jobs/'+running.id,'DELETE')).status,409);assert.ok(app.store.job(running.id));app.store.run("UPDATE jobs SET status='cancelled' WHERE id=?",running.id);await request('/api/jobs/'+running.id,'DELETE');const final=await(await request('/api/jobs/'+keep.id,'DELETE')).json();assert.equal(final.projectRemoved,true);assert.equal(app.store.project(project.id),undefined);
 }finally{await app.close();rmSync(root,{recursive:true,force:true})}
});
test('Interrupted task deletion restores uncommitted files and retries committed cleanup',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ontology-cleanup-recovery-')),app=createStudio({runtime:root,noSeed:true});
 try{
  const project=app.store.createProject('恢复测试',root),job=app.store.createJob(project.id);
  const original=join(root,'runs',job.id),staged=join(root,'.job-cleanup',job.id);mkdirSync(original,{recursive:true});mkdirSync(join(root,'.job-cleanup'),{recursive:true});writeFileSync(join(original,'evidence.txt'),'keep');
  app.store.run("INSERT INTO job_cleanup VALUES(?,'staging')",job.id);renameSync(original,staged);new JobDeletion(app.store,root,new Map());assert.equal(readFileSync(join(original,'evidence.txt'),'utf8'),'keep');assert.ok(app.store.job(job.id));
  renameSync(original,staged);app.store.run('DELETE FROM jobs WHERE id=?',job.id);app.store.run("INSERT INTO job_cleanup VALUES(?,'committed')",job.id);const cleanup=new JobDeletion(app.store,root,new Map());assert.equal(existsSync(staged),false);assert.equal(cleanup.pending().length,0);
 }finally{await app.close();rmSync(root,{recursive:true,force:true})}
});

test('New source inventory, quality and version comparison work end-to-end',{timeout:30000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'ontology-insights-')),source=fixture(root),app=createStudio({runtime:join(root,'runtime'),noSeed:true}),url=await listen(app);
 const request=(path,method='GET',body)=>fetch(url+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try{
  writeFileSync(join(source,'frontend.ts'),'// not deep-analyzed');
  const p=await(await request('/api/projects','POST',{name:'版本对比验收',repository:source})).json();assert.equal((await waitForJob(url,p.job.id)).status,'completed');
  const first=await(await request(`/api/projects/${p.project.id}/data`)).json();assert.equal(first.quality.scanKnown,true);assert.equal(first.manifest.scanInventory.languages.TypeScript,1);assert.equal(first.quality.modules[0].entityCandidates,1);assert.equal(first.quality.modules[0].objectMatches,1);assert.equal(first.quality.modules[0].endpointMatches,2);assert.match(first.manifest.source_fingerprint,/^[a-f0-9]{64}$/);
  const file=join(source,'src/main/java/example/domain/model/Widget.java');writeFileSync(file,readFileSync(file,'utf8').replace('private String name;','private String name;\n private String category;'));
  const job=await(await request(`/api/projects/${p.project.id}/analyze`,'POST')).json();assert.equal((await waitForJob(url,job.id)).status,'completed');const second=await(await request(`/api/projects/${p.project.id}/data`)).json();assert.notEqual(second.manifest.source_fingerprint,first.manifest.source_fingerprint);
  const query=`/api/projects/${p.project.id}/compare?from=${first.snapshot.id}&to=${second.snapshot.id}`;
  let response=await request(query);assert.equal(response.status,200);let diff=await response.json();assert.ok(diff.changes.some(n=>n.model==='M1'&&n.fields.some(f=>f.path.includes('category'))));
  response=await request(query+'&download=1');assert.match(response.headers.get('content-disposition'),/ontology-diff.json/);
  const node=second.nodes.find(n=>n.model==='M1');await request(`/api/projects/${p.project.id}/nodes/${node.id}`,'PATCH',{label:'人工修订名称'});const raw=await(await request(query+'&mode=source')).json(),effective=await(await request(query+'&mode=effective')).json();assert.ok(!raw.changes.find(n=>n.id===node.id).fields.some(f=>f.path==='label'));assert.ok(effective.changes.find(n=>n.id===node.id).fields.some(f=>f.path==='label'));
  const foreign=app.store.createProject('其他项目',source);assert.equal((await request(`/api/projects/${foreign.id}/compare?from=${first.snapshot.id}&to=${second.snapshot.id}`)).status,404);assert.equal((await request(query+'&mode=invalid')).status,400);assert.equal((await request(`/api/projects/${p.project.id}/compare`)).status,400);
  assert.equal((await request(`/api/projects/${p.project.id}/quality?snapshot=${first.snapshot.id}`)).status,200);
  assert.equal((await request(`/api/projects/${p.project.id}/source?snapshot=${first.snapshot.id}&path=${encodeURIComponent(node.evidence[0].path)}`)).status,200);
 }finally{await app.close();rmSync(root,{recursive:true,force:true})}
});

test('Empty project cleanup removes managed clones, protects local source and rejects nonempty projects',{timeout:15000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'ontology-empty-project-')),runtime=join(root,'runtime'),source=fixture(root);let app=createStudio({runtime,noSeed:true}),url=await listen(app);
 const remove=id=>fetch(url+'/api/projects/'+id,{method:'DELETE'});
 try{
  const local=app.store.createProject('空本地项目',source);assert.equal((await remove(local.id)).status,200);assert.ok(existsSync(join(source,'src/main/java/example/domain/model/Widget.java')));
  const clone=join(runtime,'repos','checkout_0123456789abcdef');mkdirSync(clone,{recursive:true});writeFileSync(join(clone,'partial.txt'),'owned clone');
  const remote=app.store.createProject('空远程项目',clone,'git','https://example.com/repo.git');const job=app.store.createJob(remote.id);app.store.run("UPDATE jobs SET status='cancelled' WHERE id=?",job.id);
  assert.equal((await remove(remote.id)).status,409);assert.ok(existsSync(clone));
  const deletion=await(await fetch(url+'/api/jobs/'+job.id,{method:'DELETE'})).json();assert.equal(deletion.projectRemoved,true);assert.equal(existsSync(clone),false);assert.equal(app.store.project(remote.id),undefined);
  const outside=app.store.createProject('外部副本',source,'git','https://example.com/repo.git');assert.equal((await remove(outside.id)).status,400);assert.ok(existsSync(source));app.store.run('DELETE FROM projects WHERE id=?',outside.id);
  assert.equal(app.store.projects().length,0);await app.close();app=createStudio({runtime});url=await listen(app);assert.equal(app.store.projects().length,0,'Deleted projects must not trigger baseline reseeding');
 }finally{await app.close();rmSync(root,{recursive:true,force:true})}
});

test('Knowledge directory generates seven-model drafts with immutable document evidence and source-aware lifecycle',{timeout:30000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'ontology-documents-')),source=join(root,'knowledge');mkdirSync(source);mkdirSync(join(source,'.hidden'));writeFileSync(join(source,'.hidden','secret.md'),'业务对象：不应读取');
 writeFileSync(join(source,'requirements.md'),`# 合同业务需求
## M1 对象
| 对象 | 分类 |
|---|---|
| 合同 | 核心业务对象 |
## M2 行为
| 行为 | 类型 | 主对象 |
|---|---|---|
| FUNC-01 保存合同 | COMMAND | 合同 |
## M3 规则
| 规则 | 判断 |
|---|---|
| R-01 合同金额校验 | 金额大于零 |
## M5 角色
| 角色 | 授权行为 |
|---|---|
| ROLE-01 客户经理 | FUNC-01 |
## M6 流程
| 流程 | 核心活动 |
|---|---|
| PROC-01 合同审批 | FUNC-01 后提交审批 |
## M7 查询报表
| REP | 条件 | 唯一 Q |
|---|---|---|
| REP-01 合同查询 | 合同编号 | Q-01 |
## MU 界面
| 页面 | 操作 |
|---|---|
| 合同工作台 | FUNC-01 |
`);
 writeFileSync(join(source,'rules.html'),'<html><style>业务对象：错误样式</style><script>业务对象：错误脚本</script><body><h1>其他业务知识</h1><p>业务对象：开票</p></body></html>');
 writeFileSync(join(source,'scan.pdf'),'not a supported document');
 const app=createStudio({runtime:join(root,'runtime'),noSeed:true}),url=await listen(app);try{
  const post=body=>fetch(url+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const response=await post({name:'合同知识',repository:source,sourceType:'documents'});assert.equal(response.status,201);const {project,job}=await response.json();assert.equal(project.source_type,'documents');const done=await waitForJob(url,job.id);assert.equal(done.status,'completed',done.error);
  const data=await(await fetch(`${url}/api/projects/${project.id}/data`)).json();assert.equal(data.manifest.adapter,'document-directory');assert.equal(data.manifest.complete,false);assert.equal(Object.keys(data.models).length,7);for(const type of ['M1','M2','M3','M5','M6','M7','MU'])assert.ok(data.nodes.some(n=>n.model===type),type);
  assert.ok(!data.nodes.some(n=>/错误|不应读取/.test(n.label)));assert.equal(data.manifest.documentInventory.unsupported['.pdf'],1);assert.ok(data.manifest.validation.every(c=>c.passed));assert.equal(data.quality.adapter,'document-directory');assert.ok(data.quality.issues.some(i=>i.code==='FORMAT_UNSUPPORTED'));
  const object=data.nodes.find(n=>n.model==='M1'&&n.label==='合同'),e=object.evidence[0];writeFileSync(join(source,'requirements.md'),'source changed');const evidence=await(await fetch(`${url}/api/projects/${project.id}/source?path=${encodeURIComponent(e.path)}&line=${e.line}`)).json();assert.equal(evidence.snapshotSource,true);assert.match(evidence.code,/合同业务需求/);assert.equal(evidence.modified,false);
  const contract=data.nodes.find(n=>n.model==='M7'),behavior=data.nodes.find(n=>n.id===contract.behaviorRef);assert.equal(behavior.queryReportRef,contract.id);assert.equal(behavior.confidence,'DERIVED_REVIEW_REQUIRED');assert.equal(data.nodes.find(n=>n.model==='M6').activities.length,0);
  const html=await(await fetch(`${url}/api/projects/${project.id}/export?format=html`)).text();assert.match(html,/合同知识/);
  const same=await(await post({name:'重复知识',repository:source,sourceType:'documents'})).json();assert.equal(same.duplicate,true);assert.equal(same.project.id,project.id);
  const dirs=await(await fetch(`${url}/api/directories?path=${encodeURIComponent(source)}`)).json();assert.equal(dirs.path,realpathSync(source));assert.ok(!dirs.directories.some(d=>d.name==='.hidden'));
  const code=await(await post({name:'相同目录代码模式',repository:source,sourceType:'local',analyze:false})).json();assert.notEqual(code.project.id,project.id);
  const deleted=await(await fetch(`${url}/api/jobs/${job.id}`,{method:'DELETE'})).json();assert.equal(deleted.projectRemoved,true);assert.equal(readFileSync(join(source,'requirements.md'),'utf8'),'source changed');
 }finally{await app.close();rmSync(root,{recursive:true,force:true})}
});
test('Unstructured and unsupported knowledge inputs fail explicitly without invented models',{timeout:15000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'ontology-doc-empty-')),source=join(root,'knowledge');mkdirSync(source);writeFileSync(join(source,'notes.txt'),'今天讨论了系统需求，尚未明确对象和业务规则。');const app=createStudio({runtime:join(root,'runtime'),noSeed:true}),url=await listen(app);try{
  const post=body=>fetch(url+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({name:'错误类型',repository:source,sourceType:'invalid'})).status,400);
  assert.equal((await post({name:'远程文档',repository:'https://github.com/example/repo.git',sourceType:'documents'})).status,400);
  const {project,job}=await(await post({name:'未结构化知识',repository:source,sourceType:'documents'})).json();const done=await waitForJob(url,job.id);assert.equal(done.status,'failed');assert.match(done.error,/未发现明确|未发现明确的业务模型/);assert.equal((await fetch(`${url}/api/projects/${project.id}/data`)).status,404);
 }finally{await app.close();rmSync(root,{recursive:true,force:true})}
});

test('Pure knowledge directories auto-route and old code-typed projects recover on retry',{timeout:20000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'ontology-routing-')),source=join(root,'knowledge');mkdirSync(source);writeFileSync(join(source,'需求.md'),`# 业务定义
## 上下文
| # | 上下文 | 聚合根 | 服务 |
|---|---|---|---|
| 1 | 客户 | Customer | customer-service |
## 功能清单
| 编号 | 功能 | 优先级 |
|---|---|---|
| F-001-01 | 创建客户 | P0 |
## 业务规则
| 规则 | 规则描述 |
|---|---|
| BR-CUST-01 | 客户编号必须保留前导零 |
## API目录
| 方法路径 | 说明 |
|---|---|
| GET /api/customers/{id} | 查询客户；BR-CUST-01 |
`);
 const app=createStudio({runtime:join(root,'runtime'),noSeed:true}),url=await listen(app);try{
  const inspected=await(await fetch(url+'/api/input/inspect?path='+encodeURIComponent(source))).json();assert.equal(inspected.suggestedType,'documents');assert.equal(inspected.javaFiles,0);assert.equal(inspected.documentFiles,1);
  const post=body=>fetch(url+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const old=await(await post({name:'旧入口误分类',repository:source,sourceType:'local',analyze:false})).json();assert.equal(old.project.source_type,'local');
  const response=await fetch(`${url}/api/projects/${old.project.id}/analyze`,{method:'POST'});assert.equal(response.status,202);const job=await response.json(),done=await waitForJob(url,job.id);assert.equal(done.status,'completed',done.error);assert.ok(done.events.some(e=>e.stage==='识别知识目录'));assert.equal(app.store.project(old.project.id).source_type,'documents');
  const data=await(await fetch(`${url}/api/projects/${old.project.id}/data`)).json();assert.ok(data.nodes.some(n=>n.model==='M1'&&n.alias==='Customer'));assert.ok(data.nodes.some(n=>n.model==='M2'&&n.documentId==='F-001-01'));const rule=data.nodes.find(n=>n.documentId==='BR-CUST-01');assert.equal(rule.model,'M3');assert.ok(data.edges.some(e=>e.target===rule.id&&e.label==='文档引用（非执行关系）'));
  const q=data.nodes.find(n=>n.model==='M7'),b=data.nodes.find(n=>n.id===q.behaviorRef);assert.equal(b.endpoint.method,'GET');assert.equal(b.queryReportRef,q.id);assert.ok(!b.derivedFrom);assert.ok(data.manifest.validation.every(c=>c.passed));
  const again=await(await post({name:'自动接入知识',repository:source,sourceType:'auto'})).json();assert.equal(again.duplicate,true);assert.equal(again.project.id,old.project.id);
  const other=join(root,'other');mkdirSync(other);writeFileSync(join(other,'知识.txt'),'业务对象：账户');const fresh=await(await post({name:'未指定输入类型',repository:other})).json();assert.equal(fresh.project.source_type,'documents');assert.equal((await waitForJob(url,fresh.job.id)).status,'completed');
 }finally{await app.close();rmSync(root,{recursive:true,force:true})}
});
test('Mixed inputs prefer Java in auto mode and preserve existing snapshot source type',{timeout:20000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'ontology-mixed-')),source=fixture(root);writeFileSync(join(source,'requirements.md'),'业务对象：部件');const app=createStudio({runtime:join(root,'runtime'),noSeed:true}),url=await listen(app);try{
  const post=body=>fetch(url+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const input=await(await fetch(url+'/api/input/inspect?path='+encodeURIComponent(source))).json();assert.equal(input.suggestedType,'local');assert.ok(input.javaFiles>0);
  const code=await(await post({name:'代码优先',repository:source,sourceType:'auto'})).json();assert.equal(code.project.source_type,'local');assert.equal((await waitForJob(url,code.job.id)).status,'completed');
  const response=await fetch(`${url}/api/projects/${code.project.id}/analyze`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceType:'documents'})});assert.equal(response.status,409);assert.equal(app.store.project(code.project.id).source_type,'local');
  const docs=await(await post({name:'显式文档模式',repository:source,sourceType:'documents'})).json();assert.equal(docs.project.source_type,'documents');assert.notEqual(docs.project.id,code.project.id);assert.equal((await waitForJob(url,docs.job.id)).status,'completed');
 }finally{await app.close();rmSync(root,{recursive:true,force:true})}
});
