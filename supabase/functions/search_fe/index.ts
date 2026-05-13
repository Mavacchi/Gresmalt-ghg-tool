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
import { makeHttpHelpers } from '../_shared/http.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
// Modello configurabile via secret GEMINI_MODEL così possiamo cambiarlo
// senza redeploy del codice. Default 'gemini-2.5-flash-lite'.
//
// IMPORTANTE — quote Google Search Grounding sul tier free:
// la quota del MODELLO (RPD/RPM/TPM) e la quota del TOOL grounding
// sono SEPARATE. Verifica entrambe su https://ai.dev/rate-limit.
//
// Snapshot tier free (dashboard utente):
//   Gemini 2.5 Flash       20 RPD   · grounding pool 2.5: 1.5K/giorno
//   Gemini 2.5 Flash Lite  20 RPD   · grounding pool 2.5: 1.5K (shared)
//   Gemini 3 Flash         20 RPD   · grounding pool 3: 0/0  ← NON FREE
//   Gemini 3.1 Flash Lite  500 RPD  · grounding pool 3: 0/0  ← NON FREE
//
// Quindi sui modelli Gemini 3.x con grounding attivo su account free
// si prende 429 RESOURCE_EXHAUSTED anche con quota modello intatta:
// il pool "Fondatezza della Ricerca · Gemini 3" è 0/0.
// → Default: 2.5-flash-lite (20 RPD ma grounding 2.5 disponibile).
// → Per uso intensivo: Pay-as-you-go sblocca grounding anche sui 3.x.
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash-lite';
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const { corsHeadersFor, jsonResponse, errResponse } = makeHttpHelpers(ALLOWED_ORIGINS);

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

const { corsHeadersFor, jsonResponse, errResponse } = makeHttpHelpers(ALLOWED_ORIGINS);

// Estrae l'host dall'URL e controlla se è in whitelist (match anche
// su sottodomini, es. www.defra.gov.uk → defra.gov.uk).
function isTrustedDomain(urlStr: string): boolean {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return TRUSTED_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch (_) { return false; }
}

// Mappatura termini italiani → sinonimi inglesi dei dataset GHG
// pubblici (DEFRA, EPA, IPCC, ecc). Le fonti istituzionali in
// whitelist sono prevalentemente anglofone; una query corta in
// italiano spesso non aggancia bene il grounding.
// Solo per query brevi (< 60 char): aggiungiamo i sinonimi noti come
// suffisso, lasciando intatto il testo originale.
const IT_EN_SYNONYMS: Array<[RegExp, string]> = [
  [/\b(trasporto|trasporti)\b/i,           'transport, freight'],
  [/\bcamion(c?ino|i)?\b/i,                'truck, HGV, heavy goods vehicle, lorry'],
  [/\bfurgon(e|cino|i)\b/i,                'van, light commercial vehicle, LCV'],
  [/\bautoarticolat[oi]\b/i,               'articulated lorry'],
  [/\bauto(mobile|vettura|vetture)?\b/i,   'car, passenger car'],
  [/\baere[oi]\b/i,                        'aircraft, aviation'],
  [/\btreno\b|\bferrovia\b/i,              'train, rail freight'],
  [/\bnave\b|\bnavale\b|\bmarittim[oi]\b/i,'ship, sea freight, maritime'],
  [/\belettricit[aà]\b/i,                  'electricity, grid mix'],
  [/\bgas naturale\b|\bmetano\b/i,         'natural gas, methane'],
  [/\bbenzina\b/i,                         'gasoline, petrol'],
  [/\bgasolio\b/i,                         'diesel, gas oil'],
  [/\bcarbone\b/i,                         'coal'],
  [/\bteleriscaldamento\b/i,               'district heating'],
  [/\bclinker\b|\bcemento\b/i,             'cement, clinker'],
  [/\bacciaio\b/i,                         'steel'],
  [/\bvetro\b/i,                           'glass'],
  [/\bargilla\b/i,                         'clay'],
  [/\bceramic[ao]\b|\bpiastrell[ae]\b/i,   'ceramic, ceramic tile'],
  [/\brifiuti\b|\bdiscarica\b/i,           'waste, landfill'],
  [/\bacqua potabile\b/i,                  'potable water, drinking water'],
  [/\brefrigerant[ei]\b|\bgas fluorurat[oi]\b/i, 'refrigerant, F-gases, HFC'],
];

