/*!
 * test-app.mjs — 端到端冒烟测试
 *
 * 用轻量 DOM 桩件加载真实的 index.html / archive.html 与全部页面脚本，
 * 再用真实点击路径验证：渲染、落子、铅笔标记、冲突、撤销、提示、暂停、
 * 难度调节、配色主题、通关结算、存档恢复、往期跳转与设置项。
 *
 * 说明：桩件不做真实布局与层叠样式（没有像素级断言）；
 * 需要像素验证时用 tools/make-browser-check.mjs 生成自检页在浏览器里打开。
 * 页面脚本挂在传入的 window 桩件上，因此统一通过 loadPage 返回的 win.Sudoku 访问。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createDom, createWindow } from './dom-shim.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ISSUE_RE = /第 \d+ 期/;
let failures = 0;
let passes = 0;
let currentWin = null;
let sharedStorage = new Map();   // 同一个测试块内跨页面共享，模拟浏览器 localStorage

const check = (label, ok, extra = '') => {
  if (ok) { passes++; console.log(`  ✅ ${label}`); }
  else { failures++; console.log(`  ❌ ${label}${extra === '' ? '' : '  [' + extra + ']'}`); }
};
const section = (title) => console.log('\n' + title);

function loadPage(pageFile, search = '', reuseStorage = false) {
  if (currentWin) currentWin.__dispose();
  if (!reuseStorage) sharedStorage = new Map();
  const html = readFileSync(join(root, pageFile), 'utf8');
  const doc = createDom(html);
  const win = createWindow(doc, { storage: sharedStorage });
  win.location.search = search;
  win.location.pathname = '/' + pageFile;

  // 记录页面主动发起的跳转。往期错乱的 bug 就是 boot() 里 location.replace
  // 把 index.html 弹回 archive.html 造成的，必须能被断言抓到。
  win.__redirects = [];
  win.location.replace = (url) => { win.__redirects.push(String(url)); };
  win.location.assign = (url) => { win.__redirects.push(String(url)); };
  currentWin = win;

  globalThis.window = win;
  globalThis.document = doc;
  globalThis.localStorage = win.localStorage;
  // Node 内置的 navigator/location 是只读取值器，需要重新定义
  Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'location', { value: win.location, configurable: true, writable: true });
  globalThis.history = win.history;
  globalThis.confirm = win.confirm;

  const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  for (const src of srcs) vm.runInThisContext(readFileSync(join(root, src), 'utf8'), { filename: src });
  return { win, doc, srcs, S: win.Sudoku };
}

/** 清空进行中的对局，保证每个断言块从干净状态开始 */
function freshGame(ctx) {
  const { doc, S } = ctx;
  const key = S.app._internals.makeSaveKey(S.app.state.game.size);
  S.stats.clearGame(key);
  doc.getElementById('btn-restart').click();     // confirm 桩件恒为 true
  S.app.state.paused = false;                    // 清掉上一块可能留下的暂停态
  S.app.state.notesMode = false;
  return S.app.state.game;
}

const cellsOf = (doc) => doc.querySelectorAll('#board .cell');
const keysOf = (doc) => doc.querySelectorAll('#keypad .key[data-digit]');
const keyFor = (doc, d) => keysOf(doc).find((k) => Number(k.dataset.digit) === d);
const press = (doc, key) => doc.dispatchEvent({ type: 'keydown', key, target: doc.body, preventDefault() {}, stopPropagation() {} });
/** 同步触发一次渲染：应用里 render 由用户操作和 1 秒轮询驱动，异步等待会让断言不确定 */
const renderCurrent = (ctx) => press(ctx.doc, 'Shift');
/** 忙等指定毫秒：计时基于真实时钟，这里需要真实的时间流逝 */
const sleep = (ms) => { const until = Date.now() + ms; while (Date.now() < until) { /* spin */ } };
/** 页面是否主动跳转去了档案页（这是“来回刷新”的元凶） */
const archiveRedirected = (ctx) =>
  (ctx.win.__redirects || []).some((u) => u.indexOf('archive.html') !== -1);

const noteDigitsOf = (mask, size) => {
  const out = [];
  for (let d = 1; d <= size; d++) if (mask & (1 << (d - 1))) out.push(d);
  return out;
};

/** 比较颜色：把 #rrggbb 与 rgb(r,g,b) 归一化后对比 */
function sameColor(a, b) {
  const norm = (v) => {
    const s = String(v || '').trim().toLowerCase();
    const hex = /^#([0-9a-f]{6})$/.exec(s);
    if (hex) {
      const n = parseInt(hex[1], 16);
      return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
    }
    return s.replace(/\s+/g, '');
  };
  return norm(a) === norm(b);
}

/** 把一个值通过真实点击路径填进指定格 */
function place(ctx, idx, digit) {
  const { doc } = ctx;
  cellsOf(doc)[idx].click();
  keyFor(doc, digit).click();
}

