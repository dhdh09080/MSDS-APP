const allowedAppOrigins = ['https://gshealthk.vercel.app','http://localhost:3000'];

// Serialized into the bookmark. One fixed GET, six data fields, then navigation.
// No message listener, opener bridge, cookie read, arbitrary request or remote script.
export async function publishPmxSnapshot(appOrigin) {
  if (!['https://gshealthk.vercel.app','http://localhost:3000'].includes(appOrigin)) return;
  if (location.origin !== 'https://pmx.gsenc.com' || !location.pathname.startsWith('/com/')) {
    alert('PMX에 접속하고 로그인한 뒤 이 즐겨찾기를 눌러주세요.');return;
  }
  try {
    const response = await fetch('/com/api/v1/dashboard-hq/project-mls-stn-info-list?orderBy=5&bizFldCd=N0&pmEmpNo=', {method:'GET',credentials:'include',cache:'no-store',signal:AbortSignal.timeout(18000)});
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) throw new Error('조회 실패');
    const body = await response.json();
    if (body.successOrNot !== 'Y' || !Array.isArray(body.data) || !body.data.length || body.data.length > 500) throw new Error('현장 목록 없음');
    const fields = ['prjCd','prjNm','bizFldNm','cstrnStrtYmd','cstrnEndYmd','actlTProgrt'];
    const projects = body.data.map(row => {
      if (!row || typeof row.prjCd !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(row.prjCd) || typeof row.prjNm !== 'string' || !row.prjNm.trim() || row.prjNm.length > 200) throw new Error('잘못된 현장');
      const clean = Object.fromEntries(fields.map(k => [k,row[k] ?? null]));
      if (clean.bizFldNm !== null && (typeof clean.bizFldNm !== 'string' || clean.bizFldNm.length > 100)) throw new Error('잘못된 분류');
      for (const k of ['cstrnStrtYmd','cstrnEndYmd']) {
        if (clean[k] === '') clean[k] = null;
        if (clean[k] !== null && (typeof clean[k] !== 'string' || !/^(\d{8}|\d{4}-\d{2}-\d{2})$/.test(clean[k]))) throw new Error('잘못된 일정');
      }
      if (clean.actlTProgrt === '') clean.actlTProgrt = null;
      if (clean.actlTProgrt !== null && ((typeof clean.actlTProgrt !== 'number' && typeof clean.actlTProgrt !== 'string') || String(clean.actlTProgrt).trim() === '' || !Number.isFinite(Number(clean.actlTProgrt)) || Number(clean.actlTProgrt) < 0 || Number(clean.actlTProgrt) > 100)) throw new Error('잘못된 공정률');
      return clean;
    });
    const text = JSON.stringify({version:1,source:'pmx-bookmark',fetchedAt:new Date().toISOString(),projects});
    if (new TextEncoder().encode(text).length > 500000) throw new Error('자료 크기 초과');
    const download = () => {
      const url = URL.createObjectURL(new Blob([text],{type:'application/json'}));
      const a = document.createElement('a');a.href=url;a.download='pmx-projects.json';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      alert('PMX 정보 파일을 내려받았습니다. 보건관리 사이트의 ‘파일 가져오기’에서 선택해주세요.');
    };
    try {window.opener=null;window.name='';} catch {download();return;}
    if (window.opener !== null) {download();return;}
    // Fragment data is not sent to the destination web server or referrer logs.
    const target = appOrigin + '/pmx-import.html#snapshot=' + encodeURIComponent(text);
    if (target.length > 250000) {download();return;}
    try {location.replace(target);} catch {download();}
  } catch {
    alert('PMX 정보를 가져오지 못했습니다. PMX 로그인과 현장 조회 권한을 확인해주세요. 보안 설정에서 즐겨찾기 실행을 막으면 사내 담당자에게 문의해주세요.');
  }
}

export function makePmxBookmarklet(appOrigin) {
  if (!allowedAppOrigins.includes(appOrigin)) throw new Error('지원되지 않는 보건관리 사이트 주소입니다.');
  return 'javascript:void (' + publishPmxSnapshot.toString() + ')(' + JSON.stringify(appOrigin) + ')';
}
