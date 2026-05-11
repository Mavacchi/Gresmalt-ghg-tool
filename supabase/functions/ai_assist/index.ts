// supabase/functions/ai_assist/index.ts
//
// Edge Function "AI generica" senza Google Search Grounding. Usata per
// task che NON richiedono di consultare il web ma solo elaborazione
// testuale/strutturata su dati già in nostro possesso.
//
// Vantaggio: usa una quota di pool DIVERSO da search_fe.
//   - search_fe         : pool "Fondatezza della Ricerca - Gemini 2.5"
//                         (limitato a 20 RPD sul modello free).
//   - ai_assist (this)  : modello puro, default gemini-3.1-flash-lite
//                         (500 RPD free, grounding non richiesto).
//
// Task supportati (dispatch via body.task):
//   'explain_balance'  → riassunto narrativo del bilancio GHG
//   'normalize_unit'   → unità di misura nella forma canonica DB
//   'suggest_code'     → codice voce coerente con quelli esistenti
//
// Deploy:
//   supabase functions deploy ai_assist  --no-verify-jwt
//   (GEMINI_API_KEY già configurato per search_fe)
//
// CORS: stesso pattern delle altre 4 functions.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
// Modello configurabile via secret GEMINI_MODEL_PLAIN così possiamo
// ottimizzare separatamente dal modello grounded di search_fe.
// Default 'gemini-3.1-flash-lite': 500 RPD free + qualità sufficiente
// per i task strutturati. Senza grounding NON si applica il limite
// "Fondatezza della Ricerca - Gemini 3" 0/0 sul tier free.
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL_PLAIN')
                  || Deno.env.get('GEMINI_MODEL')
                  || 'gemini-3.1-flash-lite';
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

function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeadersFor(req) }
  });
}
function errResponse(req: Request, message: string, status: number) {
  return jsonResponse(req, { ok: false, error: message }, status);
}

// Whitelist task per evitare prompt injection arbitraria.
type TaskName = 'explain_balance' | 'normalize_unit' | 'suggest_code';
const VALID_TASKS: TaskName[] = ['explain_balance', 'normalize_unit', 'suggest_code'];

// Limiti su payload per task (KB). Anche se body globale è 32 KB,
// ogni task ha un limite ragionevole sul proprio payload.
const TASK_PAYLOAD_MAX_KB: Record<TaskName, number> = {
  explain_balance: 16,  // include tutti i totali per sito
  normalize_unit:  1,   // solo stringa
  suggest_code:    8    // include lista codici esistenti
};

serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error('[ai_assist] FATAL:', msg, stack);
    return errResponse(req, 'Internal error: ' + msg, 500);
  }
});

