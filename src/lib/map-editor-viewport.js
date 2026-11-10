const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

// Transform the image and its sticker layer together. Coordinates continue to
// come from the transformed image rectangle, rather than screen/viewport pixels.
export function createMapEditorViewport({isEnabled=()=>true,onGestureStart=()=>{},onTap=()=>{}}={}) {
  let container,viewport,stage,photo,controller,observer,key=null;
  let scale=1,x=0,y=0,bw=0,bh=0,suppressUntil=0;
  const points=new Map();let pan=null,pinch=null,waitForRelease=false;
  function cleanup(){controller?.abort();observer?.disconnect();points.clear();pan=null;pinch=null;waitForRelease=false;}
  function reset(){cleanup();container=viewport=stage=photo=null;key=null;scale=1;x=y=bw=bh=0;suppressUntil=0;}
  const maximum=()=>Math.max(8,(photo?.naturalWidth||bw)/Math.max(1,bw));
  function paint(){
    if(!stage||!bw||!bh)return;
    scale=clamp(scale,1,maximum());x=clamp(x,bw-bw*scale,0);y=clamp(y,bh-bh*scale,0);
    stage.style.setProperty('--hm-pin-scale',String(1/scale));
    stage.style.transform=`translate(${x}px,${y}px) scale(${scale})`;
    viewport.classList.toggle('is-zoomed',scale>1.001);
    container.querySelector('[data-editor-zoom-value]').textContent=`${Math.round(scale*100)}%`;
    container.querySelector('[data-editor-zoom=out]').disabled=!isEnabled()||scale<=1;
  }
  function measure(){
    if(!stage)return;
    const nw=stage.offsetWidth,nh=stage.offsetHeight;
    if(!nw||!nh)return;
    if(bw&&bw!==nw){x*=nw/bw;y*=nh/bh;}
    bw=nw;bh=nh;viewport.style.height=`${bh}px`;paint();
  }
  function zoom(next,cx=viewport.clientWidth/2,cy=viewport.clientHeight/2){
    if(!isEnabled()||!photo?.naturalWidth)return;
    const target=clamp(next,1,maximum()),ratio=target/scale;
    x=cx-(cx-x)*ratio;y=cy-(cy-y)*ratio;scale=target;paint();
  }
  function beginPinch(){
    const [a,b]=[...points.values()],rect=viewport.getBoundingClientRect();
    onGestureStart();pan=null;
    const mx=(a.x+b.x)/2-rect.left,my=(a.y+b.y)/2-rect.top;
    pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),scale,ix:(mx-x)/scale,iy:(my-y)/scale};
    for(const id of points.keys())try{viewport.setPointerCapture(id);}catch{}
  }
  function scrollParent(){
    let el=viewport.parentElement;
    while(el){if(/auto|scroll/.test(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight)return el;el=el.parentElement;}
    return document.scrollingElement;
  }
  function down(e){
    if(!isEnabled()||!photo?.naturalWidth)return;
    if(!points.size)suppressUntil=0;
    const touch=e.pointerType==='touch',pin=Boolean(e.target.closest('.hm-pin'));
    if(touch){
      points.set(e.pointerId,{x:e.clientX,y:e.clientY,pin});
      if(points.size>=2){if(!pinch)beginPinch();e.preventDefault();e.stopPropagation();return;}
    }
    if(pin)return; // A single pointer on a sticker belongs to sticker dragging.
    if(!touch && e.button!==1 && !(e.button===0&&scale>1))return;
    pan={id:e.pointerId,sx:e.clientX,sy:e.clientY,lastY:e.clientY,x,y,moved:false,touch,button:e.button};
    viewport.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation();
  }
  function move(e){
    if(points.has(e.pointerId))points.set(e.pointerId,{...points.get(e.pointerId),x:e.clientX,y:e.clientY});
    if(pinch&&points.size>=2){
      const [a,b]=[...points.values()],rect=viewport.getBoundingClientRect();
      scale=clamp(pinch.scale*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance,1,maximum());
      x=(a.x+b.x)/2-rect.left-pinch.ix*scale;y=(a.y+b.y)/2-rect.top-pinch.iy*scale;paint();
      e.preventDefault();e.stopPropagation();return;
    }
    if(waitForRelease){e.preventDefault();e.stopPropagation();return;}
    if(!pan||pan.id!==e.pointerId)return;
    const dx=e.clientX-pan.sx,dy=e.clientY-pan.sy;
    if(!pan.moved&&Math.hypot(dx,dy)<6)return;
    pan.moved=true;
    if(scale>1){x=pan.x+dx;y=pan.y+dy;paint();}
    else if(pan.touch){const parent=scrollParent();if(parent)parent.scrollTop-=e.clientY-pan.lastY;}
    pan.lastY=e.clientY;e.preventDefault();e.stopPropagation();
  }
  function up(e){
    const wasPinch=Boolean(pinch)||waitForRelease;
    points.delete(e.pointerId);
    if(wasPinch){
      pinch=null;pan=null;waitForRelease=points.size>0;suppressUntil=performance.now()+500;
      e.preventDefault();e.stopPropagation();
    }else if(pan?.id===e.pointerId){
      const old=pan;pan=null;suppressUntil=performance.now()+500;
      e.preventDefault();e.stopPropagation();
      if(!old.moved&&old.button===0&&e.type==='pointerup')onTap(e.clientX,e.clientY);
    }
    if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);
  }
  function mount(element,mapKey){
    cleanup();
    if(key!==mapKey){scale=1;x=y=bw=bh=0;suppressUntil=0;}key=mapKey;
    container=element;viewport=container.querySelector('.hm-editor-viewport');stage=container.querySelector('#hmStage');photo=container.querySelector('#hmPhoto');
    controller=new AbortController();const signal=controller.signal;
    viewport.addEventListener('wheel',e=>{if(!isEnabled()||!photo.naturalWidth)return;e.preventDefault();const rect=viewport.getBoundingClientRect(),delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?viewport.clientHeight:1);zoom(scale*Math.exp(-delta*.002),e.clientX-rect.left,e.clientY-rect.top);},{passive:false,signal});
    viewport.addEventListener('pointerdown',down,{capture:true,signal});
    viewport.addEventListener('pointermove',move,{capture:true,signal});
    viewport.addEventListener('pointerup',up,{capture:true,signal});
    viewport.addEventListener('pointercancel',up,{capture:true,signal});
    viewport.addEventListener('click',e=>{if(performance.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}},{capture:true,signal});
    viewport.addEventListener('auxclick',e=>{if(e.button===1)e.preventDefault();},{signal});
    container.querySelectorAll('[data-editor-zoom]').forEach(button=>button.addEventListener('click',()=>{
      if(button.dataset.editorZoom==='fit'){scale=1;x=y=0;paint();}else zoom(scale*(button.dataset.editorZoom==='in'?1.5:1/1.5));
    },{signal}));
    photo.addEventListener('load',measure,{signal});observer=new ResizeObserver(()=>{if(stage.offsetWidth!==bw)measure();});observer.observe(viewport);measure();
  }
  return {mount,reset};
}
