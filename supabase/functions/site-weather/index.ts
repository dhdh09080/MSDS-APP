import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
});

const validCoordinate = (value: unknown, min: number, max: number) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
};

async function geocodeWithKakao(address: string, key: string) {
  const url = new URL('https://dapi.kakao.com/v2/local/search/address.json');
  url.searchParams.set('query', address);
  const response = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
  if (!response.ok) throw new Error('Kakao 좌표 검색에 실패했습니다.');
  const data = await response.json();
  const match = data?.documents?.[0];
  if (!match) throw new Error('선택한 주소의 좌표를 찾지 못했습니다.');
  return {
    address: match.road_address?.address_name || match.address?.address_name || address,
    latitude: Number(match.y),
    longitude: Number(match.x),
    geocoder: 'Kakao Local',
  };
}

async function geocodeWithOpenStreetMap(address: string) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'kr');
  url.searchParams.set('accept-language', 'ko');
  url.searchParams.set('q', address);
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'MSDS-APP/1.0 site-location',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
  });
  if (!response.ok) throw new Error('주소 검색 서비스가 응답하지 않습니다. 잠시 후 다시 시도해주세요.');
  const rows = await response.json();
  const match = rows?.[0];
  if (!match) throw new Error('입력한 주소를 찾지 못했습니다. 도로명과 건물번호를 함께 입력해주세요.');
  return {
    address: match.display_name || address,
    latitude: Number(match.lat),
    longitude: Number(match.lon),
    geocoder: 'OpenStreetMap',
  };
}

async function geocode(address: string) {
  const kakaoKey = Deno.env.get('KAKAO_REST_API_KEY');
  if (kakaoKey) {
    try { return await geocodeWithKakao(address, kakaoKey); }
    catch { /* 키·쿼터 오류 시 표준 주소 기반 공개 좌표 검색으로 대체 */ }
  }
  return geocodeWithOpenStreetMap(address);
}

async function forecast(latitude: number, longitude: number) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('hourly', 'apparent_temperature,temperature_2m,relative_humidity_2m');
  url.searchParams.set('timezone', 'Asia/Seoul');
  url.searchParams.set('forecast_days', '2');
  const response = await fetch(url);
  if (!response.ok) throw new Error('현장 날씨를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  const data = await response.json();
  const time: string[] = data?.hourly?.time || [];
  const apparent: number[] = data?.hourly?.apparent_temperature || [];
  const temperature: number[] = data?.hourly?.temperature_2m || [];
  const humidity: number[] = data?.hourly?.relative_humidity_2m || [];
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const targetDate = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
  const hours = time.map((value, index) => ({
    date: value.slice(0, 10),
    hour: Number(value.slice(11, 13)),
    feel: Number(apparent[index]),
    temp: Number(temperature[index]),
    humidity: Number(humidity[index]),
  })).filter(item => item.date === targetDate && item.hour >= 6 && item.hour <= 19 && Number.isFinite(item.feel));
  if (!hours.length) throw new Error('오늘 시간별 체감온도 예보가 아직 없습니다.');
  return { date: targetDate, hours };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST 요청만 지원합니다.' }, 405);
  try {
    const body = await req.json();
    const action = body?.action === 'geocode' ? 'geocode' : 'forecast';
    const address = String(body?.address || '').trim();
    let latitude = validCoordinate(body?.latitude, -90, 90);
    let longitude = validCoordinate(body?.longitude, -180, 180);
    let matchedAddress = address;
    let geocoder = latitude !== null && longitude !== null ? 'saved-coordinate' : '';

    if (latitude === null || longitude === null) {
      if (!address) throw new Error('현장 주소를 입력해주세요.');
      const matched = await geocode(address);
      latitude = matched.latitude;
      longitude = matched.longitude;
      matchedAddress = matched.address;
      geocoder = matched.geocoder;
    }

    if (action === 'geocode') {
      return json({ result: { address: matchedAddress, latitude, longitude, geocoder } });
    }

    const weather = await forecast(latitude, longitude);
    return json({
      result: {
        ...weather,
        address: matchedAddress,
        latitude,
        longitude,
        geocoder,
        source: 'Open-Meteo',
      },
    });
  } catch (error) {
    return json({ error: error?.message || String(error) }, 400);
  }
});
