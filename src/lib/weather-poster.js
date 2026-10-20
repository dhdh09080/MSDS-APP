const finite = v => typeof v === 'number' && Number.isFinite(v);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const metric = (v, unit = '') => finite(v) ? `${Math.round(v * 10) / 10}${unit}` : '—';
export const kstDate = (now = Date.now()) => new Date(now + 9 * 3600000).toISOString().slice(0,10);
const TIPS = {
  summer: [
    ['목마를 때 물 찾지 않게, 작업 가까이에 물을 두세요.','쉬는 그늘이 멀면 자꾸 미루게 돼요. 가까운 곳을 정해두세요.','옆 동료가 많이 지쳐 보이면 먼저 쉬었다 가자고 해주세요.'],
    ['출근할 때 물병을 챙기고, 현장에서 한 번 더 채워두세요.','햇볕 아래서 쉬지 말고, 그늘이나 시원한 실내로 들어가세요.','어지럽거나 평소와 다르면 참지 말고 일을 멈추고 알리세요.'],
    ['더운 시간에 무거운 일이 몰렸다면, 시작 전에 순서를 상의하세요.','땀 닦을 수건과 갈아입을 옷을 한 벌 챙겨두세요.','혼자 떨어져 일하는 동료에게도 중간중간 말을 걸어주세요.'],
    ['물은 한꺼번에 마시기보다, 일하는 중간에도 자주 마셔주세요.','휴게실 에어컨은 쉬러 가기 전에 켜지는지 봐두세요.','좀 쉬면 괜찮겠지 하고 몸이 보내는 신호를 넘기지 마세요.'],
    ['오후에 쉴 곳이 그늘인지, 해가 드는 곳인지 먼저 봐두세요.','땀에 젖은 옷을 갈아입을 수 있게 여벌을 챙기세요.','현장에 처음 온 동료에게 물 마실 곳과 쉬는 곳을 알려주세요.'],
    ['물이 다 떨어진 뒤 움직이지 않게, 오전에 넉넉히 채워두세요.','쉴 때는 햇볕을 피하고, 몸에 쌓인 열을 식혀주세요.','오늘 유난히 힘들다면 혼자 버티지 말고 옆 사람에게 말해주세요.'],
    ['땀이 많이 나는 날엔 마른 수건과 여벌 옷이 도움이 돼요.','참을 만하다고 쉬는 시간을 자꾸 미루지 마세요.','얼굴이 붉거나 축 처진 동료가 있으면 괜찮은지 물어봐 주세요.'],
  ],
  transition: [
    ['아침엔 추워도 낮에는 땀이 날 수 있어요. 벗기 편한 겉옷을 챙기세요.','바로 무거운 것부터 들지 말고, 어깨와 허리를 천천히 풀어주세요.','여럿이 쓰는 휴게실은 쉬는 중간에 창문을 잠깐 열어주세요.'],
    ['두꺼운 옷 한 벌보다, 벗고 입기 편하게 겹쳐 입으세요.','땀 난 채로 바람 맞지 않게, 마른 옷을 한 벌 넣어두세요.','밥 먹기 전엔 손부터 씻고, 물병은 따로 쓰세요.'],
    ['출근길에 춥다고 옷을 너무 두껍게 입었다면, 일할 때 조절하세요.','한동안 앉아 쉬었다면, 다시 일하기 전에 몸부터 풀어주세요.','몸살 기운이 있거나 평소보다 힘들면 반장님께 먼저 말해주세요.'],
    ['오후에 벗어둘 겉옷과 갈아입을 속옷을 챙겨보세요.','차가운 아침엔 바로 힘쓰지 말고, 몸이 풀린 뒤 시작하세요.','휴게실이 답답하면 창문을 열고 잠깐 환기해주세요.'],
    ['바람 막아줄 얇은 겉옷 하나를 가방에 넣어두세요.','땀에 젖은 옷 그대로 쉬면 몸이 식어요. 마른 옷으로 갈아입으세요.','오늘 유난히 피곤하다면 쉬는 시간까지 무리해서 버티지 마세요.'],
    ['아침에 잠근 겉옷도 낮에는 더울 수 있어요. 땀이 차기 전에 조절하세요.','허리와 어깨가 굳어 있다면, 일 시작 전에 천천히 풀어주세요.','물 마실 틈도 없이 바빴다면, 잠깐 멈추고 한 모금 챙기세요.'],
    ['퇴근 무렵 다시 쌀쌀해질 수 있으니, 겉옷을 두고 가지 마세요.','개인 물병과 수건을 챙기면 여럿이 돌려 쓸 일이 줄어요.','쉬고 돌아온 뒤에도 바로 힘쓰지 말고, 몸을 조금 움직여주세요.'],
  ],
  winter: [
    ['장갑이 젖으면 손이 더 시려요. 마른 장갑을 한 켤레 더 챙기세요.','추울 때 들어가 쉴 곳과 따뜻한 물이 있는지 먼저 봐두세요.','그늘진 통로나 계단은 얼어 있을 수 있으니 발밑부터 살펴주세요.'],
    ['두꺼운 옷 한 벌보다, 겹쳐 입고 땀이 차면 조절하세요.','쉴 때는 바람 부는 밖에 서 있지 말고, 따뜻한 곳으로 들어가세요.','차가워진 몸으로 바로 힘쓰지 말고, 손발부터 천천히 움직이세요.'],
    ['젖은 양말로 하루 버티지 않게, 마른 양말을 챙겨두세요.','손끝이 너무 시리거나 감각이 둔해지면 일을 멈추고 알리세요.','밖에서 혼자 일하는 동료에게도 중간중간 말을 걸어주세요.'],
    ['출근길에 못 봤던 얇은 얼음이 있을 수 있어요. 계단은 천천히 가세요.','따뜻한 물을 가까이 두고, 몸을 녹일 쉬는 시간도 챙기세요.','난방기 가까이에 장갑이나 옷을 널어두지 마세요.'],
    ['목과 귀까지 가릴 수 있게, 작업에 맞는 방한용품을 챙기세요.','땀이나 눈에 젖은 장갑은 마른 것으로 갈아 끼우세요.','쉬는 시간엔 젖은 옷 그대로 바깥바람을 맞지 마세요.'],
    ['바람 부는 곳에서 오래 서 있지 않게, 기다릴 자리도 정해두세요.','따뜻한 실내에서 나갈 땐 겉옷과 장갑을 다시 챙기세요.','몸이 굳어 있다면, 무거운 것을 들기 전에 천천히 풀어주세요.'],
    ['주머니에 손 넣고 걷지 않게, 따뜻한 장갑을 챙겨 끼세요.','양말과 장갑이 젖지 않았는지 쉬는 시간에 한 번 봐주세요.','춥고 힘들어 보이는 동료에게 먼저 쉬었다 가자고 해주세요.'],
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
    '바람이 강해요. 높은 곳에서 할 일은 시작 전에 반장님과 상의하세요.',
    '강풍에 날릴 수 있는 합판과 포장재부터 묶어두세요.',
    '바람에 흔들리는 자재나 가림막이 보이면, 가까이 가지 말고 알려주세요.',
  ],
  heat1: [
    '더운 시간이 있어요. 일하는 곳 가까이에 시원한 물을 챙겨두세요.',
    '더위가 심해지기 전에 쉴 그늘을 정하고, 쉬는 시간을 미루지 마세요.',
    '목마를 때까지 기다리지 말고, 일하는 중간에도 물을 마셔주세요.',
  ],
  heat2: [
    '더운 시간에 무거운 일을 몰아서 하지 않게, 작업 순서를 상의하세요.',
    '더위에 지친 동료가 보이면, 그늘에서 같이 쉬었다 가세요.',
    '땀이 많이 나는 더위예요. 갈아입을 옷과 시원한 물을 챙겨두세요.',
  ],
  heat3: [
    '체감온도 35°C 이상인 시간이 있어요. 바깥일 시간부터 상의하세요.',
    '더위가 심해요. 무거운 일은 덜 더운 시간으로 옮길 수 있는지 물어보세요.',
    '많이 더운 날이에요. 참을 만하다고 혼자 계속 일하지 마세요.',
  ],
  cold1: [
    '추위가 매서워요. 마른 장갑과 양말을 한 켤레씩 더 챙겨두세요.',
    '추위가 심한 시간엔 바깥에서 오래 버티지 말고, 따뜻한 곳에서 쉬세요.',
    '바람까지 맞으면 더 추워요. 방한복 틈으로 바람이 들지 않게 여미세요.',
  ],
  cold2: [
    '기온이 −15°C 이하예요. 밖에서 오래 할 일은 반장님과 먼저 상의하세요.',
    '추위가 아주 심해요. 손발이 무뎌질 때까지 참고 일하지 마세요.',
    '매서운 추위예요. 밖에서 혼자 일하는 동료와 서로 안부를 물어주세요.',
  ],
};