/* ============================================ 1. 每日模式：启动与落子 */
section('[1] 每日模式 (6x6)：启动、渲染与基本操作');
{
  const ctx = loadPage('index.html', '');
  const { doc, S } = ctx;
  const app = S.app;
  const game = freshGame(ctx);

  check('页面脚本加载并开局', !!game && game.size === 6, `size=${game && game.size}`);
  check('每日题难度来自星期规则', game.difficulty === S.dailyDifficulty(S.dates.todayKey()), game.difficulty);
  check('题面已知数与解一致', [...Array(game.total).keys()].every((i) => !game.givens[i] || game.givens[i] === game.solution[i]));
  check('棋盘渲染出 36 个格子', cellsOf(doc).length === 36, String(cellsOf(doc).length));
  check('数字键盘含 6 个数字键 + 擦除键', doc.querySelectorAll('#keypad .key').length === 7);
  check('每日模式难度选择器可用（不再隐藏）', doc.getElementById('difficulty').hidden === false);
  check('每日模式标注今日难度', /今日/.test(doc.getElementById('difficulty').textContent),
    doc.getElementById('difficulty').textContent);
  check('难度说明文字已显示', doc.getElementById('difficulty-hint').hidden === false,
    doc.getElementById('difficulty-hint').textContent);
  check('难度按钮共 4 档', doc.querySelectorAll('#difficulty button').length === 4);
  check('每日模式显示期号', ISSUE_RE.test(doc.getElementById('chip-meta').textContent), doc.getElementById('chip-meta').textContent);
  check('宫格分隔线生效', doc.querySelectorAll('#board .cell.box-right').length > 0 && doc.querySelectorAll('#board .cell.box-bottom').length > 0);
  check('侧栏渲染 4 张卡片', doc.querySelectorAll('#side .card').length === 4, String(doc.querySelectorAll('#side .card').length));
  check('打卡小日历渲染 7 天', doc.querySelectorAll('#side .week__day').length === 7);
  check('键盘说明渲染', doc.querySelectorAll('#side .shortcuts > div').length >= 5);

  const cells = cellsOf(doc);
  const firstEmpty = [...Array(game.total).keys()].find((i) => !game.values[i]);
  const digit = game.solution[firstEmpty];

  cells[firstEmpty].click();
  check('点击格子进入选中态', cells[firstEmpty].classList.contains('is-selected'));
  check('选中后同行同列被高亮', doc.querySelectorAll('#board .cell.is-peer').length > 0);
  check('选中后同宫被高亮', doc.querySelectorAll('#board .cell.is-box').length > 0);

  keyFor(doc, digit).click();
  check('数字键完成落子', game.values[firstEmpty] === digit, `values=${game.values[firstEmpty]}`);
  check('格子渲染出数字', cells[firstEmpty].textContent.includes(String(digit)));
  check('落子后自动跳到下一个空格', app.state.selected !== firstEmpty);

  const givenIdx = [...Array(game.total).keys()].find((i) => game.givens[i]);
  cells[givenIdx].click();
  keyFor(doc, digit).click();
  check('题目给定数字不可被覆盖', game.values[givenIdx] === game.givens[givenIdx], `v=${game.values[givenIdx]}`);

  doc.getElementById('btn-undo').click();
  check('撤销恢复空格', game.values[firstEmpty] === 0, `values=${game.values[firstEmpty]}`);
  check('撤销后格子文本清空', cells[firstEmpty].textContent.trim() === '');
  currentWin.__dispose();
}

