/*!
 * stats.js — 进度、最佳成绩与连续打卡记录
 *
 * 存储结构（键名见 core.js 的前缀）：
 *   daily        { 'YYYY-MM-DD': { t, d, h, m } }   每日题完成记录
 *   best         { 'size:difficulty': seconds }      不限模式最佳成绩
 *   records      { '<mode>:<size>': { played, won, seconds, best, hints } } 累计统计
 *   save:<key>   进行中的对局
 */
(function (global) {
  'use strict';

  var S = global.Sudoku = global.Sudoku || {};
  var store = S.store;

  var DAILY_KEY = 'daily';
  var BEST_KEY = 'best';
  var RECORDS_KEY = 'records';

  function todayKey() { return S.dates.todayKey(); }

  var stats = {
    /* ------------------------------------------------------------ 每日题 */

    dailyRecord: function (dateKey) {
      var all = store.get(DAILY_KEY, {});
      return all[dateKey] || null;
    },

    isDailyDone: function (dateKey) { return !!stats.dailyRecord(dateKey); },

    /** 记录一次每日题完成；同一天重复完成只保留更好的成绩 */
    completeDaily: function (dateKey, info) {
      var all = store.get(DAILY_KEY, {});
      var prev = all[dateKey];
      var entry = {
        t: info.time,
        d: info.difficulty,
        h: info.hints || 0,
        m: info.mistakes || 0
      };
      if (!prev || info.time < prev.t) all[dateKey] = entry;
      store.set(DAILY_KEY, all);
      return all[dateKey];
    },

    /** 连续完成天数：从今天（或昨天）往前数不间断的天数 */
    streak: function () {
      var all = store.get(DAILY_KEY, {});
      var today = todayKey();
      var cursor = all[today] ? today : S.dates.shift(today, -1);
      if (!all[cursor]) return 0;
      var count = 0;
      while (all[cursor]) { count++; cursor = S.dates.shift(cursor, -1); }
      return count;
    },

    /** 每日题累计完成数与最佳用时 */
    dailyTotals: function () {
      var all = store.get(DAILY_KEY, {});
      var keys = Object.keys(all);
      var best = null;
      for (var i = 0; i < keys.length; i++) {
        var t = all[keys[i]].t;
        if (best === null || t < best) best = t;
      }
      return { count: keys.length, best: best };
    },

    /** 最近 count 天的完成情况，供侧栏小日历使用 */
    recent: function (count) {
      var days = S.dates.recentDays(count);
      return days.map(function (key) {
        return { key: key, done: stats.isDailyDone(key), time: (stats.dailyRecord(key) || {}).t || null };
      });
    },

    /* ---------------------------------------------------------- 最佳成绩 */

    bestTime: function (size, difficulty) {
      var all = store.get(BEST_KEY, {});
      var v = all[size + ':' + difficulty];
      return typeof v === 'number' ? v : null;
    },

    /** 返回 true 表示刷新了最佳成绩 */
    completePractice: function (size, difficulty, info) {
      var all = store.get(BEST_KEY, {});
      var key = size + ':' + difficulty;
      var better = typeof all[key] !== 'number' || info.time < all[key];
      if (better) { all[key] = info.time; store.set(BEST_KEY, all); }
      return better;
    },

    /* ---------------------------------------------------------- 累计统计 */

    recordOf: function (mode, size) {
      var all = store.get(RECORDS_KEY, {});
      return all[mode + ':' + size] || { played: 0, won: 0, seconds: 0, hints: 0 };
    },

    addPlayed: function (mode, size) {
      var all = store.get(RECORDS_KEY, {});
      var key = mode + ':' + size;
      var r = all[key] || { played: 0, won: 0, seconds: 0, hints: 0 };
      r.played++;
      all[key] = r;
      store.set(RECORDS_KEY, all);
      return r;
    },

    addWin: function (mode, size, info) {
      var all = store.get(RECORDS_KEY, {});
      var key = mode + ':' + size;
      var r = all[key] || { played: 0, won: 0, seconds: 0, hints: 0 };
      r.won++;
      r.seconds += info.time;
      r.hints += info.hints || 0;
      all[key] = r;
      store.set(RECORDS_KEY, all);
      return r;
    },

    /** 不限模式：完成局数、最佳、平均用时 */
    summary: function (mode, size) {
      var r = stats.recordOf(mode, size);
      return {
        played: r.played,
        won: r.won,
        hints: r.hints,
        average: r.won ? Math.round(r.seconds / r.won) : null
      };
    },

    /* ------------------------------------------------------------ 对局存档 */

    saveGame: function (key, payload) {
      if (!key) return;
      store.set('save:' + key, payload);
    },

    loadGame: function (key) {
      if (!key) return null;
      var saved = store.get('save:' + key, null);
      if (!saved || !saved.puzzle) return null;
      return saved;
    },

    clearGame: function (key) { if (key) store.remove('save:' + key); },

    /** 统计所有进行中的对局数量（设置页提示用） */
    savedCount: function () {
      var count = 0;
      try {
        for (var i = 0; i < global.localStorage.length; i++) {
          var k = global.localStorage.key(i);
          if (k && k.indexOf('minisudoku.v1.save:') === 0) count++;
        }
      } catch (err) { /* 忽略 */ }
      return count;
    },

    resetAll: function () {
      store.clearAll();
    }
  };

  S.stats = stats;
})(typeof window !== 'undefined' ? window : globalThis);
