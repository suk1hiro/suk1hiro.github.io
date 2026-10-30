/* Static verification for craft-checkin/styles.css (jsdom). */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('E:\\workspace\\paint\\.audit\\node_modules\\jsdom');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cssClasses = new Set();
css.replace(/\.(-?[_a-zA-Z][\w-]*)/g, (m, c) => { cssClasses.add(c); return m; });

function collectClasses(document) {
  const set = new Set();
  document.querySelectorAll('*').forEach((el) => {
    if (el.classList) el.classList.forEach((c) => set.add(c));
  });
  return set;
}

async function load(query) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  const url = 'file:///' + INDEX.replace(/\\/g, '/') + '?' + query;
  const dom = await JSDOM.fromFile(INDEX, {
    url, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc
  });
  await sleep(1300);
  return { dom, errors };
}

(async () => {
  const queries = [
    'demo=1&reset=1&now=2026-10-24T21:50&static=1',
    'demo=1&reset=1&now=2026-10-24T21:50&static=1&view=fire',
    'demo=1&reset=1&now=2026-10-24T21:50&static=1&view=tasks',
    'demo=1&reset=1&now=2026-10-24T21:50&static=1&modal=add',
    'demo=1&reset=1&now=2026-10-24T21:50&static=1&state=frozen',
    'demo=1&reset=1&now=2026-10-24T21:50&static=1&state=out',
    'demo=1&reset=1&now=2026-10-24T21:50&static=1&theme=light',
    'reset=1&now=2026-10-24T21:50&static=1'
  ];
  const allMissing = new Set();
  const allErrors = [];
  for (const q of queries) {
    let out;
    try {
      const { dom, errors } = await load(q);
      const d = dom.window.document;
      const found = collectClasses(d);
      const missing = [...found].filter((c) => !cssClasses.has(c)).sort();
      missing.forEach((c) => allMissing.add(c));
      out = {
        label: q,
        errors,
        heroState: d.getElementById('hero') && d.getElementById('hero').dataset.state,
        craftSlots: d.querySelectorAll('#craftGrid .craft-slot').length,
        craftFilled: d.querySelectorAll('#craftGrid .craft-slot.is-filled').length,
        pageSlots: d.querySelectorAll('#craftPageGrid .craft-slot').length,
        result: (d.getElementById('craftResultItem') || {}).textContent,
        outputReady: !!(d.querySelector('.craft-output.is-ready')),
        tasks: d.querySelectorAll('.task-row').length,
        groups: d.querySelectorAll('.task-group').length,
        heatCells: d.querySelectorAll('.heat-cell').length,
        weekBars: d.querySelectorAll('.week-bar').length,
        recipe: d.querySelectorAll('.recipe-item').length,
        materials: d.querySelectorAll('.material-select').length,
        libraryRows: d.querySelectorAll('.library-row').length,
        hiddenViews: ['view-today', 'view-tasks', 'view-fire'].map((id) => {
          const el = d.getElementById(id);
          return id + ':' + (el.hidden ? 'hidden' : 'shown');
        }),
        missing
      };
      allErrors.push(...errors);
      dom.window.close();
    } catch (e) {
      out = { label: q, fatal: String((e && e.stack) || e) };
    }
    console.log(JSON.stringify(out, null, 2));
  }
  console.log('\n=== CLASSES IN DOM BUT NOT IN styles.css ===');
  console.log(JSON.stringify([...allMissing].sort(), null, 2));
  const cssErrors = allErrors.filter((e) => /CSS|stylesheet/i.test(e));
  console.log('\n=== CSS PARSE ERRORS ===');
  console.log(cssErrors.length ? cssErrors.join('\n') : 'none');
  const jsErrors = allErrors.filter((e) => !/CSS|stylesheet/i.test(e));
  console.log('\n=== JS / OTHER ERRORS ===');
  console.log(jsErrors.length ? jsErrors.join('\n') : 'none');
  console.log('\nCSS chars:', css.length, 'bytes:', Buffer.byteLength(css));
  process.exit(0);
})();
