/*!
 * core.js — 共享基础设施：本地存档、设置、日期工具、轻提示
 * 必须在 generator.js / game.js 之前加载。
 */
(function (global) {
  'use strict';

  var S = global.Sudoku = global.Sudoku || {};
  var PREFIX = 'minisudoku.v1.';

  /* ------------------------------------------------------------ 本地存储层 */

  var memoryFallback = {};   // 隐私模式下 localStorage 可能不可用

  function rawGet(key) {
    try {
      var v = global.localStorage.getItem(key);
      return v === null ? null : v;
    } catch (err) {
      return Object.prototype.hasOwnProperty.call(memoryFallback, key) ? memoryFallback[key] : null;
    }
  }

  function rawSet(key, value) {
    try {
      global.localStorage.setItem(key, value);
    } catch (err) {
      memoryFallback[key] = value;
    }
  }

  var store = {
    get: function (key, fallback) {
      var raw = rawGet(PREFIX + key);
      if (raw === null) return fallback;
      try {
        var parsed = JSON.parse(raw);
        return parsed === undefined ? fallback : parsed;
      } catch (err) {
        return fallback;
      }
    },
    set: function (key, value) {
      try {
        rawSet(PREFIX + key, JSON.stringify(value));
      } catch (err) { /* 存储写满时静默降级，不影响游戏 */ }
      return value;
    },
    remove: function (key) {
      try { global.localStorage.removeItem(PREFIX + key); } catch (err) { delete memoryFallback[PREFIX + key]; }
    },
    /** 清空本站所有存档（设置页“重置数据”用） */
    clearAll: function () {
      var keys = [];
      try {
        for (var i = 0; i < global.localStorage.length; i++) {
          var k = global.localStorage.key(i);
          if (k && k.indexOf(PREFIX) === 0) keys.push(k);
        }
      } catch (err) { keys = Object.keys(memoryFallback); }
      for (var j = 0; j < keys.length; j++) {
        try { global.localStorage.removeItem(keys[j]); } catch (err) { delete memoryFallback[keys[j]]; }
      }
    },
    available: (function () {
      try {
        global.localStorage.setItem(PREFIX + '__probe', '1');
        global.localStorage.removeItem(PREFIX + '__probe');
        return true;
      } catch (err) { return false; }
    })()
  };

  /* ---------------------------------------------------------------- 主题 */

  /**
   * 配色主题。这里只登记「名称 + 预览色 + color-scheme」，
   * 真正的颜色值定义在 css/main.css 的 [data-theme='...'] 块里。
   * 新增主题：加一条记录 + 一段 CSS，无需改其它代码。
   */
  S.THEMES = [
    { id: 'default', label: '清爽', swatch: '#2563eb', scheme: 'light' },
    { id: 'paper', label: '暖纸', swatch: '#a83a2c', scheme: 'light' },
    { id: 'candy', label: '糖果', swatch: '#7c3aed', scheme: 'light' },
    { id: 'dark', label: '暗夜', swatch: '#5b9bff', scheme: 'dark' },
    { id: 'contrast', label: '高对比', swatch: '#0b3fd4', scheme: 'light' }
  ];

  S.themeExists = function (id) {
    return S.THEMES.some(function (t) { return t.id === id; });
  };

  S.themeInfo = function (id) {
    for (var i = 0; i < S.THEMES.length; i++) if (S.THEMES[i].id === id) return S.THEMES[i];
    return S.THEMES[0];
  };

  /**
   * 把主题应用到 <html>：
   *   - 设置 data-theme，CSS 变量随之切换
   *   - 同步 color-scheme，让滚动条与原生控件跟着变色
   *   - 同步 <meta name="theme-color">，移动端地址栏颜色一致
   */
  S.applyTheme = function (id) {
    if (typeof document === 'undefined') return id;
    var theme = S.themeInfo(S.themeExists(id) ? id : 'default');
    var root = document.documentElement;
    if (theme.id === 'default') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme.id);
    root.style.colorScheme = theme.scheme;

    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    var fromCss = '';
    try { fromCss = global.getComputedStyle(root).getPropertyValue('--bg').trim(); } catch (err) { fromCss = ''; }
    meta.setAttribute('content', fromCss || (theme.scheme === 'dark' ? '#0f1723' : '#f4f7fc'));
    return theme.id;
  };

  /* ---------------------------------------------------------------- 设置项 */

  var SETTINGS_KEY = 'settings';
  var DEFAULTS = {
    size: 6,                 // 棋盘规格：6 或 9
    difficulty: 'medium',    // 不限模式下的难度
    theme: 'default',        // 配色主题，见 S.THEMES
    autoNotes: true,         // 落子后自动清理同行/列/宫的铅笔标记
    highlightPeers: true,    // 高亮同行同列同宫
    highlightSame: true,     // 高亮相同数字
    showConflicts: true,     // 实时标出冲突数字
    showRemaining: true,     // 数字键显示剩余个数
    showTimer: true,         // 显示计时器
    autoCheck: false         // 立即标出与答案不符的数字
  };

  var settings = Object.assign({}, DEFAULTS, store.get(SETTINGS_KEY, {}));
  var settingsListeners = [];

  // 尽早套用主题：脚本位于 </body> 之前，闪白时间可以忽略
  if (!S.themeExists(settings.theme)) settings.theme = DEFAULTS.theme;
  S.applyTheme(settings.theme);

  S.settings = {
    defaults: DEFAULTS,
    get: function (key) {
      return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : DEFAULTS[key];
    },
    set: function (key, value) {
      if (settings[key] === value) return value;
      settings[key] = value;
      store.set(SETTINGS_KEY, settings);
      if (key === 'theme') S.applyTheme(value);
      for (var i = 0; i < settingsListeners.length; i++) settingsListeners[i](key, value);
      return value;
    },
    all: function () { return Object.assign({}, settings); },
    reset: function () {
      settings = Object.assign({}, DEFAULTS);
      store.set(SETTINGS_KEY, settings);
      S.applyTheme(settings.theme);
      for (var i = 0; i < settingsListeners.length; i++) settingsListeners[i]('*', null);
    },
    onChange: function (fn) { settingsListeners.push(fn); }
  };

  /* -------------------------------------------------------- 随机数与日期 */

  /** 供 game.js 的“随机提示”使用的全局随机源 */
  S.random = Math.random;

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  var dateTools = {
    /** Date -> 'YYYY-MM-DD'（本地时区，保证“今天的题”与用户日历一致） */
    toKey: function (date) {
      return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
    },
    fromKey: function (key) {
      var parts = String(key).split('-');
      return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    },
    todayKey: function () { return dateTools.toKey(new Date()); },
    /** 本地零点，用于“距下一题还有多久” */
    nextMidnight: function () {
      var d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
    },
    shift: function (key, days) {
      var d = dateTools.fromKey(key);
      d.setDate(d.getDate() + days);
      return dateTools.toKey(d);
    },
    /** 当天在“每日题序列”中的序号（从 2024-01-01 起算） */
    dayIndex: function (key) {
      var epoch = Date.UTC(2024, 0, 1);
      var d = dateTools.fromKey(key);
      var utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
      return Math.floor((utc - epoch) / 86400000);
    },
    /** '2026-02-14' -> '2月14日' */
    label: function (key) {
      var d = dateTools.fromKey(key);
      return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    },
    /** 星期几，0=周日 */
    weekday: function (key) { return dateTools.fromKey(key).getDay(); },
    weekdayName: function (key) {
      return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dateTools.weekday(key)];
    },
    /** 相对今天的人类可读描述 */
    relative: function (key) {
      var today = dateTools.todayKey();
      if (key === today) return '今天';
      if (key === dateTools.shift(today, -1)) return '昨天';
      if (key === dateTools.shift(today, 1)) return '明天';
      return dateTools.weekdayName(key);
    },
    /** 最近 count 天（含今天）的日期键，倒序 */
    recentDays: function (count) {
      var out = [], today = dateTools.todayKey();
      for (var i = 0; i < count; i++) out.push(dateTools.shift(today, -i));
      return out;
    }
  };

  S.dates = dateTools;

  /** 秒 -> 'MM:SS' 或 'H:MM:SS' */
  S.formatTime = function (seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(s) : pad2(m) + ':' + pad2(s);
  };

  /* ------------------------------------------------------------ 每日题面 */

  var DIFFICULTY_ORDER = ['easy', 'medium', 'hard', 'expert'];
  S.DIFFICULTY_ORDER = DIFFICULTY_ORDER;

  S.DIFFICULTY_LABEL = {
    easy: '入门',
    medium: '进阶',
    hard: '困难',
    expert: '专家'
  };

  /**
   * 每日题的“标准难度”按星期几轮换，让每天的手感有变化但全年可预期。
   * 周日/周六偏难，周三最轻松。
   */
  var WEEKDAY_DIFFICULTY = ['hard', 'easy', 'easy', 'medium', 'medium', 'hard', 'expert'];
  S.dailyDifficulty = function (dateKey) {
    return WEEKDAY_DIFFICULTY[dateTools.weekday(dateKey)];
  };

  /** 每日题编号（从第 1 期起），用于界面上展示“第 N 期” */
  S.dailyNumber = function (dateKey) {
    return dateTools.dayIndex(dateKey) + 1;
  };

  /* ------------------------------------------------------------ 轻提示条 */

  var toastTimer = null;
  S.toast = function (message, tone) {
    if (typeof document === 'undefined') return;
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.dataset.tone = tone || 'info';
    el.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 1900);
  };

  S.store = store;
})(typeof window !== 'undefined' ? window : globalThis);
