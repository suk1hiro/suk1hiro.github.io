/*!
 * validate-static.mjs — 静态结构校验
 *
 * 检查真实 HTML 与 CSS 的“接线”是否正确，专抓那类会让界面空白的低级问题：
 *   - HTML 里 id/class 是否闭合、是否重复
 *   - app.js / ui.js 里 getElementById 用到的 id 是否都真实存在
 *   - 页面引用的本地文件是否存在
 *   - CSS 花括号是否配平、被 JS 使用的关键 class 是否有样式定义
 *   - 有没有“默认就盖住全屏”的元素（会让界面看起来什么都没有）
 *
 * 用法：node tools/validate-static.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

let failures = 0, passes = 0;
const check = (label, ok, extra = '') => {
  if (ok) { passes++; console.log(`  ✅ ${label}`); }
  else { failures++; console.log(`  ❌ ${label}${extra ? '  [' + extra + ']' : ''}`); }
};
const section = (t) => console.log('\n' + t);

const PAGES = ['index.html', 'archive.html'];
const scriptsOf = (html) => [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const allJs = (pages) => pages.flatMap((p) => scriptsOf(read(p)))
  .filter((v, i, a) => a.indexOf(v) === i)
  .map((src) => ({ src, code: read(src) }));

/* ============================================================ 1. HTML */
section('[1] HTML 结构');
const pageInfo = {};
for (const page of PAGES) {
  const html = read(page);
  const info = { html, ids: [] };

  // 标签配平（只统计非自闭合、非 void 的常规容器）
  // 标签配平：SVG 内部按 XML 规则书写（<use></use>、自闭合的 <path/>），
  // 与 HTML 的宽松解析不同，这里整体剔除后再配平 HTML 结构。
  const forBalance = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '<!--svg-->');

  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr']);
  const stack = [];
  let balanced = true, mismatch = '';
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(forBalance))) {
    const [, closing, tag, , selfClose] = m;
    const lower = tag.toLowerCase();
    if (closing) {
      if (!stack.length || stack[stack.length - 1] !== lower) {
        balanced = false; mismatch = `</${tag}> 与 <${stack[stack.length - 1] || '空'}> 不匹配`;
        break;
      }
      stack.pop();
    } else if (!selfClose && !VOID.has(lower)) {
      stack.push(lower);
    }
  }
  if (stack.length && balanced) { balanced = false; mismatch = `未闭合: <${stack.join('>, <')}>`; }
  check(`${page} 标签配平`, balanced, mismatch);

  // id 收集与重复检测
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
  const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
  check(`${page} 没有重复 id`, dupes.length === 0, dupes.join(', '));
  info.ids = ids;
  pageInfo[page] = info;
  console.log(`     （${page}: ${ids.length} 个 id）`);
}

/* ============================================================ 2. 资源引用 */
section('[2] 资源引用');
for (const page of PAGES) {
  const missing = [];
  for (const m of read(page).matchAll(/(?:src|href)="([^"]+)"/g)) {
    const v = m[1];
    if (/^(https?:|data:|#)/.test(v)) continue;
    const path = v.split('?')[0];
    if (!existsSync(join(root, path))) missing.push(v);
  }
  check(`${page} 引用的本地文件都存在`, missing.length === 0, missing.join(', '));
}

/* ============================================================ 3. JS 取用的 id */
section('[3] 脚本取用的 DOM id 是否都存在');
{
  const htmlIds = new Set(pageInfo['index.html'].ids);
  const used = new Map();               // id -> 出现在哪些文件
  for (const { src, code } of allJs(PAGES)) {
    for (const m of code.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) {
      if (!used.has(m[1])) used.set(m[1], []);
      if (!used.get(m[1]).includes(src)) used.get(m[1]).push(src);
    }
  }
  const missing = [...used.entries()].filter(([id]) => !htmlIds.has(id));
  check(`app/ui 用到的 ${used.size} 个 id 全部存在于 index.html`,
    missing.length === 0,
    missing.map(([id, files]) => `${id} (${files.join(',')})`).join('; '));

  // 反向：HTML 里有、但谁都没用的 id（只是提示）
  const unused = [...htmlIds].filter((id) => !used.has(id));
  if (unused.length) console.log(`     （未被脚本取用的 id：${unused.join(', ')}）`);
}

/* ============================================================ 4. CSS */
section('[4] CSS 健全性');
{
  const css = read('css/main.css');
  const open = (css.match(/{/g) || []).length;
  const close = (css.match(/}/g) || []).length;
  check('花括号配平', open === close, `{ ${open} 个 / } ${close} 个`);

  // 遮罩由 JS 动态创建/移除，因此默认块里有 display:grid 是安全的；
  // 真正要防的是它“一进页面就存在”——只有 showVeil() 会创建它。
  const veilBlock = /\.board-veil\s*{([^}]*)}/.exec(css);
  check('.board-veil 有样式定义', !!veilBlock);
  check('HTML 里不存在会盖住棋盘的 .board-veil',
    !/<div[^>]*class="[^"]*board-veil/.test(pageInfo['index.html'].html));
  check('.board-veil 由 JS 按需创建/移除',
    /hideVeil[\s\S]{0,200}remove\(\)/.test(read('js/ui.js')));

  const modalBlock = /\.modal\s*{([^}]*)}/.exec(css);
  check('.modal 默认隐藏', !!modalBlock && /display\s*:\s*none/.test(modalBlock[1]),
    modalBlock ? modalBlock[1].trim().slice(0, 60) : '未找到规则');

  const toastBlock = /#toast\s*{([^}]*)}/.exec(css);
  check('#toast 默认不可见', !!toastBlock && /opacity\s*:\s*0/.test(toastBlock[1]) &&
    /pointer-events\s*:\s*none/.test(toastBlock[1]));

  // 棋盘不能默认隐藏
  const boardBlock = /\.board\s*{([^}]*)}/.exec(css);
  check('.board 默认可见（display:grid）', !!boardBlock && /display\s*:\s*grid/.test(boardBlock[1]),
    boardBlock ? boardBlock[1].trim().slice(0, 60) : '未找到规则');

  // JS 生成的 class 是否有样式
  const required = ['cell', 'cell__value', 'cell__notes', 'key', 'key__count', 'action',
    'difficulty', 'chip', 'card', 'week__day', 'day-card', 'switch', 'segmented',
    'board-veil', 'is-selected', 'is-peer', 'is-box', 'is-same', 'is-given',
    'is-conflict', 'is-hinted', 'is-done', 'is-active'];
  const missingCss = required.filter((cls) => !css.includes('.' + cls));
  check('JS 使用的关键 class 都有样式定义', missingCss.length === 0, missingCss.join(', '));

  // --size 必须有兜底，否则格子宽度算不出来
  check('CSS 为 --size 提供兜底值', /--size\s*:\s*\d+/.test(css));
  check('CSS 为 --cell 提供兜底值', /--cell\s*:\s*\d+px/.test(css));
}

