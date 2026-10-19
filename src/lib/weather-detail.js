import { aggregateDays } from '../../supabase/functions/site-weather/lib/forecast.js';
import './weather-detail.css';

const value = (v, unit = '') => typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 10) / 10}${unit}` : '—';
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const dateLabel = date => new Date(date + 'T12:00:00+09:00').toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month:'numeric', day:'numeric', weekday:'short' });
let data = null, selected = '', range = 7, request = 0;
let icon, label;

export async function loadWeatherDetail({ workspace, invoke, preview, weatherIcon, weatherLabel }) {
  const token = ++request;
  icon = weatherIcon; label = weatherLabel;
  data = null;
  const root = document.getElementById('wxDetailBody');
  root.innerHTML = '<p class="wx-detail-message" role="status">상세 예보를 불러오는 중입니다…</p>';
  if (!workspace?.latitude || !workspace?.longitude) {
    root.innerHTML = '<p class="wx-detail-message">현장 주소와 좌표를 설정하면 상세 날씨를 볼 수 있습니다.</p>';
    return;
  }
  try {
    let result;
    if (preview) {
      const start = new Date(new Date(Date.now() + 9 * 3600000).toISOString().slice(0,10) + 'T00:00:00Z');
      const hourly = Array.from({length: 16 * 24}, (_, i) => {
        const time = new Date(start.getTime() + i * 3600000).toISOString().slice(0,16);
        return { time, date: time.slice(0,10), hour: i % 24, temp: 18 + Math.round(5 * Math.sin(i / 4)),
          feel: 17 + Math.round(5 * Math.sin(i / 4)), humidity: 60 + i % 25, pop: Math.floor(i / 24) % 3 === 1 ? 70 : 10,
          wind: 2.4, direction: 180, precipitation: Math.floor(i / 24) % 3 === 1 ? 1.2 : 0,
          code: Math.floor(i / 24) % 3 === 1 ? 61 : 2, source: '미리보기 예시' };
      });
      result = { date: hourly[0].date, hourly, daily: aggregateDays(hourly), issuedAt: new Date().toISOString(), warnings:['미리보기 예시 · 실제 현장 날씨가 아닙니다.'] };
    } else result = (await invoke('site-weather', {action:'detailed', latitude: workspace.latitude, longitude: workspace.longitude, address: workspace.address})).result;
    if (token !== request) return;
    if (!result?.daily?.length || !result?.hourly?.length) throw new Error('상세 예보가 없습니다. site-weather 함수 배포 상태를 확인해주세요.');
    data = result;
    selected = result.date;
    render();
  } catch (e) {
    if (token !== request) return;
    root.innerHTML = `<div class="wx-detail-message" role="alert">${escape(e.message)}<br><button type="button" class="btn btn-outline btn-sm" onclick="loadWeatherPage(true)">다시 시도</button></div>`;
  }
}

function render() {
  const root = document.getElementById('wxDetailBody');
  const start = new Date(data.date + 'T00:00:00Z');
  const days = Array.from({length:range}, (_, i) => new Date(start.getTime() + i * 86400000).toISOString().slice(0,10));
  const dayMap = new Map(data.daily.map(d => [d.date, d]));
  root.innerHTML = `<div class="wx-detail-toolbar"><div class="wx-range" role="group" aria-label="예보 표시 기간">${[7,16,30].map(n => `<button type="button" data-range="${n}" aria-pressed="${range === n}">${n === 30 ? '한 달' : n + '일'}</button>`).join('')}</div><small>조회 ${escape(new Date(data.issuedAt).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'}))} · 한국 시간</small></div>
    ${(data.warnings || []).map(w => `<p class="wx-detail-note">${escape(w)}</p>`).join('')}
    <div class="wx-calendar" aria-label="날짜별 예보">${days.map(date => {
      const d = dayMap.get(date);
      return `<button type="button" class="wx-calendar-day ${selected === date ? 'selected' : ''}" data-date="${date}" aria-pressed="${selected === date}"><b>${date === data.date ? '오늘 · ' : ''}${dateLabel(date)}</b>${d ? `<span class="wx-calendar-icon" aria-label="${escape(label(d.code))}">${icon(d.code)}</span><span>${escape(label(d.code))}</span><strong>${value(d.max,'°')} <small>${value(d.min,'°')}</small></strong><span>강수 ${value(d.pop,'%')}</span><small>${escape(d.source)}</small>` : '<span class="wx-no-forecast">예보 미제공</span><small>발표 후 확인</small>'}</button>`;
    }).join('')}</div>
    <div id="wxSelectedDetail" aria-live="polite"></div>`;
  root.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => { range = Number(b.dataset.range); if (!Array.from({length:range}, (_, i) => new Date(start.getTime() + i * 86400000).toISOString().slice(0,10)).includes(selected)) selected = data.date; render(); }));
  root.querySelectorAll('[data-date]').forEach(b => b.addEventListener('click', () => { selected = b.dataset.date; render(); }));
  renderSelected();
}

function renderSelected() {
  const target = document.getElementById('wxSelectedDetail');
  const d = data.daily.find(day => day.date === selected);
  if (!d) {
    target.innerHTML = `<h3>${dateLabel(selected)} 상세 날씨</h3><p class="wx-detail-message">이 날짜의 상세 예보는 아직 제공되지 않습니다. 1개월 전망은 주별 기온·강수 경향이며, 날짜별 강수확률·풍속·습도 예보가 아닙니다.</p>`;
    return;
  }
  const hours = data.hourly.filter(h => h.date === selected);
  target.innerHTML = `<h3>${dateLabel(selected)} 상세 날씨</h3><p class="wx-detail-note">${escape(d.source)} · 기상청 제공 시간은 기상청 예보를 우선 표시합니다. 체감온도는 Open-Meteo 보조 예보입니다.</p>
    <div class="wx-metrics">${[['최고 / 최저 기온',`${value(d.max,'°C')} / ${value(d.min,'°C')}`],['최대 강수확률',value(d.pop,'%')],['최대 풍속',value(d.wind,' m/s')],['최고 체감온도',value(d.feel,'°C')],['평균 습도',value(d.humidity,'%')]].map(([k,v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
    <div class="wx-detail-table" tabindex="0" role="region" aria-label="시간별 상세 예보, 좌우로 스크롤"><table><caption class="wx-detail-note">시간별 예보 · — 표시는 미제공 · 풍속은 바람의 속도입니다.</caption><thead><tr>${['시간','날씨','기온','체감온도¹','습도','강수확률','시간당 강수량','풍속','풍향','출처'].map(s => `<th scope="col">${s}</th>`).join('')}</tr></thead><tbody>${hours.map(h => `<tr><th scope="row">${h.hour}시</th><td>${escape(label(h.code))}</td><td>${value(h.temp,'°C')}</td><td>${value(h.feel,'°C')}</td><td>${value(h.humidity,'%')}</td><td>${value(h.pop,'%')}</td><td>${typeof h.precipitation === 'number' ? value(h.precipitation,' mm') : escape(h.precipitation ?? '—')}</td><td>${value(h.wind,' m/s')}</td><td>${value(h.direction,'°')}</td><td>${escape(h.source)}</td></tr>`).join('')}</tbody></table></div><p class="wx-detail-note">¹ 체감온도: Open-Meteo 모델 값으로 기상청 예보 기온과 차이가 있을 수 있습니다. 일별 최저·최고 및 최대치는 제공된 시간대 기준입니다.</p>`;
}

let observationRequest = 0;
export async function loadWeatherObservations({ workspace, invoke, preview }) {
  const token = ++observationRequest;
  const root = document.getElementById('wxObservationBody');
  if (!root) return;
  root.innerHTML = '<p class="wx-detail-message" role="status">주변 관측소의 관측자료를 불러오는 중입니다…</p>';
  if (!workspace?.latitude || !workspace?.longitude) {
    root.innerHTML = '<p class="wx-detail-message">현장 주소와 좌표를 설정하면 주변 관측소의 실제 날씨를 볼 수 있습니다.</p>';
    return;
  }
  try {
    const result = preview ? {warnings:['미리보기 예시 · 실제 관측자료가 아닙니다.'], observations:[
      {source:'기상청 AWS', station:{name:'AWS 관측소 예시',distanceKm:1.2},observedAt:new Date().toISOString(),temp:18,humidity:65,wind:2.4,gust:4.2,direction:180,rain60m:0,rainDay:1.5},
      {source:'기상청 ASOS', station:{name:'ASOS 관측소 예시',distanceKm:5.3},observedAt:new Date().toISOString(),temp:18.5,humidity:63,wind:2.8,gust:5.1,direction:190,rain60m:null,rainDay:1.2},
    ]} : (await invoke('site-weather', {action:'observations', latitude:workspace.latitude, longitude:workspace.longitude})).result;
    if (token !== observationRequest) return;
    if (!result || !Array.isArray(result.observations)) throw new Error('관측자료를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    root.innerHTML = (result.warnings || []).map(w => `<p class="wx-detail-note">${escape(w)}</p>`).join('') +
      `<div class="wx-observation-grid">${result.observations.map(o => `<article class="wx-observation-card"><div class="wx-observation-heading"><h3>${escape(o.source)}</h3><span>${o.stale ? '지연된 관측자료' : '관측자료'}</span></div><p class="wx-detail-note">${escape(o.station.name)} · 현장에서 ${value(o.station.distanceKm,' km')}<br>관측 ${escape(new Date(o.observedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))} (한국 시간)</p>${o.stale ? '<p class="wx-observation-stale">최신 자료 수신이 지연되고 있습니다. 아래 수치는 현재 상태와 다를 수 있습니다.</p>' : ''}<dl class="wx-observation-values">${[
        ['기온',value(o.temp,'°C')],['상대습도',value(o.humidity,'%')],['풍속',value(o.wind,' m/s')],
        [o.source.includes('AWS') ? '최대 순간풍속' : '돌풍속',value(o.gust,' m/s')],['풍향',value(o.direction,'°')],
        ['최근 60분 강수량',value(o.rain60m,' mm')],['일 누적 강수량',value(o.rainDay,' mm')],
      ].map(([k,v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl></article>`).join('')}</div>` +
      (result.observations.length ? '<p class="wx-detail-note">— 표시는 미제공 또는 결측값입니다. AWS·ASOS의 관측 주기와 풍속 집계 기준이 달라 수치에 차이가 있을 수 있습니다.</p>' : '<p class="wx-detail-message">현재 표시할 관측자료가 없습니다. 상세 예보는 아래에서 확인할 수 있습니다.</p>');
  } catch (e) {
    if (token !== observationRequest) return;
    root.innerHTML = `<div class="wx-detail-message" role="alert">${escape(e.message)}<br><button type="button" class="btn btn-outline btn-sm" onclick="loadWeatherPage(true)">다시 시도</button></div>`;
  }
}
