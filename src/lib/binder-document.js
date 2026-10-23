import {parseBinderNumbers} from './binder-numbers.js';
export const BINDER_WIDTHS = [70,90];
export const isBinderWidth = width => Number.isInteger(width) && width >= 20 && width <= 190;
export const escapeBinderText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function normalizeBinderDocument(value) {
  const code = String(value.code || '').trim();
  const parts = code.match(/^([^-]+)-([^-]+)-(.+)$/);
  const category = String(value.category || '').replace(/^[A-Z]\s*[·.]?\s*/, '').trim();
  const doc={...value,
    majorCode:String(value.majorCode ?? parts?.[1] ?? 'SR').trim(),
    majorName:String(value.majorName ?? '안전보건').trim(),
    middleCode:String(value.middleCode ?? parts?.[2] ?? 'E').trim(),
    middleName:String(value.middleName ?? (category || '보건')).trim(),
    minorNumber:String(value.minorNumber ?? parts?.[3] ?? code).trim(),
    title:String(value.title || '').trim(),
    numberExpression:String(value.numberExpression || '').trim(),
    width:value.width == null || value.width === '' ? null:Number(value.width),
    labelNumber:String(value.labelNumber ?? '1').trim().replace(/^\((.*)\)$/,'$1'),
  };
  delete doc.printTitle;
  doc.code=`${doc.majorCode}-${doc.middleCode}-${doc.minorNumber}`;
  doc.category=`${doc.middleCode} · ${doc.middleName}`;
  doc.id=String(value.id || value.standardId || doc.code);
  doc.title=doc.title.replace(/\s*\r?\n\s*/g,' ');
  for(const key of ['details','security','retention','storage','note','footer1','footer2','footer3'])doc[key]=String(value[key] ?? '');
  return doc;
}

export function validateBinderCatalog(values) {
  if(!Array.isArray(values)||values.length>200)throw new Error('문서 목록은 최대 200개까지 등록할 수 있습니다.');
  const seen=new Set(),ids=new Set();
  return values.map((value,i)=>{
    const doc=normalizeBinderDocument(value);
    for(const [key,max] of [['majorCode',8],['majorName',30],['middleCode',8],['middleName',30],['minorNumber',30],['title',120]]) {
      if(!doc[key]||doc[key].length>max)throw new Error(`${i+1}행: 분류·번호·제목을 확인해주세요. 제목은 120자 이내입니다.`);
      if(key!=='title' && /[\t\r\n]/.test(doc[key]))throw new Error(`${i+1}행: 분류·번호에 줄바꿈을 넣을 수 없습니다.`);
    }
    if(doc.numberExpression)parseBinderNumbers(doc.numberExpression);
    if(doc.majorCode.includes('-')||doc.middleCode.includes('-'))throw new Error('대·중분류 기호에는 하이픈을 넣을 수 없습니다.');
    if(doc.width!==null&&!isBinderWidth(doc.width))throw new Error('폭은 20~190mm 정수로 지정해주세요.');
    for(const key of ['labelNumber','footer1','footer2','footer3'])if(doc[key].length>12)throw new Error('번호 라벨과 하단 칸은 각각 12자 이내로 입력해주세요.');
    for(const key of ['details','security','retention','storage','note'])if(doc[key].length>2000)throw new Error('문서 상세 정보는 항목별 2,000자 이내입니다.');
    if(seen.has(doc.code))throw new Error(`중복 문서번호: ${doc.code}`);
    if(ids.has(doc.id))throw new Error('문서 ID가 중복되었습니다. 복사한 새 문서의 문서 ID를 비워주세요.');
    if(doc.id.length>100)throw new Error('문서 ID는 100자 이내여야 합니다.');
    ids.add(doc.id);seen.add(doc.code);return doc;
  });
}

export const BINDER_COLUMNS=[['majorCode','대분류 기호'],['majorName','대분류 명칭'],['middleCode','중분류 기호'],['middleName','중분류 명칭'],['minorNumber','소분류 번호'],['title','소분류 제목'],['details','세부내용'],['security','보안등급'],['retention','보존기한'],['storage','보전방법'],['note','비고'],['width','폭(cm)'],['labelNumber','번호 라벨링'],['footer1','하단 1'],['footer2','하단 2'],['footer3','하단 3'],['numberExpression','인쇄번호 목록'],['standardId','기본 항목 ID'],['id','문서 ID']];
export function binderRowsToCatalog(rows) {
  if(!rows.length)throw new Error('목록표가 비어 있습니다.');
  const headers=rows[0].map(v=>String(v ?? '').trim());
  for(const [,name] of BINDER_COLUMNS.slice(0,6))if(!headers.includes(name))throw new Error(`목록표에 '${name}' 열이 필요합니다.`);
  const docs=rows.slice(1).filter(r=>r.some(v=>String(v??'').trim())).map(row=>Object.fromEntries(BINDER_COLUMNS.map(([key,name])=>{
    if(key==='width'){
      const cm=headers.indexOf('폭(cm)'),mm=headers.indexOf('폭(mm)');
      if(cm>=0){const raw=String(row[cm]??'').trim().replace(/cm$/i,'').trim();return [key,raw===''?null:Number(raw)*10];}
      return [key,mm>=0?row[mm]??'':''];
    }
    return [key,headers.includes(name) ? row[headers.indexOf(name)] ?? '' : key==='labelNumber'?'1':''];
  })));
  return validateBinderCatalog(docs);
}

export function binderCatalogToRows(docs){
 return [BINDER_COLUMNS.map(([,name])=>name),...docs.map(d=>BINDER_COLUMNS.map(([key])=>key==='width'?(d.width==null?'':d.width/10):d[key]??''))];
}

export function binderCategoryKey(doc) {return `${doc.majorCode}/${doc.middleCode}`;}
export function filterBinderDocuments(docs,{query='',category='all',selectedOnly=false,selected=new Set()}={}) {
 const q=String(query).toLocaleLowerCase().replace(/\s+/g,' ').trim();
 return docs.filter(d=>(category==='all'||binderCategoryKey(d)===category)&&(!selectedOnly||selected.has(d.code))&&(!q||`${d.code} ${d.title} ${d.majorCode} ${d.majorName} ${d.middleCode} ${d.middleName} ${d.details} ${d.note}`.toLocaleLowerCase().replace(/\s+/g,' ').includes(q)));
}