function expandQueryItToEn (q: string): string {
  if (q.length > 60) return q;            // query già lunga, lasciala stare
  const additions: string[] = [];
  for (const [re, syn] of IT_EN_SYNONYMS) {
    if (re.test(q)) additions.push(syn);
  }
  if (additions.length === 0) return q;
  return q + ' (' + additions.join('; ') + ')';
}

// Scope-specific guidance: blocco testuale iniettato nel prompt per
// orientare Gemini sul tipo di FE atteso. Ogni scope ha implicazioni
// metodologiche diverse (TTW vs WTW, LB vs MB, perimetro filiera).
// 'auto' = nessuna istruzione: il modello sceglie liberamente.
function scopeGuidance (scope: string): string {
  if (scope === 's1') {
    return [
      'SCOPE 1 — Combustione diretta (flotta/impianti propri):',
      '- Cerca FE per combustione del COMBUSTIBILE (Tank-to-Wheel, TTW only).',
      '- NON includere componente WTT/upstream.',
      '- Unità preferite: kgCO2e/litro, kgCO2e/Sm3, kgCO2e/kg, kgCO2e/MWh combustibile.',
      '- Fonti tipiche: ISPRA Tabella combustibili, IPCC Vol.2 Cap.1-3, DEFRA "Fuels" sheet.'
    ].join('\n');
  }
  if (scope === 's2') {
    return [
      'SCOPE 2 — Elettricità/energia acquistata:',
      '- Indica esplicitamente se Location-Based (mix di rete nazionale) o Market-Based (residual mix / contratto / GO).',
      '- Per LB Italia: ISPRA Inventario nazionale o AIB Italia.',
      '- Per MB: AIB European Residual Mix (per l\'anno richiesto).',
      '- Unità: kgCO2e/kWh o /MWh.',
      '- Restituisci preferibilmente DUE candidati separati: uno LB e uno MB.'
    ].join('\n');
  }
  if (scope === 's3_purchased') {
    return [
      'SCOPE 3 Cat. 1 — Beni/servizi acquistati:',
      '- Cerca FE cradle-to-gate per il materiale/prodotto.',
      '- Includi tutta la filiera upstream (estrazione + processing + trasporto al gate produttore).',
      '- Unità: kgCO2e/kg, kgCO2e/m², kgCO2e/€ (spend-based).',
      '- Fonti tipiche: EPD pubbliche, EcoPassport, Ministero Ambiente IT, EPA SimaPro factors gov.'
    ].join('\n');
  }
  if (scope === 's3_transport') {
    return [
      'SCOPE 3 Cat. 4/9 — Trasporto e distribuzione (upstream/downstream):',
      '- Preferisci Well-to-Wheel (WTW = TTW + WTT). Specifica esplicitamente in descrizione se WTW o solo TTW.',
      '- Unità preferite: kgCO2e/tkm (tonnellata-km) per merci, kgCO2e/p·km per passeggeri.',
      '- Restituisci VARIANTI differenziate per dimensione veicolo (van, rigid HGV, articulated HGV) e laden average — non una sola media.',
      '- Fonti tipiche: DEFRA Conversion Factors → "Freighting goods" (incl. WTT sheet), EPA SmartWay, EEA EMEP/EEA guidebook.'
    ].join('\n');
  }
  if (scope === 's3_other') {
    return [
      'SCOPE 3 — Altra categoria (specifica nella descrizione quale tra 1-15 del GHG Protocol):',
      '- Indica chiaramente la categoria e il perimetro (es. "Cat.6 business travel — WTW per voli short-haul").',
      '- Per WTT-only (Cat.3): solo upstream del carburante, no combustione.'
    ].join('\n');
  }
  return '';  // 'auto' → nessuna istruzione di scope
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

  let body: { query?: string; year?: number; scope?: string };
  try {
    body = await req.json();
  } catch (_) {
    return errResponse(req, 'Bad request · payload must be valid JSON', 400);
  }
  const query = (body.query || '').trim();
  const year = Number(body.year) || new Date().getFullYear();
  // scope: hint utente su quale categoria GHG userà il FE.
  // 'auto' = nessun vincolo (default). Gli altri valori influenzano il
  // prompt per orientare Gemini su TTW vs WTW, LB vs MB, granularità.
  const VALID_SCOPES = ['auto','s1','s2','s3_purchased','s3_transport','s3_other'] as const;
  const scopeRaw = (body.scope || 'auto').toString();
  const scope = (VALID_SCOPES as readonly string[]).includes(scopeRaw)
    ? scopeRaw as typeof VALID_SCOPES[number]
    : 'auto';
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
    // Query expansion: per query italiane corte (es. "FE trasporto
    // camion") aggiungiamo sinonimi inglesi per ancorare meglio il
    // grounding alle fonti DEFRA/EPA/IPCC, che sono in inglese. Senza
    // questo passaggio, il modello fa una ricerca debole solo in
    // italiano e spesso non trova nulla.
    const expandedQuery = expandQueryItToEn(query);
    if (expandedQuery !== query) {
      console.log('[search_fe] query expanded:', JSON.stringify(query), '→', JSON.stringify(expandedQuery));
    }
    console.log('[search_fe] scope:', scope);

    // Scope-specific guidance: blocco vuoto per 'auto', altrimenti
    // istruzioni mirate (TTW vs WTW, LB vs MB, granularità varianti).
    const sg = scopeGuidance(scope);
    const scopeBlock = sg ? '\n' + sg + '\n' : '';

    // Prompt rigoroso per Gemini. Forza output JSON tra ```json fence
    // (più robusto di responseMimeType in combinazione con tools).
    // Prompt sintetico per lasciare più budget di output token alla
    // risposta vera. Mantengo le regole core (no invenzione, citazione
    // URL + quote, whitelist fonti) e abbrevio il resto.
    const prompt =
`Trova fattori di emissione (FE) per query GHG/CSRD, anno ${year}.

Fonti AMMESSE: ISPRA, GSE, Terna, MITE, MASE, DEFRA, gov.uk, EPA, EEA, IPCC, AIB, GHG Protocol, UNFCCC.
Vietati: carbonfootprint.com, Wikipedia, ecoinvent (licenza), aggregatori commerciali.

Regole base:
- Cerca attivamente sul web (DEFRA conversion factors, EPA emission factors hub, ISPRA inventario, ecc.)
- Riporta valori letti testualmente nelle pagine. Se trovi un range, riporta il valore tipico citandolo.
- Ogni FE: URL esatto + citazione breve (max 150 char)
- Restituisci fino a 5 candidati. Se un valore è plausibile ma con poca conferma, includilo con confidence:"low" — meglio dare opzioni che lasciare vuoto.
- Lista vuota SOLO se la ricerca web non ha restituito alcun risultato pertinente.

Regole di COERENZA (importanti per audit CSRD):
- anno_validita = anno dell'EDIZIONE del dataset (es. "Conversion Factors 2025" → 2025), NON l'anno di pubblicazione di un paper diverso. Se la fonte cita "Conversion Factors 2019" usa anno_validita=2019.
- Se citi un anno nella source_quote, deve coincidere con anno_validita. Mai mismatch tra i due.
- Per FE di combustione/trasporto/energia: indica ESPLICITAMENTE in descrizione se il valore è "TTW (Tank-to-Wheel · solo combustione)" oppure "WTW (Well-to-Wheel · include upstream WTT)".
- Per query generiche (es. "trasporto camion"), restituisci VARIANTI differenziate (van vs rigid HGV vs articulated, laden average) — non una sola media.
${scopeBlock}
Query: "${expandedQuery}"

Output: ESCLUSIVAMENTE un blocco JSON tra \`\`\`json e \`\`\` con questo schema:
{"candidates":[{"fe_id_suggested":"FE_xxx_${year}","famiglia":"Combustibili|Elettricità|WTT|Materiali|Trasporti|Rifiuti","codice_voce":"slug","descrizione":"breve · indica TTW o WTW se applicabile","anno_validita":${year},"valore":0.0,"unita":"kgCO2e/unità","gas":"CO2e","fonte":"ISPRA 2024","source_url":"https://...","source_quote":"...","confidence":"high|medium|low"}]}`;

    // Gemini API con Google Search Grounding tool.
    // Modello deciso a runtime da Deno.env.get('GEMINI_MODEL').
    const geminiUrl =
      'https://generativelanguage.googleapis.com/v1beta/models/'
      + GEMINI_MODEL
      + ':generateContent?key='
      + GEMINI_API_KEY;
    console.log('[search_fe] model:', GEMINI_MODEL);
    const geminiReq = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        // 0.2: poca creatività, ma evita il "pozzo deterministico"
        // dove con 0.0 il modello converge su rifiuto-totale quando la
        // query è ambigua (es. "trasporto camion" in italiano).
        temperature: 0.2,
        topP: 0.5,
        // 8192 = limite massimo per gemini-2.0-flash / 2.5-flash. Con
        // grounding il modello consuma più token internamente per il
        // reasoning sui risultati di ricerca → 4000 produceva risposte
        // troncate (testimoniato dai log: doppio ```json ripetuto e
        // interruzione a metà chiave "source_url").
        maxOutputTokens: 8192
      }
    };
    console.log('[search_fe] calling Gemini, query:', query.slice(0, 100));
    // Retry SOLO su 503 (UNAVAILABLE Google) e 5xx generici di server.
    //
    // NON ritentiamo su 429 (RESOURCE_EXHAUSTED): è la NOSTRA quota
    // free esaurita, e Gemini ci dice esattamente "retry in Ns"
    // (es. 24s) che è molto più del nostro backoff totale (~7s).
    // Ritentare consumerebbe altre richieste dalla quota e
    // peggiorerebbe la situazione.
    //
    // 4xx ≠ 429: bug nostri (payload malformato, auth, ecc.) —
    // retry inutile.
    const RETRIES = [0, 2000, 5000]; // ms di attesa prima di ogni tentativo
    let r: Response | null = null;
    let lastBody = '';
    for (let attempt = 0; attempt < RETRIES.length; attempt++) {
      if (RETRIES[attempt] > 0) {
        console.warn('[search_fe] retry in', RETRIES[attempt], 'ms (attempt', attempt + 1, 'of', RETRIES.length, ')');
        await new Promise(resolve => setTimeout(resolve, RETRIES[attempt]));
      }
      try {
        r = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiReq)
        });
        console.log('[search_fe] Gemini status:', r.status, '(attempt', attempt + 1, ')');
        if (r.ok) break;
        // Retryable solo: 503 e altri 5xx. 429 NO (consuma la quota
        // e Gemini ci dice già quando riprovare).
        const isRetryable = r.status === 503 || (r.status >= 500 && r.status < 600);
        if (!isRetryable) {
          lastBody = await r.text();
          break;
        }
        // Retryable: salva body e continua
        lastBody = await r.text();
      } catch (netErr) {
        console.warn('[search_fe] network error attempt', attempt + 1, ':', netErr instanceof Error ? netErr.message : String(netErr));
        if (attempt === RETRIES.length - 1) throw netErr;
      }
    }
    if (!r || !r.ok) {
      // Log esteso (2000 char) per vedere il dettaglio quota: i campi
      // `metric:`, `limit:`, `model:`, `quotaId:`, `retryInfo` sono in
      // `details[]` dopo i primi ~400-500 char della response 429.
      // Senza questo, vediamo solo "Learn more about Gemini API quota"
      // e non sappiamo se è stata esaurita la quota RPM, RPD o
      // grounding-specific.
      console.error('[search_fe] Gemini final error (model:', GEMINI_MODEL, ') body:', lastBody.slice(0, 2000));
      const status = r ? r.status : 0;
      // Messaggi user-friendly per gli errori più comuni.
      // Includiamo SEMPRE il modello effettivo perché il debug più
      // frequente è "non so quale modello sta girando".
      if (status === 429) {
        const retryMatch = lastBody.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
        const retrySec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;
        // Estrai la metric esaurita se Google la fornisce in details[]:
        //   "quotaMetric": "generativelanguage.googleapis.com/generate_requests_per_model_per_day"
        //   "quotaValue": "500"
        //   "quotaDimensions": { "model": "gemini-3.1-flash-lite", ... }
        // Così possiamo dire all'utente esattamente quale limite è stato superato.
        const metricMatch = lastBody.match(/"quotaMetric"\s*:\s*"([^"]+)"/);
        const limitMatch  = lastBody.match(/"quotaValue"\s*:\s*"?(\d+)"?/);
        const quotaModelMatch = lastBody.match(/"model"\s*:\s*"([^"]+)"/);
        let detail = '';
        if (metricMatch) {
          // Esempio: "generate_requests_per_model_per_day" → "richieste/giorno"
          const m = metricMatch[1];
          let friendly = m;
          if (/per_day/.test(m))       friendly = 'richieste/giorno (RPD)';
          else if (/per_minute/.test(m)) friendly = 'richieste/minuto (RPM)';
          else if (/tokens_per_minute/.test(m)) friendly = 'token/minuto (TPM)';
          detail = '\nQuota esaurita: ' + friendly
                 + (limitMatch ? ' (limite ' + limitMatch[1] + ')' : '')
                 + (quotaModelMatch && quotaModelMatch[1] !== GEMINI_MODEL
                     ? ' su ' + quotaModelMatch[1] : '');
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
        throw new Error('Modello "' + GEMINI_MODEL + '" non trovato (HTTP 404). Verifica il nome esatto del modello sul tuo account: https://ai.dev/rate-limit');
      }
      throw new Error('Gemini API ' + status + ' (modello ' + GEMINI_MODEL + '): ' + lastBody.slice(0, 300));
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
    // Log esplicito per discriminare i casi vuoti: se grounding NON è
    // stato attivato (sources_used === 0) il modello ha skippato la
    // ricerca web; se è stato attivato ma candidates === 0 il
    // problema è nel filtraggio/whitelist o nel prompt troppo cauto.
    console.log('[search_fe] sources_used (' + sourcesUsed.size + '):',
      Array.from(sourcesUsed).slice(0, 20).join(', ') || '(none — grounding non attivato)');

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

      // Step 2: cleanup minimo. SOLO trailing comma — NON tocchiamo i
      // commenti // perché Gemini quasi mai li aggiunge in JSON, e la
      // regex /\/\/[^\n\r]*/g cancellava per errore tutto da "https://"
      // in poi, distruggendo qualsiasi URL nel payload.
      let cleaned = candidate.replace(/,\s*([}\]])/g, '$1');

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
          // Stesso fix di tolerantParse: NON rimuoviamo i commenti //
          // perché distruggono gli URL HTTPS nei source_url.
          const cleaned = obj.replace(/,\s*([}\]])/g, '$1');
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

    if (!parsed || !Array.isArray(parsed.candidates)) {
      // Vero fallimento di parsing (Gemini non ha prodotto JSON
      // utilizzabile). Includi un estratto del testo grezzo per debug
      // rapido lato client. Limitato a 400 char per non saturare la
      // response.
      const preview = text.replace(/\s+/g, ' ').slice(0, 400);
      throw new Error('Risposta LLM non parsabile come JSON valido. Preview: ' + preview);
    }
    // candidates.length === 0 è un risultato LEGITTIMO: Gemini ci sta
    // dicendo "non ho trovato nulla di affidabile per questa query".
    // Lo gestiamo a valle col campo `notice` della response. Non è un
    // errore da loggare come parse failure.

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
