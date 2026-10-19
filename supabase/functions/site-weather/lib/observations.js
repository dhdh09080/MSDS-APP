// API Hub returns comment-prefixed text tables, not JSON.
export function tableRows(text) {
  return text.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^\d/.test(line)).map(line => line.split(/[\s,]+/));
}

export function parseStations(text) {
  return tableRows(text).filter(row => /^\d+$/.test(row[0])).map(row => ({
    id: Number(row[0]), longitude: Number(row[1]), latitude: Number(row[2]),
  })).filter(s => Number.isFinite(s.id) && s.longitude >= 124 && s.longitude <= 132 && s.latitude >= 32 && s.latitude <= 40);
}

export function distanceKm(latitude, longitude, station) {
  const rad = Math.PI / 180;
  const a = Math.sin((station.latitude - latitude) * rad / 2) ** 2 +
    Math.cos(latitude * rad) * Math.cos(station.latitude * rad) * Math.sin((station.longitude - longitude) * rad / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function number(value, min = 0, max = Infinity) {
  if (value === undefined || value === '') return null;
  const v = Number(value);
  return Number.isFinite(v) && v >= min && v <= max ? v : null;
}

export function parseObservation(text, kind, stationId, now = Date.now()) {
  const row = tableRows(text).filter(r => /^\d{12}$/.test(r[0]) && Number(r[1]) === stationId)
    .sort((a,b) => b[0].localeCompare(a[0]))[0];
  if (!row || row.length < (kind === 'AWS' ? 18 : 19)) return null;
  const tm = row[0];
  const observedAt = `${tm.slice(0,4)}-${tm.slice(4,6)}-${tm.slice(6,8)}T${tm.slice(8,10)}:${tm.slice(10,12)}:00+09:00`;
  const ageMinutes = Math.round((now - Date.parse(observedAt)) / 60000);
  if (!Number.isFinite(ageMinutes) || ageMinutes < -10) return null;
  const asosDirection = number(row[2], 1, 36);
  const observation = kind === 'AWS' ? {
    temp: number(row[8], -50, 60), humidity: number(row[14], 0, 100),
    wind: number(row[3]), gust: number(row[5]), direction: number(row[2], 0, 359.9),
    rainDetected: number(row[9], 0, 1), rain60m: number(row[11]), rainDay: number(row[13]),
  } : {
    temp: number(row[11], -50, 60), humidity: number(row[13], 0, 100),
    wind: number(row[3]), gust: number(row[5]), direction: asosDirection === null ? null : asosDirection * 10,
    rainDetected: null, rain60m: null, rainDay: number(row[16]),
  };
  if (observation.temp === null && observation.humidity === null && observation.wind === null) return null;
  return { ...observation, stationId, source: `기상청 ${kind}`, observedAt, ageMinutes,
    stale: ageMinutes > (kind === 'AWS' ? 20 : 120) };
}
