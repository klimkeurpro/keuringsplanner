// Regressietests voor de planner en de datumlogica.
// Draaien met:  node tests/planner.js
// Geen afhankelijkheden: app.js wordt in een nagebootste browser geladen.
//
// Elke test hier hoort bij een fout die echt is voorgekomen. Blijft er een
// rood, dan is er iets kapot dat eerder al een keer stuk was.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const APP = path.join(__dirname, '..', 'app.js');

let gefaald = 0;
function check(wat, waarde, verwacht) {
  const ok = JSON.stringify(waarde) === JSON.stringify(verwacht);
  if (!ok) gefaald++;
  console.log((ok ? '  ok   ' : '  FOUT ') + wat +
    (ok ? '' : '\n         kreeg: ' + JSON.stringify(waarde) + '\n         verwacht: ' + JSON.stringify(verwacht)));
}

// app.js laden met vandaag op een vaste datum, zodat de uitkomst niet van de
// kalender van de dag afhangt.
function laad(vandaag) {
  const sb = {
    console: { log() {}, error() {}, warn() {} },
    document: {
      addEventListener: () => {}, getElementById: () => null,
      querySelectorAll: () => [], querySelector: () => null,
      createElement: () => ({ classList: { add() {}, remove() {} }, style: {} }),
      body: { appendChild() {} },
    },
    window: {}, requestAnimationFrame: () => {}, setTimeout: () => {},
    crypto: { subtle: {} }, localStorage: { getItem: () => null, setItem: () => {} },
    navigator: { onLine: true },
    Date: class extends Date {
      constructor(...a) { if (!a.length) super(vandaag + 'T12:00:00'); else super(...a); }
    },
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(APP, 'utf8') +
    '\n;globalThis.__exp={state,buildCalendar,getWorkdays,getMondayOfWeek,capacityForDay,' +
    'feestdagNaam,getNLFeestdagenMetNaam,pasStatusDatumsAan,toDateStr,parseDate,todayStr};\n', sb);
  const e = sb.__exp;
  e.state.personeel = []; e.state.dagOverrides = []; e.state.afspraken = [];
  e.state.afwezigheden = []; e.state.archief = []; e.state.jobs = [];
  e.state.settings.template = { ma: 8, di: 8, wo: 8, do: 8, vr: 8 };
  return e;
}

function klus(extra) {
  return Object.assign({
    id: 1, klant: 'Test', geschatteUren: 4, opLocatie: false,
    heeftAfspraak: true, afspraakDatum: '', datumBinnen: '2026-01-01',
    status: 'ingepland', gestartOp: '', gekeurdOp: '', gearchiveerd: false,
  }, extra);
}

// Welke dagen krijgen uren toegewezen, en hoeveel.
function plan(e, vandaag, weken, jobs) {
  e.state.jobs = jobs;
  e.state.weeksToShow = weken;
  const days = e.getWorkdays(e.getMondayOfWeek(vandaag), weken);
  const cal = e.buildCalendar(jobs.concat(e.state.archief), days);
  const uit = {};
  days.forEach((d) => { if (cal[d].items.length) uit[d] = cal[d].usedHours; });
  return { cal, days, uit };
}

console.log('\n1. Datums worden lokaal omgezet, niet via UTC');
{
  const e = laad('2026-09-09');
  check('toDateStr(parseDate(x)) geeft x terug', e.toDateStr(e.parseDate('2026-09-09')), '2026-09-09');
  check('1 januari blijft 1 januari', e.toDateStr(new Date(2026, 0, 1)), '2026-01-01');
  check('25 december blijft 25 december', e.toDateStr(new Date(2026, 11, 25)), '2026-12-25');
}

