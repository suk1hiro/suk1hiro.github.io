'use strict';

/**
 * OCR 扫描 -> 待办 的本地行为测试（不访问网络、不加载 Tesseract）。
 * 运行：NODE_PATH=... node tests/ocr.test.js
 * 覆盖：文本解析、清空/全选、导入今日一次/每日、重复跳过、数据落库。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'standalone.html'), 'utf8');
const URL = 'https://craft.local/index.html?demo=1&reset=1&now=2026-10-24T21:50&static=1';
const STORAGE_KEY = 'craftCheckin.v1';

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) { passed += 1; console.log('ok   - ' + name); }
function fail(name, detail) {
  failed += 1;
  failures.push(name + (detail ? ': ' + detail : ''));
  console.error('FAIL - ' + name + (detail ? ': ' + detail : ''));
}
function assert(cond, name, detail) { cond ? ok(name) : fail(name, detail); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push(e.message));
  vc.on('error', (...args) => errors.push(args.join(' ')));
  const dom = new JSDOM(HTML, {
    url: URL,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  await sleep(800);
  const { window } = dom;
  const doc = window.document;
  const app = window.__EMBER__;

  assert(app && app.parseOcrTasks, '应用与 OCR API 已加载');
  assert(doc.querySelectorAll('#todayTaskList .task-row').length === 9, 'demo 首开 9 条任务');

  // 1) 文本解析：编号/项目符号/复选框/日期/中文空格
  const parsed = app.parseOcrTasks([
    '1. 买牛奶',
    '- 给妈妈打电话',
    '[ ] 读书 二 十 分 钟',
    '2026.10.24',
    '待办',
    '给花浇水。'
  ].join('\n'));
  assert(parsed.length === 4, '解析出 4 条待办', JSON.stringify(parsed));
  assert(parsed[0] === '买牛奶', '去掉编号');
  assert(parsed[2] === '读书二十分钟', '去掉中文间空格', parsed[2]);
  assert(parsed[3] === '给花浇水', '去掉句号/复选框');

  // 1b) AI 输出的一行两栏：用 ☑/□ 分隔时自动拆成两条
  const parsedAi = app.parseOcrTasks([
    '5.准备项目学习☑ 3.英语笔调□',
    '6.改卷一(签)☑ 4.家听12课☑',
    '语文：'
  ].join('\n'));
  assert(parsedAi.length === 4, 'AI 双栏行拆成 4 条', JSON.stringify(parsedAi));
  assert(parsedAi[0] === '准备项目学习' && parsedAi[1] === '英语笔调', '勾选框分隔并去掉标记', JSON.stringify(parsedAi));
  assert(parsedAi[3] === '家听12课', '第二条双栏行正确拆分', JSON.stringify(parsedAi));

  // 2) 弹窗与建议
  doc.querySelector('#scanBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(180);
  assert(app.state.modal === 'ocrModal' && !doc.querySelector('#ocrModal').hidden, '扫描弹窗可打开');
  const textarea = doc.querySelector('#ocrText');
  textarea.value = '买牛奶\n给妈妈打电话\n读书二十分钟\n给花浇水';
  textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(260);
  assert(doc.querySelectorAll('#ocrSuggestions .ocr-task-row').length === 4, '建议列表 4 行');
  assert(doc.querySelector('#ocrCount').textContent === '4 项', '选中计数为 4');
  assert(doc.querySelector('#ocrImportBtn').disabled === false, '导入按钮可用');

  // 3) 清空选择 -> 导入禁用
  doc.querySelector('#ocrSelectNone').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert(doc.querySelector('#ocrImportBtn').disabled === true, '清空选择后导入禁用');
  doc.querySelector('#ocrSelectAll').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert(doc.querySelector('#ocrImportBtn').disabled === false, '全选后导入启用');

  // 4) 导入今日一次
  doc.querySelector('#ocrImportBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(350);
  assert(app.state.modal === null && doc.querySelector('#ocrModal').hidden === true, '导入后弹窗关闭');
  const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
  const imported = stored.tasks.filter((t) => ['买牛奶', '给妈妈打电话', '读书二十分钟', '给花浇水'].includes(t.title));
  assert(imported.length === 4, '4 条待办写入 localStorage', String(imported.length));
  assert(imported.every((t) => t.category === '扫描'), '导入任务带分类「扫描」');
  assert(imported.every((t) => t.type === 'urgent' && t.due === '2026-10-24'), '默认导入为今日一次（urgent 截止今天）');
  assert(doc.querySelectorAll('#todayTaskList .task-row').length === 13, '今日清单从 9 条变为 13 条');

  // 5) 重复导入：全部跳过
  doc.querySelector('#scanBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(120);
  doc.querySelector('#ocrText').value = '买牛奶\n给妈妈打电话';
  doc.querySelector('#ocrText').dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(260);
  doc.querySelector('#ocrImportBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(300);
  const stored2 = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
  assert(stored2.tasks.length === stored.tasks.length, '重复项不会再次写入');
  const toastTexts = [...doc.querySelectorAll('.toast-body')].map((el) => el.textContent);
  assert(toastTexts.some((text) => /没有新增/.test(text)), '重复导入给出提示', toastTexts.join(' | '));

  // 6) 每日任务模式
  doc.querySelector('#scanBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(120);
  doc.querySelector('#ocrText').value = '每日拉伸';
  doc.querySelector('#ocrText').dispatchEvent(new window.Event('input', { bubbles: true }));
  doc.querySelector('#ocrImportMode').value = 'daily';
  await sleep(260);
  doc.querySelector('#ocrImportBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(300);
  const stored3 = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
  const daily = stored3.tasks.find((t) => t.title === '每日拉伸');
  assert(!!daily && daily.type === 'daily', '每日模式写入 daily 任务');

  assert(errors.length === 0, '无 jsdom/脚本错误', errors.slice(0, 3).join(' | '));

  console.log('\nPASS ' + passed + ' / FAIL ' + failed);
  dom.window.close();
  if (failed) {
    console.log('\n失败明细:');
    failures.forEach((f, i) => console.log('  ' + (i + 1) + ') ' + f));
    process.exitCode = 1;
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
