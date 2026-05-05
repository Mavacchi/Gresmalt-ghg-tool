// supabase/functions/verify_audit_chain/index.ts
//
// Wrapper Edge che invoca la SQL function verify_audit_chain() (definita
// in sql/03_roles.sql). La function SQL ricalcola la hash chain di
// audit_log e ritorna il primo id che si è "rotto", se esiste.
//
// L'enforcement del ruolo è già nella SQL function (admin/auditor only).
//
// CORS: vedi ALLOWED_ORIGINS in sign_snapshot/index.ts.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (ALLOWED_ORIGINS.length > 0) {
    const origin = req.headers.get('Origin') || '';
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Forbidden', { status: 403, headers: corsHeadersFor(req) });
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
  const { data, error } = await sb.rpc('verify_audit_chain');
  if (error) return new Response(JSON.stringify({ error: error.message }),
    { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeadersFor(req) } });

  const broken = (data || []).find((r: any) => r.broken_id);
  return new Response(JSON.stringify({
    integrity: broken ? 'broken' : 'ok',
    first_broken_id: broken?.broken_id ?? null,
    expected_hash: broken?.expected_hash ?? null,
    actual_hash: broken?.actual_hash ?? null,
    verified_at: new Date().toISOString()
  }), { headers: { 'Content-Type': 'application/json', ...corsHeadersFor(req) } });
});
