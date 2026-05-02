// supabase/functions/verify_snapshot/index.ts
//
// Verifica la firma HMAC-SHA256 di uno snapshot inventario.
// Accessibile a tutti gli utenti autenticati (admin/editor/auditor/viewer).
// Body atteso: { payload: object, signature: string, data_sha256: string }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const HMAC_KEY = Deno.env.get('SNAPSHOT_HMAC_KEY');

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

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
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

  const { payload, signature, data_sha256 } = await req.json();
  const serialized = JSON.stringify(payload);
  const computedSha = await sha256(serialized);
  const computedSig = await hmacSha256(HMAC_KEY, serialized + '|' + computedSha);

  const sha_ok = constantTimeEq(computedSha, data_sha256);
  const sig_ok = constantTimeEq(computedSig, signature);
  const valid = sha_ok && sig_ok;

  return new Response(JSON.stringify({
    valid,
    sha_match: sha_ok,
    signature_match: sig_ok,
    verified_at: new Date().toISOString(),
    verifier_email: u.user.email
  }), {
    status: valid ? 200 : 422,
    headers: { 'Content-Type': 'application/json' }
  });
});
