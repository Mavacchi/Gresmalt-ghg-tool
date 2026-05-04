// supabase/functions/verify_audit_chain/index.ts
//
// Wrapper Edge che invoca la SQL function verify_audit_chain() (definita
// in sql/03_roles.sql). La function SQL ricalcola la hash chain di
// audit_log e ritorna il primo id che si è "rotto", se esiste.
//
// L'enforcement del ruolo è già nella SQL function (admin/auditor only).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (!auth) return new Response('Unauthorized', { status: 401 });

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } }
  );
  const { data, error } = await sb.rpc('verify_audit_chain');
  if (error) return new Response(JSON.stringify({ error: error.message }),
    { status: 403, headers: { 'Content-Type': 'application/json' } });

  const broken = (data || []).find((r: any) => r.broken_id);
  return new Response(JSON.stringify({
    integrity: broken ? 'broken' : 'ok',
    first_broken_id: broken?.broken_id ?? null,
    expected_hash: broken?.expected_hash ?? null,
    actual_hash: broken?.actual_hash ?? null,
    verified_at: new Date().toISOString()
  }), { headers: { 'Content-Type': 'application/json' } });
});
