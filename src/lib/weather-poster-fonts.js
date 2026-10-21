import { posterLocale } from './weather-poster-i18n.js';
const cache=new Map();
export async function loadPosterFont(lang='ko') {
 const l=posterLocale(lang);
 if(!cache.has(l.lang))cache.set(l.lang,(async()=>{
  let fontCss='';
  if(l.lang!=='ko'){
   const response=await fetch(`/fonts/poster-${l.lang}.otf`);
   if(!response.ok)throw new Error('포스터 글꼴을 불러오지 못했습니다. 잠시 후 다시 선택해주세요.');
   const bytes=await response.arrayBuffer();
   const face=new FontFace(l.font,bytes);await face.load();document.fonts.add(face);
   let binary='';for(const byte of new Uint8Array(bytes))binary+=String.fromCharCode(byte);
   fontCss=`@font-face{font-family:'${l.font}';src:url(data:font/otf;base64,${btoa(binary)}) format('opentype');font-style:normal;font-weight:400;}`;
  }
  const context=document.createElement('canvas').getContext('2d');
  return {fontCss,measureText:(text,size,weight=400)=>{
   context.font=`${weight} ${size}px '${l.font}','Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif`;
   return context.measureText(text).width;
  }};
 })().catch(error=>{cache.delete(l.lang);throw error;}));
 return cache.get(l.lang);
}
