/* GHG Tool — test calc.js
 *
 * Copre: emS1/S2/S3, num, lookupFE (esatto + fallback ±1/±2/>2 anni),
 * validateRow (s1/s2/s3/produzione/fe), intensity, intensityPerSite
 * (LB e MB), totals (filtro per sito + S3 organizzativo), availableYears.
 *
 * Le formule emissione sono il cuore del tool: un bug qui falsa i numeri
 * ESG senza errori visibili. Test = sentinella anti-regressione.
 */
import { describe, test, expect } from './_runner.mjs';
import { loadSource, resetGHG } from './_load.mjs';

resetGHG();
loadSource('calc.js');
const calc = globalThis.GHG.calc;

describe('calc.num — parsing resiliente', () => {
  test('null/undefined/empty → 0', () => {
    expect(calc.num(null)).toBe(0);
    expect(calc.num(undefined)).toBe(0);
    expect(calc.num('')).toBe(0);
  });
  test('numero passa pulito', () => {
    expect(calc.num(42)).toBe(42);
    expect(calc.num(-3.14)).toBe(-3.14);
  });
  test('virgola decimale italiana', () => {
    expect(calc.num('1234,56')).toBe(1234.56);
  });
  test('NaN/Infinity → 0', () => {
    expect(calc.num(NaN)).toBe(0);
    expect(calc.num(Infinity)).toBe(0);
    expect(calc.num('boh')).toBe(0);
  });
});

describe('calc.emS1 / emS2 / emS3 — formule', () => {
  // Tutte le formule: em_tCO2e = quantità × FE / 1000
  // (FE in kgCO₂e/unità → ÷ 1000 per ottenere tCO₂e)
  test('emS1: 1000 kg metano × 2.75 kgCO₂e/kg = 2.75 tCO₂e', () => {
    expect(calc.emS1(1000, 2.75)).toBeCloseTo(2.75, 4);
  });
  test('emS2Loc: 100 000 kWh × 0.355 = 35.5 tCO₂e', () => {
    expect(calc.emS2Loc(100000, 0.355)).toBeCloseTo(35.5, 4);
  });
  test('emS2Mkt: GO al 100% → FE_Market = 0 → emissione = 0', () => {
    expect(calc.emS2Mkt(50000, 0)).toBe(0);
  });
  test('emS3: stringa con virgola decimale "1234,5" + FE 1.2', () => {
    // num() fa solo replace ","→"." (no strip separatore migliaia):
    // "1234,5" → 1234.5; "1.000,5" sarebbe 1.0 (parseFloat si ferma al
    // 2° punto). Il template Excel non usa separatore migliaia.
    expect(calc.emS3('1234,5', 1.2)).toBeCloseTo(1234.5 * 1.2 / 1000, 6);
  });
});

describe('calc.lookupFE — match esatto + fallback', () => {
  const feS1 = [
    { Codice_Voce: 'metano', Anno_Validità: 2024, Valore: 2.75 },
    { Codice_Voce: 'metano', Anno_Validità: 2023, Valore: 2.70 },
    { Codice_Voce: 'metano', Anno_Validità: 2020, Valore: 2.60 }
  ];
  test('match esatto su anno', () => {
    const r = calc.lookupFE('s1', { Combustibile: 'metano', Anno: 2024 }, feS1);
    expect(r.fe.Valore).toBe(2.75);
    expect(r.warn).toBe(undefined);
    expect(r.err).toBe(undefined);
  });
  test('fallback Δ=1 anno → ok senza warn', () => {
    // 2025 mancante → fallback al più recente (2024), Δ=1
    const r = calc.lookupFE('s1', { Combustibile: 'metano', Anno: 2025 }, feS1);
    expect(r.fe.Anno_Validità).toBe(2024);
    expect(r.warn).toBe(undefined);
  });
  test('fallback Δ=2 anni → warn ma valido', () => {
    // 2026 → fallback 2024, Δ=2
    const r = calc.lookupFE('s1', { Combustibile: 'metano', Anno: 2026 }, feS1);
    expect(r.fe.Anno_Validità).toBe(2024);
    expect(typeof r.warn).toBe('string');
    expect(r.err).toBe(undefined);
  });
  test('fallback Δ>2 anni → err (FE troppo vecchio)', () => {
    // 2027 → fallback 2024, Δ=3
    const r = calc.lookupFE('s1', { Combustibile: 'metano', Anno: 2027 }, feS1);
    expect(typeof r.err).toBe('string');
  });
  test('codice non trovato → err', () => {
    const r = calc.lookupFE('s1', { Combustibile: 'gpl', Anno: 2024 }, feS1);
    expect(r.fe).toBeNull();
    expect(r.err).toBe('FE non trovato');
  });
  test('FE pool vuoto → err', () => {
    const r = calc.lookupFE('s1', { Combustibile: 'metano', Anno: 2024 }, []);
    expect(r.err).toBe('FE non disponibili');
  });
  test('s3: match su FE_ID o Codice_Voce', () => {
    const feS3 = [
      { FE_ID: 'S3_C1_CER', Codice_Voce: 'argilla', Anno_Validità: 2024, Valore: 0.12 }
    ];
    const r = calc.lookupFE('s3', { Codice_FE: 'S3_C1_CER', Anno: 2024 }, feS3);
    expect(r.fe.Valore).toBe(0.12);
  });
});

