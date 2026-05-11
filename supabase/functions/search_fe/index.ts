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
    // Prompt sintetico per lasciare più budget di output token alla
    // risposta vera. Mantengo le regole core (no invenzione, citazione
    // URL + quote, whitelist fonti) e abbrevio il resto.
    const prompt =
`Trova fattori di emissione (FE) per query GHG/CSRD, anno ${year}.

Fonti AMMESSE: ISPRA, GSE, Terna, MITE, MASE, DEFRA, gov.uk, EPA, EEA, IPCC, AIB, GHG Protocol, UNFCCC.
Vietati: carbonfootprint.com, Wikipedia, ecoinvent (licenza), aggregatori commerciali.

Regole:
- Solo valori letti testualmente nelle pagine (no invenzione/interpolazione)
- Ogni FE: URL esatto + citazione breve (max 150 char)
- Max 3 candidati. Lista vuota se niente di affidabile.

Query: "${query}"

Output: ESCLUSIVAMENTE un blocco JSON tra \`\`\`json e \`\`\` con questo schema:
{"candidates":[{"fe_id_suggested":"FE_xxx_${year}","famiglia":"Combustibili|Elettricità|WTT|Materiali|Trasporti|Rifiuti","codice_voce":"slug","descrizione":"breve","anno_validita":${year},"valore":0.0,"unita":"kgCO2e/unità","gas":"CO2e","fonte":"ISPRA 2024","source_url":"https://...","source_quote":"...","confidence":"high|medium|low"}]}`;

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
        // 8192 = limite massimo per gemini-2.5-flash. Con grounding
        // Gemini consuma più token internamente per il reasoning sui
        // risultati di ricerca → 4000 produceva risposte troncate
        // (testimoniato dai log: doppio ``` json ripetuto e
        // interruzione a metà chiave "source_url").
        maxOutputTokens: 8192
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

    // Log preview della risposta Gemini per debug. Primi 1500 char
    // dovrebbero essere sufficienti per vedere il JSON; se Gemini
    // sfora 4000 char e il JSON è troncato si vede dal preview.
    console.log('[search_fe] Gemini text length:', text.length);
    console.log('[search_fe] Gemini text preview:', text.slice(0, 1500));

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

    // Parser JSON tollerante: gestisce risposte Gemini con
    //   - fence ```json ... ```
    //   - fence ``` ... ``` (senza label)
    //   - JSON nudo senza fence
    //   - trailing commas (comuni nelle LLM)
    //   - testo informativo PRIMA o DOPO il blocco JSON
    function tolerantParse (raw: string): { candidates?: FECandidate[] } | null {
      // Step 1: estrai il blocco JSON candidato.
      // 1a) Prova fence ```json ... ```
      let candidate: string | null = null;
      const fenceMatch = raw.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        candidate = fenceMatch[1].trim();
      }
      // 1b) Fallback: bilanciamento di graffe dal primo { al matching }
      if (!candidate) {
        const start = raw.indexOf('{');
        if (start >= 0) {
          let depth = 0, inStr = false, strCh = '', end = -1;
          for (let i = start; i < raw.length; i++) {
            const c = raw[i], p = raw[i-1];
            if (inStr) {
              if (c === '\\') { i++; continue; }
              if (c === strCh) inStr = false;
              continue;
            }
            if (c === '"' || c === '\'') { inStr = true; strCh = c; continue; }
            if (c === '{') depth++;
            else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
            void p;
          }
          if (end > start) candidate = raw.slice(start, end + 1);
        }
      }
      if (!candidate) return null;

      // Step 2: cleanup comuni
      // - trailing commas prima di } o ]
      // - rimuovi commenti // a fine riga (LLM a volte li aggiunge)
      let cleaned = candidate
        .replace(/\/\/[^\n\r]*/g, '')        // commenti single-line
        .replace(/,\s*([}\]])/g, '$1');       // trailing comma

      // Step 3: tenta parse
      try { return JSON.parse(cleaned); } catch (_) { /* fallback below */ }

      // Step 4: ultima possibilità — se ci sono single-quote, convertili
      // in double (rischioso ma a volte funziona). NON viene fatto sempre
      // per evitare false positive su apostrofi nel testo.
      try {
        // Convert solo dove sembrano chiavi/valori (heuristic)
        cleaned = cleaned.replace(/(['])((?:\\.|[^\\])*?)\1/g, (m, _q, body) =>
          '"' + body.replace(/"/g, '\\"') + '"');
        return JSON.parse(cleaned);
      } catch (_) {
        return null;
      }
    }

    // Salvage parser: se il JSON è troncato (Gemini supera maxOutputTokens),
    // recupera gli oggetti completi dell'array "candidates" anche se
    // l'array stesso non si chiude. Iterate i caratteri dopo
    // "candidates": [, accumula oggetti bilanciati, scarta l'ultimo
    // se incompleto. Salva ciò che si può.
    function salvageCandidates (raw: string): FECandidate[] {
      const startMatch = raw.match(/["']candidates["']\s*:\s*\[/);
      if (!startMatch) return [];
      let i = (startMatch.index as number) + startMatch[0].length;
      const objects: string[] = [];
      while (i < raw.length) {
        // skip whitespace + virgole
        while (i < raw.length && /[\s,]/.test(raw[i])) i++;
        if (i >= raw.length || raw[i] !== '{') break;
        let depth = 0, inStr = false, strCh = '';
        const start = i;
        let closed = false;
        while (i < raw.length) {
          const c = raw[i];
          if (inStr) {
            if (c === '\\') { i += 2; continue; }
            if (c === strCh) inStr = false;
          } else {
            if (c === '"' || c === '\'') { inStr = true; strCh = c; }
            else if (c === '{') depth++;
            else if (c === '}') {
              depth--;
              if (depth === 0) {
                objects.push(raw.slice(start, i + 1));
                closed = true;
                i++;
                break;
              }
            }
          }
          i++;
        }
        if (!closed) break; // oggetto troncato → fermati
      }
      const candidates: FECandidate[] = [];
      for (const obj of objects) {
        try {
          const cleaned = obj
            .replace(/\/\/[^\n\r]*/g, '')
            .replace(/,\s*([}\]])/g, '$1');
          candidates.push(JSON.parse(cleaned));
        } catch (_) { /* skip oggetto malformato */ }
      }
      return candidates;
    }

    let parsed = tolerantParse(text);
    if (!parsed || !Array.isArray(parsed.candidates)) {
      // Fallback finale: salvage degli oggetti completi
      const salvaged = salvageCandidates(text);
      if (salvaged.length > 0) {
        console.warn('[search_fe] full parse failed, salvaged', salvaged.length, 'candidates from truncated response');
        parsed = { candidates: salvaged };
      }
    }
    if (parsed) {
      console.log('[search_fe] candidates count:', parsed.candidates?.length || 0);
    } else {
      console.error('[search_fe] JSON parse failed. Raw text:', text.slice(0, 2000));
    }

    if (!parsed || !Array.isArray(parsed.candidates) || parsed.candidates.length === 0) {
      // Includi un estratto del testo grezzo per debug rapido lato
      // client. Limitato a 400 char per non saturare la response.
      const preview = text.replace(/\s+/g, ' ').slice(0, 400);
      throw new Error('Risposta LLM non parsabile come JSON valido. Preview: ' + preview);
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