/* ============================================ 2. 铅笔标记与冲突 */
section('[2] 铅笔标记、冲突提示与错误统计');
{
  const ctx = loadPage('index.html', '');
  const { doc, S } = ctx;
  const app = S.app;
  const game = freshGame(ctx);
  const cells = cellsOf(doc);

  const idx = [...Array(game.total).keys()].find((i) => !game.values[i]);
  const digit = game.solution[idx];

  doc.getElementById('btn-notes').click();
  check('标记按钮进入激活态', doc.getElementById('btn-notes').classList.contains('is-active'));
  check('标记模式状态为开', app.state.notesMode === true);
  cells[idx].click();
  keyFor(doc, digit).click();
  check('标记模式写入铅笔标记', game.notes[idx] === (1 << (digit - 1)), `notes=${game.notes[idx]}`);
  check('标记模式不写数字', game.values[idx] === 0);
  const spans = cells[idx].querySelectorAll('.cell__notes span');
  check('标记渲染为 6 个小格', spans.length === 6, String(spans.length));
  check('标记显示在正确的格位', spans[digit - 1] && spans[digit - 1].textContent === String(digit));
  check('未标记的格位为空', spans.filter((s) => s.textContent === '').length === 5);

  keyFor(doc, digit).click();
  check('再次点击同一数字可取消标记', game.notes[idx] === 0);
  keyFor(doc, digit).click();
  doc.getElementById('btn-notes').click();
  check('退出标记模式', app.state.notesMode === false);
  doc.getElementById('btn-erase').click();
  check('擦除清空标记', game.notes[idx] === 0);

  /* --- 错误数字（格子此时为空，直接点数字键即可） --- */
  const wrongDigit = digit === 6 ? 1 : digit + 1;
  cells[idx].click();
  keyFor(doc, wrongDigit).click();
  check('错误数字被识别', game.isWrong(idx), `v=${game.values[idx]} sol=${game.solution[idx]}`);
  check('错误计入次数', game.getMistakes() >= 1, String(game.getMistakes()));
  doc.getElementById('btn-undo').click();
  check('撤销清除错误', game.values[idx] === 0 && !game.isWrong(idx));
  check('撤销后棋盘只剩题面数字',
    [...Array(game.total).keys()].every((i) => game.values[i] === 0 || game.isGiven(i)),
    '残留=' + [...Array(game.total).keys()].filter((i) => game.values[i] && !game.isGiven(i)).join(','));

  /* --- 同行重复 -> 冲突（两块必须落在同一行、不同宫） --- */
  const empties = [...Array(game.total).keys()].filter((i) => !game.values[i]);
  const a = empties[0];
  const rowA = Math.floor(a / game.size);
  const boxA = Math.floor((a % game.size) / game.boxCols);
  const b = empties.find((i) => i !== a &&
    Math.floor(i / game.size) === rowA &&
    Math.floor((i % game.size) / game.boxCols) !== boxA);
  check('找到同行不同宫的两个空格用于测试', b !== undefined, `a=${a} b=${b}`);

  // 选一个不会碰到题面已有数字的值，这样冲突数才只由这两格决定。
  // 否则若该列题面本来就有同值数字，冲突会是 2 的倍数，断言就失去意义。
  let shared = 0;
  for (let v = 1; v <= game.size; v++) {
    const colA = a % game.size, colB = b % game.size;
    const clashesGiven = [...Array(game.total).keys()].some((i) =>
      game.isGiven(i) && game.givens[i] === v &&
      (Math.floor(i / game.size) === rowA || i % game.size === colA || i % game.size === colB ||
       (Math.floor(Math.floor(i / game.size) / game.boxRows) === Math.floor(rowA / game.boxRows) &&
        Math.floor((i % game.size) / game.boxCols) === boxA)));
    if (!clashesGiven) { shared = v; break; }
  }
  check('找到了一个与题面不冲突的测试数字', shared !== 0, `shared=${shared}`);

  place(ctx, a, shared);
  check('第一格已填入', game.values[a] === shared, `values=${game.values[a]}`);
  place(ctx, b, shared);
  check('第二格已填入', game.values[b] === shared, `values=${game.values[b]}`);
  check('同行重复被标为冲突', game.hasConflict(b), `row ${rowA}`);
  const conflictCount = doc.querySelectorAll('#board .cell.is-conflict').length;
  check('恰好 2 格被标为冲突（只有这两格）', conflictCount === 2,
    String(conflictCount) + ' 冲突格=' + [...doc.querySelectorAll('#board .cell.is-conflict')].map((c) => c.dataset.index).join(','));
  doc.getElementById('btn-undo').click();
  doc.getElementById('btn-undo').click();
  check('撤销后冲突消失', doc.querySelectorAll('#board .cell.is-conflict').length === 0);
  check('撤销后两个格子都清空', game.values[a] === 0 && game.values[b] === 0, `${game.values[a]},${game.values[b]}`);
  currentWin.__dispose();
}

