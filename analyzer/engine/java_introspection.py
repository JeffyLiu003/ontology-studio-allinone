"""Small lexical Java index. Handles balanced blocks; deliberately not a Java compiler."""
import re
from pathlib import Path

def masked(s,strings=True):
 pattern=r'"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*[\s\S]*?\*/'
 return re.sub(pattern,lambda m: re.sub(r'[^\n]',' ',m[0]) if strings or m[0].startswith(('/',"'")) else m[0],s)
def close(s,start,left='(',right=')'):
 depth=0
 for i in range(start,len(s)):
  if s[i]==left:depth+=1
  elif s[i]==right:
   depth-=1
   if depth==0:return i
 return -1
def split_args(s):
 arr=[];start=0;d=0
 for i,ch in enumerate(masked(s,False)):
  if ch in '(<[{':d+=1
  elif ch in ')>]}':d-=1
  elif ch==',' and d==0:arr.append(s[start:i].strip());start=i+1
 arr.append(s[start:].strip());return [a for a in arr if a]
def fields(s):
 result=[]
 # records
 m=re.search(r'\brecord\s+\w+(?:<[^>]+>)?\s*\(',s)
 if m:
  st=s.index('(',m.start());en=close(masked(s),st)
  for part in split_args(s[st+1:en]):
   clean=re.sub(r'@\w+(?:\([^)]*\))?','',part).strip();mm=re.search(r'([\w<>?,. \[\]]+)\s+(\w+)$',clean)
   if mm:result.append(dict(name=mm[2],javaType=mm[1].strip(),line=s[:st+1+s[st+1:en].find(part)].count('\n')+1))
 for m in re.finditer(r'^\s*(?:private|protected|public)\s+(?!static\b)(?:final\s+)?([\w<>?,. \[\]]+)\s+(\w+)\s*(?:=[^;\n]*)?;',s,re.M):result.append(dict(name=m[2],javaType=m[1].strip(),line=s[:m.start()].count('\n')+1))
 return result
class JavaIndex:
 def __init__(self,root):
  self.root=Path(root);self.classes={};self.methods=[]
  for p in sorted(self.root.glob('services/*/src/main/java/**/*.java')):
   s=p.read_text();key=str(p.relative_to(self.root));c=key.split('/')[1].removesuffix('-service').replace('reference-data','reference').replace('web-ui','web');pkg=re.search(r'package\s+([\w.]+)',s);imports={x.rsplit('.',1)[-1]:x for x in re.findall(r'import\s+([\w.]+);',s)}
   cl=dict(path=p,key=key,context=c,name=p.stem,text=s,mask=masked(s),imports=imports,fields=fields(s),methods=[]);self.classes[key]=cl
   for m in re.finditer(r'^\s*(public|private|protected)\s+(?:(?:static|final|synchronized)\s+)*([\w<>,. ?\[\]]+?)\s+(\w+)\s*\(',cl['mask'],re.M):
    st=cl['mask'].index('(',m.start());en=close(cl['mask'],st);tail=cl['mask'][en+1:];brace=re.match(r'\s*(?:throws[\w., ]+)?\s*\{',tail)
    if not brace:continue
    bs=en+1+brace.end()-1;be=close(cl['mask'],bs,'{','}');
    if be<0:continue
    prior=s[max(0,s.rfind('}',0,m.start())):m.start()]
    method=dict(id=key+'#'+m[3],name=m[3],returnType=m[2].strip(),visibility=m[1],start=m.start(1),line=s[:m.start(1)].count('\n')+1,bodyStart=bs,bodyEnd=be,body=s[bs+1:be],params=s[st+1:en],annotations=prior[-1400:],cls=cl)
    cl['methods'].append(method);self.methods.append(method)
  # Nested response records are real DTO types (e.g. CustomerOverviewResponse.Position).
  nested=[]
  for cl in list(self.classes.values()):
   s=cl['text']
   for hit in re.finditer(r'\brecord\s+(\w+)(?:<[^>]+>)?\s*\(',s):
    name=hit[1]
    if name==cl['name']:continue
    ps=s.index('(',hit.start());pe=close(masked(s),ps);bs=masked(s).find('{',pe);be=close(masked(s),bs,'{','}');part=s[hit.start():be+1]
    item=dict(cl,name=name,fields=fields(part),methods=[],nestedIn=cl['name'])
    offset=s[:hit.start()].count('\n')
    for f in item['fields']:f['line']+=offset
    nested.append((cl['key']+'#'+name,item))
  self.classes.update(nested)
 def resolve(self,context,name,imports=None):
  nm=re.sub(r'<.*','',name).split('.')[-1]
  matches=[cl for cl in self.classes.values() if cl['name']==nm and cl['context']==context]
  return matches[0] if matches else None
 def findmethod(self,cl,name):return next((m for m in cl['methods'] if m['name']==name),None) if cl else None
 def calls(self,m):
  body=masked(m['body']);cl=m['cls'];types={f['name']:f['javaType'] for f in cl['fields']}
  for typ,name in re.findall(r'\b([A-Z][\w<>]+)\s+(\w+)\s*=',body):types[name]=typ
  calls=[]
  for mm in re.finditer(r'\b(?:(\w+)\s*\.)?(\w+)\s*\(',body):
   recv,name=mm.groups();target=None
   if recv:
    if recv=='this':target=cl
    elif recv in types:target=self.resolve(cl['context'],types[recv],cl['imports'])
    elif recv[:1].isupper():target=self.resolve(cl['context'],recv,cl['imports'])
   elif name not in {'if','for','while','switch','catch','return','throw','new','synchronized'}:target=cl
   meth=self.findmethod(target,name)
   if target:
    calls.append(dict(receiver=recv or 'this',name=name,target=target,method=meth,offset=mm.start(),line=cl['text'][:m['bodyStart']+1+mm.start()].count('\n')+1))
  return calls
 def trace(self,m,depth=4):
  result=[];visited=set()
  def visit(mm,n):
   if not mm or mm['id']in visited:return
   visited.add(mm['id']);result.append(mm)
   if n:
    for call in self.calls(mm):
     if call['method'] and any(t in call['target']['key'] for t in ['/application/','/domain/service/','/infrastructure/client/','/domain/model/','/interfaces/rest/dto/']):visit(call['method'],n-1)
  visit(m,depth);return result
