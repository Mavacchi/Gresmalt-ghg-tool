# Edge Functions

Le funzioni serverless di Supabase, scritte in **Deno** (TypeScript). Vivono
in `supabase/functions/<name>/index.ts`. Deploy:

```bash
supabase functions deploy <name> --no-verify-jwt
supabase secrets set GEMINI_API_KEY=AIza...
supabase secrets set SNAPSHOT_HMAC_KEY=<random-32-bytes-hex>
supabase secrets set ALLOWED_ORIGINS=https://sustainability.gresmalt.it
```

> `--no-verify-jwt` significa che il gate è gestito **manualmente** dal codice
> della funzione (legge `Authorization: Bearer <jwt>`, costruisce un client
> Supabase con quel JWT, chiama `sb.auth.getUser()` per validare). Questo
> permette anche origin allow-list + role check.

## Lista funzioni (5)

| Funzione | Auth richiesta | Scopo |
|---|---|---|
| `sign_snapshot` | admin only | firma HMAC-SHA256 di un payload JSON |
| `verify_snapshot` | qualunque authenticated | verifica una firma HMAC |
| `verify_audit_chain` | admin / auditor a aal2 (gate nel SQL) | wrapper della SQL function |
| `ai_assist` | admin / editor | task LLM generici (Gemini, no grounding) |
| `search_fe` | admin / editor | ricerca FE via Gemini + Google Search Grounding (UI disattivata) |

## Pattern comune

Tutte le 5 funzioni condividono lo stesso scheletro:

```ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function corsHeadersFor(req: Request) { /* Access-Control-Allow-Origin */ }
function jsonResponse(req, body, status=200) { /* ... */ }
function errResponse(req, message, status) { /* ... */ }

serve(async (req) => {
  try {
    if (req.method === 'OPTIONS')
      return new Response('ok', { headers: corsHeadersFor(req) });

    // Origin allow-list
    if (ALLOWED_ORIGINS.length > 0) {
      const origin = req.headers.get('Origin') || '';
      if (origin && !ALLOWED_ORIGINS.includes(origin))
        return errResponse(req, 'Forbidden · origin not allowed', 403);
    }

    // Bearer token
    const auth = req.headers.get('Authorization');
    if (!auth) return errResponse(req, 'Unauthorized', 401);

    // Crea client Supabase con il JWT dell'utente
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      (Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY'))!,
      { global: { headers: { Authorization: auth } } }
    );

    // Valida JWT + leggi user
    const { data: u, error: authErr } = await sb.auth.getUser();
    if (authErr || !u?.user) return errResponse(req, 'Unauthorized', 401);

    // Role check
    const role = u.user.app_metadata?.role;
    if (role !== 'admin' && role !== 'editor')
      return errResponse(req, 'Forbidden · admin/editor only', 403);

    // ... business logic ...
  } catch (e) {
    return errResponse(req, 'Internal error: ' + e.message, 500);
  }
});
```

## `sign_snapshot`

**Path**: `supabase/functions/sign_snapshot/index.ts`

Firma un payload JSON di snapshot inventario con HMAC-SHA256.

```ts
async function hmacSha256(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(data: string): Promise<string> { /* analogo */ }

const payload = JSON.stringify(body);
const data_sha256 = await sha256(payload);
const signature = await hmacSha256(HMAC_KEY, payload + '|' + data_sha256);
```

**Auth**: admin only (controllo esplicito su `role`).

**Body limit**: 1 MB (anti-DoS firma di payload enormi).

**Output**:
```json
{
  "ok": true,
  "signature": "8f3a7b...",
  "data_sha256": "abc123...",
  "signed_at": "2025-03-15T10:23:45Z",
  "signer_email": "admin@gresmalt.it",
  "algorithm": "HMAC-SHA256"
}
```

**Secrets richiesti**:
- `SNAPSHOT_HMAC_KEY` — almeno 32 bytes hex random (es. `openssl rand -hex 32`)
- `ALLOWED_ORIGINS` — CSV delle origin consentite (es.
  `https://sustainability.gresmalt.it,https://gresmalt.github.io`)

**Uso lato client**:
* Sezione **Download** della console interna (per snapshot inventario)
* Sezione **Audit Trail** (per export firmato del log)

## `verify_snapshot`

**Path**: `supabase/functions/verify_snapshot/index.ts`

Verifica una firma HMAC-SHA256 precedentemente generata da `sign_snapshot`.

