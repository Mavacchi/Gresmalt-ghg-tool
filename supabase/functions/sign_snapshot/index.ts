// supabase/functions/sign_snapshot/index.ts
//
// Firma HMAC-SHA256 di un payload JSON di snapshot inventario.
// La chiave HMAC vive in env (SNAPSHOT_HMAC_KEY) e non viene mai esposta al client.
// Solo gli utenti con ruolo `admin` possono firmare.
//
// Deploy:
//   supabase functions deploy sign_snapshot --no-verify-jwt=false
//   supabase secrets set SNAPSHOT_HMAC_KEY=<random-32-bytes-hex>

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const HMAC_KEY = Deno.env.get('SNAPSHOT_HMAC_KEY');
if (!HMAC_KEY) console.warn('[sign_snapshot] SNAPSHOT_HMAC_KEY not set');

async function hmacSha256(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!HMAC_KEY) return new Response('Server not configured', { status: 500 });

  const auth = req.headers.get('Authorization');
  if (!auth) return new Response('Unauthorized', { status: 401 });

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } }
  );
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return new Response('Unauthorized', { status: 401 });
  const role = (u.user.app_metadata as any)?.role;
  if (role !== 'admin') return new Response('Forbidden — admin only', { status: 403 });

  const body = await req.json();
  const payload = JSON.stringify(body);
  const data_sha256 = await sha256(payload);
  const signature = await hmacSha256(HMAC_KEY, payload + '|' + data_sha256);

  return new Response(JSON.stringify({
    ok: true, signature, data_sha256,
    signed_at: new Date().toISOString(),
    signer_email: u.user.email,
    algorithm: 'HMAC-SHA256'
  }), { headers: { 'Content-Type': 'application/json' } });
});
