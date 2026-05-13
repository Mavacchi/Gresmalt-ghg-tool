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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';
import { makeHttpHelpers } from '../_shared/http.ts';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const { corsHeadersFor, jsonResponse, errResponse } = makeHttpHelpers(ALLOWED_ORIGINS);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
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
  const { data, error } = await sb.rpc('verify_audit_chain');
  if (error) return errResponse(req, error.message, 403);

  const broken = (data || []).find((r: any) => r.broken_id);
  return jsonResponse(req, {
    integrity: broken ? 'broken' : 'ok',
    first_broken_id: broken?.broken_id ?? null,
    expected_hash: broken?.expected_hash ?? null,
    actual_hash: broken?.actual_hash ?? null,
    verified_at: new Date().toISOString()
  });
});
