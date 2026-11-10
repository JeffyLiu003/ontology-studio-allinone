import {semanticModel} from './semantic.mjs';
import {writeFileSync,existsSync,readFileSync} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname,resolve,relative,isAbsolute,sep } from 'node:path';
import { randomUUID } from 'node:crypto';
export const uid = prefix => `${prefix}_${randomUUID().replaceAll('-','').slice(0,16)}`;
export class Store {
  constructor(filename){this.runtime=resolve(dirname(filename));mkdirSync(dirname(filename),{recursive:true});this.db=new DatabaseSync(filename);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL,source_type TEXT NOT NULL,repo_url TEXT,created_at TEXT NOT NULL,active_snapshot TEXT);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),status TEXT NOT NULL,stage TEXT NOT NULL,progress INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,started_at TEXT,finished_at TEXT,error TEXT,events TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),job_id TEXT,filename TEXT NOT NULL,summary TEXT NOT NULL,commit_sha TEXT,kind TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews(snapshot_id TEXT NOT NULL REFERENCES snapshots(id),node_id TEXT NOT NULL,status TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,PRIMARY KEY(snapshot_id,node_id));
  `);let previousRoot;try{previousRoot=JSON.parse(readFileSync(resolve(this.runtime,'service.json'),'utf8')).runtime}catch{}for(const row of this.db.prepare('SELECT id,filename FROM snapshots').all()){let portable=isAbsolute(row.filename)?this.portable(row.filename):row.filename;if(isAbsolute(portable)&&previousRoot&&row.filename.startsWith(previousRoot+sep)){const candidate=relative(previousRoot,row.filename);if(existsSync(resolve(this.runtime,candidate)))portable=candidate;}if(isAbsolute(portable)){const match=row.filename.replaceAll('\\','/').match(/\/(runs\/job_[a-f0-9]{16}\/.*|snapshots\/[^/]+|ai\/ai_[a-f0-9]{16}\/.*)$/);if(match&&existsSync(resolve(this.runtime,match[1]))&&(!existsSync(row.filename)||readFileSync(row.filename).equals(readFileSync(resolve(this.runtime,match[1])))))portable=match[1];}if(portable!==row.filename)this.db.prepare('UPDATE snapshots SET filename=? WHERE id=?').run(portable,row.id)}}
  all(sql,...p){return this.db.prepare(sql).all(...p).map(row=>this.hydrate(row))}
  one(sql,...p){return this.hydrate(this.db.prepare(sql).get(...p))}
  hydrate(row){if(row&&typeof row.filename==='string'&&!isAbsolute(row.filename))row.filename=resolve(this.runtime,row.filename);return row}
  run(sql,...p){return this.db.prepare(sql).run(...p)}
  project(id){return this.one('SELECT * FROM projects WHERE id=?',id)}
  projects(){return this.all('SELECT * FROM projects ORDER BY created_at DESC')}
  snapshots(project){return this.all('SELECT * FROM snapshots WHERE project_id=? ORDER BY created_at DESC',project).map(s=>({...s,summary:JSON.parse(s.summary)}))}
  jobs(){return this.all('SELECT j.*,p.name project_name,s.id snapshot_id FROM jobs j JOIN projects p ON j.project_id=p.id LEFT JOIN snapshots s ON s.id=(SELECT id FROM snapshots WHERE job_id=j.id ORDER BY created_at DESC,rowid DESC LIMIT 1) ORDER BY j.created_at DESC LIMIT 100').map(j=>({...j,events:JSON.parse(j.events)}))}
  job(id){const j=this.one('SELECT * FROM jobs WHERE id=?',id);return j?{...j,events:JSON.parse(j.events)}:null}
  event(id,stage,message,progress){const j=this.job(id);if(!j)return;const events=[...j.events,{time:new Date().toISOString(),stage,message}].slice(-160);this.run('UPDATE jobs SET stage=?,progress=?,events=? WHERE id=?',stage,progress,JSON.stringify(events),id)}
  createProject(name,path,source_type='local',repo_url=null){const id=uid('repo');this.run('INSERT INTO projects VALUES(?,?,?,?,?,?,NULL)',id,name,path,source_type,repo_url,new Date().toISOString());return this.project(id)}
  createJob(project){const id=uid('job');this.run('INSERT INTO jobs(id,project_id,status,stage,progress,created_at) VALUES(?,?,?,?,?,?)',id,project,'queued','等待分析',0,new Date().toISOString());return this.job(id)}
  snapshot(project,filename,data,kind='analysis',job=null){const id=uid('snapshot');data.semantic=semanticModel({...data,project:this.project(project),snapshot:{id}});writeFileSync(filename,JSON.stringify(data));const summary={counts:data.counts,nodes:data.nodes.length,edges:data.edges.length,contexts:Object.keys(data.contexts),checks:data.manifest.validation||[],coverage:data.coverage||[],lineage: data.models?.['m7-report-model.yaml']?.query_reports?.reduce((a,q)=>{for(const c of q.resultColumns||[])a[c.mappingStatus||'unknown']=(a[c.mappingStatus||'unknown']||0)+1;return a},{})||{}};this.run('INSERT INTO snapshots VALUES(?,?,?,?,?,?,?,?)',id,project,job,this.portable(filename),JSON.stringify(summary),data.manifest.source_commit||'',kind,new Date().toISOString());this.run('UPDATE projects SET active_snapshot=? WHERE id=?',id,project);return id}
  portable(filename){const rel=relative(this.runtime,resolve(filename));return !rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)?rel:filename}
  close(){this.db.close()}
}
