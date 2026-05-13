// supabase/functions/verify_snapshot/index.ts
//
// Verifica la firma HMAC-SHA256 di uno snapshot inventario.
// Accessibile a tutti gli utenti autenticati (admin/editor/auditor/viewer).
// Body atteso: { payload: object, signature: string, data_sha256: string }
//
// CORS: vedi ALLOWED_ORIGINS in sign_snapshot/index.ts.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';
import { makeHttpHelpers } from '../_shared/http.ts';

const HMAC_KEY = Deno.env.get('SNAPSHOT_HMAC_KEY');

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const { corsHeadersFor, jsonResponse, errResponse } = makeHttpHelpers(ALLOWED_ORIGINS);

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
  if (req.method !== 'POST') return errResponse(req, 'Method not allowed', 405);
  if (!HMAC_KEY) return errResponse(req, 'Server not configured · SNAPSHOT_HMAC_KEY missing', 500);

  if (ALLOWED_ORIGINS.length > 0) {
    const origin = req.headers.get('Origin') || '';
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return errResponse(req, 'Forbidden · origin not allowed', 403);
    }
  }

  const auth = req.headers.get('Authorization');
  if (!auth) return errResponse(req, 'Unauthorized · missing Bearer token', 401);

  // Backward-compat: vedi sign_snapshot/index.ts per la motivazione.
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    (Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY'))!,
    { global: { headers: { Authorization: auth } } }
  );
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return errResponse(req, 'Unauthorized · invalid session', 401);

  const ctLen = parseInt(req.headers.get('Content-Length') || '0', 10);
  if (ctLen > 1_048_576) return errResponse(req, 'Payload too large (>1 MB)', 413);

  let body: { payload?: unknown; signature?: string; data_sha256?: string };
  try {
    body = await req.json();
  } catch (_) {
    return errResponse(req, 'Bad request · payload must be valid JSON', 400);
  }
  const { payload, signature, data_sha256 } = body || {};
  if (typeof signature !== 'string' || typeof data_sha256 !== 'string') {
    return errResponse(req, 'Bad request · signature and data_sha256 required', 400);
  }
  const serialized = JSON.stringify(payload);
  const computedSha = await sha256(serialized);
  const computedSig = await hmacSha256(HMAC_KEY, serialized + '|' + computedSha);

  const sha_ok = constantTimeEq(computedSha, data_sha256);
  const sig_ok = constantTimeEq(computedSig, signature);
  const valid = sha_ok && sig_ok;

  return jsonResponse(req, {
    valid,
    sha_match: sha_ok,
    signature_match: sig_ok,
    verified_at: new Date().toISOString(),
    verifier_email: u.user.email
  }, valid ? 200 : 422);
});