console.log('\n2. Feestdagen: juiste datums en de lustrumregel');
{
  const e = laad('2026-09-09');
  const map = {};
  e.getNLFeestdagenMetNaam(2026).forEach((f) => { map[f.naam] = f.datum; });
  check('Nieuwjaarsdag 2026', map['Nieuwjaarsdag'], '2026-01-01');
  check('Goede Vrijdag 2026', map['Goede Vrijdag'], '2026-04-03');
  check('1e Paasdag 2026', map['1e Paasdag'], '2026-04-05');
  check('Koningsdag 2026', map['Koningsdag'], '2026-04-27');
  check('Hemelvaartsdag 2026', map['Hemelvaartsdag'], '2026-05-14');
  check('1e Kerstdag 2026', map['1e Kerstdag'], '2026-12-25');
  // 27 april 2025 is een zondag: Koningsdag schuift dan naar 26 april.
  const k25 = e.getNLFeestdagenMetNaam(2025).find((f) => f.naam === 'Koningsdag');
  check('Koningsdag schuift bij zondag', k25.datum, '2025-04-26');
  // Pasen valt altijd op zondag; snelle controle over vijftien jaar.
  let nietZondag = [];
  for (let j = 2026; j <= 2040; j++) {
    const p = e.getNLFeestdagenMetNaam(j).find((f) => f.naam === '1e Paasdag').datum;
    if (new Date(p + 'T12:00:00').getDay() !== 0) nietZondag.push(p);
  }
  check('Pasen valt 2026-2040 altijd op zondag', nietZondag, []);
}

console.log('\n3. Feestdagen tellen mee in de planning');
{
  const e = laad('2026-12-01');
  check('gewone donderdag', e.capacityForDay('2026-12-24'), 8);
  check('1e Kerstdag geeft geen capaciteit', e.capacityForDay('2026-12-25'), 0);
  check('Nieuwjaarsdag geeft geen capaciteit', e.capacityForDay('2027-01-01'), 0);
  check('Bevrijdingsdag is werkdag buiten lustrum', e.capacityForDay('2026-05-05'), 8);
  check('Bevrijdingsdag is vrij in een lustrumjaar', e.capacityForDay('2030-05-05'), 0);
  e.state.dagOverrides = [{ persoon_id: null, datum: '2026-12-25', capaciteit_override: 4 }];
  check('handmatige capaciteit gaat voor de feestdag', e.capacityForDay('2026-12-25'), 4);
}

console.log('\n4. Verstreken afleverdatum springt niet vooruit');
{
  const e = laad('2026-09-09');
  const verstreken = klus({ afspraakDatum: '2026-08-19', datumBinnen: '2026-08-12', opLocatie: true });
  // Eigen dag buiten beeld: hoort nergens in de kalender te staan.
  check('niet in het huidige venster', Object.keys(plan(e, '2026-09-09', 6, [verstreken]).uit), []);
  // Terugbladeren: dan staat hij op zijn eigen dag.
  const terug = plan(e, '2026-08-12', 2, [verstreken]);
  check('bij terugbladeren op de eigen dag', Object.keys(terug.uit), ['2026-08-19']);
}

console.log('\n5. In behandeling loopt leeg en duwt de rest niet vooruit');
{
  const grote = { geschatteUren: 24, afspraakDatum: '2026-09-18', datumBinnen: '2026-09-01',
    status: 'in_behandeling', gestartOp: '2026-09-07' };
  const kleine = { id: 2, klant: 'Klein', geschatteUren: 4, afspraakDatum: '2026-09-18', datumBinnen: '2026-09-01' };
  const achter = [];
  ['2026-09-07', '2026-09-08', '2026-09-09'].forEach((dag) => {
    const e = laad(dag);
    const r = plan(e, dag, 3, [klus(grote), klus(kleine)]);
    // Op welke dag staat de kleine klus?
    let waar = null;
    r.days.forEach((d) => { if (r.cal[d].items.some((it) => it.job.id === 2)) waar = waar || d; });
    achter.push(waar);
  });
  check('de klus erachter blijft alle drie de dagen liggen', achter,
    ['2026-09-10', '2026-09-10', '2026-09-10']);
}

