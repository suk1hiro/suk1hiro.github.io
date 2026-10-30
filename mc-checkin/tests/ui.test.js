'use strict';

/**
 * 方块清单 · Craft Check-in — jsdom UI 回归测试（qa-dev）
 *
 * 运行：
 *   powershell -NoProfile -ExecutionPolicy Bypass -File tests/run-ui.ps1
 * 或：
 *   $env:NODE_PATH='E:\workspace\paint\.audit\node_modules'
 *   & '<node.exe>' tests/ui.test.js
 *
 * 说明（测试环境限制，不判 app 失败）：
 *   jsdom 在 file:// 下 origin 为 opaque，window.localStorage 会抛 SecurityError。
 *   真实 Chrome/Edge 允许 file:// 页面使用 localStorage（本应用目标场景），
 *   因此这里在 beforeParse 中用内存实现替代 localStorage（键 craftCheckin.v1），
 *   以验证 app 的持久化/提醒去重/主题保存逻辑。app 自身对 localStorage 异常已有 try/catch 守卫。
 *   app.js 里 requestAnimationFrame 需要 pretendToBeVisual:true。
 *   styles.css 可能正由 visual-dev 重写（当前为占位），CSS 规则覆盖只记录、不判失败。
 */

const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const INDEX_FILE = path.join(PROJECT_ROOT, 'index.html');
const STYLES_FILE = path.join(PROJECT_ROOT, 'styles.css');
const STORAGE_KEY = 'craftCheckin.v1';
const FILE_URL = 'file:///E:/workspace/paint/craft-checkin/index.html';
const NOW = '2026-10-24T21:50';
const TODAY = '2026-10-24';
const DEMO_QUERY = 'demo=1&reset=1&now=' + NOW + '&static=1';
const FORBIDDEN_THEME_WORDS = /火苗|火焰|燃烧|冻结|熄灭|燃料/;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* 基础设施                                                            */
/* ------------------------------------------------------------------ */

function createMemoryStorage(initialRaw) {
  const store = new Map();
  if (initialRaw) store.set(STORAGE_KEY, String(initialRaw));
  return {
    get length() { return store.size; },
    key(index) {
      const keys = Array.from(store.keys());
      return index >= 0 && index < keys.length ? keys[index] : null;
    },
    getItem(key) { const k = String(key); return store.has(k) ? store.get(k) : null; },
    setItem(key, value) { store.set(String(key), String(value)); },
    removeItem(key) { store.delete(String(key)); },
    clear() { store.clear(); }
  };
}

let passCount = 0;
let failCount = 0;
const failureDetails = [];
const activePages = [];

function show(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  try { return JSON.stringify(value); } catch (err) { return String(value); }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + '\n        期望: ' + show(expected) + '\n        实际: ' + show(actual));
  }
}

function assertIncludes(haystack, needle, label) {
  const text = String(haystack == null ? '' : haystack);
  if (text.indexOf(needle) < 0) {
    throw new Error(label + '\n        期望包含: ' + show(needle) + '\n        实际: ' + show(text));
  }
}

function closeAllPages() {
  while (activePages.length) {
    const page = activePages.pop();
    try { page.dom.window.close(); } catch (err) { /* ignore */ }
  }
}

async function test(name, fn) {
  try {
    await fn();
    passCount += 1;
    console.log('PASS  ' + name);
  } catch (err) {
    failCount += 1;
    const message = err && err.message ? err.message : String(err);
    failureDetails.push({ name: name, message: message });
    console.log('FAIL  ' + name);
    message.split('\n').forEach((line) => console.log('        ' + line));
  } finally {
    closeAllPages();
  }
}

async function makePage(options) {
  const opts = options || {};
  const query = opts.query === undefined ? DEMO_QUERY : opts.query;
  const url = FILE_URL + (query ? '?' + query : '');
  const storage = createMemoryStorage(opts.storageRaw);
  const jsdomErrors = [];
  const cssWarnings = [];
  const consoleErrors = [];

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => {
    const message = String(error && error.message ? error.message : error);
    const type = error && error.type ? error.type : '';
    // cssom 解析告警属于 jsdom 限制（styles.css 可能被 visual-dev 并行重写），不判 app 失败。
    if (type === 'css parsing' || /Could not parse CSS/i.test(message)) {
      cssWarnings.push(message);
      return;
    }
    jsdomErrors.push((type ? type + ': ' : '') + message);
  });
  virtualConsole.on('error', function () {
    const args = Array.prototype.slice.call(arguments);
    consoleErrors.push(args.map((a) => (a && a.stack ? a.stack : String(a))).join(' '));
  });

  const dom = await JSDOM.fromFile(INDEX_FILE, {
    url: url,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: virtualConsole,
    beforeParse: function (window) {
      Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
      if (opts.beforeParse) opts.beforeParse(window);
    }
  });

  const page = {
    dom: dom,
    window: dom.window,
    document: dom.window.document,
    storage: storage,
    jsdomErrors: jsdomErrors,
    cssWarnings: cssWarnings,
    consoleErrors: consoleErrors,
    raw: function () { return storage.getItem(STORAGE_KEY); },
    db: function () { return JSON.parse(storage.getItem(STORAGE_KEY)); },
    $id: function (id) { return dom.window.document.getElementById(id); },
    $: function (selector) { return dom.window.document.querySelector(selector); },
    $$: function (selector) {
      return Array.prototype.slice.call(dom.window.document.querySelectorAll(selector));
    }
  };
  activePages.push(page);

  const bootStart = Date.now();
  while (!(dom.window.__EMBER__ && page.$id('craftStage'))) {
    if (Date.now() - bootStart > 8000) throw new Error('页面 8s 内未完成 boot（__EMBER__ / #craftStage 未就绪）');
    await wait(20);
  }
  if (opts.ready) {
    const readyStart = Date.now();
    while (!opts.ready(page)) {
      if (Date.now() - readyStart > 8000) throw new Error('页面就绪条件 8s 内未满足');
      await wait(20);
    }
  }
  await wait(opts.settle === undefined ? 160 : opts.settle);
  return page;
}

function app(page) { return page.window.__EMBER__; }
function dbOf(page) { return page.db(); }

function assertNoPageErrors(page) {
  if (page.cssWarnings.length) {
    console.log('      注: jsdom CSSOM 解析告警 ' + page.cssWarnings.length + ' 条（jsdom 限制，不判失败）');
  }
  assertEqual(page.jsdomErrors.length, 0,
    'jsdomError 不应出现\n        实际: ' + show(page.jsdomErrors.slice(0, 3)));
  assertEqual(page.consoleErrors.length, 0,
    'console.error 不应出现\n        实际: ' + show(page.consoleErrors.slice(0, 3)));
}

/* ------------------------------------------------------------------ */
/* DOM 操作辅助                                                        */
/* ------------------------------------------------------------------ */

function dispatch(page, el, type) {
  return el.dispatchEvent(new page.window.Event(type, { bubbles: true, cancelable: true }));
}

function click(page, target, label) {
  const el = typeof target === 'string' ? page.$(target) : target;
  assert(el, '找不到可点击元素: ' + (typeof target === 'string' ? target : (label || '<node>')));
  el.click();
  return el;
}

function fill(page, selector, value) {
  const el = page.$(selector);
  assert(el, '找不到输入框: ' + selector);
  el.value = value;
  dispatch(page, el, 'input');
  return el;
}

function pick(page, selector, value) {
  const el = page.$(selector);
  assert(el, '找不到 select: ' + selector);
  el.value = value;
  dispatch(page, el, 'change');
  return el;
}

function setChecked(page, selector, checked) {
  const el = page.$(selector);
  assert(el, '找不到 checkbox: ' + selector);
  el.checked = !!checked;
  dispatch(page, el, 'change');
  return el;
}

function chooseType(page, type) {
  const radio = page.$('input[name="taskType"][value="' + type + '"]');
  assert(radio, '找不到任务类型单选项: ' + type);
  radio.checked = true;
  dispatch(page, radio, 'change');
  return radio;
}

function submitTaskForm(page) {
  const form = page.$id('taskForm');
  assert(form, '找不到 #taskForm');
  dispatch(page, form, 'submit');
}

function todayRow(page, taskId) {
  return page.$('#todayTaskList .task-row[data-task-id="' + taskId + '"]');
}

function libraryRow(page, taskId) {
  return page.$('#libraryList .library-row[data-task-id="' + taskId + '"]');
}

function findTaskByTitle(page, title) {
  const db = dbOf(page);
  return db.tasks.filter((t) => t.title === title)[0] || null;
}

async function openAddModal(page) {
  click(page, '#headerAddBtn');
  await wait(120);
  assertEqual(page.$id('modalRoot').hidden, false, '打开添加弹窗后 #modalRoot 应可见');
  assertEqual(page.$id('taskModal').hidden, false, '打开添加弹窗后 #taskModal 应可见');
}

async function fillTaskForm(page, spec) {
  fill(page, '#taskTitle', spec.title);
  if (spec.category !== undefined) fill(page, '#taskCategory', spec.category);
  if (spec.notes !== undefined) fill(page, '#taskNotes', spec.notes);
  if (spec.type) chooseType(page, spec.type);
  if (spec.monthday !== undefined) pick(page, '#monthday', String(spec.monthday));
  if (spec.everyN !== undefined) fill(page, '#everyN', String(spec.everyN));
  if (spec.anchor !== undefined) fill(page, '#anchor', spec.anchor);
  if (spec.due !== undefined) fill(page, '#dueDate', spec.due);
  if (spec.dueTime !== undefined) fill(page, '#dueTime', spec.dueTime);
  if (spec.priority !== undefined) pick(page, '#priority', spec.priority);
  setChecked(page, '#fireEnabled', !!spec.fire);
  setChecked(page, '#reminderEnabled', !!spec.reminder);
  if (spec.reminderTime !== undefined) fill(page, '#reminderTime', spec.reminderTime);
}

