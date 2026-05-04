/* GHG Tool — test io.enrichForUpsert
 *
 * Bug storico: import "minimale" (solo Quantità+Combustibile, senza
 * Em_tCO2e) finiva nel DB con em=null → righe sparivano dagli aggre-
 * gati senza errore visibile. enrichForUpsert riempie l'em al commit
 * facendo lookupFE sul pool combinato (DB esistente + righe FE nello
 * stesso file di import).
 *
 * Questi test sentinella anti-regressione su quel fix.
 */
import { describe, test, expect } from './_runner.mjs';
import { loadSource, resetGHG } from './_load.mjs';

resetGHG();
loadSource('constants.js');   // serve per G.fmt referenziato in cima a io.jsx
loadSource('calc.js');        // io.jsx usa G.calc.lookupFE
loadSource('sanitize.js');
loadSource('io.jsx');
const enrich = globalThis.GHG.io.enrichForUpsert;

const fePool = [
  { FE_ID: 'FE_S1_METANO_2024', Codice_Voce: 'metano',
    Anno_Validità: 2024, Valore: 2.75, Unità: 'kgCO2e/kg' },
  { FE_ID: 'FE_S3_C1_CER',      Codice_Voce: 'argilla',
    Anno_Validità: 2024, Valore: 0.12, Unità: 'kgCO2e/kg' }
];

describe('enrichForUpsert — S1', () => {
  test('em mancante + Combustibile noto → em calcolato', () => {
    const rows = [{
      Codice_Sito: 'IANO', Anno: 2024, Categoria_S1: 'Stazionaria',
      Combustibile: 'metano', Quantità: 1000, Em_tCO2e: null
    }];
    const out = enrich('s1', rows, fePool);
    expect(out[0].Em_tCO2e).toBeCloseTo(1000 * 2.75 / 1000, 4); // 2.75 t
    expect(out[0].FE_Valore).toBe(2.75);
  });
  test('em già presente → NON sovrascritto (rispetta input utente)', () => {
    const rows = [{
      Codice_Sito: 'IANO', Anno: 2024, Combustibile: 'metano',
      Quantità: 1000, Em_tCO2e: 9.99
    }];
    const out = enrich('s1', rows, fePool);
    expect(out[0].Em_tCO2e).toBe(9.99);
  });
  test('em vuoto stringa → trattato come mancante e calcolato', () => {
    const rows = [{
      Codice_Sito: 'IANO', Anno: 2024, Combustibile: 'metano',
      Quantità: 1000, Em_tCO2e: ''
    }];
    const out = enrich('s1', rows, fePool);
    expect(out[0].Em_tCO2e).toBeCloseTo(2.75, 4);
  });
  test('Combustibile non in pool → em resta null (no crash)', () => {
    const rows = [{
      Codice_Sito: 'IANO', Anno: 2024, Combustibile: 'gpl',
      Quantità: 100, Em_tCO2e: null
    }];
    const out = enrich('s1', rows, fePool);
    expect(out[0].Em_tCO2e).toBeNull();
  });
});

describe('enrichForUpsert — S2', () => {
  test('em_loc/em_mkt mancanti + FE_Location/FE_Market presenti → calcolati', () => {
    const rows = [{
      Codice_Sito: 'IANO', Anno: 2024, Voce_S2: 'EE_Acquistata',
      Quantità: 100000, FE_Location: 0.355, FE_Market: 0.40,
      Em_Loc_tCO2e: null, Em_Mkt_tCO2e: null
    }];
    const out = enrich('s2', rows, fePool);
    expect(out[0].Em_Loc_tCO2e).toBeCloseTo(100000 * 0.355 / 1000, 4); // 35.5
    expect(out[0].Em_Mkt_tCO2e).toBeCloseTo(100000 * 0.40  / 1000, 4); // 40.0
  });
  test('FE_Market = 0 (GO) → em_mkt = 0 calcolato (non null)', () => {
    const rows = [{
      Codice_Sito: 'IANO', Anno: 2024, Voce_S2: 'EE_Acquistata_GO',
      Quantità: 100000, FE_Location: 0.355, FE_Market: 0,
      Em_Loc_tCO2e: null, Em_Mkt_tCO2e: null
    }];
    const out = enrich('s2', rows, fePool);
    expect(out[0].Em_Loc_tCO2e).toBeCloseTo(35.5, 4);
    expect(out[0].Em_Mkt_tCO2e).toBe(0);
  });
  test('em_loc già presente → NON sovrascritto', () => {
    const rows = [{
      Codice_Sito: 'IANO', Anno: 2024, Voce_S2: 'EE_Acquistata',
      Quantità: 100000, FE_Location: 0.355, Em_Loc_tCO2e: 99.9
    }];
    const out = enrich('s2', rows, fePool);
    expect(out[0].Em_Loc_tCO2e).toBe(99.9);
  });
});

describe('enrichForUpsert — S3', () => {
  test('em mancante + Codice_FE noto → em calcolato', () => {
    const rows = [{
      Categoria_S3: 1, Anno: 2024, Codice_FE: 'FE_S3_C1_CER',
      Quantità: 5000, Em_tCO2e: null
    }];
    const out = enrich('s3', rows, fePool);
    expect(out[0].Em_tCO2e).toBeCloseTo(5000 * 0.12 / 1000, 4); // 0.6
  });
  test('match anche su Codice_Voce (fallback id)', () => {
    const rows = [{
      Categoria_S3: 1, Anno: 2024, Codice_FE: 'argilla',
      Quantità: 1000, Em_tCO2e: null
    }];
    const out = enrich('s3', rows, fePool);
    expect(out[0].Em_tCO2e).toBeCloseTo(0.12, 4);
  });
});

describe('enrichForUpsert — fePool vuoto / null', () => {
  test('fePool null → ritorna le righe inalterate', () => {
    const rows = [{ Em_tCO2e: null, Quantità: 100 }];
    const out = enrich('s1', rows, null);
    expect(out).toBe(rows); // identità
  });
  test('fePool vuoto → em resta null (lookupFE fallisce)', () => {
    const rows = [{
      Codice_Sito: 'IANO', Anno: 2024, Combustibile: 'metano',
      Quantità: 1000, Em_tCO2e: null
    }];
    const out = enrich('s1', rows, []);
    expect(out[0].Em_tCO2e).toBeNull();
  });
});
