import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const BUCKET = 'hazard-location-photos';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers:cors});
  const json = (body:unknown, status=200) => new Response(JSON.stringify(body), {status, headers:{...cors, 'Content-Type':'application/json', 'Cache-Control':'no-store'}});
  if (req.method !== 'POST') return json({error:'Method not allowed'},405);
  try {
    const multipart = req.headers.get('content-type')?.includes('multipart/form-data');
    if (Number(req.headers.get('content-length') || 0) > 21*1024*1024) return json({error:'사진이 너무 큽니다.'},413);
    const form = multipart ? await req.formData() : null;
    const body = form ? Object.fromEntries(form.entries()) : await req.json();
    const {token,contractor_id,map_id,marker_id} = body;
    if (typeof token !== 'string' || token.length < 16 || token.length > 256 || !uuid.test(contractor_id) || !uuid.test(map_id) || !uuid.test(marker_id)) return json({error:'Invalid request'},400);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth:{persistSession:false, autoRefreshToken:false}});
    const {data:context,error} = await db.rpc('get_contractor_hazard_maps',{p_token:token,p_contractor_id:contractor_id,p_map_id:map_id});
    if (error || !context?.markers?.some((m:{id:string,contractor_id:string}) => m.id===marker_id && m.contractor_id===contractor_id)) return json({error:'유효한 담당 업체 링크가 필요합니다.'},403);
    if (form) {
      const file = form.get('photo'), kind = form.get('kind'), note = form.get('note') || '';
      if (!(file instanceof File) || file.type !== 'image/jpeg' || file.size === 0 || file.size > 20*1024*1024 || !['finding','remedy'].includes(String(kind)) || typeof note !== 'string' || note.length>2000) return json({error:'올바른 JPG 사진과 설명을 입력해 주세요.'},400);
      const magic = new Uint8Array(await file.slice(0,3).arrayBuffer());
      if (magic[0]!==0xff || magic[1]!==0xd8 || magic[2]!==0xff) return json({error:'JPG 형식이 아닙니다.'},400);
      const path = `${context.maps.find((m:{id:string}) => m.id===map_id).workspace_id}/${marker_id}/${crypto.randomUUID()}.jpg`;
      const uploaded = await db.storage.from(BUCKET).upload(path,file,{contentType:'image/jpeg',upsert:false});
      if (uploaded.error) return json({error:'사진 업로드에 실패했습니다. 다시 시도해 주세요.'},500);
      const saved = await db.rpc('add_contractor_location_photo',{p_token:token,p_contractor_id:contractor_id,p_map_id:map_id,p_marker_id:marker_id,p_path:path,p_kind:kind,p_note:note});
      if (saved.error) {
        await db.storage.from(BUCKET).remove([path]);
        return json({error:'사진 저장에 실패했습니다. 담당 업체와 링크 유효기간을 확인해 주세요.'},403);
      }
      return json({photo:saved.data});
    }
    const photos = await db.from('hazard_location_photos').select('*').eq('marker_id',marker_id).order('created_at');
    if (photos.error) return json({error:'사진을 불러오지 못했습니다.'},500);
    const rows = await Promise.all(photos.data.map(async row => {
      const signed = await db.storage.from(BUCKET).createSignedUrl(row.storage_path,900);
      if (signed.error) throw signed.error;
      return {...row,signed_url:signed.data.signedUrl};
    }));
    return json({photos:rows});
  } catch { return json({error:'요청을 처리하지 못했습니다. 다시 시도해 주세요.'},400); }
});