/* ============================================ 3. 提示 / 撤销 / 暂停 */
section('[3] 提示、撤销栈与暂停');
{
  const ctx = loadPage('index.html', '');
  const { doc, S } = ctx;
  const app = S.app;
  const game = freshGame(ctx);
  const cells = cellsOf(doc);

  check('初始状态无提示', game.getHintCount() === 0);
  doc.getElementById('btn-hint').click();
  check('提示填入一个正确数字', game.getHintCount() === 1 && game.values[app.state.selected] === game.solution[app.state.selected],
    `hints=${game.getHintCount()}`);
  check('提示格有独立样式', doc.querySelectorAll('#board .cell.is-hinted').length === 1, String(doc.querySelectorAll('#board .cell.is-hinted').length));
  check('提示计入操作按钮角标', !!doc.getElementById('btn-hint').querySelector('.action__badge'));

  doc.getElementById('btn-hint').click();
  check('第二次提示累加计数', game.getHintCount() === 2, String(game.getHintCount()));
  check('提示后可撤销', game.canUndo());

  doc.getElementById('btn-undo').click();
  check('撤销提示恢复计数', game.getHintCount() === 1, String(game.getHintCount()));
  check('撤销后提示计数同步到角标', doc.getElementById('btn-hint').querySelector('.action__badge').textContent === '1',
    doc.getElementById('btn-hint').querySelector('.action__badge').textContent);
  check('撤销后提示样式减少一格', doc.querySelectorAll('#board .cell.is-hinted').length === 1,
    String(doc.querySelectorAll('#board .cell.is-hinted').length));

  // 暂停：先验证“暂停时输入被忽略”，再验证“点棋盘自动继续”和按钮开关
  doc.getElementById('btn-pause').click();
  check('暂停后状态为暂停', app.state.paused === true);
  check('暂停后出现遮罩', doc.querySelectorAll('.board-veil').length === 1);
  const snapshot = JSON.stringify(game.values);
  keyFor(doc, 1).click();
  check('暂停时忽略数字键输入', JSON.stringify(game.values) === snapshot);

  const beforeCell = app.state.selected;
  cells[[...Array(game.total).keys()].find((i) => !game.values[i])].click();
  check('暂停时点击棋盘会自动继续', app.state.paused === false);
  check('点击棋盘仍会选中格子', app.state.selected !== null);
  renderCurrent(ctx);
  check('继续后遮罩消失', doc.querySelectorAll('.board-veil').length === 0);
  check('点击棋盘确实改变了选中格', app.state.selected !== beforeCell || beforeCell === null);

  doc.getElementById('btn-pause').click();
  check('暂停按钮可再次暂停', app.state.paused === true);
  doc.getElementById('btn-pause').click();
  check('暂停按钮可恢复游戏', app.state.paused === false);
  check('恢复后仍无遮罩', doc.querySelectorAll('.board-veil').length === 0);

  // 暂停时长不计入成绩
  doc.getElementById('btn-restart').click();
  app.state.paused = false;
  sleep(1100);
  doc.getElementById('btn-pause').click();
  const frozen = game.getElapsed();
  check('暂停后用时被冻结', game.getElapsed() === frozen, `${game.getElapsed()} vs ${frozen}`);
  sleep(600);
  check('暂停期间用时不变', game.getElapsed() === frozen, `${game.getElapsed()} vs ${frozen}`);
  doc.getElementById('btn-pause').click();
  sleep(150);
  const resumed = game.getElapsed();
  check('暂停的 0.6 秒没有计入成绩', resumed - frozen <= 1, `增加 ${resumed - frozen} 秒`);
  check('恢复后计时继续走动', app.state.paused === false);

  // 键盘：先确保落在一个空格上
  const blanks = [...Array(game.total).keys()].filter((i) => !game.values[i]);
  app.state.selected = blanks[0];
  const sel = blanks[0];
  const d = game.solution[sel];
  press(doc, String(d));
  check('数字键完成落子', game.values[sel] === d, `values=${game.values[sel]}`);
  press(doc, 'z');
  check('Z 键撤销', game.values[sel] === 0, `values=${game.values[sel]}`);
  press(doc, 'ArrowRight');
  check('方向键可以移动选中格', app.state.selected !== null, String(app.state.selected));
  press(doc, 'n');
  check('N 键切换标记模式', app.state.notesMode === true);
  press(doc, 'n');
  check('N 键再次关闭标记模式', app.state.notesMode === false);
  press(doc, ' ');
  check('空格暂停', app.state.paused === true);
  press(doc, ' ');
  check('空格取消暂停', app.state.paused === false);
  const before9 = JSON.stringify(game.values);
  press(doc, '9');
  check('超出规格的数字被忽略（6x6 按 9）', JSON.stringify(game.values) === before9);
  currentWin.__dispose();
}

/* ============================================ 4. 通关结算 */
section('[4] 通关结算与打卡记录');
{
  const ctx = loadPage('index.html', '');
  const { doc, S } = ctx;
  const app = S.app;
  const game = freshGame(ctx);

  // 走到只差一格
  let guard = 0;
  while (guard++ < 300) {
    const empties = [...Array(game.total).keys()].filter((i) => game.values[i] !== game.solution[i]);
    if (empties.length <= 1) break;
    game.input(empties[0], game.solution[empties[0]], false);
  }
  const last = [...Array(game.total).keys()].find((i) => game.values[i] !== game.solution[i]);
  check('推进到只差一格', last !== undefined && !game.isSolved());
  check('推进过程未触发结算', app.state.finished === false);

  // 用真实点击完成最后一格
  cellsOf(doc)[last].click();
  keyFor(doc, game.solution[last]).click();

  check('引擎判定完成', game.isSolved());
  check('结算标记已置位', app.state.finished === true);
  check('结算写入每日打卡', S.stats.isDailyDone(S.dates.todayKey()),
    JSON.stringify(S.stats.dailyRecord(S.dates.todayKey())));
  check('连续打卡计数为 1', S.stats.streak() === 1, String(S.stats.streak()));
  check('结算后清除进行中存档', !S.stats.loadGame(app._internals.makeSaveKey(game.size)));
  check('完成弹窗已打开', doc.getElementById('modal').classList.contains('is-open'));
  check('完成弹窗显示用时', /用时|难度|提示/.test(doc.getElementById('modal-stats').textContent));
  check('棋盘出现完成遮罩', doc.querySelectorAll('.board-veil').length === 1);
  check('完成后数字键角标归零', [...doc.querySelectorAll('#keypad .key__count')].every((c) => c.textContent === '' || c.textContent === '0'),
    [...doc.querySelectorAll('#keypad .key__count')].map((c) => c.textContent).join(','));

  doc.getElementById('modal-primary').click();
  check('点击再来一题切换到不限模式', app.state.mode === 'practice', app.state.mode);
  check('切换后弹窗关闭', !doc.getElementById('modal').classList.contains('is-open'));
  check('不限模式显示难度选择器', doc.getElementById('difficulty').hidden === false);
  currentWin.__dispose();
}

