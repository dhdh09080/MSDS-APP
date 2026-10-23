import {escapeBinderText as esc,binderSheetsHtml,binderPrintCss,buildBinderPrintHtml,paginateBinderLabels,binderTitleSize} from './binder-print.js';
import {BINDER_WIDTHS,BINDER_COLUMNS,binderCatalogToRows,binderRowsToCatalog,validateBinderCatalog,filterBinderDocuments,binderCategoryKey} from './binder-document.js';
import {BINDER_STANDARD,BINDER_STANDARD_VERSION} from '../data/binder-standard.js';
import {createBinderCatalogStore} from './binder-catalog.js';
import {openPrintWindow,toast} from './ui.js';
import {createBinderPrintRequest,lastBinderPrint,nextBinderNumber} from './binder-history.js';
import {loadBinderLocalFont} from './binder-font.js';
import {expandBinderNumbers,parseBinderNumbers,sequenceBinderNumbers} from './binder-numbers.js';
import './binder-workbench.css';

const EDIT_FIELDS=[['majorCode','대분류 기호',8],['majorName','대분류 명칭',30],['middleCode','중분류 기호',8],['middleName','중분류 명칭',30],['minorNumber','소분류 번호',30],['labelNumber','번호 라벨링 (괄호 자동)',12],['footer1','하단 첫 번째 칸',12],['footer2','하단 두 번째 칸',12],['footer3','하단 세 번째 칸',12],['details','세부내용',2000],['security','보안등급',2000],['retention','보존기한',2000],['storage','보전방법',2000],['note','비고',2000]];
const fieldId=key=>'binderEdit'+key[0].toUpperCase()+key.slice(1);
const widthOptions=width=>`<option value="">선택</option>${width!=null&&!BINDER_WIDTHS.includes(width)?`<option value="${esc(width)}" selected disabled>기존 ${esc(width/10)}cm · 재선택</option>`:''}${BINDER_WIDTHS.map(w=>`<option value="${w}" ${width===w?'selected':''}>${w/10}cm</option>`).join('')}`;
export async function mountBinderWorkbench(root,{workspace,client,preview:isPreview=false}) {
 const token={};root.binderMountToken=token;root.inert=false;root.textContent='현장 문서 목록을 불러오는 중입니다…';
 const store=createBinderCatalogStore(client,workspace.id,isPreview);
 let catalog;
 try{catalog=await store.load();}catch(error){if(root.binderMountToken===token)root.textContent=`현장 문서 목록을 불러오지 못했습니다. 메뉴를 다시 열어주세요. ${error.message}`;return;}
 if(root.binderMountToken!==token)return;
 let selected=new Set(),editing=null,category='all',font={ready:false,css:'',source:'HY헤드라인M 확인 중'};
 root.innerHTML=`<div class="binder-command-bar"><div class="binder-site-field"><label for="binderSite">현장명</label><input id="binderSite" class="form-input" maxlength="60" value="${esc(workspace.name)}"></div><label>높이 <input id="binderHeight" class="form-input" type="number" min="180" max="277" value="260"> mm</label><label>번호당 복사본 <input id="binderCopies" class="form-input" type="number" min="1" max="20" value="1"></label><button id="binderNew" type="button" class="btn btn-outline">+ 문서 추가</button><button id="binderManageOpen" type="button" class="btn btn-outline">목록 관리</button><button id="binderPrint" class="btn btn-primary" disabled>A4 인쇄</button></div>

 <p id="binderCatalogError" role="alert"></p><div class="binder-layout"><section class="card binder-documents"><div class="binder-search-row"><label class="sr-only" for="binderSearch">전체 문서 검색</label><input id="binderSearch" class="form-input" type="search" placeholder="전체 문서명 · 번호 · 분류 · 상세내용 검색"><label class="binder-selected-filter"><input id="binderSelectedOnly" type="checkbox">선택만</label></div><div id="binderCategories" class="binder-categories" aria-label="문서 분류"></div><div class="binder-selection"><button id="binderListNew" type="button" class="btn btn-outline btn-sm">+ 문서 추가</button><button id="binderAll" type="button" class="btn btn-outline btn-sm">검색 결과 전체 선택</button><button id="binderNumbersOpen" type="button" class="btn btn-outline btn-sm">번호 묶음 설정</button><button id="binderNone" type="button" class="btn btn-outline btn-sm">선택 해제</button><span id="binderListCount"></span></div><div class="binder-list-head"><span>문서 / 마지막 인쇄 요청</span><span>바인더 폭</span><span>인쇄번호</span><span></span></div><div id="binderList"></div></section><section class="card binder-preview-card"><div class="binder-preview-heading"><h2>인쇄 미리보기</h2><span>A4 · 실제 크기 100%</span></div><p id="binderStatus" role="status"></p><div id="binderReadability" class="binder-readability" role="status"></div><div id="binderPreview" class="binder-preview"></div><p class="form-note">7cm용은 실제 6.7cm, 9cm용은 실제 8.7cm로 출력됩니다. A4 배율 100%로 인쇄하고 바깥 실선을 따라 자르세요. 표준 문서명을 그대로 세로 한 열로 인쇄합니다. 띄어쓰기 여백을 줄이고 영문은 묶어 세로로 배치합니다.</p></section></div>
 <details id="binderHistoryPanel" class="card binder-history-panel"><summary>인쇄 기록 <span id="binderHistoryCount"></span></summary><p class="form-note">인쇄창을 연 요청 번호를 기억합니다. 실제 출력 여부는 브라우저에서 알 수 없어 아래에서 완료 또는 취소를 표시할 수 있습니다.</p><div id="binderHistory"></div></details>

 <dialog id="binderManage" class="binder-manage"><header><div><h2 id="binderManageTitle">현장 문서 목록 관리</h2><p>기본 ${BINDER_STANDARD.length}개 · ${BINDER_STANDARD_VERSION} · 이 현장에만 적용</p></div><button id="binderManageClose" type="button" class="btn btn-outline" aria-label="목록 관리 닫기">닫기</button></header><div class="binder-manage-body">
 <details id="binderEditor" class="card"><summary>문서 추가 · 수정 / 인쇄 내용 설정</summary><form id="binderEditForm" class="binder-edit"><p id="binderEditorError" role="alert"></p><label for="binderEditTitle">문서 제목</label><input id="binderEditTitle" class="form-input" maxlength="120" required><p class="form-note">저장한 제목을 목록과 인쇄물에 그대로 사용합니다. 이 현장 목록에만 적용됩니다.</p><div class="binder-edit-grid">${EDIT_FIELDS.slice(0,5).map(([key,name,max])=>`<label>${name}<input id="${fieldId(key)}" class="form-input" maxlength="${max}" required></label>`).join('')}<label>문서번호(자동)<input id="binderEditCode" class="form-input" readonly></label></div>
 <div class="binder-edit-grid"><label>바인더 폭<select id="binderEditWidth" class="form-input">${widthOptions(null)}</select></label>${EDIT_FIELDS.slice(5,9).map(([key,name,max])=>`<label>${name}<input id="${fieldId(key)}" class="form-input" maxlength="${max}"></label>`).join('')}<label>하단 네 번째 칸<input class="form-input" value="현장안전 (고정)" readonly></label></div>
 <details><summary>문서 상세 정보</summary><div class="binder-edit-grid">${EDIT_FIELDS.slice(9).map(([key,name,max])=>`<label>${name}<textarea id="${fieldId(key)}" class="form-input" maxlength="${max}" rows="2"></textarea></label>`).join('')}</div></details>
 <div><button class="btn btn-primary" type="submit">현장 목록에 저장</button> <button class="btn btn-outline" id="binderEditCancel" type="button">새 문서 입력</button> <button id="binderDeleteDoc" class="btn btn-outline" type="button" hidden>이 문서 삭제</button></div></form></details>
 <details class="card"><summary>엑셀 목록 가져오기 · 내보내기 / 기본 목록 추가</summary><p>제공하신 정제 목록표의 대·중·소분류 및 상세 정보를 그대로 가져옵니다. 내보낸 엑셀에는 현장별 폭, 제목, 번호 라벨과 하단 칸도 포함됩니다.</p><div class="binder-selection"><label class="btn btn-outline" for="binderImport">엑셀 가져오기</label><input id="binderImport" type="file" accept=".xlsx" hidden><button id="binderExport" type="button" class="btn btn-outline">현장 목록 엑셀 내보내기</button><button id="binderStandard" type="button" class="btn btn-outline">없는 기본 항목만 추가</button></div><p class="form-note">가져오기는 확인 후 현재 현장 목록을 교체합니다. 기존 설정을 보관하려면 먼저 내보내기 하세요. 기본 항목 추가는 현장에서 수정한 기존 문서를 덮어쓰지 않습니다.</p></details>
 </div></dialog>
 <dialog id="binderNumbers" class="binder-manage"><header><div><h2>바인더 번호 묶음 설정</h2><p>문서마다 번호를 지정합니다. 같은 번호를 여러 장 뽑을 때는 ‘번호당 복사본’을 사용하세요.</p></div><button id="binderNumbersClose" type="button" class="btn btn-outline">닫기</button></header><div class="binder-manage-body"><div class="binder-sequence-toolbar"><label>문서별 권수 <input id="binderSequenceCount" class="form-input" type="number" min="1" max="200" value="3"></label><button id="binderSequenceNext" class="btn btn-outline" type="button">각 문서 최근 다음 번호부터 채우기</button></div><p class="form-note">연속 번호: 14-18 / 골라 뽑기: 14,16,20 / 조합: 14-16,20<br>기록이 없는 문서는 현재 시작 번호부터 채웁니다. 적용 후 오른쪽 미리보기에서 확인하세요.</p><form id="binderNumbersForm"><div id="binderNumberRows"></div><p id="binderNumbersError" role="alert"></p><button class="btn btn-primary" type="submit">번호 적용</button></form></div></dialog>`;
 const el=id=>root.querySelector('#'+id);
 const visible=()=>filterBinderDocuments(catalog,{query:el('binderSearch').value,category,selectedOnly:el('binderSelectedOnly').checked,selected});
 const items=()=>catalog.filter(d=>selected.has(d.code));
 const options=()=>({site:el('binderSite').value.trim(),height:Number(el('binderHeight').value),copies:Number(el('binderCopies').value),fontCss:font.css});
 function preview(){
  el('binderPrint').disabled=true;el('binderPreview').replaceChildren();el('binderReadability').replaceChildren();
  if(!items().length){el('binderStatus').textContent='목록에서 인쇄할 문서를 선택해주세요.';return;}
  try{
   const missing=items().filter(d=>!BINDER_WIDTHS.includes(d.width));if(missing.length)throw new Error(`바인더 폭을 7cm 또는 9cm로 선택해주세요: ${missing.map(d=>d.code).join(', ')}`);
   const opts=options(),expanded=expandBinderNumbers(items(),opts.copies),html=binderSheetsHtml(expanded,opts);
   const smallest=Math.min(...items().map(d=>binderTitleSize(d,opts.height)));
   el('binderReadability').textContent=`표준 문서명 그대로 · 세로 한 열 · 제목 ${smallest.toFixed(1)}pt 이상`;
   el('binderStatus').textContent=`${items().length}종 · ${expanded.length*opts.copies}개 라벨 · A4 ${paginateBinderLabels(expanded,opts.copies).length}장`;
   const frame=document.createElement('iframe');frame.title='A4 바인더 표지 인쇄 미리보기';frame.setAttribute('sandbox','');
   frame.srcdoc=`<!doctype html><html lang="ko"><meta charset="utf-8"><style>${binderPrintCss}${font.css}body{background:#e5e7eb}.binder-sheet{margin:0 0 12px}</style><body>${html}</body></html>`;el('binderPreview').append(frame);el('binderPrint').disabled=!font.ready;
  }catch(error){el('binderStatus').textContent=error.message;}
 }
 const formatDate=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
 function categoryButtons(){
  const groups=new Map();for(const d of catalog){const key=binderCategoryKey(d);if(!groups.has(key))groups.set(key,{name:d.middleName,major:d.majorName,count:0});groups.get(key).count++;}
  if(category!=='all'&&!groups.has(category))category='all';
  el('binderCategories').innerHTML=`<button type="button" data-category="all" aria-pressed="${category==='all'}">전체 <small>${catalog.length}</small></button>`+[...groups].map(([key,g])=>`<button type="button" data-category="${esc(key)}" aria-pressed="${category===key}" title="${esc(g.major)}">${esc(g.name)} <small>${g.count}</small></button>`).join('');
 }
 function list(){
  const shown=visible();el('binderListCount').textContent=`${shown.length}개 · 선택 ${selected.size}개`;
  const history=store.history();
  el('binderList').innerHTML=shown.map(d=>{
   const last=lastBinderPrint(history,d,store.remembered()),next=nextBinderNumber(last);
   return `<div class="binder-row"><label class="binder-pick"><input type="checkbox" data-code="${esc(d.code)}" ${selected.has(d.code)?'checked':''}><span><b>${esc(d.title)}</b><small>${esc(d.code)} · ${esc(d.middleName)}</small><small class="binder-last-number">${last?`최근 ${last.status==='confirmed'?'출력 완료':'요청'} (${esc(last.numberLabel||last.number)}) · ${esc(formatDate(last.requestedAt))}`:'인쇄 요청 기록 없음'}</small></span></label><select class="form-input binder-width-input" data-width-code="${esc(d.code)}" aria-label="${esc(d.title)} 바인더 폭">${widthOptions(d.width)}</select><div class="binder-number-control"><input class="form-input" data-number-code="${esc(d.code)}" aria-label="${esc(d.title)} 인쇄번호" maxlength="1000" placeholder="14-18" value="${esc(d.numberExpression||d.labelNumber)}">${next?`<button type="button" class="binder-next" data-next-code="${esc(d.code)}" data-next-number="${esc(next)}" title="최근 번호의 다음 번호 사용">다음 ${esc(next)}</button>`:''}</div><button type="button" class="btn btn-outline btn-sm binder-edit-row" data-edit="${esc(d.code)}" aria-label="${esc(d.title)} 제목·문서 수정">수정</button></div>`;
  }).join('')||'<div class="binder-list-empty">해당 문서가 없습니다. 다른 분류를 선택하거나 검색어를 지워주세요.</div>';
 }
 function historyView(){
  const history=store.history();el('binderHistoryCount').textContent=`${history.length}건`;
  el('binderHistory').innerHTML=history.map(job=>`<article class="binder-history-item"><div><b>${esc(formatDate(job.requestedAt))}</b> · ${job.status==='confirmed'?'출력 완료':job.status==='cancelled'?'취소 표시':'인쇄 요청'} · A4 ${esc(job.pages)}장 · 번호당 ${esc(job.copies)}장</div><p>${job.documents.map(d=>`${esc(d.code)} <b>(${esc(d.numberLabel||d.number)})</b>`).join(' · ')}</p>${job.status==='requested'?`<div><button type="button" class="btn btn-outline btn-sm" data-job="${esc(job.id)}" data-status="confirmed">출력 완료 표시</button> <button type="button" class="btn btn-outline btn-sm" data-job="${esc(job.id)}" data-status="cancelled">취소 표시</button></div>`:''}</article>`).join('')||'<p>아직 인쇄 요청 기록이 없습니다.</p>';
 }
 function updateFont(){if(!font.ready)el('binderCatalogError').textContent='인쇄 글꼴을 불러오지 못했습니다. 화면을 새로고침해주세요.';preview();}
 async function commit(next){
  root.inert=true;
  try{const valid=validateBinderCatalog(next);await store.save(valid);if(root.binderMountToken!==token)return false;catalog=valid;selected=new Set([...selected].filter(code=>catalog.some(d=>d.code===code)));el('binderCatalogError').textContent='';categoryButtons();list();historyView();preview();toast('현장 문서 목록을 저장했습니다.','success');return true;}
  catch(error){if(root.binderMountToken===token){el('binderCatalogError').textContent=error.message;list();}return false;}
  finally{if(root.binderMountToken===token)root.inert=false;}
 }
 function updateCode(){el('binderEditCode').value=['majorCode','middleCode','minorNumber'].map(k=>el(fieldId(k)).value.trim()).join('-');}
 function fillEditor(doc={majorCode:'SR',majorName:'안전보건',middleCode:'E',middleName:'보건',labelNumber:'1'}){
  for(const [key] of EDIT_FIELDS)el(fieldId(key)).value=doc[key]??'';
  el('binderEditTitle').value=doc.title??'';el('binderEditWidth').innerHTML=widthOptions(doc.width??null);el('binderEditorError').textContent='';updateCode();
 }
 el('binderList').onchange=async event=>{
  const target=event.target;if(!root.contains(target))return;
  if(target.dataset.widthCode){const next=catalog.map(d=>d.code===target.dataset.widthCode?{...d,width:target.value===''?null:Number(target.value)}:d);await commit(next);}
  else if(target.dataset.numberCode){await commit(catalog.map(d=>d.code===target.dataset.numberCode?{...d,numberExpression:target.value.trim()}:d));}
  else if(target.dataset.code){target.checked?selected.add(target.dataset.code):selected.delete(target.dataset.code);el('binderListCount').textContent=`${visible().length}개 · 선택 ${selected.size}개`;if(el('binderSelectedOnly').checked)list();preview();}
 };
 // Assign handlers to current descendants, avoiding root listener accumulation on repeated tab visits.
 el('binderList').onclick=async event=>{
  const edit=event.target.dataset.edit,remove=event.target.dataset.delete,next=event.target.dataset.nextCode;
  if(next){await commit(catalog.map(d=>d.code===next?{...d,labelNumber:event.target.dataset.nextNumber,numberExpression:''}:d));return;}
  if(edit){editing=edit;fillEditor(catalog.find(d=>d.code===edit));el('binderEditor').open=true;el('binderDeleteDoc').hidden=false;el('binderManageTitle').textContent='문서 수정';el('binderManage').showModal();el('binderEditTitle').focus();}
  if(remove&&confirm(`${remove} 문서를 이 현장 목록에서 삭제할까요?`))await commit(catalog.filter(d=>d.code!==remove));
 };
 el('binderNumbersOpen').onclick=()=>{
  if(!items().length){toast('번호를 설정할 문서를 먼저 선택해주세요.');return;}
  el('binderNumberRows').innerHTML=items().map(d=>`<label class="binder-batch-row"><span><b>${esc(d.title)}</b><small>${esc(d.code)} · 최근 ${esc(lastBinderPrint(store.history(),d,store.remembered())?.numberLabel||lastBinderPrint(store.history(),d,store.remembered())?.number||'기록 없음')}</small></span><input class="form-input" data-batch-id="${esc(d.id)}" value="${esc(d.numberExpression||d.labelNumber)}" maxlength="1000" aria-label="${esc(d.title)} 번호 목록"></label>`).join('');
  el('binderNumbersError').textContent='';el('binderNumbers').showModal();
 };
 el('binderNumbersClose').onclick=()=>el('binderNumbers').close();
 el('binderSequenceNext').onclick=()=>{try{const count=Number(el('binderSequenceCount').value),values=[];for(const input of el('binderNumberRows').querySelectorAll('input')){const doc=catalog.find(d=>d.id===input.dataset.batchId),last=lastBinderPrint(store.history(),doc,store.remembered());const start=last?nextBinderNumber(last):parseBinderNumbers(input.value)[0];values.push([input,sequenceBinderNumbers(start,count)]);}for(const [input,value] of values)input.value=value;el('binderNumbersError').textContent='';}catch(error){el('binderNumbersError').textContent=error.message;}};
 el('binderNumbersForm').onsubmit=async event=>{event.preventDefault();try{const values=new Map([...el('binderNumberRows').querySelectorAll('input')].map(input=>{parseBinderNumbers(input.value);return [input.dataset.batchId,input.value.trim()];}));const next=catalog.map(d=>values.has(d.id)?{...d,numberExpression:values.get(d.id)}:d);expandBinderNumbers(next.filter(d=>selected.has(d.code)),options().copies);if(await commit(next))el('binderNumbers').close();else el('binderNumbersError').textContent=el('binderCatalogError').textContent;}catch(error){el('binderNumbersError').textContent=error.message;}};
 el('binderEditCancel').onclick=()=>{editing=null;fillEditor();el('binderDeleteDoc').hidden=true;};
 const newDocument=()=>{editing=null;const base=catalog.find(d=>binderCategoryKey(d)===category);fillEditor(base?{majorCode:base.majorCode,majorName:base.majorName,middleCode:base.middleCode,middleName:base.middleName,labelNumber:'1'}:undefined);el('binderDeleteDoc').hidden=true;el('binderEditor').open=true;el('binderManageTitle').textContent='문서 추가';el('binderManage').showModal();el('binderEditTitle').focus();};
 el('binderNew').onclick=newDocument;el('binderListNew').onclick=newDocument;
 el('binderManageOpen').onclick=()=>{el('binderManageTitle').textContent='현장 문서 목록 관리';el('binderManage').showModal();};
 el('binderManageClose').onclick=()=>el('binderManage').close();
 el('binderDeleteDoc').onclick=async()=>{if(editing&&confirm(`${editing} 문서를 이 현장 목록에서 삭제할까요?`)){if(await commit(catalog.filter(d=>d.code!==editing))){editing=null;fillEditor();el('binderManage').close();}}};
 for(const key of ['majorCode','middleCode','minorNumber'])el(fieldId(key)).addEventListener('input',updateCode);
 el('binderEditForm').onsubmit=async event=>{
  event.preventDefault();const old=catalog.find(d=>d.code===editing)||{};
  const doc={...old,...Object.fromEntries(EDIT_FIELDS.map(([key])=>[key,el(fieldId(key)).value.trim()])),title:el('binderEditTitle').value.trim(),width:el('binderEditWidth').value===''?null:Number(el('binderEditWidth').value)};
  doc.code=[doc.majorCode,doc.middleCode,doc.minorNumber].join('-');
  if(doc.width!==null&&!BINDER_WIDTHS.includes(doc.width)){el('binderEditorError').textContent='바인더 폭을 7cm 또는 9cm로 선택해주세요.';return;}
  if(catalog.some(d=>d.code===doc.code&&d.code!==editing)){el('binderEditorError').textContent='이미 사용 중인 문서번호입니다.';return;}
  const isNew=editing===null,wasSelected=selected.has(editing),next=editing?catalog.map(d=>d.code===editing?doc:d):[...catalog,doc];
  if(await commit(next)){if(wasSelected)selected.add(doc.code);if(isNew){category=binderCategoryKey(doc);el('binderSearch').value='';el('binderSelectedOnly').checked=false;categoryButtons();}editing=null;fillEditor();list();preview();el('binderManage').close();}else el('binderEditorError').textContent=el('binderCatalogError').textContent;
 };
 el('binderSearch').oninput=list;el('binderSelectedOnly').onchange=list;
 el('binderCategories').onclick=event=>{const button=event.target.closest('[data-category]');if(button){category=button.dataset.category;categoryButtons();list();}};el('binderAll').onclick=()=>{visible().forEach(d=>selected.add(d.code));list();preview();};el('binderNone').onclick=()=>{selected.clear();list();preview();};
 for(const id of ['binderSite','binderHeight','binderCopies'])el(id).oninput=preview;
 el('binderStandard').onclick=()=>commit([...catalog,...structuredClone(BINDER_STANDARD).filter(d=>!catalog.some(old=>old.code===d.code||old.standardId===d.standardId))]);
 el('binderImport').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
   if(file.size>2*1024*1024)throw new Error('목록 파일은 2MB 이하로 올려주세요.');
   const XLSX=await import('xlsx'),bytes=await file.arrayBuffer(),book=XLSX.read(bytes,{type:'array'});
   const next=binderRowsToCatalog(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,defval:'',raw:false})).map(d=>({...d,standardId:d.standardId||BINDER_STANDARD.find(base=>base.code===d.code)?.standardId||''}));
   if(root.binderMountToken!==token)return;
   if(confirm(`${next.length}개 문서로 이 현장 목록을 교체할까요? 기존 설정은 내보내기로 보관할 수 있습니다.`))await commit(next);
  }catch(error){if(root.binderMountToken===token)el('binderCatalogError').textContent=error.message;}
  finally{event.target.value='';}
 };
 el('binderExport').onclick=async()=>{
  try{const XLSX=await import('xlsx');const rows=binderCatalogToRows(catalog);const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=BINDER_COLUMNS.map(([key])=>({wch:key==='title'?40:20}));XLSX.utils.book_append_sheet(book,sheet,'현장문서 목록');XLSX.writeFile(book,`${workspace.name.replace(/[\\/:*?"<>|]/g,'_')}_현장문서목록.xlsx`);}catch(error){el('binderCatalogError').textContent=error.message;}
 };
 el('binderPrint').onclick=async()=>{
  if(!font.ready){updateFont();return;}
  root.inert=true;
  try{
   if(items().some(d=>!BINDER_WIDTHS.includes(d.width)))throw new Error('바인더 폭을 7cm 또는 9cm로 선택해주세요.');
   const opts=options(),docs=expandBinderNumbers(items(),opts.copies);
   const html=buildBinderPrintHtml(docs,opts);
   const request=createBinderPrintRequest(docs,{...opts,pages:paginateBinderLabels(docs,opts.copies).length});
   await store.recordPrint(catalog,request);
   if(root.binderMountToken!==token)return;
   list();historyView();openPrintWindow(html,{beforePrint:async doc=>{await doc.fonts.load('16px BinderHY');if(!doc.fonts.check('16px BinderHY'))throw new Error('HY헤드라인M을 인쇄 문서에 불러오지 못했습니다.');}});toast('인쇄 요청 번호를 기억했습니다. 출력 후 완료 여부를 표시할 수 있습니다.','success');
  }catch(error){el('binderCatalogError').textContent=`인쇄 기록을 저장하지 못했습니다. 인쇄창을 열지 않았습니다. ${error.message}`;}
  finally{if(root.binderMountToken===token)root.inert=false;}
 };
 el('binderHistory').onclick=async event=>{const button=event.target.closest('[data-job]');if(!button)return;root.inert=true;try{await store.markPrint(catalog,button.dataset.job,button.dataset.status);list();historyView();}catch(error){el('binderCatalogError').textContent=error.message;}finally{root.inert=false;}};

 fillEditor();categoryButtons();list();historyView();preview();
 loadBinderLocalFont().then(value=>{if(root.binderMountToken===token){font=value;updateFont();}});
}
