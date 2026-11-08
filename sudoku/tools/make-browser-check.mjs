/*!
 * make-browser-check.mjs — 生成浏览器自检页
 *
 * Node 桩件能验证逻辑与 DOM 结构，但验证不了真实布局与层叠样式。
 * 这个脚本把真实的 index.html 原样复制一份，只在末尾追加一段断言脚本，
 * 因此自检页永远不会和线上页面脱节；用浏览器打开即可核对视觉与像素。
 *
 * 用法：node tools/make-browser-check.mjs  然后用浏览器打开 .tmp/browser-check.html
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.tmp');
mkdirSync(outDir, { recursive: true });

const html = readFileSync(join(root, 'index.html'), 'utf8');

const probe = `
<script>
/* ============ 浏览器自检（由 tools/make-browser-check.mjs 注入） ============ */
(function () {
  var failures = 0, passes = 0, lines = [];
  var errors = [];
  window.addEventListener('error', function (e) { errors.push(String(e.message)); });

  function check(label, ok, extra) {
    if (ok) { passes++; lines.push('  \\u2705 ' + label); }
    else { failures++; lines.push('  \\u274c ' + label + (extra ? '  [' + extra + ']' : '')); }
  }

  function run() {
    var S = window.Sudoku, app = S.app, game = app.state.game;
    var board = document.getElementById('board');
    var cell = board.querySelector('.cell');
    var cellBox = cell.getBoundingClientRect();

    lines.push('\\n[布局与像素]');
    check('棋盘使用 grid 布局', getComputedStyle(board).display === 'grid', getComputedStyle(board).display);
    check('格子是正方形', Math.abs(cellBox.width - cellBox.height) < 1.5,
      cellBox.width.toFixed(2) + ' x ' + cellBox.height.toFixed(2));
    check('格子边长合理 (32-72px)', cellBox.width >= 32 && cellBox.width <= 72, cellBox.width.toFixed(1));
    check('棋盘完整渲染 ' + game.total + ' 格', board.querySelectorAll('.cell').length === game.total);
    check('页面没有横向滚动', document.documentElement.scrollWidth <= window.innerWidth + 1,
      document.documentElement.scrollWidth + ' vs ' + window.innerWidth);
    check('棋盘未超出视口右侧', board.getBoundingClientRect().right <= window.innerWidth + 1,
      board.getBoundingClientRect().right.toFixed(0) + ' vs ' + window.innerWidth);

    var keyBox = document.querySelector('#keypad .key').getBoundingClientRect();
    check('数字键高度 >= 40px（好点）', keyBox.height >= 40, keyBox.height.toFixed(1));
    var actionBox = document.querySelector('.action').getBoundingClientRect();
    check('操作按钮高度 >= 40px', actionBox.height >= 40, actionBox.height.toFixed(1));

    // 颜色与高亮：必须在真实层叠样式下验证
    lines.push('\\n[配色与高亮]');
    var givenCell = board.querySelector('.cell.is-given');
    var givenColor = getComputedStyle(givenCell.querySelector('.cell__value')).color;
    var cells = board.querySelectorAll('.cell');
    var firstEmpty = 0;
    while (game.values[firstEmpty]) firstEmpty++;
    var digit = game.solution[firstEmpty];
    cells[firstEmpty].click();
    var selBox = getComputedStyle(cells[firstEmpty]);
    check('选中格有明显底色', selBox.backgroundColor !== 'rgba(0, 0, 0, 0)', selBox.backgroundColor);
    check('选中格有内描边', selBox.boxShadow !== 'none', selBox.boxShadow);
    check('行列表头（同行）被高亮', board.querySelectorAll('.cell.is-peer').length > 0,
      String(board.querySelectorAll('.cell.is-peer').length));
    check('同宫被高亮', board.querySelectorAll('.cell.is-box').length > 0,
      String(board.querySelectorAll('.cell.is-box').length));

    var keys = document.querySelectorAll('#keypad .key[data-digit]');
    function keyFor(d) { for (var i = 0; i < keys.length; i++) if (Number(keys[i].dataset.digit) === d) return keys[i]; }
    keyFor(digit).click();
    var userColor = getComputedStyle(cells[firstEmpty].querySelector('.cell__value')).color;
    check('玩家数字与题面数字配色不同', userColor !== givenColor, userColor + ' vs ' + givenColor);
    check('玩家数字清晰可见', userColor !== 'rgba(0, 0, 0, 0)', userColor);

    // 宫格粗线：检查边框宽度真的有区别
    lines.push('\\n[宫格分隔线]');
    var strong = board.querySelector('.cell.box-right');
    var weak = board.querySelector('.cell:not(.box-right):not(.last-col)');
    check('存在宫格粗分隔线', !!strong && !!weak);
    if (strong && weak) {
      var sw = parseFloat(getComputedStyle(strong).borderRightWidth);
      var ww = parseFloat(getComputedStyle(weak).borderRightWidth);
      check('粗线比细线更粗', sw > ww, sw + 'px vs ' + ww + 'px');
    }
    check('棋盘外框为深色粗边', parseFloat(getComputedStyle(board).borderTopWidth) >= 2,
      getComputedStyle(board).borderTopWidth);

    // 冲突配色
    lines.push('\\n[冲突提示]');
    var empties = [];
    for (var i = 0; i < game.total; i++) if (!game.values[i]) empties.push(i);
    var a = empties[0];
    var rowA = Math.floor(a / game.size);
    var boxA = Math.floor((a % game.size) / game.boxCols);
    var b = null;
    for (var j = 0; j < empties.length; j++) {
      var e = empties[j];
      if (e !== a && Math.floor(e / game.size) === rowA &&
          Math.floor((e % game.size) / game.boxCols) !== boxA) { b = e; break; }
    }
    if (b !== null) {
      cells[a].click(); keyFor(3).click();
      cells[b].click(); keyFor(3).click();
      var conflict = board.querySelector('.cell.is-conflict');
      check('重复数字被标为冲突', !!conflict);
      if (conflict) {
        var cColor = getComputedStyle(conflict.querySelector('.cell__value')).color;
        var m = cColor.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
        check('冲突数字为暖色（偏红）', m && Number(m[1]) > Number(m[3]) + 40, cColor);
      }
      document.getElementById('btn-undo').click();
      document.getElementById('btn-undo').click();
    }

    // 弹窗与侧栏
    lines.push('\\n[界面结构]');
    check('侧栏卡片数量合理', document.querySelectorAll('#side .card').length >= 4,
      String(document.querySelectorAll('#side .card').length));
    check('顶栏导航高亮当前模式', document.querySelectorAll('#nav a.is-active').length === 1);
    check('完成弹窗初始关闭', !document.getElementById('modal').classList.contains('is-open'));
    check('计时器格式为 MM:SS', /^\\d{2}:\\d{2}$/.test(document.getElementById('timer').textContent),
      document.getElementById('timer').textContent);
    check('数字键有剩余数角标', !!document.querySelector('#keypad .key__count'));

    // 主题：真实浏览器里验证 data-theme 是否真的改变了渲染结果
    lines.push('\\n[配色主题]');
    var S2 = window.Sudoku;
    var swatches = document.querySelectorAll('.theme-swatch[data-theme]');
    check('渲染出全部主题色卡', swatches.length === S2.THEMES.length,
      swatches.length + ' vs ' + S2.THEMES.length);
    check('每个色卡都有预览色', Array.prototype.every.call(swatches, function (s) {
      var d = s.querySelector('.theme-swatch__dot');
      return d && getComputedStyle(d).backgroundColor !== 'rgba(0, 0, 0, 0)';
    }));

    // 逐个切换，确认根元素属性、color-scheme 与背景色都真的变了
    var seenBgs = {};
    S2.THEMES.forEach(function (theme) {
      var btn = document.querySelector('.theme-swatch[data-theme="' + theme.id + '"]');
      if (!btn) { check('存在「' + theme.label + '」色卡', false); return; }
      btn.click();
      var rootAttr = document.documentElement.getAttribute('data-theme');
      check('「' + theme.label + '」写入 data-theme',
        theme.id === 'default' ? !rootAttr : rootAttr === theme.id, String(rootAttr));
      check('「' + theme.label + '」color-scheme 为 ' + theme.scheme,
        document.documentElement.style.colorScheme === theme.scheme,
        document.documentElement.style.colorScheme);
      var boardBg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      check('「' + theme.label + '」--bg 已切换', !!boardBg && !seenBgs[boardBg], boardBg);
      seenBgs[boardBg] = theme.id;

      // 关键元素在主题下都要有非透明底色，避免某个主题漏了令牌
      var panelBg = getComputedStyle(document.querySelector('.board-panel')).backgroundColor;
      check('「' + theme.label + '」棋盘卡片底色不透明', panelBg !== 'rgba(0, 0, 0, 0)', panelBg);
      var cellBg = getComputedStyle(document.querySelector('#board .cell')).backgroundColor;
      check('「' + theme.label + '」格子底色不透明', cellBg !== 'rgba(0, 0, 0, 0)', cellBg);
      var givenColor = getComputedStyle(document.querySelector('#board .cell.is-given .cell__value')).color;
      check('「' + theme.label + '」题面数字有颜色', givenColor !== 'rgba(0, 0, 0, 0)', givenColor);
    });

    // 暗夜主题下，文字应比底色亮（对比方向正确）
    var darkBtn = document.querySelector('.theme-swatch[data-theme="dark"]');
    if (darkBtn) {
      darkBtn.click();
      var lum = function (c) {
        var m = c.match(/(\\d+),\\s*(\\d+),\\s*(\\d+)/);
        return m ? (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) : null;
      };
      var textL = lum(getComputedStyle(document.body).color);
      var bgL = lum(getComputedStyle(document.body).backgroundColor);
      check('暗夜主题是深底浅字', textL !== null && bgL !== null && textL > bgL,
        'text=' + Math.round(textL) + ' bg=' + Math.round(bgL));
    }
    // 恢复默认主题，避免留下副作用
    var defBtn = document.querySelector('.theme-swatch[data-theme="default"]');
    if (defBtn) defBtn.click();

    lines.push('\\n[运行时错误]');
    check('没有未捕获的脚本错误', errors.length === 0, errors.join(' | '));

    lines.push('');
    lines.push(failures === 0 ? '\\u2705 浏览器自检全部通过（' + passes + ' 项）'
                              : '\\u274c ' + failures + ' 项失败 / ' + passes + ' 项通过');
    var pre = document.getElementById('browser-check-out');
    pre.textContent = lines.join('\\n');
    document.title = failures === 0 ? 'RESULT:PASS' : 'RESULT:FAIL';
  }

  window.addEventListener('load', function () { setTimeout(run, 80); });
  document.addEventListener('DOMContentLoaded', function () {
    var pre = document.createElement('pre');
    pre.id = 'browser-check-out';
    pre.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:52vh;overflow:auto;margin:0;' +
      'padding:14px 18px;background:#0f172a;color:#dbeafe;font:12.5px/1.65 ui-monospace,Consolas,monospace;' +
      'white-space:pre-wrap;z-index:9999;border-top:2px solid #2563eb';
    pre.textContent = '自检运行中…';
    document.body.appendChild(pre);
    document.body.style.paddingBottom = '54vh';
  });
})();
</script>
`;

writeFileSync(join(outDir, 'browser-check.html'), html.replace('</body>', probe + '</body>'), 'utf8');
console.log('已生成 .tmp/browser-check.html');
console.log('用浏览器打开它即可在真实布局下自检（结果会打印在页面底部）。');
