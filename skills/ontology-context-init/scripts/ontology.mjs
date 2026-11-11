#!/usr/bin/env node
import {readFileSync,realpathSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const args=process.argv.slice(2),command=args.shift();
function flag(name,fallback){const i=args.indexOf('--'+name);return i<0?fallback:args[i+1]}
async function main(){
 if(command==='help'||!command){console.log('node ontology.mjs project | baselines | feedback --file feedback.json --snapshot ID | search --query "账户 冻结" --snapshot ID | context --ids id1,id2 --requirement "需求" --snapshot ID [--depth 1] [--baseline ID 替代snapshot] | evidence --assertion ID --snapshot ID [--index 0] [--source]\n配置：仓库根目录 .ontology-agent.json；可用 --config PATH 显式指定。');return}
 let cwd=process.cwd(),configPath=flag('config');if(!configPath){while(true){const f=resolve(cwd,'.ontology-agent.json');if(existsSync(f)){configPath=f;break}const parent=dirname(cwd);if(parent===cwd)throw Error('未找到 .ontology-agent.json，请先安装项目接入包');cwd=parent}}
 const config=JSON.parse(readFileSync(configPath,'utf8')),base=new URL(config.url);if(base.protocol!=='http:'||!['localhost','127.0.0.1'].includes(base.hostname)||base.username||base.password)throw Error('仅允许本机 HTTP 平台地址');
 const get=async(path,body)=>{const r=await fetch(new URL('/api'+path,base),{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok)throw Error(d.error||'平台请求失败');return d};
 const binding=await get('/agent/project?repository='+encodeURIComponent(realpathSync(dirname(resolve(configPath))))+'&project='+encodeURIComponent(config.projectId));
 if(command==='project')return binding;
 const prefix='/projects/'+encodeURIComponent(binding.project.id);if(command==='baselines')return binding.baselines||[];const baseline=flag('baseline');let snap=flag('snapshot');if(baseline){const published=(binding.baselines||[]).find(b=>b.id===baseline);if(!published)throw Error('该项目不存在指定已发布基线');if(snap&&snap!==published.snapshot_id)throw Error('基线与快照不匹配');snap=published.snapshot_id}if(!snap)throw Error('请先执行 project，后续查询必须显式传入 --snapshot，避免混用版本');
 const path='/projects/'+encodeURIComponent(binding.project.id),suffix='?snapshot='+encodeURIComponent(snap)+(baseline?'&baseline='+encodeURIComponent(baseline):'');
 if(command==='feedback'){const file=flag('file');if(!file)throw Error('请指定反馈JSON文件');const input=JSON.parse(readFileSync(resolve(file),'utf8'));return get(path+'/workbench/feedback',{...input,snapshot:snap})}
 if(command==='search')return get(path+'/agent/search'+suffix,{query:flag('query',''),limit:flag('limit',12)});
 if(command==='context'){const packet=await get(path+'/coding-context'+suffix,{ids:flag('ids','').split(',').filter(Boolean),requirement:flag('requirement',''),depth:Number(flag('depth',1))});delete packet.files;return packet}
 if(command==='evidence'){const d=await get(path+'/agent/evidence'+suffix+'&assertion='+encodeURIComponent(flag('assertion','')));if(args.includes('--source')){const e=d.evidence[Number(flag('index',0))];if(!e)throw Error('该断言没有指定证据');d.source=await get(path+'/source'+suffix+'&path='+encodeURIComponent(e.path)+'&line='+encodeURIComponent(e.line));}return d}
 throw Error('未知命令；使用 help 查看说明');
}
main().then(d=>{if(d)console.log(JSON.stringify(d,null,2))}).catch(e=>{console.error(JSON.stringify({error:e.message}));process.exitCode=1});