/* ============================================ 5. 难度调节 */
section('[5] 难度调节：任何模式下都能直接开局');
{
  // 5a) 每日模式下点难度：应切到不限模式并开出该难度的题
  const ctx = loadPage('index.html', '');
  const { doc, S } = ctx;
  const app = S.app;
  freshGame(ctx);
  check('初始为每日模式', app.state.mode === 'daily', app.state.mode);

  const pickDifficulty = (key) => doc.getElementById('difficulty')
    .querySelector(`button[data-difficulty="${key}"]`).click();

  S.DIFFICULTY_ORDER.forEach((key) => {
    pickDifficulty(key);
    const g = app.state.game;
    check(`点「${S.DIFFICULTY_LABEL[key]}」开出该难度的题`, g.difficulty === key,
      `mode=${app.state.mode} difficulty=${g.difficulty}`);
  });
  check('点难度后自动切到不限模式', app.state.mode === 'practice', app.state.mode);
  check('顶栏高亮同步到不限', doc.querySelectorAll('#nav a.is-active').length === 1 &&
    doc.querySelector('#nav a.is-active').dataset.mode === 'practice',
    doc.querySelector('#nav a.is-active').dataset.mode);
  check('激活态跟着走', doc.getElementById('difficulty')
    .querySelector('button[data-difficulty="expert"]').classList.contains('is-active'));
  check('难度说明已切换为不限模式文案', /即刻换一题|当前难度/.test(doc.getElementById('difficulty-hint').textContent),
    doc.getElementById('difficulty-hint').textContent);
  check('每日模式的「今日」标记已移除', !/今日/.test(doc.getElementById('difficulty').textContent),
    doc.getElementById('difficulty').textContent);
  currentWin.__dispose();
}

{
  // 5b) 每日挑战模式点难度也应可用
  const ctx = loadPage('index.html', '?mode=hard');
  const { doc, S } = ctx;
  const app = S.app;
  freshGame(ctx);
  check('每日挑战模式为专家难度', app.state.game.difficulty === 'expert', app.state.game.difficulty);
  check('每日挑战模式难度选择器可用', doc.getElementById('difficulty').hidden === false);
  doc.getElementById('difficulty').querySelector('button[data-difficulty="easy"]').click();
  check('挑战模式点入门可开局', app.state.game.difficulty === 'easy' && app.state.mode === 'practice',
    `mode=${app.state.mode} difficulty=${app.state.game.difficulty}`);
  currentWin.__dispose();
}

{
  // 5c) 9x9 下的难度与已知数梯度
  const ctx = loadPage('index.html', '?mode=practice&size=9');
  const { doc, S } = ctx;
  const app = S.app;
  let game = freshGame(ctx);

  check('9x9 开局成功', game.size === 9, String(game.size));
  check('9x9 棋盘渲染 81 格', cellsOf(doc).length === 81, String(cellsOf(doc).length));
  check('9x9 数字键盘为 1-9 + 擦除', doc.querySelectorAll('#keypad .key').length === 10);
  check('状态栏显示 9×9', doc.getElementById('chip-board').textContent === '9×9', doc.getElementById('chip-board').textContent);
  check('9x9 宫格分隔为 3x3', doc.querySelectorAll('#board .cell.box-right').length === 18, String(doc.querySelectorAll('#board .cell.box-right').length));
  const solved = S.Generator.solve(game.givens, 9);
  check('9x9 题面可解且与给定解一致', solved && S.Generator.gridToString(solved) === S.Generator.gridToString(game.solution));

  const before = S.Generator.gridToString(game.givens);
  doc.getElementById('difficulty').querySelector('button[data-difficulty="expert"]').click();
  game = app.state.game;
  check('切换难度后题目更新', S.Generator.gridToString(game.givens) !== before);
  check('切换难度后难度正确', game.difficulty === 'expert', game.difficulty);
  check('专家难度已知数更少', game.givens.filter((v) => v > 0).length <= 29, String(game.givens.filter((v) => v > 0).length));
  check('侧栏含各难度最佳成绩', doc.querySelectorAll('#side .shortcuts').length >= 1);

  const clueCounts = [];
  S.DIFFICULTY_ORDER.forEach((key) => {
    doc.getElementById('difficulty').querySelector(`button[data-difficulty="${key}"]`).click();
    clueCounts.push(app.state.game.givens.filter((v) => v > 0).length);
  });
  check('四档已知数依次递减（入门 > 进阶 > 困难 > 专家）',
    clueCounts.every((c, i) => i === 0 || c < clueCounts[i - 1]), clueCounts.join(' > '));
  currentWin.__dispose();
}

