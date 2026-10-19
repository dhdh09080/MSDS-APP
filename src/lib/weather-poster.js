const finite = v => typeof v === 'number' && Number.isFinite(v);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const metric = (v, unit = '') => finite(v) ? `${Math.round(v * 10) / 10}${unit}` : '—';
export const kstDate = (now = Date.now()) => new Date(now + 9 * 3600000).toISOString().slice(0,10);
const TIPS = {
  summer: [
    ['작업 전 시원한 물과 그늘을 준비하세요.','더운 시간대에는 작업 강도와 일정을 조정하세요.','동료의 몸 상태를 서로 확인하세요.'],
    ['물을 가까이 두고 자주 마시세요.','통풍이 잘되는 휴게공간을 확인하세요.','몸 상태가 평소와 다르면 관리자에게 알리세요.'],
    ['작업 시작 전 오늘의 더위 예보를 확인하세요.','시원한 곳에서 규칙적으로 쉬세요.','혼자 작업하는 동료의 상태도 확인하세요.'],
    ['그늘막과 냉방시설 작동 상태를 확인하세요.','햇볕이 강한 시간의 야외작업을 조정하세요.','작업 중 불편함을 느끼면 즉시 알리세요.'],
    ['개인 물병과 시원한 물을 준비하세요.','휴식 시간에는 몸을 충분히 식히세요.','새로 현장에 온 동료의 적응을 살피세요.'],
    ['오늘 작업에 맞는 휴식 계획을 확인하세요.','열이 쌓이는 밀폐공간의 환기를 확인하세요.','작업 전후 몸 상태를 동료와 공유하세요.'],
    ['기온뿐 아니라 습도와 체감온도도 살피세요.','휴게공간까지 이동하는 동선을 확인하세요.','무리하지 말고 작업 중 몸 상태를 살피세요.'],
  ],
  transition: [
    ['아침과 낮의 기온 차이에 맞춰 겉옷을 준비하세요.','작업 전 가볍게 몸을 풀어주세요.','실내 휴게공간을 주기적으로 환기하세요.'],
    ['옷을 여러 겹 입고 기온에 맞춰 조절하세요.','손을 깨끗이 씻고 개인 물병을 사용하세요.','바람이 강한 시간대의 작업환경을 살피세요.'],
    ['아침 작업 전 충분히 준비운동을 하세요.','땀에 젖은 옷은 갈아입을 수 있게 준비하세요.','몸 상태가 평소와 다르면 관리자에게 알리세요.'],
    ['일교차를 확인하고 여벌 옷을 준비하세요.','휴게실의 환기와 청결 상태를 확인하세요.','식사와 휴식을 규칙적으로 챙기세요.'],
    ['바람을 막을 수 있는 겉옷을 챙기세요.','물과 개인 위생용품을 가까이 두세요.','작업 전 동료의 몸 상태를 함께 살피세요.'],
    ['작업 시작 전 관절과 근육을 가볍게 풀어주세요.','기온이 오르면 옷차림을 조절하세요.','충분한 휴식으로 피로가 쌓이지 않게 하세요.'],
    ['시간별 기온 변화를 확인하고 작업을 준비하세요.','휴식 후 작업을 재개할 때도 몸을 풀어주세요.','손 씻기와 휴게공간 환기를 챙기세요.'],
  ],
  winter: [
    ['방한복과 장갑으로 몸을 따뜻하게 유지하세요.','따뜻한 휴게공간과 음료를 준비하세요.','눈·비 뒤 미끄러운 통로를 확인하세요.'],
    ['여러 겹의 옷으로 보온하고 젖은 옷은 갈아입으세요.','바람을 피할 수 있는 곳에서 쉬세요.','작업 전 몸을 충분히 풀어주세요.'],
    ['장갑과 보온 신발의 상태를 확인하세요.','추위가 심한 시간대의 야외작업을 조정하세요.','몸 상태가 평소와 다르면 관리자에게 알리세요.'],
    ['아침 작업 전 통로의 결빙 여부를 확인하세요.','따뜻한 곳에서 규칙적으로 쉬세요.','휴게공간은 보온과 함께 환기도 챙기세요.'],
    ['방풍 겉옷과 여벌 양말을 준비하세요.','손과 발이 젖지 않도록 살피세요.','혼자 작업하는 동료의 상태도 확인하세요.'],
    ['풍속과 체감온도를 함께 확인하세요.','난방기 주변의 안전거리를 확보하세요.','무리하지 말고 충분히 몸을 풀어주세요.'],
    ['오늘의 추위와 강수 예보를 확인하세요.','젖은 장갑과 작업복은 갈아입으세요.','작업 전후 서로의 몸 상태를 살피세요.'],
  ],
};