async function addTask(page, spec) {
  await openAddModal(page);
  await fillTaskForm(page, spec);
  submitTaskForm(page);
  await wait(140);
}

/* ------------------------------------------------------------------ */
/* T01 — demo 首开                                                      */
/* ------------------------------------------------------------------ */

async function t01() {
  await test('T01 demo 首开：合成成功 / 连续 12 天 / 9 任务 / 3 材料 / 工作台输出铁镐 / localStorage craftCheckin.v1 / 无错误', async function () {
    const page = await makePage();

    // 品牌
    assertIncludes(page.document.title, '方块清单 · Craft Check-in', 'document.title');
    assertEqual(page.$('.brand-text strong').textContent, '方块清单', '侧栏品牌名');
    assertEqual(page.$('.brand-text small').textContent, 'CRAFT CHECK-IN', '侧栏品牌英文');

    // 工作台 hero
    assertEqual(page.$id('hero').dataset.state, 'lit', '#hero[data-state]');
    assertEqual(page.$id('craftStage').dataset.state, 'lit', '#craftStage[data-state]');
    assertEqual(page.$id('craftStateText').textContent, '合成成功', '#craftStateText');
    assertEqual(page.$id('heroStreak').textContent, '12', '#heroStreak 连续合成天数');
    assertEqual(page.$id('headerStreak').textContent, '12', '#headerStreak');
    assertEqual(page.$id('sideStreak').textContent, '12', '#sideStreak');
    assertEqual(page.$id('heroFuelCount').textContent, '3/3', '#heroFuelCount 配方材料');
    assertEqual(page.$id('heroTitle').textContent, '今日合成完成', '#heroTitle');
    assertIncludes(page.$id('heroDesc').textContent, '连续合成 12 天', '#heroDesc');
    assertIncludes(page.$id('craftHint').textContent, '产出 铁镐', '#craftHint');
    assertEqual(page.$id('heroEyebrow').textContent, '今日工作台', '#heroEyebrow');

    // 3×3 工作台
    assertEqual(page.$$('#craftGrid .craft-slot').length, 9, '#craftGrid 格子数');
    assertEqual(page.$$('#craftGrid .craft-slot.is-filled').length, 3, '#craftGrid 已填充材料数');
    assertEqual(page.$$('#craftGrid .craft-slot.is-done').length, 3, '#craftGrid 已完成材料数');
    assertEqual(page.$$('#craftGrid .craft-slot.is-missing').length, 0, '#craftGrid 缺料数');
    assertEqual(page.$$('#craftGrid .craft-slot.is-empty').length, 6, '#craftGrid 空格数');
    assertEqual(page.$id('craftResultItem').textContent, '⛏️', '#craftResultItem 产出图标');
    assertEqual(page.$id('craftResultName').textContent, '铁镐', '#craftResultName 产出名称');
    assertEqual(page.$id('craftOutputSlot').classList.contains('is-ready'), true, '.craft-output 应 is-ready');

    // 清单 / 材料 / 任务库
    assertEqual(page.$$('#todayTaskList .task-row').length, 9, '今日任务条数');
    assertEqual(page.$$('#todayTaskList .task-group').length, 2, '今日任务分组数');
    assertEqual(page.$$('#todayTaskList .task-group-daily .task-row').length, 4, '每日习惯条数');
    assertEqual(page.$$('#todayTaskList .task-group-extra .task-row').length, 5, '额外任务条数');
    assertEqual(page.$$('#todayTaskList .task-row.is-material').length, 3, '今日材料行数');
    assertEqual(page.$$('#todayTaskList .chip-material').length, 3, '今日 .chip-material 数');
    assertEqual(page.$$('#fuelList .recipe-item').length, 3, '#fuelList 配方条数');
    assertEqual(page.$$('#libraryList .library-row').length, 9, '#libraryList 任务库条数');
    assertEqual(page.$id('fuelCountBadge').textContent, '3/3', '#fuelCountBadge');
    assertEqual(page.$id('todayCardTitle').textContent, '今日合成清单', '#todayCardTitle');
    assertEqual(page.$id('fuelCardTitle').textContent, '合成配方', '#fuelCardTitle');
    assertEqual(page.$id('weekCardTitle').textContent, '本周合成', '#weekCardTitle');

    assertEqual(page.$id('todayBadge').textContent, '2 项待合成', '#todayBadge');
    assertEqual(page.$id('todayRing').style.getPropertyValue('--pct'), '78', '进度环 --pct');
    assertEqual(page.$id('todayRingText').textContent, '78%', '#todayRingText');
    assertIncludes(page.$id('todaySummary').textContent, '7/9 项完成', '#todaySummary');
    assertIncludes(page.$id('todaySummary').textContent, '2 块材料', '#todaySummary 待办文案');
    assertIncludes(page.$id('weekStats').textContent, '本周合成', '#weekStats');
    assertIncludes(page.$id('weekStats').textContent, '本周中断', '#weekStats 中断文案');
    assertIncludes(page.$id('fireStats').textContent, '今日材料', '#fireStats');
    assertIncludes(page.$id('heatmapNote').textContent, '合成', '#heatmapNote');
    assertIncludes(page.$id('craftStage').getAttribute('aria-label'), '工作台状态', '#craftStage aria-label');
    assertIncludes(page.$id('craftStage').getAttribute('aria-label'), '连续合成', '#craftStage aria-label');
    assertIncludes(page.$id('mobileBrand').textContent, '方块清单', '#mobileBrand');

    // 持久化键
    const raw = page.raw();
    assert(raw, 'localStorage 应有 ' + STORAGE_KEY);
    const stored = JSON.parse(raw);
    assertEqual(stored.tasks.length, 9, 'localStorage tasks 数量');
    assertEqual(stored.settings.seeded, true, 'localStorage settings.seeded');
    assertEqual(stored.dayLog[TODAY].lit, true, 'dayLog 今日 lit');
    assertEqual(stored.tasks.filter((t) => t.fire).length, 3, 'localStorage 配方材料数');

    assertNoPageErrors(page);
  });
}

/* ------------------------------------------------------------------ */
/* T02 — 冻结 / 合成中状态                                              */
/* ------------------------------------------------------------------ */

async function t02() {
  await test('T02 ?state=frozen：合成中 / 输出 ? / 还差 1 种材料 / 补材料转合成成功并可回退', async function () {
    const page = await makePage({ query: 'demo=1&reset=1&state=frozen&now=' + NOW + '&static=1' });

    assertEqual(page.$id('hero').dataset.state, 'frozen', '#hero[data-state]');
    assertEqual(page.$id('craftStage').dataset.state, 'frozen', '#craftStage[data-state]');
    assertEqual(page.$id('craftStateText').textContent, '合成中', '#craftStateText');
    assertEqual(page.$id('heroTitle').textContent, '工作台正在等待', '#heroTitle');
    // SPEC 语义未变：frozen 时 current 显示截至昨天的连续天数（demo 为 11，不归零）
    assertEqual(page.$id('heroStreak').textContent, '11', 'frozen #heroStreak（截至昨天）');
    assertEqual(page.$id('heroFuelCount').textContent, '2/3', 'frozen #heroFuelCount');
    assertIncludes(page.$id('heroDesc').textContent, '还差 1 种材料', 'frozen #heroDesc');
    assertIncludes(page.$id('craftHint').textContent, '还差 1 种材料', '#craftHint');

    assertEqual(page.$id('craftResultItem').textContent, '?', 'frozen #craftResultItem');
    assertEqual(page.$id('craftResultName').textContent, '等待材料', 'frozen #craftResultName');
    assertEqual(page.$id('craftResultItem').classList.contains('is-unknown'), true,
      'frozen #craftResultItem 应有 is-unknown');
    assertEqual(page.$id('craftOutputSlot').classList.contains('is-ready'), false, '.craft-output 不应 is-ready');
    assertEqual(page.$id('craftOutputSlot').classList.contains('is-empty'), true, '.craft-output 应 is-empty');
    assertEqual(page.$id('firePageStateLabel').textContent, '合成中', '#firePageStateLabel');

    assertEqual(page.$$('#craftGrid .craft-slot.is-filled').length, 3, '#craftGrid 已填充');
    assertEqual(page.$$('#craftGrid .craft-slot.is-done').length, 2, '#craftGrid 已完成');
    assertEqual(page.$$('#craftGrid .craft-slot.is-missing').length, 1, '#craftGrid 缺料');
    assertEqual(page.$$('#craftGrid .craft-slot.is-empty').length, 6, '#craftGrid 空格');
    const chips = page.$$('#heroChips .hero-chip');
    assertEqual(chips.length, 3, 'hero 材料 chips 数量');
    assertEqual(page.$$('#heroChips .hero-chip.is-done').length, 2, 'hero chips 已完成数');

    // 补上缺失的材料 -> 合成成功
    let row = todayRow(page, 'demo_stretch');
    assert(row, '今日清单应包含 demo_stretch');
    click(page, row.querySelector('.check'));
    await wait(90);
    assertEqual(page.$id('hero').dataset.state, 'lit', '补完材料后 #hero[data-state]');
    assertEqual(page.$id('craftStage').dataset.state, 'lit', '补完材料后 #craftStage[data-state]');
    assertEqual(page.$id('craftStateText').textContent, '合成成功', '补完后 #craftStateText');
    assertEqual(page.$id('craftResultItem').textContent, '⛏️', '补完后产出图标');
    assertEqual(page.$id('craftResultName').textContent, '铁镐', '补完后产出名称');
    assertEqual(page.$id('heroStreak').textContent, '12', '补完后连续天数');
    assert(page.$$('#toastRoot .toast strong').some((el) => el.textContent.indexOf('合成成功') >= 0),
      '点燃工作台时应有「合成成功！」toast');

    // 取消勾选 -> 回到合成中
    row = todayRow(page, 'demo_stretch');
    click(page, row.querySelector('.check'));
    await wait(90);
    assertEqual(page.$id('hero').dataset.state, 'frozen', '取消后 #hero[data-state] 应恢复 frozen');
    assertEqual(page.$id('craftStateText').textContent, '合成中', '取消后 #craftStateText');
    assertEqual(page.$id('craftResultItem').textContent, '?', '取消后产出图标');
    assertEqual(page.$id('heroStreak').textContent, '11', '取消后连续天数');

    assertNoPageErrors(page);
  });
}

