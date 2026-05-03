/* GHG Tool — costanti condivise (palette ESG slate + cream)
 *
 * Esportato come oggetto globale `window.GHG` perché il bundle è
 * pre-compilato e inlined: niente sistema di moduli runtime.
 */
;(function (root) {
  'use strict';

  const COLORS = {
    // Brand
    brand:        '#2B2A2D',
    brandLight:   '#363A40',
    accent:       '#798A97',
    accentLight:  '#8B6F47',
    accentSoft:   '#EFEBE6',

    // Surface
    bg:           '#F6F6F6',
    card:         '#FFFFFF',
    cream:        '#EFEBE6',
    border:       '#E5E5E5',
    borderSoft:   '#EEF1F3',

    // Text
    text:         '#1F1E1F',
    textMid:      '#575656',
    textLow:      '#A6A6A6',
    inverse:      '#FFFFFF',

    // Functional (Scope)
    s1:           '#798A97',
    s2loc:        '#2B2A2D',
    s2mkt:        '#575656',
    s3:           '#8B6F47',

    // Semantic
    success:      '#2D7A4F',
    successPale:  '#E8F3EE',
    warning:      '#C7891F',
    warningPale:  '#FDF0E0',
    critical:     '#B23B3B',
    criticalPale: '#F7E6E6',
    info:         '#798A97',
    infoPale:     '#EEF1F3'
  };

  const CATEGORICAL = ['#2B2A2D','#798A97','#8B6F47','#5C7A6B','#A89888','#C7891F','#B23B3B'];

  const SITE_COLORS = {
    IANO:           '#2B2A2D',
    VIANO:          '#798A97',
    VIANO_GARGOLA:  '#8B6F47',
    FRASSINORO:     '#A89888',
    SASSUOLO:       '#575656',
    FIORANO:        '#5C7A6B',
    CASALGRANDE:    '#C7891F'
  };

  const ROLE_LABELS = {
    admin:   { color: '#2B2A2D', name: 'Admin'             },
    editor:  { color: '#798A97', name: 'Editor'            },
    auditor: { color: '#8B6F47', name: 'Auditor'           },
    viewer:  { color: '#575656', name: 'Viewer'            },
    guest:   { color: '#A6A6A6', name: 'Cliente / Pubblico' }
  };

  // Categorie Scope 3 (15)
  const CAT_NAMES = {
    1:  'Beni e servizi acquistati',
    2:  'Beni strumentali',
    3:  'Attività combustibili/energia',
    4:  'Trasporti upstream',
    5:  'Rifiuti operativi',
    6:  'Viaggi di lavoro',
    7:  'Pendolarismo dipendenti',
    8:  'Beni in leasing upstream',
    9:  'Trasporti downstream',
    10: 'Trasformazione prodotti venduti',
    11: 'Uso prodotti venduti',
    12: 'Fine vita prodotti',
    13: 'Beni in leasing downstream',
    14: 'Franchising',
    15: 'Investimenti'
  };

  // Famiglie FE
  const FAMIGLIE_FE = {
    'Combustibili': '#2B2A2D',
    'Elettricità':  '#798A97',
    'WTT':          '#8B6F47',
    'Materiali':    '#5C7A6B',
    'Trasporti':    '#C7891F',
    'Rifiuti':      '#B23B3B'
  };

  const QUALITY_BADGE = {
    P: { label: 'Primario',   color: '#2D7A4F', bg: '#E8F3EE' },
    S: { label: 'Secondario', color: '#C7891F', bg: '#FDF0E0' },
    E: { label: 'Stimato',    color: '#B23B3B', bg: '#F7E6E6' }
  };

  const STATUS_BADGE = {
    Definitivo:   { color: '#2D7A4F', bg: '#E8F3EE' },
    Provvisorio:  { color: '#C7891F', bg: '#FDF0E0' },
    Stimato:      { color: '#B23B3B', bg: '#F7E6E6' }
  };

  // Permessi per ruolo (matrice)
  const can = {
    edit:         r => ['admin','editor'].includes(r),
    delete:       r => r === 'admin',
    viewAudit:    r => ['admin','auditor'].includes(r),
    viewFE:       r => r !== 'guest' && r !== 'viewer',
    viewQuality:  r => r !== 'guest' && r !== 'viewer',
    viewMgmt:     r => ['admin','editor'].includes(r),
    viewInternal: r => r !== 'guest',
    viewDiag:     r => r === 'admin'
  };

  // Unità attese per categoria S1
  const EXPECTED_UNIT_S1 = {
    'Combustione_Stazionaria_Gas_Naturale': 'Sm3',
    'Combustione_Stazionaria_GPL':           'kg',
    'Combustione_Stazionaria_Gasolio':        'L',
    'Combustione_Stazionaria_Olio':          'kg',
    'Combustione_Mobile_Gasolio':             'L',
    'Combustione_Mobile_Benzina':             'L',
    'Fugitivi_F_Gas':                         'kg'
  };

  // Etichette i18n (PublicDashboard)
  const I18N = {
    it: {
      title: 'Sustainability Report',
      subtitle: 'Inventario {year} · GHG Protocol Corporate Standard',
      lastUpdate: 'Dati validati internamente — ultimo aggiornamento {date}',
      heroTitle: 'Le emissioni del Gruppo Ceramiche Gresmalt',
      kpiTotal: 'Totale emissioni anno',
      kpiTotalSub: 'Scope 1 + 2 LB + 3',
      kpiDelta: 'Variazione vs anno precedente',
      kpiDeltaSub: 'rispetto a {year}',
      kpiGO: 'Energia rinnovabile certificata',
      kpiGOSub: 'Garanzie di Origine',
      kpiIntensity: 'Intensità carbon',
      kpiIntensitySub: 'intensità per unità di prodotto',
      donut: 'Composizione delle emissioni',
      trend: 'Trend ultimi 5 anni',
      methodTitle: 'Come abbiamo calcolato questi numeri',
      methodStandard: 'Standard adottato: GHG Protocol Corporate',
      methodBoundary: 'Boundary: controllo operativo, 7 siti del gruppo',
      methodFE: 'Fattori emissivi: ISPRA, AIB, DEFRA, ecoinvent',
      methodIncluded: 'Categorie Scope 3 incluse:',
      methodExcluded: 'Categorie escluse:',
      methodIntensity: 'Denominatori intensità: m² e kg di prodotto finito',
      materialityTitle: 'Materialità Scope 3 — 15 categorie',
      footerDisclaimer: 'Pagina pubblica di trasparenza. I dati sono aggiornati annualmente dopo la chiusura dell\'inventario.',
      downloadPDF: 'Scarica report PDF',
      operatorAccess: 'Accesso operatori →',
      yearLabel: 'Anno',
      mat: { Inclusa:'Inclusa', Esclusa:'Esclusa', 'N.A.':'N.A.', 'Da valutare':'Da valutare' },
      // Sezione "Cosa rendicontiamo" — spiegazione Scope 1/2/3
      scopesTitle: 'Cosa rendicontiamo',
      scopesIntro: 'Le emissioni di gas serra sono raggruppate in tre "Scope" (ambiti) secondo lo standard GHG Protocol. Ogni Scope risponde a una domanda diversa.',
      scope1Title: 'Scope 1 · Emissioni dirette',
      scope1Q:     'Cosa bruciamo direttamente?',
      scope1Body:  'Combustibili usati nei nostri stabilimenti: gas naturale per i forni di cottura, gasolio per i mezzi aziendali, gas refrigeranti che possono fuoriuscire dagli impianti.',
      scope2Title: 'Scope 2 · Energia acquistata',
      scope2Q:     'Quanta energia compriamo?',
      scope2Body:  'Elettricità (e calore) acquistata dalla rete. Calcolata in due modi: Location-based (mix di rete italiano) e Market-based (contratti reali, comprese le Garanzie di Origine).',
      scope3Title: 'Scope 3 · Catena del valore',
      scope3Q:     'Cosa succede a monte e a valle?',
      scope3Body:  'Tutto il resto: materie prime, smalti, packaging, trasporto dei prodotti finiti, viaggi di lavoro, pendolarismo dei dipendenti, fine vita delle piastrelle.',
      // Glossario
      glossaryTitle: 'Termini chiave',
      glossaryTCO2e: 'tCO₂e — tonnellate di CO₂ equivalente. Una unità di misura che converte tutti i gas serra in "quante tonnellate di CO₂ avrebbero lo stesso effetto sul clima". Un volo Roma–New York di un passeggero ≈ 1 tCO₂e.',
      glossaryGO:    'GO (Garanzia di Origine) — certificato emesso dal GSE che attesta la provenienza 100% rinnovabile dell\'elettricità acquistata. Un\'azienda con 100% GO consuma elettricità che è stata, di fatto, generata da fonti rinnovabili.',
      glossaryIntensity: 'Intensità carbon — emissioni divise per la produzione (kg o m²). Indica quanto è "pulita" un\'unità di prodotto, indipendentemente dai volumi. Utile per confrontare anni con produzioni diverse.',
      glossaryLocMb: 'Location-based vs Market-based — due modi di calcolare lo Scope 2. Il primo usa il mix medio della rete elettrica nazionale; il secondo i contratti effettivi (rilevante quando si acquistano Garanzie di Origine).',
      // Materialità — legenda statuti
      materialityIntro:  'Per ciascuna delle 15 categorie di Scope 3 abbiamo valutato la rilevanza per il nostro business.',
      matLegInclusa:     'rendicontata nell\'inventario',
      matLegEsclusa:     'non rilevante per il settore',
      matLegNA:          'non applicabile al business',
      matLegDaValutare:  'in revisione per il prossimo ciclo',
      catNames: {
        1:  'Beni e servizi acquistati',
        2:  'Beni strumentali',
        3:  'Attività combustibili/energia',
        4:  'Trasporti upstream',
        5:  'Rifiuti operativi',
        6:  'Viaggi di lavoro',
        7:  'Pendolarismo dipendenti',
        8:  'Beni in leasing upstream',
        9:  'Trasporti downstream',
        10: 'Trasformazione prodotti venduti',
        11: 'Uso prodotti venduti',
        12: 'Fine vita prodotti',
        13: 'Beni in leasing downstream',
        14: 'Franchising',
        15: 'Investimenti'
      }
    },
    en: {
      title: 'Sustainability Report',
      subtitle: '{year} inventory · GHG Protocol Corporate Standard',
      lastUpdate: 'Internally validated — last updated {date}',
      heroTitle: 'Greenhouse-gas emissions of Gruppo Ceramiche Gresmalt',
      kpiTotal: 'Total annual emissions',
      kpiTotalSub: 'Scope 1 + 2 LB + 3',
      kpiDelta: 'Year-on-year change',
      kpiDeltaSub: 'compared to {year}',
      kpiGO: 'Certified renewable electricity',
      kpiGOSub: 'Guarantees of Origin',
      kpiIntensity: 'Carbon intensity',
      kpiIntensitySub: 'intensity per unit of product',
      donut: 'Emissions composition',
      trend: 'Five-year trend',
      methodTitle: 'How we calculated these numbers',
      methodStandard: 'Standard: GHG Protocol Corporate',
      methodBoundary: 'Boundary: operational control, 7 group sites',
      methodFE: 'Emission factors: ISPRA, AIB, DEFRA, ecoinvent',
      methodIncluded: 'Scope 3 categories included:',
      methodExcluded: 'Excluded categories:',
      methodIntensity: 'Intensity denominators: m² and kg of finished product',
      materialityTitle: 'Scope 3 Materiality — 15 categories',
      footerDisclaimer: 'Public transparency page. Data is updated yearly after inventory closure.',
      downloadPDF: 'Download PDF report',
      operatorAccess: 'Operator login →',
      yearLabel: 'Year',
      mat: { Inclusa:'Included', Esclusa:'Excluded', 'N.A.':'N/A', 'Da valutare':'To evaluate' },
      // "What we report" — Scope 1/2/3 explanation
      scopesTitle: 'What we report',
      scopesIntro: 'Greenhouse-gas emissions are grouped into three "Scopes" under the GHG Protocol standard. Each Scope answers a different question.',
      scope1Title: 'Scope 1 · Direct emissions',
      scope1Q:     'What do we burn directly?',
      scope1Body:  'Fuels burned at our sites: natural gas for kilns, diesel for company vehicles, refrigerant gases that may leak from systems.',
      scope2Title: 'Scope 2 · Purchased energy',
      scope2Q:     'How much energy do we buy?',
      scope2Body:  'Electricity (and heat) purchased from the grid. Computed two ways: Location-based (Italian grid mix) and Market-based (actual contracts, including Guarantees of Origin).',
      scope3Title: 'Scope 3 · Value chain',
      scope3Q:     'What happens upstream and downstream?',
      scope3Body:  'Everything else: raw materials, glazes, packaging, transport of finished tiles, business travel, employee commuting, end-of-life of products.',
      // Glossary
      glossaryTitle: 'Key terms',
      glossaryTCO2e: 'tCO₂e — tonnes of CO₂ equivalent. A unit converting all greenhouse gases into "how many tonnes of CO₂ would have the same climate effect". A Rome–New York flight per passenger ≈ 1 tCO₂e.',
      glossaryGO:    'GO (Guarantee of Origin) — certificate proving the 100 % renewable origin of purchased electricity. A company at 100 % GO consumes electricity that was, in fact, generated from renewable sources.',
      glossaryIntensity: 'Carbon intensity — emissions divided by production (kg or m²). Shows how "clean" a unit of product is regardless of volumes. Useful to compare years with different production.',
      glossaryLocMb: 'Location-based vs Market-based — two ways to compute Scope 2. The first uses the average national grid mix; the second uses actual contracts (relevant when Guarantees of Origin are purchased).',
      // Materiality legend
      materialityIntro:  'For each of the 15 Scope 3 categories we assessed relevance for our business.',
      matLegInclusa:     'reported in the inventory',
      matLegEsclusa:     'not material for the sector',
      matLegNA:          'does not apply to our business',
      matLegDaValutare:  'under review for the next cycle',
      // Nomi GHG Protocol Scope 3 ufficiali (Corporate Value Chain Standard).
      catNames: {
        1:  'Purchased goods and services',
        2:  'Capital goods',
        3:  'Fuel- and energy-related activities',
        4:  'Upstream transportation and distribution',
        5:  'Waste generated in operations',
        6:  'Business travel',
        7:  'Employee commuting',
        8:  'Upstream leased assets',
        9:  'Downstream transportation and distribution',
        10: 'Processing of sold products',
        11: 'Use of sold products',
        12: 'End-of-life treatment of sold products',
        13: 'Downstream leased assets',
        14: 'Franchises',
        15: 'Investments'
      }
    }
  };

  root.GHG = root.GHG || {};
  Object.assign(root.GHG, {
    COLORS, CATEGORICAL, SITE_COLORS, ROLE_LABELS,
    CAT_NAMES, FAMIGLIE_FE, QUALITY_BADGE, STATUS_BADGE,
    can, EXPECTED_UNIT_S1, I18N
  });
})(typeof window !== 'undefined' ? window : globalThis);