async function handle (req: Request): Promise<Response> {
  console.log('[ai_assist] request', req.method, req.headers.get('Origin') || '(no origin)');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST') return errResponse(req, 'Method not allowed', 405);
  if (!GEMINI_API_KEY) {
    console.error('[ai_assist] GEMINI_API_KEY missing');
    return errResponse(req, 'Server not configured · GEMINI_API_KEY missing', 500);
  }

  if (ALLOWED_ORIGINS.length > 0) {
    const origin = req.headers.get('Origin') || '';
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      console.warn('[ai_assist] origin not allowed:', origin, '· allowed:', ALLOWED_ORIGINS);
      return errResponse(req, 'Forbidden · origin not allowed (' + origin + ')', 403);
    }
  }

  const auth = req.headers.get('Authorization');
  if (!auth) return errResponse(req, 'Unauthorized · missing Bearer token', 401);

  const sbUrl = Deno.env.get('SUPABASE_URL');
  const sbKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
             || Deno.env.get('SUPABASE_ANON_KEY');
  if (!sbUrl || !sbKey) {
    console.error('[ai_assist] SUPABASE_URL or KEY missing in env');
    return errResponse(req, 'Server not configured · SUPABASE_URL or KEY missing', 500);
  }

  const sb = createClient(sbUrl, sbKey,
    { global: { headers: { Authorization: auth } } });
  const { data: u, error: authErr } = await sb.auth.getUser();
  if (authErr || !u?.user) {
    console.warn('[ai_assist] auth.getUser failed:', authErr?.message);
    return errResponse(req, 'Unauthorized · invalid session', 401);
  }
  const role = (u.user.app_metadata as Record<string, unknown>)?.role;
  console.log('[ai_assist] user:', u.user.email, 'role:', role);
  if (role !== 'admin' && role !== 'editor') {
    return errResponse(req, 'Forbidden · admin/editor role required (current: ' + role + ')', 403);
  }

  const ctLen = parseInt(req.headers.get('Content-Length') || '0', 10);
  if (ctLen > 32768) return errResponse(req, 'Payload too large (>32 KB)', 413);

  let body: { task?: string; payload?: unknown };
  try {
    body = await req.json();
  } catch (_) {
    return errResponse(req, 'Bad request · payload must be valid JSON', 400);
  }
  const task = body.task as TaskName;
  if (!task || !VALID_TASKS.includes(task)) {
    return errResponse(req, 'Bad request · task must be one of: ' + VALID_TASKS.join(', '), 400);
  }
  const payload = body.payload || {};
  const payloadSize = JSON.stringify(payload).length;
  if (payloadSize > TASK_PAYLOAD_MAX_KB[task] * 1024) {
    return errResponse(req,
      'Bad request · payload troppo grande per task ' + task +
      ' (' + Math.ceil(payloadSize/1024) + ' KB > ' + TASK_PAYLOAD_MAX_KB[task] + ' KB)', 400);
  }

  const t0 = Date.now();
  let output: unknown = null;
  let errorMessage: string | null = null;

  try {
    // Costruisci prompt + config per task. Ogni task ha:
    //   - prompt: testo che istruisce Gemini
    //   - jsonOutput: true se output strutturato (responseMimeType JSON)
    //   - maxTokens: budget output
    //   - parser: come trasformare la risposta in `output`
    const spec = buildTaskSpec(task, payload as Record<string, unknown>);

    const geminiUrl =
      'https://generativelanguage.googleapis.com/v1beta/models/'
      + GEMINI_MODEL
      + ':generateContent?key='
      + GEMINI_API_KEY;
    console.log('[ai_assist] task:', task, 'model:', GEMINI_MODEL);

    const geminiReq: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: spec.prompt }] }],
      generationConfig: {
        temperature: spec.temperature ?? 0.1,
        topP: 0.5,
        maxOutputTokens: spec.maxTokens
      }
    };
    // Per task strutturati chiediamo direttamente JSON nativo (più
    // robusto del fence markdown perché senza tools Gemini lo onora).
    if (spec.jsonOutput) {
      (geminiReq.generationConfig as Record<string, unknown>).responseMimeType = 'application/json';
    }

    // Retry su 503 e 5xx generici, MAI su 429 (consumerebbe altra quota).
    const RETRIES = [0, 2000, 5000];
    let r: Response | null = null;
    let lastBody = '';
    for (let attempt = 0; attempt < RETRIES.length; attempt++) {
      if (RETRIES[attempt] > 0) {
        console.warn('[ai_assist] retry in', RETRIES[attempt], 'ms (attempt', attempt + 1, 'of', RETRIES.length, ')');
        await new Promise(resolve => setTimeout(resolve, RETRIES[attempt]));
      }
      try {
        r = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiReq)
        });
        console.log('[ai_assist] Gemini status:', r.status, '(attempt', attempt + 1, ')');
        if (r.ok) break;
        const isRetryable = r.status === 503 || (r.status >= 500 && r.status < 600);
        if (!isRetryable) { lastBody = await r.text(); break; }
        lastBody = await r.text();
      } catch (netErr) {
        console.warn('[ai_assist] network error attempt', attempt + 1, ':', netErr instanceof Error ? netErr.message : String(netErr));
        if (attempt === RETRIES.length - 1) throw netErr;
      }
    }
    if (!r || !r.ok) {
      console.error('[ai_assist] Gemini final error (model:', GEMINI_MODEL, ') body:', lastBody.slice(0, 2000));
      const status = r ? r.status : 0;
      if (status === 429) {
        const retryMatch = lastBody.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
        const retrySec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;
        const metricMatch = lastBody.match(/"quotaMetric"\s*:\s*"([^"]+)"/);
        let detail = '';
        if (metricMatch) {
          const m = metricMatch[1];
          if (/per_day/.test(m))       detail = '\nQuota esaurita: richieste/giorno (RPD)';
          else if (/per_minute/.test(m)) detail = '\nQuota esaurita: richieste/minuto (RPM)';
          else if (/tokens_per_minute/.test(m)) detail = '\nQuota esaurita: token/minuto (TPM)';
        }
        throw new Error(
          'Quota Gemini esaurita (modello ' + GEMINI_MODEL + ').' + detail + '\n' +
          'Riprova tra circa ' + retrySec + ' secondi.\n' +
          'Per quote più alte: piano Pay-as-you-go su https://aistudio.google.com.'
        );
      }
      if (status === 503) {
        throw new Error('Servizio Gemini temporaneamente sovraccarico (modello ' + GEMINI_MODEL + ', HTTP 503). Riprova tra 1-2 minuti.');
      }
      if (status === 401 || status === 403) {
        throw new Error('Gemini API ha rifiutato la chiave (HTTP ' + status + '). Verifica GEMINI_API_KEY su Supabase secrets.');
      }
      if (status === 404) {
        throw new Error('Modello "' + GEMINI_MODEL + '" non trovato (HTTP 404). Verifica il nome esatto del modello: https://ai.dev/rate-limit');
      }
      throw new Error('Gemini API ' + status + ' (modello ' + GEMINI_MODEL + '): ' + lastBody.slice(0, 300));
    }

    const response = await r.json() as Record<string, unknown>;
    const cs = (response.candidates as Array<Record<string, unknown>>) || [];
    if (cs.length === 0) throw new Error('Gemini ha risposto senza candidates');
    const first = cs[0];
    const content = first.content as Record<string, unknown>;
    const parts = (content?.parts as Array<Record<string, unknown>>) || [];
    const text = parts.map(p => p.text || '').join('');

    console.log('[ai_assist] Gemini text length:', text.length);
    console.log('[ai_assist] Gemini text preview:', text.slice(0, 500));

    output = spec.parse(text);
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  const durationMs = Date.now() - t0;

  // Audit log: salva sempre input/output anche se errore.
  let logId: number | null = null;
  try {
    const { data: logData } = await sb.rpc('log_ai_assist', {
      p_task:        task,
      p_input:       payload,
      p_output:      output ?? null,
      p_duration_ms: durationMs,
      p_error:       errorMessage
    });
    if (typeof logData === 'number') logId = logData;
  } catch (_) { /* log non critico */ }

  if (errorMessage) {
    return errResponse(req, errorMessage, 502);
  }

  return jsonResponse(req, {
    ok: true,
    log_id: logId,
    task,
    output,
    duration_ms: durationMs
  });
}