async function t02b() {
  await test('T02b ?state=crafting 别名 = frozen：合成中 + 输出 ?；?state=empty/interrupted 走 unset/out', async function () {
    const frozenAlias = await makePage({ query: 'demo=1&reset=1&state=crafting&now=' + NOW + '&static=1' });
    assertEqual(frozenAlias.$id('hero').dataset.state, 'frozen', 'state=crafting 应映射为 frozen');
    assertEqual(frozenAlias.$id('craftStage').dataset.state, 'frozen', 'state=crafting #craftStage');
    assertEqual(frozenAlias.$id('craftStateText').textContent, '合成中', 'state=crafting #craftStateText');
    assertEqual(frozenAlias.$id('craftResultItem').textContent, '?', 'state=crafting 输出 ?');
    assertNoPageErrors(frozenAlias);

    const emptyAlias = await makePage({ query: 'demo=1&reset=1&state=empty&now=' + NOW + '&static=1' });
    assertEqual(emptyAlias.$id('hero').dataset.state, 'unset', 'state=empty 应映射为 unset');
    assertEqual(emptyAlias.$id('craftStateText').textContent, '空配方', 'state=empty #craftStateText');
    assertEqual(emptyAlias.$id('craftResultName').textContent, '空配方', 'state=empty 产出名称');
    assertEqual(emptyAlias.$id('craftResultItem').textContent, '?', 'state=empty 输出 ?');
    assertEqual(emptyAlias.$id('firePageStateLabel').textContent, '空配方', 'state=empty #firePageStateLabel');
    assertEqual(emptyAlias.$$('#craftGrid .craft-slot').length, 9, 'unset 时工作台仍应 9 格');
    assertEqual(emptyAlias.$$('#craftGrid .craft-slot.is-filled').length, 0, 'unset 时无材料');
    assertEqual(emptyAlias.$$('#craftGrid .craft-slot.is-empty').length, 9, 'unset 时 9 格全空');
    assertEqual(emptyAlias.$$('#heroChips .hero-chip.is-empty').length, 1, 'unset 时 hero 应显示选择配方按钮');
    assertNoPageErrors(emptyAlias);

    const outAlias = await makePage({ query: 'demo=1&reset=1&state=interrupted&now=' + NOW + '&static=1' });
    assertEqual(outAlias.$id('hero').dataset.state, 'out', 'state=interrupted 应映射为 out');
    assertEqual(outAlias.$id('craftStateText').textContent, '等待材料', 'state=interrupted #craftStateText');
    assertEqual(outAlias.$id('firePageStateLabel').textContent, '等待材料', 'state=interrupted #firePageStateLabel');
    assertEqual(outAlias.$id('craftResultItem').textContent, '?', 'state=interrupted 输出 ?');
    assertNoPageErrors(outAlias);
  });
}

/* ------------------------------------------------------------------ */
/* T03 — 勾选 / 取消                                                    */
/* ------------------------------------------------------------------ */

async function t03() {
  await test('T03 勾选与取消：任务行 is-done / 进度环 --pct / 待合成 badge 同步变化', async function () {
    const page = await makePage();

    let row = todayRow(page, 'demo_journal');
    assert(row, '今日清单应包含 demo_journal');
    assertEqual(row.classList.contains('is-done'), false, '初始 demo_journal 不应 is-done');
    assertEqual(page.$id('todayRing').style.getPropertyValue('--pct'), '78', '初始 --pct');
    assertEqual(page.$id('todayBadge').textContent, '2 项待合成', '初始 #todayBadge');
    assertEqual(page.$id('navTodayCount').textContent, '2', '初始 #navTodayCount');

    click(page, row.querySelector('.check'));
    await wait(90);
    row = todayRow(page, 'demo_journal');
    assertEqual(row.classList.contains('is-done'), true, '勾选后任务行应 is-done');
    assertEqual(page.$id('todayRing').style.getPropertyValue('--pct'), '89', '勾选后 --pct');
    assertEqual(page.$id('todayRingText').textContent, '89%', '勾选后 #todayRingText');
    assertEqual(page.$id('todayBadge').textContent, '1 项待合成', '勾选后 #todayBadge');
    assertEqual(page.$id('navTodayCount').textContent, '1', '勾选后 #navTodayCount');
    assert(page.$$('#toastRoot .toast strong').some((el) => el.textContent === '完成「写今日一句」'),
      '勾选后应有完成 toast');
    let stored = dbOf(page);
    assert(stored.tasks.filter((t) => t.id === 'demo_journal')[0].completions[TODAY],
      '勾选后 localStorage completions 应包含今日 key');
    assertEqual(stored.dayLog[TODAY].lit, true, 'dayLog 今日 lit 不受非材料任务影响');

    click(page, todayRow(page, 'demo_journal').querySelector('.check'));
    await wait(90);
    row = todayRow(page, 'demo_journal');
    assertEqual(row.classList.contains('is-done'), false, '取消后任务行不应 is-done');
    assertEqual(page.$id('todayRing').style.getPropertyValue('--pct'), '78', '取消后 --pct 恢复');
    assertEqual(page.$id('todayBadge').textContent, '2 项待合成', '取消后 #todayBadge 恢复');
    stored = dbOf(page);
    assertEqual(stored.tasks.filter((t) => t.id === 'demo_journal')[0].completions[TODAY], undefined,
      '取消后 completions 不应包含今日 key');

    assertNoPageErrors(page);
  });
}

/* ------------------------------------------------------------------ */
/* T04 — 添加任务                                                       */
/* ------------------------------------------------------------------ */

async function t04() {
  await test('T04 添加任务：弹窗 / 空标题校验 / 每周+提醒 / DOM 与 localStorage 出现 / 默认不计入配方', async function () {
    const page = await makePage();
    const before = dbOf(page).tasks.length;

    await openAddModal(page);
    assertEqual(page.$id('taskModalTitle').textContent, '添加任务', '#taskModalTitle');
    await wait(80);
    assertEqual(page.document.activeElement.id, 'taskTitle', '弹窗打开后焦点应落在 #taskTitle');

    // 空标题提交 -> 显示错误
    submitTaskForm(page);
    await wait(60);
    assertEqual(page.$id('taskFormError').hidden, false, '空标题提交后错误提示应可见');
    assertIncludes(page.$id('taskFormError').textContent, '起个名字', '#taskFormError 文案');
    assertEqual(dbOf(page).tasks.length, before, '空标题不应写入任务');
    assertEqual(page.$id('taskModal').hidden, false, '#taskModal 应保持打开');

    // 正常提交：每周 + 提醒
    await fillTaskForm(page, {
      title: 'QA 添加任务',
      category: 'QA',
      type: 'weekly',
      reminder: true,
      reminderTime: '22:30'
    });
    submitTaskForm(page);
    await wait(150);

    assertEqual(page.$id('modalRoot').hidden, true, '提交后 #modalRoot 应关闭');
    const stored = dbOf(page);
    assertEqual(stored.tasks.length, before + 1, 'localStorage 任务数 +1');
    const created = findTaskByTitle(page, 'QA 添加任务');
    assert(created, 'localStorage 应有新任务 title');
    assertEqual(created.type, 'weekly', '新任务 type');
    assertEqual(created.category, 'QA', '新任务 category');
    assertEqual(created.reminder.enabled, true, '新任务 reminder.enabled');
    assertEqual(created.reminder.time, '22:30', '新任务 reminder.time');
    assertEqual(!!created.fire, false, '默认不计入合成配方');

    assert(page.$$('#libraryList .task-name').some((el) => el.textContent === 'QA 添加任务'),
      '#libraryList 应出现新任务');
    assert(page.$$('#todayTaskList .task-row .task-name').some((el) => el.textContent === 'QA 添加任务'),
      '#todayTaskList 应出现新任务');
    assert(page.$('#todayTaskList .task-row.type-weekly'), '今日清单应出现 .type-weekly 行');
    assertEqual(page.$$('#todayTaskList .task-row.is-material').length, 3, '新任务默认不进入工作台');
    assert(page.$$('#toastRoot .toast strong').some((el) => el.textContent.indexOf('已添加') === 0),
      '提交后应有「已添加」toast');

    assertNoPageErrors(page);
  });
}