describe('calc.validateRow — s1', () => {
  test('riga valida → no errors', () => {
    const v = calc.validateRow('s1', {
      Codice_Sito: 'IANO', Anno: 2024, Categoria_S1: 'Stazionaria', Quantità: 1000
    });
    expect(v.errors).toHaveLength(0);
  });
  test('campi mancanti → 3 errori', () => {
    const v = calc.validateRow('s1', { Quantità: 100 });
    expect(v.errors).toHaveLength(3); // sito, anno, categoria
  });
  test('quantità negativa → error', () => {
    const v = calc.validateRow('s1', {
      Codice_Sito: 'IANO', Anno: 2024, Categoria_S1: 'X', Quantità: -5
    });
    expect(v.errors).toContain('Quantità negativa');
  });
  test('chiavi DB snake_case funzionano (resilienza naming)', () => {
    const v = calc.validateRow('s1', {
      codice_sito: 'IANO', anno: 2024, categoria_s1: 'Stazionaria', quantita: 100
    });
    expect(v.errors).toHaveLength(0);
  });
});

describe('calc.validateRow — s2', () => {
  test('FE Location fuori range → warning', () => {
    const v = calc.validateRow('s2', {
      Codice_Sito: 'IANO', Anno: 2024, Voce_S2: 'EE_Acquistata',
      Quantità: 1000, FE_Location: 0.95 // > 0.60
    });
    expect(v.warnings.length > 0).toBeTruthy();
  });
  test('GO con FE_Market > 0 → warning classificazione', () => {
    const v = calc.validateRow('s2', {
      Codice_Sito: 'IANO', Anno: 2024, Voce_S2: 'EE_Acquistata_GO',
      Quantità: 1000, FE_Market: 0.3
    });
    expect(v.warnings.some(w => w.includes('GO'))).toBeTruthy();
  });
});

describe('calc.validateRow — s3', () => {
  test('categoria S3 fuori [1,15] → error', () => {
    const v0 = calc.validateRow('s3', { Categoria_S3: 0, Anno: 2024 });
    const v16 = calc.validateRow('s3', { Categoria_S3: 16, Anno: 2024 });
    expect(v0.errors).toContain('Categoria S3 ∈ [1,15]');
    expect(v16.errors).toContain('Categoria S3 ∈ [1,15]');
  });
  test('cat 1..15 valide', () => {
    for (let c = 1; c <= 15; c++) {
      const v = calc.validateRow('s3', { Categoria_S3: c, Anno: 2024, Quantità: 1 });
      expect(v.errors).toHaveLength(0);
    }
  });
});

describe('calc.validateRow — produzione', () => {
  test('kg=0 e m²=0 → error', () => {
    const v = calc.validateRow('produzione', {
      Codice_Sito: 'IANO', Anno: 2024, Produzione_kg: 0, Produzione_m2: 0
    });
    expect(v.errors).toContain('Almeno uno tra kg e m² deve essere > 0');
  });
  test('kg presente, m² no → warning intensità', () => {
    const v = calc.validateRow('produzione', {
      Codice_Sito: 'IANO', Anno: 2024, Produzione_kg: 1000, Produzione_m2: 0
    });
    expect(v.warnings.some(w => w.includes('m²'))).toBeTruthy();
  });
});

describe('calc.intensity — gruppo', () => {
  test('em=100 t, kg=200000, m²=10000 → 0.5 kg/kg, 10 kg/m²', () => {
    const it = calc.intensity({ em_total_tco2e: 100 }, { kg: 200000, m2: 10000 });
    expect(it.perKg).toBeCloseTo(0.5, 6);
    expect(it.perM2).toBeCloseTo(10, 6);
  });
  test('produzione mancante → null (no NaN, no Infinity)', () => {
    const it = calc.intensity({ em_total_tco2e: 100 }, { kg: 0, m2: 0 });
    expect(it.perKg).toBeNull();
    expect(it.perM2).toBeNull();
  });
});

