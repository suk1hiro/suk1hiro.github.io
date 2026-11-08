/*!
 * generator.js — 数独题面生成器（无依赖）
 *
 * 支持两种规格：
 *   6x6 迷你数独：2 行 x 3 列的宫格，数字 1-6
 *   9x9 经典数独：3 行 x 3 列的宫格，数字 1-9
 *
 * 生成流程：随机种子 -> 回溯填满完整解 -> 成对对称挖空（每挖一次都验证解唯一）
 * 同一种子 + 同一难度永远得到同一道题，因此每日题目可以跨设备复现。
 */
(function (global) {
  'use strict';

  var S = global.Sudoku = global.Sudoku || {};

  /* ---------------------------------------------------------------- 基础工具 */

  /** mulberry32：小巧的可复现伪随机数发生器 */
  function createRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** 字符串种子 -> 32 位整数（FNV-1a 变体） */
  function hashSeed(str) {
    var h = 2166136261 >>> 0;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /** 每个规格的棋盘参数 */
  function spec(size) {
    if (size === 6) return { size: 6, br: 2, bc: 3, digits: 6 };
    if (size === 9) return { size: 9, br: 3, bc: 3, digits: 9 };
    throw new Error('不支持的棋盘规格: ' + size);
  }

  /** 预计算每个格子所属的宫（box）编号 */
  function boxMap(sp) {
    var map = new Int16Array(sp.size * sp.size);
    for (var r = 0; r < sp.size; r++) {
      var br = Math.floor(r / sp.br);
      for (var c = 0; c < sp.size; c++) {
        var bc = Math.floor(c / sp.bc);
        map[r * sp.size + c] = br * (sp.size / sp.bc) + bc;
      }
    }
    return map;
  }

  function parseGrid(str, size) {
    var g = new Array(size * size);
    for (var i = 0; i < size * size; i++) {
      var ch = str.charCodeAt(i) - 48;
      g[i] = ch >= 1 && ch <= size ? ch : 0;
    }
    return g;
  }

  function gridToString(g) {
    var out = '';
    for (var i = 0; i < g.length; i++) out += g[i] || 0;
    return out;
  }

  /* ------------------------------------------------------------ 约束与求解器 */

  /**
   * 预计算每个格子受影响的格位（同行、同列、同宫，排除自身）。
   * 用 Int16Array 缓存，让求解器只做整数运算。
   */
  function peerMap(sp) {
    var n = sp.size, bm = boxMap(sp), list = new Array(n * n);
    for (var i = 0; i < n * n; i++) {
      var r = Math.floor(i / n), c = i % n, set = [];
      for (var k = 0; k < n; k++) {
        if (k !== c) set.push(r * n + k);
        if (k !== r) set.push(k * n + c);
      }
      for (var j = 0; j < n * n; j++) {
        if (j !== i && bm[j] === bm[i]) set.push(j);
      }
      var uniq = [], seen = Object.create(null);
      for (var s = 0; s < set.length; s++) {
        if (!seen[set[s]]) { seen[set[s]] = 1; uniq.push(set[s]); }
      }
      list[i] = Int16Array.from(uniq);
    }
    return list;
  }

  function inUnit(g, peers, idx, val) {
    var p = peers[idx];
    for (var i = 0; i < p.length; i++) if (g[p[i]] === val) return true;
    return false;
  }

  /** 该格当前可以填的数字，按 1..n 升序返回 */
  function candidatesAt(g, peers, size, idx) {
    var out = [];
    for (var v = 1; v <= size; v++) if (!inUnit(g, peers, idx, v)) out.push(v);
    return out;
  }

  /**
   * 数解：最多数到 limit 个解就提前返回（唯一解题面只需要知道“是否多于 1 个”）。
   * 每次选择候选最少的格子分支（MRV），大幅剪枝。
   */
  function countSolutions(grid, sp, peers, limit, nodeBudget) {
    var n = sp.size, total = n * n;
    var g = grid.slice();
    var budget = nodeBudget === undefined ? 1e7 : nodeBudget;
    var found = 0;

    function search() {
      if (found >= limit || budget <= 0) return;
      var best = -1, bestCands = null;
      for (var i = 0; i < total; i++) {
        if (g[i]) continue;
        var cands = candidatesAt(g, peers, n, i);
        if (cands.length === 0) return;         // 死路，回退
        if (cands.length === 1) { best = i; bestCands = cands; break; }
        if (!bestCands || cands.length < bestCands.length) { best = i; bestCands = cands; }
      }
      if (best === -1) { found++; return; }      // 已填满，找到一个解
      budget--;
      for (var c = 0; c < bestCands.length; c++) {
        g[best] = bestCands[c];
        search();
        g[best] = 0;
        if (found >= limit || budget <= 0) return;
      }
    }

    search();
    return found;
  }

  /** 常规求解：返回完整解数组，无解返回 null */
  function solve(grid, size) {
    var sp = spec(size), peers = peerMap(sp);
    var g = grid.slice();
    var total = sp.size * sp.size;

    function search() {
      var best = -1, bestCands = null;
      for (var i = 0; i < total; i++) {
        if (g[i]) continue;
        var cands = candidatesAt(g, peers, sp.size, i);
        if (cands.length === 0) return false;
        if (cands.length === 1) { best = i; bestCands = cands; break; }
        if (!bestCands || cands.length < bestCands.length) { best = i; bestCands = cands; }
      }
      if (best === -1) return true;
      for (var c = 0; c < bestCands.length; c++) {
        g[best] = bestCands[c];
        if (search()) return true;
        g[best] = 0;
      }
      return false;
    }

    return search() ? g : null;
  }

  /* --------------------------------------------------------------- 题面生成 */

  var CLUE_TARGET = {
    6: { easy: [16, 19], medium: [13, 15], hard: [10, 12], expert: [8, 10] },
    9: { easy: [36, 42], medium: [30, 34], hard: [26, 29], expert: [23, 25] }
  };

  /** 随机填满一个合法完整解（随机顺序回溯，天然均匀） */
  function fillBoard(sp, rng) {
    var n = sp.size, total = n * n;
    var g = new Array(total).fill(0);
    var order = [];
    for (var v = 1; v <= n; v++) order.push(v);

    function search(pos) {
      if (pos === total) return true;
      var cands = shuffle(order.slice(), rng);
      for (var i = 0; i < cands.length; i++) {
        var val = cands[i], ok = true;
        var r = Math.floor(pos / n), c = pos % n;
        for (var k = 0; k < n && ok; k++) {
          if (c > 0 && g[r * n + k] === val && k < c) ok = false;
          if (r > 0 && g[k * n + c] === val && k < r) ok = false;
        }
        if (ok) {
          var br = Math.floor(r / sp.br) * sp.br, bc = Math.floor(c / sp.bc) * sp.bc;
          for (var rr = br; rr < br + sp.br && ok; rr++) {
            for (var cc = bc; cc < bc + sp.bc; cc++) {
              if (g[rr * n + cc] === val) { ok = false; break; }
            }
          }
        }
        if (!ok) continue;
        g[pos] = val;
        if (search(pos + 1)) return true;
        g[pos] = 0;
      }
      return false;
    }

    search(0);
    return g;
  }

  /**
   * 挖空：优先成对（中心对称，题面好看），成对挖不动时再单格挖，
   * 每次删除都验证题面仍然“解唯一”，直到格数落到难度目标区间。
   */
  function carve(solution, sp, rng, peers, opts) {
    var total = sp.size * sp.size;
    var puzzle = solution.slice();
    var minClues = opts.target[0], maxClues = opts.target[1];
    var deadline = opts.deadline;
    var nodeBudget = opts.nodeBudget || 2e6;
    var removed = 0, capped = false;

    /** 依次尝试若干种格子顺序，直到格数达标或到达目标区间 */
    function pass(indices, pairSize) {
      for (var k = 0; k < indices.length; k++) {
        if (total - removed <= minClues) return;                 // 到达难度下限
        if (Date.now() > deadline) { capped = true; return; }
        var idx = indices[k];
        if (puzzle[idx] === 0) continue;

        var mirror = pairSize === 2 ? total - 1 - idx : idx;
        if (pairSize === 2 && puzzle[mirror] === 0) continue;
        if (total - removed - pairSize < minClues) continue;      // 别挖过下限

        var a = puzzle[idx], b = puzzle[mirror];
        puzzle[idx] = 0;
        if (mirror !== idx) puzzle[mirror] = 0;

        if (countSolutions(puzzle, sp, peers, 2, nodeBudget) === 1) {
          removed += pairSize;
        } else {
          puzzle[idx] = a;
          if (mirror !== idx) puzzle[mirror] = b;
        }
      }
    }

    var order = [];
    for (var i = 0; i < total; i++) order.push(i);
    pass(shuffle(order.slice(), rng), 2);                          // 中心对称
    if (total - removed > maxClues) pass(shuffle(order.slice(), rng), 1);  // 单格补挖

    return { puzzle: puzzle, removed: removed, capped: capped };
  }

  /**
   * 生成一道题。
   * @param {{size:number, difficulty:string, seed:(number|string), timeBudget?:number}} options
   * @returns {{size:number, boxRows:number, boxCols:number, difficulty:string,
   *            seed:number, puzzle:string, solution:string, clues:number,
   *            attempts:number, exact:boolean, ms:number, unique:boolean}}
   */
  function generate(options) {
    options = options || {};
    var sp = spec(options.size || 6);
    var difficulty = options.difficulty || 'medium';
    var target = CLUE_TARGET[sp.size][difficulty] || CLUE_TARGET[sp.size].medium;
    var seedNumber = typeof options.seed === 'number' ? options.seed : hashSeed(options.seed === undefined ? Date.now() : options.seed);
    var peers = peerMap(sp);
    var startedAt = Date.now();
    var searchDeadline = startedAt + (options.timeBudget || 2500);

    var best = null;
    var attempts = 0;

    // 多次尝试：不同完整解能挖出的空隙数差别很大，取最接近难度目标的那次
    for (var attempt = 1; attempt <= 4; attempt++) {
      var rng = createRng((seedNumber + attempt * 0x9E3779B9) >>> 0);
      var solution = fillBoard(sp, rng);
      var carved = carve(solution, sp, rng, peers, {
        target: target,
        deadline: Math.min(searchDeadline, Date.now() + 1400),
        nodeBudget: sp.size === 6 ? 2e5 : 1.2e6
      });
      var clues = sp.size * sp.size - carved.removed;
      attempts = attempt;

      if (clues >= target[0] && clues <= target[1]) {
        best = { puzzle: carved.puzzle, solution: solution, clues: clues };
        break;
      }
      // 否则记录“偏空但可玩”的最好结果，避免极端情况下无题可用
      if (!best || clues < best.clues) {
        best = { puzzle: carved.puzzle, solution: solution, clues: clues };
      }
      if (Date.now() > searchDeadline) break;
    }

    var puzzleStr = gridToString(best.puzzle);
    var solutionStr = gridToString(best.solution);
    var unique = countSolutions(parseGrid(puzzleStr, sp.size), sp, peers, 2, 4e6) === 1;

    return {
      size: sp.size,
      boxRows: sp.br,
      boxCols: sp.bc,
      difficulty: difficulty,
      seed: seedNumber,
      puzzle: puzzleStr,
      solution: solutionStr,
      clues: best.clues,
      attempts: attempts,
      exact: best.clues >= target[0] && best.clues <= target[1],
      unique: unique,
      ms: Date.now() - startedAt
    };
  }

  S.Generator = {
    generate: generate,
    solve: solve,
    countSolutions: countSolutions,
    createRng: createRng,
    hashSeed: hashSeed,
    spec: spec,
    peerMap: peerMap,
    boxMap: boxMap,
    parseGrid: parseGrid,
    gridToString: gridToString,
    candidatesAt: candidatesAt,
    CLUE_TARGET: CLUE_TARGET
  };
})(typeof window !== 'undefined' ? window : globalThis);
