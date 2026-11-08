/*!
 * game.js — 数独对局引擎（无依赖）
 *
 * 负责一局游戏的全部规则与状态：落子、铅笔标记、冲突检测、撤销、提示、
 * 自动清理标记、存档序列化。不接触 DOM，方便单独测试与复用。
 */
(function (global) {
  'use strict';

  var S = global.Sudoku = global.Sudoku || {};
  var Gen = S.Generator;

  function emptyValues(total) {
    var a = new Array(total);
    for (var i = 0; i < total; i++) a[i] = 0;
    return a;
  }

  function emptyNotes(total) {
    var a = new Array(total);
    for (var i = 0; i < total; i++) a[i] = 0;   // 位掩码：bit(v-1) 表示已标记 v
    return a;
  }

  /**
   * @param {object} puzzle 题目（Generator.generate 的返回值）
   * @param {{elapsed:number, values:number[], notes:number[]}} [saved] 需要恢复的存档
   */
  function createGame(puzzle, saved) {
    if (!puzzle || !puzzle.puzzle) throw new Error('createGame 需要题目数据');
    var size = puzzle.size;
    var total = size * size;
    var spec = Gen.spec(size);
    var peers = Gen.peerMap(spec);
    var boxOf = Gen.boxMap(spec);

    var givens = Gen.parseGrid(puzzle.puzzle, size);
    var solution = Gen.parseGrid(puzzle.solution || Gen.gridToString(Gen.solve(givens, size)), size);
    var values = emptyValues(total);
    var notes = emptyNotes(total);
    var history = [];
    var mistakes = 0;
    var elapsed = 0;
    var paused = false;
    var solved = false;
    var startedAt = Date.now();
    var lastMovedAt = 0;

    for (var i = 0; i < total; i++) if (givens[i]) values[i] = givens[i];

    /** 还原存档（只接受合法数字，越界一律丢弃） */
    if (saved && saved.values && saved.values.length === total) {
      for (var j = 0; j < total; j++) {
        var v = saved.values[j] | 0;
        values[j] = (!givens[j] && v >= 1 && v <= size) ? v : givens[j];
      }
      if (saved.notes && saved.notes.length === total) {
        for (var k = 0; k < total; k++) notes[k] = (saved.notes[k] | 0) & ((1 << size) - 1);
      }
      elapsed = Math.max(0, saved.elapsed | 0);
      paused = !!saved.paused;          // 刷新前处于暂停态，恢复后继续暂停
      mistakes = saved.mistakes | 0;
    }

    /* ------------------------------------------------------------- 查询接口 */

    function isGiven(idx) { return givens[idx] !== 0; }
    function isEmpty(idx) { return values[idx] === 0; }

    /** 该格是否与同行/同列/同宫的已填数字重复（用于实时冲突提示） */
    function hasConflict(idx) {
      var v = values[idx];
      if (!v) return false;
      var p = peers[idx];
      for (var i = 0; i < p.length; i++) if (values[p[i]] === v) return true;
      return false;
    }

    /** 该格填的数字与答案不一致（用于“检查”与错误计数） */
    function isWrong(idx) {
      return values[idx] !== 0 && values[idx] !== solution[idx];
    }

    function conflictSet() {
      var set = Object.create(null);
      for (var i = 0; i < total; i++) if (hasConflict(i)) set[i] = true;
      return set;
    }

    function wrongSet() {
      var set = Object.create(null);
      for (var i = 0; i < total; i++) if (isWrong(i)) set[i] = true;
      return set;
    }

    /** 某数字还能填的候选格数量（0 表示这个数字已经填完） */
    function remainingOf(digit) {
      var count = 0;
      for (var i = 0; i < total; i++) {
        if (values[i] === digit) continue;
        if (values[i] !== 0) continue;
        if (!Gen.candidatesAt(values, peers, size, i).some(function (c) { return c === digit; })) continue;
        count++;
      }
      return count;
    }

    /** 每个数字已正确填入的数量，用于数字键打勾 */
    function usedCount(digit) {
      var count = 0;
      for (var i = 0; i < total; i++) if (values[i] === digit) count++;
      return count;
    }

    function candidatesAt(idx) {
      if (values[idx]) return [];
      return Gen.candidatesAt(values, peers, size, idx);
    }

    function isSolved() {
      for (var i = 0; i < total; i++) if (values[i] !== solution[i]) return false;
      return true;
    }

    function progress() {
      var filled = 0;
      for (var i = 0; i < total; i++) if (values[i]) filled++;
      return filled / total;
    }

    /* ------------------------------------------------------------- 状态变更 */

    function pushHistory(entry) {
      history.push(entry);
      if (history.length > 400) history.shift();
    }

    /**
     * 当前“仍然生效”的提示格：从历史尾部往前，每格只看最后一次操作，
     * 若那次是提示则算数；玩家后来自己改写或擦除的就不算。
     * 提示计数与棋盘上的提示配色都以此为准，撤销后自动保持一致。
     */
    function hintCellsInEffect() {
      var seen = Object.create(null), out = [];
      for (var i = history.length - 1; i >= 0; i--) {
        var e = history[i];
        if (seen[e.cell]) continue;
        seen[e.cell] = true;
        if (e.type === 'hint') out.push(e.cell);
      }
      return out.filter(function (idx) { return values[idx] === solution[idx]; });
    }

    /** 自动清理同行/列/宫里的同数字标记 */
    function clearPeerNotes(idx, digit) {
      var p = peers[idx], bit = 1 << (digit - 1), changed = [];
      for (var i = 0; i < p.length; i++) {
        if (notes[p[i]] & bit) { notes[p[i]] &= ~bit; changed.push(p[i]); }
      }
      return changed;
    }

    /**
     * 落子。digit 为 0 表示擦除；note=true 表示切换铅笔标记。
     * @returns {{type:string, ok:boolean, cell:number, digit:number, refill:number[]}}
     */
    function input(idx, digit, asNote) {
      if (solved || idx < 0 || idx >= total) return { type: 'none', ok: false };
      if (isGiven(idx)) return { type: 'given', ok: false, cell: idx };

      // 擦除：清空数字与标记
      if (digit === 0) {
        if (values[idx] === 0 && notes[idx] === 0) return { type: 'none', ok: false };
        pushHistory({ type: 'clear', cell: idx, prevValue: values[idx], prevNotes: notes[idx], refilled: [] });
        values[idx] = 0;
        notes[idx] = 0;
        lastMovedAt = Date.now();
        return { type: 'clear', ok: true, cell: idx, digit: 0, refill: [] };
      }

      // 铅笔标记模式
      if (asNote) {
        if (values[idx] !== 0) return { type: 'none', ok: false };
        var bit = 1 << (digit - 1);
        pushHistory({ type: 'note', cell: idx, prevValue: 0, prevNotes: notes[idx], refilled: [] });
        notes[idx] ^= bit;
        lastMovedAt = Date.now();
        return { type: 'note', ok: true, cell: idx, digit: digit, refill: [] };
      }

      // 同一格重复点同一个数字 = 取消
      if (values[idx] === digit && notes[idx] === 0) {
        return input(idx, 0, false);
      }

      var prevValue = values[idx], prevNotes = notes[idx];
      // 若该格原本已有冲突数字，先撤销它带来的自动清理，避免误删标记
      var refilled = [];
      values[idx] = digit;
      notes[idx] = 0;

      if (S.settings.get('autoNotes')) {
        refilled = clearPeerNotes(idx, digit);
      }

      var wrong = digit !== solution[idx];
      if (wrong) mistakes++;

      pushHistory({ type: 'set', cell: idx, prevValue: prevValue, prevNotes: prevNotes, refilled: refilled });
      lastMovedAt = Date.now();

      if (isSolved()) {
        solved = true;
        return { type: 'solve', ok: true, cell: idx, digit: digit, refill: refilled, wrong: wrong };
      }
      return { type: 'set', ok: true, cell: idx, digit: digit, refill: refilled, wrong: wrong };
    }

    /** 撤销上一步 */
    function undo() {
      var last = history.pop();
      if (!last) return { ok: false };
      var idx = last.cell;
      values[idx] = last.prevValue;
      notes[idx] = last.prevNotes;
      // 恢复因自动清理被抹掉的标记
      if (last.refilled && last.refilled.length) {
        var bit = 1 << ((last.prevValue || 0) - 1);
        if (bit > 0) for (var i = 0; i < last.refilled.length; i++) notes[last.refilled[i]] |= bit;
      }
      solved = false;
      lastMovedAt = Date.now();
      return { ok: true, cell: idx };
    }

    /**
     * 提示：优先挑“只剩一个候选”的格子，否则随机挑一个空格，
     * 直接把答案填进去并计入提示次数。
     */
    function hint() {
      if (solved) return { ok: false };
      var empties = [];
      for (var i = 0; i < total; i++) if (values[i] !== solution[i]) empties.push(i);
      if (!empties.length) return { ok: false };

      var pick = -1;
      for (var k = 0; k < empties.length; k++) {
        var idx = empties[k];
        if (values[idx] === 0 && candidatesAt(idx).length === 1) { pick = idx; break; }
      }
      if (pick === -1) {
        var blanks = empties.filter(function (i2) { return values[i2] === 0; });
        var pool = blanks.length ? blanks : empties;
        pick = pool[Math.floor(S.random() * pool.length)];
      }

      var prevValue = values[pick], prevNotes = notes[pick];
      values[pick] = solution[pick];
      notes[pick] = 0;
      var refilled = S.settings.get('autoNotes') ? clearPeerNotes(pick, solution[pick]) : [];
      pushHistory({ type: 'hint', cell: pick, prevValue: prevValue, prevNotes: prevNotes, refilled: refilled });
      lastMovedAt = Date.now();

      if (isSolved()) solved = true;
      return { ok: true, cell: pick, digit: solution[pick], solved: solved };
    }

    /** 一次性把某格填成正确答案（提示的另一种用法：解开当前选中的格） */
    function revealCell(idx) {
      if (solved || idx < 0 || idx >= total || isGiven(idx) || values[idx] === solution[idx]) return { ok: false };
      var prevValue = values[idx], prevNotes = notes[idx];
      values[idx] = solution[idx];
      notes[idx] = 0;
      var refilled = S.settings.get('autoNotes') ? clearPeerNotes(idx, solution[idx]) : [];
      pushHistory({ type: 'hint', cell: idx, prevValue: prevValue, prevNotes: prevNotes, refilled: refilled });
      lastMovedAt = Date.now();
      if (isSolved()) solved = true;
      return { ok: true, cell: idx, digit: solution[idx], solved: solved };
    }

    /** 清空玩家所有填写的数字（保留题面） */
    function restart() {
      for (var i = 0; i < total; i++) {
        if (!givens[i]) { values[i] = 0; notes[i] = 0; }
      }
      history = [];
      mistakes = 0;
      solved = false;
      paused = false;
      elapsed = 0;
      startedAt = Date.now();
      return { ok: true };
    }

    /* --------------------------------------------------------- 计时与序列化 */

    /**
     * 计时采用“已累计秒数 + 本次起算时刻”的写法：
     * 暂停时把已用时长固化下来，继续时以当前时刻重新起算，
     * 这样暂停的时间不会计入成绩，玩家看到的数字与记录的数字始终一致。
     */
    function tick() {
      if (solved || paused) return elapsed;
      elapsed = Math.max(elapsed, Math.round((Date.now() - startedAt) / 1000));
      return elapsed;
    }

    function pauseTimer() {
      if (paused || solved) return elapsed;
      tick();                       // 固化到暂停那一刻
      paused = true;
      return elapsed;
    }

    function resumeTimer() {
      if (!paused) return elapsed;
      paused = false;
      startedAt = Date.now() - elapsed * 1000;
      return elapsed;
    }

    function getElapsed() {
      return paused || solved ? elapsed : Math.max(elapsed, Math.round((Date.now() - startedAt) / 1000));
    }

    function serialize() {
      return {
        values: values.slice(),
        notes: notes.slice(),
        elapsed: getElapsed(),
        paused: paused,
        mistakes: mistakes
      };
    }

    return {
      size: size,
      total: total,
      boxRows: spec.br,
      boxCols: spec.bc,
      difficulty: puzzle.difficulty,
      seed: puzzle.seed,
      givens: givens,
      solution: solution,
      values: values,
      notes: notes,
      // 查询
      isGiven: isGiven,
      hasConflict: hasConflict,
      isWrong: isWrong,
      conflictSet: conflictSet,
      wrongSet: wrongSet,
      remainingOf: remainingOf,
      usedCount: usedCount,
      candidatesAt: candidatesAt,
      isSolved: function () { return solved || isSolved(); },
      checkSolved: isSolved,
      progress: progress,
      isEmpty: isEmpty,
      isHinted: function (idx) { return hintCellsInEffect().indexOf(idx) !== -1; },
      hintCells: hintCellsInEffect,
      // 操作
      input: input,
      undo: undo,
      hint: hint,
      revealCell: revealCell,
      restart: restart,
      // 状态
      tick: tick,
      getElapsed: getElapsed,
      pauseTimer: pauseTimer,
      resumeTimer: resumeTimer,
      isPaused: function () { return paused; },
      lastMovedAt: function () { return lastMovedAt; },
      getMistakes: function () { return mistakes; },
      getHintCount: function () { return hintCellsInEffect().length; },
      canUndo: function () { return history.length > 0; },
      historyLength: function () { return history.length; },
      serialize: serialize
    };
  }

  S.createGame = createGame;
})(typeof window !== 'undefined' ? window : globalThis);
