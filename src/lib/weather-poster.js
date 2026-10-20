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

// User-defined site thresholds; these are not official weather warnings.
export function metricAlert(key, value) {
  if (!finite(value)) return null;
  if (key === 'wind' && value >= 10) return {kind:'wind',level:1,label:'강풍 주의',threshold:'10m/s 이상',color:'#a64b08',background:'#fff3e6'};
  if (key === 'feel') {
    if (value >= 35) return {kind:'heat',level:3,label:'더위 위험',threshold:'35°C 이상',color:'#b42318',background:'#fff0ed'};
    if (value >= 33) return {kind:'heat',level:2,label:'더위 경계',threshold:'33°C 이상',color:'#bd4612',background:'#fff1e6'};
    if (value >= 31) return {kind:'heat',level:1,label:'더위 주의',threshold:'31°C 이상',color:'#936000',background:'#fff6d9'};
  }
  if (key === 'temp') {
    if (value <= -15) return {kind:'cold',level:2,label:'추위 경고',threshold:'−15°C 이하',color:'#214ea0',background:'#eaf0ff'};
    if (value <= -12) return {kind:'cold',level:1,label:'추위 주의',threshold:'−12°C 이하',color:'#286382',background:'#edf6fb'};
  }
  return null;
}

// A rounded value must not appear to cross a threshold that the actual value did not reach.
export function riskMetric(key, value, unit='') {
  if (!finite(value)) return '—';
  const rounded=metric(value);
  const display=(metricAlert(key,value)?.level||0)!==(metricAlert(key,Number(rounded))?.level||0) ? String(value) : rounded;
  return display+unit;
}

const WEATHER_TIPS = {
  wind: [
    '풍속 10m/s 이상 시간대의 고소·양중 작업계획을 관리자와 확인하세요.',
    '강풍 시간대를 확인하고 날릴 수 있는 자재와 가설물을 고정하세요.',
    '바람이 강해지는 시간의 작업동선과 낙하물 방지 상태를 확인하세요.',
  ],
  heat1: [
    '체감온도 31°C 이상에 대비해 시원한 물과 그늘을 준비하세요.',
    '체감온도가 31°C 이상인 시간대를 확인하고 휴식 계획을 세우세요.',
    '더위 주의 시간에 쉴 수 있도록 물과 시원한 휴게공간을 확인하세요.',
  ],
  heat2: [
    '체감온도 33°C 이상 시간대에는 작업 강도와 휴식 계획을 점검하세요.',
    '더위가 심한 시간의 작업을 조정하고 동료의 몸 상태를 살피세요.',
    '체감온도 33°C 이상에 대비해 시원한 곳에서 충분히 쉬도록 준비하세요.',
  ],
  heat3: [
    '체감온도 35°C 이상 시간대의 작업 일정을 관리자와 조정하세요.',
    '매우 더운 시간의 야외작업 계획과 시원한 대피·휴게공간을 확인하세요.',
    '체감온도 35°C 이상 예보를 공유하고 작업 강도와 휴식을 재점검하세요.',
  ],
  cold1: [
    '기온 −12°C 이하 시간에 대비해 방한복과 따뜻한 휴게공간을 준비하세요.',
    '추위 주의 시간대를 확인하고 방풍복·장갑·보온 신발을 점검하세요.',
    '기온 −12°C 이하 예보를 공유하고 추위를 피할 휴식 계획을 확인하세요.',
  ],
  cold2: [
    '기온 −15°C 이하 시간대의 야외작업 일정을 관리자와 조정하세요.',
    '심한 추위에 대비해 따뜻한 휴식과 동료 상태 확인 계획을 세우세요.',
    '기온 −15°C 이하 예보를 공유하고 방한 장비와 휴게공간을 재점검하세요.',
  ],
};