/* ------------------------------------------------------------------ */
/* T05 — 五种类型的条件字段                                             */
/* ------------------------------------------------------------------ */

async function t05() {
  await test('T05 五种类型条件字段：#fieldWeekly/#fieldMonthly/#fieldInterval/#fieldUrgent 显示隐藏 + monthday 1–31/最后一天', async function () {
    const page = await makePage();
    await openAddModal(page);

    const fields = ['fieldWeekly', 'fieldMonthly', 'fieldInterval', 'fieldUrgent'];
    const expectedMap = {
      daily: { fieldWeekly: true, fieldMonthly: true, fieldInterval: true, fieldUrgent: true },
      weekly: { fieldWeekly: false, fieldMonthly: true, fieldInterval: true, fieldUrgent: true },
      monthly: { fieldWeekly: true, fieldMonthly: false, fieldInterval: true, fieldUrgent: true },
      interval: { fieldWeekly: true, fieldMonthly: true, fieldInterval: false, fieldUrgent: true },
      urgent: { fieldWeekly: true, fieldMonthly: true, fieldInterval: true, fieldUrgent: false }
    };

    const readFields = function () {
      const out = {};
      fields.forEach(function (id) { out[id] = page.$id(id).hidden; });
      return out;
    };

    const initial = readFields();
    fields.forEach(function (id) {
      assertEqual(initial[id], true, '默认 daily 时 #' + id + ' 应 hidden');
    });

    for (const type of ['weekly', 'monthly', 'interval', 'urgent']) {
      chooseType(page, type);
      await wait(30);
      const state = readFields();
      fields.forEach(function (id) {
        assertEqual(state[id], expectedMap[type][id], 'type=' + type + ' 时 #' + id + '.hidden');
      });
    }

    chooseType(page, 'monthly');
    await wait(30);
    const options = Array.prototype.slice.call(page.$id('monthday').options);
    assertEqual(options.length, 32, '#monthday 选项数量');
    assertEqual(options[0].value, '1', '#monthday 首项');
    assertEqual(options[30].value, '31', '#monthday 第 31 项');
    assertEqual(options[31].value, '-1', '#monthday 最后一项 value');
    assertEqual(options[31].textContent, '最后一天', '#monthday 最后一项文案');

    chooseType(page, 'urgent');
    await wait(30);
    assert(page.$id('dueDate'), '缺少 #dueDate');
    assert(page.$id('dueTime'), '缺少 #dueTime');
    assert(page.$id('priority'), '缺少 #priority');

    assertNoPageErrors(page);
  });
}

/* ------------------------------------------------------------------ */
/* T06 — 编辑任务                                                       */
/* ------------------------------------------------------------------ */

async function t06() {
  await test('T06 编辑：回填字段 / 改标题保存 / 列表与 localStorage 更新', async function () {
    const page = await makePage();
    click(page, '.nav-item[data-view="tasks"]');
    await wait(60);

    click(page, '#libraryList .library-row[data-task-id="demo_read"] [data-action="edit"]');
    await wait(140);
    assertEqual(page.$id('taskModal').hidden, false, '#taskModal 应打开');
    assertEqual(page.$id('taskModalTitle').textContent, '编辑任务', '#taskModalTitle');
    assertEqual(page.$id('taskSaveBtn').textContent, '保存修改', '#taskSaveBtn');
    assertEqual(page.$id('taskTitle').value, '阅读 30 分钟', '编辑回填 #taskTitle');
    assertEqual(page.$id('taskCategory').value, '成长', '编辑回填 #taskCategory');
    assertEqual(page.$id('fireEnabled').checked, true, '编辑回填 #fireEnabled（材料）');
    assertEqual(page.$id('reminderEnabled').checked, true, '编辑回填 #reminderEnabled');
    assertEqual(page.$id('reminderTime').value, '21:00', '编辑回填 #reminderTime');
    assertEqual(page.$('input[name="taskType"][value="daily"]').checked, true, '编辑回填 daily 单选');

    fill(page, '#taskTitle', '阅读 45 分钟');
    submitTaskForm(page);
    await wait(150);

    assertEqual(page.$id('modalRoot').hidden, true, '保存后弹窗关闭');
    const stored = dbOf(page);
    const edited = stored.tasks.filter((t) => t.id === 'demo_read')[0];
    assert(edited, 'localStorage 应仍有 demo_read');
    assertEqual(edited.title, '阅读 45 分钟', 'localStorage 标题更新');
    assertEqual(stored.tasks.length, 9, '编辑不应新增任务');
    assert(page.$$('#libraryList .task-name').some((el) => el.textContent === '阅读 45 分钟'),
      '#libraryList 应显示新标题');
    assert(page.$$('#toastRoot .toast strong').some((el) => el.textContent === '已保存修改'),
      '保存后应有 toast');

    assertNoPageErrors(page);
  });
}

/* ------------------------------------------------------------------ */
/* T07 — 删除任务                                                       */
/* ------------------------------------------------------------------ */

async function t07() {
  await test('T07 删除：确认弹窗 / 取消不删 / 确认后从 DOM 与 localStorage 移除', async function () {
    const page = await makePage();
    click(page, '.nav-item[data-view="tasks"]');
    await wait(60);
    assertEqual(page.$$('#libraryList .library-row').length, 9, '初始任务库条数');

    click(page, '#libraryList .library-row[data-task-id="demo_journal"] [data-action="delete"]');
    await wait(120);
    assertEqual(page.$id('modalRoot').hidden, false, '删除弹窗后 #modalRoot 应可见');
    assertEqual(page.$id('confirmModal').hidden, false, '#confirmModal 应可见');
    assertEqual(page.$id('confirmTitle').textContent, '删除任务', '#confirmTitle');
    assertIncludes(page.$id('confirmText').textContent, '写今日一句', '#confirmText 应包含任务名');
    assertIncludes(page.$id('confirmText').textContent, '合成记录', '#confirmText 应使用合成记录文案');

    // 取消：不删除
    click(page, '#confirmModal .modal-foot [data-close-modal]');
    await wait(100);
    assertEqual(page.$id('modalRoot').hidden, true, '取消后 #modalRoot 应关闭');
    assertEqual(app(page).state.confirmCallback, null, '取消后 confirmCallback 应为 null');
    assertEqual(dbOf(page).tasks.length, 9, '取消后 localStorage 任务数不变');
    assert(libraryRow(page, 'demo_journal'), '取消后任务行应仍在');

    // 再次确认删除
    click(page, '#libraryList .library-row[data-task-id="demo_journal"] [data-action="delete"]');
    await wait(120);
    click(page, '#confirmOk');
    await wait(150);
    const stored = dbOf(page);
    assertEqual(stored.tasks.length, 8, '确认删除后 localStorage 任务数 -1');
    assertEqual(stored.tasks.some((t) => t.id === 'demo_journal'), false, 'demo_journal 应被删除');
    assertEqual(libraryRow(page, 'demo_journal'), null, '任务库 DOM 应移除该行');
    assertEqual(page.$$('#libraryList .library-row').length, 8, '任务库剩余行数');
    assertEqual(page.$id('modalRoot').hidden, true, '删除后 #modalRoot 应关闭');

    assertNoPageErrors(page);
  });
}

/* ------------------------------------------------------------------ */
/* T08 — 配方材料切换                                                   */
/* ------------------------------------------------------------------ */

async function t08() {
  await test('T08 配方材料：任务行 .recipe-action 切换 / 合成记录页 .material-select 切换 / #fuelList 数量同步', async function () {
    const page = await makePage();
    assertEqual(page.$$('#fuelList .recipe-item').length, 3, '初始 #fuelList 材料数');

    // 任务行 recipe-action 加入
    const fireBtn = page.$('#todayTaskList .task-row[data-task-id="demo_rent"] .recipe-action');
    assert(fireBtn, '应能找到 demo_rent 的 .recipe-action');
    click(page, fireBtn);
    await wait(90);
    assertEqual(dbOf(page).tasks.filter((t) => t.id === 'demo_rent')[0].fire, true,
      '点击 .recipe-action 后 localStorage fire=true');
    assertEqual(page.$$('#fuelList .recipe-item').length, 4, '加入材料后 #fuelList 数量');
    assertEqual(page.$('#todayTaskList .task-row[data-task-id="demo_rent"] .recipe-action').classList.contains('is-on'),
      true, '材料按钮应有 is-on');
    assertEqual(page.$('#todayTaskList .task-row[data-task-id="demo_rent"]').classList.contains('is-material'),
      true, '任务行应有 is-material');
    // 未完成的材料会让工作台进入等待状态，这是预期行为
    assertEqual(page.$id('hero').dataset.state, 'frozen', '新增未完成材料后 hero 应 frozen');
    assertEqual(page.$id('craftStateText').textContent, '合成中', '新增未完成材料后 #craftStateText');

    // 再次点击移出
    click(page, page.$('#todayTaskList .task-row[data-task-id="demo_rent"] .recipe-action'));
    await wait(90);
    assertEqual(dbOf(page).tasks.filter((t) => t.id === 'demo_rent')[0].fire, false,
      '再次点击后 fire=false');
    assertEqual(page.$$('#fuelList .recipe-item').length, 3, '移出材料后 #fuelList 数量恢复');
    assertEqual(page.$id('hero').dataset.state, 'lit', '移出后 hero 恢复 lit');

    // 合成记录页 material-select
    click(page, '.nav-item[data-view="fire"]');
    await wait(60);
    assertEqual(page.$id('view-fire').hidden, false, '#view-fire 应可见');
    const selectBtn = page.$('#firePageFuelList .material-select[data-id="demo_journal"]');
    assert(selectBtn, '合成记录页应能找到 demo_journal 的 .material-select');
    assertEqual(selectBtn.getAttribute('aria-pressed'), 'false', '初始 aria-pressed');
    click(page, selectBtn);
    await wait(90);
    assertEqual(dbOf(page).tasks.filter((t) => t.id === 'demo_journal')[0].fire, true,
      '合成记录页点击后 localStorage fire=true');
    assertEqual(page.$('#firePageFuelList .material-select[data-id="demo_journal"]').getAttribute('aria-pressed'),
      'true', '点击后 aria-pressed=true');
    assertEqual(page.$$('#fuelList .recipe-item').length, 4, '合成记录页加入后 #fuelList 数量');
    assertEqual(page.$$('#firePageFuelList .material-select.is-on').length, 4, '合成记录页 is-on 数量');

    click(page, page.$('#firePageFuelList .material-select[data-id="demo_journal"]'));
    await wait(90);
    assertEqual(dbOf(page).tasks.filter((t) => t.id === 'demo_journal')[0].fire, false,
      '合成记录页再次点击后 fire=false');
    assertEqual(page.$$('#fuelList .recipe-item').length, 3, '合成记录页移出后 #fuelList 数量恢复');

    assertNoPageErrors(page);
  });
}

