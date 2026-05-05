/* GHG Tool — test redactPII (SupabaseDB.jsx)
 *
 * Sentinella anti-regressione su GDPR data minimization: i log degli
 * errori client NON devono contenere email, JWT, IBAN, codici fiscali
 * o numeri di telefono.
 *
 * SupabaseDB.jsx è caricato senza precompilare JSX perché redactPII è
 * definito in un blocco JS puro nella IIFE — la chiave è caricare
 * costanti.js prima per inizializzare G.fmt + COLORS, e fornire stub
 * minimi per `window.supabase`/document non usati da redactPII.
 */
import { describe, test, expect } from './_runner.mjs';
import { loadSource, resetGHG } from './_load.mjs';

resetGHG();
// Stub minimo: SupabaseDB.jsx top-level non tocca window.supabase
// se non chiamato il client; redactPII è una pure function isolata.
globalThis.window = globalThis;
globalThis.document = { /* placeholder */ };
loadSource('constants.js');
loadSource('calc.js');
// SupabaseDB.jsx non contiene JSX: lo carichiamo come JS puro
loadSource('SupabaseDB.jsx');

const redactPII = globalThis.GHG.db.redactPII;

describe('redactPII — sanitize before client_errors insert', () => {
  test('email standard → [email]', () => {
    const out = redactPII('Errore per marco.vacchi@gresmalt.it sul submit');
    expect(out.includes('marco.vacchi@gresmalt.it')).toBeFalsy();
    expect(out.includes('[email]')).toBeTruthy();
  });

  test('JWT in stack → [jwt]', () => {
    // Volutamente NON usiamo il prefisso eyJhbGciOiJIUzI1NiIs (header
    // HS256 reale) per non triggerare il secret scan in CI sul nostro
    // stesso file di test. redactPII matcha qualunque eyJ.*.*.* base64.
    const fake = 'eyJ0ZXN0Ijp0cnVlfQ.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxw_dummy_signature';
    const out = redactPII('Authorization: Bearer ' + fake);
    expect(out.includes('eyJ0ZXN0')).toBeFalsy();
    expect(out.includes('[jwt]') || out.includes('Bearer [redacted]')).toBeTruthy();
  });

  test('Bearer plain (non JWT) → Bearer [redacted]', () => {
    const out = redactPII('Bearer abcdef0123456789ABCDEF');
    expect(out.includes('Bearer [redacted]')).toBeTruthy();
  });

  test('IBAN italiano → [iban]', () => {
    const out = redactPII('IBAN IT60X0542811101000000123456 saldo errato');
    expect(out.includes('IT60X')).toBeFalsy();
    expect(out.includes('[iban]')).toBeTruthy();
  });

  test('Codice fiscale → [cf]', () => {
    const out = redactPII('cf RSSMRA80A01H501Z verifica fallita');
    expect(out.includes('RSSMRA80A01H501Z')).toBeFalsy();
    expect(out.includes('[cf]')).toBeTruthy();
  });

  test('telefono internazionale → [tel]', () => {
    const out = redactPII('chiamare +39 333 1234567');
    expect(out.includes('+39')).toBeFalsy();
    expect(out.includes('[tel]')).toBeTruthy();
  });

  test('null/empty → identity', () => {
    expect(redactPII(null)).toBeNull();
    expect(redactPII('')).toBe('');
    expect(redactPII('messaggio innocuo senza PII')).toBe('messaggio innocuo senza PII');
  });

  test('multipli pattern nello stesso messaggio', () => {
    const out = redactPII(
      'user a@b.it con jwt eyJ0ZXN0X1.payload.signature_dummy — IBAN IT60X0542811101000000123456'
    );
    expect(out.includes('a@b.it')).toBeFalsy();
    expect(out.includes('IT60X')).toBeFalsy();
    expect(out.match(/eyJ0ZXN0/)).toBeNull();
  });
});
