import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const { token, contractor_id, map_id } = await req.json();
    if (typeof token !== 'string' || token.length < 16 || token.length > 256 || typeof contractor_id !== 'string' || typeof map_id !== 'string') return json({ error: 'Invalid request' }, 400);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    // This RPC checks token expiry, contractor scope and MSDS permissions before any storage access.
    const { data: context, error } = await db.rpc('get_contractor_hazard_maps', { p_token: token, p_contractor_id: contractor_id, p_map_id: map_id });
    if (error) return json({ error: 'Invalid or expired contractor link' }, 403);
    const map = context?.maps?.find((map: { id: string }) => map.id === map_id);
    if (!map) return json({ error: 'Map not found' }, 404);
    const { data: signed, error: signError } = await db.storage.from('hazard-map-photos').createSignedUrl(map.storage_path, 900);
    if (signError) return json({ error: 'Photo is unavailable' }, 404);
    return json({ signed_url: signed.signedUrl });
  } catch { return json({ error: 'Invalid request' }, 400); }
});
