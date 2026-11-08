/*!
 * make-diagnose.mjs — 生成环境诊断页
 *
 * 把真实的 index.html 原样复制，只在最前面注入错误捕获、在末尾注入诊断脚本，
 * 因此诊断页与线上页面完全同构。用浏览器打开它，页面会直接显示：
 *   脚本是否加载 → 应用是否初始化 → 界面元素是否渲染 → 样式是否生效 → 捕获到的报错
 *
 * 用法：node tools/make-diagnose.mjs   然后打开 .tmp/diagnose.html
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.tmp');
mkdirSync(outDir, { recursive: true });

let html = readFileSync(join(root, 'index.html'), 'utf8');

// 1) 在任何业务脚本之前装好错误捕获
const earlyCatch = `<script>
window.__diagErrors = [];
window.onerror = function (msg, src, line, col) {
  window.__diagErrors.push(msg + '  @ ' + String(src || '').split('/').pop() + ':' + line + ':' + col);
  return false;
};
window.addEventListener('unhandledrejection', function (e) {
  window.__diagErrors.push('Promise 未处理: ' + ((e.reason && e.reason.message) || e.reason));
});
</script>
`;
html = html.replace('<link rel="stylesheet" href="css/main.css">', earlyCatch + '<link rel="stylesheet" href="css/main.css">');

// 2) 末尾注入诊断脚本
const probe = `<script>
(function () {
  var lines = [];
  function log(t) { lines.push(t); }
  function ok(label, detail) { log('  \\u2705 ' + label + (detail === undefined ? '' : '  ' + detail)); }
  function bad(label, detail) { log('  \\u274c ' + label + (detail === undefined ? '' : '  ' + detail)); }
  function mark(cond, label, detail) { (cond ? ok : bad)(label, detail); }

  function finish(title) {
    log('');
    log('协议: ' + location.protocol + '     视口: ' + window.innerWidth + 'x' + window.innerHeight);
    log('地址: ' + location.href);
    log('');
    log('结果: ' + title);
    var pre = document.getElementById('diag-out');
    pre.innerHTML = lines.join('\\n')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/\\u2705/g, '<span style="color:#57d9a3">\\u2705</span>')
      .replace(/\\u274c/g, '<span style="color:#ff8a7a">\\u274c</span>');
    document.title = '诊断: ' + title;
  }

  window.addEventListener('load', function () { setTimeout(run, 600); });

  function run() {
    var errors = window.__diagErrors || [];

    log('【1】基础环境');
    ok('页面脚本可以执行');
    try { ok('localStorage 可访问', '已有 ' + localStorage.length + ' 条'); }
    catch (e) { bad('localStorage 被拒绝', e.name + ': ' + e.message); }
    log('    注意：直接用 file:// 打开时，部分浏览器会限制本地存储（站点有内存兜底，不影响玩）');

    log('');
    log('【2】页面脚本是否加载');
    var S = window.Sudoku;
    mark(!!S, 'window.Sudoku 命名空间', typeof S);
    if (!S) { log(''); log('  → 页面脚本完全没有执行，说明 <script src> 没有加载成功'); return finish('页面脚本未加载'); }
    mark(!!S.dates, 'core.js');
    mark(!!S.Generator, 'generator.js');
    mark(!!S.createGame, 'game.js');
    mark(!!S.stats, 'stats.js');
    mark(!!S.ui, 'ui.js');
    mark(!!S.app, 'app.js');

    log('');
    log('【3】应用是否完成初始化');
    var app = S.app;
    if (!app) { log('  → app.js 执行失败'); return finish('app.js 失败'); }
    var game = app.state && app.state.game;
    mark(!!game, '对局对象', game ? game.size + 'x' + game.size : '无');
    if (!game) { log('  → boot() 中途抛错，界面不会被填充'); return finish('初始化中断'); }

    log('');
    log('【4】界面元素是否渲染');
    var boardCells = document.querySelectorAll('#board .cell').length;
    var keypadKeys = document.querySelectorAll('#keypad .key').length;
    var diffBtns = document.querySelectorAll('#difficulty button').length;
    var sideCards = document.querySelectorAll('#side .card').length;
    mark(boardCells > 0, '棋盘格子', boardCells + ' 个');
    mark(keypadKeys > 0, '数字键', keypadKeys + ' 个');
    mark(diffBtns > 0, '难度按钮', diffBtns + ' 个');
    mark(sideCards > 0, '侧栏卡片', sideCards + ' 张');

    log('');
    log('【5】样式是否加载');
    var link = document.querySelector('link[href*="main.css"]');
    mark(!!link, '已引用 main.css', link ? link.getAttribute('href') : '未找到');
    var cell = document.querySelector('#board .cell');
    if (cell) {
      var w = cell.getBoundingClientRect().width;
      var h = cell.getBoundingClientRect().height;
      mark(w > 10 && h > 10, '格子有实际尺寸', w.toFixed(1) + ' x ' + h.toFixed(1));
      mark(getComputedStyle(cell).boxSizing !== '', '样式表已生效', 'box-sizing=' + getComputedStyle(cell).boxSizing);
    } else {
      bad('没有格子可测样式');
    }
    var key = document.querySelector('#keypad .key');
    if (key) mark(key.getBoundingClientRect().height > 10, '数字键有实际尺寸',
      key.getBoundingClientRect().height.toFixed(1) + 'px');

    log('');
    log('【6】捕获到的脚本错误');
    if (errors.length === 0) ok('没有脚本错误');
    else errors.forEach(function (e) { bad(e); });

    var fatal = errors.length > 0 || boardCells === 0 || keypadKeys === 0 || !game;
    finish(fatal ? '发现问题 —— 请把上面内容截图发我' : '一切正常');
  }
})();
</script>
`;
html = html.replace('</body>', probe + '</body>');

// 3) 面板样式（覆盖在页面底部，不影响页面自身渲染）
html = html.replace('</head>', `<style>
#diag-out { position: fixed; left: 0; right: 0; bottom: 0; z-index: 99999; margin: 0;
  max-height: 56vh; overflow: auto; padding: 14px 18px; background: #0f172a; color: #dbeafe;
  font: 12.5px/1.7 ui-monospace, Consolas, monospace; white-space: pre-wrap;
  border-top: 3px solid #2563eb; box-shadow: 0 -8px 30px rgba(0,0,0,.35); }
</style></head>`);
html = html.replace('<body>', '<body>\n<pre id="diag-out">诊断运行中…</pre>');

writeFileSync(join(outDir, 'diagnose.html'), html, 'utf8');
console.log('已生成 .tmp/diagnose.html —— 用浏览器打开即可看到诊断结论。');