// ──────────────────────────────────────────────────────────────────
//  Task spec: prompt + config + parser per ciascun task.
// ──────────────────────────────────────────────────────────────────

interface TaskSpec {
  prompt: string;
  maxTokens: number;
  jsonOutput: boolean;
  temperature?: number;
  parse: (text: string) => unknown;
}

function buildTaskSpec (task: TaskName, p: Record<string, unknown>): TaskSpec {
  if (task === 'explain_balance') return specExplainBalance(p);
  if (task === 'normalize_unit')  return specNormalizeUnit(p);
  if (task === 'suggest_code')    return specSuggestCode(p);
  // unreachable: VALID_TASKS controllato a monte
  throw new Error('Unknown task: ' + task);
}

// ─── explain_balance ──────────────────────────────────────────────
function specExplainBalance (p: Record<string, unknown>): TaskSpec {
  const year     = p.year ?? '?';
  const totals   = (p.totals  as Record<string, number>) || {};
  const intensity= (p.intensity as Record<string, number | null>) || {};
  const goPct    = p.go_coverage_pct;
  const sites    = (p.sites as Array<Record<string, unknown>>) || [];
  const s2Method = (p.s2_method as string) || 'lb';

  const sitesTxt = sites.length > 0
    ? sites.slice(0, 12).map(s => {
        const k = s.codice_sito || s.code || '?';
        const s1 = num(s.s1), s2 = num(s2Method === 'mb' ? s.s2mb : s.s2lb);
        return '  - ' + k + ': S1=' + fmt(s1) + ' S2=' + fmt(s2) + ' tCO2e';
      }).join('\n')
    : '  (nessun sito disponibile)';

  const prompt =
`Sei un analista GHG/CSRD. Riassumi in italiano il bilancio di emissioni di un'azienda di ceramica per l'anno ${year}.

DATI:
- Scope 1: ${fmt(num(totals.s1))} tCO2e
- Scope 2 Location-Based: ${fmt(num(totals.s2lb))} tCO2e
- Scope 2 Market-Based: ${fmt(num(totals.s2mb))} tCO2e
- Scope 3: ${fmt(num(totals.s3))} tCO2e
- Totale (S1 + S2 ${s2Method.toUpperCase()} + S3): ${fmt(num(totals.s1) + num(s2Method === 'mb' ? totals.s2mb : totals.s2lb) + num(totals.s3))} tCO2e
- Intensità per m²: ${intensity.perM2 == null ? 'n.d.' : fmt(num(intensity.perM2), 2) + ' kgCO2e/m²'}
- Intensità per kg: ${intensity.perKg == null ? 'n.d.' : fmt(num(intensity.perKg), 2) + ' kgCO2e/kg'}
- Copertura Garanzie di Origine: ${goPct == null ? 'n.d.' : fmt(num(goPct), 0) + '%'}

Per sito (S1, S2 ${s2Method.toUpperCase()}):
${sitesTxt}

PRODUCI:
1. **Panoramica** (1-2 frasi): totale, scope dominante, differenza LB vs MB
2. **Osservazioni chiave** (3-4 bullet): sito con maggiore impatto, ruolo delle GO, anomalie evidenti
3. **Raccomandazioni** (2-3 bullet): aree di intervento prioritarie, lacune di dato

VINCOLI:
- Italiano professionale, conciso
- Massimo 220 parole totali
- Cita SOLO le cifre fornite (non inventare)
- Markdown semplice (** per grassetto, - per bullet)
- Niente preamboli ("Ecco il riassunto:") né conclusioni
- Niente disclaimer ("come AI...")`;

  return {
    prompt,
    maxTokens: 1024,
    jsonOutput: false,
    temperature: 0.3,
    parse: (text) => ({ text: text.trim() })
  };
}

