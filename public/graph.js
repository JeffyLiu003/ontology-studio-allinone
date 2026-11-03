import { MODEL, esc, icon } from './ui.js';
import { graphSlice, neighborhood, directedCurve } from './graph-model.js';
const NS = 'http://www.w3.org/2000/svg';
const COLORS = { CTX:'#b4c9e9', M1:'#ab9aff', M2:'#62b5f5', M3:'#edbf6b', M5:'#e695c3', M6:'#6ad7ba', M7:'#6dccdf', MU:'#c5a4ed' };
const make = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,v); return el; };
let serial = 0;

export class GraphView {
 constructor(el, data, options = {}) {
  Object.assign(this, { el, data, options, mode:options.mode||'all', context:options.context||'', type:options.type||'', selected:'', hovered:'', drag:null, moved:false, frame:0, cameraFrame:0, destroyed:false, transform:{x:0,y:0,k:1}, ticks:0 });
  Object.assign(this, { relation:'', evidence:'', focus:'', hops:1, direction:'both', paused:false, showLabels:this.mode==='flow' }, options.view||{});
  this.prefix = `ontology-graph-${++serial}`;
  this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
  this.motionChange = () => { if(this.reduced.matches) { cancelAnimationFrame(this.frame); this.frame=0; } else this.run(); this.syncState(); };
  this.reduced.addEventListener('change', this.motionChange);
  this.render();
 }
 color(n) { return this.mode==='flow' ? '#7f66b2' : COLORS[n.model]||'#b4c9e9'; }
 render() {
  const flow = this.mode==='flow';
  this.el.classList.toggle('codegraph-surface', !flow);
  this.el.innerHTML = `<div class="graph-toolbar"><span class="graph-count"></span><span class="graph-engine-status"></span></div>
   ${!flow?`<div class="cg-view-controls"><label>关联类型<select aria-label="筛选关联类型"><option value="">全部关联</option>${[...new Set(this.data.edges.map(e=>e.label))].sort().map(v=>`<option value="${esc(v)}" ${v===this.relation?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label>证据级别<select aria-label="筛选关联证据"><option value="">全部证据</option><option value="code" ${this.evidence==='code'?'selected':''}>源码结构</option><option value="mapped" ${this.evidence==='mapped'?'selected':''}>语义映射 · 待评审</option></select></label><button class="cg-layout-toggle" aria-label="暂停动态布局">${icon('stop',12)}暂停布局</button></div>`:''}
   <svg class="graph-canvas" role="group" aria-label="可交互本体图谱"><defs><marker id="${this.prefix}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="${flow?'#ae9bbc':'#77909f'}"/></marker><marker id="${this.prefix}-active-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="${flow?'#8865b9':'#82e6cb'}"/></marker></defs><g class="viewport"><g class="cluster-labels"></g><g class="links"></g><g class="particles"></g><g class="nodes"></g></g></svg>
   <div class="cg-selection hidden"></div><div class="cg-empty hidden"><b>此范围暂无模型节点</b><span>可切换业务域、模型类型或关联条件。</span></div>
   <div class="graph-controls"><button class="icon-button" data-graph="in" aria-label="放大图谱">${icon('plus',16)}</button><button class="icon-button" data-graph="out" aria-label="缩小图谱">−</button><button class="icon-button" data-graph="fit" aria-label="适应画布">${icon('zoom',16)}</button><button class="icon-button" data-graph="labels" aria-label="切换关系标签" aria-pressed="${this.showLabels}">${icon('table',16)}</button><button class="icon-button" data-graph="clear" aria-label="重置图谱选择">${icon('refresh',16)}</button></div>
   <div class="graph-legend"></div><div class="cg-interaction-hint">拖拽节点 · 滚轮缩放 · 点击探索关联<span>连线动效仅表示关系方向</span></div><div class="graph-tooltip"></div>`;
  this.svg=this.el.querySelector('svg.graph-canvas'); this.viewport=this.el.querySelector('.viewport'); this.nodeLayer=this.el.querySelector('.nodes'); this.linkLayer=this.el.querySelector('.links'); this.particles=this.el.querySelector('.particles'); this.tooltip=this.el.querySelector('.graph-tooltip');
  this.el.querySelectorAll('[data-graph]').forEach(b=>b.onclick=()=>{
   const action=b.dataset.graph;
   if(action==='fit') this.fit(true);
   else if(action==='clear') this.clear();
   else if(action==='labels') { this.showLabels=!this.showLabels; b.setAttribute('aria-pressed',this.showLabels); this.highlight(); this.saveView(); }
   else this.zoom(action==='in'?1.3:1/1.3);
  });
  this.el.querySelector('[aria-label="筛选关联类型"]')?.addEventListener('change',e=>{this.relation=e.target.value;this.rebuild();});
  this.el.querySelector('[aria-label="筛选关联证据"]')?.addEventListener('change',e=>{this.evidence=e.target.value;this.rebuild();});
  this.el.querySelector('.cg-layout-toggle')?.addEventListener('click',()=>{this.paused=!this.paused;if(this.paused){cancelAnimationFrame(this.frame);this.frame=0;}else{this.ticks=0;this.run();}this.syncState();this.saveView();});
  this.svg.addEventListener('wheel',e=>{this.userMoved=true;e.preventDefault();const r=this.svg.getBoundingClientRect();this.zoom(Math.exp(-e.deltaY*.0015),e.clientX-r.left,e.clientY-r.top);},{passive:false});
  this.svg.addEventListener('pointerdown',e=>{if(e.button!==0)return;this.userMoved=true;cancelAnimationFrame(this.cameraFrame);this.drag={x:e.clientX,y:e.clientY,tx:this.transform.x,ty:this.transform.y,moved:false};this.svg.setPointerCapture(e.pointerId);});
  this.svg.addEventListener('pointermove',e=>{
   if(!this.drag)return;const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;this.drag.moved ||= Math.abs(dx)+Math.abs(dy)>4;
   if(this.drag.node){const n=this.drag.node;n.x=this.drag.tx+dx/this.transform.k;n.y=this.drag.ty+dy/this.transform.k;n.vx=n.vy=0;this.update();}
   else {this.transform.x=this.drag.tx+dx;this.transform.y=this.drag.ty+dy;this.apply();}
  });
  this.svg.addEventListener('pointerup',e=>{const drag=this.drag;this.drag=null;this.moved=!!drag?.moved;if(drag&&!drag.node&&!drag.moved)this.clear();if(drag?.node&&!drag.moved){this.select(drag.node);if(this.mode==='flow'){clearTimeout(this.detailTimer);this.detailTimer=setTimeout(()=>{if(!this.destroyed)this.options.onSelect?.(drag.node);},240);}const now=performance.now();if(this.lastClick?.id===drag.node.id&&now-this.lastClick.time<350){this.open(drag.node);this.lastClick=null;}else this.lastClick={id:drag.node.id,time:now};}if(drag?.node&&drag.moved){this.ticks=Math.min(this.ticks,110);this.run();}});
  this.svg.addEventListener('dblclick',()=>{if(this.lastClick&&performance.now()-this.lastClick.time<500){const n=this.byId.get(this.lastClick.id);this.lastClick=null;if(n)this.open(n);}});
  this.svg.addEventListener('pointercancel',()=>{this.drag=null;this.moved=false;});
  this.build();
  this.observer=new ResizeObserver(()=>{if(!this.drag)this.fit();});this.observer.observe(this.el);
 }
 saveView(){this.options.onViewChange?.({relation:this.relation,evidence:this.evidence,focus:this.focus,hops:this.hops,direction:this.direction,paused:this.paused,showLabels:this.showLabels});}
 destroy(){this.destroyed=true;clearTimeout(this.detailTimer);cancelAnimationFrame(this.frame);cancelAnimationFrame(this.cameraFrame);this.observer?.disconnect();this.reduced.removeEventListener('change',this.motionChange);this.el.innerHTML='';}
 rebuild(){cancelAnimationFrame(this.frame);this.frame=0;this.hovered='';this.tooltip.style.display='none';this.build();this.saveView();}
 build(){
  if(this.mode==='flow')return this.buildFlow(this.options.flow);
  const view=graphSlice(this.data,{mode:this.mode,context:this.context,type:this.type,relation:this.relation,evidence:this.evidence,focus:this.focus,hops:this.hops,direction:this.direction});
  this.nodes=view.nodes.map(n=>({...n,vx:0,vy:0}));this.links=view.edges.map(e=>({...e}));
  this.layoutClusters();this.draw();
 }
 layoutClusters(){
  const contexts=[...new Set(this.nodes.map(n=>n.context||''))];const count=contexts.length;
  this.world={w:Math.max(1000,Math.sqrt(count)*500),h:Math.max(800,Math.sqrt(count)*420)};
  const compact=!!this.focus||count===1;
  this.nodes.forEach((n,i)=>{
   const index=contexts.indexOf(n.context||''),angle=index*2.399,dist=compact?0:Math.sqrt(index)*240;
   const hx=this.world.w/2+Math.cos(angle)*dist,hy=this.world.h/2+Math.sin(angle)*dist*.8;
   const group=this.nodes.filter(p=>p.context===n.context),j=group.indexOf(n),r=n.model==='CTX'?0:30+Math.sqrt(j+1)*(compact?48:27);
   n.homeX=hx;n.homeY=hy;n.x=hx+Math.cos(j*2.399)*r;n.y=hy+Math.sin(j*2.399)*r;
  });
  if(this.mode==='domains')this.nodes.forEach((n,i)=>{const a=i*2.399,r=Math.sqrt(i)*105;n.x=this.world.w/2+Math.cos(a)*r;n.y=this.world.h/2+Math.sin(a)*r;n.homeX=n.x;n.homeY=n.y;});
 }
 buildFlow(flow){if(!flow){this.nodes=[];this.links=[];this.world={w:1000,h:700};return this.draw()}const prefix=flow.id+'::';this.nodes=flow.activities.map(a=>({...a,id:prefix+a.activityId,label:a.name,context:flow.context,model:'M6',parentFlow:flow.id}));this.links=[];for(const a of flow.activities){for(const id of a.nextActivities||[])this.links.push({source:prefix+a.activityId,target:prefix+id,label:'下一步',status:'CODE'});for(const b of a.branches||[])this.links.push({source:prefix+a.activityId,target:prefix+b.targetActivity,label:b.branchName,status:'MAPPED'});for(const h of a.exceptionHandlers||[])this.links.push({source:prefix+a.activityId,target:prefix+h.targetActivity,label:'异常捕获',status:'MAPPED'})}const depth=new Map([[prefix+flow.startActivity,0]]),queue=[prefix+flow.startActivity];while(queue.length){const id=queue.shift();for(const e of this.links.filter(e=>e.source===id)){if(!depth.has(e.target)){depth.set(e.target,depth.get(id)+1);queue.push(e.target)}}}const groups=new Map();for(const n of this.nodes){const d=depth.get(n.id)||0;if(!groups.has(d))groups.set(d,[]);groups.get(d).push(n)}const cols=Math.max(2,...[...groups.values()].map(g=>g.length));this.world={w:cols*310,h:(Math.max(...depth.values())+2)*115};for(const [d,group]of groups)group.forEach((n,i)=>{n.x=this.world.w/2+(i-(group.length-1)/2)*290;n.y=90+d*115});this.draw()}
 draw(){
  this.nodeLayer.replaceChildren();this.linkLayer.replaceChildren();this.particles.replaceChildren();this.particleKey='';
  this.byId=new Map(this.nodes.map(n=>[n.id,n]));this.degree=new Map(this.nodes.map(n=>[n.id,0]));
  this.links=this.links.filter(e=>this.byId.has(e.source)&&this.byId.has(e.target));
  for(const e of this.links){this.degree.set(e.source,this.degree.get(e.source)+1);this.degree.set(e.target,this.degree.get(e.target)+1);}
  this.labelled=new Set([...this.nodes].sort((a,b)=>this.degree.get(b.id)-this.degree.get(a.id)).slice(0,this.mode==='domains'?100:14).map(n=>n.id));
  const pairs=new Map();
  this.links.forEach((e,i)=>{
   e.a=this.byId.get(e.source);e.b=this.byId.get(e.target);
   const key=[e.source,e.target].sort().join('\0'),seen=pairs.get(key)||0;pairs.set(key,seen+1);
   e.bend=this.mode==='flow'?0:seen===0?18:(seen%2?1:-1)*(30+seen*12);
   e.el=make('path',{id:`${this.prefix}-link-${i}`,class:'graph-link'+(e.status==='MAPPED'?' inferred':''),'marker-end':`url(#${this.prefix}-arrow)`,'vector-effect':'non-scaling-stroke',tabindex:'-1'});
   const title=make('title');title.textContent=`${e.a.label} → ${e.b.label}\n${e.label} · ${e.status==='MAPPED'?'语义映射，待评审':'源码结构证据'}`;e.el.append(title);
   e.labelEl=make('text',{class:'graph-link-label','text-anchor':'middle'});e.labelEl.textContent=e.label.length>22?e.label.slice(0,21)+'…':e.label;
   e.el.addEventListener('pointerenter',()=>{if(this.drag)return;e.el.classList.add('edge-hover');e.labelEl.classList.add('edge-hover');});
   e.el.addEventListener('pointerleave',()=>{e.el.classList.remove('edge-hover');e.labelEl.classList.remove('edge-hover');});
   e.el.addEventListener('pointerdown',event=>event.stopPropagation());
   e.el.addEventListener('click',()=>{if(!this.moved){this.select(e.a);this.showEdge(e);}});
   this.linkLayer.append(e.el,e.labelEl);
  });
  for(const n of this.nodes){
   n.radius=this.mode==='flow'?32:n.model==='CTX'?21:Math.min(17,6+Math.sqrt(this.degree.get(n.id))*1.55);
   const g=make('g',{class:'graph-node','data-node-id':n.id,role:'button',tabindex:'0','aria-label':`${n.label}，${n.model==='CTX'?'业务域':n.model}，${this.degree.get(n.id)} 条关联`});
   if(this.mode==='flow'){
    const gate=n.activityType==='GATEWAY';g.append(make('rect',{class:'node-body',x:-116,y:-30,width:232,height:60,rx:['START','END'].includes(n.activityType)?27:9,fill:'#fff',stroke:gate?'#d9bd85':'#b2d4c7','stroke-width':1.8}));
    const text=make('text',{'text-anchor':'middle',y:-4,style:'font-size:14px;stroke:none;fill:#6b607a'});
    const label=n.label.length>30?n.label.slice(0,29)+'…':n.label;
    [label.slice(0,15),label.slice(15)].filter(Boolean).forEach((part,i)=>{const span=make('tspan',{x:0,dy:i?20:0});span.textContent=part;text.append(span);});g.append(text);
   }else{
    const color=this.color(n);g.style.setProperty('--node-color',color);
    g.append(make('circle',{class:'node-halo',r:n.radius+8,fill:color,opacity:'.08'}),make('circle',{class:'node-ring',r:n.radius+5,fill:'none',stroke:color,'stroke-width':1.8,'vector-effect':'non-scaling-stroke'}),make('circle',{class:'node-body',r:n.radius,fill:color}));
    if(n.model==='CTX'){const t=make('text',{'text-anchor':'middle',y:4,style:'font:600 10px system-ui;fill:#152236;stroke:none'});t.textContent=this.degree.get(n.id)||'◇';g.append(t);}
    const text=make('text',{class:'node-label','text-anchor':'middle',y:n.radius+17});text.textContent=n.label.length>24?n.label.slice(0,23)+'…':n.label;g.append(text);
   }
   g.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.stopPropagation();this.userMoved=true;cancelAnimationFrame(this.cameraFrame);this.moved=false;this.drag={node:n,x:e.clientX,y:e.clientY,tx:n.x,ty:n.y,moved:false};this.svg.setPointerCapture(e.pointerId);});
   g.addEventListener('click',()=>{if(this.moved){this.moved=false;return;}this.select(n);});
   
