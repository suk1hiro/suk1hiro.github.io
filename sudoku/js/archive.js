/*!
 * archive.js — 往期题目档案页
 * 展示最近 N 天的每日题、完成状态与用时，点击任意一期回到当天题目。
 */
(function (global) {
  'use strict';

  var S = global.Sudoku;
  var stats = S.stats;

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function metric(value, label) {
    var box = el('div', 'metric');
    box.appendChild(el('div', 'metric__value', value));
    box.appendChild(el('div', 'metric__label', label));
    return box;
  }

  /** 某一期的难度标签（跟每日题的星期规则保持一致） */
  function difficultyOf(dateKey) { return S.dailyDifficulty(dateKey); }

  function renderStats(days) {
    var done = days.filter(function (d) { return d.done; }).length;
    var times = days.filter(function (d) { return d.done; }).map(function (d) { return d.time; });
    var best = times.length ? Math.min.apply(null, times) : null;
    var average = times.length ? Math.round(times.reduce(function (a, b) { return a + b; }, 0) / times.length) : null;

    var box = $('archive-metrics');
    box.innerHTML = '';
    box.appendChild(metric(done + ' / ' + days.length, '本期完成'));
    box.appendChild(metric(best === null ? '—' : S.formatTime(best), '区间最佳'));
    box.appendChild(metric(average === null ? '—' : S.formatTime(average), '平均用时'));
    box.appendChild(metric(String(stats.streak()), '当前连续'));

    // 取区间内最近的 7 天做小日历
    var week = $('archive-week');
    week.innerHTML = '';
    days.slice(0, 7).slice().reverse().forEach(function (day) {
      var cls = 'week__day' + (day.done ? ' is-done' : '') + (day.key === S.dates.todayKey() ? ' is-today' : '');
      var node = el('div', cls);
      node.appendChild(el('b', null, day.done ? '✓' : S.dates.fromKey(day.key).getDate()));
      node.appendChild(el('span', null, S.dates.weekdayName(day.key).replace('周', '')));
      week.appendChild(node);
    });
  }

  function renderGrid(days) {
    var grid = $('archive-grid');
    grid.innerHTML = '';
    var today = S.dates.todayKey();

    days.forEach(function (day) {
      var record = stats.dailyRecord(day.key);
      var isToday = day.key === today;
      var card = el('a', 'day-card' + (record ? ' is-done' : '') + (isToday ? ' is-today' : ''));

      // 今天用默认入口（daily 模式）；其它日期必须显式带 mode=archive，
      // 否则 index.html 会把 date 忽略掉、只开今天的题。
      card.href = isToday ? 'index.html' : 'index.html?mode=archive&date=' + day.key;

      card.appendChild(el('div', 'day-card__date',
        (isToday ? '今天 · ' : '') + S.dates.label(day.key)));
      card.appendChild(el('div', 'day-card__meta',
        S.dates.weekdayName(day.key) + ' · 第 ' + S.dailyNumber(day.key) + ' 期 · ' +
        (S.DIFFICULTY_LABEL[difficultyOf(day.key)] || '进阶')));

      var foot = el('div', 'day-card__foot');
      foot.appendChild(el('span', null, record ? '已完成' : '未完成'));
      if (record) foot.appendChild(el('span', 'day-card__time', S.formatTime(record.t)));
      card.appendChild(foot);

      if (record) card.appendChild(el('div', 'day-card__badge', '✓'));
      grid.appendChild(card);
    });

    $('archive-empty').hidden = days.length > 0;
  }

  var currentRange = 30;

  function render() {
    var days = stats.recent(currentRange);
    renderStats(days);
    renderGrid(days);
  }

  function boot() {
    var yearNode = $('year');
    if (yearNode) yearNode.textContent = String(new Date().getFullYear());

    Array.prototype.forEach.call(document.querySelectorAll('#nav a'), function (a) {
      a.classList.toggle('is-active', a.dataset.mode === 'archive');
    });

    var picker = $('range-picker');
    picker.onclick = function (ev) {
      var btn = ev.target.closest ? ev.target.closest('button[data-range]') : null;
      if (!btn) return;
      currentRange = Number(btn.dataset.range);
      Array.prototype.forEach.call(picker.children, function (b) {
        b.classList.toggle('is-active', b === btn);
      });
      render();
    };

    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
