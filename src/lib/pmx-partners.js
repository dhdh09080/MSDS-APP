const origins = ['https://gshealthk.vercel.app','http://localhost:3000'];
export function validatePartnerSnapshot(value, now=Date.now()) {
  const fail=()=>{throw new Error('PMX 협력사 정보 형식이 올바르지 않습니다.');};
  if(!value || value.version!==1 || value.source!=='pmx-partners' || Object.keys(value).some(k=>!['version','source','projectCode','date','fetchedAt','partners'].includes(k)))fail();
  if(typeof value.projectCode!=='string' || !/^[A-Za-z0-9_-]{1,32}$/.test(value.projectCode) || !/^\d{4}-\d{2}-\d{2}$/.test(value.date))fail();
  const stamp=Date.parse(value.fetchedAt);
  if(typeof value.fetchedAt!=='string' || !Number.isFinite(stamp) || stamp>now+300000 || stamp<now-86400000)throw new Error('PMX 협력사 정보를 다시 가져와주세요.');
  if(!Array.isArray(value.partners) || value.partners.length>1000)fail();
  const names=new Set();
  const partners=value.partners.map(row=>{
    if(!row || Object.keys(row).some(k=>!['companyNm','contracts'].includes(k)) || typeof row.companyNm!=='string' || !row.companyNm.trim() || row.companyNm.length>200 || !Array.isArray(row.contracts) || row.contracts.length>100 || row.contracts.some(c=>typeof c!=='string' || c.length>200))fail();
    const companyNm=row.companyNm.trim().replace(/\s+/g,' ');
    if(names.has(companyNm))fail();names.add(companyNm);
    return {companyNm,contracts:[...new Set(row.contracts.map(c=>c.trim()).filter(c=>c && c!=='-'))]};
  });
  if(new TextEncoder().encode(JSON.stringify(value)).length>500000)fail();
  return {version:1,source:'pmx-partners',projectCode:value.projectCode,date:value.date,fetchedAt:new Date(stamp).toISOString(),partners};
}

// Executes only in the user's authenticated PMX tab; fixed read-only POST endpoint.
export async function publishPartnerSnapshot(appOrigin, projectCode, date) {
  if(!['https://gshealthk.vercel.app','http://localhost:3000'].includes(appOrigin) || !/^[A-Za-z0-9_-]{1,32}$/.test(projectCode) || !/^\d{4}-\d{2}-\d{2}$/.test(date))return;
  if(location.origin!=='https://pmx.gsenc.com'){alert('PMX에 로그인한 뒤 즐겨찾기를 실행해주세요.');return;}
  try {
    const response=await fetch('/pgs/work_daily/getWorkDailyPartnerMainUseList.ax',{method:'POST',credentials:'include',cache:'no-store',signal:AbortSignal.timeout(18000),headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({workLevel1CcSeq:'',sdate:date,ccwSeq:'',unwriteTf:'0',activeTf:'1',pagePjCd:projectCode}).toString()});
    if(!response.ok)throw new Error('조회 실패');
    const body=await response.json();
    if(body.resultCode!=='0000' || body.result!==true || !Array.isArray(body.data?.contents) || body.data.contents.length>1000)throw new Error('응답 확인 필요');
    const grouped=new Map();
    for(const row of body.data.contents){
      if(typeof row.companyNm!=='string' || !row.companyNm.trim() || row.companyNm.length>200 || (row.contractNm!=null && (typeof row.contractNm!=='string' || row.contractNm.length>200)))throw new Error('업체 정보 확인 필요');
      const name=row.companyNm.trim().replace(/\s+/g,' '), contracts=grouped.get(name)||new Set();
      if(row.contractNm?.trim() && row.contractNm.trim()!=='-')contracts.add(row.contractNm.trim());
      grouped.set(name,contracts);
    }
    // Never forward worker counts/names, memos, tokens or the raw response.
    const partners=Array.from(grouped,([companyNm,contracts])=>({companyNm,contracts:[...contracts]}));
    const text=JSON.stringify({version:1,source:'pmx-partners',projectCode,date,fetchedAt:new Date().toISOString(),partners});
    if(new TextEncoder().encode(text).length>500000)throw new Error('자료 크기 초과');
    const download=()=>{const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='pmx-partners-'+projectCode+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);alert('협력사 파일을 받았습니다. 보건관리 사이트의 협력사 가져오기에서 파일을 선택해주세요.');};
    try{window.opener=null;window.name='';}catch{download();return;}
    if(window.opener!==null){download();return;}
    const target=appOrigin+'/pmx-import.html#snapshot='+encodeURIComponent(text);
    if(target.length>250000){download();return;}
    try{location.replace(target);}catch{download();}
  }catch{alert('협력사 목록을 가져오지 못했습니다. PMX 로그인과 해당 현장의 조회 권한을 확인해주세요.');}
}
export function makePartnerBookmarklet(origin,projectCode,date){
  if(!origins.includes(origin) || !/^[A-Za-z0-9_-]{1,32}$/.test(projectCode) || !/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('현장코드와 조회일을 확인해주세요.');
  return 'javascript:void ('+publishPartnerSnapshot.toString()+')('+[origin,projectCode,date].map(v=>JSON.stringify(v)).join(',')+')';
}
