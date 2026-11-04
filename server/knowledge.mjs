import { readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
export function browseDirectories(input) {
 const path=realpathSync(input||process.env.HOME||'/');
 if(!statSync(path).isDirectory())throw Error('请选择可读取的目录');
 const entries=readdirSync(path,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&!e.name.startsWith('.')).sort((a,b)=>a.name.localeCompare(b.name));
 return {path,parent:dirname(path),directories:entries.slice(0,300).map(e=>({name:e.name,path:join(path,e.name)})),truncated:entries.length>300};
}

const DOCUMENT_FORMATS=new Set(['.md','.markdown','.txt','.html','.htm','.docx']);
const EXCLUDED=new Set(['node_modules','target','dist','build','.runtime','venv','yaml','ontology']);
// Inspect filenames only. Never follow links or execute anything from the selected directory.
export function inspectDirectory(path){
 const root=realpathSync(path),stack=[root];let visited=0,javaFiles=0,documentFiles=0;
 while(stack.length){const folder=stack.pop();for(const entry of readdirSync(folder,{withFileTypes:true})){
  if(++visited>20000)throw Error('目录条目超过20000，请选择更具体的资料目录');
  if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;
  const target=join(folder,entry.name);
  if(entry.isDirectory()){if(!EXCLUDED.has(entry.name))stack.push(target);continue;}
  if(!entry.isFile())continue;
  const rel=target.slice(root.length+1).replaceAll('\\','/');
  if(entry.name.endsWith('.java')&&/(^|\/)src\/main\/java\//.test(rel))javaFiles++;
  const extension=entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
  if(DOCUMENT_FORMATS.has(extension))documentFiles++;
 }}
 return {path:root,javaFiles,documentFiles,suggestedType:javaFiles?'local':documentFiles?'documents':null};
}