/* ============================================ 6. 存档恢复与规格切换 */
section('[6] 存档恢复与规格切换');
{
  const ctx = loadPage('index.html', '?mode=practice');
  const { doc, S } = ctx;
  const game = freshGame(ctx);
  const puzzleBefore = S.Generator.gridToString(game.givens);
  const idx = [...Array(game.total).keys()].find((i) => !game.values[i]);
  const digit = game.solution[idx];

  cellsOf(doc)[idx].click();
  keyFor(doc, digit).click();
  check('落子已写入', game.values[idx] === digit);
  check('落子已写入存档', !!S.stats.loadGame(S.app._internals.makeSaveKey(6)));

  // 重新加载同一页面（复用同一份 localStorage，模拟浏览器刷新）
  const second = loadPage('index.html', '?mode=practice', true);
  const game2 = second.S.app.state.game;
  check('重新加载恢复同一道题', S.Generator.gridToString(game2.givens) === puzzleBefore);
  check('重新加载恢复已填内容', game2.values[idx] === digit, `values=${game2.values[idx]}`);
  check('重新加载不新增已完成记录', S.stats.isDailyDone(S.dates.todayKey()) === false);

  const side = second.doc.getElementById('side');
  side.querySelectorAll('[data-size]').find((b) => Number(b.dataset.size) === 9).click();
  check('侧栏可切换到 9x9', second.S.app.state.game.size === 9, String(second.S.app.state.game.size));
  check('9x9 使用独立存档键', second.S.app._internals.makeSaveKey(9) === 'practice:9');
  side.querySelectorAll('[data-size]').find((b) => Number(b.dataset.size) === 6).click();
  const game3 = second.S.app.state.game;
  check('切回 6x6 恢复原进度', game3.size === 6 && game3.values[idx] === digit, `size=${game3.size} v=${game3.values[idx]}`);
  check('设置里记住规格', S.settings.get('size') === 6, String(S.settings.get('size')));
  currentWin.__dispose();
}

/* ============================================ 7. 设置开关 */
section('[7] 设置开关');
{
  const ctx = loadPage('index.html', '?mode=practice');
  const { doc, S } = ctx;
  const game = freshGame(ctx);
  const side = doc.getElementById('side');

  const sw = side.querySelector('[data-setting="autoNotes"]');
  check('设置开关初始为开', S.settings.get('autoNotes') === true && sw.getAttribute('aria-checked') === 'true');
  sw.click();
  check('点击开关可关闭设置', S.settings.get('autoNotes') === false);
  check('开关状态同步到 aria', sw.getAttribute('aria-checked') === 'false');

  const conflictSw = side.querySelector('[data-setting="showConflicts"]');
  conflictSw.click();
  check('冲突提示开关可关闭', S.settings.get('showConflicts') === false);
  check('关闭后重渲染正常', cellsOf(doc).length === 36);

  // 关闭自动清理后应保留同行标记（标记数字用 1，注意 digit=0 是擦除）
  S.app.state.notesMode = false;
  const target = [...Array(game.total).keys()].find((i) => !game.values[i]);
  const peer = [...Array(game.total).keys()].find((i) => i !== target && !game.values[i] &&
    Math.floor(i / game.size) === Math.floor(target / game.size));
  game.input(peer, 1, true);
  const marked = game.notes[peer];
  check('同行格已打上标记', marked !== 0, String(marked));
  check('标记内容为刚标记的数字', noteDigitsOf(marked, game.size).join(',') === '1', noteDigitsOf(marked, game.size).join(','));

  const extraDigit = 2;
  game.input(peer, extraDigit, true);
  const markedBoth = game.notes[peer];
  check('同一格可标记多个候选', noteDigitsOf(markedBoth, game.size).length === 2, noteDigitsOf(markedBoth, game.size).join(','));

  const targetDigit = game.solution[target];
  game.input(target, targetDigit, false);
  check('关闭自动清理后同行标记完全保留', game.notes[peer] === markedBoth, `${game.notes[peer]} vs ${markedBoth}`);

  S.settings.set('autoNotes', true);
  game.restart();
  const idx2 = [...Array(game.total).keys()].find((i) => !game.values[i]);
  const peer2 = [...Array(game.total).keys()].find((i) => i !== idx2 && !game.values[i] &&
    Math.floor(i / game.size) === Math.floor(idx2 / game.size));
  const d2 = game.solution[idx2];
  game.input(peer2, d2, true);
  const marked2 = game.notes[peer2];
  check('开启自动清理前标记已存在', marked2 === (1 << (d2 - 1)), String(marked2));
  game.input(idx2, d2, false);
  check('开启自动清理后同行同数字标记被清掉', game.notes[peer2] === 0, `${game.notes[peer2]} / 原 ${marked2}`);
  currentWin.__dispose();
}

