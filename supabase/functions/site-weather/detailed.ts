import { aggregateDays, kmaBase, kmaGrid, numeric, parseKma } from './lib/forecast.js';

export async function detailedForecast(latitude: number, longitude: number) {
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const warnings: string[] = [];
  const key = Deno.env.get('KMA_SERVICE_KEY');
  const [model, kma] = await Promise.allSettled([
    (async () => {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.search = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude),
        timezone: 'Asia/Seoul', forecast_days: '16', wind_speed_unit: 'ms',
        hourly: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,weather_code' }).toString();
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error('Open-Meteo unavailable');
      const { hourly: h } = await res.json();
      return (h.time as string[]).map((time, i) => ({ time, date: time.slice(0,10), hour: Number(time.slice(11,13)),
        temp: numeric(h.temperature_2m[i]), humidity: numeric(h.relative_humidity_2m[i]), feel: numeric(h.apparent_temperature[i]),
        pop: numeric(h.precipitation_probability[i]), precipitation: numeric(h.precipitation[i]),
        wind: numeric(h.wind_speed_10m[i]), direction: numeric(h.wind_direction_10m[i]), code: numeric(h.weather_code[i]), source: 'Open-Meteo' }));
    })(),
    (async () => {
      if (!key) throw new Error('KMA_NOT_CONFIGURED');
      const url = new URL('https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst');
      let decodedKey = key;
      try { decodedKey = decodeURIComponent(key); } catch { /* raw key */ }
      const grid = kmaGrid(latitude, longitude);
      url.search = new URLSearchParams({ serviceKey: decodedKey, dataType: 'JSON', numOfRows: '1500', pageNo: '1',
        ...kmaBase(), nx: String(grid.nx), ny: String(grid.ny) }).toString();
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error('KMA unavailable');
      const data = await res.json();
      if (data.response?.header?.resultCode !== '00') throw new Error('KMA response error');
      const slots = parseKma(data.response?.body?.items?.item || []);
      if (!slots.length) throw new Error('KMA empty');
      return slots;
    })(),
  ]);
  const merged = new Map<string, any>();
  if (model.status === 'fulfilled') for (const slot of model.value) merged.set(slot.time, slot);
  else warnings.push('보조 예보를 불러오지 못했습니다.');
  if (kma.status === 'fulfilled') for (const slot of kma.value) {
    // KMA has no apparent-temperature field. Keep this model value explicitly separate.
    const supplemental = merged.get(slot.time);
    merged.set(slot.time, { ...slot, feel: supplemental?.feel ?? null, feelSource: supplemental ? 'Open-Meteo' : null });
  }
  else warnings.push(key ? '기상청 연결에 실패하여 보조 예보를 표시합니다.' : '기상청 API 키 미설정 · Open-Meteo 보조 예보를 표시합니다.');
  const hourly = [...merged.values()].filter(s => s.date >= today).sort((a,b) => a.time.localeCompare(b.time));
  if (!hourly.length) throw new Error('상세 예보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  return { date: today, hourly, daily: aggregateDays(hourly), warnings,
    issuedAt: new Date().toISOString(), kmaBase: kma.status === 'fulfilled' ? kmaBase() : null };
}
