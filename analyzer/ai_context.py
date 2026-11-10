"""Bounded platform-owned evidence collector, including inputs rejected by local parsers."""
from pathlib import Path
import sys,os,json,hashlib
sys.path.insert(0,str(Path(__file__).parent))
from documents import extract,FORMATS,SKIP
root=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve();limit=int(sys.argv[3]);preferred=json.loads(sys.argv[4]);out.mkdir(parents=True,exist_ok=True)
CODE={'.java','.kt','.py','.js','.jsx','.ts','.tsx','.go','.cs','.sql','.cbl','.cpy','.yaml','.yml'}
files=[];skipped=[];visited=0
for folder,dirs,names in os.walk(root,followlinks=False):
 dirs[:]=sorted(d for d in dirs if d not in SKIP and not d.startswith('.') and not (Path(folder)/d).is_symlink())
 for name in sorted(names):
  visited+=1
  if visited>20000:break
  p=Path(folder)/name
  if name.startswith('.') or p.is_symlink() or p.suffix.lower() not in FORMATS|CODE:continue
  files.append(p)
 if visited>20000:break
kind=sys.argv[5] if len(sys.argv)>5 else 'documents'
files.sort(key=lambda p:(p.relative_to(root).as_posix() not in preferred,p.suffix.lower() not in (FORMATS if kind=='documents' else CODE),p.relative_to(root).as_posix()))
remaining=limit;items=[]
for p in files:
 if remaining<1000 or len(items)>=24:break
 rel=p.relative_to(root).as_posix()
 try:
  if p.stat().st_size>2_000_000:raise ValueError('文件超过2MB')
  text=extract(p) if p.suffix.lower() in FORMATS else p.read_text(encoding='utf-8-sig')
  if not text.strip():continue
  target=out/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text)
  # Use bounded head + middle + tail windows so long documents are not represented only by their title page.
  lines=text.splitlines();positions=[0,max(0,len(lines)//2-20),max(0,len(lines)-50)] if len(lines)>120 else [0]
  for start in sorted(set(positions)):
   if remaining<500:break
   excerpt='\n'.join(lines[start:start+65])[:min(6000,remaining)];remaining-=len(excerpt)
   items.append(dict(path=rel,line=start+1,sha256=hashlib.sha256(text.encode()).hexdigest(),excerpt=excerpt,lineBasis='EXTRACTED_TEXT' if p.suffix.lower() in {'.docx','.html','.htm'} else 'ORIGINAL_TEXT'))
 except Exception as e:skipped.append(dict(path=rel,message=str(e)))
print(json.dumps(dict(sources=items,candidateFiles=len(files),includedFiles=len({e['path']for e in items}),truncated=len(files)>len({e['path']for e in items}),skipped=skipped),ensure_ascii=False))
