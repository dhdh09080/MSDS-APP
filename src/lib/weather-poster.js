import { TIPS, WEATHER_TIPS, EXTRA_TIPS } from './weather-advice.js';
import { posterLocale, localizeAdvice, localizeAlert, posterDateTitle, posterDateLabel, localizedHour } from './weather-poster-i18n.js';
const finite = v => typeof v === 'number' && Number.isFinite(v);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const metric = (v, unit = '') => finite(v) ? `${Math.round(v * 10) / 10}${unit}` : '—';
export const kstDate = (now = Date.now()) => new Date(now + 9 * 3600000).toISOString().slice(0,10);
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

function dailyWeatherTips(model, day) {
  const index=((day%7)+7)%7;
  const tips=model.alerts.map(alert=>{
    const pool=WEATHER_TIPS[alert.kind === 'wind'?'wind':alert.kind+alert.level];
    return pool[((day%pool.length)+pool.length)%pool.length];
  });
  // Add one extra weather-specific action when several simultaneous alerts do not fill the list.
  if (tips.length < 2 && model.alerts.some(a=>a.kind==='heat')) tips.push(EXTRA_TIPS[0]);
  if (tips.length < 2 && model.alerts.some(a=>a.kind==='cold')) tips.push(EXTRA_TIPS[1]);
  if (tips.length < 2 && model.alerts.some(a=>a.kind==='wind')) tips.push(EXTRA_TIPS[2]);
  if (tips.length < 2 && finite(model.high) && finite(model.low) && model.high-model.low >= 10) tips.push(EXTRA_TIPS[3]);
  if (tips.length < 2 && model.hours.some(h=>finite(h.humidity) && h.humidity>=80 && finite(h.feel) && h.feel>=28)) tips.push(EXTRA_TIPS[4]);
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
export function weatherChartSvg(hours, {width=1328,height=300,left=100,right=24,colors=['#3265b4','#c46132','#79a89d'],fontScale=1,lang='ko'} = {}) {
  const l=posterLocale(lang);
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
  content+=`<text x="${left-30}" y="${windBottom-30}" text-anchor="end" fill="#677582" font-size="14">${lang==='my'?'':l.wind}</text><text x="${left-30}" y="${windBottom-10}" text-anchor="end" fill="#677582" font-size="13">m/s</text>`;
  for(const [key,color,dash] of [['temp',colors[0],''],['feel',colors[1],'8 5']]) {
    let segment=[];
    const flush=()=>{if(segment.length)content+=`<polyline points="${segment.join(' ')}" fill="none" stroke="${color}" stroke-width="3.5" ${dash?`stroke-dasharray="${dash}"`:''} stroke-linejoin="round" stroke-linecap="round"/>`;segment=[];};
    hours.forEach((h,i)=>{if(finite(h[key]))segment.push(`${x(i)},${y(h[key])}`);else flush();});flush();
    hours.forEach((h,i)=>{if(finite(h[key])) {
      const rawAlert=metricAlert(key,h[key]);
      const alert=rawAlert?localizeAlert(rawAlert,lang):null;
      content+=`<circle cx="${x(i)}" cy="${y(h[key])}" r="${alert?6:3.8}" fill="${alert?.color||color}"${alert?' stroke="white" stroke-width="2"':''}><title>${localizedHour(h.hour,lang)} ${riskMetric(key,h[key])}°C${alert?' · '+alert.label+' · '+alert.threshold:''}</title></circle>`;
    }});
  }
  hours.forEach((h,i)=>{
    if(finite(h.wind)) {
      const barHeight=h.wind/maxWind*windHeight;
      const rawAlert=metricAlert('wind',h.wind);
      const alert=rawAlert?localizeAlert(rawAlert,lang):null;
      content+=`<rect x="${x(i)-12}" y="${windBottom-barHeight}" width="24" height="${Math.max(1,barHeight)}" rx="1" fill="${alert?.color||colors[2]}"><title>${localizedHour(h.hour,lang)} ${riskMetric('wind',h.wind)}m/s${alert?' · '+alert.label:''}</title></rect><text x="${x(i)}" y="${windBottom-barHeight-6}" text-anchor="middle" fill="${alert?.color||'#626970'}" font-weight="${alert?700:400}" font-size="14">${riskMetric('wind',h.wind)}</text>`;
    }
    content+=`<text x="${x(i)}" y="${height-13}" text-anchor="middle" fill="#364552" font-size="16">${localizedHour(h.hour,lang)}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(l.chart)}"><title>${esc(l.chart)} · °C / m/s</title>${content}</svg>`.replace(/font-size="(\d+)"/g, (_,n)=>`font-size="${Number(n)*fontScale}"`);
}

export function wrapPosterAdvice(text,locale,size,width,measure) {
  const segments=[...new Intl.Segmenter(locale,{granularity:'word'}).segment(text)].map(s=>s.segment);
  const lines=[];let line='';
  for(const part of segments){
    if(measure(line+part,size)<=width){line+=part;continue;}
    if(line.trim())lines.push(line.trim());line='';
    if(measure(part,size)<=width){line=part.trimStart();continue;}
    for(const {segment} of new Intl.Segmenter(locale,{granularity:'grapheme'}).segment(part)){
      if(measure(line+segment,size)>width&&line){lines.push(line.trim());line='';}line+=segment;
    }
  }
  if(line.trim())lines.push(line.trim());return lines;
}

export const A4_POSTER = Object.freeze({width:1260,height:1782,exportWidth:2520,exportHeight:3564});

export function buildHealthPosterSvg(fc, site = {}, mode='auto', lang='ko', options={}) {
  const l=posterLocale(lang);
  const measure=options.measureText||((text,size)=>Array.from(text).reduce((sum,c)=>sum+(c.charCodeAt(0)<256?.55:1),0)*size);
  const fit=(text,size,width=1116,weight=400)=>Math.min(size,size*width/Math.max(1,measure(text,size,weight)));
  const fontFamily=`'${l.font}','Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif`;
  const siteName=String(site.name||l.site);

  const m=posterModel(fc,mode);
  const accent=m.season==='winter'?'#285caa':m.season==='summer'?'#d94b25':'#ce512a';
  const dateTitle=posterDateTitle(m.date,l.lang);
  const dateLabel=posterDateLabel(m.date,l.lang);
  const coldAlert=metricAlert('temp',m.low), heatAlert=metricAlert('feel',m.maxFeel), windAlert=metricAlert('wind',m.maxWind);
  const banner=m.alerts.map(a=>localizeAlert(a,l.lang)).map((a,i)=>`<rect x="${72+i*378}" y="337" width="360" height="32" fill="${a.background}"/><rect x="${72+i*378}" y="337" width="4" height="32" fill="${a.color}"/><text x="${84+i*378}" y="360" fill="${a.color}" font-size="${fit(a.label+' · '+a.threshold,l.lang==='my'?16:19,330,650)}" font-weight="650">${esc(a.label)} · ${esc(a.threshold)}</text>`).join('');
  const chart=weatherChartSvg(m.hours,{width:1116,height:276,left:60,right:24,colors:['#242628',accent,'#a4adb3'],fontScale:1.25,lang:l.lang}).replace('<svg ', '<svg x="72" y="724" ');
  const table=(hours,y)=>{
    const left=72,labelWidth=160,colWidth=956/7;
    const rows=[[l.temp+' °C','temp','#242628'],[l.feel+' °C','feel',accent],[l.wind+' m/s','wind','#626970']];
    return `<line x1="72" x2="1188" y1="${y}" y2="${y}" stroke="#242628" stroke-width="2"/>
      <text x="72" y="${y+30}" fill="#747a7e" font-size="21">${l.time}</text>
      ${hours.map((h,i)=>`<text x="${left+labelWidth+(i+.5)*colWidth}" y="${y+30}" text-anchor="middle" fill="#242628" font-size="23" font-weight="600">${localizedHour(h.hour,l.lang)}</text>`).join('')}
      <line x1="72" x2="1188" y1="${y+45}" y2="${y+45}" stroke="#dce0e2"/>
      ${rows.map(([name,key,color],r)=>`<text x="72" y="${y+75+r*38}" fill="${color}" font-size="${fit(name,22,150)}">${esc(name)}</text>${hours.map((h,i)=>{
        const rawAlert=metricAlert(key,h[key]),alert=rawAlert?localizeAlert(rawAlert,l.lang):null,x=left+labelWidth+(i+.5)*colWidth,yy=y+75+r*38;
        return `${alert?`<rect x="${x-50}" y="${yy-26}" width="100" height="34" fill="${alert.background}"/><line x1="${x-50}" x2="${x+50}" y1="${yy+8}" y2="${yy+8}" stroke="${alert.color}" stroke-width="${alert.level+1}"/>`:''}<text x="${x}" y="${yy}" text-anchor="middle" fill="${alert?.color||color}" font-size="26" font-weight="${alert?750:500}">${riskMetric(key,h[key])}${alert?`<title>${alert.label} · ${alert.threshold}</title>`:''}</text>`;
      }).join('')}`).join('')}`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1260" height="1782" viewBox="0 0 1260 1782" lang="${l.lang}" xml:lang="${l.lang}" font-family="${fontFamily}">
  <style>${options.fontCss||''}</style>
  <title>${esc(siteName)} · ${esc(dateTitle)} · A4</title>
  <rect width="1260" height="1782" fill="#ffffff"/>
  <text x="72" y="79" fill="#242628" font-size="22" font-weight="600">${esc(l.header)}</text>
  <text x="1188" y="79" text-anchor="end" fill="#626970" font-size="${fit(dateLabel,22,550)}">${esc(dateLabel)}</text>
  <line x1="72" x2="1188" y1="105" y2="105" stroke="#242628" stroke-width="2"/>
  <text x="72" y="181" fill="#202224" font-size="${fit(siteName,68,1116,700)}" font-weight="700" letter-spacing="-1">${esc(siteName)}</text>
  <text x="72" y="255" fill="#202224" font-size="${fit(dateTitle,l.lang==='my'?54:66,1116,650)}" font-weight="650" letter-spacing="${l.lang==='ko'?'-2':'0'}">${esc(dateTitle)}</text>
  <text x="72" y="310" fill="#747a7e" font-size="${fit(String(site.address||fc.address||''),21,1116)}">${esc(String(site.address||fc.address||''))}</text>
  ${banner}
  <text x="72" y="400" fill="#626970" font-size="23">${l.high}</text>
  <text x="660" y="400" fill="#626970" font-size="23">${l.low}</text>
  <text x="72" y="544" fill="#202224" font-size="160" font-weight="600" letter-spacing="-8">${riskMetric('temp',m.high,'°')}</text>
  <text x="660" y="544" fill="${coldAlert?.color||'#747a7e'}" font-size="160" font-weight="500" letter-spacing="-8">${riskMetric('temp',m.low,'°')}</text>
  <text x="72" y="581" fill="#626970" font-size="${fit(l.feelHigh,21,500)}">${esc(l.feelHigh)}</text>
  <text x="72" y="617" fill="${heatAlert?.color||accent}" font-size="31" font-weight="600">${riskMetric('feel',m.maxFeel,'°C')}</text>
  <text x="660" y="581" fill="#626970" font-size="${fit(l.windHigh,21,500)}">${esc(l.windHigh)}</text>
  <text x="660" y="617" fill="${windAlert?.color||'#242628'}" font-size="31" font-weight="600">${riskMetric('wind',m.maxWind,' m/s')}</text>
  <line x1="72" x2="1188" y1="636" y2="636" stroke="#dce0e2"/>
  <text x="72" y="684" fill="#242628" font-size="29" font-weight="650">${l.hourly}</text>
  <text x="72" y="714" fill="#747a7e" font-size="${fit(l.period,18,1116)}">${esc(l.period)}</text>
  <line x1="770" x2="800" y1="678" y2="678" stroke="#242628" stroke-width="4"/><text x="811" y="685" fill="#626970" font-size="20">${l.temp}</text>
  <line x1="887" x2="917" y1="678" y2="678" stroke="${accent}" stroke-width="4" stroke-dasharray="8 5"/><text x="928" y="685" fill="#626970" font-size="20">${l.feel}</text>
  <rect x="1015" y="667" width="15" height="19" fill="#a4adb3"/><text x="1042" y="685" fill="#626970" font-size="${l.lang==='my'?16:20}">${l.wind}</text>
  ${chart}
  ${table(m.hours.filter(h=>h.hour<=12),1036)}
  ${table(m.hours.filter(h=>h.hour>=13),1220)}
  <line x1="72" x2="1188" y1="1412" y2="1412" stroke="#dce0e2"/>
  <text x="72" y="1465" fill="#242628" font-size="29" font-weight="650">${l.tips}</text>
  ${localizeAdvice(m.tips,l.lang).map((tip,i)=>{
    let size=l.lang==='my'?24:26;
    let lines=wrapPosterAdvice(tip,l.locale,size,1056,measure);
    while(lines.length>2&&size>16){size-=1;lines=wrapPosterAdvice(tip,l.locale,size,1056,measure);}
    const y=1498+i*62;
    return `<text x="72" y="${y}" fill="${accent}" font-size="23" font-weight="650">0${i+1}</text>${lines.map((line,j)=>`<text x="132" y="${y+j*31}" fill="#242628" font-size="${size}" font-weight="400">${esc(line)}</text>`).join('')}`;
  }).join('')}
  <line x1="72" x2="1188" y1="1663" y2="1663" stroke="#242628" stroke-width="1.5"/>
  <text x="72" y="1700" fill="#747a7e" font-size="${fit(fc.source==='preview'?l.preview:l.source,18,1116)}">${esc(fc.source==='preview'?l.preview:l.source)}</text>
  <text x="72" y="1730" fill="#747a7e" font-size="${fit(l.note,18,900)}">${esc(l.note)}</text>
  <text x="1188" y="1730" text-anchor="end" fill="#747a7e" font-size="18">A4 · 210 × 297 mm</text>
  </svg>`;
}

export function hourlyWeatherHtml(fc, mode='auto') {
  const m=posterModel(fc,mode);
  return `${weatherAlertsHtml(m.alerts)}<div class="wx-chart-intro"><div><h3>시간별 기온과 바람</h3><p>기온·체감온도는 선으로, 풍속은 아래 막대로 비교하세요.</p></div><div class="wx-chart-legend"><span class="temp">기온 °C</span><span class="feel">체감온도 °C</span><span class="wind">풍속 m/s</span></div></div>
  <div class="wx-chart-scroll" tabindex="0" role="region" aria-label="시간별 그래프, 좌우로 스크롤">${weatherChartSvg(m.hours,{width:1120,height:340})}</div>
  <div class="wx-hourly-table" tabindex="0" role="region" aria-label="시간별 수치, 좌우로 스크롤"><table><caption>오늘 06–19시 예보 · — 표시는 미제공</caption><thead><tr><th scope="col">항목</th>${m.hours.map(h=>`<th scope="col">${h.hour}시</th>`).join('')}</tr></thead><tbody>${[['기온 (°C)','temp'],['체감온도 (°C)','feel'],['풍속 (m/s)','wind'],['습도 (%)','humidity']].map(([name,key])=>`<tr><th scope="row">${name}</th>${m.hours.map(h=>`<td>${metricHtml(key,h[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="wx-detail-note">현장 저장 좌표 기준 예보 · 출처 ${fc.source==='preview'?'미리보기 예시':'Open-Meteo'} · 풍속은 바람의 속도입니다.</p>`;
}
