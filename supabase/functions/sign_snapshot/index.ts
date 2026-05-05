// supabase/functions/sign_snapshot/index.ts
//
// Firma HMAC-SHA256 di un payload JSON di snapshot inventario.
// La chiave HMAC vive in env (SNAPSHOT_HMAC_KEY) e non viene mai esposta al client.
// Solo gli utenti con ruolo `admin` possono firmare.
//
// Deploy:
//   supabase functions deploy sign_snapshot --no-verify-jwt
//   supabase secrets set SNAPSHOT_HMAC_KEY=<random-32-bytes-hex>
//   supabase secrets set ALLOWED_ORIGINS=https://sustainability.gresmalt.it
//
// CORS: ALLOWED_ORIGINS è una lista CSV di origin esatti consentiti
//       (es. "https://sustainability.gresmalt.it,https://gresmalt.github.io").
//       Se la variabile è vuota, fallback a "*" con warning in log
//       (utile in dev; PRODUZIONE deve sempre impostarla).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const HMAC_KEY = Deno.env.get('SNAPSHOT_HMAC_KEY');
if (!HMAC_KEY) console.warn('[sign_snapshot] SNAPSHOT_HMAC_KEY not set');

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',').map(s => s.trim()).filter(Boolean);
if (ALLOWED_ORIGINS.length === 0) {
  console.warn('[sign_snapshot] ALLOWED_ORIGINS not set — falling back to "*" (dev only)');
}

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

function jsonResponse(req: Request, body: unknown, status = 200, extra: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeadersFor(req), ...extra }
  });
}
function errResponse(req: Request, message: string, status: number) {
  return jsonResponse(req, { ok: false, error: message }, status);
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

serve(async (req) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST') {
    return errResponse(req, 'Method not allowed', 405);
  }
  if (!HMAC_KEY) {
    return errResponse(req, 'Server not configured · SNAPSHOT_HMAC_KEY missing', 500);
  }

  // Origin allowlist (rifiuto duro se non in lista, eccetto dev fallback)
  if (ALLOWED_ORIGINS.length > 0) {
    const origin = req.headers.get('Origin') || '';
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return errResponse(req, 'Forbidden · origin not allowed', 403);
    }
  }

  const auth = req.headers.get('Authorization');
  if (!auth) return errResponse(req, 'Unauthorized · missing Bearer token', 401);

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } }
  );
  const { data: u, error: authErr } = await sb.auth.getUser();
  if (authErr || !u?.user) return errResponse(req, 'Unauthorized · invalid session', 401);
  const role = (u.user.app_metadata as Record<string, unknown>)?.role;
  if (role !== 'admin') return errResponse(req, 'Forbidden · admin role required', 403);

  // Body size guard (1 MB) — evita DoS firma di payload enormi
  const ctLen = parseInt(req.headers.get('Content-Length') || '0', 10);
  if (ctLen > 1_048_576) return errResponse(req, 'Payload too large (>1 MB)', 413);

  let body: unknown;
  try {
    body = await req.json();
  } catch (_) {
    return errResponse(req, 'Bad request · payload must be valid JSON', 400);
  }
  const payload = JSON.stringify(body);
  const data_sha256 = await sha256(payload);
  const signature = await hmacSha256(HMAC_KEY, payload + '|' + data_sha256);

  return jsonResponse(req, {
    ok: true, signature, data_sha256,
    signed_at: new Date().toISOString(),
    signer_email: u.user.email,
    algorithm: 'HMAC-SHA256'
  });
});