export function posterModel(fc, mode = 'auto') {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(fc.date) ? fc.date : kstDate();
  const hours = (fc.hours || []).filter(h => Number.isInteger(h.hour) && h.hour >= 6 && h.hour <= 19).sort((a,b) => a.hour-b.hour);
  const temps = hours.map(h => h.temp).filter(finite);
  const feels = hours.map(h => h.feel).filter(finite);
  const winds = hours.map(h => h.wind).filter(finite);
  const month = Number(date.slice(5,7));
  let season = mode;
  if (!['summer','transition','winter'].includes(season)) {
    season = feels.some(v => v >= 31) ? 'summer' : feels.some(v => v <= 0) ? 'winter' :
      month >= 6 && month <= 9 ? 'summer' : month >= 11 || month <= 2 ? 'winter' : 'transition';
  }
  const themes = {
    summer: { title:'혹서기 건강관리', accent:'#b84b20', pale:'#fff0e6', note:'더위가 쌓이기 전에, 물 · 그늘 · 휴식', action:'오늘의 더위에 맞춰 작업과 휴식을 준비하세요.' },
    transition: { title:'환절기 건강관리', accent:'#236559', pale:'#e9f4ee', note:'아침과 낮의 변화에, 옷차림 · 준비운동 · 위생', action:'일교차와 바람을 살피고 오늘의 몸 상태를 확인하세요.' },
    winter: { title:'동절기 건강관리', accent:'#245a91', pale:'#eaf2fb', note:'추위와 바람에 대비하는, 보온 · 따뜻한 휴식', action:'체감온도와 결빙 여부를 확인하고 따뜻하게 작업하세요.' },
  };
  const day = Math.floor(Date.parse(date+'T00:00:00Z') / 86400000);
  return {date,hours,season,...themes[season], tips:TIPS[season][((day%7)+7)%7],
    high:temps.length?Math.max(...temps):null, low:temps.length?Math.min(...temps):null,
    maxFeel:feels.length?Math.max(...feels):null, maxWind:winds.length?Math.max(...winds):null};
}

