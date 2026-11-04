import { existsSync, mkdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// The durable journal bridges SQLite transactions and filesystem operations.
// A restart restores uncommitted deletions or completes committed file cleanup.
export class JobDeletion {
 constructor(store, runtime, cache, onEmptyProject=null) {
  this.store=store;this.runtime=realpathSync(runtime);this.cache=cache;this.onEmptyProject=onEmptyProject;
  store.db.exec("CREATE TABLE IF NOT EXISTS job_cleanup(job_id TEXT PRIMARY KEY,phase TEXT NOT NULL)");
  this.recover();
 }
 paths(id) {
  if(!/^job_[a-f0-9]{16}$/.test(id))throw Error('无效任务标识');
  const runs=join(this.runtime,'runs'),staging=join(this.runtime,'.job-cleanup');
  for(const dir of [runs,staging]){
   mkdirSync(dir,{recursive:true});
   if(realpathSync(dir)!==dir)throw Error('任务清理目录不能是符号链接');
  }
  return {original:join(runs,id),staged:join(staging,id)};
 }
 recover() {
  for(const item of this.store.all('SELECT * FROM job_cleanup')){
   try {
    const {original,staged}=this.paths(item.job_id);
    if(this.store.job(item.job_id)){
     if(existsSync(staged)){
      if(existsSync(original))continue; // Preserve both rather than deleting ambiguous inputs.
      renameSync(staged,original);
     }
    }else rmSync(staged,{recursive:true,force:true});
    this.store.run('DELETE FROM job_cleanup WHERE job_id=?',item.job_id);
   }catch{/* Keep the journal entry for the next retry. */}
  }
  return this.pending();
 }
 pending(){return this.store.all('SELECT job_id,phase FROM job_cleanup');}
 remove(id,runner) {
  const job=this.store.job(id);
  if(!job)throw Object.assign(Error('任务不存在或已删除'),{status:404});
  if(job.status==='running'||runner.active?.id===id)throw Object.assign(Error('请先取消任务，待进程停止后再删除。'),{status:409});
  const snapshots=this.store.all('SELECT id FROM snapshots WHERE job_id=?',id);
  const {original,staged}=this.paths(id);
  if(existsSync(staged))throw Object.assign(Error('此任务有待恢复的清理操作，请先重试文件清理。'),{status:409});
  this.store.run("INSERT INTO job_cleanup VALUES(?,'staging')",id);
  let committed=false;
  try {
   if(existsSync(original))renameSync(original,staged);
   this.store.db.exec('BEGIN IMMEDIATE');
   try {
    for(const s of snapshots){
     this.store.run('DELETE FROM reviews WHERE snapshot_id=?',s.id);
     this.store.run('DELETE FROM overrides WHERE snapshot_id=?',s.id);
     this.store.run('DELETE FROM snapshots WHERE id=?',s.id);
    }
    const project=this.store.project(job.project_id);
    if(snapshots.some(s=>s.id===project.active_snapshot)){
     const fallback=this.store.one('SELECT id FROM snapshots WHERE project_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',job.project_id);
     this.store.run('UPDATE projects SET active_snapshot=? WHERE id=?',fallback?.id||null,job.project_id);
    }
    this.store.run('DELETE FROM jobs WHERE id=?',id);
    this.store.run("UPDATE job_cleanup SET phase='committed' WHERE job_id=?",id);
    this.store.db.exec('COMMIT');committed=true;
   }catch(error){this.store.db.exec('ROLLBACK');throw error;}
  }catch(error){this.recover();throw error;}
  if(committed)for(const s of snapshots)this.cache.delete(s.id);
  this.recover();
  let projectResult={projectRemoved:false};
  if(this.onEmptyProject&&!this.store.one('SELECT id FROM jobs WHERE project_id=? LIMIT 1',job.project_id)&&!this.store.one('SELECT id FROM snapshots WHERE project_id=? LIMIT 1',job.project_id))try{projectResult=this.onEmptyProject(job.project_id)}catch(error){projectResult={projectRemoved:false,projectCleanupError:error.message,cleanupPending:true}}
  return {ok:true,...projectResult,projectId:job.project_id,deletedSnapshots:snapshots.map(s=>s.id),activeSnapshot:this.store.project(job.project_id)?.active_snapshot||null,cleanupPending:!!projectResult.cleanupPending||this.pending().some(r=>r.job_id===id)};
 }
}
