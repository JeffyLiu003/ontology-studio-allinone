// Prefer browser fullscreen; embedded browsers may only allow an in-page fullscreen view.
export class GraphFullscreen {
 constructor(el, onResize) {
  this.el=el;this.onResize=onResize;this.fallback=false;this.dead=false;
  this.change=()=>this.sync();
  this.escape=e=>{if(e.key==='Escape'&&this.fallback){e.preventDefault();this.leaveFallback();}};
  document.addEventListener('fullscreenchange',this.change);
  document.addEventListener('keydown',this.escape);
 }
 get active(){return document.fullscreenElement===this.el||this.fallback;}
 sync(){
  if(this.dead)return;
  if(this.active&&!this.portals){
   this.portals=['inspector','modal-root','toast-root'].map(id=>document.getElementById(id)).filter(Boolean).map(node=>{
    const anchor=document.createComment('graph-fullscreen-portal');node.before(anchor);this.el.append(node);return {node,anchor};
   });
  }else if(!this.active)this.restorePortals();
  const button=this.el.querySelector('[data-graph="fullscreen"]');
  if(button){const label=this.active?'退出图谱全屏':'全屏显示图谱';button.setAttribute('aria-label',label);button.title=this.active?'退出全屏（Esc）':label;button.setAttribute('aria-expanded',String(this.active));button.querySelector('span').textContent=this.active?'退出全屏':'全屏';}
  this.onResize();
 }
 restorePortals(){
  for(const {node,anchor} of this.portals||[]){anchor.replaceWith(node);}
  this.portals=null;
 }
 leaveFallback(){
  if(!this.fallback)return;
  this.fallback=false;this.el.classList.remove('graph-page-fullscreen');document.body.style.overflow=this.oldOverflow;this.sync();
 }
 async toggle(){
  if(this.active){
   if(this.fallback)this.leaveFallback();
   else try{await document.exitFullscreen();}catch{this.sync();}
   return;
  }
  if(this.el.requestFullscreen&&document.fullscreenEnabled){
   try{await this.el.requestFullscreen();if(this.dead&&document.fullscreenElement===this.el)await document.exitFullscreen();return;}catch{/* Embedded browser: use the whole page instead. */}
  }
  if(this.dead)return;
  this.oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';this.fallback=true;this.el.classList.add('graph-page-fullscreen');this.sync();
 }
 destroy(){
  document.removeEventListener('fullscreenchange',this.change);document.removeEventListener('keydown',this.escape);
  this.dead=true;this.leaveFallback();
  this.restorePortals();
  if(document.fullscreenElement===this.el)document.exitFullscreen().catch(()=>{});
 }
}