/* ------------------------------------------------------------------ */
/* T08b — 配方产出随材料数量变化                                        */
/* ------------------------------------------------------------------ */

async function t08b() {
  await test('T08b 配方产出：4 材料完成 -> 金苹果 / 5 材料完成 -> 钻石 is-legendary', async function () {
    const page = await makePage();
    assertEqual(page.$id('craftResultItem').textContent, '⛏️', '初始 3 材料产出铁镐');

    // 第 4 个材料：加入未完成的 demo_journal -> 工作台等待
    click(page, page.$('#todayTaskList .task-row[data-task-id="demo_journal"] .recipe-action'));
    await wait(90);
    assertEqual(page.$id('hero').dataset.state, 'frozen', '加入未完成材料后应 frozen');
    assertEqual(page.$id('craftResultItem').textContent, '?', '材料未齐时产出 ?');
    assertEqual(page.$$('#craftGrid .craft-slot.is-filled').length, 4, '工作台应有 4 个材料');
    assertEqual(page.$$('#craftGrid .craft-slot.is-done').length, 3, '其中 3 个已完成');

    // 完成第 4 个 -> 4 材料合成成功，产出金苹果
    click(page, todayRow(page, 'demo_journal').querySelector('.check'));
    await wait(120);
    assertEqual(page.$id('hero').dataset.state, 'lit', '4 材料完成后应 lit');
    assertEqual(page.$id('craftResultItem').textContent, '🍎', '4 材料产出图标');
    assertEqual(page.$id('craftResultName').textContent, '金苹果', '4 材料产出名称');
    assertEqual(page.$id('craftResultItem').classList.contains('is-unknown'), false, '产出应有 is-unknown=false');
    assertEqual(page.$id('craftResultItem').classList.contains('is-legendary'), false,
      '4 材料不应 is-legendary');
    assertEqual(page.$$('#craftGrid .craft-slot.is-filled').length, 4, '工作台 4 格材料');
    assertEqual(page.$$('#craftGrid .craft-slot.is-done').length, 4, '工作台 4 格已完成');

    // 第 5 个材料：demo_clean 本周已完成 -> 加入即全部就位，产出钻石
    click(page, page.$('#todayTaskList .task-row[data-task-id="demo_clean"] .recipe-action'));
    await wait(120);
    assertEqual(dbOf(page).tasks.filter((t) => t.id === 'demo_clean')[0].fire, true, 'demo_clean 应加入配方');
    assertEqual(page.$id('hero').dataset.state, 'lit', '5 材料完成后应 lit');
    assertEqual(page.$id('craftResultItem').textContent, '💎', '5 材料产出图标');
    assertEqual(page.$id('craftResultName').textContent, '钻石', '5 材料产出名称');
    assertEqual(page.$id('craftResultItem').classList.contains('is-legendary'), true,
      '5 材料产出应 is-legendary');
    assertEqual(page.$$('#craftGrid .craft-slot.is-filled').length, 5, '工作台 5 格材料');
    assertEqual(page.$$('#craftGrid .craft-slot.is-done').length, 5, '工作台 5 格已完成');
    assertEqual(page.$id('craftHint').textContent, '配方就位 · 产出 钻石', '#craftHint 5 材料');

    // 移出第 5 个 -> 回到 4 材料产出
    click(page, page.$('#todayTaskList .task-row[data-task-id="demo_clean"] .recipe-action'));
    await wait(110);
    assertEqual(page.$id('craftResultItem').textContent, '🍎', '移出后回到 4 材料产出');
    assertEqual(page.$id('craftResultName').textContent, '金苹果', '移出后产出名称');
    assertEqual(page.$id('hero').dataset.state, 'lit', '移出后仍 lit');

    assertNoPageErrors(page);
  });
}

/* ------------------------------------------------------------------ */
/* T09 — 视图 / 筛选 / 搜索 / 合成记录页                                */
/* ------------------------------------------------------------------ */

async function t09() {
  await test('T09 视图与筛选：导航 hidden / 今日 daily·extra / 任务库 urgent / 搜索 / 合成记录页四种状态与图例', async function () {
    const page = await makePage();

    // 导航到任务库
    click(page, '.nav-item[data-view="tasks"]');
    await wait(60);
    assertEqual(page.$id('view-today').hidden, true, 'tasks 视图下 #view-today 应 hidden');
    assertEqual(page.$id('view-tasks').hidden, false, 'tasks 视图下 #view-tasks 应可见');
    assertEqual(page.$id('view-fire').hidden, true, 'tasks 视图下 #view-fire 应 hidden');
    assertEqual(page.$('.nav-item[data-view="tasks"]').classList.contains('is-active'), true,
      '任务库导航应 is-active');
    assertEqual(page.$('.nav-item[data-view="tasks"]').getAttribute('aria-current'), 'page',
      '任务库导航 aria-current');

    // 导航到合成记录
    click(page, '.nav-item[data-view="fire"]');
    await wait(80);
    assertEqual(page.$id('view-fire').hidden, false, '#view-fire 应可见');
    assertEqual(page.$id('view-tasks').hidden, true, '#view-tasks 应 hidden');
    assertEqual(page.$id('view-today').hidden, true, '#view-today 应 hidden');
    assertEqual(page.$id('firePageTitle').textContent, '合成记录', '#firePageTitle');
    assertIncludes(page.$('.nav-item[data-view="fire"] .nav-label').textContent, '合成记录', '导航「合成记录」');
    assertEqual(page.$id('firePageStateLabel').textContent, '合成成功', '#firePageStateLabel');
    assertIncludes(page.$id('firePageStatus').textContent, '已连续合成 12 天', '#firePageStatus');
    assertEqual(page.$$('#craftPageGrid .craft-slot').length, 9, '#craftPageGrid 格子数');
    assertEqual(page.$id('craftPageResultItem').textContent, '⛏️', '#craftPageResultItem');
    assertEqual(page.$id('craftPageResultName').textContent, '铁镐', '#craftPageResultName');
    assertEqual(page.$('.craft-page-output').classList.contains('is-ready'), true, '.craft-page-output 应 is-ready');
    assertEqual(page.$$('#fireStats .craft-stat').length, 4, '#fireStats .craft-stat 数量');
    assertEqual(page.$$('#heatmap .heat-cell:not(.is-blank)').length, 30, '#heatmap 30 天格数');
    const legend = page.$('.heat-legend').textContent.replace(/\s+/g, ' ');
    ['已合成', '进行中', '中断'].forEach(function (word) {
      assertIncludes(legend, word, '#heatmap 图例应包含「' + word + '」');
    });

    // 回到今日
    click(page, '.nav-item[data-view="today"]');
    await wait(60);
    assertEqual(page.$id('view-today').hidden, false, '#view-today 应可见');

    // 今日过滤 daily / extra / all
    click(page, '#todayFilters .segment[data-filter="daily"]');
    await wait(60);
    assertEqual(page.$$('#todayTaskList .task-row').length, 4, '每日过滤后行数');
    assert(page.$$('#todayTaskList .task-row').every((row) => row.classList.contains('type-daily')),
      '每日过滤后应只剩 .type-daily 行');
    assertEqual(page.$('#todayFilters .segment[data-filter="daily"]').getAttribute('aria-selected'), 'true',
      '每日过滤 aria-selected');

    click(page, '#todayFilters .segment[data-filter="extra"]');
    await wait(60);
    assertEqual(page.$$('#todayTaskList .task-row').length, 5, '额外过滤后行数');
    assert(page.$$('#todayTaskList .task-row').every((row) => !row.classList.contains('type-daily')),
      '额外过滤后不应出现 .type-daily 行');
    assertEqual(page.$$('#todayTaskList .task-group').length, 1, '额外过滤后分组数');
    assertEqual(page.$('#todayTaskList .task-group').classList.contains('task-group-extra'), true,
      '额外过滤后应只有额外分组');

    click(page, '#todayFilters .segment[data-filter="all"]');
    await wait(60);
    assertEqual(page.$$('#todayTaskList .task-row').length, 9, '全部过滤后行数');
    assertEqual(page.$$('#todayTaskList .task-group').length, 2, '全部过滤后分组数');

    // 任务库按类型过滤 urgent
    click(page, '.nav-item[data-view="tasks"]');
    await wait(60);
    click(page, '#libraryFilters .filter-chip[data-filter="urgent"]');
    await wait(60);
    assertEqual(page.$$('#libraryList .library-row').length, 2, 'urgent 过滤后行数');
    const chipTypes = page.$$('#libraryList .library-row .chip-type');
    assertEqual(chipTypes.length, 2, 'urgent 过滤后类型 chip 数');
    chipTypes.forEach(function (chip) {
      assertEqual(chip.classList.contains('type-urgent'), true, 'urgent 过滤后 chip 应 type-urgent');
    });

    // 搜索过滤
    click(page, '#libraryFilters .filter-chip[data-filter="all"]');
    await wait(40);
    fill(page, '#taskSearch', '喝水');
    await wait(60);
    assertEqual(page.$$('#libraryList .library-row').length, 1, '搜索「喝水」行数');
    assertIncludes(page.$('#libraryList .task-name').textContent, '晨间喝水', '搜索命中标题');

    fill(page, '#taskSearch', 'zzz不存在');
    await wait(60);
    assertEqual(page.$$('#libraryList .library-row').length, 0, '搜索无结果行数');
    assertEqual(page.$id('libraryEmpty').hidden, false, '搜索无结果时空状态应可见');
    assertIncludes(page.$id('libraryEmptyText').textContent, '没有任务匹配', '空状态文案');

    fill(page, '#taskSearch', '');
    await wait(60);
    assertEqual(page.$$('#libraryList .library-row').length, 9, '清空搜索后行数');

    assertNoPageErrors(page);
  });
}