console.log('\n6. Afleverdatum voorbij het venster wordt niet gedumpt');
{
  const e = laad('2026-12-01');
  e.state.settings.template = { ma: 6, di: 6, wo: 6, do: 6, vr: 6 };
  const ver = [
    klus({ id: 1, klant: 'Dirven', geschatteUren: 30, afspraakDatum: '2027-01-29', datumBinnen: '2026-11-20' }),
    klus({ id: 2, klant: 'j sloot', geschatteUren: 50, afspraakDatum: '2027-02-12', datumBinnen: '2026-11-20' }),
  ];
  const r = plan(e, '2026-12-01', 2, ver);
  const teveel = r.days.filter((d) => r.cal[d].usedHours > r.cal[d].capacity);
  check('geen enkele dag overboekt', teveel, []);
  check('laatste dag niet volgestort', r.cal['2026-12-11'].usedHours, 6);
}

console.log('\n7. Een afleverdatum die echt niet gehaald wordt, blijft gemeld');
{
  const e = laad('2026-12-01');
  e.state.settings.template = { ma: 6, di: 6, wo: 6, do: 6, vr: 6 };
  const haast = plan(e, '2026-12-01', 2,
    [klus({ klant: 'Haastklus', geschatteUren: 40, afspraakDatum: '2026-12-08', datumBinnen: '2026-11-20' })]);
  check('rood op de afleverdatum zelf',
    haast.cal['2026-12-08'].items.some((it) => it.overflow), true);

  const e2 = laad('2026-12-01');
  e2.state.settings.template = { ma: 6, di: 6, wo: 6, do: 6, vr: 6 };
  // Afleverdatum op zaterdag 5 dec: melden op de vrijdag ervoor.
  const za = plan(e2, '2026-12-01', 2,
    [klus({ klant: 'Zaterdag', geschatteUren: 40, afspraakDatum: '2026-12-05', datumBinnen: '2026-11-20' })]);
  check('afleverdatum in het weekend meldt op de vrijdag ervoor',
    za.cal['2026-12-04'].items.some((it) => it.overflow), true);
}

console.log('\n8. Terugblik telt op zijn eigen dag, op locatie kost geen werkplaatsuren');
{
  const e = laad('2026-09-09');
  e.state.archief = [
    klus({ id: 10, klant: 'Binnen', geschatteUren: 5, status: 'klaar', gekeurdOp: '2026-09-07',
      afspraakDatum: '2026-09-07', gearchiveerd: true }),
    klus({ id: 11, klant: 'Op locatie', geschatteUren: 5, status: 'klaar', gekeurdOp: '2026-09-08',
      afspraakDatum: '2026-09-08', opLocatie: true, gearchiveerd: true }),
  ];
  const r = plan(e, '2026-09-09', 1, []);
  check('gekeurd in de werkplaats vult zijn dag', r.cal['2026-09-07'].usedHours, 5);
  check('gekeurd op locatie kost geen werkplaatscapaciteit', r.cal['2026-09-08'].usedHours, 0);
  check('maar staat er wel', r.cal['2026-09-08'].items.length, 1);
}

console.log('\n9. Status zet de bijbehorende datums goed');
{
  const e = laad('2026-09-09');
  let j = { status: 'in_behandeling', gestartOp: '', gekeurdOp: '', gearchiveerd: false };
  e.pasStatusDatumsAan(j);
  check('In behandeling legt de startdag vast', j.gestartOp, '2026-09-09');
  j.status = 'klaar'; e.pasStatusDatumsAan(j);
  check('Klaar legt de keurdatum vast', j.gekeurdOp, '2026-09-09');
  j.gekeurdOp = '2026-08-31'; e.pasStatusDatumsAan(j);
  check('een handmatige keurdatum blijft staan', j.gekeurdOp, '2026-08-31');
  j.status = 'ingepland'; e.pasStatusDatumsAan(j);
  check('terug naar Ingepland wist start- en keurdatum', [j.gestartOp, j.gekeurdOp], ['', '']);
  const oud = { status: 'klaar', gestartOp: '', gekeurdOp: '', gearchiveerd: true };
  e.pasStatusDatumsAan(oud);
  check('op een archiefrij wordt geen datum verzonnen', oud.gekeurdOp, '');
}

console.log('\n' + (gefaald === 0 ? 'Alles goed.' : gefaald + ' test(s) MISLUKT.') + '\n');
process.exit(gefaald === 0 ? 0 : 1);
