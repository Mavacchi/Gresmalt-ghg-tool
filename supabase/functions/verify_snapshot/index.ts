// supabase/functions/verify_snapshot/index.ts
//
// Verifica la firma HMAC-SHA256 di uno snapshot inventario.
// Accessibile a tutti gli utenti autenticati (admin/editor/auditor/viewer).
// Body atteso: { payload: object, signature: string, data_sha256: string }
//
// CORS: vedi ALLOWED_ORIGINS in sign_snapshot/index.ts.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const HMAC_KEY = Deno.env.get('SNAPSHOT_HMAC_KEY');

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function corsHeadersFor(req: Request): Record<string,string> {
  const origin = req.headers.get('Origin') || '';
  const allow = ALLOWED_ORIGINS.length === 0
    ? '*'
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST')
    return new Response('Method not allowed', { status: 405, headers: corsHeadersFor(req) });
  if (!HMAC_KEY)
    return new Response('Server not configured', { status: 500, headers: corsHeadersFor(req) });

  if (ALLOWED_ORIGINS.length > 0) {
    const origin = req.headers.get('Origin') || '';
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Forbidden · origin not allowed', { status: 403, headers: corsHeadersFor(req) });
    }
  }

  const auth = req.headers.get('Authorization');
  if (!auth) return new Response('Unauthorized', { status: 401, headers: corsHeadersFor(req) });

  // Backward-compat: vedi sign_snapshot/index.ts per la motivazione.
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    (Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY'))!,
    { global: { headers: { Authorization: auth } } }
  );
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return new Response('Unauthorized', { status: 401, headers: corsHeadersFor(req) });

  const ctLen = parseInt(req.headers.get('Content-Length') || '0', 10);
  if (ctLen > 1_048_576)
    return new Response('Payload too large', { status: 413, headers: corsHeadersFor(req) });

  let body: { payload?: unknown; signature?: string; data_sha256?: string };
  try {
    body = await req.json();
  } catch (_) {
    return new Response('Bad request', { status: 400, headers: corsHeadersFor(req) });
  }
  const { payload, signature, data_sha256 } = body || {};
  if (typeof signature !== 'string' || typeof data_sha256 !== 'string') {
    return new Response('Bad request', { status: 400, headers: corsHeadersFor(req) });
  }
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
    headers: { 'Content-Type': 'application/json', ...corsHeadersFor(req) }
  });
});
