// supabase/functions/search_fe/index.ts
//
// Ricerca FE (fattori di emissione) online via Gemini 2.5 Flash con
// Google Search Grounding. Riceve una query naturale (es. "FE
// trasporto furgone diesel 7t 2025"), ritorna fino a 5 candidati
// con valore, unità, anno, URL fonte, citazione testuale.
//
// L'LLM è vincolato dal prompt a NON inventare valori e a citare
// SEMPRE l'URL della fonte. Lato Edge filtriamo i candidati con
// source_url su una whitelist di domini autorevoli per uso GHG/CSRD.
//
// Deploy:
//   supabase functions deploy search_fe       --no-verify-jwt
//   supabase secrets set GEMINI_API_KEY=AIza...
//   (ALLOWED_ORIGINS già configurato per le altre 3 functions)
//
// CORS: stesso pattern di sign_snapshot/index.ts.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Whitelist domini sorgente. Lista chiusa per evitare che la LLM
// citi fonti non autorevoli per CSRD. Tutto fuori da qui viene
// filtrato lato server prima di rispondere al client.
const TRUSTED_DOMAINS = [
  // Italia
  'ispra.it', 'ispra.gov.it',
  'snpambiente.it', 'isprambiente.gov.it',
  'gse.it',
  'terna.it',
  'minambiente.it', 'mite.gov.it', 'mase.gov.it',
  // UK
  'gov.uk', 'defra.gov.uk',
  // USA
  'epa.gov',
  // EU / supranazionali
  'eea.europa.eu', 'europa.eu', 'ec.europa.eu',
  'aib-net.org',
  'ipcc.ch', 'ipcc-nggip.iges.or.jp',
  'unfccc.int',
  // Standard / metodologia
  'ghgprotocol.org',
  'sciencebasedtargets.org',
  'carbontrust.com'
  // Esclusi esplicitamente:
  //   ecoinvent.org → dataset licensed, non ridistribuibile
  //   wikipedia.org → non fonte primaria
  //   carbonfootprint.com, climateneutralgroup.com, ecc → aggregatori commerciali
];

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

function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeadersFor(req) }
  });
}
function errResponse(req: Request, message: string, status: number) {
  return jsonResponse(req, { ok: false, error: message }, status);
}

// Estrae l'host dall'URL e controlla se è in whitelist (match anche
// su sottodomini, es. www.defra.gov.uk → defra.gov.uk).
function isTrustedDomain(urlStr: string): boolean {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return TRUSTED_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch (_) { return false; }
}

interface FECandidate {
  fe_id_suggested: string;        // es. 'FE_HGV_Diesel_2024'
  famiglia: string;               // es. 'Trasporti'
  codice_voce: string;            // es. 'HGV_Diesel_7t'
  descrizione: string;
  anno_validita: number;
  valore: number;
  unita: string;                  // es. 'kgCO2e/tkm'
  gas: string;                    // es. 'CO2e'
  fonte: string;                  // nome leggibile della fonte
  source_url: string;             // URL completo della pagina sorgente
  source_quote: string;           // breve citazione testuale (max 200 char)
  confidence: 'low' | 'medium' | 'high';
}

