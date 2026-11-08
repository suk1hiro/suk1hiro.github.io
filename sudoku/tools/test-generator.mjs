// 生成器自检：正确性、唯一性、目标格数、耗时
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/generator.js', import.meta.url), 'utf8');
(0, eval)(src);
const S = globalThis.Sudoku.Generator;

function validSolution(grid, size, br, bc) {
  const need = new Set();
  for (let i = 1; i <= size; i++) need.add(i);
  for (let r = 0; r < size; r++) {
    const row = new Set(), col = new Set();
    for (let k = 0; k < size; k++) { row.add(grid[r * size + k]); col.add(grid[k * size + r]); }
    if (row.size !== size || [...row].some((v) => !need.has(v))) return false;
    if (col.size !== size || [...col].some((v) => !need.has(v))) return false;
  }
  for (let br0 = 0; br0 < size; br0 += br) {
    for (let bc0 = 0; bc0 < size; bc0 += bc) {
      const box = new Set();
      for (let r = br0; r < br0 + br; r++) for (let c = bc0; c < bc0 + bc; c++) box.add(grid[r * size + c]);
      if (box.size !== size) return false;
    }
  }
  return true;
}

const diffOf = (n, clues) => Object.entries(S.CLUE_TARGET[n]).find(([, [lo, hi]]) => clues >= lo && clues <= hi)?.[0] ?? 'OUT';

let failures = 0;
const rows = [];

for (const size of [6, 9]) {
  const sp = S.spec(size);
  for (const difficulty of ['easy', 'medium', 'hard', 'expert']) {
    const times = [];
    let clueTotal = 0;
    for (let i = 0; i < 12; i++) {
      const seed = `bench-${size}-${difficulty}-${i}`;
      const t0 = performance.now();
      const p = S.generate({ size, difficulty, seed });
      times.push(performance.now() - t0);
      clueTotal += p.clues;

      const sol = S.parseGrid(p.solution, size);
      const puz = S.parseGrid(p.puzzle, size);

      if (!validSolution(sol, size, sp.br, sp.bc)) { console.log(`FAIL 解不合法 ${seed}`); failures++; }
      for (let j = 0; j < size * size; j++) {
        if (puz[j] && puz[j] !== sol[j]) { console.log(`FAIL 题面与解冲突 ${seed} @${j}`); failures++; break; }
      }
      const count = S.countSolutions(puz, sp, S.peerMap(sp), 3, 4e7);
      if (count !== 1) { console.log(`FAIL 解不唯一(${count}) ${seed}`); failures++; }
      // 同种子必须完全复现
      const again = S.generate({ size, difficulty, seed });
      if (again.puzzle !== p.puzzle || again.solution !== p.solution) { console.log(`FAIL 种子不可复现 ${seed}`); failures++; }
      if (diffOf(size, p.clues) !== difficulty) { console.log(`WARN 格数偏差 ${seed} clues=${p.clues} 期望${difficulty}`); }
    }
    times.sort((a, b) => a - b);
    rows.push({ size, difficulty, 平均格数: (clueTotal / 12).toFixed(1), 中位耗时ms: times[6].toFixed(0), 最慢ms: times[11].toFixed(0) });
  }
}

console.table(rows);
console.log(failures === 0 ? '✅ 全部通过：解唯一、题面无冲突、种子可复现' : `❌ 失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
