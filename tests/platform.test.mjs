import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createStudio, validateRepository } from '../server/index.mjs';
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