```ts
const { payload, signature, data_sha256 } = body;
const serialized = JSON.stringify(payload);
const computedSha = await sha256(serialized);
const computedSig = await hmacSha256(HMAC_KEY, serialized + '|' + computedSha);

const sha_ok = constantTimeEq(computedSha, data_sha256);
const sig_ok = constantTimeEq(computedSig, signature);
const valid = sha_ok && sig_ok;
```

`constantTimeEq` previene timing attack:

```ts
function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
```

**Auth**: qualunque utente autenticato (admin/editor/auditor/viewer).

**Output** (HTTP 200 se valid, 422 altrimenti):
```json
{
  "valid": true,
  "sha_match": true,
  "signature_match": true,
  "verified_at": "2025-03-15T10:30:00Z",
  "verifier_email": "auditor@gresmalt.it"
}
```

## `verify_audit_chain`

**Path**: `supabase/functions/verify_audit_chain/index.ts`

Wrapper Edge sulla SQL function omonima. Aggiunge CORS + autenticazione +
risposta JSON formattata.

```ts
const { data, error } = await sb.rpc('verify_audit_chain');
// SQL function fa il role check interno (admin / auditor a aal2)

const broken = (data || []).find(r => r.broken_id);
return new Response(JSON.stringify({
  integrity: broken ? 'broken' : 'ok',
  first_broken_id: broken?.broken_id ?? null,
  expected_hash: broken?.expected_hash ?? null,
  actual_hash: broken?.actual_hash ?? null,
  verified_at: new Date().toISOString()
}));
```

L'enforcement è nel SQL: se il caller non è admin/auditor-a-aal2, la RPC
ritorna error → Edge ritorna 403.

## `ai_assist`

**Path**: `supabase/functions/ai_assist/index.ts` (~620 righe)

Task LLM generici **senza Google Search Grounding**. Usa
`gemini-3.1-flash-lite` (default, 500 RPD free, no grounding pool).

### Auth
admin / editor only.

### Body size limits per task

```ts
const TASK_PAYLOAD_MAX_KB = {
  explain_balance: 16,  // include totali per sito
  chat_balance:    28,  // include context + history
  suggest_code:    8,   // include lista codici esistenti
  normalize_unit:  1    // solo stringa
};
```

Limite globale: 32 KB (`Content-Length` check).

### Task supportati

#### `explain_balance` (single-turn)

Riassunto narrativo del bilancio GHG di un anno.

**Payload**:
```json
{
  "year": 2025,
  "totals": { "s1": 28000, "s2lb": 35000, "s2mb": 0, "s3": 95000 },
  "intensity": { "perM2": 4.2, "perKg": 0.18 },
  "go_coverage_pct": 100,
  "sites": [
    { "codice_sito": "IANO",  "s1": 12000, "s2lb": 14000, "s2mb": 0 },
    { "codice_sito": "VIANO", "s1": 9000,  "s2lb": 11000, "s2mb": 0 },
    ...
  ],
  "s2_method": "mb"
}
```

**Prompt**: Vincola Gemini a:
- Italiano professionale, max ~220 parole
- Markdown semplice (`**`, `-`)
- Citare SOLO le cifre fornite (no invenzione)
- Niente preamboli ("Ecco il riassunto:") né disclaimer ("come AI...")

**Output**:
```json
{ "ok": true, "log_id": 42, "task": "explain_balance",
  "output": { "text": "<markdown>" }, "duration_ms": 2340 }
```

#### `chat_balance` (multi-turn)

Chat conversazionale sul bilancio dopo il primo riassunto.

**Payload**:
```json
{
  "balance_context": { /* stessi campi di explain_balance */ },
  "messages": [
    { "role": "assistant", "text": "<riassunto generato dal primo turn>" },
    { "role": "user", "text": "Perché Scope 3 è cresciuto rispetto al 2024?" }
    /* eventuali altri turn alternati */
  ]
}
```

**Logica**:
- Sanitize messaggi: max 4000 char ciascuno, role normalizzato a user|assistant
- Costruisce contents Gemini in formato multi-turn `[{role:'user'|'model', parts:[{text}]}]`
- Prepend di un **system primer** come primo `user` turn con il contesto del
  bilancio + linee guida