function dailyWeatherTips(model, day) {
  const index=((day%7)+7)%7;
  const tips=model.alerts.map(alert=>{
    const pool=WEATHER_TIPS[alert.kind === 'wind'?'wind':alert.kind+alert.level];
    return pool[((day%pool.length)+pool.length)%pool.length];
  });
  // Add one extra weather-specific action when several simultaneous alerts do not fill the list.
  if (tips.length < 2 && model.alerts.some(a=>a.kind==='heat')) tips.push('물과 시원한 휴게공간을 확보하고 동료의 몸 상태를 서로 확인하세요.');
  if (tips.length < 2 && model.alerts.some(a=>a.kind==='cold')) tips.push('바람을 피할 수 있는 따뜻한 휴게공간과 여벌 장갑을 준비하세요.');
  if (tips.length < 2 && model.alerts.some(a=>a.kind==='wind')) tips.push('가설물과 자재의 고정 상태를 확인하고 위험 구역 접근을 관리하세요.');
  if (tips.length < 2 && finite(model.high) && finite(model.low) && model.high-model.low >= 10) tips.push('일교차가 10°C 이상입니다. 겉옷과 여벌 옷을 준비하세요.');
  if (tips.length < 2 && model.hours.some(h=>finite(h.humidity) && h.humidity>=80 && finite(h.feel) && h.feel>=28)) tips.push('덥고 습한 시간에 대비해 통풍과 시원한 휴게공간을 확인하세요.');
  for(const tip of TIPS[model.season][index]) if(!tips.includes(tip)) tips.push(tip);
  return tips.slice(0,3);
}

export function weatherAlertsHtml(alerts) {
  if (!alerts.length) return '';
  return `<div class="wx-weather-alerts" aria-label="현장 설정 기준 경고">${alerts.map(a=>`<span class="wx-weather-alert" style="--alert-color:${a.color};--alert-background:${a.background}"><b>${a.label}</b><span>${a.threshold} · ${a.hours.map(h=>h+'시').join(', ')}</span></span>`).join('')}</div>`;
}

function metricHtml(key, value) {
  const alert=metricAlert(key,value);
  return alert ? `<strong class="wx-alert-value" style="--alert-color:${alert.color};--alert-background:${alert.background}" aria-label="${riskMetric(key,value)} · ${alert.label} · ${alert.threshold}">${riskMetric(key,value)}</strong>` : riskMetric(key,value);
}


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
  const model = {date,hours,season,...themes[season],
    high:temps.length?Math.max(...temps):null, low:temps.length?Math.min(...temps):null,
    maxFeel:feels.length?Math.max(...feels):null, maxWind:winds.length?Math.max(...winds):null};
  model.alerts = [['feel',model.maxFeel],['temp',model.low],['wind',model.maxWind]].flatMap(([key,value])=>{
    const alert=metricAlert(key,value);
    return alert ? [{...alert,value,hours:hours.filter(h=>(metricAlert(key,h[key])?.level||0)>=alert.level).map(h=>h.hour)}] : [];
  });
  model.tips = dailyWeatherTips(model,day);
  return model;
}