/* ------------------------------------------------------------------ */
/* T10 — 主题                                                           */
/* ------------------------------------------------------------------ */

async function t10() {
  await test('T10 主题：切换 html[data-theme] 并写入 localStorage，重新加载后保持', async function () {
    const page = await makePage();
    assertEqual(page.document.documentElement.getAttribute('data-theme'), 'dark', '默认主题 dark');
    assertEqual(page.$('meta[name="theme-color"]').getAttribute('content'), '#17150f',
      '默认 meta theme-color');

    click(page, '#themeBtn');
    await wait(80);
    assertEqual(page.document.documentElement.getAttribute('data-theme'), 'light', '切换后 data-theme');
    assertEqual(page.$('meta[name="theme-color"]').getAttribute('content'), '#e9e2cf',
      '亮色 meta theme-color');
    assertEqual(dbOf(page).settings.theme, 'light', 'localStorage settings.theme');

    const raw = page.raw();
    assert(raw, 'localStorage 应有数据');
    const reloaded = await makePage({ query: 'now=' + NOW + '&static=1', storageRaw: raw });
    assertEqual(reloaded.document.documentElement.getAttribute('data-theme'), 'light',
      '重新加载后 data-theme 应保持 light');
    assertEqual(dbOf(reloaded).settings.theme, 'light', '重新加载后 localStorage theme 保持');
    assertEqual(reloaded.$$('#libraryList .library-row').length, 9, '重新加载后任务库条数');

    click(reloaded, '#themeBtn');
    await wait(80);
    assertEqual(reloaded.document.documentElement.getAttribute('data-theme'), 'dark',
      '再次切换应回到 dark');

    assertNoPageErrors(page);
    assertNoPageErrors(reloaded);
  });
}

/* ------------------------------------------------------------------ */
/* T11 — 提醒                                                           */
/* ------------------------------------------------------------------ */

async function t11() {
  await test('T11 提醒：到点 toast / 完成后不重复 / 10 分钟后再提醒写入 snoozes', async function () {
    const page = await makePage();
    await wait(1500); // 等 boot 后 1400ms 的自动 checkReminders 跑完
    assertEqual(page.$id('reminderToast').hidden, true, '初始 #reminderToast 应隐藏');

    const api = app(page);
    const journal = api.state.db.tasks.filter((t) => t.id === 'demo_journal')[0];
    assert(journal, 'demo 数据应包含 demo_journal');
    journal.reminder = { enabled: true, time: '20:00' };
    delete api.state.db.fired['demo_journal|' + TODAY + '|20:00'];
    api.save();
    api.renderAll();
    api.checkReminders();
    await wait(120);

    const toast = page.$id('reminderToast');
    assertEqual(toast.hidden, false, '到点后 #reminderToast 应可见');
    assertEqual(toast.classList.contains('is-visible'), true, '#reminderToast 应有 is-visible');
    assertIncludes(page.$id('reminderToastTitle').textContent, '写今日一句', '#reminderToastTitle');
    assertIncludes(page.$id('reminderToastKicker').textContent, '到点啦', '#reminderToastKicker');
    assert(dbOf(page).fired['demo_journal|' + TODAY + '|20:00'], 'localStorage fired 应记录提醒签名');

    click(page, '#reminderDoneBtn');
    await wait(420);
    assertEqual(page.$id('reminderToast').hidden, true, '点击完成后 #reminderToast 应隐藏');
    let journalRow = todayRow(page, 'demo_journal');
    assert(journalRow, '完成后今日清单仍应有 demo_journal');
    assertEqual(journalRow.classList.contains('is-done'), true, '完成后任务行应 is-done');
    let stored = dbOf(page);
    assert(stored.tasks.filter((t) => t.id === 'demo_journal')[0].completions[TODAY],
      '完成后 localStorage completions 应包含今日');

    api.checkReminders();
    await wait(120);
    assertEqual(page.$id('reminderToast').hidden, true, '已完成后再次 checkReminders 不应重复提醒');
    assertEqual(api.state.activeReminder, null, 'activeReminder 应为 null');

    // 稍后提醒：新增一个提醒时间已过的任务
    await addTask(page, { title: 'QA 稍后提醒', type: 'daily', reminder: true, reminderTime: '19:00' });
    const snoozeTask = findTaskByTitle(page, 'QA 稍后提醒');
    assert(snoozeTask, '新任务应写入 localStorage');
    assertEqual(snoozeTask.reminder.enabled, true, '新任务提醒已开启');

    api.checkReminders();
    await wait(120);
    assertEqual(page.$id('reminderToast').hidden, false, '新任务到点应显示 #reminderToast');
    assertIncludes(page.$id('reminderToastTitle').textContent, 'QA 稍后提醒', '新任务提醒标题');

    click(page, '#reminderSnoozeBtn');
    await wait(360);
    assertEqual(page.$id('reminderToast').hidden, true, '点击稍后后 #reminderToast 应隐藏');
    stored = dbOf(page);
    const expectedSnooze = new Date(api.now().getTime() + 10 * 60 * 1000).toISOString();
    assertEqual(stored.snoozes[snoozeTask.id], expectedSnooze, 'db.snoozes 应写入 now + 10 分钟');

    api.checkReminders();
    await wait(120);
    assertEqual(page.$id('reminderToast').hidden, true, '稍后时间未到时不应重复提醒');
    assertEqual(api.state.activeReminder, null, 'activeReminder 应为 null');

    assertNoPageErrors(page);
  });
}

/* ------------------------------------------------------------------ */
/* T12 — 持久化                                                         */
/* ------------------------------------------------------------------ */

async function t12() {
  await test('T12 持久化：同一份 JSON 注入新页面后任务 / 完成状态 / 主题 / 工作台一致', async function () {
    const page1 = await makePage();
    click(page1, todayRow(page1, 'demo_journal').querySelector('.check'));
    await wait(100);
    click(page1, '#themeBtn');
    await wait(80);
    const raw = page1.raw();
    assert(raw, '页面 1 localStorage 应有数据');
    const snapshot = JSON.parse(raw);
    assertEqual(snapshot.tasks.length, 9, '快照任务数');
    assert(snapshot.tasks.filter((t) => t.id === 'demo_journal')[0].completions[TODAY],
      '快照应包含完成记录');
    assertEqual(snapshot.settings.theme, 'light', '快照主题');

    const page2 = await makePage({ query: 'now=' + NOW + '&static=1', storageRaw: raw });
    assertEqual(page2.$$('#libraryList .library-row').length, 9, '重新加载后任务库条数（不应重新种子）');
    assertEqual(dbOf(page2).tasks.length, 9, '重新加载后 localStorage 任务数');
    assertEqual(page2.document.documentElement.getAttribute('data-theme'), 'light',
      '重新加载后主题保持 light');
    assertEqual(page2.$id('heroStreak').textContent, '12', '重新加载后连续天数保持');
    assertEqual(page2.$id('craftResultItem').textContent, '⛏️', '重新加载后工作台产出保持');
    assertEqual(page2.$$('#craftGrid .craft-slot.is-done').length, 3, '重新加载后工作台完成格数');
    const journalRow = todayRow(page2, 'demo_journal');
    assert(journalRow, '重新加载后应有 demo_journal 行');
    assertEqual(journalRow.classList.contains('is-done'), true, '重新加载后完成状态保持 is-done');
    const dayLog = dbOf(page2).dayLog[TODAY];
    assertEqual(dayLog.done.indexOf('demo_journal') >= 0, true, '重新加载后 dayLog 今日 done 保留');

    assertNoPageErrors(page1);
    assertNoPageErrors(page2);
  });
}

/* ------------------------------------------------------------------ */
/* T13 — 自检                                                           */
/* ------------------------------------------------------------------ */