- Poi alterna i turn della history reale
- **Trimming**: se total chars > 24 000, mantiene primi 2 turn (primer +
  riassunto) + ultimo turn (domanda corrente), rimuove i più vecchi in
  mezzo a coppie (user+model insieme per non rompere l'alternanza)

**Output**: `{ output: { text: "<risposta markdown>" } }`

#### `normalize_unit` (single-turn, JSON output)

Normalizza una stringa di unità GHG nella forma canonica del DB.

**Payload**: `{ "raw": "kg co2 eq per kwh" }`

**Prompt**: vincola Gemini con esempi di canonical:
- `"kg co2 eq per kwh"` → `"kgCO2e/kWh"`
- `"tonnes co2 per ton"` → `"tCO2e/t"`
- `"co2 e / m2"` → `"kgCO2e/m²"` (default kg per emissioni)
- `"mwh"` → `"MWh"`

Risposta JSON:
```json
{ "unit": "kgCO2e/kWh", "alternatives": ["kg CO2e/kWh"], "rationale": "..." }
```

Parser tollerante (`parseStrictJSON`): rimuove fence markdown e trailing
commas.

**Output**:
```json
{ "ok": true, "log_id": 43, "task": "normalize_unit",
  "output": { "unit": "kgCO2e/kWh", "alternatives": [...], "rationale": "..." } }
```

#### `suggest_code` (single-turn, JSON output)

Suggerisce un `codice_voce` + `famiglia` per un nuovo FE.

**Payload**:
```json
{
  "descrizione": "Trasporto su gomma con autoarticolato laden",
  "famiglia": "Trasporti",
  "existing_codes": ["HGV_Diesel_7t", "HGV_Diesel_32t", "LGV_Diesel", ...]
}
```

**Prompt**: convenzione DB:
- PascalCase o snake_case, max 40 char
- Niente spazi/accenti/unità di misura
- Pattern `TIPO_VARIANTE_DETTAGLIO`
- Coerente nello stile con i codici esistenti

**Output**:
```json
{ "ok": true, "output": {
    "codice_voce": "HGV_Diesel_Articolato",
    "famiglia": "Trasporti",
    "descrizione_breve": "Camion articolato diesel",
    "rationale": "..."
} }
```

### Retry policy

```ts
const RETRIES = [0, 2000, 5000]; // ms
```

Retry **solo** su 503 (UNAVAILABLE Google) e 5xx generici. **MAI** su 429
(RESOURCE_EXHAUSTED — la nostra quota è esaurita, retry consumerebbe altre
richieste).

### Error handling friendly

Messaggi specifici per gli HTTP status comuni di Gemini:
- **429**: parse della `quotaMetric` (es. `requests_per_day` → "richieste/giorno (RPD)"),
  parse del retry-in seconds
- **503**: "Servizio Gemini temporaneamente sovraccarico (modello X, HTTP 503).
  Riprova tra 1-2 minuti."
- **401/403**: "Gemini API ha rifiutato la chiave (HTTP X). Verifica
  GEMINI_API_KEY su Supabase secrets."
- **404**: "Modello X non trovato. Verifica il nome esatto del modello."

### Audit log

Ogni chiamata (anche fallita) viene loggata in `ai_assist_log` via
`log_ai_assist(task, input, output, duration_ms, error)` RPC (security
definer; legge auth.uid() dal JWT). Lo `log_id` ritornato è incluso nella
response per riferimento client.

## `search_fe`

**Path**: `supabase/functions/search_fe/index.ts` (~700 righe)

Ricerca FE via **Gemini 2.5 Flash con Google Search Grounding**. Riceve una
query naturale (es. "FE trasporto furgone diesel 7t 2025"), ritorna fino a 5
candidati con valore, unità, anno, URL fonte, citazione testuale.

> **Disabilitata in UI** (FEExplorer.jsx). I risultati erano sistematicamente
> inaffidabili: mismatch anno/edizione, ambiguità TTW vs WTW, sintesi di
> valori letti su landing page senza il numero esatto. La Edge Function
> rimane nel repo per uso futuro.

### Modello

`gemini-2.5-flash-lite` (default, configurabile via secret `GEMINI_MODEL`).

**Quota free tier**: 20 RPD model + 1.5K/day grounding pool 2.5. I modelli
Gemini 3.x hanno grounding pool 0/0 sul free (richiede Pay-as-you-go).

### Whitelist domini sorgente

```ts
const TRUSTED_DOMAINS = [
  // Italia
  'ispra.it', 'ispra.gov.it', 'snpambiente.it', 'isprambiente.gov.it',
  'gse.it', 'terna.it', 'minambiente.it', 'mite.gov.it', 'mase.gov.it',
  // UK
  'gov.uk', 'defra.gov.uk',
  // USA
  'epa.gov',
  // EU/supranazionali
  'eea.europa.eu', 'europa.eu', 'ec.europa.eu',
  'aib-net.org', 'ipcc.ch', 'ipcc-nggip.iges.or.jp', 'unfccc.int',
  // Standard
  'ghgprotocol.org', 'sciencebasedtargets.org', 'carbontrust.com'
];
```

Lato server filtriamo i candidati con `source_url` non in whitelist.

### Query expansion italiano → inglese

```ts
const IT_EN_SYNONYMS = [
  [/\b(trasporto|trasporti)\b/i,    'transport, freight'],
  [/\bcamion(c?ino|i)?\b/i,         'truck, HGV, heavy goods vehicle'],
  [/\bfurgon(e|cino|i)\b/i,         'van, light commercial vehicle, LCV'],
  ...
];
```

Per query brevi (< 60 char), aggiunge i sinonimi inglesi come suffisso
parentetico. Le fonti istituzionali in whitelist sono prevalentemente
anglofone; una query corta solo in italiano spesso non aggancia bene il
grounding.

### Scope-specific prompt guidance

L'utente può passare `scope` nel body (`auto` / `s1` / `s2` / `s3_purchased` /
`s3_transport` / `s3_other`). Cambia il blocco di istruzioni per Gemini:

