const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// The viewer uses the original image URL. Its scrolling/zoom state is separate
// from the editing surface, so viewing never changes stored sticker coordinates.
export function createMapImageViewer() {
  let dialog,viewport,stage,photo,scale=1,fitWidth=1,naturalWidth=1;
  function reset(){dialog?.remove();dialog=null;viewport=null;stage=null;photo=null;}
  function resize(next,center) {
    if(!dialog||!photo?.naturalWidth)return;
    const max=Math.max(8,naturalWidth/fitWidth);
    next=Math.max(.25,Math.min(max,next));
    const x=center?.x??viewport.clientWidth/2,y=center?.y??viewport.clientHeight/2;
    const oldWidth=stage.getBoundingClientRect().width,oldHeight=stage.getBoundingClientRect().height;
    const rx=oldWidth?(viewport.scrollLeft+x)/oldWidth:0,ry=oldHeight?(viewport.scrollTop+y)/oldHeight:0;
    scale=next;stage.style.width=`${fitWidth*scale}px`;
    viewport.scrollLeft=rx*stage.getBoundingClientRect().width-x;
    viewport.scrollTop=ry*stage.getBoundingClientRect().height-y;
    dialog.querySelector('[data-zoom-value]').textContent=`${Math.round(scale*100)}%`;
    dialog.querySelector('[data-zoom-out]').disabled=scale<=.25;
    dialog.querySelector('[data-zoom-in]').disabled=scale>=max;
  }
  function fit() {
    if(!photo?.naturalWidth)return;
    naturalWidth=photo.naturalWidth;
    fitWidth=Math.min(naturalWidth,Math.max(1,viewport.clientWidth));
    resize(1);viewport.scrollTo(0,0);
  }
  function open({title,url,width,height,markers=[]}) {
    reset();dialog=document.createElement('dialog');dialog.className='hm-zoom-dialog';dialog.setAttribute('aria-label','위치도 확대 보기');
    dialog.innerHTML=`<div class="hm-zoom-heading"><h2>${escape(title)} · 확대 보기</h2><button type="button" class="btn btn-outline" data-zoom-close>닫기</button></div><div class="hm-zoom-controls"><div role="group" aria-label="도면 배율"><button type="button" class="btn btn-outline" data-zoom-out aria-label="도면 축소">−</button><span data-zoom-value role="status" aria-live="polite">불러오는 중</span><button type="button" class="btn btn-outline" data-zoom-in aria-label="도면 확대">＋</button></div><button type="button" class="btn btn-outline" data-zoom-fit>화면 맞춤</button><button type="button" class="btn btn-outline" data-zoom-original>원본 크기</button><label><input type="checkbox" data-zoom-markers>스티커 표시</label></div><p class="hm-zoom-hint" data-zoom-hint>확대 후 가로·세로로 스크롤해 글씨를 확인하세요. 스티커 표시는 필요할 때 켤 수 있습니다.</p><div class="hm-zoom-viewport" tabindex="0" aria-label="확대 도면. 스크롤하여 이동"><div class="hm-zoom-stage"><img src="${escape(url)}" width="${Number(width)}" height="${Number(height)}" alt="${escape(title)} 확대 원본" draggable="false"><div class="hm-zoom-markers" hidden>${markers.map(m=>`<span class="hm-zoom-marker" style="left:${m.x*100}%;top:${m.y*100}%;transform:translate(${m.x>.75?-100:m.x<.25?0:-50}%,${m.y>.8?-100:m.y<.2?0:-50}%)">${escape(m.label)}</span>`).join('')}</div></div></div>`;
    document.body.append(dialog);viewport=dialog.querySelector('.hm-zoom-viewport');stage=dialog.querySelector('.hm-zoom-stage');photo=stage.querySelector('img');
    dialog.querySelector('[data-zoom-close]').onclick=()=>dialog.close();
    dialog.querySelector('[data-zoom-out]').onclick=()=>resize(scale/1.5);
    dialog.querySelector('[data-zoom-in]').onclick=()=>resize(scale*1.5);
    dialog.querySelector('[data-zoom-fit]').onclick=fit;
    dialog.querySelector('[data-zoom-original]').onclick=()=>resize(naturalWidth/fitWidth);
    dialog.querySelector('[data-zoom-markers]').onchange=e=>{dialog.querySelector('.hm-zoom-markers').hidden=!e.target.checked;};
    dialog.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.target.tagName==='INPUT')return;if(['+','=','-','0'].includes(e.key)){e.preventDefault();if(e.key==='0')fit();else resize(e.key==='-'?scale/1.5:scale*1.5);}});
    const activePhoto=photo;
    photo.onload=()=>{if(photo===activePhoto)fit();};
    photo.onerror=()=>{if(photo!==activePhoto)return;dialog.querySelector('[data-zoom-hint]').textContent='사진을 불러오지 못했습니다. 닫은 뒤 위치도를 새로고침해 주세요.';dialog.querySelectorAll('.hm-zoom-controls button').forEach(button=>button.disabled=true);};
    dialog.showModal();if(photo.complete&&photo.naturalWidth)fit();
  }
  return {open,reset};
}