describe('calc.intensityPerSite — LB vs MB', () => {
  const s1 = [{ Em_tCO2e: 50 }];
  const s2 = [{ Em_Loc_tCO2e: 30, Em_Mkt_tCO2e: 5 }]; // GO → MB ≈ 0
  const prod = { Produzione_m2: 8000, Produzione_kg: 100000 };
  test('default LB: em totale = 50+30 = 80 t', () => {
    const it = calc.intensityPerSite(s1, s2, prod);
    expect(it.em_total_tco2e).toBe(80);
    expect(it.perM2).toBeCloseTo(80 * 1000 / 8000, 4); // 10 kg/m²
  });
  test('opts.s2Method=mb: em = 50+5 = 55 t', () => {
    const it = calc.intensityPerSite(s1, s2, prod, { s2Method: 'mb' });
    expect(it.em_total_tco2e).toBe(55);
    expect(it.perM2).toBeCloseTo(55 * 1000 / 8000, 4); // 6.875
  });
  test('chiavi snake_case (DB) funzionano', () => {
    const s1L = [{ em_tco2e: 50 }];
    const s2L = [{ em_loc_tco2e: 30, em_mkt_tco2e: 5 }];
    const it = calc.intensityPerSite(s1L, s2L, { produzione_m2: 8000 });
    expect(it.em_total_tco2e).toBe(80);
  });
});

describe('calc.totals — aggregazione + filtro per sito', () => {
  const s1 = [
    { Anno: 2024, Codice_Sito: 'IANO',  Em_tCO2e: 100 },
    { Anno: 2024, Codice_Sito: 'VIANO', Em_tCO2e: 50 },
    { Anno: 2023, Codice_Sito: 'IANO',  Em_tCO2e: 90 }
  ];
  const s2 = [
    { Anno: 2024, Codice_Sito: 'IANO', Em_Loc_tCO2e: 20, Em_Mkt_tCO2e: 0 }
  ];
  const s3 = [
    { Anno: 2024, Em_tCO2e: 200 },
    { Anno: 2023, Em_tCO2e: 180 }
  ];

  test('anno 2024 senza filtro → s1=150, s2lb=20, s2mb=0, s3=200', () => {
    const t = calc.totals(2024, s1, s2, s3);
    expect(t.s1).toBe(150);
    expect(t.s2lb).toBe(20);
    expect(t.s2mb).toBe(0);
    expect(t.s3).toBe(200);
    expect(t.em_total_tco2e).toBe(370); // 150+20+200
  });
  test('filtro per sito IANO → s3=0 (organizzativo)', () => {
    const t = calc.totals(2024, s1, s2, s3, { site: 'IANO' });
    expect(t.s1).toBe(100);
    expect(t.s2lb).toBe(20);
    expect(t.s3).toBe(0); // mai distribuito per sito
    expect(t.em_total_tco2e).toBe(120);
  });
  test('filtro per sito sconosciuto → tutto 0', () => {
    const t = calc.totals(2024, s1, s2, s3, { site: 'INESISTENTE' });
    expect(t.s1).toBe(0);
    expect(t.s2lb).toBe(0);
  });
  test('em_total_tco2e usa LB (default GHG Protocol storico)', () => {
    // Sanity: LB è il default per il "totale" ai fini intensity etc.
    const t = calc.totals(2024, [], [{ Anno: 2024, Em_Loc_tCO2e: 100, Em_Mkt_tCO2e: 50 }], []);
    expect(t.em_total_tco2e).toBe(100); // = s2lb
  });
});

describe('calc.availableYears — desc + dedup + skip null', () => {
  test('combina anni da più array, dedup, sort desc', () => {
    const a1 = [{ Anno: 2024 }, { Anno: 2023 }];
    const a2 = [{ anno: 2024 }, { Anno: 2025 }];
    const a3 = [{ Anno: null }, { Anno: 'boh' }];
    expect(calc.availableYears(a1, a2, a3)).toEqual([2025, 2024, 2023]);
  });
  test('input vuoti → []', () => {
    expect(calc.availableYears()).toEqual([]);
    expect(calc.availableYears(null, undefined, [])).toEqual([]);
  });
});

// ─── Verifiche numeriche cross-modulo (anti-greenwashing) ────────────
// Riprodotti i numeri del Piano di Decarbonizzazione per validare il
// calcolo end-to-end (non solo le formule isolate).
describe('verifica numerica · scenario Piano Decarb', () => {
  // 1000 kg gas naturale × FE 2.018 kgCO₂e/kg = 2.018 tCO₂e
  test('S1 stazionaria: 1000 kg gas × 2.018 → 2.018 tCO₂e', () => {
    expect(calc.emS1(1000, 2.018)).toBeCloseTo(2.018, 4);
  });
  // 50000 kWh × FE 0.355 (mix Italia 2023) = 17.75 tCO₂e LB
  test('S2 location: 50 000 kWh × 0.355 → 17.75 tCO₂e', () => {
    expect(calc.emS2Loc(50000, 0.355)).toBeCloseTo(17.75, 4);
  });
  // 100% GO → FE_Market = 0 → S2 MB = 0
  test('S2 market 100% GO: FE=0 → 0 tCO₂e', () => {
    expect(calc.emS2Mkt(50000, 0)).toBe(0);
  });
});