function dailyWeatherTips(model, day) {
  const index=((day%7)+7)%7;
  const tips=model.alerts.map(alert=>{
    const pool=WEATHER_TIPS[alert.kind === 'wind'?'wind':alert.kind+alert.level];
    return pool[((day%pool.length)+pool.length)%pool.length];
  });
  // Add one extra weather-specific action when several simultaneous alerts do not fill the list.
  if (tips.length < 2 && model.alerts.some(a=>a.kind==='heat')) tips.push('물은 쉬는 곳에만 두지 말고, 작업 가까이에도 챙겨두세요.');
  if (tips.length < 2 && model.alerts.some(a=>a.kind==='cold')) tips.push('젖은 장갑으로 버티지 않게, 마른 장갑을 한 켤레 더 챙기세요.');
  if (tips.length < 2 && model.alerts.some(a=>a.kind==='wind')) tips.push('자재가 날릴 만한 곳에는 잠깐이라도 서 있지 마세요.');
  if (tips.length < 2 && finite(model.high) && finite(model.low) && model.high-model.low >= 10) tips.push('일교차가 10°C 이상이에요. 벗기 편한 겉옷을 챙기세요.');
  if (tips.length < 2 && model.hours.some(h=>finite(h.humidity) && h.humidity>=80 && finite(h.feel) && h.feel>=28)) tips.push('습하고 더운 날이에요. 쉴 때는 바람이 통하는 시원한 곳으로 가세요.');
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
    summer: { title:'혹서기 건강관리', accent:'#b84b20', pale:'#fff0e6', note:'더위가 쌓이기 전에, 물 · 그늘 · 휴식', action:'시원한 물과 쉴 그늘부터 챙겨두세요.' },
    transition: { title:'환절기 건강관리', accent:'#236559', pale:'#e9f4ee', note:'아침과 낮의 변화에, 옷차림 · 준비운동 · 위생', action:'아침과 낮이 달라요. 벗고 입기 편한 옷을 챙기세요.' },
    winter: { title:'동절기 건강관리', accent:'#245a91', pale:'#eaf2fb', note:'추위와 바람에 대비하는, 보온 · 따뜻한 휴식', action:'마른 장갑과 양말, 따뜻하게 쉴 곳부터 챙기세요.' },
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
  <text x="72" y="1465" fill="#242628" font-size="29" font-weight="650">오늘 챙길 것</text>
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