/* ============================================================ 5. 主题契约 */
section('[5] 主题完整性');
{
  const css = read('css/main.css');
  const core = read('js/core.js');

  // js/core.js 登记的主题
  const themeBlock = /S\.THEMES\s*=\s*\[([\s\S]*?)\];/.exec(core);
  const themes = themeBlock
    ? [...themeBlock[1].matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1])
    : [];
  check('core.js 里登记了主题列表', themes.length > 0, themes.join(', '));

  // css 里定义的主题块（default 用 :root）
  const cssThemes = [...css.matchAll(/\[data-theme='([^']+)'\]\s*\{/g)].map((m) => m[1]);
  const missing = themes.filter((id) => id !== 'default' && !cssThemes.includes(id));
  check('每个主题都有对应的 CSS 定义', missing.length === 0, missing.join(', '));

  const orphan = cssThemes.filter((id) => !themes.includes(id));
  check('没有 CSS 里存在但脚本未登记的主题', orphan.length === 0, orphan.join(', '));

  // 每个主题必须覆盖完整令牌集，否则会串色
  const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  const rootTokens = new Set([...rootBlock[1].matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const incomplete = [];
  for (const id of cssThemes) {
    const block = new RegExp("\\[data-theme='" + id + "'\\]\\s*\\{([\\s\\S]*?)\\n\\}").exec(css);
    const tokens = new Set([...block[1].matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const lack = [...rootTokens].filter((t) => !tokens.has(t) && !['--font', '--font-num', '--ring', '--tap'].includes(t));
    if (lack.length) incomplete.push(`${id} 缺 ${lack.join('/')}`);
  }
  // 允许主题只覆盖需要变的部分，但关键色必须有
  const critical = ['--bg', '--panel', '--text', '--accent', '--cell-bg',
    '--hl-box', '--hl-peer', '--hl-same', '--given', '--user', '--danger-soft',
    '--line-frame', '--toast-bg', '--toast-text', '--on-accent'];
  const criticalMissing = [];
  for (const id of cssThemes) {
    const block = new RegExp("\\[data-theme='" + id + "'\\]\\s*\\{([\\s\\S]*?)\\n\\}").exec(css);
    const tokens = new Set([...block[1].matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const lack = critical.filter((t) => !tokens.has(t));
    if (lack.length) criticalMissing.push(`${id}: ${lack.join('/')}`);
  }
  check('每个主题都覆盖了关键令牌', criticalMissing.length === 0, criticalMissing.join('; '));

  // 语法体检：变量值里出现多个标识符拼接，通常是手误
  const badValues = [...css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]*[a-z]{3,}[0-9][a-z]+[^;{}]*);/g)]
    .map((m) => m[1] + ': ' + m[2].trim())
    .filter((s) => !/#[0-9a-f]{3,8}\b/i.test(s));
  check('没有明显写错的令牌值', badValues.length === 0, badValues.join(' | '));

  // 同一主题内不应重复定义同一个令牌（后者会静默覆盖前者）
  const dupes = [];
  for (const id of cssThemes) {
    const block = new RegExp("\\[data-theme='" + id + "'\\]\\s*\\{([\\s\\S]*?)\\n\\}").exec(css);
    const names = [...block[1].matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
    names.filter((n, i) => names.indexOf(n) !== i).forEach((n) => dupes.push(`${id}.${n}`));
  }
  check('主题内没有重复定义的令牌', dupes.length === 0, [...new Set(dupes)].join(', '));

  // 主题切换的接线
  check('core.js 提供 S.applyTheme', /S\.applyTheme\s*=/.test(core));
  check('启动时读取并应用已保存的主题', /S\.applyTheme\(settings\.theme\)/.test(core));
  check('切换主题会立即生效', /if \(key === 'theme'\) S\.applyTheme/.test(core));
  check('ui.js 渲染主题选择器', /theme-swatch/.test(read('js/ui.js')));
  check('app.js 处理主题点击', /data-theme/.test(read('js/app.js')));
}

/* ============================================================ 6. 颜色令牌化 */
section('[6] 颜色令牌化（业务规则里不应出现硬编码颜色）');
{
  const css = read('css/main.css');
  // 令牌定义区（:root 与各主题块）允许直接写颜色，其它规则不允许
  const tokenRegionRe = /(:root|\[data-theme='[^']+'\])\s*\{[\s\S]*?\n\}/g;
  const stripped = css.replace(tokenRegionRe, '');

  // rgb()/rgba() 只允许出现在阴影令牌里；@media print 需要强制白底，单独放行
  const printBlock = /@media print\s*\{[\s\S]*?\n\}/.exec(stripped);
  const checkable = printBlock ? stripped.replace(printBlock[0], '') : stripped;

  const hardcoded = [];
  checkable.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\*[\s\S]*?\*\//g, '');
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g);
    const rgb = code.match(/\brgba?\(/g);
    if (hex) hardcoded.push(`第${i + 1}行 hex: ${line.trim().slice(0, 58)}`);
    if (rgb && !/var\(/.test(code)) hardcoded.push(`第${i + 1}行 rgb: ${line.trim().slice(0, 58)}`);
  });
  check('规则区没有硬编码颜色（含 rgba）', hardcoded.length === 0, hardcoded.slice(0, 4).join(' | '));

  // 关键视觉一律走令牌
  const usesTokens = ['--bg', '--panel', '--text', '--accent', '--line-weak', '--shadow']
    .every((t) => new RegExp('var\\(' + t + '\\)').test(css));
  check('关键令牌都被实际使用', usesTokens);

  // 旧版遗留的硬编码颜色不该再出现在对应规则里
  const legacyRules = {
    '顶栏背景': /\.topbar\s*\{[^}]*background:\s*var\(--topbar-bg\)/,
    '棋盘背景': /\.board\s*\{[^}]*background:\s*var\(--cell-bg\)/,
    '格子背景': /\.cell\s*\{[^}]*background:\s*var\(--cell-bg\)/,
    '数字键背景': /\.key\s*\{[^}]*background:\s*var\(--panel\)/,
    '遮罩背景': /\.board-veil\s*\{[^}]*background:\s*var\(--veil-bg\)/,
    '弹窗遮罩': /\.modal\s*\{[^}]*background:\s*var\(--scrim\)/,
    '提示条背景': /#toast\s*\{[^}]*background:\s*var\(--toast-bg\)/,
    '同宫高亮': /\.cell\.is-box\s*\{\s*background:\s*var\(--hl-box\)/,
    '同行列高亮': /\.cell\.is-peer\s*\{\s*background:\s*var\(--hl-peer\)/,
    '相同数字高亮': /\.cell\.is-same\s*\{\s*background:\s*var\(--hl-same\)/
  };
  const notTokenized = Object.keys(legacyRules).filter((k) => !legacyRules[k].test(css));
  check('关键视觉全部改用令牌', notTokenized.length === 0, notTokenized.join(', '));
}

/* ============================================================ 7. 脚本加载顺序 */
section('[7] 脚本依赖顺序');
{
  const order = scriptsOf(pageInfo['index.html'].html);
  const idx = (f) => order.indexOf('js/' + f);
  check('core.js 最先加载', idx('core.js') === 0, order.join(' → '));
  check('generator.js 在 game.js 之前', idx('generator.js') < idx('game.js'));
  check('core.js 在 game.js 之前（settings/random 依赖）', idx('core.js') < idx('game.js'));
  check('stats.js 在 ui.js 之前', idx('stats.js') < idx('ui.js'));
  check('ui.js 在 app.js 之前', idx('ui.js') < idx('app.js'));
  check('脚本都放在 </body> 之前（DOM 已就绪）',
    pageInfo['index.html'].html.indexOf('js/app.js') < pageInfo['index.html'].html.indexOf('</body>'));
}

console.log(failures === 0 ? `\n✅ 静态校验全部通过（${passes} 项）` : `\n❌ 失败 ${failures} 项 / 通过 ${passes} 项`);
process.exit(failures === 0 ? 0 : 1);