serve(async (req) => {
  // Wrapper try-catch globale: se qualcosa esplode prima del nostro
  // return controllato, evitiamo il crash silenzioso ("EarlyDrop"
  // generic) e ritorniamo 500 con messaggio leggibile + log.
  try {
    return await handle(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error('[search_fe] FATAL:', msg, stack);
    return errResponse(req, 'Internal error: ' + msg, 500);
  }
});

async function handle (req: Request): Promise<Response> {
  console.log('[search_fe] request', req.method, req.headers.get('Origin') || '(no origin)');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST') return errResponse(req, 'Method not allowed', 405);
  if (!GEMINI_API_KEY) {
    console.error('[search_fe] GEMINI_API_KEY missing');
    return errResponse(req, 'Server not configured · GEMINI_API_KEY missing', 500);
  }

  // Origin allowlist
  if (ALLOWED_ORIGINS.length > 0) {
    const origin = req.headers.get('Origin') || '';
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      console.warn('[search_fe] origin not allowed:', origin, '· allowed:', ALLOWED_ORIGINS);
      return errResponse(req, 'Forbidden · origin not allowed (' + origin + ')', 403);
    }
  }

  // Auth: l'utente deve essere autenticato + admin/editor
  const auth = req.headers.get('Authorization');
  if (!auth) return errResponse(req, 'Unauthorized · missing Bearer token', 401);

  // Verifica env vars Supabase (di solito auto-iniettate, ma controlla)
  const sbUrl = Deno.env.get('SUPABASE_URL');
  const sbKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
             || Deno.env.get('SUPABASE_ANON_KEY');
  if (!sbUrl || !sbKey) {
    console.error('[search_fe] SUPABASE_URL or KEY missing in env');
    return errResponse(req, 'Server not configured · SUPABASE_URL or KEY missing', 500);
  }

  const sb = createClient(sbUrl, sbKey,
    { global: { headers: { Authorization: auth } } });
  );
  const { data: u, error: authErr } = await sb.auth.getUser();
  if (authErr || !u?.user) {
    console.warn('[search_fe] auth.getUser failed:', authErr?.message);
    return errResponse(req, 'Unauthorized · invalid session', 401);
  }
  const role = (u.user.app_metadata as Record<string, unknown>)?.role;
  console.log('[search_fe] user:', u.user.email, 'role:', role);
  if (role !== 'admin' && role !== 'editor') {
    return errResponse(req, 'Forbidden · admin/editor role required (current: ' + role + ')', 403);
  }

  // Body size guard 8 KB (query naturale, non serve di più)
  const ctLen = parseInt(req.headers.get('Content-Length') || '0', 10);
  if (ctLen > 8192) return errResponse(req, 'Payload too large (>8 KB)', 413);

  let body: { query?: string; year?: number };
  try {
    body = await req.json();
  } catch (_) {
    return errResponse(req, 'Bad request · payload must be valid JSON', 400);
  }
  const query = (body.query || '').trim();
  const year = Number(body.year) || new Date().getFullYear();
  if (!query || query.length < 5) {
    return errResponse(req, 'Bad request · query troppo corta (min 5 char)', 400);
  }
  if (query.length > 500) {
    return errResponse(req, 'Bad request · query troppo lunga (max 500 char)', 400);
  }

  const t0 = Date.now();
  let response: unknown = null;
  let candidates: FECandidate[] = [];
  let errorMessage: string | null = null;
  const sourcesUsed = new Set<string>();

  try {
    // Prompt rigoroso per Gemini. Forza output JSON tra ```json fence
    // (più robusto di responseMimeType in combinazione con tools).
    const prompt = [
      'Sei un assistente specializzato in fattori di emissione (FE) per inventari GHG conformi al GHG Protocol Corporate Standard e alla rendicontazione CSRD.',
      '',
      'Cerca su Google fattori di emissione per la query seguente, dalle FONTI ISTITUZIONALI in italiano e inglese: ISPRA, GSE, Terna, MITE, Ministero Ambiente IT, DEFRA, gov.uk, EPA, IPCC, AIB, EEA, GHG Protocol, IEA, UNFCCC.',
      '',
      'REGOLE NON NEGOZIABILI:',
      '1. Riporta SOLO valori che hai trovato testualmente nelle pagine web. NON inventare, non interpolare, non stimare.',
      '2. Per ogni FE devi citare: valore, unità, anno di validità, URL esatto della pagina sorgente, breve citazione testuale (max 200 caratteri).',
      '3. Se le fonti non contengono il FE richiesto o non sei certo del valore, ritorna lista vuota.',
      '4. Preferisci FE per l\'anno ' + year + ' o l\'anno più recente disponibile.',
      '5. NON usare fonti commerciali aggregate (carbonfootprint.com, climateneutralgroup, ecc.), Wikipedia, o ecoinvent (licenza).',
      '6. Massimo 5 candidati. Ordinali per affidabilità (high > medium > low).',
      '',
      'QUERY UTENTE: "' + query + '"',
      '',
      'Rispondi ESCLUSIVAMENTE con un blocco JSON tra ```json e ```, conforme a questo schema:',
      '```json',
      '{',
      '  "candidates": [',
      '    {',
      '      "fe_id_suggested": "FE_xxx_yyyy",',
      '      "famiglia": "Combustibili|Elettricità|WTT|Materiali|Trasporti|Rifiuti|...",',
      '      "codice_voce": "stringa breve che identifica la voce",',
      '      "descrizione": "descrizione completa del FE",',
      '      "anno_validita": ' + year + ',',
      '      "valore": 0.0,',
      '      "unita": "kgCO2e/unità",',
      '      "gas": "CO2e",',
      '      "fonte": "ISPRA 2024 / DEFRA 2023 / ecc",',
      '      "source_url": "https://...",',
      '      "source_quote": "estratto della pagina max 200 char",',
      '      "confidence": "high|medium|low"',
      '    }',
      '  ]',
      '}',
      '```',
      '',
      'Se non trovi nulla di affidabile, ritorna { "candidates": [] }.'
    ].join('\n');

    // Gemini API con Google Search Grounding tool.
    // Modello: gemini-2.5-flash → veloce, free tier generoso.
    const geminiUrl =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key='
      + GEMINI_API_KEY;
    const geminiReq = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0.0,           // determinismo massimo
        topP: 0.1,
        maxOutputTokens: 4000
      }
    };
    console.log('[search_fe] calling Gemini, query:', query.slice(0, 100));
    const r = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiReq)
    });
    console.log('[search_fe] Gemini status:', r.status);
    if (!r.ok) {
      const t = await r.text();
      console.error('[search_fe] Gemini error body:', t.slice(0, 500));
      throw new Error(`Gemini API ${r.status}: ${t.slice(0, 300)}`);
    }
    response = await r.json();

    // Estrai testo + grounding metadata
    const respObj = response as Record<string, unknown>;
    const cs = (respObj.candidates as Array<Record<string, unknown>>) || [];
    if (cs.length === 0) throw new Error('Gemini ha risposto senza candidates');

    const first = cs[0];
    const content = first.content as Record<string, unknown>;
    const parts = (content?.parts as Array<Record<string, unknown>>) || [];
    const text = parts.map(p => p.text || '').join('');

    // Raccoglie URL effettivamente usate da Google Search
    const groundingMeta = first.groundingMetadata as Record<string, unknown> || {};
    const chunks = (groundingMeta.groundingChunks as Array<Record<string, unknown>>) || [];
    for (const ch of chunks) {
      const web = ch.web as Record<string, string> | undefined;
      if (web?.uri) {
        try { sourcesUsed.add(new URL(web.uri).hostname); }
        catch (_) { /* skip URL malformata */ }
      }
    }

    // Parse il blocco JSON dal testo. Cerco ```json ... ``` fence prima,
    // poi fallback a primo { ... } che riesco a parsare.
    let parsed: { candidates?: FECandidate[] } | null = null;
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonCandidate = fenceMatch ? fenceMatch[1] : text;
    try {
      parsed = JSON.parse(jsonCandidate);
    } catch (_) {
      // Fallback: cerca il primo { e l'ultimo } bilanciato
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try { parsed = JSON.parse(text.slice(start, end + 1)); }
        catch (_) { parsed = null; }
      }
    }

    if (!parsed || !Array.isArray(parsed.candidates)) {
      throw new Error('Risposta LLM non parsabile come JSON valido');
    }

    // Filtra candidati su whitelist + valida campi minimi
    candidates = parsed.candidates.filter((c) => {
      if (!c || typeof c !== 'object') return false;
      if (typeof c.valore !== 'number' || !isFinite(c.valore) || c.valore < 0) return false;
      if (!c.unita || !c.source_url) return false;
      if (!isTrustedDomain(c.source_url)) return false;
      return true;
    }).slice(0, 5);

  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
    response = response || { error: errorMessage };
  }

  const durationMs = Date.now() - t0;

  // Logga sempre la chiamata (anche errori) per audit trail.
  // Cattura il log id per restituirlo al frontend: serve per legare
  // la successiva eventuale INSERT in public.fe a questo log via
  // mark_fe_search_selected.
  let logId: number | null = null;
  try {
    const { data: logData } = await sb.rpc('log_fe_search', {
      p_query:        query,
      p_sources_used: Array.from(sourcesUsed),
      p_response:     { raw: response, parsed_candidates: candidates },
      p_duration_ms:  durationMs,
      p_error:        errorMessage
    });
    if (typeof logData === 'number') logId = logData;
  } catch (_) {
    // Log fallito: prosegui comunque, la search è andata
  }

  if (errorMessage) {
    return errResponse(req, errorMessage, 502);
  }

  return jsonResponse(req, {
    ok: true,
    log_id: logId,
    candidates,
    sources_used: Array.from(sourcesUsed),
    duration_ms: durationMs,
    notice: candidates.length === 0
      ? 'Nessun FE trovato da fonti istituzionali. Prova a riformulare la query (più specifica) o cerca manualmente.'
      : null
  });
}