// ─── normalize_unit ───────────────────────────────────────────────
function specNormalizeUnit (p: Record<string, unknown>): TaskSpec {
  const raw = String(p.raw || '').trim().slice(0, 200);
  if (!raw) throw new Error('normalize_unit: payload.raw mancante');

  const prompt =
`Normalizza questa unità di misura GHG nella forma canonica del database.

REGOLE:
- "CO2e" (non "CO2eq", "CO2-eq", "CO₂e", "co2e")
- Cifre normali (no subscript ₂)
- Separatore: "/" senza spazi (no "per")
- "kg" e "t" minuscoli, "kWh"/"MWh" (kWh non KWH), "m²"/"m³" con superscript
- Nessuno spazio interno tranne quando inevitabile

ESEMPI:
"kg co2 eq per kwh"        → "kgCO2e/kWh"
"tonnes co2 per ton"       → "tCO2e/t"
"g CO2-eq per km"          → "gCO2e/km"
"kilograms CO2 per litre"  → "kgCO2e/l"
"co2 e / m2"               → "kgCO2e/m²"  (se non specificato kg è il default per emissioni)
"mwh"                      → "MWh"

INPUT: "${raw}"

Rispondi SOLO con questo JSON (no testo prima/dopo):
{"unit":"<unità canonica>","alternatives":["<varianti accettabili>"],"rationale":"<breve spiegazione max 80 char>"}`;

  return {
    prompt,
    maxTokens: 256,
    jsonOutput: true,
    temperature: 0.0,
    parse: (text) => {
      const obj = parseStrictJSON(text);
      if (!obj || typeof obj.unit !== 'string' || !obj.unit) {
        throw new Error('normalize_unit: risposta LLM non valida — manca campo "unit"');
      }
      return {
        unit: obj.unit,
        alternatives: Array.isArray(obj.alternatives) ? obj.alternatives.slice(0, 5) : [],
        rationale: typeof obj.rationale === 'string' ? obj.rationale.slice(0, 200) : ''
      };
    }
  };
}