async function t13() {
  await test('T13 ?selftest=1：等待后 #selftest-result 含 SELFTEST PASS 且 html[data-selftest=pass]', async function () {
    const page = await makePage({
      query: DEMO_QUERY + '&selftest=1',
      ready: function (p) { return !!p.document.documentElement.getAttribute('data-selftest'); },
      settle: 250
    });

    assertEqual(page.document.documentElement.getAttribute('data-selftest'), 'pass',
      'html[data-selftest]');
    const result = page.$id('selftest-result');
    assertEqual(result.hidden, false, '#selftest-result 应可见');
    assertIncludes(result.textContent, 'SELFTEST PASS', '#selftest-result 文本');
    const match = /SELFTEST PASS (\d+)\/(\d+)/.exec(result.textContent);
    assert(match, '#selftest-result 应包含「SELFTEST PASS n/m」格式');
    assertEqual(match[1], match[2], '自检通过数应等于总数');
    assertIncludes(result.textContent, 'PASS  工作台 hero 有状态', '自检应有工作台分项');
    assertIncludes(result.textContent, 'PASS  合成统计有值', '自检应有合成统计分项');

    assertNoPageErrors(page);
  });
}

/* ------------------------------------------------------------------ */
/* T14 — 静态检查 + 品牌词 / 图标完整性                                 */
/* ------------------------------------------------------------------ */

function describeControl(el) {
  return (el.getAttribute('id') || el.getAttribute('name') || '<no-id>')
    + '[' + (el.getAttribute('type') || el.tagName.toLowerCase()) + ']';
}

function accessibleNameInfo(doc, el) {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return { name: ariaLabel.trim() };
  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  if (ariaLabelledBy && ariaLabelledBy.trim()) return { name: ariaLabelledBy.trim() };
  const title = el.getAttribute('title');
  if (title && title.trim()) return { name: title.trim() };
  const id = el.getAttribute('id');
  if (id) {
    const label = doc.querySelector('label[for="' + id + '"]');
    if (label && label.textContent.trim()) return { name: label.textContent.trim() };
  }
  const wrapping = el.closest('label');
  if (wrapping) {
    const text = wrapping.textContent.trim();
    if (text) return { name: text };
    return { weak: true };
  }
  return {};
}