* **s1**: "TTW only (Tank-to-Wheel), non includere componente WTT/upstream"
* **s2**: "indica esplicitamente Location-Based o Market-Based. Restituisci
  preferibilmente DUE candidati separati (LB + MB)"
* **s3_transport**: "WTW (Well-to-Wheel = TTW + WTT) preferibile. Varianti
  differenziate per dimensione veicolo, non una sola media"
* **s3_purchased**: "cradle-to-gate per il materiale/prodotto"
* **s3_other**: "indica chiaramente la categoria 1-15 + perimetro"

### Output struttura

Prompt force Gemini a rispondere con ```json … ``` fence:

```json
{
  "candidates": [
    {
      "fe_id_suggested": "FE_HGV_Diesel_Articulated_2024",
      "famiglia": "Trasporti",
      "codice_voce": "HGV_Diesel_Articulated",
      "descrizione": "Articulated lorry diesel, laden average WTW",
      "anno_validita": 2024,
      "valore": 0.084,
      "unita": "kgCO2e/tkm",
      "gas": "CO2e",
      "fonte": "DEFRA Conversion Factors 2024",
      "source_url": "https://www.gov.uk/...",
      "source_quote": "Articulated HGV, laden average: 0.084 kgCO2e/tkm",
      "confidence": "high"
    }
  ]
}
```

### Parser tollerante

3 fallback successivi:

1. **Fence match** (`tolerantParse`): cerca ```json…``` o ```…```; cleanup
   trailing commas; `JSON.parse`
2. **Brace-balance** (`tolerantParse`): se no fence, balance `{}` dal primo
   `{` al matching `}`
3. **Salvage** (`salvageCandidates`): se il JSON è truncato (Gemini supera
   `maxOutputTokens=8192`), recupera gli oggetti completi dell'array
   `candidates` anche se l'array non si chiude. Iterate i caratteri,
   accumula oggetti bilanciati, scarta l'ultimo se incompleto.

Importante: il cleanup **NON** rimuove i commenti `//` perché un regex
`//[^\n\r]*` cancellava per errore tutto da `https://` in poi, distruggendo
gli URL nei `source_url`. Solo trailing commas vengono rimosse.

### Audit log

Loggato in `fe_search_log` con `sources_used` (lista host dei chunk
grounding), `response` (raw + parsed), `selected_idx` (popolato dopo che
l'utente conferma il salvataggio).

`mark_fe_search_selected(log_id, selected_idx, saved_fe_id)` RPC aggiorna
la riga con il riferimento al FE effettivamente salvato.

## Sicurezza CORS

Tutte le 5 funzioni usano lo stesso pattern:

```ts
const allow = ALLOWED_ORIGINS.length === 0
  ? '*'                                                  // fallback dev
  : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
```

* Header `Access-Control-Allow-Origin` = uno specifico origin (non `*`)
* `Vary: Origin` per cache-aware
* OPTIONS preflight gestito separatamente
* Se ALLOWED_ORIGINS è popolato e l'origin del request non è in lista
  → HTTP 403

## Debug & log

Tutte le funzioni hanno `console.log` strategici:

```ts
console.log('[ai_assist] request', req.method, req.headers.get('Origin'));
console.log('[ai_assist] user:', u.user.email, 'role:', role);
console.log('[ai_assist] task:', task, 'model:', GEMINI_MODEL);
console.log('[ai_assist] Gemini status:', r.status);
console.log('[ai_assist] Gemini text preview:', text.slice(0, 500));
```

Visibili in Supabase Studio → Functions → Logs.

## Risorse

- [[Sicurezza]] — HMAC, MFA, defense-in-depth
- [[Audit-Trail]] — verify_audit_chain interactive vs scheduled
- [[Configurazione]] — secrets richiesti
