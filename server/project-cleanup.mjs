import { existsSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
export class ProjectCleanup {
 constructor(store,runtime){this.store=store;this.runtime=realpathSync(runtime);store.db.exec('CREATE TABLE IF NOT EXISTS project_cleanup(project_id TEXT PRIMARY KEY,phase TEXT NOT NULL)');this.recover();}
 staged(id){if(!/^repo_[a-f0-9]{16}$/.test(id))throw Error('无效项目标识');const dir=join(this.runtime,'.project-cleanup');mkdirSync(dir,{recursive:true});if(lstatSync(dir).isSymbolicLink())throw Error('项目清理目录不能是符号链接');return join(dir,id);}
 clone(project){
  if(project.source_type!=='git')return null;
  const repos=join(this.runtime,'repos');mkdirSync(repos,{recursive:true});
  const parent=statSync(dirname(resolve(project.path))),expected=statSync(repos);
  if(lstatSync(repos).isSymbolicLink()||!/^checkout_[a-f0-9]{16}$/.test(basename(project.path))||parent.dev!==expected.dev||parent.ino!==expected.ino)throw Error('远程副本不在本平台管理目录，未清理项目。');
  if(this.store.one('SELECT id FROM projects WHERE path=? AND id<>?',project.path,project.id))throw Error('该副本被其他项目引用，未清理项目。');
  return project.path;
 }
 pending(){return this.store.all('SELECT project_id,phase FROM project_cleanup');}
 recover(){for(const item of this.pending())try{
  const staged=this.staged(item.project_id),project=this.store.project(item.project_id);
  if(project){const original=this.clone(project);if(existsSync(staged)){if(!original||existsSync(original))continue;renameSync(staged,original);}}
  else rmSync(staged,{recursive:true,force:true});
  this.store.run('DELETE FROM project_cleanup WHERE project_id=?',item.project_id);
 }catch{}return this.pending();}
 remove(id){
  const project=this.store.project(id);if(!project)throw Object.assign(Error('项目不存在或已清理'),{status:404});
  if(this.store.one('SELECT id FROM jobs WHERE project_id=? LIMIT 1',id)||this.store.one('SELECT id FROM snapshots WHERE project_id=? LIMIT 1',id))throw Object.assign(Error('项目仍有任务或快照，不能作为空项目清理。'),{status:409});
  const original=this.clone(project),staged=this.staged(id);if(existsSync(staged))throw Error('此项目存在待恢复清理，请先重试文件清理。');
  this.store.run("INSERT INTO project_cleanup VALUES(?,'staging')",id);
  try{
   if(original&&existsSync(original))renameSync(original,staged);
   this.store.db.exec('BEGIN IMMEDIATE');
   try{
    const result=this.store.run('DELETE FROM projects WHERE id=? AND NOT EXISTS(SELECT 1 FROM jobs WHERE project_id=?) AND NOT EXISTS(SELECT 1 FROM snapshots WHERE project_id=?)',id,id,id);
    if(!result.changes)throw Error('项目已有新数据，未清理项目。');
    this.store.run("UPDATE project_cleanup SET phase='committed' WHERE project_id=?",id);this.store.db.exec('COMMIT');
   }catch(error){this.store.db.exec('ROLLBACK');throw error;}
  }catch(error){this.recover();throw error;}
  this.recover();return {projectRemoved:true,cleanupPending:this.pending().some(r=>r.project_id===id)};
 }
}