// Separate temperature and wind scales. Missing values break the line instead of becoming zero.
export function weatherChartSvg(hours, {width=1328,height=300,left=100,right=24,colors=['#3265b4','#c46132','#79a89d'],fontScale=1} = {}) {
  const top=22,bottom=42,windHeight=62,gap=36;
  const tempBottom=height-bottom-windHeight-gap;
  const values=hours.flatMap(h=>[h.temp,h.feel]).filter(finite);
  const range=values.length?Math.max(...values)-Math.min(...values):10;
  const step=range<=6?2:range<=15?5:range<=30?10:20;
  const lo=values.length?Math.floor(Math.min(...values)/step)*step:0;
  const hi=Math.max(lo+step,values.length?Math.ceil(Math.max(...values)/step)*step:10);
  const tickCount=Math.round((hi-lo)/step);
  const maxWind=Math.max(5,...hours.map(h=>h.wind).filter(finite));
  const plotWidth=width-left-right;
  const x=i=>left+(hours.length===1?plotWidth/2:i*plotWidth/Math.max(1,hours.length-1));
  const y=v=>tempBottom-(v-lo)/(hi-lo)*(tempBottom-top);
  const windBottom=height-bottom;
  let content='';
  for(let i=0;i<=tickCount;i++) {
    const v=lo+step*i,yy=y(v);
    content+=`<line x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}" stroke="#dfe5e9"/><text x="${left-12}" y="${yy+5}" text-anchor="end" fill="#677582" font-size="16">${Math.round(v)}°</text>`;
  }
  content+=`<text x="${left-30}" y="${windBottom-30}" text-anchor="end" fill="#677582" font-size="14">풍속</text><text x="${left-30}" y="${windBottom-10}" text-anchor="end" fill="#677582" font-size="13">m/s</text>`;
  for(const [key,color,dash] of [['temp',colors[0],''],['feel',colors[1],'8 5']]) {
    let segment=[];
    const flush=()=>{if(segment.length)content+=`<polyline points="${segment.join(' ')}" fill="none" stroke="${color}" stroke-width="3.5" ${dash?`stroke-dasharray="${dash}"`:''} stroke-linejoin="round" stroke-linecap="round"/>`;segment=[];};
    hours.forEach((h,i)=>{if(finite(h[key]))segment.push(`${x(i)},${y(h[key])}`);else flush();});flush();
    hours.forEach((h,i)=>{if(finite(h[key])) {
      const alert=metricAlert(key,h[key]);
      content+=`<circle cx="${x(i)}" cy="${y(h[key])}" r="${alert?6:3.8}" fill="${alert?.color||color}"${alert?' stroke="white" stroke-width="2"':''}><title>${h.hour}시 ${metric(h[key])}°C${alert?' · '+alert.label+' · '+alert.threshold:''}</title></circle>`;
    }});
  }
  hours.forEach((h,i)=>{
    if(finite(h.wind)) {
      const barHeight=h.wind/maxWind*windHeight;
      const alert=metricAlert('wind',h.wind);
      content+=`<rect x="${x(i)-12}" y="${windBottom-barHeight}" width="24" height="${Math.max(1,barHeight)}" rx="1" fill="${alert?.color||colors[2]}"><title>${h.hour}시 ${riskMetric('wind',h.wind)}m/s${alert?' · '+alert.label:''}</title></rect><text x="${x(i)}" y="${windBottom-barHeight-6}" text-anchor="middle" fill="${alert?.color||'#626970'}" font-weight="${alert?700:400}" font-size="14">${riskMetric('wind',h.wind)}</text>`;
    }
    content+=`<text x="${x(i)}" y="${height-13}" text-anchor="middle" fill="#364552" font-size="16">${h.hour}시</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="시간별 기온·체감온도 선 그래프와 풍속 막대 그래프"><title>기온과 체감온도는 °C, 풍속은 별도 막대 축의 m/s입니다. 정확한 값은 시간별 표에서 확인하세요.</title>${content}</svg>`.replace(/font-size="(\d+)"/g, (_,n)=>`font-size="${Number(n)*fontScale}"`);
}

export const A4_POSTER = Object.freeze({width:1260,height:1782,exportWidth:2520,exportHeight:3564});

export function buildHealthPosterSvg(fc, site = {}, mode='auto') {
  const m=posterModel(fc,mode);
  const accent=m.season==='winter'?'#285caa':m.season==='summer'?'#d94b25':'#ce512a';
  const dateLabel=new Date(m.date+'T12:00:00+09:00').toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',weekday:'long'});
  const coldAlert=metricAlert('temp',m.low), heatAlert=metricAlert('feel',m.maxFeel), windAlert=metricAlert('wind',m.maxWind);
  const banner=m.alerts.map((a,i)=>`<rect x="${72+i*378}" y="337" width="360" height="32" fill="${a.background}"/><rect x="${72+i*378}" y="337" width="4" height="32" fill="${a.color}"/><text x="${84+i*378}" y="360" fill="${a.color}" font-size="19" font-weight="650">${a.label} · ${a.threshold}</text>`).join('');
  const chart=weatherChartSvg(m.hours,{width:1116,height:276,left:60,right:24,colors:['#242628',accent,'#a4adb3'],fontScale:1.25}).replace('<svg ', '<svg x="72" y="724" ');
  const table=(hours,y)=>{
    const left=72,labelWidth=160,colWidth=956/7;
    const rows=[['기온 °C','temp','#242628'],['체감 °C','feel',accent],['풍속 m/s','wind','#626970']];
    return `<line x1="72" x2="1188" y1="${y}" y2="${y}" stroke="#242628" stroke-width="2"/>
      <text x="72" y="${y+30}" fill="#747a7e" font-size="21">시간</text>
      ${hours.map((h,i)=>`<text x="${left+labelWidth+(i+.5)*colWidth}" y="${y+30}" text-anchor="middle" fill="#242628" font-size="23" font-weight="600">${h.hour}시</text>`).join('')}
      <line x1="72" x2="1188" y1="${y+45}" y2="${y+45}" stroke="#dce0e2"/>
      ${rows.map(([name,key,color],r)=>`<text x="72" y="${y+75+r*38}" fill="${color}" font-size="22">${name}</text>${hours.map((h,i)=>{
        const alert=metricAlert(key,h[key]),x=left+labelWidth+(i+.5)*colWidth,yy=y+75+r*38;
        return `${alert?`<rect x="${x-50}" y="${yy-26}" width="100" height="34" fill="${alert.background}"/><line x1="${x-50}" x2="${x+50}" y1="${yy+8}" y2="${yy+8}" stroke="${alert.color}" stroke-width="${alert.level+1}"/>`:''}<text x="${x}" y="${yy}" text-anchor="middle" fill="${alert?.color||color}" font-size="26" font-weight="${alert?750:500}">${riskMetric(key,h[key])}${alert?`<title>${alert.label} · ${alert.threshold}</title>`:''}</text>`;
      }).join('')}`).join('')}`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1260" height="1782" viewBox="0 0 1260 1782" font-family="'Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif">
  <title>${esc(m.title)} · ${esc(dateLabel)} · A4 세로</title>
  <rect width="1260" height="1782" fill="#ffffff"/>
  <text x="72" y="79" fill="#242628" font-size="22" font-weight="600">현장 기상 · 건강 안내</text>
  <text x="1188" y="79" text-anchor="end" fill="#626970" font-size="22">${esc(dateLabel)}</text>
  <line x1="72" x2="1188" y1="105" y2="105" stroke="#242628" stroke-width="2"/>
  <rect x="72" y="157" width="8" height="78" fill="${accent}"/>
  <text x="104" y="224" fill="#202224" font-size="82" font-weight="750" letter-spacing="-4">${m.title}</text>
  <text x="72" y="284" fill="#242628" font-size="30" font-weight="550">${esc(String(site.name||'현장').slice(0,32))}</text>
  <text x="72" y="320" fill="#747a7e" font-size="21">${esc(String(site.address||fc.address||'').slice(0,52))}</text>
  ${banner}
  <text x="72" y="400" fill="#626970" font-size="23">최고 기온</text>
  <text x="660" y="400" fill="#626970" font-size="23">최저 기온</text>
  <text x="72" y="544" fill="#202224" font-size="160" font-weight="600" letter-spacing="-8">${riskMetric('temp',m.high,'°')}</text>
  <text x="660" y="544" fill="${coldAlert?.color||'#747a7e'}" font-size="160" font-weight="500" letter-spacing="-8">${riskMetric('temp',m.low,'°')}</text>
  <text x="72" y="597" fill="#626970" font-size="23">최고 체감온도 <tspan fill="${heatAlert?.color||accent}" font-size="31" font-weight="600" dx="18">${riskMetric('feel',m.maxFeel,'°C')}</tspan></text>
  <text x="660" y="597" fill="#626970" font-size="23">최대 풍속 <tspan fill="${windAlert?.color||'#242628'}" font-size="31" font-weight="600" dx="18">${riskMetric('wind',m.maxWind,' m/s')}</tspan></text>
  <line x1="72" x2="1188" y1="636" y2="636" stroke="#dce0e2"/>
  <text x="72" y="684" fill="#242628" font-size="29" font-weight="650">시간별 예보</text>
  <text x="72" y="714" fill="#747a7e" font-size="18">모든 기온·체감온도·풍속은 06–19시 예보 기준</text>
  <line x1="770" x2="800" y1="678" y2="678" stroke="#242628" stroke-width="4"/><text x="811" y="685" fill="#626970" font-size="20">기온</text>
  <line x1="887" x2="917" y1="678" y2="678" stroke="${accent}" stroke-width="4" stroke-dasharray="8 5"/><text x="928" y="685" fill="#626970" font-size="20">체감</text>
  <rect x="1015" y="667" width="15" height="19" fill="#a4adb3"/><text x="1042" y="685" fill="#626970" font-size="20">풍속</text>
  ${chart}
  ${table(m.hours.filter(h=>h.hour<=12),1036)}
  ${table(m.hours.filter(h=>h.hour>=13),1220)}
  <line x1="72" x2="1188" y1="1412" y2="1412" stroke="#dce0e2"/>
  <text x="72" y="1465" fill="#242628" font-size="29" font-weight="650">작업 전 확인</text>
  ${m.tips.map((tip,i)=>`<text x="72" y="${1520+i*52}" fill="${accent}" font-size="23" font-weight="650">0${i+1}</text><text x="132" y="${1520+i*52}" fill="#242628" font-size="26" font-weight="500">${esc(tip)}</text>`).join('')}
  <line x1="72" x2="1188" y1="1663" y2="1663" stroke="#242628" stroke-width="1.5"/>
  <text x="72" y="1700" fill="#747a7e" font-size="18">${fc.source==='preview'?'미리보기 예시 · 실제 날씨가 아닙니다.':'출처 Open-Meteo · 현장 저장 좌표 기준 · 실제 관측값과 다를 수 있습니다.'}</text>
  <text x="72" y="1730" fill="#747a7e" font-size="18">경고는 현장 설정 기준이며 기상청 특보와 다릅니다. — 미제공</text>
  <text x="1188" y="1730" text-anchor="end" fill="#747a7e" font-size="18">A4 · 210 × 297 mm</text>
  </svg>`;
}

export function hourlyWeatherHtml(fc, mode='auto') {
  const m=posterModel(fc,mode);
  return `${weatherAlertsHtml(m.alerts)}<div class="wx-chart-intro"><div><h3>시간별 기온과 바람</h3><p>기온·체감온도는 선으로, 풍속은 아래 막대로 비교하세요.</p></div><div class="wx-chart-legend"><span class="temp">기온 °C</span><span class="feel">체감온도 °C</span><span class="wind">풍속 m/s</span></div></div>
  <div class="wx-chart-scroll" tabindex="0" role="region" aria-label="시간별 그래프, 좌우로 스크롤">${weatherChartSvg(m.hours,{width:1120,height:340})}</div>
  <div class="wx-hourly-table" tabindex="0" role="region" aria-label="시간별 수치, 좌우로 스크롤"><table><caption>오늘 06–19시 예보 · — 표시는 미제공</caption><thead><tr><th scope="col">항목</th>${m.hours.map(h=>`<th scope="col">${h.hour}시</th>`).join('')}</tr></thead><tbody>${[['기온 (°C)','temp'],['체감온도 (°C)','feel'],['풍속 (m/s)','wind'],['습도 (%)','humidity']].map(([name,key])=>`<tr><th scope="row">${name}</th>${m.hours.map(h=>`<td>${metricHtml(key,h[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="wx-detail-note">현장 저장 좌표 기준 예보 · 출처 ${fc.source==='preview'?'미리보기 예시':'Open-Meteo'} · 풍속은 바람의 속도입니다.</p>`;
}
