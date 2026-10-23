import {BINDER_ASCII_ADVANCE} from '../data/binder-font-metrics.js';
import {BINDER_TEMPLATES} from '../data/binder-templates.js';
import {BINDER_WIDTHS,isBinderWidth,escapeBinderText,normalizeBinderDocument} from './binder-document.js';
export {BINDER_WIDTHS,escapeBinderText};

// 기존 4열 붙여넣기 지원. 새 엑셀 가져오기는 분류별 필드를 별도로 보존한다.
export function parseBinderCatalog(text) {
 const rows=String(text).split(/\r?\n/).filter(row=>row.trim());
 if(rows.length>200)throw new Error('문서 목록은 최대 200개까지 등록할 수 있습니다.');
 const seen=new Set();
 return rows.map((row,i)=>{
  const [code,title,cm,category='보건',...extra]=row.split('\t').map(v=>v.trim());
  const width=cm===''?null:Number(cm)*10;
  if(!code||!title||cm===undefined||extra.length||(width!==null&&!isBinderWidth(width)))throw new Error(`${i+1}행: 번호, 제목, 폭(cm), 분류를 탭으로 구분해주세요.`);
  if(seen.has(code))throw new Error(`중복 문서번호: ${code}`);
  seen.add(code);return {code,title,width,category};
 });
}
export function paginateBinderLabels(items,copies=1) {
 if(!Number.isInteger(copies)||copies<1||copies>20)throw new Error('매수는 1~20 사이의 정수로 입력해주세요.');
 const pages=[];let row=[],used=0;
 for(const item of items){
  if(!isBinderWidth(item.width))throw new Error('바인더 폭을 20~190mm로 지정해주세요.');
  for(let i=0;i<copies;i++){
   if(used+(row.length?4:0)+item.width>190){pages.push(row);row=[];used=0;}
   used+=(row.length?4:0)+item.width;row.push(item);
  }
 }
 if(row.length)pages.push(row);return pages;
}

