// KMA village-forecast grid (Lambert conformal conic, 5 km).
export function kmaGrid(latitude, longitude) {
  const rad = Math.PI / 180;
  const sn = Math.log(Math.cos(30 * rad) / Math.cos(60 * rad)) /
    Math.log(Math.tan(Math.PI / 4 + 60 * rad / 2) / Math.tan(Math.PI / 4 + 30 * rad / 2));
  const sf = Math.tan(Math.PI / 4 + 30 * rad / 2) ** sn * Math.cos(30 * rad) / sn;
  const ro = 6371.00877 / 5 * sf / Math.tan(Math.PI / 4 + 38 * rad / 2) ** sn;
  const ra = 6371.00877 / 5 * sf / Math.tan(Math.PI / 4 + latitude * rad / 2) ** sn;
  const theta = ((longitude - 126 + 540) % 360 - 180) * rad * sn;
  return { nx: Math.floor(ra * Math.sin(theta) + 43.5), ny: Math.floor(ro - ra * Math.cos(theta) + 136.5) };
}

// Allow 20 minutes for the published run to become available.
export function kmaBase(now = Date.now()) {
  const date = new Date(now + 9 * 3600000 - 20 * 60000);
  const hour = date.getUTCHours();
  let baseHour = [23, 20, 17, 14, 11, 8, 5, 2].find(h => h <= hour);
  if (baseHour === undefined) { date.setUTCDate(date.getUTCDate() - 1); baseHour = 23; }
  return { base_date: date.toISOString().slice(0, 10).replaceAll('-', ''), base_time: String(baseHour).padStart(2, '0') + '00' };
}

export const numeric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

export function parseKma(items) {
  const slots = new Map();
  for (const item of items) {
    if (!/^\d{8}$/.test(item.fcstDate) || !/^\d{4}$/.test(item.fcstTime)) continue;
    const date = item.fcstDate.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    const time = `${date}T${item.fcstTime.slice(0, 2)}:${item.fcstTime.slice(2)}`;
    if (!slots.has(time)) slots.set(time, { time, date, hour: Number(item.fcstTime.slice(0, 2)) });
    slots.get(time)[item.category] = item.fcstValue;
  }
  return [...slots.values()].map(s => ({
    time: s.time, date: s.date, hour: s.hour, temp: numeric(s.TMP), humidity: numeric(s.REH),
    pop: numeric(s.POP), wind: numeric(s.WSD), direction: numeric(s.VEC),
    precipitation: s.PCP ?? null, feel: null,
    code: Number(s.PTY) === 1 ? 61 : Number(s.PTY) === 2 ? 71 : Number(s.PTY) === 3 ? 71 : Number(s.PTY) === 4 ? 80 : Number(s.SKY) === 1 ? 0 : Number(s.SKY) === 3 ? 2 : Number(s.SKY) === 4 ? 3 : null,
    source: '기상청 단기예보',
  })).filter(s => s.temp !== null).sort((a, b) => a.time.localeCompare(b.time));
}

export function aggregateDays(slots) {
  return [...new Set(slots.map(s => s.date))].sort().map(date => {
    const hours = slots.filter(s => s.date === date);
    const values = key => hours.map(s => s[key]).filter(v => typeof v === 'number' && Number.isFinite(v));
    const max = key => values(key).length ? Math.max(...values(key)) : null;
    const min = key => values(key).length ? Math.min(...values(key)) : null;
    return { date, min: min('temp'), max: max('temp'), pop: max('pop'), wind: max('wind'),
      feel: max('feel'), humidity: values('humidity').length ? Math.round(values('humidity').reduce((a,b) => a+b, 0) / values('humidity').length) : null,
      code: hours.reduce((a,b) => (b.pop ?? 0) > (a.pop ?? 0) ? b : a).code,
      source: [...new Set(hours.map(s => s.source))].join(' / ') };
  });
}
