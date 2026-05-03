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
