"""Evidence-bound Java/Spring/JPA contract extraction, without executing source."""
import re,hashlib
from java_introspection import masked,fields,close,split_args

def enrich(data,root):
 nodes=data['nodes'];edges=data['edges'];extra={'MI':[],'MM':[]}
 for n in list(nodes):
  if n.get('model') not in ('M1','M2'):continue
  proof=n.get('evidence') or []
  if not proof:continue
  ev=proof[0];p=root/ev['path']
  if not p.is_file():continue
  text=p.read_text();code=masked(text,strings=False)
  if n['model']=='M2' and n.get('endpoint'):
   start=sum(len(l) for l in text.splitlines(True)[:max(0,ev['line']-1)])
   m=re.search(r'\bpublic\s+([\w<>?,.\[\] ]+?)\s+(\w+)\s*\(',code[start:])
   if not m:continue
   a=start+m.end()-1;b=close(masked(text),a)
   if b<0:continue
   params=[]
   for part in split_args(text[a+1:b]):
    binding=re.search(r'@(PathVariable|RequestParam|RequestBody|RequestHeader|CookieValue|RequestPart)\b',part)
    clean=re.sub(r'@[\w.]+(?:\([^)]*\))?','',part).strip();field=re.search(r'([\w<>?,.\[\] ]+)\s+(\w+)$',clean)
    if not field:continue
    external=re.search(r'@(PathVariable|RequestParam|RequestHeader|CookieValue|RequestPart)\s*\(\s*(?:(?:name|value)\s*=\s*)?"([^"]+)"',part)
    required=re.search(r'required\s*=\s*false',part) is None if binding else None
    params.append(dict(name=external[2] if external else field[2],javaName=field[2],dataType=field[1].strip(),binding=binding[1] if binding else 'UNKNOWN',required=required,sourceDeclaration=part.strip()))
   prior=code[max(code.rfind('}',0,start),code.rfind(';',0,start),0):start+m.start()];permission=re.findall(r'@(?:PreAuthorize|Secured|RolesAllowed)\(([^\n]+)\)',prior)
   value=dict(id='MI-'+n['id'],interfaceId='MI-'+n['id'],model='MI',label=n['label']+' · 接口契约',name=n['label']+' · 接口契约',context=n.get('context'),interfaceType='PROVIDED',interfaceCategory='QUERY' if n.get('behaviorType')=='QUERY' else 'COMMAND',endpoint=n['endpoint'],behaviorRef=n['id'],inputParameters=params,outputResult=[dict(name='response',dataType=m[1].strip(),fieldsStatus='NOT_EXPANDED')],authorizationDeclarations=permission,returnRules=[],evidence=proof,reviewRequired=True,formalizationStatus='STATIC_DECLARATION_NOT_RUNTIME_VERIFIED')
   extra['MI'].append(value);edges.append(dict(source=value['id'],target=n['id'],label='接口承接行为',status='EXTRACTED',evidence=proof))
  if n['model']=='M1' and re.search(r'@(?:\w+\.)*Entity\b',code):
   table=re.search(r'@Table\s*\([^)]*\bname\s*=\s*"([^"]+)"',code)
   columns=[]
   for field in fields(code):
    declaration=re.search(r'\b(?:private|protected|public)\s+[^;{}()]*?\b'+re.escape(field['name'])+r'\s*(?:=[^;]*)?;',code);at=declaration.start() if declaration else 0
    prior=code[max(code.rfind(';',0,at),code.rfind('{',0,at),code.rfind('}',0,at),0)+1:at]
    field['line']=code[:at].count('\n')+1
    if re.search(r'@Transient\b',prior):continue
    col=re.search(r'@Column\s*\([^)]*\bname\s*=\s*"([^"]+)"',prior)
    columns.append(dict(attributeRef=field['name'],column=col[1] if col else None,mappingStatus='EXPLICIT_ANNOTATION' if col else 'NAMING_STRATEGY_UNKNOWN',javaType=field['javaType'],evidence=[dict(path=ev['path'],line=field['line'],sha256=hashlib.sha256(text.encode()).hexdigest())]))
   value=dict(id='MM-'+n['id'],model='MM',label=n['label']+' · 持久化映射',name=n['label']+' · 持久化映射',context=n.get('context'),objectRef=n['id'],tableMappings=[dict(tableName=table[1] if table else None,mappingStatus='EXPLICIT_ANNOTATION' if table else 'NAMING_STRATEGY_UNKNOWN',columnMappings=columns)],evidence=proof,reviewRequired=True)
   extra['MM'].append(value);edges.append(dict(source=value['id'],target=n['id'],label='映射业务对象',status='EXTRACTED',evidence=proof))
 for key,file,listname,kind in [('MI','mi-interface-model.yaml','interfaces','INTERFACE'),('MM','mm-mapping-model.yaml','mappings','MAPPING')]:
  nodes.extend(extra[key]);data['models'][file]=dict(model_type=kind,version='1.0',domain=data['manifest'].get('domain'),**{listname:extra[key]})
 data['manifest'].setdefault('limitations',[]).append('MI/MM仅恢复可识别Spring端点和JPA显式注解；动态路由、继承、MyBatis XML、默认命名策略和运行时权限不作已验证结论。')
