/*!
 * app.js — 主控制器：模式路由、出题、计时、交互、结算与持久化
 *
 * 模式：
 *   daily    每日一题（同一天、同一规格，全球同题）
 *   hard     每日挑战（同一天的题面，固定困难难度）
 *   practice 不限模式（随时开新局，四种难度自选）
 *   archive  往期题库（用 ?date=YYYY-MM-DD 复现某一天的题）
 */
(function (global) {
  'use strict';

  var S = global.Sudoku;
  var Gen = S.Generator;
  var stats = S.stats;
  var ui = S.ui;

  var state = {
    mode: 'daily',
    date: null,
    practice: { seed: '', difficulty: 'medium' },
    game: null,
    cells: [],
    keyButtons: [],
    selected: null,
    notesMode: false,
    activeDigit: 0,
    paused: false,
    displaySeconds: 0,
    finished: false,
    saveKey: '',
    startedAt: 0
  };

  var timerHandle = null;
  var autosaveHandle = null;
  var allCompleteNotified = false;

  /* ------------------------------------------------------------ 小工具 */

  function param(name) {
    try {
      return new URLSearchParams(global.location.search).get(name);
    } catch (err) {
      var m = new RegExp('[?&]' + name + '=([^&]*)').exec(global.location.search);
      return m ? decodeURIComponent(m[1]) : null;
    }
  }

  function isMode(mode) { return ['daily', 'hard', 'practice', 'archive'].indexOf(mode) !== -1; }

  function isValidDate(key) { return /^\d{4}-\d{2}-\d{2}$/.test(key || ''); }

  /** 把模式 + 日期 + 规格拼成存档键，切换模式/难度互不干扰 */
  function makeSaveKey(size) {
    if (state.mode === 'practice') return 'practice:' + size;
    return state.mode + ':' + state.date + ':' + size;
  }

  function noteDigits(mask, size) {
    var out = [];
    for (var d = 1; d <= size; d++) if (mask & (1 << (d - 1))) out.push(d);
    return out;
  }

  /* -------------------------------------------------------- 题目构建 */

  /** 按当前模式决定题目参数 */
  function resolvePuzzle(size, difficultyOverride) {
    if (state.mode === 'practice') {
      var difficulty = difficultyOverride || S.settings.get('difficulty');
      return { size: size, difficulty: difficulty, seed: state.practice.seed };
    }
    // 每日挑战与每日题共用同一天的题面种子，但固定为最高难度
    var difficultyForDay = state.mode === 'hard' ? 'expert' : S.dailyDifficulty(state.date);
    return { size: size, difficulty: difficultyForDay, seed: 'daily|' + state.date + '|' + size, daily: true };
  }

  /**
   * 开始一局：优先恢复进度，恢复的题目必须与当前规格一致。
   * @param {{size:number, difficulty?:string, fresh?:boolean, saved?:object}} options
   */
  function startGame(options) {
    var size = options.size || S.settings.get('size');
    var saveKey = makeSaveKey(size);
    var saved = options.fresh ? null : (options.saved || stats.loadGame(saveKey));
    var puzzle = null;
    var resume = false;

    // 存档里已经带了完整题面，直接复用可以保证题目不变
    if (saved && saved.puzzle && saved.puzzle.size === size) {
      puzzle = saved.puzzle;
      resume = true;
    } else if (options.puzzle) {
      puzzle = options.puzzle;
    } else {
      var plan = resolvePuzzle(size, options.difficulty);
      puzzle = Gen.generate(plan);
    }

    var game = S.createGame(puzzle, resume ? saved.state : null);
    state.game = game;
    state.saveKey = saveKey;
    state.selected = null;
    state.activeDigit = 0;
    state.finished = false;
    state.paused = game.isPaused();
    state.notesMode = false;
    state.displaySeconds = game.getElapsed();
    allCompleteNotified = false;

    if (resume) {
      state.practice.seed = saved.seed || state.practice.seed;
      if (saved.difficulty) state.practice.difficulty = saved.difficulty;
    } else if (state.mode === 'practice') {
      state.practice.seed = String(puzzle.seed);
      state.practice.difficulty = puzzle.difficulty;
      stats.addPlayed('practice', size);
    }

    ui.buildBoard(game, onCellTap);
    state.cells = Array.prototype.slice.call(document.getElementById('board').children);
    state.keyButtons = ui.buildKeypad(game, onDigitInput);

    // 难度选择器始终可用：点任意难度即刻开局（每日模式点击会切到不限模式）
    var dailyDefault = state.mode === 'practice' ? null : S.dailyDifficulty(state.date);
    ui.buildDifficulty(game.difficulty, onDifficultyTap, {
      today: state.mode === 'daily' ? dailyDefault : null,
      note: buildDifficultyNote(dailyDefault)
    });

    ui.hideVeil();
    render();
    syncUrl();
    persist();
    startTimer();
  }

  /** 难度选择器下方的说明文字，避免与“每日题的今日难度”混淆 */
  function buildDifficultyNote(dailyDefault) {
    if (state.mode === 'daily') {
      return '每日题今天为' + S.DIFFICULTY_LABEL[dailyDefault] + '难度；点其它难度可自由练习';
    }
    if (state.mode === 'hard') {
      return '每日挑战固定专家难度；点任意难度可自由练习';
    }
    return '点任意难度即刻换一题';
  }

  /* ------------------------------------------------------------ 渲染 */

  function render() {
    var game = state.game;
    if (!game) return;
    // 提示格集合每次渲染只算一次，避免每个格子都重扫历史
    var hintCells = game.hintCells();
    var hintSet = Object.create(null);
    for (var h = 0; h < hintCells.length; h++) hintSet[hintCells[h]] = true;

    var ctx = {
      states: new Array(game.total),
      selected: state.selected,
      activeDigit: state.activeDigit,
      showConflicts: S.settings.get('showConflicts'),
      autoCheck: S.settings.get('autoCheck'),
      highlighted: S.settings.get('highlightPeers'),
      isHinted: function (idx) { return !!hintSet[idx]; },
      noteDigits: function (mask) { return noteDigits(mask, game.size); }
    };

    for (var i = 0; i < game.total; i++) {
      var st = ui.cellState(game, i, ctx);
      // 关掉“高亮同行同列”时，连带关掉同宫与相同数字的底色，保持画面干净
      if (!ctx.highlighted) { st.sameRow = st.sameCol = st.sameBox = st.sameValue = false; }
      ctx.states[i] = st;
    }

    ui.renderBoard(game, ctx, state.cells);
    var done = ui.renderKeypad(game, state.keyButtons);
    ui.renderStatus({
      size: game.size,
      difficulty: game.difficulty,
      meta: metaText(),
      streak: state.mode === 'daily' || state.mode === 'hard' ? stats.streak() : 0,
      displaySeconds: state.displaySeconds,
      paused: state.paused
    });
    ui.renderActions({
      canUndo: game.canUndo() && !state.finished,
      notesMode: state.notesMode,
      hintCount: game.getHintCount()
    });
    if (done === game.size) onAllDigitsComplete();

    // 完成后棋盘加一层提示，但不遮挡查看
    if (state.finished) ui.showVeil('已完成 ✓', '用时 ' + S.formatTime(game.getElapsed()));
    else if (state.paused) ui.showVeil('已暂停', '点击继续');
    else ui.hideVeil();
  }

  function metaText() {
    if (state.mode === 'practice') {
      return '第 ' + (stats.summary('practice', state.game.size).played) + ' 局';
    }
    var label = (state.date === S.dates.todayKey() ? '今日' : S.dates.label(state.date));
    return label + ' · 第 ' + S.dailyNumber(state.date) + ' 期';
  }

  function onAllDigitsComplete() {
    if (allCompleteNotified || state.finished) return;
    allCompleteNotified = true;
    S.toast('每个数字都填完了，检查一下有没有冲突', 'ok');
  }


  function renderSide() {
    ui.renderSide(state.mode, state.game, { size: state.game.size, difficulty: state.game.difficulty });
    bindSideEvents();
  }

  /* ---------------------------------------------------------- 交互逻辑 */

  function onCellTap(idx) {
    if (!state.game) return;
    if (state.paused) { S.toast('已暂停，点击继续'); resumeTimer(); return; }
    if (state.finished) { ui.showModal(ui.modalHandlers() || {}); return; }

    state.selected = idx;
    if (state.game.values[idx]) state.activeDigit = state.game.values[idx];
    render();
  }

  function onDigitInput(digit) {
    if (!state.game) return;
    if (state.paused) { S.toast('已暂停，点击继续'); resumeTimer(); return; }
    if (state.finished) return;

    state.activeDigit = digit;
    if (state.selected === null) {
      // 没选格子时，先找这个数字最该填的地方：候选唯一或候选最少
      var guess = bestCellFor(digit);
      if (guess !== -1) { state.selected = guess; render(); return; }
      render();
      return;
    }
    inputAt(state.selected, digit);
  }

  /** 给“未选格先按数字”准备的建议落点 */
  function bestCellFor(digit) {
    var game = state.game;
    var best = -1, bestScore = 99;
    for (var i = 0; i < game.total; i++) {
      if (game.values[i]) continue;
      var cands = game.candidatesAt(i);
      if (cands.indexOf(digit) === -1) continue;
      if (cands.length === 1) return i;
      if (cands.length < bestScore) { bestScore = cands.length; best = i; }
    }
    return best;
  }

  function inputAt(idx, digit) {
    var game = state.game;
    var result = game.input(idx, digit, state.notesMode);

    if (!result.ok && result.type === 'given') {
      S.toast('这是题目给定的数字，不能修改', 'warn');
      return;
    }
    if (result.ok) {
      state.displaySeconds = game.getElapsed();
      // 选中的格子被填上后自动跳到下一个空格，连续输入更顺手
      if (!state.notesMode && digit !== 0 && result.type !== 'note') {
        var next = nextEmpty(idx);
        if (next !== -1) state.selected = next;
      }
      persist();
    }

    render();

    if (result.ok) {
      var cell = state.cells[idx];
      if (cell) ui.animateCell(cell, result.wrong ? 'wrong' : 'place');
      if (result.type === 'solve' || game.isSolved()) onSolved();
    }
  }

  /** 向后寻找下一个空格（循环一圈），全部填满则返回 -1 */
  function nextEmpty(from) {
    var game = state.game, total = game.total;
    for (var step = 1; step <= total; step++) {
      var idx = (from + step) % total;
      if (!game.values[idx]) return idx;
    }
    return -1;
  }

  /**
   * 点难度按钮：任何模式下都直接开一局该难度的题。
   * 在每日 / 每日挑战模式下点击会切到「不限」，因为每日题面是当天固定的，
   * 不可能同时又换难度。
   */
  function onDifficultyTap(difficulty) {
    if (S.DIFFICULTY_ORDER.indexOf(difficulty) === -1) return;
    allCompleteNotified = false;
    state.practice.difficulty = difficulty;
    S.settings.set('difficulty', difficulty);

    if (state.mode !== 'practice') {
      state.mode = 'practice';
      state.practice.seed = '';
      S.toast('已切到不限模式：' + S.DIFFICULTY_LABEL[difficulty]);
    } else {
      S.toast('新题来了：' + S.DIFFICULTY_LABEL[difficulty]);
    }
    state.practice.seed = '';
    startGame({ size: state.game.size, difficulty: difficulty, fresh: true });
  }

  /* ------------------------------------------------------- 计时与暂停 */

  function startTimer() {
    stopTimer();
    state.startedAt = Date.now();
    timerHandle = setInterval(function () {
      if (state.paused || state.finished || !state.game) return;
      state.displaySeconds = state.game.getElapsed();
      ui.renderStatus({
        size: state.game.size,
        difficulty: state.game.difficulty,
        meta: metaText(),
        streak: state.mode === 'daily' || state.mode === 'hard' ? stats.streak() : 0,
        displaySeconds: state.displaySeconds,
        paused: false
      });
    }, 1000);

    if (!autosaveHandle) {
      autosaveHandle = setInterval(persist, 5000);
    }
  }

  function stopTimer() {
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
  }

  function togglePause() {
    if (state.finished) return;
    state.paused = !state.paused;
    if (state.paused) {
      state.game.pauseTimer();          // 冻结计时，暂停时长不计入成绩
      S.toast('已暂停，计时已停止');
    } else {
      state.game.resumeTimer();
    }
    state.displaySeconds = state.game.getElapsed();
    render();
  }

  function resumeTimer() {
    if (!state.paused) return;
    state.paused = false;
    state.game.resumeTimer();
    render();
  }

  function pauseTimer() {
    if (state.paused || state.finished) return;
    state.paused = true;
    state.game.pauseTimer();
    state.displaySeconds = state.game.getElapsed();
    render();
  }

  /* ------------------------------------------------------- 结算与存档 */

  function persist() {
    if (!state.game || !state.saveKey) return;
    if (state.finished) { stats.clearGame(state.saveKey); return; }
    var game = state.game;
    stats.saveGame(state.saveKey, {
      puzzle: {
        size: game.size,
        boxRows: game.boxRows,
        boxCols: game.boxCols,
        difficulty: game.difficulty,
        seed: game.seed,
        puzzle: S.Generator.gridToString(game.givens),
        solution: S.Generator.gridToString(game.solution)
      },
      state: game.serialize(),
      seed: state.practice.seed,
      difficulty: game.difficulty,
      savedAt: Date.now()
    });
  }

  function onSolved() {
    if (state.finished) return;
    state.finished = true;
    stopTimer();

    var game = state.game;
    var time = game.getElapsed();
    state.displaySeconds = time;
    stats.clearGame(state.saveKey);

    var isDaily = state.mode === 'daily' || state.mode === 'hard' || state.mode === 'archive';
    var streak = 0;
    var isBest = false;

    if (isDaily) {
      stats.completeDaily(state.date, {
        time: time,
        difficulty: game.difficulty,
        hints: game.getHintCount(),
        mistakes: game.getMistakes()
      });
      streak = stats.streak();
    } else {
      isBest = stats.completePractice(game.size, game.difficulty, { time: time });
      stats.addWin('practice', game.size, { time: time, hints: game.getHintCount() });
    }

    render();
    renderSide();

    var statItems = [
      { label: '用时', value: S.formatTime(time) },
      { label: '提示', value: String(game.getHintCount()) },
      { label: '难度', value: S.DIFFICULTY_LABEL[game.difficulty] || game.difficulty }
    ];
    if (isDaily) {
      statItems[2] = { label: streak > 1 ? '连续打卡' : '期号', value: streak > 1 ? streak + ' 天' : '#' + S.dailyNumber(state.date) };
    } else if (isBest) {
      statItems[0] = { label: '新纪录', value: S.formatTime(time), highlight: true };
    }

    // 每日题完成后，最自然的下一步是“换难度再玩一局”或“去看往期”
    ui.showModal({
      emoji: isBest ? '🏆' : '🎉',
      title: isBest ? '刷新最佳成绩！' : '完成！',
      sub: buildWinSub(isDaily, streak, game),
      stats: statItems,
      primaryLabel: isDaily ? '换难度再来一局' : '下一题',
      secondaryLabel: isDaily ? '往期题目' : null,
      onPrimary: function () { goTo('practice'); },
      onSecondary: function () { global.location.href = 'archive.html'; }
    });
  }

  function buildWinSub(isDaily, streak, game) {
    if (isDaily) {
      if (streak > 1) return '已连续完成 ' + streak + ' 天，明天同一时间刷新新题。';
      return '今天的每日题完成了，明天会有新的题目。';
    }
    if (game.getHintCount() > 0) return '用了 ' + game.getHintCount() + ' 次提示，试试不看提示完成一局？';
    return '干净利落，一题未错。';
  }

  /* ------------------------------------------------------------ 事件 */

  function gotoDaily(dateKey) {
    state.date = dateKey;
    allCompleteNotified = false;
    startGame({ size: state.game ? state.game.size : S.settings.get('size') });
  }

  function goTo(mode) {
    var useSettingsSize = S.settings.get('size');
    state.mode = mode;
    if (mode === 'archive') { global.location.href = 'archive.html'; return; }
    state.practice.seed = '';
    allCompleteNotified = false;
    startGame({ size: useSettingsSize, fresh: mode === 'practice' });
  }

  function changeSize(size) {
    S.settings.set('size', size);
    var saved = stats.loadGame(makeSaveKey(size));
    state.practice.seed = '';
    allCompleteNotified = false;
    startGame({ size: size, saved: saved });
    S.toast(size + '×' + size + ' 棋盘');
  }

  function changeDate(dateKey) {
    state.date = dateKey;
    allCompleteNotified = false;
    startGame({ size: state.game.size });
  }

  function bindSideEvents() {
    var side = document.getElementById('side');
    side.onclick = function (ev) {
      var target = ev.target;

      // 配色主题：换色不需要重开一局，只重画侧栏的选中态
      var swatch = target.closest ? target.closest('[data-theme]') : null;
      if (swatch) {
        var themeId = swatch.dataset.theme;
        S.settings.set('theme', themeId);
        Array.prototype.forEach.call(side.querySelectorAll('[data-theme]'), function (btn) {
          var active = btn.dataset.theme === themeId;
          btn.classList.toggle('is-active', active);
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        S.toast('配色：' + S.themeInfo(themeId).label);
        return;
      }

      var sw = target.closest ? target.closest('[data-setting]') : null;
      if (sw) {
        var key = sw.dataset.setting;
        var next = !S.settings.get(key);
        S.settings.set(key, next);
        sw.setAttribute('aria-checked', next ? 'true' : 'false');
        render();
        return;
      }
      var sizeBtn = target.closest ? target.closest('[data-size]') : null;
      if (sizeBtn) { changeSize(Number(sizeBtn.dataset.size)); return; }
      var dayBtn = target.closest ? target.closest('[data-date]') : null;
      if (dayBtn) { changeDate(dayBtn.dataset.date); return; }
      var action = target.closest ? target.closest('[data-action]') : null;
      if (action && action.dataset.action === 'reset-data') {
        if (global.confirm('确定要清空所有完成记录、最佳成绩和进行中的对局吗？此操作无法撤销。')) {
          stats.resetAll();
          state.practice.seed = '';
          S.toast('记录已清空');
          startGame({ size: state.game.size, fresh: state.mode === 'practice' });
        }
      }
    };
  }

  function bindEvents() {
    document.getElementById('difficulty').onclick = function (ev) {
      var target = ev.target.closest ? ev.target.closest('button[data-difficulty]') : null;
      if (target) onDifficultyTap(target.dataset.difficulty);
    };

    Array.prototype.forEach.call(document.querySelectorAll('.actions .action'), function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.dataset.action;
        if (action === 'undo') doUndo();
        else if (action === 'erase') { if (state.selected !== null) inputAt(state.selected, 0); }
        else if (action === 'notes') toggleNotes();
        else if (action === 'hint') doHint();
        else if (action === 'restart') doRestart();
      });
    });

    document.getElementById('btn-pause').addEventListener('click', togglePause);

    // 暂停遮罩点击继续
    document.querySelector('.board-wrap').addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('.board-veil')) {
        if (state.finished) ui.showModal(ui.modalHandlers() || {});
        else resumeTimer();
      }
    });

    document.getElementById('modal-primary').addEventListener('click', function () {
      var h = ui.modalHandlers();
      ui.hideModal();
      if (h && h.onPrimary) h.onPrimary();
    });

    document.getElementById('modal-secondary').addEventListener('click', function () {
      var h = ui.modalHandlers();
      ui.hideModal();
      if (h && h.onSecondary) h.onSecondary();
    });

    document.getElementById('modal').addEventListener('click', function (ev) {
      if (ev.target.id === 'modal') ui.hideModal();
    });

    document.addEventListener('keydown', onKeydown);

    // 切走标签页自动暂停，避免计时虚高（暂停时长不计入成绩）
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pauseTimer();
    });

    global.addEventListener('beforeunload', persist);
    global.addEventListener('resize', function () { /* 棋盘尺寸由 CSS 变量自适应 */ });

    // 计时暂停时用 ESC 退出弹窗
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') ui.hideModal();
    });
  }

  function onKeydown(ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
    var game = state.game;
    if (!game) return;

    var key = ev.key;
    if (key === 'Escape') { ui.hideModal(); return; }

    // 数字输入
    if (/^[1-9]$/.test(key)) {
      var digit = Number(key);
      if (digit <= game.size) { ev.preventDefault(); onDigitInput(digit); }
      return;
    }
    if (key === 'Backspace' || key === 'Delete' || key === '0') {
      ev.preventDefault();
      if (state.selected !== null) inputAt(state.selected, 0);
      return;
    }

    // 方向键 / WASD 移动
    var delta = null;
    if (key === 'ArrowUp' || key === 'w' || key === 'W') delta = -game.size;
    else if (key === 'ArrowDown' || key === 's' || key === 'S') delta = game.size;
    else if (key === 'ArrowLeft' || key === 'a' || key === 'A') delta = -1;
    else if (key === 'ArrowRight' || key === 'd' || key === 'D') delta = 1;
    if (delta !== null) {
      ev.preventDefault();
      moveSelection(delta);
      return;
    }

    var lower = key.toLowerCase();
    if (lower === 'n') { ev.preventDefault(); toggleNotes(); }
    else if (lower === 'z') { ev.preventDefault(); doUndo(); }
    else if (lower === 'h') { ev.preventDefault(); doHint(); }
    else if (lower === 'c') { ev.preventDefault(); if (state.selected !== null) inputAt(state.selected, 0); }
    else if (key === ' ') { ev.preventDefault(); togglePause(); }
    else if (key === 'r') { ev.preventDefault(); doRestart(); }
  }

  function moveSelection(delta) {
    var game = state.game;
    var idx = state.selected === null ? 0 : state.selected + delta;
    var r = Math.floor(idx / game.size);
    var c = idx % game.size;
    // 左右移动时不要跨行绕到上一行
    if (delta === 1 || delta === -1) {
      if (idx < 0) { idx = state.selected; }
      if (state.selected !== null && delta === 1 && c === 0) idx = state.selected;
      if (state.selected !== null && delta === -1 && c === game.size - 1) idx = state.selected;
    }
    if (idx < 0) idx = 0;
    if (idx > game.total - 1) idx = game.total - 1;
    state.selected = idx;
    if (game.values[idx]) state.activeDigit = game.values[idx];
    render();
    scrollCellIntoView(idx);
  }

  function scrollCellIntoView(idx) {
    var cell = state.cells[idx];
    if (!cell) return;
    var rect = cell.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > (global.innerHeight || 0)) {
      cell.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function toggleNotes() {
    state.notesMode = !state.notesMode;
    render();
    S.toast(state.notesMode ? '标记模式：数字写进小格' : '已切回正常填入');
  }

  function doUndo() {
    var game = state.game;
    if (!game.canUndo()) { S.toast('没有可撤销的操作'); return; }
    var result = game.undo();
    state.finished = false;
    allCompleteNotified = false;
    if (result.ok) state.selected = result.cell;
    state.displaySeconds = game.getElapsed();
    if (!timerHandle) startTimer();
    persist();
    render();
  }

  function doHint() {
    if (state.finished) return;
    var game = state.game;
    var result = state.selected !== null && !game.values[state.selected]
      ? game.revealCell(state.selected)
      : game.hint();
    if (!result.ok) { S.toast('没有可以提示的格子了'); return; }

    state.selected = result.cell;
    state.displaySeconds = game.getElapsed();
    persist();
    render();
    var cell = state.cells[result.cell];
    if (cell) ui.animateCell(cell, 'place');
    S.toast('提示：这一格是 ' + result.digit);
    if (result.solved || game.isSolved()) onSolved();
  }

  function doRestart() {
    var game = state.game;
    if (!global.confirm('清空当前所有填写的数字，重新开始这一局？')) return;
    game.restart();
    state.selected = null;
    state.finished = false;
    allCompleteNotified = false;
    state.displaySeconds = 0;
    if (!timerHandle) startTimer();
    persist();
    render();
    S.toast('已重新开始');
  }

  /* ------------------------------------------------------ 同步 URL 与导航 */

  function syncUrl() {
    try {
      var q = [];
      if (state.mode === 'daily') {
        // daily 是默认模式，URL 里不需要写 mode；只有不是今天才带 date
        if (state.date !== S.dates.todayKey()) q.push('date=' + state.date);
      } else {
        q.push('mode=' + state.mode);
        if (state.mode !== 'practice') q.push('date=' + state.date);
      }
      // 不限模式把难度写进 URL，刷新后才能回到同一难度
      if (state.mode === 'practice') q.push('difficulty=' + state.game.difficulty);
      if (state.game.size !== 6) q.push('size=' + state.game.size);
      var url = global.location.pathname + (q.length ? '?' + q.join('&') : '');
      global.history.replaceState(null, '', url);
    } catch (err) { /* file:// 下 history 可能受限，忽略即可 */ }

    Array.prototype.forEach.call(document.querySelectorAll('#nav a'), function (a) {
      a.classList.toggle('is-active', a.dataset.mode === state.mode);
    });
    document.body.dataset.mode = state.mode;
  }

  /* ------------------------------------------------------------- 启动 */

  function boot() {
    var yearNode = document.getElementById('year');
    if (yearNode) yearNode.textContent = String(new Date().getFullYear());

    var mode = param('mode');
    state.mode = isMode(mode) ? mode : 'daily';

    var date = param('date');
    state.date = isValidDate(date) ? date : S.dates.todayKey();

    var sizeParam = Number(param('size'));
    var size = (sizeParam === 6 || sizeParam === 9) ? sizeParam : S.settings.get('size');
    if (size !== 6 && size !== 9) size = 6;
    S.settings.set('size', size);

    var difficultyParam = param('difficulty');
    if (S.DIFFICULTY_ORDER.indexOf(difficultyParam) !== -1) {
      state.practice.difficulty = difficultyParam;
      S.settings.set('difficulty', difficultyParam);
    }

    // mode=archive 有两种含义，必须区分开：
    //   ?mode=archive               → 打开往期列表页
    //   ?mode=archive&date=YYYY-MM-DD → 直接开那一期的题目（不再跳转）
    // 早前把两者混在一起，导致点往期卡片时在题目页与档案页之间反复弹跳。
    if (state.mode === 'archive' && !isValidDate(date)) {
      global.location.replace('archive.html?date=' + state.date);
      return;
    }

    // 每日题与每日挑战固定用当天日期，避免用旧链接“刷”连续天数；
    // 想玩某一天请带 mode=archive（例如 ?mode=archive&date=2026-09-20）
    if (state.mode === 'daily' || state.mode === 'hard') state.date = S.dates.todayKey();

    bindEvents();
    startGame({ size: size });
    renderSide();

    // 打开页面时如果今天已完成，温和提示一下
    if ((state.mode === 'daily' || state.mode === 'hard') && stats.isDailyDone(state.date) && !S.stats.loadGame(state.saveKey)) {
      var rec = stats.dailyRecord(state.date);
      S.toast('今天的题你已经完成过，最佳用时 ' + S.formatTime(rec.t), 'ok');
    }
  }

  S.app = {
    state: state,
    startGame: startGame,
    boot: boot,
    // 供调试与测试使用
    _internals: { bestCellFor: bestCellFor, nextEmpty: nextEmpty, makeSaveKey: makeSaveKey }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