async function t14() {
  await test('T14 静态检查：品牌词/无 i-flame/图标完整/无外部资源/无重复 id/label/[hidden]/CSS 覆盖记录', async function () {
    const html = fs.readFileSync(INDEX_FILE, 'utf8');
    const appSource = fs.readFileSync(path.join(PROJECT_ROOT, 'app.js'), 'utf8');
    const css = fs.readFileSync(STYLES_FILE, 'utf8');
const inlineStyle = (() => { const html = fs.readFileSync(INDEX_FILE, 'utf8'); const m = html.match(/<style[^>]*>([\s\S]*?)<\/style>/); return m ? m[1] : ''; })();
    const cssStat = fs.statSync(STYLES_FILE);
    const checkTime = new Date().toISOString();

    // 1) 主题改造：源码不得残留火苗主题词
    const htmlWords = html.match(FORBIDDEN_THEME_WORDS);
    assertEqual(htmlWords, null, 'index.html 不应出现火苗主题词: ' + show(htmlWords));
    const appWords = appSource.match(FORBIDDEN_THEME_WORDS);
    assertEqual(appWords, null, 'app.js 不应出现火苗主题词: ' + show(appWords));
    assertEqual(/i-flame|flameStage|flameStateText|flameHint|chip-fire|is-fuel|fuel-item|fuel-select|fire-action/.test(html + '\n' + appSource),
      false, '源码不应残留旧的火焰/燃料命名（i-flame/flameStage/fuel-*/fire-action 等）');

    // 2) 无 http(s) 外部脚本/样式/字体引用
    const external = [];
    const attrRe = /\b(?:src|href)\s*=\s*("([^"]*)"|'([^']*)')/gi;
    let match;
    while ((match = attrRe.exec(html))) {
      const value = (match[2] !== undefined ? match[2] : match[3] || '').trim();
      if (/^https?:\/\//i.test(value)) external.push(value);
    }
    assertEqual(external.length, 0, 'index.html 不应引用 http(s) 外部资源: ' + show(external));
    assertEqual(/fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare/i.test(html + '\n' + css),
      false, '不应引用 CDN / 网络字体');
    assertEqual(/@import\s+(?:url\()?['"]?https?:/i.test(css), false, 'styles.css 不应 @import 远程样式');
    const cssRemote = [];
    const urlRe = /url\(\s*['"]?([^)'"]+)/gi;
    while ((match = urlRe.exec(css))) {
      const value = match[1].trim();
      if (/^https?:\/\//i.test(value)) cssRemote.push(value);
    }
    assertEqual(cssRemote.length, 0, 'styles.css 不应 url() 远程资源: ' + show(cssRemote));

    // 3) 无重复 id
    const staticDom = new JSDOM(html);
    const staticDoc = staticDom.window.document;
    const ids = Array.prototype.map.call(staticDoc.querySelectorAll('[id]'), (el) => el.id);
    const duplicates = Array.from(new Set(ids.filter((id, index) => ids.indexOf(id) !== index)));
    assertEqual(duplicates.length, 0, 'index.html 重复 id: ' + show(duplicates));

    // 4) 表单控件有可访问名称（label / aria-label）
    const controls = Array.prototype.slice.call(staticDoc.querySelectorAll('input, select, textarea'));
    const unlabeled = [];
    const weakLabels = [];
    controls.forEach(function (el) {
      const info = accessibleNameInfo(staticDoc, el);
      if (info.name) return;
      if (info.weak) { weakLabels.push(describeControl(el)); return; }
      unlabeled.push(describeControl(el));
    });
    assertEqual(unlabeled.length, 0, '表单控件缺少可访问名称（label/aria-label）: ' + show(unlabeled));
    if (weakLabels.length) {
      console.log('      注(P3): 包裹 label 无文本、仅靠 placeholder 提示: ' + weakLabels.join(', '));
    }
    staticDom.window.close();

    // 5) [hidden] 规则存在（app.js 用 hidden 属性切换弹窗/视图）
    assert(/\[hidden\]\s*\{/.test(css), 'styles.css 缺少 [hidden] { ... } 规则');

    // 6) 运行时：可见文案不得出现火苗主题词；DOM 不得出现 i-flame；<use> 引用必须能解析到 symbol
    const page = await makePage();
    const visibleText = page.document.body.textContent.replace(/\s+/g, ' ');
    const visibleWords = visibleText.match(FORBIDDEN_THEME_WORDS);
    assertEqual(visibleWords, null, '渲染后可见文案不应出现火苗主题词: ' + show(visibleWords));
    assertEqual(page.document.querySelectorAll('use[href="#i-flame"]').length, 0, 'DOM 不应出现 i-flame');
    assertEqual(page.document.querySelectorAll('[id="i-flame"]').length, 0, '不应定义 #i-flame symbol');

    const symbols = new Set(page.$$('symbol[id]').map((s) => s.id));
    const brokenRefs = page.$$('use[href^="#"]').map((u) => u.getAttribute('href').slice(1))
      .filter((id) => !symbols.has(id));
    assertEqual(brokenRefs.length, 0, '<use href> 指向不存在的 symbol: ' + show(brokenRefs));
    const iconNames = Array.from(new Set(Array.from(appSource.matchAll(/icon\('([a-z-]+)'\)/g)).map((m) => m[1])));
    const missingIcons = iconNames.filter((name) => !symbols.has('i-' + name));
    assertEqual(missingIcons.length, 0, 'app.js icon() 引用了不存在的图标 symbol: ' + show(missingIcons));

    // 7) CSS 覆盖：styles.css + index.html 内联 OCR 样式（只记录、不判失败）
    const rendered = new Set();
    page.document.querySelectorAll('[class]').forEach(function (el) {
      el.classList.forEach(function (cls) { rendered.add(cls); });
    });
    ['is-visible', 'is-static', 'is-highlight', 'just-crafted'].forEach(function (cls) { rendered.add(cls); });
    const missing = Array.from(rendered).sort().filter(function (cls) {
      const pattern = new RegExp('\\.' + cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])');
      return !pattern.test(css + '\n' + inlineStyle);
    });
    console.log('      CSS 覆盖检查时间: ' + checkTime + ' · styles.css + inline mtime: ' + cssStat.mtime.toISOString()
      + ' · styles.css 大小: ' + cssStat.size + ' bytes');
    console.log('      styles.css 暂无对应规则的渲染 class (' + missing.length + '): '
      + (missing.slice(0, 24).join(', ') || '无') + (missing.length > 24 ? ' …' : ''));

    assertNoPageErrors(page);
  });
}

/* ------------------------------------------------------------------ */
/* T15 — 跨周设置                                                       */
/* ------------------------------------------------------------------ */

async function t15() {
  await test('T15 跨周设置：settings.weekStart=7 时周任务 occurrenceKey 使用周日，UI 周条 7 格', async function () {
    const page = await makePage();
    const core = page.window.EmberCore;
    assertEqual(dbOf(page).settings.weekStart, 1, '默认 weekStart 应为 1（周一）');

    assertEqual(core.startOfWeek(TODAY, 7), '2026-10-18', 'core.startOfWeek(now, 7)');
    assertEqual(core.weekdayISO('2026-10-18'), 7, '2026-10-18 应为周日');
    assertEqual(core.occurrenceKey({ type: 'weekly', completions: {} }, TODAY, 7), 'W:2026-10-18',
      'core.occurrenceKey(weekly, date, 7)');
    assertEqual(core.occurrenceKey({ type: 'weekly', completions: {} }, TODAY, 1), 'W:2026-10-19',
      'core.occurrenceKey(weekly, date, 1)');

    click(page, '#settingsBtn');
    await wait(140);
    assertEqual(page.$id('settingsModal').hidden, false, '#settingsModal 应打开');
    pick(page, '#weekStartSelect', '7');
    await wait(90);
    assertEqual(dbOf(page).settings.weekStart, 7, '切换后 localStorage settings.weekStart');
    assertEqual(app(page).state.db.settings.weekStart, 7, '切换后内存 settings.weekStart');

    click(page, '#settingsModal .modal-foot [data-close-modal]');
    await wait(120);
    assertEqual(page.$id('modalRoot').hidden, true, '设置弹窗应关闭');

    assertEqual(page.$$('#weekBars .week-bar').length, 7, '周条应渲染 7 格');
    assertIncludes(page.$id('weekSub').textContent, '本周第 7 天', '#weekSub 按周日起算');

    // 打开添加弹窗：weekly 提示文案应跟随 weekStart（app.js updateTypeFields 会更新 #weeklyHint/#weeklyHintText）
    click(page, '#headerAddBtn');
    await wait(140);
    assertEqual(page.$id('weeklyHint').textContent, '周日开始', 'weekStart=7 时 #weeklyHint');
    assertIncludes(page.$id('weeklyHintText').textContent, '下周日', 'weekStart=7 时 #weeklyHintText');
    click(page, '#modalRoot .modal-backdrop');
    await wait(80);

    const cleanBefore = dbOf(page).tasks.filter((t) => t.id === 'demo_clean')[0];
    assertEqual(core.isTaskComplete(cleanBefore, TODAY, 7), false,
      'weekStart=7 时 demo_clean 本周应视为未完成');
    let cleanRow = todayRow(page, 'demo_clean');
    assert(cleanRow, '今日清单应有 demo_clean');
    assertEqual(cleanRow.classList.contains('is-done'), false, '切换后 demo_clean 行不应 is-done');

    click(page, cleanRow.querySelector('.check'));
    await wait(100);
    const cleanAfter = dbOf(page).tasks.filter((t) => t.id === 'demo_clean')[0];
    assert(cleanAfter.completions['W:2026-10-18'],
      'app 应按 weekStart=7 写入完成键 W:2026-10-18（实际 keys: '
      + show(Object.keys(cleanAfter.completions)) + '）');
    assert(cleanAfter.completions['W:2026-10-19'], '历史完成键 W:2026-10-19 应保留');
    assertEqual(core.isTaskComplete(cleanAfter, TODAY, 7), true,
      '勾选后 core.isTaskComplete(weekStart=7) 应为 true');
    cleanRow = todayRow(page, 'demo_clean');
    assertEqual(cleanRow.classList.contains('is-done'), true, '勾选后 demo_clean 行应 is-done');

    assertNoPageErrors(page);
  });
}

async function t15b() {
  await test('T15b 跨周设置回归：weekStart=7 时 #weekBars 星期标签按周日起排（日,一,二,三,四,五,六）', async function () {
    const page = await makePage();
    click(page, '#settingsBtn');
    await wait(140);
    pick(page, '#weekStartSelect', '7');
    await wait(90);
    click(page, '#settingsModal .modal-foot [data-close-modal]');
    await wait(120);

    const bars = page.$$('#weekBars .week-bar');
    assertEqual(bars.length, 7, '周条 7 格');
    const labels = bars.map((bar) => bar.querySelector('small').textContent);
    assertEqual(labels.join(','), '日,一,二,三,四,五,六',
      '#weekBars 星期标签（weekStart=7 时第一格是周日，应为 日,一,二,三,四,五,六）');
    const titles = bars.map((bar) => (bar.getAttribute('title') || '').split(' · ')[0]);
    assertEqual(titles[0], '10月18日 周日', '第一格 title 日期应为 10月18日 周日');
    assertEqual(titles[6], '10月24日 周六', '第七格 title 日期应为 10月24日 周六');

    assertNoPageErrors(page);
  });
}

/* ------------------------------------------------------------------ */
/* T16 — 工作台 9 格上限                                                */
/* ------------------------------------------------------------------ */

async function t16() {
  await test('T16 工作台 9 格上限：第 10 个材料被拒绝（表单与 .recipe-action 两条路径），移出一个后可再加入', async function () {
    const page = await makePage();

    // demo 已有 3 个材料，再添加 6 个 -> 9
    for (let i = 1; i <= 6; i += 1) {
      await addTask(page, { title: 'QA 材料' + i, type: 'daily', fire: true });
    }
    let stored = dbOf(page);
    assertEqual(stored.tasks.length, 15, '9 原有 + 6 新增任务数');
    assertEqual(stored.tasks.filter((t) => t.fire).length, 9, '材料数应到 9');
    assertEqual(page.$$('#craftGrid .craft-slot').length, 9, '#craftGrid 恰好 9 格');
    assertEqual(page.$$('#craftGrid .craft-slot.is-filled').length, 9, '9 个材料应填满工作台');

    // 第 10 个：走添加表单
    await openAddModal(page);
    await fillTaskForm(page, { title: 'QA 材料10', type: 'daily', fire: true });
    submitTaskForm(page);
    await wait(120);
    stored = dbOf(page);
    assertEqual(stored.tasks.length, 15, '第 10 个材料不应写入 localStorage');
    assertEqual(stored.tasks.filter((t) => t.fire).length, 9, '材料数仍为 9');
    assertEqual(page.$id('taskFormError').hidden, false, '超限提交应显示表单错误');
    assertIncludes(page.$id('taskFormError').textContent, '9 个格子', '#taskFormError 超限文案');
    assertEqual(page.$id('taskModal').hidden, false, '超限时弹窗保持打开');
    click(page, '#taskModal .modal-foot [data-close-modal]');
    await wait(100);

    // 第 10 个：走「编辑任务 -> 勾选计入合成」路径
    click(page, '#libraryList .library-row[data-task-id="demo_journal"] [data-action="edit"]');
    await wait(140);
    assertEqual(page.$id('taskModalTitle').textContent, '编辑任务', '编辑弹窗标题');
    setChecked(page, '#fireEnabled', true);
    submitTaskForm(page);
    await wait(120);
    stored = dbOf(page);
    assertEqual(stored.tasks.filter((t) => t.id === 'demo_journal')[0].fire, false,
      '超限时编辑任务不应把 fire 置 true');
    assertEqual(page.$id('taskFormError').hidden, false, '超限编辑应显示表单错误');
    assertIncludes(page.$id('taskFormError').textContent, '9 个格子', '#taskFormError 编辑超限文案');
    assertEqual(page.$id('taskModal').hidden, false, '超限编辑时弹窗保持打开');
    click(page, '#taskModal .modal-foot [data-close-modal]');
    await wait(100);

    // 第 10 个：走任务行 .recipe-action
    click(page, '#todayTaskList .task-row[data-task-id="demo_journal"] .recipe-action');
    await wait(90);
    stored = dbOf(page);
    assertEqual(stored.tasks.filter((t) => t.id === 'demo_journal')[0].fire, false,
      '超限时 .recipe-action 不应把任务加入配方');
    assertEqual(stored.tasks.filter((t) => t.fire).length, 9, '材料数仍为 9');
    assert(page.$$('#toastRoot .toast strong').some((el) => el.textContent.indexOf('9 个格子') >= 0),
      '超限时应有「工作台只有 9 个格子」toast');

    // 移出一个材料后可以再加入
    click(page, '#todayTaskList .task-row[data-task-id="demo_stretch"] .recipe-action');
    await wait(90);
    assertEqual(dbOf(page).tasks.filter((t) => t.fire).length, 8, '移出一个材料后应为 8');
    click(page, '#todayTaskList .task-row[data-task-id="demo_journal"] .recipe-action');
    await wait(90);
    assertEqual(dbOf(page).tasks.filter((t) => t.fire).length, 9, '腾出空间后可加入第 9 个');
    assertEqual(dbOf(page).tasks.filter((t) => t.id === 'demo_journal')[0].fire, true,
      'demo_journal 应成功加入配方');
    assertEqual(page.$$('#craftGrid .craft-slot').length, 9, '#craftGrid 仍为 9 格');

    assertNoPageErrors(page);
  });
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

(async function main() {
  console.log('方块清单 · Craft Check-in — jsdom UI 测试');
  console.log('页面: ' + FILE_URL);
  console.log('Node: ' + process.version + ' · jsdom: ' + require('jsdom/package.json').version);
  console.log('固定时间: ' + NOW + '（' + TODAY + '）· 本地时区: '
    + (Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'));
  console.log('');

  await t01();
  await t02();
  await t02b();
  await t03();
  await t04();
  await t05();
  await t06();
  await t07();
  await t08();
  await t08b();
  await t09();
  await t10();
  await t11();
  await t12();
  await t13();
  await t14();
  await t15();
  await t15b();
  await t16();

  console.log('');
  console.log('PASS ' + passCount + ' / FAIL ' + failCount);
  if (failCount > 0) {
    console.log('');
    console.log('失败明细:');
    failureDetails.forEach(function (item, index) {
      console.log('  ' + (index + 1) + ') ' + item.name);
      item.message.split('\n').forEach(function (line) { console.log('     ' + line); });
    });
    process.exitCode = 1;
  }
  closeAllPages();
})().catch(function (err) {
  closeAllPages();
  console.error('测试运行器异常:');
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