   g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.select(n);if(this.mode==='flow')this.options.onSelect?.(n);}if(e.key==='Escape')this.clear();});
   g.addEventListener('pointerenter',e=>{
    if(this.drag)return;this.hovered=n.id;this.highlight();const r=this.el.getBoundingClientRect();this.tooltip.style.display='block';this.tooltip.style.left=Math.max(8,Math.min(e.clientX-r.left+14,r.width-270))+'px';this.tooltip.style.top=Math.max(70,e.clientY-r.top-70)+'px';
    this.tooltip.innerHTML=`<strong>${esc(n.label)}</strong><br><small>${esc(n.model==='CTX'?'业务域':n.model)} · ${esc(this.data.contexts[n.context]||n.context)} · ${this.degree.get(n.id)} 条关联</small>`;
   });
   g.addEventListener('pointerleave',()=>{this.hovered='';this.tooltip.style.display='none';this.highlight();});
   n.el=g;this.nodeLayer.append(g);
  }
  if(!this.byId.has(this.selected))this.selected='';
  if(this.focus&&!this.byId.has(this.focus)){this.focus='';this.saveView();}
  this.el.querySelector('.graph-count').textContent=`${this.nodes.length} 个${this.mode==='flow'?'活动':'节点'} · ${this.links.length} 条关系`;
  this.el.querySelector('.cg-empty').classList.toggle('hidden',this.nodes.length>0);
  this.el.querySelector('.graph-legend').innerHTML=this.mode==='flow'?'实线：顺序执行　虚线：条件 / 异常分支':Object.entries(MODEL).map(([k,m])=>`<span><i style="background:${COLORS[k]}"></i>${k} ${m.name}</span>`).join('')+'<span class="cg-edge-legend"><i></i>源码结构</span><span class="cg-edge-legend mapped"><i></i>语义映射</span>';
  this.userMoved=false;this.update();this.highlight();this.fit();this.showSelection();this.ticks=0;this.run();this.syncState();
 }
 run(){
  if(this.mode==='flow'||this.paused||this.reduced.matches||this.destroyed||this.frame||!this.nodes.length)return;
  const tick=()=>{
   this.frame=0;if(this.destroyed||this.paused||this.reduced.matches)return;
   const alpha=Math.max(.03,1-this.ticks/160),nodes=this.nodes;
   // Bounded repulsion + springs; the loop ends after settling instead of consuming idle CPU.
   for(let i=0;i<nodes.length;i++){
    const a=nodes[i];a.vx+=(a.homeX-a.x)*.0025*alpha;a.vy+=(a.homeY-a.y)*.0025*alpha;
    for(let j=i+1;j<nodes.length;j++){
     const b=nodes[j],dx=a.x-b.x||.1,dy=a.y-b.y||.1,d2=Math.max(100,dx*dx+dy*dy);
     if(d2>240000)continue;
     const force=Math.min(1.8,600*alpha/d2);a.vx+=dx*force;a.vy+=dy*force;b.vx-=dx*force;b.vy-=dy*force;
    }
   }
   for(const e of this.links){const dx=e.b.x-e.a.x,dy=e.b.y-e.a.y,d=Math.hypot(dx,dy)||1,desired=this.mode==='domains'?210:100;const force=(d-desired)*.0045*alpha/Math.sqrt(Math.max(1,this.degree.get(e.a.id)+this.degree.get(e.b.id)));e.a.vx+=dx/d*force;e.a.vy+=dy/d*force;e.b.vx-=dx/d*force;e.b.vy-=dy/d*force;}
   for(const n of nodes){if(this.drag?.node===n)continue;n.vx*=.62;n.vy*=.62;n.x+=n.vx;n.y+=n.vy;}
   this.update();this.ticks++;
   if(this.ticks<160)this.frame=requestAnimationFrame(tick);else {this.syncState();if(!this.userMoved)this.fit(true);}
  };
  this.frame=requestAnimationFrame(tick);
 }
 syncState(){
  const running=this.mode!=='flow'&&!this.paused&&!this.reduced.matches&&this.ticks<160;
  const status=this.el.querySelector('.graph-engine-status');status.textContent=this.mode==='flow'?'流程拓扑':this.reduced.matches?'减少动态效果':this.paused?'布局已暂停':running?'力导向布局中':'布局已稳定';status.classList.toggle('running',running);
  const button=this.el.querySelector('.cg-layout-toggle');if(button){button.innerHTML=icon(this.paused?'refresh':'stop',12)+(this.paused?'继续布局':'暂停布局');button.setAttribute('aria-label',this.paused?'继续动态布局':'暂停动态布局');button.setAttribute('aria-pressed',String(this.paused));}
 }
 update(){
  for(const n of this.nodes)n.el?.setAttribute('transform',`translate(${n.x},${n.y})`);
  for(const e of this.links){
   if(this.mode==='flow'){
    const dx=e.b.x-e.a.x,dy=e.b.y-e.a.y,d=Math.hypot(dx,dy)||1;const offset=Math.min(118/(Math.abs(dx/d)||.0001),32/(Math.abs(dy/d)||.0001));
    e.el.setAttribute('d',directedCurve(e.a,{x:e.b.x-dx/d*offset,y:e.b.y-dy/d*offset},0,0,e.source===e.target?30:0));
   }else e.el.setAttribute('d',directedCurve(e.a,e.b,e.a.radius+2,e.b.radius+4,e.bend));
   e.labelEl.setAttribute('x',(e.a.x+e.b.x)/2);e.labelEl.setAttribute('y',(e.a.y+e.b.y)/2-Math.max(9,7/this.transform.k)-(e.bend||0)/3);
  }
 }
 highlight(){
  if(!this.nodes)return;const active=this.hovered||this.selected,lit=active?neighborhood(active,this.links,1):null;
  for(const n of this.nodes){
   n.el.classList.toggle('selected',n.id===this.selected);n.el.classList.toggle('neighbor',!!lit?.has(n.id)&&n.id!==active);n.el.classList.toggle('dimmed',!!lit&&!lit.has(n.id));n.el.classList.toggle('hovered',n.id===this.hovered);
   const label=n.el.querySelector('.node-label');if(label)label.classList.toggle('label-visible',lit?lit.has(n.id):n.model==='CTX'||this.labelled.has(n.id)||this.transform.k>.9);
  }
  const animated=[];
  for(const e of this.links){const linked=!!active&&(e.source===active||e.target===active);e.el.classList.toggle('lit',linked);e.el.classList.toggle('dimmed',!!lit&&!linked);e.el.setAttribute('marker-end',`url(#${this.prefix}${linked?'-active':''}-arrow)`);e.labelEl.style.display=this.showLabels||linked?'':'none';e.labelEl.classList.toggle('dimmed',!!lit&&!linked);if(linked)animated.push(e);}
  const key=active+'|'+animated.map(e=>e.el.id).join(',');
  if(key!==this.particleKey){this.particleKey=key;this.particles.replaceChildren();if(this.mode!=='flow')for(const [index,e]of animated.slice(0,48).entries()){
   const dot=make('circle',{r:2.8,class:'edge-particle',fill:'#a0f2db'}),motion=make('animateMotion',{dur:`${2.2+(index%3)*.4}s`,repeatCount:'indefinite',begin:`-${index%4*.5}s`});motion.append(make('mpath',{href:'#'+e.el.id}));dot.append(motion);this.particles.append(dot);
  }}
 }
 open(n){clearTimeout(this.detailTimer);if(this.mode==='flow'||['CTX','M6'].includes(n.model))this.options.onOpen?.(n);else this.focusOn(n,1);}
 select(n){if(!this.byId.has(n.id))return;this.selected=n.id;this.highlight();this.showSelection();}
 selectById(id,center=false){const n=this.byId.get(id);if(n){this.select(n);if(center)this.centerOn(n);}return !!n;}
 focusOn(n,hops=1){this.selected=n.id;this.focus=n.id;this.hops=hops;this.rebuild();}
 clear(){this.selected='';this.hovered='';this.tooltip.style.display='none';if(this.focus){this.focus='';this.rebuild();}else{this.highlight();this.showSelection();}this.options.onClear?.();}
 showSelection(){
  const panel=this.el.querySelector('.cg-selection'),n=this.byId.get(this.selected);panel.classList.toggle('hidden',!n||this.mode==='flow');if(!n||this.mode==='flow')return;
  const edges=this.links.filter(e=>e.source===n.id||e.target===n.id),out=edges.filter(e=>e.source===n.id).length,incoming=edges.filter(e=>e.target===n.id).length;
  panel.innerHTML=`<div class="cg-selection-title"><span class="cg-node-badge" style="color:${this.color(n)}">${esc(n.model==='CTX'?'DOMAIN':n.model)}</span><button class="cg-close" aria-label="清除关联选择">×</button></div><h3>${esc(n.label)}</h3><div class="cg-selection-sub">${esc(this.data.contexts[n.context]||n.context)} · ${out} 条出向 / ${incoming} 条入向</div><div class="cg-selection-actions"><button data-explore="details">查看模型 ${icon('external',11)}</button><button data-explore="focus">${this.focus?'返回全图':'聚焦邻域'}</button></div>
   <div class="cg-neighborhood-tools"><label>邻域范围<select aria-label="邻域层数"><option value="1" ${this.hops===1?'selected':''}>一层关联</option><option value="2" ${this.hops===2?'selected':''}>两层关联</option></select></label><label>方向<select aria-label="邻域关系方向"><option value="both" ${this.direction==='both'?'selected':''}>全部方向</option><option value="out" ${this.direction==='out'?'selected':''}>沿出向扩展</option><option value="in" ${this.direction==='in'?'selected':''}>沿入向扩展</option></select></label></div>
   <div class="cg-neighbor-heading">当前视图直接关联 <span>${edges.length}</span></div><div class="cg-neighbor-list">${edges.slice(0,20).map((e,i)=>{const outgoing=e.source===n.id,other=this.byId.get(outgoing?e.target:e.source);return `<button data-explore-neighbor="${esc(other.id)}" title="${esc(e.a.label+' → '+e.b.label)}"><span class="cg-relation-direction">${outgoing?'↗':'↙'}</span><span><b>${esc(other.label)}</b><small>${esc(e.label)} · ${outgoing?'出向':'入向'}${e.status==='MAPPED'?' · 待评审':''}</small></span><i style="background:${this.color(other)}"></i></button>`;}).join('')||'<p>当前筛选下没有直接关联。</p>'}</div>${edges.length>20?`<div class="cg-more-relations">展示前 20 / ${edges.length} 条，可筛选关联类型查看。</div>`:''}`;
  panel.querySelector('.cg-close').onclick=()=>this.clear();
  panel.querySelector('[data-explore="details"]').onclick=()=>this.options.onSelect?.(n);
  panel.querySelector('[data-explore="focus"]').onclick=()=>{this.focus=this.focus?'':n.id;this.rebuild();};
  panel.querySelector('[aria-label="邻域层数"]').onchange=e=>{this.hops=Number(e.target.value);this.focus=n.id;this.rebuild();};
  panel.querySelector('[aria-label="邻域关系方向"]').onchange=e=>{this.direction=e.target.value;this.focus=n.id;this.rebuild();};
  panel.querySelectorAll('[data-explore-neighbor]').forEach(button=>button.onclick=()=>{this.selectById(button.dataset.exploreNeighbor,true);});
 }
 showEdge(e){
  this.showSelection();const panel=this.el.querySelector('.cg-selection');if(this.mode==='flow')return;
  const detail=document.createElement('div');detail.className='cg-edge-detail';detail.innerHTML=`<b>${esc(e.label)}</b><span>${esc(e.a.label)} → ${esc(e.b.label)}</span><small>${e.status==='MAPPED'?'语义映射 · 需要领域评审':'源码结构证据 · 非运行时执行记录'}</small>`;panel.querySelector('.cg-selection-sub').after(detail);
 }
 fit(animate=false){
  const w=this.el.clientWidth,h=this.el.clientHeight;if(!w||!h)return;const padX=this.mode==='flow'?135:65,padY=this.mode==='flow'?45:60,xs=this.nodes.map(n=>n.x),ys=this.nodes.map(n=>n.y),x0=xs.length?Math.min(...xs)-padX:0,y0=ys.length?Math.min(...ys)-padY:0,bw=xs.length?Math.max(...xs)-x0+padX:this.world.w,bh=ys.length?Math.max(...ys)-y0+padY:this.world.h;
  const available=w-(this.selected&&this.mode!=='flow'&&w>560?300:0),top=this.mode==='flow'?55:100,bottom=this.mode==='flow'?50:85,k=Math.max(.03,Math.min(1,(available-50)/bw,(h-top-bottom)/bh));const next={k,x:(available-bw*k)/2-x0*k,y:top+(h-top-bottom-bh*k)/2-y0*k};if(animate)this.cameraTo(next);else{this.transform=next;this.apply();}
 }
 centerOn(n){this.userMoved=true;const k=Math.max(.85,Math.min(1.4,this.transform.k)),w=this.el.clientWidth;this.cameraTo({k,x:(w>780?w*.38:w*.5)-n.x*k,y:this.el.clientHeight*.46-n.y*k});}
 cameraTo(next){cancelAnimationFrame(this.cameraFrame);if(this.reduced.matches){this.transform=next;this.apply();return;}const before={...this.transform},start=performance.now();const step=now=>{if(this.destroyed)return;const t=Math.min(1,(now-start)/420),ease=1-(1-t)**3;for(const key of ['x','y','k'])this.transform[key]=before[key]+(next[key]-before[key])*ease;this.apply();if(t<1)this.cameraFrame=requestAnimationFrame(step);};this.cameraFrame=requestAnimationFrame(step);}
 zoom(factor,x=this.el.clientWidth/2,y=this.el.clientHeight/2){this.userMoved=true;cancelAnimationFrame(this.cameraFrame);const old=this.transform.k,k=Math.max(.03,Math.min(4,old*factor));this.transform={x:x-(x-this.transform.x)*k/old,y:y-(y-this.transform.y)*k/old,k};this.apply();}
 apply(){this.viewport.setAttribute('transform',`translate(${this.transform.x},${this.transform.y}) scale(${this.transform.k})`);const size=Math.max(11,10/this.transform.k);this.nodeLayer.querySelectorAll('.node-label').forEach(t=>t.style.fontSize=`${size}px`);this.linkLayer.querySelectorAll('.graph-link-label').forEach(t=>t.style.fontSize=`${Math.max(12,9/this.transform.k)}px`);if(this.nodes&&this.links)this.highlight();}
}
