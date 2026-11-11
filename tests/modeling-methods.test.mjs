import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createStudio} from '../server/index.mjs';
import {Store} from '../server/store.mjs';

test('Methods isolate identical inputs, snapshots, new document models and exports',{timeout:30000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'ontology-methods-')),source=join(root,'docs');mkdirSync(source);
 writeFileSync(join(source,'business.md'),'# 测试项目\n业务对象：合同\n事件：收款已登记\n场景：收款驱动合同关闭\n数据映射：合同主表映射\n接口：查询合同接口\n');
 const app=createStudio({runtime:join(root,'runtime'),noSeed:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+app.server.address().port;
 const call=async(path,body)=>{const r=await fetch(url+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});return {status:r.status,data:await r.json()}};
 try{
  const seven=(await call('/api/projects',{name:'七',repository:source,sourceType:'documents',modelingMethod:'seven',analyze:false})).data.project;
  const nine=(await call('/api/projects',{name:'九',repository:source,sourceType:'documents',modelingMethod:'nine',analyze:false})).data.project;
  assert.notEqual(seven.id,nine.id);
  assert.equal((await call('/api/projects',{name:'九',repository:source,sourceType:'documents',modelingMethod:'nine',analyze:false})).data.project.id,nine.id);
  assert.equal((await call('/api/bootstrap?method=seven')).data.projects.length,1);assert.equal((await call('/api/bootstrap?method=nine')).data.projects[0].id,nine.id);
  assert.equal((await call('/api/projects/'+seven.id+'?method=nine')).status,409);
  assert.equal((await call('/api/projects',{name:'bad',repository:source,modelingMethod:'bad'})).status,400);
  await call('/api/projects/'+nine.id+'/analyze?method=nine',{});
  for(let i=0;i<200&&app.store.jobs().some(j=>['queued','running'].includes(j.status));i++)await delay(40);
  assert.equal(app.store.jobs()[0].status,'completed',app.store.jobs()[0].error);
  const d=(await call('/api/projects/'+nine.id+'/data?method=nine')).data;
  assert.equal(Object.keys(d.models).length,11);
  for(const type of ['ME','M4','MM','MI'])assert.ok(d.nodes.some(n=>n.model===type),type);
  assert.ok(d.models['me-event-model.yaml'].events[0].evidence[0].sha256);
  assert.ok(d.semantic.entities.some(e=>e.type==='ME'));
  const exported=await call('/api/projects/'+nine.id+'/export?format=yaml&file=m4-scenario-model.yaml');assert.equal(exported.data.model_type,'SCENARIO');assert.equal(exported.data.event_scenarios.length,1);
  const snap=d.snapshot.id;assert.equal((await call('/api/projects/'+seven.id+'/data?snapshot='+snap)).status,404);
 }finally{await app.close();rmSync(root,{recursive:true,force:true})}
});

test('Old project schema migrates to seven and method is immutable on retrieval',()=>{
 const root=mkdtempSync(join(tmpdir(),'ontology-migration-'));
 const store=new Store(join(root,'db.sqlite'));try{const p=store.createProject('既有','/tmp');assert.equal(p.modeling_method,'seven');assert.throws(()=>store.createProject('无效','/tmp','local',null,'bad'));}finally{store.close();rmSync(root,{recursive:true,force:true})}
});

test('Legacy nine projects migrate to eleven without changing IDs or snapshot relationships',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const root=mkdtempSync(join(tmpdir(),'ontology-eleven-')),file=join(root,'db.sqlite');
 const raw=new DatabaseSync(file);raw.exec("CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL,source_type TEXT NOT NULL,repo_url TEXT,created_at TEXT NOT NULL,active_snapshot TEXT,modeling_method TEXT NOT NULL DEFAULT 'seven' CHECK(modeling_method IN ('seven','nine')));INSERT INTO projects VALUES('old-nine','原九模型','/tmp','local',NULL,'2026-11-11',NULL,'nine');");raw.close();
 let store=new Store(file);try{assert.equal(store.project('old-nine').modeling_method,'eleven');assert.equal(store.createProject('新的十一模型','/tmp','local',null,'eleven').modeling_method,'eleven');assert.equal(store.createProject('兼容旧API','/tmp','local',null,'nine').modeling_method,'eleven');}finally{store.close()}
 store=new Store(file);try{assert.equal(store.project('old-nine').modeling_method,'eleven');assert.equal(store.projects().length,3)}finally{store.close();rmSync(root,{recursive:true,force:true})}
});