// 제목은 언제나 한 열이며 줄바꿈 입력도 한 줄로 합친다.
export function binderTitleLines(title) {return [String(title).replace(/\s*\r?\n\s*/g,' ').trim()];}
export function binderTemplate(width) {
 return BINDER_TEMPLATES[width === 90 ? 90 : width === 70 ? 70 : width >= 80 ? 90 : 70];
}
const pct = (value,total) => (value/total*100).toFixed(6)+'%';
function position(box,template) {
 return `left:${pct(box.x,template.widthPt)};top:${pct(box.y,template.heightPt)};width:${pct(box.width,template.widthPt)};height:${pct(box.height,template.heightPt)}`;
}
function borderSvg(template) {
 const paths=template.borders.map(({xy,style})=>{
  const [x1,y1,x2,y2]=xy;
  if(style==='double'){
   const vertical=x1===x2,dx=vertical?1.125:0,dy=vertical?0:1.125;
   return [-1,1].map(sign=>`<path d="M${x1+sign*dx},${y1+sign*dy}L${x2+sign*dx},${y2+sign*dy}" stroke-width=".75"/>`).join('');
  }
  const weight={hair:.25,thin:.75,medium:1.5,thick:2.25}[style]??.75;
  const dash=style==='dashed'?' stroke-dasharray="3 2"':style==='dotted'?' stroke-dasharray="1 1"':'';
  return `<path d="M${x1},${y1}L${x2},${y2}" stroke-width="${weight}"${dash}/>`;
 }).join('');
 return `<svg class="binder-source-borders" aria-hidden="true" viewBox="0 0 ${template.widthPt} ${template.heightPt}" preserveAspectRatio="none" overflow="visible"><g fill="none" stroke="#000" stroke-linecap="butt">${paths}</g></svg>`;
}
export const binderPrintCss=`
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box}
html,body{margin:0;color:#000;font-family:'BinderHY','HY헤드라인M','HYHeadLine-Medium','Malgun Gothic','Noto Sans CJK KR','Apple SD Gothic Neo',sans-serif}
.binder-sheet{width:210mm;height:297mm;padding:10mm;display:flex;align-items:flex-start;gap:4mm;break-after:page;page-break-after:always;background:#fff}
.binder-sheet:last-child{break-after:auto;page-break-after:auto}
.binder-label{flex-shrink:0;position:relative;text-align:center;background:#fff;font-weight:900;isolation:isolate}.binder-cut-frame{position:absolute;inset:0;z-index:5;border:.25mm solid #000;pointer-events:none}
.binder-source-borders{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2}
.binder-box{position:absolute;display:flex;align-items:center;justify-content:center;min-width:0;overflow:hidden;overflow-wrap:anywhere;line-height:1.1;padding:.25mm}
.binder-site{background:#ffc000;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.binder-title{position:absolute;display:flex;align-items:center;justify-content:center;overflow:hidden}
.binder-title-lines{display:flex;flex-direction:row;align-items:flex-start;justify-content:center;gap:.5mm}
.binder-title-column{display:flex;flex-direction:column;align-items:center;line-height:1}
.binder-title-character{display:block;flex-shrink:0;white-space:pre;line-height:1}.binder-title-latin{writing-mode:vertical-rl;text-orientation:sideways;width:1em;text-align:center}
.binder-footer{position:absolute;display:grid}
.binder-footer>div{display:flex;align-items:center;justify-content:center;white-space:pre-line;overflow-wrap:anywhere;overflow:hidden;line-height:1.1;padding:.25mm}
.binder-logo{position:absolute;display:flex;align-items:center;justify-content:center}
.binder-logo img{display:block;height:100%;max-width:calc(100% - 2mm);max-height:calc(100% - 1mm);object-fit:contain}
@media print{html,body{width:210mm;background:#fff}.binder-sheet{margin:0}}
`;
// Preserve every original character. Latin runs use native sideways vertical text;
// word spaces use less vertical room than Korean glyphs, without overlapping glyphs.
export function binderTitleTokens(title){
 return [...binderTitleLines(title)[0].matchAll(/[!-~]+(?: +[!-~]+)*| +|[^!-~ ]/gu)].map(match=>{
  const text=match[0],space=/^ +$/.test(text),latin=/^[!-~]/.test(text);
  const units=space?text.length*.35:latin?Array.from(text).reduce((sum,c)=>sum+(BINDER_ASCII_ADVANCE[c]??.35),0)+.08:1;
  return {text,units,latin,space};
 });
}
export function binderTitleSize(doc,height=260){
 const template=binderTemplate(doc.width),box=template.boxes.title;
 const scale=Math.min(doc.width*72/25.4/template.widthPt,height*72/25.4/template.heightPt);
 const units=binderTitleTokens(doc.title).reduce((sum,t)=>sum+t.units,0);
 return Math.min(template.fonts.title*scale,(box.height/template.heightPt*height*72/25.4-2)/(Math.max(1,units)),(box.width/template.widthPt*doc.width*72/25.4-2)/1.15);
}
export function binderSheetsHtml(items,{site='',height=260,copies=1}={}) {
 if(!Number.isFinite(height)||height<180||height>277)throw new Error('라벨 높이는 180~277mm로 입력해주세요.');
 if(!String(site).trim()||String(site).length>60)throw new Error('현장명을 1~60자로 입력해주세요.');
 const esc=escapeBinderText;
 return paginateBinderLabels(items,copies).map(page=>`<section class="binder-sheet">${page.map(item=>{
  const doc=normalizeBinderDocument(item),template=binderTemplate(doc.width),boxes=template.boxes;
  const scale=Math.min(doc.width*72/25.4/template.widthPt,height*72/25.4/template.heightPt);
  const boxFont=(key,text)=>{
   const box=boxes[key],w=box.width/template.widthPt*doc.width*72/25.4,h=box.height/template.heightPt*height*72/25.4;
   let font=(template.fonts[key]??17)*scale;
   for(let i=0;i<80;i++){
    const cols=Math.max(1,Math.floor((w-1.5)/font)),rows=Math.max(1,Math.floor((h-1.5)/(font*1.1)));
    if(cols*rows>=Array.from(String(text)).length||font<3)break;font*=.94;
   }
   return font.toFixed(3);
  };
  const textBox=(key,text,cls='')=>`<div class="binder-box ${cls}" style="${position(boxes[key],template)};font-size:${boxFont(key,text)}pt">${esc(text)}</div>`;
  const lines=binderTitleLines(doc.title),font=binderTitleSize(doc,height);
  const codeRatio=boxes.majorCode.width/template.widthPt*100;
  const footerGrid=`${codeRatio}% ${codeRatio}% ${codeRatio}% ${100-codeRatio*3}%`;
  const footerBottom=boxes.footer.y+boxes.footer.height;
  const logoBox={x:0,y:footerBottom,width:template.widthPt,height:template.heightPt-footerBottom};
  const label=doc.labelNumber?`(${doc.labelNumber})`:'';
  return `<article class="binder-label" data-template="${template.name}" data-document="${esc(doc.code)}" style="width:${doc.width}mm;height:${height}mm"><div class="binder-cut-frame" aria-hidden="true"></div>${textBox('site',site,'binder-site')}${textBox('majorCode',doc.majorCode,'binder-class-code')}${textBox('majorName',doc.majorName,'binder-class-name')}${textBox('middleCode',doc.middleCode,'binder-class-code')}${textBox('middleName',doc.middleName,'binder-class-name')}${textBox('minor',doc.minorNumber,'binder-minor')}<div class="binder-title" style="${position(boxes.title,template)}"><div class="binder-title-lines" style="font-size:${font.toFixed(3)}pt">${lines.map((line,index)=>`<div class="binder-title-column" data-line="${index+1}">${binderTitleTokens(line).map(t=>`<span class="binder-title-character${t.latin?' binder-title-latin':''}" style="height:${t.units}em">${esc(t.text)}</span>`).join('')}</div>`).join('')}</div></div>${textBox('number',label,'binder-number')}<div class="binder-footer" style="${position(boxes.footer,template)};grid-template-columns:${footerGrid};font-size:${(template.fonts.footer*scale).toFixed(3)}pt"><div>${esc(doc.footer1)}</div><div>${esc(doc.footer2)}</div><div>${esc(doc.footer3)}</div><div>현장<br>안전</div></div><div class="binder-logo" style="${position(logoBox,template)}"><img style="width:${pct(template.logo.width,template.widthPt)}" src="${template.logoData}" alt="GS건설"></div>${borderSvg(template)}</article>`;
 }).join('')}</section>`).join('');
}
export function buildBinderPrintHtml(items,options) {
 if(!items.length)throw new Error('인쇄할 문서를 선택해주세요.');
 return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>바인더 표지</title><style>${binderPrintCss}${options?.fontCss || ''}</style></head><body>${binderSheetsHtml(items,options)}</body></html>`;
}