// ─── suggest_code ─────────────────────────────────────────────────
function specSuggestCode (p: Record<string, unknown>): TaskSpec {
  const descrizione = String(p.descrizione || '').trim().slice(0, 300);
  if (!descrizione) throw new Error('suggest_code: payload.descrizione mancante');
  const famigliaHint = p.famiglia ? String(p.famiglia).slice(0, 50) : '';
  const existingCodes = Array.isArray(p.existing_codes)
    ? (p.existing_codes as unknown[])
        .map(String)
        .filter(s => s.length > 0 && s.length < 60)
        .slice(0, 30)
    : [];

  const codesTxt = existingCodes.length > 0
    ? existingCodes.map(c => '  - ' + c).join('\n')
    : '  (nessun codice di riferimento per questa famiglia)';

  const prompt =
`Suggerisci un codice voce e una famiglia GHG per questo fattore di emissione, coerenti con la convenzione del database.

CONVENZIONI codice_voce (vedi codici esistenti sotto):
- PascalCase o snake_case, max 40 char
- Niente spazi, niente accenti, niente unità di misura
- Pattern tipico: TIPO_VARIANTE_DETTAGLIO (es. "HGV_Diesel_7t", "Metano", "Argilla_Spagna")
- Coerente nello stile (case, separatori, abbreviazioni) con i codici esistenti

FAMIGLIE ammesse: Combustibili, Elettricità, WTT, Materiali, Trasporti, Rifiuti, Acqua, Refrigeranti, Altro

DESCRIZIONE: "${descrizione}"
${famigliaHint ? 'FAMIGLIA suggerita dall\'utente: "' + famigliaHint + '"' : ''}

CODICI ESISTENTI (per coerenza stile):
${codesTxt}

Rispondi SOLO con questo JSON (no testo prima/dopo):
{"codice_voce":"<codice>","famiglia":"<famiglia>","descrizione_breve":"<max 60 char>","rationale":"<perché questo codice, max 120 char>"}`;

  return {
    prompt,
    maxTokens: 256,
    jsonOutput: true,
    temperature: 0.2,
    parse: (text) => {
      const obj = parseStrictJSON(text);
      if (!obj || typeof obj.codice_voce !== 'string' || !obj.codice_voce) {
        throw new Error('suggest_code: risposta LLM non valida — manca campo "codice_voce"');
      }
      return {
        codice_voce: obj.codice_voce.slice(0, 60),
        famiglia: typeof obj.famiglia === 'string' ? obj.famiglia.slice(0, 50) : '',
        descrizione_breve: typeof obj.descrizione_breve === 'string' ? obj.descrizione_breve.slice(0, 100) : '',
        rationale: typeof obj.rationale === 'string' ? obj.rationale.slice(0, 200) : ''
      };
    }
  };
}

// ──────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────

// Parser JSON che tollera fence markdown (a volte Gemini li mette
// anche con responseMimeType:application/json) e trailing commas.
function parseStrictJSON (raw: string): Record<string, unknown> | null {
  let s = raw.trim();
  // Strip fence se presente
  const fenceMatch = s.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fenceMatch) s = fenceMatch[1].trim();
  // Trailing commas
  s = s.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(s); } catch (_) { return null; }
}

function num (v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function fmt (v: number, digits = 0): string {
  if (!isFinite(v)) return '0';
  return v.toLocaleString('it-IT', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
    useGrouping: true
  });
}
