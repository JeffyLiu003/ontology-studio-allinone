import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export const uid = prefix => `${prefix}_${randomUUID().replaceAll('-','').slice(0,16)}`;
export class Store {
  constructor(filename){mkdirSync(dirname(filename),{recursive:true});this.db=new DatabaseSync(filename);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL,source_type TEXT NOT NULL,repo_url TEXT,created_at TEXT NOT NULL,active_snapshot TEXT);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),status TEXT NOT NULL,stage TEXT NOT NULL,progress INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,started_at TEXT,finished_at TEXT,error TEXT,events TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),job_id TEXT,filename TEXT NOT NULL,summary TEXT NOT NULL,commit_sha TEXT,kind TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews(snapshot_id TEXT NOT NULL REFERENCES snapshots(id),node_id TEXT NOT NULL,status TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,PRIMARY KEY(snapshot_id,node_id));
  `);}
  all(sql,...p){return this.db.prepare(sql).all(...p)}
  one(sql,...p){return this.db.prepare(sql).get(...p)}
  run(sql,...p){return this.db.prepare(sql).run(...p)}
  project(id){return this.one('SELECT * FROM projects WHERE id=?',id)}
  projects(){return this.all('SELECT * FROM projects ORDER BY created_at DESC')}
  snapshots(project){return this.all('SELECT * FROM snapshots WHERE project_id=? ORDER BY created_at DESC',project).map(s=>({...s,summary:JSON.parse(s.summary)}))}
  jobs(){return this.all('SELECT j.*,p.name project_name FROM jobs j JOIN projects p ON j.project_id=p.id ORDER BY j.created_at DESC LIMIT 100').map(j=>({...j,events:JSON.parse(j.events)}))}
  job(id){const j=this.one('SELECT * FROM jobs WHERE id=?',id);return j?{...j,events:JSON.parse(j.events)}:null}
  event(id,stage,message,progress){const j=this.job(id);if(!j)return;const events=[...j.events,{time:new Date().toISOString(),stage,message}].slice(-160);this.run('UPDATE jobs SET stage=?,progress=?,events=? WHERE id=?',stage,progress,JSON.stringify(events),id)}
  createProject(name,path,source_type='local',repo_url=null){const id=uid('repo');this.run('INSERT INTO projects VALUES(?,?,?,?,?,?,NULL)',id,name,path,source_type,repo_url,new Date().toISOString());return this.project(id)}
  createJob(project){const id=uid('job');this.run('INSERT INTO jobs(id,project_id,status,stage,progress,created_at) VALUES(?,?,?,?,?,?)',id,project,'queued','等待分析',0,new Date().toISOString());return this.job(id)}
  snapshot(project,filename,data,kind='analysis',job=null){const id=uid('snapshot');const summary={counts:data.counts,nodes:data.nodes.length,edges:data.edges.length,contexts:Object.keys(data.contexts),checks:data.manifest.validation||[],coverage:data.coverage||[],lineage: data.models?.['m7-report-model.yaml']?.query_reports?.reduce((a,q)=>{for(const c of q.resultColumns||[])a[c.mappingStatus||'unknown']=(a[c.mappingStatus||'unknown']||0)+1;return a},{})||{}};this.run('INSERT INTO snapshots VALUES(?,?,?,?,?,?,?,?)',id,project,job,filename,JSON.stringify(summary),data.manifest.source_commit||'',kind,new Date().toISOString());this.run('UPDATE projects SET active_snapshot=? WHERE id=?',id,project);return id}
  close(){this.db.close()}
}