/* ============================================ 8. 配色主题 */
section('[8] 配色主题');
{
  const ctx = loadPage('index.html', '?mode=practice');
  const { doc, S } = ctx;
  freshGame(ctx);
  const side = doc.getElementById('side');
  const root = doc.documentElement;

  const swatches = side.querySelectorAll('.theme-swatch[data-theme]');
  check('主题选择器渲染出全部主题', swatches.length === S.THEMES.length,
    `${swatches.length} vs ${S.THEMES.length}`);
  check('默认主题高亮「清爽」',
    side.querySelector('.theme-swatch[data-theme="default"]').classList.contains('is-active'));
  check('默认主题不写 data-theme 属性', !root.getAttribute('data-theme'),
    String(root.getAttribute('data-theme')));

  S.THEMES.forEach(function (theme) {
    // 选择器带上 .theme-swatch，避免把根元素上的 data-theme 也当成候选
    const sel = `.theme-swatch[data-theme="${theme.id}"]`;
    const btn = side.querySelector(sel);
    check(`渲染出「${theme.label}」主题`, !!btn);
    if (!btn) return;
    btn.click();
    const applied = theme.id === 'default' ? null : theme.id;
    check(`点「${theme.label}」→ data-theme 正确`, root.getAttribute('data-theme') === applied,
      `${root.getAttribute('data-theme')} vs ${applied}`);
    check(`点「${theme.label}」→ 写入设置`, S.settings.get('theme') === theme.id, S.settings.get('theme'));
    check(`点「${theme.label}」→ 高亮切换`,
      side.querySelector(sel).classList.contains('is-active'));
    check(`点「${theme.label}」→ 只有一个高亮`,
      side.querySelectorAll('.theme-swatch.is-active').length === 1,
      String(side.querySelectorAll('.theme-swatch.is-active').length));
    check(`点「${theme.label}」→ color-scheme 同步`, root.style.colorScheme === theme.scheme,
      `${root.style.colorScheme} vs ${theme.scheme}`);
    const dot = side.querySelector(sel + ' .theme-swatch__dot');
    check(`点「${theme.label}」→ 预览色正确`, sameColor(dot.style.background, theme.swatch),
      'got=' + JSON.stringify(dot.style.background) + ' 期望=' + theme.swatch);
  });

  check('暗夜主题可被识别为深色', S.themeInfo('dark').scheme === 'dark');

  // 明确切到暗夜再刷新，验证主题持久化（不依赖上面循环的落点）
  S.settings.set('theme', 'dark');
  const ctx2 = loadPage('index.html', '?mode=practice', true);
  check('刷新后保留暗夜主题', ctx2.S.settings.get('theme') === 'dark', ctx2.S.settings.get('theme'));
  check('刷新后 data-theme 直接生效', ctx2.doc.documentElement.getAttribute('data-theme') === 'dark',
    String(ctx2.doc.documentElement.getAttribute('data-theme')));
  check('刷新后主题选择器高亮正确',
    ctx2.doc.querySelector('.theme-swatch[data-theme="dark"]').classList.contains('is-active'));

  // 未知主题名要能回退，而不是把界面弄成无色
  check('未知主题名回退到清爽', ctx2.S.themeInfo('not-a-theme').id === 'default',
    String(ctx2.S.themeInfo('not-a-theme').id));
  ctx2.S.settings.set('theme', 'default');
  check('切回默认主题会移除 data-theme', !ctx2.doc.documentElement.getAttribute('data-theme'));
  currentWin.__dispose();
}

/* ============================================ 9. 往期档案页 */
section('[9] 往期档案页与「玩某一期」不再互相跳转');
{
  const ctx = loadPage('archive.html', '');
  const { doc, S } = ctx;
  check('档案页渲染 30 天卡片', doc.querySelectorAll('.day-card').length === 30, String(doc.querySelectorAll('.day-card').length));
  check('区间切换按钮存在', doc.querySelectorAll('#range-picker button').length === 3);
  doc.querySelectorAll('#range-picker button')[0].click();
  check('切换到近 7 天后卡片数量更新', doc.querySelectorAll('.day-card').length === 7, String(doc.querySelectorAll('.day-card').length));
  check('总览指标渲染 4 项', doc.querySelectorAll('#archive-metrics .metric').length === 4);
  check('小日历渲染 7 格', doc.querySelectorAll('#archive-week .week__day').length === 7);
  const first = doc.querySelectorAll('.day-card')[0];
  check('今天卡片指向默认入口（不带 mode=archive）', first.href === 'index.html', first.href);
  check('卡片显示期号与难度', ISSUE_RE.test(first.textContent), first.textContent.trim().slice(0, 60));
  check('导航高亮往期', doc.querySelectorAll('#nav a.is-active').length === 1);
  check('今天标记为 is-today', doc.querySelectorAll('.day-card.is-today').length === 1);

  // 关键回归：往期卡片必须带 mode=archive，否则点进去会开成今天的题
  const otherDay = doc.querySelectorAll('.day-card')[1];
  check('往期卡片带 mode=archive', /\?mode=archive&date=\d{4}-\d{2}-\d{2}/.test(otherDay.href), otherDay.href);
  check('往期卡片日期正确', otherDay.href.endsWith(S.dates.shift(S.dates.todayKey(), -1)), otherDay.href);

  const yesterday = S.dates.shift(S.dates.todayKey(), -1);
  S.stats.completeDaily(yesterday, { time: 42, difficulty: 'easy', hints: 0, mistakes: 0 });
  doc.querySelectorAll('#range-picker button')[0].click();
  check('完成过的日期带对勾', doc.querySelectorAll('.day-card__badge').length === 1, String(doc.querySelectorAll('.day-card__badge').length));
  check('档案页不再自作主张跳转', !archiveRedirected(ctx), '不应发生跳转');
  currentWin.__dispose();
}

