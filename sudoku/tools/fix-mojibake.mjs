/*!
 * fix-mojibake.mjs — 修复“UTF-8 被当成 GBK 读取”造成的乱码
 *
 * 症状：中文变成「姣忔棩」这类字符。原因是文件被按 GBK 解码后又以 UTF-8 保存，
 * 属于可逆变换：把每个字符的码点取低字节还原回原始字节，再按 UTF-8 解码即可。
 *
 * 用法：node tools/fix-mojibake.mjs <文件> [--dry]
 *       不带 --dry 才会写回文件。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const target = args.find((a) => !a.startsWith('--'));

if (!target) {
  console.error('用法：node tools/fix-mojibake.mjs <文件> [--dry]');
  process.exit(2);
}

const path = join(root, target);
let text = readFileSync(path, 'utf8');
if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

/** 每个字符取低字节 → 原始字节 → 按 UTF-8 解码 */
function revert(s) {
  const bytes = Buffer.allocUnsafe(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  return bytes.toString('utf8');
}

const fixed = revert(text);

// 判断依据：修复后应出现常见中文，且不再有乱码特征
const looksFixed = /[\u4e00-\u9fff]/.test(fixed) && !/锛|鈥|姣忔棩|閰嶈壊|妯″紡/.test(fixed);
const looksBroken = /锛|鈥|姣忔棩|閰嶈壊|妯″紡/.test(text);

console.log('文件      : ' + target);
console.log('原始长度  : ' + text.length);
console.log('修复后长度: ' + fixed.length);
console.log('当前含乱码: ' + (looksBroken ? '是' : '否'));
console.log('修复后正常: ' + (looksFixed ? '是' : '否'));
console.log('抽样      : ' + (fixed.match(/section\('\[1\][^\n]*/) || ['(未找到)'])[0].slice(0, 60));

if (!looksBroken) {
  console.log('→ 没有检测到乱码特征，未改动文件。');
  process.exit(0);
}
if (!looksFixed) {
  console.log('→ 修复结果不可信，未写回。请人工检查。');
  process.exit(1);
}
if (dry) {
  console.log('→ --dry 模式，未写回文件。');
  process.exit(0);
}

writeFileSync(path, fixed, 'utf8');
console.log('→ 已写回（UTF-8 无 BOM）。');
