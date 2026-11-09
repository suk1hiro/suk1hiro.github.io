#!/usr/bin/env node
'use strict';

/**
 * 把 index.html + styles.css + core.js + app.js 内联成单文件 standalone.html。
 * 无依赖，直接：node tools/build.js
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const html = read('index.html');
const css = read('styles.css');
const core = read('core.js');
const app = read('app.js');

function inlineScript(code, label) {
  // 避免提前闭合宿主 <script>。
  return code.replace(/<\/script/gi, '<\\/script').replace(/^/, '/* ' + label + ' */\n');
}

let out = html;

out = out.replace(
  /<link\s+rel="stylesheet"\s+href="styles\.css(?:\?[^"]*)?"\s*>/i,
  () => '<style>\n' + css.replace(/<\/style/gi, '<\\/style') + '\n</style>'
);

out = out.replace(
  /<script\s+src="core\.js(?:\?[^"]*)?"><\/script>/i,
  () => '<script>\n' + inlineScript(core, 'core.js') + '\n</script>'
);

out = out.replace(
  /<script\s+src="app\.js(?:\?[^"]*)?"><\/script>/i,
  () => '<script>\n' + inlineScript(app, 'app.js') + '\n</script>'
);

if (/<link[^>]+href=["']styles\.css|<script[^>]+src=["'](?:core|app)\.js/i.test(out)) {
  console.error('构建失败：仍有外部本地资源引用未内联。');
  process.exit(1);
}

const target = path.join(root, 'standalone.html');
fs.writeFileSync(target, out, 'utf8');

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('已生成 standalone.html');
console.log('  html : ' + kb(html.length));
console.log('  css  : ' + kb(css.length));
console.log('  core : ' + kb(core.length));
console.log('  app  : ' + kb(app.length));
console.log('  total: ' + kb(out.length));
