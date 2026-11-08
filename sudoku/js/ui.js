/*!
 * ui.js — 视图层：棋盘渲染、数字键盘、状态行、侧栏卡片
 * 只负责把状态画成 DOM 与绑定点击事件，游戏规则全部在 game.js。
 */
(function (global) {
  'use strict';

  var S = global.Sudoku = global.Sudoku || {};

  function $(id) { return document.getElementById(id); }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function icon(name, cls) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    if (cls) svg.setAttribute('class', cls);
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + name);
    svg.appendChild(use);
    return svg;
  }
  function toggleHidden(node, hidden) { if (node) node.hidden = !!hidden; }

  /**
   * 计算某个格子需要挂上的所有样式标记。
   * 高亮层级（从弱到强）：同宫 -> 同行列 -> 相同数字 -> 选中。
   */
  function cellState(game, idx, ctx) {
    var size = game.size;
    var r = Math.floor(idx / size), c = idx % size;
    var value = game.values[idx];
    var sel = ctx.selected;
    var selValue = sel === null || sel === undefined ? 0 : game.values[sel];
    var selected = sel === idx;

    var sameRow = false, sameCol = false, sameBox = false, sameValue = false;

    if (sel !== null && sel !== undefined && !selected) {
      var sr = Math.floor(sel / size), sc = sel % size;
      sameRow = r === sr;
      sameCol = c === sc;
      sameBox = Math.floor(r / game.boxRows) === Math.floor(sr / game.boxRows) &&
                Math.floor(c / game.boxCols) === Math.floor(sc / game.boxCols);
      if (value && selValue && value === selValue) sameValue = true;
      // 当前选中格是空的，但用户刚点过某个数字，也高亮同数字
      if (!selValue && ctx.activeDigit && value === ctx.activeDigit) sameValue = true;
    }

    return {
      idx: idx,
      row: r,
      col: c,
      value: value,
      notes: game.notes[idx],
      notesList: ctx.noteDigits(game.notes[idx]),
      isGiven: game.isGiven(idx),
      isHinted: ctx.isHinted ? ctx.isHinted(idx) : false,
      selected: selected,
      sameRow: sameRow,
      sameCol: sameCol,
      sameBox: sameBox,
      sameValue: sameValue,
      conflict: ctx.showConflicts && game.hasConflict(idx),
      wrong: ctx.autoCheck && game.isWrong(idx),
      boxRight: (c + 1) % game.boxCols === 0 && c !== size - 1,
      boxBottom: (r + 1) % game.boxRows === 0 && r !== size - 1,
      lastCol: c === size - 1,
      lastRow: r === size - 1
    };
  }

  function applyCellClass(cell, st) {
    var cls = 'cell';
    if (st.boxRight) cls += ' box-right';
    if (st.boxBottom) cls += ' box-bottom';
    if (st.lastCol) cls += ' last-col';
    if (st.lastRow) cls += ' last-row';
    if (st.isGiven) cls += ' is-given';
    if (st.isHinted) cls += ' is-hinted';
    if (ctxHighlight(st, 'box')) cls += ' is-box';
    if (ctxHighlight(st, 'peer')) cls += ' is-peer';
    if (ctxHighlight(st, 'same')) cls += ' is-same';
    if (st.selected) cls += ' is-selected';
    if (st.wrong) cls += ' is-wrong';
    else if (st.conflict) cls += ' is-conflict';
    cell.className = cls;
    cell.dataset.r = st.row;
    cell.dataset.c = st.col;
  }

  /** 高亮规则：选中格不参与底色高亮；同行列只有在“跟选中格同一单元”时才亮 */
  function ctxHighlight(st, kind) {
    if (st.selected) return false;
    if (kind === 'box') return st.sameBox;
    if (kind === 'peer') return st.sameRow || st.sameCol;
    if (kind === 'same') return st.sameValue;
    return false;
  }

  var ui = {
    $: $,
    el: el,
    icon: icon,
    toggleHidden: toggleHidden,
    cellState: cellState,

    /* ------------------------------------------------------------ 棋盘 */

    /**
     * 一次性建立棋盘 DOM，之后只更新变化的部分。
     * @returns {HTMLElement[]} 便于后续按索引直接操作
     */
    buildBoard: function (game, onTap) {
      var board = $('board');
      board.innerHTML = '';
      board.style.setProperty('--size', game.size);
      board.dataset.size = game.size;
      board.setAttribute('role', 'grid');
      board.setAttribute('aria-label', game.size + '×' + game.size + ' 数独棋盘');

      var frag = document.createDocumentFragment();
      var cells = [];
      for (var i = 0; i < game.total; i++) {
        var cell = el('div', 'cell');
        cell.dataset.index = i;
        cell.dataset.r = Math.floor(i / game.size);
        cell.dataset.c = i % game.size;
        cell.setAttribute('role', 'gridcell');
        var value = el('span', 'cell__value');
        cell.appendChild(value);
        frag.appendChild(cell);
        cells.push(cell);
      }
      board.appendChild(frag);

      if (onTap) {
        // 用 onclick 赋值而非 addEventListener：重复开局时不会叠加监听器
        board.onclick = function (ev) {
          var target = ev.target.closest ? ev.target.closest('.cell') : null;
          if (!target || !board.contains(target)) return;
          onTap(Number(target.dataset.index));
        };
      }
      return cells;
    },

    /** 更新一个格子的全部视觉状态 */
    updateCell: function (cell, st, gameSize) {
      applyCellClass(cell, st);
      cell.setAttribute('aria-label', ui.cellLabel(st, gameSize));

      var valueNode = cell.firstChild;
      var current = valueNode.textContent;
      var wanted = st.value ? String(st.value) : '';
      if (current !== wanted) valueNode.textContent = wanted;

      // 铅笔标记：只在没有数字时展示
      var notesNode = cell.querySelector('.cell__notes');
      if (!st.value && st.notes) {
        if (!notesNode) {
          notesNode = el('div', 'cell__notes' + (gameSize === 6 ? ' is-6' : ''));
          for (var n = 1; n <= gameSize; n++) notesNode.appendChild(el('span'));
          cell.appendChild(notesNode);
          cell._notesNode = notesNode;
        }
        notesNode.hidden = false;
        var spans = notesNode.children;
        for (var i = 0; i < spans.length; i++) {
          var digit = i + 1;
          var on = (st.notes & (1 << (digit - 1))) !== 0;
          var text = on ? String(digit) : '';
          if (spans[i].textContent !== text) spans[i].textContent = text;
        }
      } else if (notesNode) {
        notesNode.hidden = true;
      }
    },

    cellLabel: function (st, size) {
      var pos = '第' + (st.row + 1) + '行第' + (st.col + 1) + '列';
      if (!st.value) return pos + '，空' + (st.notesList.length ? '，已标记 ' + st.notesList.join('、') : '');
      return pos + '，' + st.value + (st.isGiven ? '（题目给定）' : '');
    },

    /** 刷新整盘；changed 为空则全量刷新 */
    renderBoard: function (game, ctx, cells) {
      var states = ctx.states;
      for (var i = 0; i < cells.length; i++) {
        ui.updateCell(cells[i], states[i], game.size);
      }
    },

    /** 落子动画 */
    animateCell: function (cell, kind) {
      var cls = kind === 'wrong' ? 'just-wrong' : 'just-placed';
      cell.classList.remove('just-placed', 'just-wrong');
      // 强制重排，保证连续落子时动画能重新播放
      void cell.offsetWidth;
      cell.classList.add(cls);
      setTimeout(function () { cell.classList.remove(cls); }, 340);
    },

    /* ---------------------------------------------------------- 数字键盘 */

    buildKeypad: function (game, onDigit) {
      var pad = $('keypad');
      pad.innerHTML = '';
      pad.style.setProperty('--cols', game.size + 1);   // 数字键 + 擦除键同一行
      var buttons = [];
      for (var d = 1; d <= game.size; d++) {
        var key = el('button', 'key');
        key.type = 'button';
        key.dataset.digit = d;
        key.setAttribute('aria-label', '填入 ' + d);
        key.appendChild(el('span', 'key__value', String(d)));
        key.appendChild(el('span', 'key__count'));
        pad.appendChild(key);
        buttons.push(key);
      }

      // 擦除键与数字键同排，手指不用来回跑
      var erase = el('button', 'key key--erase');
      erase.type = 'button';
      erase.dataset.digit = '0';
      erase.setAttribute('aria-label', '擦除');
      erase.title = '擦除 (Backspace)';
      erase.appendChild(icon('i-eraser'));
      pad.appendChild(erase);

      pad.onclick = function (ev) {
        var target = ev.target.closest ? ev.target.closest('.key') : null;
        if (!target) return;
        onDigit(Number(target.dataset.digit));
      };

      return buttons;
    },

    keypad: function () { return $('keypad'); },

    /** 更新数字键的剩余个数与完成态 */
    renderKeypad: function (game, buttons) {
      var showCount = S.settings.get('showRemaining');
      var doneCount = 0;
      for (var i = 0; i < buttons.length; i++) {
        var digit = i + 1;
        var remaining = game.remainingOf(digit);
        var placed = game.usedCount(digit);
        var complete = remaining === 0 && placed >= game.size;
        buttons[i].classList.toggle('is-done', complete);
        var count = buttons[i].querySelector('.key__count');
        count.textContent = showCount && !complete ? String(remaining) : '';
        count.hidden = !showCount;
        if (complete) doneCount++;
      }
      return doneCount;
    },

    /* ---------------------------------------------------------- 状态行 */

    renderStatus: function (view) {
      var chipDiff = $('chip-difficulty');
      chipDiff.textContent = S.DIFFICULTY_LABEL[view.difficulty] || view.difficulty;
      chipDiff.hidden = !!view.hideDifficulty;

      $('chip-board').textContent = view.size + '×' + view.size;

      var meta = $('chip-meta');
      if (view.meta) { meta.textContent = view.meta; meta.hidden = false; }
      else meta.hidden = true;

      var streak = $('chip-streak');
      if (view.streak && view.streak > 1) {
        streak.textContent = '🔥 连续 ' + view.streak + ' 天';
        streak.hidden = false;
      } else streak.hidden = true;

      toggleHidden($('timer-wrap'), !S.settings.get('showTimer'));
      $('timer').textContent = S.formatTime(view.displaySeconds);
      $('timer-wrap').classList.toggle('is-paused', !!view.paused);
      var pauseIcon = $('pause-icon');
      if (pauseIcon) pauseIcon.firstElementChild.setAttribute('href', view.paused ? '#i-play' : '#i-pause');
      $('btn-pause').setAttribute('aria-label', view.paused ? '继续计时' : '暂停计时');
    },

    renderActions: function (view) {
      $('btn-undo').disabled = !view.canUndo;
      var notes = $('btn-notes');
      notes.classList.toggle('is-active', !!view.notesMode);
      notes.setAttribute('aria-pressed', view.notesMode ? 'true' : 'false');

      var hint = $('btn-hint');
      var badge = hint.querySelector('.action__badge');
      if (view.hintCount > 0) {
        if (!badge) { badge = el('span', 'action__badge'); hint.appendChild(badge); }
        badge.textContent = String(view.hintCount);
      } else if (badge) badge.remove();
    },

    /** 暂停 / 完成时盖住棋盘 */
    showVeil: function (title, hint) {
      var wrap = document.querySelector('.board-wrap');
      var old = wrap.querySelector('.board-veil');
      if (old) old.remove();
      var veil = el('div', 'board-veil');
      veil.appendChild(el('div', 'board-veil__title', title));
      if (hint) veil.appendChild(el('div', 'board-veil__hint', hint));
      wrap.appendChild(veil);
      return veil;
    },

    hideVeil: function () {
      var old = document.querySelector('.board-veil');
      if (old) old.remove();
    },

    /* ---------------------------------------------------------- 难度切换 */

    /**
     * 构造难度选择器。
     * 始终可点：在任何模式下点某个难度，都会直接开一局该难度的题。
     * @param {string} current 当前题目难度
     * @param {Function} onPick
     * @param {{today?:string, note?:string}} [extra] 每日题的“今日难度”提示
     */
    buildDifficulty: function (current, onPick, extra) {
      var box = $('difficulty');
      box.innerHTML = '';
      extra = extra || {};

      S.DIFFICULTY_ORDER.forEach(function (key) {
        var isToday = extra.today === key;
        var label = S.DIFFICULTY_LABEL[key] + (isToday ? ' · 今日' : '');
        var btn = el('button', key === current ? 'is-active' : '', label);
        btn.type = 'button';
        btn.dataset.difficulty = key;
        // 注意：不要用 data-theme 标记“今日”，那个属性专属于配色主题，
        // 否则侧栏主题色卡的 [data-theme] 查询会误命中这里的按钮。
        if (isToday) btn.dataset.today = '1';
        btn.title = isToday
          ? '今天是' + S.DIFFICULTY_LABEL[key] + '难度（每日题按星期轮换）'
          : '开一局' + S.DIFFICULTY_LABEL[key] + '难度的题';
        btn.setAttribute('aria-pressed', key === current ? 'true' : 'false');
        box.appendChild(btn);
      });

      box.onclick = function (ev) {
        var target = ev.target.closest('button[data-difficulty]');
        if (target) onPick(target.dataset.difficulty);
      };

      // 说明这排按钮的作用，避免和“每日题的今日难度”混淆
      var hint = $('difficulty-hint');
      if (hint) {
        hint.textContent = extra.note || '点难度即刻开局';
        hint.hidden = !extra.note;
      }
      return box;
    },

    /* ------------------------------------------------------------ 侧栏 */

    renderSide: function (mode, game, view) {
      var side = $('side');
      side.innerHTML = '';

      if (mode === 'daily' || mode === 'hard' || mode === 'archive') {
        side.appendChild(ui.card_weekly());
        side.appendChild(ui.card_dailyTotals());
      } else {
        side.appendChild(ui.card_practice(game));
        side.appendChild(ui.card_best(game));
      }
      side.appendChild(ui.card_settings(view));
      side.appendChild(ui.card_help(game));
    },

    card_weekly: function () {
      var card = el('section', 'card');
      var head = el('div', 'card__head');
      head.appendChild(el('div', 'card__kicker', '打卡记录'));
      var streak = S.stats.streak();
      if (streak > 0) {
        var chip = el('span', 'chip chip--ok', '🔥 ' + streak + ' 天');
        head.appendChild(chip);
      }
      card.appendChild(head);
      card.appendChild(el('h2', null, '最近 7 天'));

      var week = el('div', 'week');
      S.stats.recent(7).forEach(function (day) {
        var cls = 'week__day' + (day.done ? ' is-done' : '') + (day.key === S.dates.todayKey() ? ' is-today' : '');
        var node = el('div', cls);
        node.appendChild(el('b', null, day.done ? '✓' : S.dates.fromKey(day.key).getDate()));
        node.appendChild(el('span', null, S.dates.weekdayName(day.key).replace('周', '')));
        node.title = S.dates.label(day.key) + (day.done ? ' 已完成 ' + S.formatTime(day.time) : ' 未完成');
        week.appendChild(node);
      });
      card.appendChild(week);

      var totals = S.stats.dailyTotals();
      var metrics = el('div', 'metrics');
      metrics.appendChild(ui.metric(String(totals.count), '累计完成'));
      metrics.appendChild(ui.metric(totals.best === null ? '—' : S.formatTime(totals.best), '最佳用时'));
      metrics.appendChild(ui.metric(streak ? String(streak) : '0', '连续天数'));
      card.appendChild(metrics);
      return card;
    },

    metric: function (value, label) {
      var box = el('div', 'metric');
      box.appendChild(el('div', 'metric__value', value));
      box.appendChild(el('div', 'metric__label', label));
      return box;
    },

    /** 每日模式的累计数据（与“最近 7 天”卡片互补） */
    card_dailyTotals: function () {
      var card = el('section', 'card');
      card.appendChild(el('div', 'card__kicker', '进度'));
      card.appendChild(el('h2', null, '你的每日战绩'));
      var totals = S.stats.dailyTotals();
      var metrics = el('div', 'metrics');
      metrics.appendChild(ui.metric(String(totals.count), '完成期数'));
      metrics.appendChild(ui.metric(totals.best === null ? '—' : S.formatTime(totals.best), '最佳用时'));
      metrics.appendChild(ui.metric(String(S.stats.streak()), '连续天数'));
      card.appendChild(metrics);
      var tip = el('p', null, '每天更新一道题，难度按星期轮换：周三最轻松，周末偏难。');
      card.appendChild(tip);
      return card;
    },

    /** 练习题的最佳成绩明细 */
    card_best: function (game) {
      var card = el('section', 'card');
      card.appendChild(el('div', 'card__kicker', '个人最佳'));
      card.appendChild(el('h2', null, game.size + '×' + game.size + ' 各难度最佳'));
      var list = el('div', 'shortcuts');
      S.DIFFICULTY_ORDER.forEach(function (key) {
        var best = S.stats.bestTime(game.size, key);
        var line = el('div');
        line.appendChild(el('span', null, S.DIFFICULTY_LABEL[key]));
        line.appendChild(el('span', null, best === null ? '—' : S.formatTime(best)));
        list.appendChild(line);
      });
      card.appendChild(list);
      return card;
    },

    card_practice: function (game) {
      var card = el('section', 'card');
      card.appendChild(el('div', 'card__kicker', '不限模式'));
      card.appendChild(el('h2', null, '成绩统计'));
      var sum = S.stats.summary('practice', game.size);
      var best = S.stats.bestTime(game.size, game.difficulty);
      var metrics = el('div', 'metrics');
      metrics.appendChild(ui.metric(String(sum.won), '完成局数'));
      metrics.appendChild(ui.metric(best === null ? '—' : S.formatTime(best), '最佳用时'));
      metrics.appendChild(ui.metric(sum.average === null ? '—' : S.formatTime(sum.average), '平均用时'));
      card.appendChild(metrics);
      var note = el('p', null, S.DIFFICULTY_LABEL[game.difficulty] + ' · ' + game.size + '×' + game.size +
        '（题面 ' + (game.givens.filter(function (v) { return v > 0; }).length) + ' 个已知数）');
      card.appendChild(note);
      return card;
    },

    card_settings: function (view) {
      var card = el('section', 'card');
      card.appendChild(el('div', 'card__kicker', '外观与偏好'));

      // —— 主题：一排色卡，点一下整套配色就换 ——
      card.appendChild(el('h2', null, '配色主题'));
      var grid = el('div', 'theme-grid');
      var current = S.settings.get('theme');
      S.THEMES.forEach(function (theme) {
        var swatch = el('button', 'theme-swatch' + (theme.id === current ? ' is-active' : ''));
        swatch.type = 'button';
        swatch.dataset.theme = theme.id;
        swatch.title = theme.label;
        swatch.setAttribute('aria-label', '配色主题：' + theme.label);
        swatch.setAttribute('aria-pressed', theme.id === current ? 'true' : 'false');

        var dot = el('span', 'theme-swatch__dot');
        dot.style.background = theme.swatch;
        swatch.appendChild(dot);
        swatch.appendChild(el('span', 'theme-swatch__label', theme.label));
        grid.appendChild(swatch);
      });
      card.appendChild(grid);

      // —— 棋盘规格 ——
      var sizeRow = el('div', 'setting');
      var sizeText = el('div', 'setting__text');
      sizeText.appendChild(el('b', null, '棋盘规格'));
      sizeText.appendChild(el('small', null, '6×6 迷你 / 9×9 经典'));
      sizeRow.appendChild(sizeText);
      var seg = el('div', 'segmented');
      [6, 9].forEach(function (n) {
        var b = el('button', n === view.size ? 'is-active' : '', n + '×' + n);
        b.type = 'button';
        b.dataset.size = n;
        seg.appendChild(b);
      });
      sizeRow.appendChild(seg);
      card.appendChild(sizeRow);

      card.appendChild(ui.switchRow('自动清理标记', '落子后抹掉同行列的铅笔标记', 'autoNotes'));
      card.appendChild(ui.switchRow('高亮同行同列', '帮助看清当前单元', 'highlightPeers'));
      card.appendChild(ui.switchRow('标出冲突数字', '重复的数字显示为红色', 'showConflicts'));
      card.appendChild(ui.switchRow('检查错误', '与答案不符的数字直接标红', 'autoCheck'));
      card.appendChild(ui.switchRow('数字键剩余数', '显示每个数字还差几个', 'showRemaining'));
      card.appendChild(ui.switchRow('显示计时器', null, 'showTimer'));

      var reset = el('button', 'btn', '清空全部记录');
      reset.type = 'button';
      reset.style.marginTop = '15px';
      reset.style.width = '100%';
      reset.dataset.action = 'reset-data';
      card.appendChild(reset);
      return card;
    },

    switchRow: function (title, hint, key) {
      var row = el('div', 'setting');
      var text = el('div', 'setting__text');
      text.appendChild(el('b', null, title));
      if (hint) text.appendChild(el('small', null, hint));
      row.appendChild(text);
      var sw = el('button', 'switch');
      sw.type = 'button';
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', S.settings.get(key) ? 'true' : 'false');
      sw.setAttribute('aria-label', title);
      sw.dataset.setting = key;
      row.appendChild(sw);
      return row;
    },

    card_help: function (game) {
      var card = el('section', 'card');
      card.appendChild(el('div', 'card__kicker', '规则'));
      card.appendChild(el('h2', null, '怎么玩'));

      var rules = el('ul', 'rules');
      var li1 = el('li');
      li1.appendChild(document.createTextNode('在 ' + game.size + '×' + game.size + ' 的棋盘里，让每行、每列、每个 ' +
        game.boxRows + '×' + game.boxCols + ' 的宫里都恰好出现一次 1–' + game.size + '。'));
      rules.appendChild(li1);
      rules.appendChild(el('li', null, '点击格子选中，再点数字键填入；重复点击同一数字可以取消。'));
      rules.appendChild(el('li', null, '不确定时点亮「标记」，把候选数字用小字写进格子里。'));
      card.appendChild(rules);

      var shortcuts = el('div', 'shortcuts');
      [['方向键 / WASD', '移动选中格'], ['1–' + game.size, '填入数字'], ['Backspace', '擦除'],
       ['N', '标记模式'], ['Z', '撤销'], ['H', '提示'], ['空格', '暂停']].forEach(function (pair) {
        var line = el('div');
        line.appendChild(el('span', 'kbd', pair[0]));
        line.appendChild(el('span', null, pair[1]));
        shortcuts.appendChild(line);
      });
      card.appendChild(shortcuts);
      return card;
    },

    /* ------------------------------------------------------------ 弹窗 */

    showModal: function (opts) {
      var modal = $('modal');
      $('modal-emoji').textContent = opts.emoji || '🎉';
      $('modal-title').textContent = opts.title || '完成！';
      $('modal-sub').textContent = opts.sub || '';

      var stats = $('modal-stats');
      stats.innerHTML = '';
      (opts.stats || []).forEach(function (item) {
        var box = el('div', 'stat');
        box.appendChild(el('div', 'stat__value' + (item.highlight ? ' is-best' : ''), item.value));
        box.appendChild(el('div', 'stat__label', item.label));
        stats.appendChild(box);
      });

      var primary = $('modal-primary');
      var secondary = $('modal-secondary');
      primary.textContent = opts.primaryLabel || '再来一题';
      secondary.textContent = opts.secondaryLabel || '往期题目';
      secondary.hidden = !opts.secondaryLabel;
      modal.classList.add('is-open');
      ui._modalHandlers = opts;
      setTimeout(function () { primary.focus(); }, 40);
    },

    hideModal: function () { $('modal').classList.remove('is-open'); },

    modalHandlers: function () { return ui._modalHandlers; },

    /* ------------------------------------------------------------ 提示条 */

    toast: S.toast
  };

  S.ui = ui;
})(typeof window !== 'undefined' ? window : globalThis);
