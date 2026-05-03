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

  // ───────────────────────────────────────────────────────────────────
  //  Piano di decarbonizzazione (Gresmalt — giugno 2024)
  //  Target ufficiali su Scope 1 + Scope 2 Market-based, allineati a
  //  SBTi 1,5°C / European Climate Law. Riferimento documentale:
  //  https://www.gresmalt.it/wp-content/uploads/2025/09/GRESMALT_PIANO_DI_DECARBONIZZAZIONE_2025_IT.pdf
  // ───────────────────────────────────────────────────────────────────
  const TARGETS = {
    scope:                  'Scope 1 + 2 Market-based',
    baselineYear:           2021,
    baseline_tco2e:         99816,
    baseline_intensity:     5.10,   // kgCO2e/m2
    shortTermYear:          2034,
    shortTerm_tco2e:        45576,
    shortTerm_intensity:    2.81,
    longTermYear:           2050,
    longTerm_tco2e:         9981,
    longTerm_intensity:     0.62,
    alignment:              'SBTi 1,5°C · European Climate Law · GHG Protocol · GRI'
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
      scope1Q:     'Cosa bruciamo (e cosa reagisce) nei nostri stabilimenti?',
      scope1Body:  'Gas naturale per i forni di cottura, gli essiccatori e il riscaldamento dei capannoni; gasolio e benzina per i mezzi aziendali; gas refrigeranti che possono fuoriuscire dagli impianti. A questi si aggiungono le emissioni di processo dei carbonati (CaCO₃, MgCO₃) contenuti nelle materie prime ceramiche, che durante la cottura rilasciano CO₂ per decarbonatazione.',
      scope2Title: 'Scope 2 · Elettricità acquistata',
      scope2Q:     'Quanta elettricità compriamo dalla rete?',
      scope2Body:  'L\'energia elettrica che acquistiamo per alimentare gli stabilimenti. La calcoliamo in due modi: Location-based (mix medio della rete elettrica italiana) e Market-based (contratti effettivi, comprese le Garanzie di Origine acquistate).',
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
      // Sezione Target
      targetsTitle:      'I nostri obiettivi',
      targetsIntro:      'Il Piano di Decarbonizzazione 2024 di Gresmalt fissa target di riduzione su {scope}, allineati alle linee guida Science Based Targets initiative (1,5 °C) e all\'European Climate Law.',
      targetsBaseline:   'Anno base {y}',
      targetsCurrent:    'Anno corrente ({y})',
      targetsShortTerm:  'Target {y}',
      targetsLongTerm:   'Vision {y}',
      targetsAbsolute:   'Emissioni assolute',
      targetsIntensity:  'Intensità',
      targetsVsBase:     'vs {y}',
      targetsAlign:      'Allineamento metodologico',
      targetsNotComp:    'non confrontabile',
      targetsNoData:     'dato anno corrente non disponibile',
      // Sezione Iniziative
      initiativesTitle:  'Le leve della decarbonizzazione',
      initiativesIntro:  'Il piano è organizzato in due fasi: azioni del piano strategico al 2034 e leve di lungo termine fino al 2050.',
      init2034:          'Piano 2034',
      init2050:          'Vision 2050',
      init1Title:        'Efficienza energetica',
      init1Body:         'Sostituzione integrale dei motori IE2 con motori IE4 ad alta efficienza; pompe di calore e caldaie a condensazione; recupero del calore nei forni industriali; relamping LED.',
      init2Title:        'Energia rinnovabile',
      init2Body:         'Quarto impianto fotovoltaico da 1,6 MWp in arrivo per arrivare a 4 MWp installati. Adozione di Garanzie di Origine (G.O.) sull\'elettricità acquistata.',
      init3Title:        'Ottimizzazione di processo',
      init3Body:         'Riprogettazione del processo orientata alla riduzione degli spessori delle piastrelle: meno materie prime, meno energia per m² prodotto, minor impatto della logistica.',
      init4Title:        'Elettrificazione di processo e logistica',
      init4Body:         'Sostituzione progressiva dei bruciatori a combustibile di forni e atomizzatori con tecnologie elettriche; flotte aziendali, carrelli elevatori e trattori elettrici.',
      init5Title:        'Sostituzione del gas metano',
      init5Body:         'Transizione progressiva dal gas metano a biocombustibili e gas rinnovabili, attraverso turbine, elettrolizzatori e bruciatori compatibili.',
      init6Title:        'Strumenti finanziari',
      init6Body:         'Garanzie di Origine (in attuazione), Power Purchase Agreement (PPA) per energia rinnovabile, compensazioni volontarie certificate, tecnologie CCUS sulla quota residua.',
      // Baseline & ricalcoli
      baselineTitle:     'Baseline e ricalcoli',
      baselineIntro:     'Come si misurano i progressi del piano, e quando si aggiorna il punto di partenza.',
      baselineYearLab:   'Anno base · 2021',
      baselineYearBody:  'Il 2021 è il primo anno con dati verificabili sull\'intero perimetro del Gruppo. Tutti gli obiettivi sono espressi rispetto a quell\'anno.',
      baselineRecalcLab: 'Soglia di ricalcolo · 5%',
      baselineRecalcBody:'La baseline viene ricalcolata in caso di variazioni significative — superiori al 5% delle emissioni totali — dovute a cambiamenti di perimetro, metodi di calcolo o approcci di consolidamento.',
      baselineFELab:     'Fattori di emissione',
      baselineFEBody:    'Combustibili: NIR, Ministero dell\'Ambiente, ETS, ISPRA (anni 2021–2024). Elettricità: AIB, Terna. Eventuali aggiornamenti dei fattori comportano ricalcolo dell\'inventario.',
      // Settore ceramico
      benchmarkTitle:    'Il contesto del settore ceramico',
      benchmarkBody:     'L\'industria ceramica europea è storicamente energivora ed è impegnata nell\'adozione di tecnologie avanzate ed energie rinnovabili per ridurre le proprie emissioni. In Italia il settore lavora su Scope 1 e 2 e gestisce le emissioni indirette lungo la filiera. Il piano Gresmalt segue queste tendenze allineandosi alle linee guida SBTi e al GHG Protocol.',
      // Disclaimer
      disclaimerTitle:   'Limiti e perimetro',
      disclaimerBody:    'I dati pubblicati sono validati internamente prima della pubblicazione e si riferiscono al perimetro di controllo operativo dei 7 siti del Gruppo. Possono essere aggiornati dopo la chiusura definitiva dell\'inventario annuale; variazioni dei fattori di emissione, del perimetro di consolidamento o dei metodi di calcolo possono comportare ricalcoli della baseline (soglia 5%). Per la rendicontazione completa, certificata e con metodologia ESRS si rimanda al Bilancio di Sostenibilità del Gruppo.',
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
      scope1Q:     'What do we burn (and what reacts) at our sites?',
      scope1Body:  'Natural gas for firing kilns, dryers and plant heating; diesel and gasoline for company vehicles; refrigerant gases that may leak from systems. On top of these, the carbonate process emissions: CaCO₃ and MgCO₃ in ceramic raw materials release CO₂ by decarbonation during firing.',
      scope2Title: 'Scope 2 · Purchased electricity',
      scope2Q:     'How much electricity do we buy from the grid?',
      scope2Body:  'The electricity we purchase to power our sites. Computed two ways: Location-based (Italian grid average mix) and Market-based (actual contracts, including the Guarantees of Origin we acquire).',
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
      // Targets section
      targetsTitle:      'Our targets',
      targetsIntro:      'Gresmalt\'s 2024 Decarbonization Plan sets reduction targets on {scope}, aligned with the Science Based Targets initiative (1.5 °C) and the European Climate Law.',
      targetsBaseline:   'Base year {y}',
      targetsCurrent:    'Current year ({y})',
      targetsShortTerm:  '{y} target',
      targetsLongTerm:   '{y} vision',
      targetsAbsolute:   'Absolute emissions',
      targetsIntensity:  'Intensity',
      targetsVsBase:     'vs {y}',
      targetsAlign:      'Methodological alignment',
      targetsNotComp:    'not comparable',
      targetsNoData:     'current-year data not available',
      // Initiatives
      initiativesTitle:  'Decarbonization levers',
      initiativesIntro:  'The plan is organised in two phases: actions of the strategic plan to 2034 and long-term levers up to 2050.',
      init2034:          '2034 plan',
      init2050:          '2050 vision',
      init1Title:        'Energy efficiency',
      init1Body:         'Full replacement of IE2 motors with high-efficiency IE4; heat pumps and condensing boilers; heat recovery from industrial kilns; LED relamping.',
      init2Title:        'Renewable energy',
      init2Body:         'Fourth photovoltaic plant of 1.6 MWp on the way to reach a total of 4 MWp installed. Adoption of Guarantees of Origin on purchased electricity.',
      init3Title:        'Process optimisation',
      init3Body:         'Process redesign aimed at reducing tile thickness: less raw material, less energy per m² of product, lower logistics impact.',
      init4Title:        'Process and logistics electrification',
      init4Body:         'Progressive replacement of fuel burners in kilns and atomisers with electric technologies; electric corporate fleets, forklifts and tractors.',
      init5Title:        'Replacing natural gas',
      init5Body:         'Progressive transition from natural gas to biofuels and renewable gases via turbines, electrolysers and compatible burners.',
      init6Title:        'Financial instruments',
      init6Body:         'Guarantees of Origin (already in place), Power Purchase Agreements (PPA) for renewable electricity, certified voluntary offsets, CCUS technologies on the residual share.',
      // Baseline & recalcs
      baselineTitle:     'Baseline and recalculations',
      baselineIntro:     'How progress against the plan is measured, and when the starting point is updated.',
      baselineYearLab:   'Base year · 2021',
      baselineYearBody:  '2021 is the first year with verifiable data over the entire Group perimeter. All targets are expressed relative to that year.',
      baselineRecalcLab: 'Recalculation threshold · 5%',
      baselineRecalcBody:'The baseline is recalculated upon significant changes — over 5% of total emissions — due to perimeter changes, calculation methods or consolidation approaches.',
      baselineFELab:     'Emission factors',
      baselineFEBody:    'Fuels: NIR, Ministry of the Environment, ETS, ISPRA (years 2021–2024). Electricity: AIB, Terna. Updates to factors trigger an inventory recalculation.',
      // Sector context
      benchmarkTitle:    'Ceramic-sector context',
      benchmarkBody:     'The European ceramic industry is historically energy-intensive and is committed to deploying advanced technologies and renewable energy to reduce emissions. In Italy the sector is acting on Scopes 1 and 2 and is managing indirect emissions along the value chain. The Gresmalt plan follows these trends in line with the SBTi and GHG Protocol.',
      // Disclaimer
      disclaimerTitle:   'Boundaries and limitations',
      disclaimerBody:    'Published data is internally validated before publication and refers to the operational-control perimeter of the Group\'s 7 sites. It may be updated after the annual inventory is finalised; changes in emission factors, consolidation perimeter or calculation methods may require a baseline recalculation (5% threshold). For complete certified reporting under the ESRS methodology, refer to the Group Sustainability Report.',
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
    can, EXPECTED_UNIT_S1, I18N, TARGETS
  });
})(typeof window !== 'undefined' ? window : globalThis);