/* ============================================ 10. 玩某一期（回归） */
section('[10] 打开指定日期不再来回跳转');
{
  const pastDate = '2025-06-15';
  const ctx = loadPage('index.html', '?mode=archive&date=' + pastDate);
  const { doc, S } = ctx;
  const app = S.app;

  check('没有跳到 archive.html（关键回归）', !archiveRedirected(ctx),
    '若发生跳转，界面会在档案页与题目页之间反复刷新');
  check('模式为 archive', app.state.mode === 'archive', app.state.mode);
  check('日期就是指定的那一天', app.state.date === pastDate, app.state.date);
  check('对局已正常创建', !!app.state.game && app.state.game.size === 6, app.state.game.size);
  check('棋盘已渲染', doc.querySelectorAll('#board .cell').length === 36, String(doc.querySelectorAll('#board .cell').length));
  check('状态栏显示该日期与期号', /6月15日/.test(doc.getElementById('chip-meta').textContent) &&
    ISSUE_RE.test(doc.getElementById('chip-meta').textContent), doc.getElementById('chip-meta').textContent);
  check('难度为该日期的星期难度', app.state.game.difficulty === S.dailyDifficulty(pastDate),
    `${app.state.game.difficulty} vs ${S.dailyDifficulty(pastDate)}`);

  const ctx2 = loadPage('index.html', '?mode=archive&date=' + pastDate, true);
  check('同一天复现同一题面',
    S.Generator.gridToString(ctx2.S.app.state.game.givens) === S.Generator.gridToString(app.state.game.givens));

  const game = ctx2.S.app.state.game;
  const idx = [...Array(game.total).keys()].find((i) => !game.values[i]);
  const digit = game.solution[idx];
  ctx2.doc.querySelectorAll('#board .cell')[idx].click();
  ctx2.doc.getElementById('keypad').querySelectorAll('.key')
    .find((k) => Number(k.dataset.digit) === digit).click();
  check('往期题目可以落子', game.values[idx] === digit, `values=${game.values[idx]}`);
  check('往期存档键包含日期', ctx2.S.app._internals.makeSaveKey(6) === 'archive:' + pastDate + ':6',
    ctx2.S.app._internals.makeSaveKey(6));

  const ctx3 = loadPage('index.html', '?mode=archive&date=' + pastDate, true);
  check('刷新后仍是同一期', ctx3.S.app.state.date === pastDate && ctx3.S.app.state.mode === 'archive',
    `${ctx3.S.app.state.mode} / ${ctx3.S.app.state.date}`);
  check('刷新后恢复该期进度', ctx3.S.app.state.game.values[idx] === digit,
    `values=${ctx3.S.app.state.game.values[idx]}`);

  const g3 = ctx3.S.app.state.game;
  let guard = 0;
  while (!g3.isSolved() && guard++ < 300) {
    const i = [...Array(g3.total).keys()].find((k) => g3.values[k] !== g3.solution[k]);
    if (i === undefined) break;
    g3.input(i, g3.solution[i], false);
  }
  check('往期题可以完成', g3.isSolved());
  currentWin.__dispose();
}

/* ============================================ 11. URL 同步 */
section('[11] URL 同步与刷新');
{
  const ctx = loadPage('index.html', '');
  const { doc, S } = ctx;
  freshGame(ctx);

  const urls = [];
  const origReplace = ctx.win.history.replaceState;
  ctx.win.history.replaceState = (a, b, url) => { urls.push(url); return origReplace.call(ctx.win.history, a, b, url); };

  check('打开每日题时 URL 不带多余参数',
    urls.length === 0 || /^(|\?size=\d+)$/.test(urls[urls.length - 1] || '') || ctx.win.location.search === '',
    JSON.stringify(urls[urls.length - 1]));

  doc.getElementById('difficulty').querySelector('button[data-difficulty="hard"]').click();
  const lastUrl = urls[urls.length - 1];
  check('切到不限模式后 URL 写入 mode=practice', /mode=practice/.test(lastUrl), lastUrl);
  check('不限模式 URL 不含 date', !/date=/.test(lastUrl), lastUrl);
  check('不限模式 URL 带 difficulty', /difficulty=hard/.test(lastUrl), lastUrl);

  const search = lastUrl.slice(lastUrl.indexOf('?'));
  const ctx2 = loadPage('index.html', search);
  check('刷新后仍是不限模式', ctx2.S.app.state.mode === 'practice', ctx2.S.app.state.mode);
  check('刷新后仍记住难度', ctx2.S.app.state.game.difficulty === 'hard', ctx2.S.app.state.game.difficulty);
  currentWin.__dispose();
}

console.log(failures === 0 ? `\n✅ 全部通过（${passes} 项断言）` : `\n❌ 失败 ${failures} 项 / 通过 ${passes} 项`);
process.exit(failures === 0 ? 0 : 1);