// Separate temperature and wind scales. Missing values break the line instead of becoming zero.
export function weatherChartSvg(hours, {width=1328,height=300,left=100,right=24} = {}) {
  const top=22,bottom=42,windHeight=62,gap=36;
  const tempBottom=height-bottom-windHeight-gap;
  const values=hours.flatMap(h=>[h.temp,h.feel]).filter(finite);
  const lo=values.length?Math.floor(Math.min(...values)/5)*5-2:0;
  const hi=values.length?Math.ceil(Math.max(...values)/5)*5+2:10;
  const maxWind=Math.max(5,...hours.map(h=>h.wind).filter(finite));
  const plotWidth=width-left-right;
  const x=i=>left+(hours.length===1?plotWidth/2:i*plotWidth/Math.max(1,hours.length-1));
  const y=v=>tempBottom-(v-lo)/(hi-lo)*(tempBottom-top);
  const windBottom=height-bottom;
  let content='';
  for(let i=0;i<=3;i++) {
    const v=lo+(hi-lo)*i/3,yy=y(v);
    content+=`<line x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}" stroke="#dfe5e9"/><text x="${left-12}" y="${yy+5}" text-anchor="end" fill="#677582" font-size="16">${Math.round(v)}°</text>`;
  }
  content+=`<text x="${left-12}" y="${windBottom-30}" text-anchor="end" fill="#677582" font-size="14">풍속</text><text x="${left-12}" y="${windBottom-10}" text-anchor="end" fill="#677582" font-size="13">m/s</text>`;
  for(const [key,color,dash] of [['temp','#3265b4',''],['feel','#c46132','8 5']]) {
    let segment=[];
    const flush=()=>{if(segment.length)content+=`<polyline points="${segment.join(' ')}" fill="none" stroke="${color}" stroke-width="3.5" ${dash?`stroke-dasharray="${dash}"`:''} stroke-linejoin="round" stroke-linecap="round"/>`;segment=[];};
    hours.forEach((h,i)=>{if(finite(h[key]))segment.push(`${x(i)},${y(h[key])}`);else flush();});flush();
    hours.forEach((h,i)=>{if(finite(h[key]))content+=`<circle cx="${x(i)}" cy="${y(h[key])}" r="3.8" fill="${color}"/>`;});
  }
  hours.forEach((h,i)=>{
    if(finite(h.wind)) {
      const barHeight=h.wind/maxWind*windHeight;
      content+=`<rect x="${x(i)-12}" y="${windBottom-barHeight}" width="24" height="${Math.max(1,barHeight)}" rx="4" fill="#79a89d"/><text x="${x(i)}" y="${windBottom-barHeight-6}" text-anchor="middle" fill="#326457" font-size="14">${metric(h.wind)}</text>`;
    }
    content+=`<text x="${x(i)}" y="${height-13}" text-anchor="middle" fill="#364552" font-size="16">${h.hour}시</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="시간별 기온·체감온도 선 그래프와 풍속 막대 그래프"><title>기온과 체감온도는 °C, 풍속은 별도 막대 축의 m/s입니다. 정확한 값은 시간별 표에서 확인하세요.</title>${content}</svg>`;
}

function wrap(text, length) {
  const chars=Array.from(text);const rows=[];
  for(let i=0;i<chars.length;i+=length)rows.push(chars.slice(i,i+length).join(''));
  return rows;
}
export function buildHealthPosterSvg(fc, site = {}, mode='auto') {
  const m=posterModel(fc,mode);
  const dateLabel=new Date(m.date+'T12:00:00+09:00').toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',weekday:'short'});
  const stats=[['06–19시 최고 / 최저 기온',`${metric(m.high,'°')} / ${metric(m.low,'°')}`],['06–19시 최고 체감온도',metric(m.maxFeel,'°C')],['06–19시 최대 풍속',metric(m.maxWind,' m/s')]];
  const columns=m.hours.length;
  const gridLeft=180,gridWidth=1204,col=gridWidth/Math.max(1,columns);
  const tableRows=[['시간',null,'#526171'],['기온 °C','temp','#3265b4'],['체감 °C','feel','#c46132'],['풍속 m/s','wind','#236559']];
  const chart=weatherChartSvg(m.hours,{width:1328,height:294,left:gridLeft-56+col/2,right:col/2}).replace('<svg ', '<svg x="56" y="360" ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1120" viewBox="0 0 1440 1120" font-family="'Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif">
  <rect width="1440" height="1120" fill="#f6f8f7"/>
  <rect x="24" y="24" width="1392" height="1072" rx="24" fill="#fff" stroke="#dbe3e2"/>
  <path d="M48 24H1392Q1416 24 1416 48V198H24V48Q24 24 48 24" fill="#172e35"/>
  <text x="56" y="62" fill="#a8c8c0" font-size="15" letter-spacing="3">DAILY SITE HEALTH · 오늘의 현장 건강</text>
  <text x="56" y="119" fill="white" font-size="43" font-weight="750">${m.title}</text>
  <text x="56" y="159" fill="#d2e3df" font-size="21">${esc(m.note)}</text>
  <text x="1384" y="61" text-anchor="end" fill="#d2e3df" font-size="18">${esc(dateLabel)}</text>
  ${wrap(String(site.name||'현장'),19).slice(0,2).map((s,i)=>`<text x="1384" y="${105+i*32}" text-anchor="end" fill="white" font-size="26" font-weight="650">${esc(s)}</text>`).join('')}
  <text x="56" y="229" fill="#60717a" font-size="17">${esc(String(site.address||fc.address||'').slice(0,72))}</text>
  ${stats.map(([k,v],i)=>`<rect x="${56+i*449}" y="250" width="430" height="88" rx="12" fill="${m.pale}"/><text x="${76+i*449}" y="278" fill="${m.accent}" font-size="17">${k}</text><text x="${76+i*449}" y="318" fill="#19343b" font-size="34" font-weight="750">${v}</text>`).join('')}
  <text x="56" y="359" fill="#263e47" font-size="18" font-weight="650">오늘 시간별 예보 · 06–19시</text>
  <line x1="946" x2="980" y1="352" y2="352" stroke="#3265b4" stroke-width="4"/><text x="992" y="359" fill="#364552" font-size="17">기온</text>
  <line x1="1064" x2="1098" y1="352" y2="352" stroke="#c46132" stroke-width="4" stroke-dasharray="7 4"/><text x="1110" y="359" fill="#364552" font-size="17">체감온도</text>
  <rect x="1248" y="343" width="16" height="17" rx="3" fill="#79a89d"/><text x="1274" y="359" fill="#364552" font-size="17">풍속</text>
  ${chart}
  <rect x="56" y="667" width="1328" height="150" rx="10" fill="#f4f7f8"/>
  ${tableRows.map(([name,key,color],r)=>`<text x="72" y="${693+r*35}" fill="${color}" font-size="18" font-weight="650">${name}</text>${m.hours.map((h,i)=>`<text x="${gridLeft+(i+.5)*col}" y="${693+r*35}" text-anchor="middle" fill="${color}" font-size="${r===0?17:20}" font-weight="${r===0?500:650}">${key?metric(h[key]):h.hour+'시'}</text>`).join('')}`).join('')}
  <rect x="56" y="838" width="1328" height="182" rx="14" fill="${m.pale}"/>
  <text x="80" y="872" fill="${m.accent}" font-size="23" font-weight="750">오늘의 건강 실천</text>
  <text x="1360" y="871" text-anchor="end" fill="#52655f" font-size="16">날짜마다 바뀌는 계절별 안내</text>
  ${m.tips.map((tip,i)=>`<circle cx="91" cy="${905+i*36}" r="12" fill="${m.accent}"/><text x="91" y="${911+i*36}" text-anchor="middle" fill="white" font-size="16" font-weight="700">${i+1}</text><text x="116" y="${912+i*36}" fill="#203f38" font-size="23" font-weight="550">${esc(tip)}</text>`).join('')}
  <text x="56" y="1050" fill="#65757e" font-size="15">${fc.source==='preview'?'미리보기 예시 · 실제 날씨가 아닙니다.':'출처 Open-Meteo · 현장 저장 좌표 기준 예보 · 실제 관측값과 다를 수 있습니다.'} · — 미제공</text>
  <text x="56" y="1075" fill="#65757e" font-size="15">온도 선 그래프와 풍속 막대는 별도 축입니다. 건강 안내는 작업 전 참고용이며 현장 관리계획을 함께 확인하세요.</text>
  </svg>`;
}

export function hourlyWeatherHtml(fc, mode='auto') {
  const m=posterModel(fc,mode);
  return `<div class="wx-chart-intro"><div><h3>시간별 기온과 바람</h3><p>기온·체감온도는 선으로, 풍속은 아래 막대로 비교하세요.</p></div><div class="wx-chart-legend"><span class="temp">기온 °C</span><span class="feel">체감온도 °C</span><span class="wind">풍속 m/s</span></div></div>
  <div class="wx-chart-scroll" tabindex="0" role="region" aria-label="시간별 그래프, 좌우로 스크롤">${weatherChartSvg(m.hours,{width:1120,height:340})}</div>
  <div class="wx-hourly-table" tabindex="0" role="region" aria-label="시간별 수치, 좌우로 스크롤"><table><caption>오늘 06–19시 예보 · — 표시는 미제공</caption><thead><tr><th scope="col">항목</th>${m.hours.map(h=>`<th scope="col">${h.hour}시</th>`).join('')}</tr></thead><tbody>${[['기온 (°C)','temp'],['체감온도 (°C)','feel'],['풍속 (m/s)','wind'],['습도 (%)','humidity']].map(([name,key])=>`<tr><th scope="row">${name}</th>${m.hours.map(h=>`<td>${metric(h[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="wx-detail-note">현장 저장 좌표 기준 예보 · 출처 ${fc.source==='preview'?'미리보기 예시':'Open-Meteo'} · 풍속은 바람의 속도입니다.</p>`;
}
