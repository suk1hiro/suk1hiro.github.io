/*!
 * Ember Check-in — core.js
 * 纯逻辑核心：无 DOM、无 localStorage、无网络、无 console 输出。
 * UMD：浏览器挂到 globalThis.EmberCore；Node 通过 module.exports 导出。
 * 契约见 ember-checkin/SPEC.md 第 4–5 节。
 *
 * 约定：
 *  - 所有 dateKey 均为「本地时区」的 YYYY-MM-DD 字符串；
 *  - addDays / diffDays 内部用 UTC civil 日期做整数天运算，不受 DST 影响；
 *  - 所有函数都不修改传入的 task / db（setTaskCompletion 返回新的 completions）；
 *  - weekly 相关函数接受可选的第三个参数 opts，可以是数字 weekStart(1|7)、
 *    {weekStart}、或整个 db / settings 对象；不传时默认周一。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EmberCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  // ============================================================
  // 0. 常量与通用小工具
  // ============================================================

  var VERSION = 1;
  var TASK_TYPES = ['daily', 'weekly', 'monthly', 'interval', 'urgent'];
  var PRIORITIES = ['high', 'normal', 'low'];
  var WEEKDAY_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  var DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];
  var MS_PER_DAY = 86400000;
  var UPCOMING_LIMIT = 5;
  var STREAK_GUARD = 3660; // 最多回溯约 10 年，防止坏数据造成死循环

  function isDangerousKey(key) {
    return DANGEROUS_KEYS.indexOf(String(key)) !== -1;
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function clampInt(value, min, max, fallback) {
    var n = typeof value === 'number' ? value : Number(value);
    if (!isFinite(n)) return fallback;
    n = Math.trunc(n);
    if (n < min) return fallback;
    if (n > max) return fallback;
    return n;
  }

  function toDate(value) {
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : new Date(value.getTime());
    }
    if (typeof value === 'string' || typeof value === 'number') {
      var d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  function isIsoLike(value) {
    if (typeof value !== 'string' || !value) return false;
    return !isNaN(new Date(value).getTime());
  }

  /** 可安全用于对象键的字符串（过滤原型污染键）。 */
  function isSafeKey(key) {
    return typeof key === 'string' && key.length > 0 && !isDangerousKey(key);
  }

  // ============================================================
  // 1. 日期工具
  // ============================================================

  function pad2(n) {
    var v = Math.trunc(Number(n));
    if (!isFinite(v)) v = 0;
    return (v < 10 ? '0' : '') + Math.abs(v);
  }

  function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }

  function daysInMonth(y, m) {
    switch (m) {
      case 2:
        return isLeapYear(y) ? 29 : 28;
      case 4:
      case 6:
      case 9:
      case 11:
        return 30;
      default:
        return 31;
    }
  }

  /** 'YYYY-MM-DD' -> {y,m,d}；非法时抛错。 */
  function parseDateKey(key) {
    if (typeof key !== 'string') {
      throw new Error('parseDateKey: 需要 YYYY-MM-DD 字符串');
    }
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!match) {
      throw new Error('parseDateKey: 无法解析日期 ' + key);
    }
    var y = Number(match[1]);
    var m = Number(match[2]);
    var d = Number(match[3]);
    if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
      throw new Error('parseDateKey: 非法日期 ' + key);
    }
    return { y: y, m: m, d: d };
  }

  function isKey(value) {
    if (typeof value !== 'string') return false;
    try {
      parseDateKey(value);
      return true;
    } catch (err) {
      return false;
    }
  }

  /** 本地 Date -> 'YYYY-MM-DD'。传入合法 dateKey 时原样返回（方便内部用）。 */
  function dateKeyFromDate(date) {
    if (typeof date === 'string' && isKey(date)) return date;
    var d = date instanceof Date ? date : new Date(date);
    if (!d || isNaN(d.getTime())) {
      throw new TypeError('dateKeyFromDate: 非法 Date');
    }
    return String(d.getFullYear()) + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function nowKey(date) {
    return dateKeyFromDate(date == null ? new Date() : date);
  }

  /** 内部：取合法 dateKey，否则回退到 fallback，再否则今天。 */
  function keyOr(value, fallback) {
    if (isKey(value)) return value;
    if (isKey(fallback)) return fallback;
    return nowKey();
  }

  /** civil 日期 -> UTC 毫秒（只用于整数天运算，与本地 DST 无关）。 */
  function civilMs(key) {
    var p = parseDateKey(key);
    return Date.UTC(p.y, p.m - 1, p.d);
  }

  function msToKey(ms) {
    var d = new Date(ms);
    return String(d.getUTCFullYear()) + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  function addDays(key, n) {
    var days = Math.trunc(Number(n));
    if (!isFinite(days)) days = 0;
    return msToKey(civilMs(key) + days * MS_PER_DAY);
  }

  /** b - a，整天数（b 在 a 之后为正）。 */
  function diffDays(a, b) {
    return Math.round((civilMs(b) - civilMs(a)) / MS_PER_DAY);
  }

  /** ISO 星期：1=周一 ... 7=周日。 */
  function weekdayISO(key) {
    var d = new Date(civilMs(key));
    var wd = d.getUTCDay();
    return wd === 0 ? 7 : wd;
  }

  /** 周起始参数归一化：接受数字、{weekStart}、{settings:{weekStart}} 或 db。 */
  function weekStartFrom(source) {
    if (typeof source === 'number') {
      return source === 7 ? 7 : 1;
    }
    if (isPlainObject(source)) {
      var holder = isPlainObject(source.settings) ? source.settings : source;
      if (holder && typeof holder.weekStart === 'number') {
        return holder.weekStart === 7 ? 7 : 1;
      }
    }
    return 1;
  }

  function startOfWeek(key, weekStart) {
    var ws = weekStartFrom(weekStart);
    var wd = weekdayISO(key);
    var offset = (wd - ws + 7) % 7;
    return addDays(key, -offset);
  }

  function endOfWeek(key, weekStart) {
    return addDays(startOfWeek(key, weekStart), 6);
  }

  function monthKey(key) {
    var p = parseDateKey(key);
    return String(p.y) + '-' + pad2(p.m);
  }

  function monthStartKey(key) {
    var p = parseDateKey(key);
    return String(p.y) + '-' + pad2(p.m) + '-01';
  }

  function monthEndKey(key) {
    var p = parseDateKey(key);
    return String(p.y) + '-' + pad2(p.m) + '-' + pad2(daysInMonth(p.y, p.m));
  }

  function formatDateCN(key) {
    var p = parseDateKey(key);
    var wd = weekdayISO(key);
    return p.m + '月' + p.d + '日 ' + WEEKDAY_CN[wd - 1];
  }

  /** 本地时间 HH:mm。 */
  function formatDateTimeCN(date) {
    var d = toDate(date);
    if (!d) return '';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function parseClock(value) {
    if (typeof value !== 'string') return null;
    var match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    var h = Number(match[1]);
    var m = Number(match[2]);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return { h: h, m: m };
  }

  function formatClock(value) {
    var c = parseClock(value);
    return c ? pad2(c.h) + ':' + pad2(c.m) : null;
  }

  /** 本地 dateKey + HH:mm -> Date。 */
  function localDateTime(key, clock) {
    var p = parseDateKey(key);
    return new Date(p.y, p.m - 1, p.d, clock.h, clock.m, 0, 0);
  }

  // ============================================================
  // 2. 任务字段规范化
  // ============================================================

  function uid(prefix) {
    var p = typeof prefix === 'string' && prefix ? prefix : 'id';
    var stamp = Date.now().toString(36);
    var rand = Math.random().toString(36).slice(2, 8);
    return p + '_' + stamp + rand;
  }

  function normalizeMonthday(value) {
    if (value === -1 || value === '-1') return -1;
    var n = Number(value);
    if (!isFinite(n)) return 1;
    n = Math.trunc(n);
    if (n === -1) return -1;
    if (n < 1 || n > 31) return 1;
    return n;
  }

  function normalizeEveryN(value) {
    return clampInt(value, 2, 365, 3);
  }

  /** 只保留合法 occurrenceKey -> 非空字符串时间戳。 */
  function normalizeCompletions(raw) {
    var out = {};
    if (!isPlainObject(raw)) return out;
    var keys = Object.keys(raw);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (!isSafeKey(key)) continue;
      if (!isCompletionKey(key)) continue;
      var value = raw[key];
      if (typeof value === 'string' && value) {
        out[key] = value;
      }
    }
    return out;
  }

  function isCompletionKey(key) {
    if (key === 'once') return true;
    if (isKey(key)) return true;
    if (key.indexOf('W:') === 0) return isKey(key.slice(2));
    if (key.indexOf('M:') === 0) return /^\d{4}-\d{2}$/.test(key.slice(2));
    if (key.indexOf('I:') === 0) return isKey(key.slice(2));
    return false;
  }

  function normalizeReminder(raw) {
    var src = isPlainObject(raw) ? raw : {};
    return {
      enabled: src.enabled === true,
      time: formatClock(src.time) || '21:00'
    };
  }

  function normalizeTask(raw, todayKey) {
    var today = keyOr(todayKey);
    var src = isPlainObject(raw) ? raw : {};
    var type = TASK_TYPES.indexOf(src.type) !== -1 ? src.type : 'daily';
    var title = typeof src.title === 'string' ? src.title.trim() : '';
    var emoji = typeof src.emoji === 'string' ? src.emoji.trim() : '';
    var category = typeof src.category === 'string' ? src.category.trim() : '';
    var id = typeof src.id === 'string' ? src.id.trim() : '';
    return {
      id: id || uid('t'),
      title: title || '未命名任务',
      emoji: emoji.slice(0, 8) || '✨',
      category: category,
      notes: typeof src.notes === 'string' ? src.notes : '',
      type: type,
      monthday: normalizeMonthday(src.monthday),
      everyN: normalizeEveryN(src.everyN),
      anchor: isKey(src.anchor) ? src.anchor : today,
      due: isKey(src.due) ? src.due : today,
      dueTime: formatClock(src.dueTime) || '18:00',
      priority: PRIORITIES.indexOf(src.priority) !== -1 ? src.priority : 'normal',
      reminder: normalizeReminder(src.reminder),
      fire: src.fire === true,
      completions: normalizeCompletions(src.completions),
      createdAt: isIsoLike(src.createdAt) ? src.createdAt : new Date().toISOString(),
      archived: src.archived === true
    };
  }

  /** 新建任务：补全默认值 + 稳定可用 id。 */
  function createTask(input, todayKey) {
    var src = isPlainObject(input) ? input : {};
    var seed = {};
    var keys = Object.keys(src);
    for (var i = 0; i < keys.length; i++) {
      if (isSafeKey(keys[i])) seed[keys[i]] = src[keys[i]];
    }
    if (typeof seed.id !== 'string' || !seed.id.trim()) {
      seed.id = uid('t');
    }
    return normalizeTask(seed, todayKey);
  }

  function normalizeSettings(raw) {
    var src = isPlainObject(raw) ? raw : {};
    var name = typeof src.name === 'string' ? src.name.trim() : '';
    return {
      name: name || '朋友',
      theme: src.theme === 'light' ? 'light' : 'dark',
      sound: src.sound === false ? false : true,
      weekStart: src.weekStart === 7 ? 7 : 1,
      seeded: src.seeded === true,
      createdAt: isIsoLike(src.createdAt) ? src.createdAt : new Date().toISOString(),
      updatedAt: isIsoLike(src.updatedAt) ? src.updatedAt : new Date().toISOString()
    };
  }

  function normalizeStringArray(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length; i++) {
      if (typeof raw[i] === 'string' && raw[i]) out.push(raw[i]);
    }
    return out;
  }

  function normalizeDayLog(raw) {
    var out = {};
    if (!isPlainObject(raw)) return out;
    var keys = Object.keys(raw);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (!isKey(key)) continue;
      var entry = raw[key];
      if (!isPlainObject(entry)) continue;
      var done = normalizeStringArray(entry.done);
      var required = normalizeStringArray(entry.required);
      var total = Number(entry.total);
      if (!isFinite(total) || total < 0) {
        total = Math.max(done.length, required.length);
      } else {
        total = Math.trunc(total);
      }
      out[key] = {
        lit: entry.lit === true,
        required: required,
        done: done,
        total: total,
        updatedAt: isIsoLike(entry.updatedAt) ? entry.updatedAt : null
      };
    }
    return out;
  }

  function normalizeFired(raw) {
    var out = {};
    if (!isPlainObject(raw)) return out;
    var keys = Object.keys(raw);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (!isSafeKey(key)) continue;
      var value = raw[key];
      if (isIsoLike(value)) out[key] = value;
    }
    return out;
  }

  function normalizeSnoozes(raw) {
    var out = {};
    if (!isPlainObject(raw)) return out;
    var keys = Object.keys(raw);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (!isSafeKey(key)) continue;
      var value = raw[key];
      if (isIsoLike(value)) out[key] = value;
    }
    return out;
  }

  /** 返回安全 db；不修改入参、不抛异常。 */
  function normalizeDb(raw) {
    var src = isPlainObject(raw) ? raw : {};
    var db = {
      version: VERSION,
      tasks: [],
      settings: normalizeSettings(src.settings),
      dayLog: normalizeDayLog(src.dayLog),
      fired: normalizeFired(src.fired),
      snoozes: normalizeSnoozes(src.snoozes)
    };
    var seen = {};
    if (Array.isArray(src.tasks)) {
      for (var i = 0; i < src.tasks.length; i++) {
        // 非对象条目直接丢弃，避免坏数据生成幽灵任务
        if (!isPlainObject(src.tasks[i])) continue;
        var candidate = normalizeTask(src.tasks[i]);
        if (seen[candidate.id]) continue; // 重复 id 保留第一个
        seen[candidate.id] = true;
        db.tasks.push(candidate);
      }
    }
    return db;
  }

  // ============================================================
  // 3. 周期计算
  // ============================================================

  function recurrenceLabel(task) {
    var t = normalizeTask(task);
    if (t.type === 'weekly') return '每周';
    if (t.type === 'monthly') {
      return t.monthday === -1 ? '每月最后一天' : '每月 ' + t.monthday + ' 日';
    }
    if (t.type === 'interval') return '每 ' + t.everyN + ' 天';
    if (t.type === 'urgent') return '紧要任务';
    return '每天';
  }

  /** 紧凑读取 interval 参数，不生成 id / 时间戳。 */
  function intervalInfo(task, dateKey) {
    var anchor = isKey(task && task.anchor) ? task.anchor : dateKey;
    var everyN = normalizeEveryN(task && task.everyN);
    var diff = diffDays(anchor, dateKey);
    var rawIndex = Math.floor(diff / everyN);
    var index = rawIndex < 0 ? 0 : rawIndex;
    var cycleStart = addDays(anchor, index * everyN);
    return {
      anchor: anchor,
      everyN: everyN,
      diff: diff,
      rawIndex: rawIndex,
      index: index,
      available: diff >= 0,
      cycleStart: cycleStart,
      cycleEnd: addDays(cycleStart, everyN - 1)
    };
  }

  /** 每月实际到期日：超过当月天数归到月末，-1 = 月末。 */
  function monthlyDueKey(task, dateKey) {
    var key = keyOr(dateKey);
    var t = normalizeTask(task, key);
    var p = parseDateKey(key);
    var dim = daysInMonth(p.y, p.m);
    var day = t.monthday === -1 ? dim : Math.min(t.monthday, dim);
    return String(p.y) + '-' + pad2(p.m) + '-' + pad2(day);
  }

  function occurrenceKey(task, dateKey, weekStartOpts) {
    var key = keyOr(dateKey);
    var t = normalizeTask(task, key);
    var ws = weekStartFrom(weekStartOpts);
    switch (t.type) {
      case 'weekly':
        return 'W:' + startOfWeek(key, ws);
      case 'monthly':
        return 'M:' + monthKey(key);
      case 'interval':
        return 'I:' + intervalInfo(t, key).cycleStart;
      case 'urgent':
        return 'once';
      default:
        return key;
    }
  }

  function isTaskComplete(task, dateKey, weekStartOpts) {
    var key = keyOr(dateKey);
    var t = normalizeTask(task, key);
    var occ = occurrenceKey(t, key, weekStartOpts);
    return !!t.completions[occ];
  }

  function setTaskCompletion(task, dateKey, done, weekStartOpts) {
    var key = keyOr(dateKey);
    var t = normalizeTask(task, key);
    var next = {};
    var keys = Object.keys(t.completions);
    for (var i = 0; i < keys.length; i++) next[keys[i]] = t.completions[keys[i]];
    var occ = occurrenceKey(t, key, weekStartOpts);
    if (done) {
      next[occ] = new Date().toISOString();
    } else {
      delete next[occ];
    }
    return next;
  }

  /** 完整任务状态；字段固定为 SPEC 第 5 节列出的 9 个。 */
  function taskState(task, dateKey, weekStartOpts) {
    var key = keyOr(dateKey);
    var t = normalizeTask(task, key);
    var ws = weekStartFrom(weekStartOpts);
    var occ = occurrenceKey(t, key, ws);
    var complete = !!t.completions[occ];
    var state = {
      available: true,
      complete: complete,
      occurrenceKey: occ,
      cycleStart: key,
      cycleEnd: key,
      daysLeft: 0,
      cycleDay: 1,
      totalDays: 1,
      overdue: false,
      overdueDays: 0
    };

    if (t.type === 'weekly') {
      state.cycleStart = startOfWeek(key, ws);
      state.cycleEnd = endOfWeek(key, ws);
      state.daysLeft = diffDays(key, state.cycleEnd);
      state.cycleDay = diffDays(state.cycleStart, key) + 1;
      state.totalDays = 7;
    } else if (t.type === 'monthly') {
      var p = parseDateKey(key);
      state.cycleStart = monthStartKey(key);
      state.cycleEnd = monthEndKey(key);
      state.daysLeft = diffDays(key, state.cycleEnd);
      state.cycleDay = p.d;
      state.totalDays = daysInMonth(p.y, p.m);
    } else if (t.type === 'interval') {
      var info = intervalInfo(t, key);
      state.available = info.available;
      state.cycleStart = info.cycleStart;
      state.cycleEnd = info.cycleEnd;
      state.totalDays = info.everyN;
      if (info.available) {
        state.daysLeft = diffDays(key, info.cycleEnd);
        state.cycleDay = diffDays(info.cycleStart, key) + 1;
      } else {
        // anchor 在未来：倒计时到开始日，本周期尚未开始
        state.daysLeft = diffDays(key, info.anchor);
        state.cycleDay = 0;
      }
    } else if (t.type === 'urgent') {
      state.cycleStart = t.due;
      state.cycleEnd = t.due;
      state.daysLeft = diffDays(key, t.due);
      state.overdue = !complete && state.daysLeft < 0;
      state.overdueDays = state.overdue ? -state.daysLeft : 0;
      state.cycleDay = 1;
      state.totalDays = 1;
    }
    // daily 保持默认：cycleStart=cycleEnd=dateKey, daysLeft=0, totalDays=1

    return state;
  }

  function dueLabel(task, dateKey, weekStartOpts) {
    var key = keyOr(dateKey);
    var t = normalizeTask(task, key);
    var state = taskState(t, key, weekStartOpts);

    if (t.type === 'urgent') {
      if (state.complete) return { text: '已完成', tone: 'normal' };
      if (state.overdue) {
        return { text: '逾期 ' + state.overdueDays + ' 天', tone: 'danger' };
      }
      if (state.daysLeft === 0) return { text: '今天截止', tone: 'warn' };
      return { text: state.daysLeft + ' 天后截止', tone: 'normal' };
    }
    if (t.type === 'weekly') {
      return { text: state.complete ? '本周已完成' : '本周', tone: 'normal' };
    }
    if (t.type === 'monthly') {
      return { text: state.complete ? '本月已完成' : '本月', tone: 'normal' };
    }
    if (t.type === 'interval') {
      if (!state.available) {
        return { text: state.daysLeft + ' 天后开始', tone: 'normal' };
      }
      if (state.complete) return { text: '本轮已完成', tone: 'normal' };
      return {
        text: '本轮剩 ' + state.daysLeft + ' 天',
        tone: state.daysLeft <= 1 ? 'warn' : 'normal'
      };
    }
    return { text: state.complete ? '今日已完成' : '今天', tone: 'normal' };
  }

  /** 连续完成周期数；当前周期未完成时返回上一段连续数。urgent 恒为 0。 */
  function taskStreak(task, db, dateKey, weekStartOpts) {
    var t = normalizeTask(task);
    if (t.type === 'urgent') return 0;
    var key;
    var wsSource = weekStartOpts;
    if (typeof db === 'string') {
      key = keyOr(db);
    } else {
      key = keyOr(dateKey);
      if (wsSource == null) wsSource = db;
    }
    var ws = weekStartFrom(wsSource);
    var doneAt = function (d) {
      return isTaskComplete(t, d, ws);
    };

    if (t.type === 'daily') {
      var cursor = key;
      var count = 0;
      if (!doneAt(cursor)) cursor = addDays(cursor, -1);
      while (count < STREAK_GUARD && doneAt(cursor)) {
        count += 1;
        cursor = addDays(cursor, -1);
      }
      return count;
    }

    if (t.type === 'weekly') {
      var weekStart = startOfWeek(key, ws);
      var weeks = 0;
      if (doneAt(weekStart)) {
        weeks += 1;
      }
      weekStart = addDays(weekStart, -7);
      while (weeks < STREAK_GUARD && doneAt(weekStart)) {
        weeks += 1;
        weekStart = addDays(weekStart, -7);
      }
      return weeks;
    }

    if (t.type === 'monthly') {
      // 以「当月 1 号」作为周期代表日
      var monthCursor = monthStartKey(key);
      var months = 0;
      if (doneAt(monthCursor)) {
        months += 1;
      }
      var guard = 0;
      monthCursor = previousMonthStart(monthCursor);
      while (guard < STREAK_GUARD && doneAt(monthCursor)) {
        months += 1;
        monthCursor = previousMonthStart(monthCursor);
        guard += 1;
      }
      return months;
    }

    // interval
    var info = intervalInfo(t, key);
    if (info.rawIndex < 0) return 0; // 任务尚未开始
    var cycles = 0;
    var index = info.rawIndex;
    if (isTaskCompleteAtCycle(t, info, index)) {
      cycles += 1;
    }
    index -= 1;
    var cycleGuard = 0;
    while (cycleGuard < STREAK_GUARD && index >= 0 && isTaskCompleteAtCycle(t, info, index)) {
      cycles += 1;
      index -= 1;
      cycleGuard += 1;
    }
    return cycles;
  }

  function previousMonthStart(monthStart) {
    var p = parseDateKey(monthStart);
    var y = p.m === 1 ? p.y - 1 : p.y;
    var m = p.m === 1 ? 12 : p.m - 1;
    return String(y) + '-' + pad2(m) + '-01';
  }

  function isTaskCompleteAtCycle(task, info, index) {
    var start = addDays(info.anchor, index * info.everyN);
    return !!task.completions['I:' + start];
  }

  // ============================================================
  // 4. 合成台 / 材料状态
  // ============================================================

  function activeTasks(tasks) {
    if (!Array.isArray(tasks)) return [];
    var out = [];
    for (var i = 0; i < tasks.length; i++) {
      var task = tasks[i];
      if (!isPlainObject(task)) continue;
      if (task.archived === true) continue;
      out.push(task);
    }
    return out;
  }

  function fireCandidates(tasks) {
    // 所有未归档任务（recurring + urgent）都可以被设为配方材料
    return activeTasks(tasks);
  }

  function fireState(db, dateKey) {
    var safe = normalizeDb(db);
    var key = keyOr(dateKey);
    var ws = safe.settings.weekStart;
    var fireTasks = activeTasks(safe.tasks).filter(function (task) {
      return task.fire === true;
    });
    var tasks = [];
    var missing = [];
    for (var i = 0; i < fireTasks.length; i++) {
      var task = fireTasks[i];
      var state = taskState(task, key, ws);
      if (!state.available) continue;
      tasks.push({ task: task, complete: state.complete });
      if (!state.complete) missing.push(task);
    }
    var done = tasks.length - missing.length;
    return {
      configured: fireTasks.length > 0,
      total: tasks.length,
      done: done,
      lit: tasks.length > 0 && missing.length === 0,
      tasks: tasks,
      missing: missing
    };
  }

  function buildDayLog(db, dateKey, updatedAt) {
    var safe = normalizeDb(db);
    var key = keyOr(dateKey);
    var ws = safe.settings.weekStart;
    var fire = fireState(safe, key);
    var active = activeTasks(safe.tasks);
    var todayTasks = [];
    var doneIds = [];
    for (var i = 0; i < active.length; i++) {
      var state = taskState(active[i], key, ws);
      if (!state.available) continue;
      todayTasks.push(active[i]);
      if (state.complete) doneIds.push(active[i].id);
    }
    return {
      lit: fire.lit,
      required: fire.tasks.map(function (item) { return item.task.id; }),
      done: doneIds,
      total: todayTasks.length,
      updatedAt: isIsoLike(updatedAt) ? updatedAt : new Date().toISOString()
    };
  }

  function progressOf(tasks, key, ws) {
    var total = 0;
    var done = 0;
    for (var i = 0; i < tasks.length; i++) {
      var state = taskState(tasks[i], key, ws);
      if (!state.available) continue;
      total += 1;
      if (state.complete) done += 1;
    }
    return {
      done: done,
      total: total,
      percent: total > 0 ? Math.round((done / total) * 100) : 0
    };
  }

  function taskProgress(db, dateKey) {
    var safe = normalizeDb(db);
    var key = keyOr(dateKey);
    var ws = safe.settings.weekStart;
    var active = activeTasks(safe.tasks);
    var daily = active.filter(function (task) { return task.type === 'daily'; });
    var extra = active.filter(function (task) { return task.type !== 'daily'; });
    var all = progressOf(active, key, ws);
    return {
      done: all.done,
      total: all.total,
      percent: all.percent,
      daily: progressOf(daily, key, ws),
      extra: progressOf(extra, key, ws)
    };
  }

  /** 某天是否点亮：历史看 dayLog；今天优先 dayLog，缺失时用 fireState 推导。 */
  function makeLitLookup(safe, key, fire) {
    var todayLog = safe.dayLog[key];
    var litToday = todayLog ? todayLog.lit === true : fire.lit;
    function isLitDate(date) {
      if (date === key) return litToday;
      if (diffDays(key, date) > 0) return false; // 未来不算点亮
      var log = safe.dayLog[date];
      return !!(log && log.lit === true);
    }
    return { litToday: litToday, isLitDate: isLitDate };
  }

  function countRunEndingAt(date, isLitDate) {
    var count = 0;
    var cursor = date;
    while (count < STREAK_GUARD && isLitDate(cursor)) {
      count += 1;
      cursor = addDays(cursor, -1);
    }
    return count;
  }

  function dayStatus(date, key, isLitDate) {
    if (diffDays(key, date) > 0) return 'future';
    if (isLitDate(date)) return 'lit';
    // 断掉的第一天 / 今天还没完成：显示为进行中
    var previous = addDays(date, -1);
    if (isLitDate(previous)) return 'frozen';
    return 'missed';
  }

  function streakInfo(db, dateKey) {
    var safe = normalizeDb(db);
    var key = keyOr(dateKey);
    var fire = fireState(safe, key);
    var litLookup = makeLitLookup(safe, key, fire);
    var isLitDate = litLookup.isLitDate;
    var litToday = litLookup.litToday;
    var configured = fire.configured;
    var yesterday = addDays(key, -1);
    var yesterdayLit = isLitDate(yesterday);

    var state;
    var frozen = false;
    var current = 0;
    if (litToday) {
      state = 'lit';
      current = countRunEndingAt(key, isLitDate);
    } else if (!configured) {
      state = 'unset';
    } else if (yesterdayLit) {
      state = 'frozen';
      frozen = true;
      current = countRunEndingAt(yesterday, isLitDate);
    } else {
      state = 'out';
    }

    // best / totalLit：历史 dayLog + 今日推导
    var litSet = {};
    var logKeys = Object.keys(safe.dayLog);
    for (var i = 0; i < logKeys.length; i++) {
      var date = logKeys[i];
      if (diffDays(key, date) > 0) continue; // 忽略未来脏数据
      if (safe.dayLog[date].lit === true) litSet[date] = true;
    }
    if (litToday) litSet[key] = true;
    var litDates = Object.keys(litSet).sort();
    var best = 0;
    var run = 0;
    var previous = null;
    for (var j = 0; j < litDates.length; j++) {
      if (previous && diffDays(previous, litDates[j]) === 1) {
        run += 1;
      } else {
        run = 1;
      }
      if (run > best) best = run;
      previous = litDates[j];
    }

    var days = [];
    for (var offset = 29; offset >= 0; offset -= 1) {
      var day = addDays(key, -offset);
      days.push({
        date: day,
        status: dayStatus(day, key, isLitDate)
      });
    }

    return {
      current: current,
      best: best,
      totalLit: litDates.length,
      litToday: litToday,
      frozen: frozen,
      state: state,
      days: days
    };
  }

  // ============================================================
  // 5. 提醒
  // ============================================================

  function isReminderActive(task, dateKey, weekStartOpts) {
    var key = keyOr(dateKey);
    var t = normalizeTask(task, key);
    if (!t.reminder.enabled) return false;
    var state = taskState(t, key, weekStartOpts);
    if (state.complete) return false;
    if (t.type === 'urgent') return key === t.due;
    return state.available;
  }

  function reminderAt(task, dateKey, weekStartOpts) {
    var key = keyOr(dateKey);
    var t = normalizeTask(task, key);
    if (!t.reminder.enabled) return null;
    if (!isReminderActive(t, key, weekStartOpts)) return null;
    var clock = parseClock(t.reminder.time);
    if (!clock) return null;
    return localDateTime(key, clock);
  }

  function reminderSignature(task, dateKey) {
    var key = keyOr(dateKey);
    var t = normalizeTask(task, key);
    return t.id + '|' + key + '|' + (formatClock(t.reminder.time) || '21:00');
  }

  function readSnooze(db, taskId) {
    if (!isPlainObject(db) || !isPlainObject(db.snoozes)) return null;
    if (!isSafeKey(taskId)) return null;
    var raw = db.snoozes[taskId];
    return isIsoLike(raw) ? new Date(raw) : null;
  }

  function readFired(db, signature) {
    if (!isPlainObject(db) || !isPlainObject(db.fired)) return false;
    return isIsoLike(db.fired[signature]);
  }

  function shouldFireReminder(db, task, dateKey, nowDate, weekStartOpts) {
    var key = keyOr(dateKey);
    var now = toDate(nowDate);
    if (!now) return false;
    if (nowKey(now) !== key) return false; // 只在目标日期当天触发
    var t = normalizeTask(task, key);
    if (!t.reminder.enabled) return false;
    var wsSource = weekStartOpts != null ? weekStartOpts : db;
    var state = taskState(t, key, wsSource);
    if (state.complete) return false;
    if (t.type === 'urgent') {
      if (key !== t.due) return false;
    } else if (!state.available) {
      return false;
    }

    // 稍后提醒优先：未到 snooze 时间则压住；到点后即使 fired 也再次 due
    var snoozeAt = readSnooze(db, t.id);
    if (snoozeAt) {
      if (now.getTime() < snoozeAt.getTime()) return false;
      return true;
    }

    var at = reminderAt(t, key, wsSource);
    if (!at) return false;
    if (now.getTime() < at.getTime()) return false;
    var signature = reminderSignature(t, key);
    if (readFired(db, signature)) return false;
    return true;
  }

  function dueAtFor(task, key, now, db, ws) {
    var t = normalizeTask(task, key);
    var snoozeAt = readSnooze(db, t.id);
    if (snoozeAt && snoozeAt.getTime() <= now.getTime()) return snoozeAt;
    var at = reminderAt(t, key, ws);
    return at || now;
  }

  function collectReminders(db, dateKey, nowDate) {
    var safe = normalizeDb(db);
    var key = keyOr(dateKey);
    var now = toDate(nowDate) || new Date();
    var ws = safe.settings.weekStart;
    var due = [];
    var upcoming = [];
    var tasks = activeTasks(safe.tasks);

    for (var i = 0; i < tasks.length; i++) {
      var task = tasks[i];
      if (!task.reminder.enabled) continue;
      var state = taskState(task, key, ws);
      if (state.complete) continue;
      if (task.type === 'urgent') {
        if (key !== task.due) continue;
      } else if (!state.available) {
        continue;
      }

      if (shouldFireReminder(safe, task, key, now, ws)) {
        due.push({
          task: task,
          signature: reminderSignature(task, key),
          at: dueAtFor(task, key, now, safe, ws)
        });
        continue;
      }

      // 已排队的稍后提醒：不再进入 upcoming
      if (readSnooze(safe, task.id)) continue;

      var at = reminderAt(task, key, ws);
      if (!at) continue;
      if (at.getTime() <= now.getTime()) continue; // 已到点但没 due，说明已 fired
      var signature = reminderSignature(task, key);
      if (readFired(safe, signature)) continue;
      upcoming.push({ task: task, signature: signature, at: at });
    }

    due.sort(function (a, b) { return a.at.getTime() - b.at.getTime(); });
    upcoming.sort(function (a, b) { return a.at.getTime() - b.at.getTime(); });
    return { due: due, upcoming: upcoming.slice(0, UPCOMING_LIMIT) };
  }

  // ============================================================
  // 6. 排序与周概览
  // ============================================================

  function createdAtMs(task) {
    var t = normalizeTask(task);
    var ms = new Date(t.createdAt).getTime();
    return isFinite(ms) ? ms : 0;
  }

  function sortTasksForToday(tasks, dateKey, weekStartOpts) {
    var key = keyOr(dateKey);
    var ws = weekStartFrom(weekStartOpts);
    if (!Array.isArray(tasks)) return [];
    // 先一次性算出排序键，避免比较器内重复 normalize 造成不稳定
    var decorated = [];
    for (var i = 0; i < tasks.length; i++) {
      var t = normalizeTask(tasks[i], key);
      var urgent = t.type === 'urgent';
      decorated.push({
        task: tasks[i],
        index: i,
        urgentRank: urgent ? 0 : 1,
        dueMs: urgent ? civilMs(t.due) : 0,
        reminderRank: t.reminder.enabled ? 0 : 1,
        doneRank: isTaskComplete(t, key, ws) ? 1 : 0,
        createdMs: createdAtMs(t),
        title: t.title
      });
    }
    decorated.sort(function (a, b) {
      if (a.urgentRank !== b.urgentRank) return a.urgentRank - b.urgentRank;
      if (a.urgentRank === 0 && a.dueMs !== b.dueMs) return a.dueMs - b.dueMs; // 越早截止越前
      if (a.reminderRank !== b.reminderRank) return a.reminderRank - b.reminderRank;
      if (a.doneRank !== b.doneRank) return a.doneRank - b.doneRank; // 未完成在前
      if (a.createdMs !== b.createdMs) return a.createdMs - b.createdMs;
      if (a.title !== b.title) return a.title < b.title ? -1 : 1;
      return a.index - b.index;
    });
    return decorated.map(function (item) { return item.task; });
  }

  function weekOverview(db, dateKey, weekStartOpts) {
    var safe = normalizeDb(db);
    var key = keyOr(dateKey);
    var ws = weekStartOpts != null ? weekStartFrom(weekStartOpts) : safe.settings.weekStart;
    var start = startOfWeek(key, ws);
    var fire = fireState(safe, key);
    var litLookup = makeLitLookup(safe, key, fire);
    var isLitDate = litLookup.isLitDate;

    var daysElapsed = diffDays(start, key) + 1;
    if (daysElapsed < 1) daysElapsed = 1;
    if (daysElapsed > 7) daysElapsed = 7;

    var litDays = 0;
    var frozenDays = 0;
    var totalCheckins = 0;
    var todayProgress = null;

    for (var i = 0; i < 7; i++) {
      var day = addDays(start, i);
      if (isLitDate(day)) litDays += 1;
      if (diffDays(key, day) <= 0) {
        if (!isLitDate(day) && isLitDate(addDays(day, -1))) frozenDays += 1;
        var log = safe.dayLog[day];
        if (log) {
          totalCheckins += log.done.length;
        } else if (day === key) {
          if (!todayProgress) todayProgress = taskProgress(safe, key);
          totalCheckins += todayProgress.done;
        }
      }
    }

    return {
      litDays: litDays,
      daysElapsed: daysElapsed,
      totalCheckins: totalCheckins,
      frozenDays: frozenDays
    };
  }

  // ============================================================
  // 7. 导出
  // ============================================================

  return {
    // 日期
    pad2: pad2,
    dateKeyFromDate: dateKeyFromDate,
    parseDateKey: parseDateKey,
    addDays: addDays,
    diffDays: diffDays,
    weekdayISO: weekdayISO,
    startOfWeek: startOfWeek,
    endOfWeek: endOfWeek,
    monthKey: monthKey,
    formatDateCN: formatDateCN,
    formatDateTimeCN: formatDateTimeCN,
    isKey: isKey,
    nowKey: nowKey,
    // 任务与周期
    createTask: createTask,
    normalizeTask: normalizeTask,
    normalizeDb: normalizeDb,
    recurrenceLabel: recurrenceLabel,
    occurrenceKey: occurrenceKey,
    taskState: taskState,
    isTaskComplete: isTaskComplete,
    setTaskCompletion: setTaskCompletion,
    dueLabel: dueLabel,
    taskStreak: taskStreak,
    // 合成台
    fireState: fireState,
    streakInfo: streakInfo,
    buildDayLog: buildDayLog,
    taskProgress: taskProgress,
    // 提醒
    reminderAt: reminderAt,
    reminderSignature: reminderSignature,
    shouldFireReminder: shouldFireReminder,
    collectReminders: collectReminders,
    isReminderActive: isReminderActive,
    // 排序/汇总
    sortTasksForToday: sortTasksForToday,
    activeTasks: activeTasks,
    fireCandidates: fireCandidates,
    weekOverview: weekOverview,
    uid: uid,
    // 额外工具（SPEC 之外的补充，向后兼容）
    monthlyDueKey: monthlyDueKey,
    TASK_TYPES: TASK_TYPES.slice(),
    PRIORITIES: PRIORITIES.slice()
  };
});
