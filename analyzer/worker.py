"""Read-only repository normalization and trusted engine execution (stdlib only)."""
from pathlib import Path
import os,sys,json,shutil,subprocess,re,time
ENGINE=Path(__file__).parent/'engine'
SKIP={'.git','node_modules','target','dist','build','.runtime','.venv','venv','__pycache__','.codegraph','.idea','ontology','yaml'}
def emit(stage,message,progress):print(json.dumps(dict(stage=stage,message=message,progress=progress),ensure_ascii=False),flush=True)
def main():
 source=Path(sys.argv[1]).resolve();run=Path(sys.argv[2]).resolve();name=sys.argv[3];snapshot=run/'source';artifacts=run/'artifacts';snapshot.mkdir(parents=True,exist_ok=True);artifacts.mkdir(exist_ok=True)
 emit('扫描仓库','正在只读扫描源码与构建描述',15)
 paths=[];total=0;skipped=[]
 for folder,dirs,files in os.walk(source,followlinks=False):
  dirs[:]=sorted(d for d in dirs if d not in SKIP and not d.startswith('.') and not (Path(folder)/d).is_symlink())
  for f in sorted(files):
   p=Path(folder)/f
   if p.is_symlink() or not(p.suffix=='.java' or f in ['pom.xml','application.yml','application.yaml','app.js']):continue
   rel=p.relative_to(source)
   if f=='app.js' and 'src/main/resources/static'not in rel.as_posix():continue
   size=p.stat().st_size
   if size>2_000_000:skipped.append(rel.as_posix());continue
   total+=size
   if len(paths)>=6000 or total>60_000_000:raise ValueError('原型支持最多6000个分析文件 / 60MB源码，请缩小仓库范围。')
   paths.append((p,rel))
 java=[(p,r)for p,r in paths if p.suffix=='.java'and 'src/main/java/'in r.as_posix()]
 if not java:raise ValueError('未发现 src/main/java 下的 Java 源码。当前深度分析适配器支持 Java / Spring 工程。')
 emit('建立源码快照',f'发现 {len(java)} 个 Java 文件，正在建立隔离的分析输入',30)
 mapping={};modules=set();module_names={};source_manifest=[]
 for p,rel in paths:
  raw=rel.as_posix()
  if raw=='pom.xml':dstrel=Path('pom.xml')
  elif '/src/main/'in raw:
   prefix,suffix=raw.split('/src/main/',1)
   if prefix.startswith('services/')and len(Path(prefix).parts)==2:module=Path(prefix).name
   else:
    module=module_names.setdefault(prefix,re.sub(r'[^a-zA-Z0-9_-]+','-',prefix.strip('/'))or'repository')
   dstrel=Path('services')/module/'src/main'/suffix;modules.add(module)
  elif raw.startswith('src/main/'):
   module='repository';dstrel=Path('services')/module/raw;modules.add(module)
  elif raw.startswith('services/') and raw.endswith('/pom.xml'):
   dstrel=rel;modules.add(rel.parts[1])
  elif raw.endswith('/pom.xml'):
   module=re.sub(r'[^a-zA-Z0-9_-]+','-',str(rel.parent));dstrel=Path('services')/module/'pom.xml';modules.add(module)
  else:continue
  dest=snapshot/dstrel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest);mapping[dstrel.as_posix()]=raw;source_manifest.append(dict(path=raw,bytes=p.stat().st_size))
 rootpom=snapshot/'pom.xml'
 # Preserve original POM semantics for canonical services layouts; inferred module list is only a normalization adapter.
 canonical=any(r.as_posix().startswith('services/')for _,r in java)
 if not canonical or not rootpom.exists():rootpom.write_text('<project><modules>'+''.join('<module>services/'+m+'</module>'for m in sorted(modules))+'</modules></project>')
 for module in modules:
  mp=snapshot/'services'/module/'pom.xml'
  if not mp.exists():mp.write_text('<project><artifactId>'+module+'</artifactId></project>')
 profile='carddemo'if any('com/carddemo/payment/domain/model/PaymentOrder.java'in r.as_posix()for _,r in java)and any('com/carddemo/loan/'in r.as_posix()for _,r in java)else'java-spring'
 emit('生成七模型',f'适配器：{profile} · {len(modules)} 个源码模块',48)
 env={k:v for k,v in os.environ.items()if not k.startswith('PYTHON')};env['ONTOLOGY_PROFILE']=profile;env['ONTOLOGY_DOMAIN']=name;env['ONTOLOGY_COMMIT']=os.environ.get('ONTOLOGY_COMMIT','unavailable')
 # The only executed script is the platform-owned engine; repository scripts, builds and hooks are never executed.
 code="import sys,runpy;sys.path.insert(0,sys.argv[1]);sys.argv=sys.argv[2:];runpy.run_path(sys.argv[0],run_name='__main__')"
 result=subprocess.run([sys.executable,'-I','-c',code,str(ENGINE),str(ENGINE/'build_ontology.py'),str(snapshot),str(artifacts)],cwd=ENGINE,env=env,capture_output=True,text=True,timeout=180)
 if result.returncode:raise ValueError('分析器未完成：'+(result.stderr or result.stdout)[-3000:])
 emit('校验与溯源','七模型生成完成，正在核验引用与恢复原始源码路径',80)
 data=json.loads((artifacts/'ontology-data.json').read_text());data['manifest']['source_root']=str(source);data['manifest']['adapter']=profile;data['manifest']['analysis_files']=len(java);data['manifest']['normalized_modules']=not canonical;data['manifest']['skipped_oversized_files']=skipped
 if skipped:data['manifest']['limitations'].append(f'有 {len(skipped)} 个文件超过 2MB，未进入分析；清单见 skipped_oversized_files。')
 def restore(obj):
  if isinstance(obj,list):
   for x in obj:restore(x)
  elif isinstance(obj,dict):
   if 'path'in obj and 'line'in obj and obj['path']in mapping:obj['path']=mapping[obj['path']]
   for x in obj.values():restore(x)
 restore(data)
 # Current-format summaries are derived from the result, never hardcoded CardDemo counts.
 data['counts']['flows']=len(data['models']['m6-flow-model.yaml']['flows']);data['counts']['lifecycleFlows']=sum(f.get('modelingLevel')=='BUSINESS_LIFECYCLE'for f in data['models']['m6-flow-model.yaml']['flows'])
 (artifacts/'ontology-data.json').write_text(json.dumps(data,ensure_ascii=False));(artifacts/'source-manifest.json').write_text(json.dumps(source_manifest,ensure_ascii=False));(artifacts/'source-map.json').write_text(json.dumps(mapping,ensure_ascii=False))
 for filename,model in data['models'].items():(artifacts/'yaml'/filename).write_text(json.dumps(model,ensure_ascii=False,indent=2))
 (artifacts/'yaml/manifest.json').write_text(json.dumps(data['manifest'],ensure_ascii=False,indent=2))
 emit('完成',f'已生成 {len(data["nodes"])} 个本体节点与 {len(data["edges"])} 条关系',100)
 print(json.dumps(dict(result=str(artifacts/'ontology-data.json'),files=len(java),adapter=profile)),flush=True)
if __name__=='__main__':
 try:main()
 except Exception as e:print(json.dumps(dict(error=str(e)),ensure_ascii=False),flush=True);sys.exit(1)
