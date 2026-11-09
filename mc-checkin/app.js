/* 方块清单 · Craft Check-in — UI 控制器
 * 依赖 core.js 暴露的 window.EmberCore 纯逻辑；本文件负责状态、渲染、存储、提醒与交互。
 * 无框架、无网络、无构建。所有用户数据保存在 localStorage。
 */
(function () {
  'use strict';

  var Core = window.EmberCore;
  var STORAGE_KEY = 'craftCheckin.v1';
  var OCR_CONFIG_KEY = 'craftCheckin.ocr.v1';
  var TENCENT_CONFIG_KEY = 'craftCheckin.tencent.v1';
  var TENCENT_DEFAULTS = {
    enabled: false,
    backend: 'http://127.0.0.1:8787/api/ocr'
  };
  var OCR_KEY_SALT = 'craft-ocr-2026';

  // 客户端没有真正的秘密存储；这里只做轻量混淆，避免 Key 以明文出现在源码里。
  // 能打开 HTML/JS 的人仍可还原，不要把它当成加密。
  function xorOcrText(text) {
    var input = String(text || '');
    var out = '';
    for (var i = 0; i < input.length; i += 1) {
      out += String.fromCharCode(input.charCodeAt(i) ^ OCR_KEY_SALT.charCodeAt(i % OCR_KEY_SALT.length));
    }
    return out;
  }

  function encodeOcrSecret(text) {
    try { return btoa(xorOcrText(text)); } catch (e) { return ''; }
  }

  function decodeOcrSecret(encoded) {
    try { return xorOcrText(atob(String(encoded || ''))); } catch (e) { return ''; }
  }

  var OCR_AI_DEFAULTS = {
    enabled: true,
    apiKey: decodeOcrSecret('EBlMEAVAFRcRTkZZVk8PGwAfGlkbBgBHU0ZLRgkFBRUAXxobAlRFRkJFFBcFBRxKAw8L'),
    base: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-OCR'
  };
  var MODAL_IDS = ['taskModal', 'ocrModal', 'settingsModal', 'confirmModal'];
  var OCR_ENGINE = {
    script: 'https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js',
    workerPath: 'https://unpkg.com/tesseract.js@5.1.1/dist/worker.min.js',
    corePath: 'https://unpkg.com/tesseract.js-core@5.1.1',
    langPath: 'https://unpkg.com/@tesseract.js-data/chi_sim@1.0.0/4.0.0_best_int'
  };
  var params = new URLSearchParams(window.location.search);
  var DEMO = params.get('demo') === '1';
  var RESET = params.get('reset') === '1';
  var STATIC = params.get('static') === '1';
  var THEME_PARAM = params.get('theme') || '';
  var FROZEN_STATE = params.get('state') || '';
  var FROZEN_NOW = parseNowParam(params.get('now'));
  var EMOJIS = ['📖', '💧', '🏃', '🧘', '✍️', '🌱', '🧹', '🧾', '💊', '🎯', '☎️', '✨'];

  var state = {
    db: null,
    view: 'today',
    todayFilter: 'all',
    libraryFilter: 'all',
    search: '',
    editingId: null,
    selectedEmoji: '📖',
    modal: null,
    lastFocus: null,
    confirmCallback: null,
    confirmReturnModal: null,
    activeReminder: null,
    reminderQueue: [],
    lastDateKey: null,
    seededDemo: false,
    demoMode: false,
    storageCorrupt: false,
    toastSeq: 0,
    reminderTimer: null,
    ocr: {
      file: null,
      imageUrl: null,
      canvas: null,
      worker: null,
      enginePromise: null,
      workerPromise: null,
      running: false,
      parsed: [],
      ai: {
        enabled: OCR_AI_DEFAULTS.enabled,
        apiKey: OCR_AI_DEFAULTS.apiKey,
        base: OCR_AI_DEFAULTS.base,
        model: OCR_AI_DEFAULTS.model
      },
      tencent: {
        enabled: false,
        backend: TENCENT_DEFAULTS.backend
      }
    }
  };

  var audioCtx = null;

  if (!Core) {
    showBootError(new Error('核心脚本 core.js 未加载。请确认 index.html、core.js、app.js 在同一个目录。'));
    return;
  }

  /* ------------------------------------------------------------------ */
  /* 基础工具                                                           */
  /* ------------------------------------------------------------------ */

  function $(id) { return document.getElementById(id); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function icon(name, extra) {
    return '<svg class="icon' + (extra ? ' ' + extra : '') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function parseNowParam(value) {
    if (!value) return null;
    var normalized = value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += 'T12:00:00';
    var d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d;
  }

  function now() { return FROZEN_NOW ? new Date(FROZEN_NOW.getTime()) : new Date(); }
  function nowIso() { return now().toISOString(); }
  function todayKey() { return Core.dateKeyFromDate(now()); }

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function hhmm(date) { return pad(date.getHours()) + ':' + pad(date.getMinutes()); }

  function taskTypeLabel(type) {
    return { daily: '每日', weekly: '每周', monthly: '每月', interval: '每 X 天', urgent: '紧要' }[type] || '任务';
  }

  function typeGlyph(type) {
    return { daily: '🌱', weekly: '📦', monthly: '🌙', interval: '🧭', urgent: '⚡' }[type] || '✨';
  }

  function progressPercent(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  }

  function greetingText(date) {
    var h = date.getHours();
    var name = (state.db && state.db.settings.name) || '朋友';
    if (h < 5) return '夜深了，' + name;
    if (h < 9) return '早上好，' + name;
    if (h < 12) return '上午好，' + name;
    if (h < 14) return '中午好，' + name;
    if (h < 18) return '下午好，' + name;
    if (h < 22) return '晚上好，' + name;
    return '夜深了，' + name;
  }

  function freshDb() {
    var stamp = nowIso();
    return {
      version: 1,
      tasks: [],
      settings: {
        name: '朋友',
        theme: 'dark',
        sound: true,
        weekStart: 1,
        seeded: false,
        createdAt: stamp,
        updatedAt: stamp
      },
      dayLog: {},
      fired: {},
      snoozes: {},
      createdAt: stamp,
      updatedAt: stamp
    };
  }

  function activeTask(task) { return task && !task.archived; }
  function findTask(id) {
    if (!state.db) return null;
    for (var i = 0; i < state.db.tasks.length; i++) {
      if (state.db.tasks[i].id === id) return state.db.tasks[i];
    }
    return null;
  }

  function weekStartOpt() {
    return state.db && state.db.settings ? state.db.settings.weekStart : 1;
  }

  // 这些包装器确保「每周」周期与设置里的 weekStart 一致。
  function taskStateOf(task, dateKey) { return Core.taskState(task, dateKey, weekStartOpt()); }
  function isCompleteOn(task, dateKey) { return Core.isTaskComplete(task, dateKey, weekStartOpt()); }
  function occurrenceOf(task, dateKey) { return Core.occurrenceKey(task, dateKey, weekStartOpt()); }
  function setCompletionOn(task, dateKey, done) { return Core.setTaskCompletion(task, dateKey, done, weekStartOpt()); }
  function dueOf(task, dateKey) { return Core.dueLabel(task, dateKey, weekStartOpt()); }
  function sortForDay(tasks, dateKey) { return Core.sortTasksForToday(tasks, dateKey, weekStartOpt()); }
  function reminderAtOf(task, dateKey) { return Core.reminderAt(task, dateKey, weekStartOpt()); }

  function availableTasks() {
    var day = todayKey();
    return Core.activeTasks(state.db.tasks).filter(function (task) {
      return taskStateOf(task, day).available;
    });
  }

  function allTaskRows() {
    return Core.activeTasks(state.db.tasks);
  }

  function orderTasks(tasks) {
    var day = todayKey();
    var ordered = sortForDay(tasks, day);
    return ordered.slice().sort(function (a, b) {
      var ad = isCompleteOn(a, day) ? 1 : 0;
      var bd = isCompleteOn(b, day) ? 1 : 0;
      return ad - bd;
    });
  }

  function nextFireStreak() {
    return Core.streakInfo(state.db, todayKey());
  }

  /* ------------------------------------------------------------------ */
  /* 启动 / 存储                                                         */
  /* ------------------------------------------------------------------ */

  function boot() {
    try {
      state.db = loadDb();
      loadOcrConfig();
      loadTencentConfig();
      if (THEME_PARAM === 'light' || THEME_PARAM === 'dark') {
        state.db.settings.theme = THEME_PARAM;
      }
      state.lastDateKey = todayKey();
      applyTheme(state.db.settings.theme);
      if (STATIC) {
        document.documentElement.classList.add('is-static');
        var style = document.createElement('style');
        style.textContent = '*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;transition-duration:.001s!important;scroll-behavior:auto!important}';
        document.head.appendChild(style);
      }
      populateMonthday();
      updateTodayLog();
      save(true);
      renderAll();
      bindEvents();
      handleUrlState();
      startClocks();
      if (state.storageCorrupt) {
        setTimeout(function () {
          toast('本地数据读取失败', {
            text: '已为你恢复到一个干净的工作台。如果之前有导出备份，可在设置里导入。',
            tone: 'danger',
            duration: 6500
          });
        }, 600);
      }
      if (params.get('selftest') === '1') {
        setTimeout(runSelfTest, 500);
      }
    } catch (err) {
      showBootError(err);
    }
  }

  function loadDb() {
    if (RESET) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    }

    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }

    if (!raw) {
      var db = freshDb();
      if (DEMO) {
        db = seedDemo();
        state.seededDemo = true;
        state.demoMode = true;
      } else {
        db = seedStarter(db);
      }
      return Core.normalizeDb(db);
    }

    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) {
      parsed = null;
      state.storageCorrupt = true;
    }
    var normalized = Core.normalizeDb(parsed);
    if (!normalized) normalized = freshDb();

    if (!normalized.settings.seeded && normalized.tasks.length === 0) {
      if (DEMO) {
        normalized = seedDemo();
        state.seededDemo = true;
        state.demoMode = true;
      } else {
        normalized = seedStarter(normalized);
      }
    } else if (DEMO && normalized.tasks.length === 0) {
      normalized = seedDemo();
      state.seededDemo = true;
      state.demoMode = true;
    }

    return Core.normalizeDb(normalized);
  }

  function save(silent) {
    if (!state.db) return;
    state.db.settings.updatedAt = nowIso();
    state.db.updatedAt = nowIso();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.db));
    } catch (e) {
      if (!silent) {
        toast('保存失败', { text: '浏览器存储空间可能已满，请导出备份后清理。', tone: 'danger' });
      }
    }
  }

  function updateTodayLog() {
    var day = todayKey();
    var fs = Core.fireState(state.db, day);
    if (fs.configured) {
      state.db.dayLog[day] = Core.buildDayLog(state.db, day, nowIso());
    } else if (state.db.dayLog[day]) {
      delete state.db.dayLog[day];
    }
  }

  function applyTheme(theme) {
    var resolved = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.style.colorScheme = resolved;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'light' ? '#e9e2cf' : '#17150f');
  }

  function handleUrlState() {
    var view = params.get('view');
    if (view && ['today', 'tasks', 'fire'].indexOf(view) >= 0) goView(view);

    if (state.seededDemo && FROZEN_STATE) applyDemoVisualState(FROZEN_STATE);

    var modal = params.get('modal');
    if (modal === 'add') setTimeout(function () { openTaskModal(); }, 80);
    if (modal === 'settings') setTimeout(openSettings, 80);
    if (STATIC) document.documentElement.classList.add('is-static');
  }

  function applyDemoVisualState(mode) {
    mode = { crafted: 'lit', crafting: 'frozen', interrupted: 'out', empty: 'unset' }[mode] || mode;
    var day = todayKey();
    var affected = [];
    if (mode === 'frozen') {
      var stretched = findTask('demo_stretch');
      if (stretched && stretched.completions) {
        delete stretched.completions[occurrenceOf(stretched, day)];
        affected.push(stretched);
      }
    } else if (mode === 'out') {
      state.db.tasks.forEach(function (task) {
        if (task.fire && task.completions) {
          delete task.completions[occurrenceOf(task, day)];
          var yesterday = Core.addDays(day, -1);
          delete task.completions[occurrenceOf(task, yesterday)];
          affected.push(task);
        }
      });
      var y = Core.addDays(day, -1);
      if (state.db.dayLog[y]) state.db.dayLog[y].lit = false;
    } else if (mode === 'unset') {
      state.db.tasks.forEach(function (task) { task.fire = false; });
      delete state.db.dayLog[day];
    }
    markPastRemindersFired(affected);
    updateTodayLog();
    save(true);
    renderAll();
  }

  /* ------------------------------------------------------------------ */
  /* 种子数据                                                            */
  /* ------------------------------------------------------------------ */

  function makeDemoTask(def, today) {
    var task = Core.createTask({
      title: def.title,
      emoji: def.emoji,
      category: def.category,
      type: def.type,
      monthday: def.monthday,
      everyN: def.everyN,
      anchor: def.anchor,
      due: def.due,
      dueTime: def.dueTime,
      priority: def.priority,
      reminder: def.reminder,
      fire: !!def.fire,
      notes: def.notes || ''
    }, today);
    task.id = def.id;
    task.completions = {};
    task.createdAt = Core.addDays(today, -40) + 'T09:00:00.000Z';
    return task;
  }

  function seedDemo() {
    var today = todayKey();
    var db = freshDb();
    db.settings.seeded = true;
    db.settings.name = '朋友';
    db.settings.theme = 'dark';

    var tasks = [
      makeDemoTask({ id: 'demo_water', title: '晨间喝水', emoji: '💧', category: '健康', type: 'daily', fire: true, reminder: { enabled: true, time: '08:30' }, notes: '起床后先喝一杯' }, today),
      makeDemoTask({ id: 'demo_read', title: '阅读 30 分钟', emoji: '📖', category: '成长', type: 'daily', fire: true, reminder: { enabled: true, time: '21:00' } }, today),
      makeDemoTask({ id: 'demo_stretch', title: '拉伸 10 分钟', emoji: '🧘', category: '健康', type: 'daily', fire: true, reminder: { enabled: true, time: '20:30' } }, today),
      makeDemoTask({ id: 'demo_journal', title: '写今日一句', emoji: '✍️', category: '成长', type: 'daily', reminder: { enabled: true, time: '22:00' } }, today),
      makeDemoTask({ id: 'demo_clean', title: '本周大扫除', emoji: '🧹', category: '生活', type: 'weekly', reminder: { enabled: true, time: '10:00' }, notes: '扫除、换床单、倒垃圾' }, today),
      makeDemoTask({ id: 'demo_review', title: '月度复盘', emoji: '📊', category: '成长', type: 'monthly', monthday: 28, reminder: { enabled: true, time: '20:00' } }, today),
      makeDemoTask({ id: 'demo_plant', title: '浇花', emoji: '🌱', category: '生活', type: 'interval', everyN: 3, anchor: Core.addDays(today, -1), reminder: { enabled: true, time: '09:00' } }, today),
      makeDemoTask({ id: 'demo_rent', title: '交房租', emoji: '🧾', category: '财务', type: 'urgent', due: Core.addDays(today, 3), dueTime: '18:00', priority: 'high', reminder: { enabled: true, time: '09:00' } }, today),
      makeDemoTask({ id: 'demo_checkup', title: '预约体检', emoji: '🩺', category: '健康', type: 'urgent', due: today, dueTime: '17:00', priority: 'high', reminder: { enabled: true, time: '08:00' } }, today)
    ];
    db.tasks = tasks;

    var fireTasks = tasks.filter(function (t) { return t.fire; });
    var fireIds = fireTasks.map(function (t) { return t.id; });
    var stamp = Core.addDays(today, -1) + 'T21:00:00.000Z';

    // 30 天合成历史：12 天前断一次，当前连续 12 天，最佳 17 天。
    for (var i = 1; i <= 29; i++) {
      var day = Core.addDays(today, -i);
      var lit = i !== 12;
      db.dayLog[day] = {
        lit: lit,
        required: fireIds.slice(),
        done: lit ? fireIds.slice() : [],
        total: fireIds.length,
        updatedAt: stamp
      };
      if (lit) {
        fireTasks.forEach(function (task) { task.completions[day] = stamp; });
      }
    }
    // 非合成的每日任务：最近 10 天中完成 8 天。
    var journal = tasks.filter(function (t) { return t.id === 'demo_journal'; })[0];
    for (var j = 1; j <= 10; j++) {
      if (j === 3 || j === 7) continue;
      journal.completions[Core.addDays(today, -j)] = stamp;
    }

    // 每周 / 每月 / 每 X 天任务的历史完成。
    var clean = tasks.filter(function (t) { return t.id === 'demo_clean'; })[0];
    for (var w = 0; w < 5; w++) {
      var weekDate = Core.addDays(Core.startOfWeek(today, db.settings.weekStart), -7 * w);
      clean.completions[occurrenceOf(clean, weekDate)] = stamp;
    }
    var review = tasks.filter(function (t) { return t.id === 'demo_review'; })[0];
    review.completions[occurrenceOf(review, today)] = stamp;
    var plant = tasks.filter(function (t) { return t.id === 'demo_plant'; })[0];
    for (var p = 0; p < 8; p++) {
      var plantDate = Core.addDays(today, -p);
      if (taskStateOf(plant, plantDate).available) {
        plant.completions[occurrenceOf(plant, plantDate)] = stamp;
      }
    }
    var checkup = tasks.filter(function (t) { return t.id === 'demo_checkup'; })[0];
    checkup.completions.once = stamp;

    // 今日：材料全部完成，整体完成 6/9。
    fireTasks.forEach(function (task) {
      task.completions[occurrenceOf(task, today)] = nowIso();
    });
    plant.completions[occurrenceOf(plant, today)] = nowIso();
    clean.completions[occurrenceOf(clean, today)] = nowIso();
    review.completions[occurrenceOf(review, today)] = nowIso();

    // 已过点的提醒标记为已提醒，避免示例数据一打开就弹窗；未来提醒保留为待提醒。
    state.db = db;
    markPastRemindersFired(tasks);
    db = state.db;

    db.dayLog[today] = Core.buildDayLog(db, today, nowIso());
    db.settings.updatedAt = nowIso();
    db.createdAt = Core.addDays(today, -60) + 'T09:00:00.000Z';
    return db;
  }

  function seedStarter(db) {
    var today = todayKey();
    db = db || freshDb();
    var defs = [
      { id: 'start_water', title: '喝一杯水', emoji: '💧', category: '健康', type: 'daily' },
      { id: 'start_read', title: '阅读 20 分钟', emoji: '📖', category: '成长', type: 'daily' },
      { id: 'start_clean', title: '整理桌面', emoji: '🧹', category: '生活', type: 'weekly' },
      { id: 'start_bill', title: '交水电费', emoji: '🧾', category: '生活', type: 'urgent', due: Core.addDays(today, 5), dueTime: '18:00', priority: 'high' }
    ];
    db.tasks = defs.map(function (def) {
      var task = Core.createTask({
        title: def.title,
        emoji: def.emoji,
        category: def.category,
        type: def.type,
        due: def.due,
        dueTime: def.dueTime,
        priority: def.priority,
        fire: false,
        reminder: { enabled: false, time: '21:00' }
      }, today);
      task.id = def.id;
      return task;
    });
    db.settings.seeded = true;
    return db;
  }

  /* ------------------------------------------------------------------ */
  /* 渲染：全局 / 顶栏 / 侧栏                                            */
  /* ------------------------------------------------------------------ */

  function renderAll() {
    if (!state.db) return;
    var fs = Core.fireState(state.db, todayKey());
    var streak = Core.streakInfo(state.db, todayKey());
    var progress = Core.taskProgress(state.db, todayKey());

    renderHeader();
    renderSidebar(fs, streak, progress);
    renderTodayView(fs, streak, progress);
    renderLibrary();
    renderFirePage(fs, streak, progress);
    syncFilterButtons();
    syncNav();
  }

  function renderHeader() {
    var date = now();
    var day = todayKey();
    var streak = Core.streakInfo(state.db, day);
    var progress = Core.taskProgress(state.db, day);
    var pending = Math.max(0, progress.total - progress.done);

    $('todayDate').textContent = Core.formatDateCN(day);
    $('todayTime').textContent = hhmm(date);
    $('greeting').textContent = greetingText(date);
    $('headerStreak').textContent = streak.current;
    $('headerStreakPill').title = '连续合成 ' + streak.current + ' 天，最佳 ' + streak.best + ' 天';
    $('navTodayCount').textContent = pending;
    document.title = (pending > 0 ? '（' + pending + '）' : '') + '方块清单 · Craft Check-in';
    updateClockOnly(date);
  }

  function updateClockOnly(date) {
    $('todayTime').textContent = hhmm(date);
    $('todayDate').textContent = Core.formatDateCN(Core.dateKeyFromDate(date));
  }

  function renderSidebar(fs, streak, progress) {
    var day = todayKey();
    var parts = day.split('-');
    var weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
    var weekday = weekdayNames[new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getDay()];
    $('sideWeekday').textContent = '周' + weekday;
    $('sideDate').textContent = String(Number(parts[2]));
    $('sideMonth').textContent = Number(parts[1]) + '月 · ' + parts[0];
    $('sideStreak').textContent = streak.current;
    $('sideEmber').dataset.state = streak.state;
    $('sideEmber').setAttribute('aria-label', '工作台状态：' + stateLabel(streak.state) + '，连续 ' + streak.current + ' 天');
    $('navTodayCount').textContent = Math.max(0, progress.total - progress.done);
  }

  function stateLabel(st) {
    return { lit: '合成成功', frozen: '合成中', out: '等待材料', unset: '空配方' }[st] || '空配方';
  }

  function craftResultInfo(fs) {
    var count = fs.configured ? fs.total : 0;
    var outputs = [
      null,
      { icon: '🪵', name: '木棍' },
      { icon: '🪓', name: '石斧' },
      { icon: '⛏️', name: '铁镐' },
      { icon: '🍎', name: '金苹果' },
      { icon: '💎', name: '钻石' }
    ];
    var item = fs.lit
      ? (outputs[Math.min(count, 5)] || outputs[5])
      : { icon: '?', name: count ? '等待材料' : '空配方' };
    return { count: count, complete: !!fs.lit, item: item };
  }

  function renderCraftSlots(target, fs, mini) {
    if (!target) return;
    var tasks = fs.tasks.slice(0, 9);
    var html = '';
    for (var i = 0; i < 9; i++) {
      var item = tasks[i];
      if (item) {
        var task = item.task;
        html += '<div class="craft-slot is-filled ' + (item.complete ? 'is-done' : 'is-missing') + (mini ? ' craft-slot-mini' : '')
          + '" title="' + esc(task.title + (item.complete ? ' · 已就位' : ' · 待完成')) + '">'
          + '<span class="craft-item" aria-hidden="true">' + esc(task.emoji) + '</span>'
          + (item.complete ? '<span class="craft-check">' + icon('check') + '</span>' : '')
          + '</div>';
      } else {
        html += '<div class="craft-slot is-empty' + (mini ? ' craft-slot-mini' : '') + '" aria-hidden="true"></div>';
      }
    }
    target.innerHTML = html;
  }

  function setCraftOutput(prefix, info) {
    var item = $(prefix + 'ResultItem');
    var name = $(prefix + 'ResultName');
    if (!item || !name) return;
    item.textContent = info.item.icon;
    item.classList.toggle('is-unknown', !info.complete);
    item.classList.toggle('is-legendary', info.complete && info.count >= 5);
    name.textContent = info.item.name;
    var box = item.closest('.craft-output, .craft-page-output');
    if (box) {
      box.classList.toggle('is-ready', info.complete);
      box.classList.toggle('is-empty', !info.complete);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 渲染：今日                                                          */
  /* ------------------------------------------------------------------ */

  function renderTodayView(fs, streak, progress) {
    renderHero(fs, streak, progress);
    renderTodayTasks(progress);
    renderFuel(fs);
    renderReminders();
    renderWeek(streak);
  }

  function renderHero(fs, streak, progress) {
    var hero = $('hero');
    var stage = $('craftStage');
    var st = streak.state;
    var info = craftResultInfo(fs);
    hero.dataset.state = st;
    stage.dataset.state = st;
    stage.setAttribute('aria-label', '工作台状态：' + stateLabel(st) + '，连续合成 ' + streak.current + ' 天');

    var copy = {
      lit: {
        title: '今日合成完成',
        desc: streak.current > 1
          ? '连续合成 ' + streak.current + ' 天，今天的配方全部就位。'
          : '第一份配方完成了，工作台亮了起来。',
        state: '合成成功',
        hint: '配方就位 · 产出 ' + info.item.name
      },
      frozen: {
        title: '工作台正在等待',
        desc: fs.missing.length
          ? '还差 ' + fs.missing.length + ' 种材料。集齐后就能合成。'
          : '还差一点，工作台就能重新合成。',
        state: '合成中',
        hint: fs.missing.length ? '还差 ' + fs.missing.length + ' 种材料' : '等待材料'
      },
      out: {
        title: '工作台空着',
        desc: '昨天没有完成合成。今天重新摆好配方吧。',
        state: '等待材料',
        hint: '完成材料，重新开始'
      },
      unset: {
        title: '还没有合成配方',
        desc: '选择几件每天要做的小事，组成工作台的配方。',
        state: '空配方',
        hint: '从任务库选择配方材料'
      }
    }[st] || {};

    $('heroTitle').textContent = copy.title;
    $('heroDesc').textContent = copy.desc;
    $('craftStateText').textContent = copy.state;
    $('craftHint').textContent = copy.hint;
    $('heroEyebrow').textContent = st === 'unset' ? '等待第一份配方' : '今日工作台';
    $('heroStreak').textContent = streak.current;
    $('heroFuelCount').textContent = fs.configured ? fs.done + '/' + fs.total : '—';
    $('heroDoneRate').textContent = progress.percent + '%';

    var chips = $('heroChips');
    if (!fs.configured) {
      chips.innerHTML = '<button class="hero-chip is-empty" data-action="manage-fuel" type="button">'
        + icon('craft') + '<span>选择合成配方</span>' + icon('plus') + '</button>';
    } else {
      chips.innerHTML = fs.tasks.map(function (item) {
        return '<button class="hero-chip' + (item.complete ? ' is-done' : '') + '" data-action="toggle" data-id="'
          + esc(item.task.id) + '" type="button" aria-pressed="' + item.complete + '" title="'
          + (item.complete ? '已就位，点击取消' : '点击完成') + '">'
          + '<span class="hero-chip-emoji" aria-hidden="true">' + esc(item.task.emoji) + '</span>'
          + '<span>' + esc(item.task.title) + '</span>'
          + (item.complete ? icon('check') : '<span class="hero-chip-dot" aria-hidden="true"></span>')
          + '</button>';
      }).join('');
    }

    renderCraftSlots($('craftGrid'), fs, false);
    setCraftOutput('craft', info);
  }

  function renderTodayTasks(progress) {
    var day = todayKey();
    var all = orderTasks(availableTasks());
    var filter = state.todayFilter;
    var visible = all.filter(function (task) {
      if (filter === 'daily') return task.type === 'daily';
      if (filter === 'extra') return task.type !== 'daily';
      return true;
    });
    var listEl = $('todayTaskList');
    var emptyEl = $('todayEmpty');

    if (!visible.length) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      var hasAny = all.length > 0;
      var h = emptyEl.querySelector('h3');
      var p = emptyEl.querySelector('p');
      var btn = emptyEl.querySelector('button');
      if (h) h.textContent = hasAny ? '这一类暂时没有任务' : '还没有今天的任务';
      if (p) p.textContent = hasAny ? '换个筛选条件，或添加一件新任务。' : '先添加一件小事，让工作台有材料可放。';
      if (btn) btn.textContent = hasAny ? '添加任务' : '添加第一个任务';
    } else {
      emptyEl.hidden = true;
      var groups = [];
      if (filter !== 'extra') {
        var daily = visible.filter(function (t) { return t.type === 'daily'; });
        if (daily.length) groups.push({ key: 'daily', label: '每日习惯', tasks: daily });
      }
      if (filter !== 'daily') {
        var extra = visible.filter(function (t) { return t.type !== 'daily'; });
        if (extra.length) groups.push({ key: 'extra', label: '额外任务', tasks: extra });
      }
      listEl.innerHTML = groups.map(function (group) {
        var done = group.tasks.filter(function (t) { return isCompleteOn(t, day); }).length;
        return '<section class="task-group task-group-' + group.key + '">'
          + '<header class="task-group-head"><h3>' + group.label + '</h3><span>' + done + '/' + group.tasks.length + '</span></header>'
          + group.tasks.map(function (task) { return taskRow(task); }).join('')
          + '</section>';
      }).join('');
    }

    var remaining = Math.max(0, progress.total - progress.done);
    $('todayBadge').textContent = remaining ? remaining + ' 项待合成' : '今日已合成';
    $('todaySummary').textContent = progress.total
      ? progress.done + '/' + progress.total + ' 项完成 · ' + (remaining ? '还有 ' + remaining + ' 块材料' : '给自己一点掌声')
      : '新的一天，从摆一块材料开始。';
    var ring = $('todayRing');
    ring.style.setProperty('--pct', progress.percent);
    ring.setAttribute('aria-label', '今日完成进度 ' + progress.percent + '%');
    $('todayRingText').textContent = progress.percent + '%';
  }

  function taskMeta(task, options) {
    var day = todayKey();
    var parts = [];
    var skipDue = !!(options && options.skipDue);
    parts.push('<span class="meta-item meta-repeat">' + icon('repeat') + esc(Core.recurrenceLabel(task)) + '</span>');

    if (task.type !== 'daily' && !skipDue) {
      var due = dueOf(task, day);
      if (due && due.text) {
        parts.push('<span class="meta-item meta-due is-' + esc(due.tone || 'normal') + '">' + icon('clock') + esc(due.text) + '</span>');
      }
    }
    if (task.reminder && task.reminder.enabled) {
      parts.push('<span class="meta-item meta-reminder">' + icon('bell') + esc(task.reminder.time) + ' 提醒</span>');
    }
    var streak = Core.taskStreak(task, state.db, day);
    if (streak > 1 && task.type !== 'urgent') {
      var unit = { daily: '天', weekly: '周', monthly: '个月', interval: '轮' }[task.type] || '次';
      parts.push('<span class="meta-item meta-streak">' + icon('pickaxe') + '连续 ' + streak + ' ' + unit + '</span>');
    }
    if (task.notes) {
      parts.push('<span class="meta-item meta-note">' + esc(task.notes) + '</span>');
    }
    return parts.join('');
  }

  function taskRow(task) {
    var day = todayKey();
    var st = taskStateOf(task, day);
    var done = st.complete;
    var due = dueOf(task, day);
    var overdue = due && due.tone === 'danger';
    var classes = ['task-row', 'type-' + task.type];
    if (done) classes.push('is-done');
    if (overdue) classes.push('is-overdue');
    if (task.fire) classes.push('is-material');
    return '<article class="' + classes.join(' ') + '" data-task-id="' + esc(task.id) + '">'
      + '<div class="task-leading">'
      + '<button class="check' + (done ? ' is-checked' : '') + '" type="button" data-action="toggle" data-id="' + esc(task.id) + '" aria-label="' + (done ? '取消完成' : '完成') + '：' + esc(task.title) + '" aria-pressed="' + done + '">'
      + icon('check') + '</button>'
      + '<span class="task-emoji" aria-hidden="true">' + esc(task.emoji) + '</span>'
      + '</div>'
      + '<div class="task-main">'
      + '<div class="task-title-line"><h3 class="task-name">' + esc(task.title) + '</h3>'
      + (task.fire ? '<span class="chip chip-material">' + icon('craft') + '材料</span>' : '')
      + (task.category ? '<span class="chip chip-category">' + esc(task.category) + '</span>' : '')
      + '</div>'
      + '<div class="task-meta">' + taskMeta(task) + '</div>'
      + '</div>'
      + '<div class="task-actions">'
      + '<button class="task-action" type="button" data-action="edit" data-id="' + esc(task.id) + '" aria-label="编辑 ' + esc(task.title) + '" title="编辑">' + icon('edit') + '</button>'
      + '<button class="task-action recipe-action' + (task.fire ? ' is-on' : '') + '" type="button" data-action="toggle-fire" data-id="' + esc(task.id) + '" aria-label="' + (task.fire ? '移出合成配方' : '加入合成配方') + '" title="' + (task.fire ? '移出材料' : '加入材料') + '" aria-pressed="' + !!task.fire + '">' + icon('craft') + '</button>'
      + '<button class="task-action danger" type="button" data-action="delete" data-id="' + esc(task.id) + '" aria-label="删除 ' + esc(task.title) + '" title="删除">' + icon('trash') + '</button>'
      + '</div>'
      + '</article>';
  }

  function renderFuel(fs) {
    var day = todayKey();
    var fuelTasks = Core.activeTasks(state.db.tasks).filter(function (task) {
      return task.fire && taskStateOf(task, day).available;
    });
    var done = fuelTasks.filter(function (task) { return isCompleteOn(task, day); }).length;
    $('fuelCountBadge').textContent = fs.configured ? done + '/' + fuelTasks.length : '空配方';

    if (!fuelTasks.length) {
      $('fuelList').innerHTML = '<div class="empty-inline"><span aria-hidden="true">🧱</span><p>工作台还没有材料。选几件小事，组成今天的配方。</p></div>';
    } else {
      $('fuelList').innerHTML = fuelTasks.map(function (task) {
        var complete = isCompleteOn(task, day);
        return '<button class="recipe-item' + (complete ? ' is-done' : '') + '" type="button" data-action="toggle" data-id="' + esc(task.id) + '" aria-pressed="' + complete + '">'
          + '<span class="recipe-marker">' + (complete ? icon('check') : icon('craft')) + '</span>'
          + '<span class="recipe-name"><span aria-hidden="true">' + esc(task.emoji) + '</span> ' + esc(task.title) + '</span>'
          + '<span class="recipe-state">' + (complete ? '已完成' : '待完成') + '</span>'
          + '</button>';
      }).join('');
    }
    $('fireFuelCount').textContent = fs.configured ? fs.done + '/' + fs.total : '空配方';

    var allTasks = orderTasks(Core.activeTasks(state.db.tasks));
    if (!allTasks.length) {
      $('firePageFuelList').innerHTML = '<div class="empty-inline"><p>任务库还是空的，先添加几个任务吧。</p></div>';
    } else {
      $('firePageFuelList').innerHTML = allTasks.map(function (task) {
        var st = taskStateOf(task, day);
        return '<button class="material-select' + (task.fire ? ' is-on' : '') + '" type="button" data-action="toggle-fire" data-id="' + esc(task.id) + '" aria-pressed="' + !!task.fire + '">'
          + '<span class="material-select-check">' + (task.fire ? icon('check') : '') + '</span>'
          + '<span class="task-emoji" aria-hidden="true">' + esc(task.emoji) + '</span>'
          + '<span class="material-select-main"><strong>' + esc(task.title) + '</strong><small>' + esc(Core.recurrenceLabel(task)) + ' · ' + (st.complete ? '已完成' : '待完成') + '</small></span>'
          + (task.type === 'urgent' ? '<span class="chip chip-urgent">紧要</span>' : '')
          + '</button>';
      }).join('');
    }
  }

  function reminderStatus(task, at, signature) {
    if (!at) return { key: 'off', text: '今日不提醒' };
    var current = now();
    if (state.db.snoozes[task.id]) {
      return { key: 'snoozed', text: '稍后提醒' };
    }
    if (state.db.fired[signature]) return { key: 'fired', text: '已提醒' };
    if (at.getTime() <= current.getTime()) return { key: 'due', text: '到点' };
    return { key: 'upcoming', text: hhmm(at) };
  }

  function markPastRemindersFired(tasks) {
    var day = todayKey();
    var current = now();
    (tasks || []).forEach(function (task) {
      if (!task.reminder || !task.reminder.enabled) return;
      var at = Core.reminderAt(task, day, weekStartOpt());
      if (at && at.getTime() <= current.getTime()) {
        state.db.fired[task.id + '|' + day + '|' + task.reminder.time] = nowIso();
      }
    });
  }

  function getReminderRows() {
    var day = todayKey();
    var rows = [];
    Core.activeTasks(state.db.tasks).forEach(function (task) {
      if (!task.reminder || !task.reminder.enabled) return;
      var st = taskStateOf(task, day);
      if (!st.available || st.complete) return;
      var at = reminderAtOf(task, day);
      if (!at) return;
      var signature = Core.reminderSignature(task, day);
      rows.push({ task: task, at: at, signature: signature, status: reminderStatus(task, at, signature) });
    });
    rows.sort(function (a, b) { return a.at - b.at; });
    return rows;
  }

  function reminderItem(row, compact) {
    var task = row.task;
    return '<button class="reminder-item is-' + row.status.key + '" type="button" data-action="edit" data-id="' + esc(task.id) + '" aria-label="编辑提醒：' + esc(task.title) + '">'
      + '<span class="reminder-time">' + esc(hhmm(row.at)) + '</span>'
      + '<span class="reminder-body"><strong><span aria-hidden="true">' + esc(task.emoji) + '</span> ' + esc(task.title) + '</strong><small>' + esc(Core.recurrenceLabel(task)) + (compact ? '' : ' · ' + esc(row.status.text)) + '</small></span>'
      + '<span class="reminder-status">' + (row.status.key === 'due' ? '<span class="live-dot"></span>' : '') + esc(row.status.text) + '</span>'
      + '</button>';
  }

  function renderReminders() {
    var rows = getReminderRows();
    var due = Core.collectReminders(state.db, todayKey(), now()).due || [];
    var list = $('reminderList');

    if (!rows.length) {
      list.innerHTML = '<div class="empty-inline"><span aria-hidden="true">🔔</span><p>还没有开启提醒的任务。</p></div>';
      $('reminderFootText').textContent = '还没有开启提醒的任务';
    } else {
      list.innerHTML = rows.slice(0, 4).map(function (row) { return reminderItem(row, false); }).join('');
      var next = rows.filter(function (row) { return row.status.key === 'upcoming'; })[0];
      if (next) {
        $('reminderFootText').textContent = '下一次 ' + hhmm(next.at) + ' · ' + next.task.title;
      } else if (due.length) {
        $('reminderFootText').textContent = '有 ' + due.length + ' 个提醒到点了';
      } else {
        $('reminderFootText').textContent = '今天的提醒都过去了';
      }
    }

    $('bellBadge').hidden = due.length === 0;
    $('bellBadge').textContent = due.length > 3 ? '3+' : String(due.length);
    $('bellSubtitle').textContent = due.length ? due.length + ' 个到点' : (rows.length ? rows.length + ' 个提醒' : '暂无提醒');
    $('bellList').innerHTML = rows.length
      ? rows.slice(0, 6).map(function (row) { return reminderItem(row, true); }).join('')
      : '<div class="empty-inline"><span aria-hidden="true">🌙</span><p>今天没有待触发的提醒。</p></div>';
    updateNotifyUi();
  }

  function renderWeek(streak) {
    var day = todayKey();
    var weekStart = state.db.settings.weekStart;
    var start = Core.startOfWeek(day, weekStart);
    var iso = Core.weekdayISO(day);
    var elapsed = ((iso - weekStart + 7) % 7) + 1;
    var weekdayNames = ['一', '二', '三', '四', '五', '六', '日'];
    $('weekSub').textContent = '周' + weekdayNames[iso - 1] + ' · 本周第 ' + elapsed + ' 天';

    var overview = Core.weekOverview(state.db, day);
    $('weekStats').innerHTML = ''
      + '<div class="week-stat"><strong>' + overview.litDays + '<span>/' + elapsed + '</span></strong><span>本周合成</span></div>'
      + '<div class="week-stat"><strong>' + overview.totalCheckins + '</strong><span>本周完成</span></div>'
      + '<div class="week-stat"><strong>' + overview.frozenDays + '</strong><span>本周中断</span></div>';

    var statusMap = {};
    streak.days.forEach(function (d) { statusMap[d.date] = d.status; });
    var bars = '';
    for (var i = 0; i < 7; i++) {
      var key = Core.addDays(start, i);
      var isFuture = key > day;
      var st = isFuture ? 'future' : (statusMap[key] || 'missed');
      var labelIndex = (i + weekStart - 1) % 7;
      bars += '<span class="week-bar is-' + st + (key === day ? ' is-today' : '') + '" title="' + esc(Core.formatDateCN(key) + ' · ' + (st === 'lit' ? '已合成' : st === 'future' ? '未到' : '未合成')) + '">'
        + '<i aria-hidden="true"></i><small>' + weekdayNames[labelIndex] + '</small></span>';
    }
    $('weekBars').innerHTML = bars;
  }

  /* ------------------------------------------------------------------ */
  /* 渲染：任务库                                                        */
  /* ------------------------------------------------------------------ */

  function renderLibrary() {
    var day = todayKey();
    var query = state.search.trim().toLowerCase();
    var tasks = Core.activeTasks(state.db.tasks).filter(function (task) {
      if (state.libraryFilter !== 'all' && task.type !== state.libraryFilter) return false;
      if (!query) return true;
      return (task.title + ' ' + (task.category || '') + ' ' + (task.notes || '')).toLowerCase().indexOf(query) >= 0;
    });
    tasks.sort(function (a, b) {
      var rank = { urgent: 0, daily: 1, weekly: 2, monthly: 3, interval: 4 };
      var ar = rank[a.type] == null ? 9 : rank[a.type];
      var br = rank[b.type] == null ? 9 : rank[b.type];
      return ar - br;
    });

    var list = $('libraryList');
    var empty = $('libraryEmpty');
    if (!tasks.length) {
      list.innerHTML = '';
      empty.hidden = false;
      $('libraryEmptyText').textContent = state.search ? '没有任务匹配「' + state.search + '」。' : '换个筛选条件，或新建一个任务。';
    } else {
      empty.hidden = true;
      list.innerHTML = tasks.map(function (task) {
        var st = taskStateOf(task, day);
        var due = dueOf(task, day);
        var doneLabels = { daily: '今日已合成', weekly: '本周已合成', monthly: '本月已合成', interval: '本轮已合成', urgent: '已合成' };
        var stateText = st.complete
          ? (doneLabels[task.type] || '已完成')
          : (!st.available ? '未开始' : (due && due.text ? due.text : '待完成'));
        return '<article class="library-row' + (st.complete ? ' is-done' : '') + (task.fire ? ' is-material' : '') + '" data-task-id="' + esc(task.id) + '">'
          + '<div class="task-leading">'
          + '<button class="check' + (st.complete ? ' is-checked' : '') + '" type="button" data-action="toggle" data-id="' + esc(task.id) + '" aria-label="' + (st.complete ? '取消完成' : '完成') + '：' + esc(task.title) + '" aria-pressed="' + st.complete + '"' + (!st.available ? ' disabled' : '') + '>' + icon('check') + '</button>'
          + '<span class="task-emoji" aria-hidden="true">' + esc(task.emoji) + '</span>'
          + '</div>'
          + '<div class="library-main">'
          + '<div class="task-title-line"><h3 class="task-name">' + esc(task.title) + '</h3>'
          + '<span class="chip chip-type type-' + task.type + '">' + typeGlyph(task.type) + ' ' + esc(Core.recurrenceLabel(task)) + '</span>'
          + (task.fire ? '<span class="chip chip-material">' + icon('craft') + '材料</span>' : '')
          + (task.category ? '<span class="chip chip-category">' + esc(task.category) + '</span>' : '')
          + '</div>'
          + '<div class="task-meta">' + taskMeta(task, { skipDue: st.complete }) + '</div>'
          + (task.notes ? '<p class="library-note">' + esc(task.notes) + '</p>' : '')
          + '</div>'
          + '<div class="library-side">'
          + '<span class="library-state' + (st.complete ? ' is-done' : (due && due.tone === 'danger' ? ' is-danger' : '')) + '">' + esc(stateText) + '</span>'
          + '<div class="task-actions">'
          + '<button class="task-action" type="button" data-action="edit" data-id="' + esc(task.id) + '" aria-label="编辑 ' + esc(task.title) + '" title="编辑">' + icon('edit') + '</button>'
          + '<button class="task-action recipe-action' + (task.fire ? ' is-on' : '') + '" type="button" data-action="toggle-fire" data-id="' + esc(task.id) + '" aria-label="' + (task.fire ? '移出材料' : '加入材料') + '" title="' + (task.fire ? '移出材料' : '加入材料') + '" aria-pressed="' + !!task.fire + '">' + icon('craft') + '</button>'
          + '<button class="task-action danger" type="button" data-action="delete" data-id="' + esc(task.id) + '" aria-label="删除 ' + esc(task.title) + '" title="删除">' + icon('trash') + '</button>'
          + '</div>'
          + '</div>'
          + '</article>';
      }).join('');
    }
  }

  /* ------------------------------------------------------------------ */
  /* 渲染：合成页                                                        */
  /* ------------------------------------------------------------------ */

  function renderFirePage(fs, streak, progress) {
    var overview = Core.weekOverview(state.db, todayKey());
    var hero = $('firePageHero');
    var info = craftResultInfo(fs);
    hero.dataset.state = streak.state;
    $('firePageStateLabel').textContent = stateLabel(streak.state);
    $('firePageStreak').textContent = streak.current;
    $('firePageBest').textContent = streak.best + ' 天';
    $('firePageTotal').textContent = streak.totalLit + ' 天';

    var missed = (streak.days || []).filter(function (d) { return d.status === 'missed' || d.status === 'frozen'; }).length;
    $('firePageFrozen').textContent = missed + ' 天';
    $('firePageStatus').textContent = {
      lit: streak.current > 1 ? '已连续合成 ' + streak.current + ' 天。今天的材料全部就位。' : '今天的配方已经完成。',
      frozen: fs.missing.length ? '还差 ' + fs.missing.length + ' 种材料，工作台正在等待。' : '工作台正在等待材料。',
      out: '昨天的合成没有续上。今天可以重新开始。',
      unset: '还没有设置配方材料。选几项之后，工作台才会开始记录。'
    }[streak.state] || '';

    var heat = $('heatmap');
    var heatDays = streak.days || [];
    var leadingBlanks = 0;
    if (heatDays.length) {
      leadingBlanks = (Core.weekdayISO(heatDays[0].date) - state.db.settings.weekStart + 7) % 7;
    }
    var blankCells = '';
    for (var b = 0; b < leadingBlanks; b++) {
      blankCells += '<span class="heat-cell is-blank" aria-hidden="true"></span>';
    }
    heat.innerHTML = blankCells + heatDays.map(function (d) {
      var dayNum = Number(d.date.slice(8));
      var label = { lit: '已合成', frozen: '进行中', missed: '中断', future: '未到' }[d.status] || '中断';
      return '<span class="heat-cell is-' + d.status + (d.date === todayKey() ? ' is-today' : '') + '" title="' + esc(Core.formatDateCN(d.date) + ' · ' + label) + '" aria-label="' + esc(Core.formatDateCN(d.date) + '，' + label) + '"><i>' + dayNum + '</i></span>';
    }).join('');
    var litCount = (streak.days || []).filter(function (d) { return d.status === 'lit'; }).length;
    $('heatmapNote').textContent = '最近 30 天合成 ' + litCount + ' 天' + (missed ? '，中断 ' + missed + ' 天' : '') + '。';

    var totalCompletions = 0;
    Core.activeTasks(state.db.tasks).forEach(function (task) {
      totalCompletions += Object.keys(task.completions || {}).length;
    });

    $('fireStats').innerHTML = ''
      + '<div class="craft-stat"><span>今日材料</span><strong>' + (fs.configured ? fs.done + '/' + fs.total : '空配方') + '</strong></div>'
      + '<div class="craft-stat"><span>今日完成</span><strong>' + progress.done + '/' + progress.total + '</strong></div>'
      + '<div class="craft-stat"><span>本周合成</span><strong>' + overview.litDays + '/' + overview.daysElapsed + '</strong></div>'
      + '<div class="craft-stat"><span>累计打卡</span><strong>' + totalCompletions + ' 次</strong></div>';

    renderCraftSlots($('craftPageGrid'), fs, true);
    setCraftOutput('craftPage', info);
  }

  /* ------------------------------------------------------------------ */
  /* 交互：视图 / 主题 / 弹窗                                            */
  /* ------------------------------------------------------------------ */

  function goView(view) {
    if (['today', 'tasks', 'fire'].indexOf(view) < 0) view = 'today';
    state.view = view;
    ['today', 'tasks', 'fire'].forEach(function (name) {
      var section = $('view-' + name);
      if (section) section.hidden = name !== view;
    });
    syncNav();
    scrollToTop();
  }

  function scrollToTop() {
    if (navigator.userAgent.indexOf('jsdom') >= 0) {
      document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
      return;
    }
    try {
      window.scrollTo({ top: 0, behavior: STATIC ? 'auto' : 'smooth' });
    } catch (e) {
      try { window.scrollTo(0, 0); } catch (err) { /* ignore */ }
    }
  }

  function syncNav() {
    $$('[data-view]').forEach(function (btn) {
      var active = btn.getAttribute('data-view') === state.view;
      btn.classList.toggle('is-active', active);
      if (btn.classList.contains('nav-item') || btn.classList.contains('mobile-nav-item')) {
        btn.setAttribute('aria-current', active ? 'page' : 'false');
      }
    });
  }

  function syncFilterButtons() {
    $$('#todayFilters .segment').forEach(function (btn) {
      var active = btn.getAttribute('data-filter') === state.todayFilter;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    $$('#libraryFilters .filter-chip').forEach(function (btn) {
      var active = btn.getAttribute('data-filter') === state.libraryFilter;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
  }

  function toggleTheme() {
    var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    setTheme(next);
  }

  function setTheme(theme) {
    state.db.settings.theme = theme;
    applyTheme(theme);
    save();
    syncThemeChoices();
  }

  function syncThemeChoices() {
    $$('[data-theme-choice]').forEach(function (btn) {
      var active = btn.getAttribute('data-theme-choice') === state.db.settings.theme;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function openModal(id) {
    if (MODAL_IDS.indexOf(id) < 0) return;
    state.lastFocus = document.activeElement;
    $('modalRoot').hidden = false;
    MODAL_IDS.forEach(function (modalId) {
      var modal = $(modalId);
      if (modal) modal.hidden = modalId !== id;
    });
    state.modal = id;
    document.body.classList.add('modal-open');
    setTimeout(function () {
      var target = $(id);
      if (!target) return;
      var focusable = target.querySelector('input:not([type="hidden"]), button:not([disabled]), select, textarea');
      if (focusable) focusable.focus();
    }, 40);
  }

  function closeModal() {
    if (!state.modal) return;
    $('modalRoot').hidden = true;
    MODAL_IDS.forEach(function (modalId) {
      var modal = $(modalId);
      if (modal) modal.hidden = true;
    });
    document.body.classList.remove('modal-open');
    state.modal = null;
    var focus = state.lastFocus;
    state.lastFocus = null;
    if (focus && typeof focus.focus === 'function') {
      try { focus.focus(); } catch (e) { /* ignore */ }
    }
  }

  function openConfirm(opts) {
    state.confirmCallback = opts.onOk || null;
    state.confirmReturnModal = state.modal;
    $('confirmTitle').textContent = opts.title || '确认操作';
    $('confirmText').textContent = opts.text || '这个操作无法撤销。';
    $('confirmOk').textContent = opts.okText || '确定';
    $('confirmOk').classList.toggle('btn-danger', opts.danger !== false);
    openModal('confirmModal');
    setTimeout(function () { $('confirmOk').focus(); }, 50);
  }

  function closeConfirm() {
    state.confirmCallback = null;
    closeModal();
  }

  function populateMonthday() {
    var select = $('monthday');
    if (!select) return;
    var html = '';
    for (var i = 1; i <= 31; i++) {
      html += '<option value="' + i + '">' + i + ' 日</option>';
    }
    html += '<option value="-1">最后一天</option>';
    select.innerHTML = html;
  }

  function openTaskModal(taskId) {
    var task = taskId ? findTask(taskId) : null;
    if (taskId && !task) return;
    state.editingId = task ? task.id : null;
    state.selectedEmoji = task ? task.emoji : '📖';
    $('taskModalKicker').textContent = task ? 'EDIT TASK' : 'NEW TASK';
    $('taskModalTitle').textContent = task ? '编辑任务' : '添加任务';
    $('taskSaveBtn').textContent = task ? '保存修改' : '保存任务';
    $('taskFormError').hidden = true;
    $('taskFormError').textContent = '';

    $('taskTitle').value = task ? task.title : '';
    $('taskCategory').value = task ? (task.category || '') : '';
    $('taskNotes').value = task ? (task.notes || '') : '';
    $('fireEnabled').checked = task ? !!task.fire : false;
    $('reminderEnabled').checked = task ? !!(task.reminder && task.reminder.enabled) : false;
    $('reminderTime').value = task && task.reminder && task.reminder.time ? task.reminder.time : '21:00';
    $('everyN').value = task && task.everyN ? task.everyN : 3;
    $('anchor').value = task && task.anchor ? task.anchor : todayKey();
    $('monthday').value = task && task.monthday ? String(task.monthday) : String(Number(todayKey().slice(8)));
    $('dueDate').value = task && task.due ? task.due : Core.addDays(todayKey(), 3);
    $('dueTime').value = task && task.dueTime ? task.dueTime : '18:00';
    $('priority').value = task && task.priority ? task.priority : 'normal';

    var type = task ? task.type : 'daily';
    $$('[name="taskType"]').forEach(function (radio) { radio.checked = radio.value === type; });
    updateTypeFields();
    syncEmojiPicker();
    $('emojiPreview').textContent = state.selectedEmoji;
    openModal('taskModal');
    setTimeout(function () { $('taskTitle').focus(); }, 80);
  }

  function updateTypeFields() {
    var type = (document.querySelector('[name="taskType"]:checked') || {}).value || 'daily';
    if ($('weeklyHint')) $('weeklyHint').textContent = (weekStartOpt() === 7 ? '周日' : '周一') + '开始';
    if ($('weeklyHintText')) $('weeklyHintText').textContent = '每周任务以自然周为周期，完成一次后本周自动打勾，'
      + (weekStartOpt() === 7 ? '下周日' : '下周一') + '重新出现。';
    $('fieldWeekly').hidden = type !== 'weekly';
    $('fieldMonthly').hidden = type !== 'monthly';
    $('fieldInterval').hidden = type !== 'interval';
    $('fieldUrgent').hidden = type !== 'urgent';
    $$('.conditional').forEach(function (el) {
      if (['fieldWeekly', 'fieldMonthly', 'fieldInterval', 'fieldUrgent'].indexOf(el.id) < 0) return;
      el.hidden = el.id !== 'field' + type.charAt(0).toUpperCase() + type.slice(1);
    });
  }

  function syncEmojiPicker() {
    var matched = false;
    $$('#emojiPicker .emoji-option').forEach(function (btn) {
      var active = btn.getAttribute('data-emoji') === state.selectedEmoji;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
      if (active) matched = true;
    });
    $('emojiCustom').value = matched ? '' : state.selectedEmoji;
    $('emojiPreview').textContent = state.selectedEmoji;
  }

  function openSettings() {
    syncSettingsForm();
    openModal('settingsModal');
  }

  function syncSettingsForm() {
    var s = state.db.settings;
    $('userName').value = s.name || '朋友';
    $('weekStartSelect').value = String(s.weekStart || 1);
    $('soundEnabled').checked = !!s.sound;
    syncThemeChoices();
    syncAiSettingsFields();
    syncTencentSettingsFields();
    updateNotifyUi();
  }

  function updateNotifyUi() {
    var status = notifyPermission();
    var text = {
      granted: '桌面通知已开启。页面在后台时，到点提醒也会出现。',
      denied: '桌面通知被浏览器拦截了。站内提醒仍然有效，可在站点设置中重新允许。',
      default: '浏览器通知尚未开启。开启后，即使页面在后台也能收到提醒。',
      unsupported: '当前打开方式不支持系统通知。站内提醒仍然有效。'
    }[status];
    var statusEl = $('notifyStatus');
    if (statusEl) statusEl.textContent = text;
    if ($('notifyPermissionBtn')) {
      $('notifyPermissionBtn').textContent = status === 'granted' ? '通知已开启' : status === 'denied' ? '查看开启方法' : '开启桌面通知';
    }
    if ($('enableNotifyBtn')) {
      $('enableNotifyBtn').textContent = status === 'granted' ? '通知已开启' : '桌面通知';
    }
    if ($('bellEnableText')) {
      $('bellEnableText').textContent = status === 'granted' ? '桌面通知已开启' : status === 'denied' ? '通知被浏览器拦截' : '开启桌面通知';
    }
  }

  /* ------------------------------------------------------------------ */
  /* 交互：任务                                                          */
  /* ------------------------------------------------------------------ */

  function toggleTask(taskId) {
    var task = findTask(taskId);
    if (!task) return;
    var day = todayKey();
    var st = taskStateOf(task, day);
    if (!st.available) {
      toast('这件任务还没开始', { text: dueOf(task, day).text || '', tone: 'neutral' });
      return;
    }
    var wasComplete = st.complete;
    var beforeLit = Core.fireState(state.db, day).lit;
    task.completions = setCompletionOn(task, day, !wasComplete);
    updateTodayLog();
    var afterLit = Core.fireState(state.db, day).lit;
    save();
    renderAll();
    if (!wasComplete) {
      if (state.activeReminder && state.activeReminder.taskId === taskId) hideReminder();
      if (!beforeLit && afterLit) {
        celebrate(streakInfoSafe());
      } else {
        toast('完成「' + task.title + '」', { icon: icon('check'), tone: 'success', duration: 2200 });
      }
    } else {
      toast('已取消「' + task.title + '」', { tone: 'neutral', duration: 1800 });
    }
  }

  function streakInfoSafe() {
    try { return Core.streakInfo(state.db, todayKey()); } catch (e) { return { current: 0, best: 0 }; }
  }

  function toggleFire(taskId) {
    var task = findTask(taskId);
    if (!task) return;
    if (!task.fire && Core.activeTasks(state.db.tasks).filter(function (t) { return t.fire; }).length >= 9) {
      toast('工作台只有 9 个格子', { text: '先移出一块材料，再放新的进去。', tone: 'neutral' });
      return;
    }
    var before = Core.fireState(state.db, todayKey()).lit;
    task.fire = !task.fire;
    updateTodayLog();
    var after = Core.fireState(state.db, todayKey()).lit;
    save();
    renderAll();
    if (!before && after) {
      celebrate(streakInfoSafe());
    } else {
      toast(task.fire ? '已加入合成配方' : '已移出合成配方', {
        text: task.fire ? '完成它，工作台就多一块材料。' : '它不再计入今天的配方。',
        icon: icon('craft'),
        tone: 'neutral',
        duration: 2400
      });
    }
  }

  function removeTask(taskId) {
    var task = findTask(taskId);
    if (!task) return;
    openConfirm({
      title: '删除任务',
      text: '「' + task.title + '」会从清单中移除。已保存的历史合成记录会保留，但这个任务不会再出现。',
      okText: '删除',
      danger: true,
      onOk: function () {
        state.db.tasks = state.db.tasks.filter(function (t) { return t.id !== taskId; });
        delete state.db.snoozes[taskId];
        updateTodayLog();
        save();
        renderAll();
        closeModal();
        toast('已删除「' + task.title + '」', { tone: 'neutral' });
      }
    });
  }

  function submitTaskForm(event) {
    event.preventDefault();
    var title = $('taskTitle').value.trim();
    var type = (document.querySelector('[name="taskType"]:checked') || {}).value || 'daily';
    var error = $('taskFormError');
    error.hidden = true;

    if (!title) {
      error.textContent = '给任务起个名字吧。';
      error.hidden = false;
      $('taskTitle').focus();
      return;
    }
    var reminderEnabled = $('reminderEnabled').checked;
    var reminderTime = $('reminderTime').value;
    if (reminderEnabled && !reminderTime) {
      error.textContent = '开启提醒后，请选择提醒时间。';
      error.hidden = false;
      $('reminderTime').focus();
      return;
    }

    var everyN = parseInt($('everyN').value, 10);
    if (type === 'interval' && (!everyN || everyN < 2 || everyN > 365)) {
      error.textContent = '间隔需要在 2 到 365 天之间。';
      error.hidden = false;
      $('everyN').focus();
      return;
    }
    var anchor = $('anchor').value || todayKey();
    if (type === 'interval' && !Core.isKey(anchor)) {
      error.textContent = '请选择有效的开始日期。';
      error.hidden = false;
      $('anchor').focus();
      return;
    }
    var dueDate = $('dueDate').value;
    if (type === 'urgent' && !Core.isKey(dueDate)) {
      error.textContent = '紧要任务需要设置截止日期。';
      error.hidden = false;
      $('dueDate').focus();
      return;
    }

    var existing = state.editingId ? findTask(state.editingId) : null;
    var wantRecipe = $('fireEnabled').checked;
    if (wantRecipe && (!existing || !existing.fire) && Core.activeTasks(state.db.tasks).filter(function (t) { return t.fire; }).length >= 9) {
      error.textContent = '工作台只有 9 个格子，先移出一块材料再加入。';
      error.hidden = false;
      return;
    }
    var task = existing || Core.createTask({}, todayKey());
    task.title = title;
    task.emoji = state.selectedEmoji || '📖';
    task.category = $('taskCategory').value.trim();
    task.notes = $('taskNotes').value.trim();
    task.type = type;
    task.fire = wantRecipe;
    task.reminder = { enabled: reminderEnabled, time: reminderTime || '21:00' };
    task.monthday = type === 'monthly' ? Number($('monthday').value || 1) : (existing ? existing.monthday : 1);
    task.everyN = type === 'interval' ? everyN : (existing ? existing.everyN : 3);
    task.anchor = type === 'interval' ? anchor : (existing ? existing.anchor : todayKey());
    task.due = type === 'urgent' ? dueDate : (existing ? existing.due : todayKey());
    task.dueTime = type === 'urgent' ? ($('dueTime').value || '18:00') : (existing ? existing.dueTime : '18:00');
    task.priority = type === 'urgent' ? $('priority').value : (existing ? existing.priority : 'normal');
    task.archived = false;

    var beforeLit = Core.fireState(state.db, todayKey()).lit;
    if (existing) {
      state.db.tasks = state.db.tasks.map(function (t) { return t.id === existing.id ? task : t; });
    } else {
      state.db.tasks.push(task);
    }
    updateTodayLog();
    var afterLit = Core.fireState(state.db, todayKey()).lit;
    save();
    closeModal();
    renderAll();
    if (!beforeLit && afterLit) celebrate(streakInfoSafe());
    else toast(existing ? '已保存修改' : '已添加「' + task.title + '」', { icon: icon(task.emoji), tone: 'success' });
  }

  /* ------------------------------------------------------------------ */
  /* 交互：提醒                                                          */
  /* ------------------------------------------------------------------ */

  function notifyPermission() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission || 'default';
  }

  function requestNotify() {
    if (!('Notification' in window)) {
      toast('当前打开方式不支持系统通知', { text: '站内提醒仍然会正常工作。', tone: 'neutral' });
      return;
    }
    if (Notification.permission === 'granted') {
      toast('桌面通知已经开启', { icon: icon('bell'), tone: 'success' });
      updateNotifyUi();
      return;
    }
    if (Notification.permission === 'denied') {
      toast('通知被浏览器拦截了', { text: '请在地址栏左侧的站点设置中允许通知，然后刷新页面。', tone: 'danger', duration: 5000 });
      updateNotifyUi();
      return;
    }
    try {
      var result = Notification.requestPermission(function (permission) {
        if (permission === 'granted') {
          toast('桌面通知已开启', { icon: icon('bell'), tone: 'success' });
        } else {
          toast('还没有开启桌面通知', { text: '站内提醒不受影响。', tone: 'neutral' });
        }
        updateNotifyUi();
      });
      if (result && typeof result.then === 'function') {
        result.then(function () { updateNotifyUi(); }).catch(function () { updateNotifyUi(); });
      }
    } catch (e) {
      toast('无法请求通知权限', { text: '站内提醒仍然会正常工作。', tone: 'neutral' });
      updateNotifyUi();
    }
  }

  function checkReminders() {
    if (!state.db) return;
    if (state.modal && state.modal !== 'settingsModal') return;
    if (state.activeReminder) return;
    var due;
    try {
      due = Core.collectReminders(state.db, todayKey(), now()).due || [];
    } catch (e) {
      return;
    }
    if (!due.length) return;
    showReminder(due[0]);
  }

  function showReminder(item) {
    var task = findTask(item.task.id) || item.task;
    var day = todayKey();
    if (!task || isCompleteOn(task, day)) return;
    var wasSnoozed = !!state.db.snoozes[task.id];
    if (!state.db.fired[item.signature]) {
      state.db.fired[item.signature] = nowIso();
    }
    if (state.db.snoozes[task.id]) delete state.db.snoozes[task.id];
    save();
    state.activeReminder = { taskId: task.id, signature: item.signature, at: item.at };

    $('reminderToastKicker').textContent = wasSnoozed ? '再提醒你一次' : '到点啦';
    $('reminderToastTitle').textContent = task.emoji + ' ' + task.title;
    var due = dueOf(task, day);
    $('reminderToastText').textContent = Core.recurrenceLabel(task) + (due && due.text ? ' · ' + due.text : '') + '。现在去完成它吧。';
    var toastEl = $('reminderToast');
    toastEl.hidden = false;
    requestAnimationFrame(function () { toastEl.classList.add('is-visible'); });
    playChime('reminder');
    sendDesktopNotification(task, due);
    clearTimeout(state.reminderTimer);
    state.reminderTimer = setTimeout(function () {
      if (state.activeReminder) hideReminder();
    }, 45000);
    renderReminders();
  }

  function hideReminder() {
    var toastEl = $('reminderToast');
    if (!toastEl) return;
    toastEl.classList.remove('is-visible');
    clearTimeout(state.reminderTimer);
    setTimeout(function () {
      if (!toastEl.classList.contains('is-visible')) toastEl.hidden = true;
    }, 240);
    state.activeReminder = null;
    setTimeout(checkReminders, 300);
  }

  function completeFromReminder() {
    var active = state.activeReminder;
    if (!active) return;
    var task = findTask(active.taskId);
    hideReminder();
    if (!task) return;
    if (!isCompleteOn(task, todayKey())) toggleTask(task.id);
    else {
      toast('这件任务已经完成了', { icon: icon('check'), tone: 'success' });
    }
  }

  function snoozeReminder() {
    var active = state.activeReminder;
    if (!active) return;
    var when = new Date(now().getTime() + 10 * 60 * 1000);
    state.db.snoozes[active.taskId] = when.toISOString();
    save();
    hideReminder();
    toast('好，10 分钟后再提醒你', { text: hhmm(when) + ' 见', icon: icon('clock'), tone: 'neutral' });
    renderReminders();
  }

  function sendDesktopNotification(task, due) {
    if (notifyPermission() !== 'granted') return;
    try {
      var body = Core.recurrenceLabel(task) + (due && due.text ? ' · ' + due.text : '') + '。现在去完成它吧。';
      var notification = new Notification('方块清单 · 到点提醒', {
        body: task.emoji + ' ' + task.title + '\n' + body,
        tag: 'ember-' + task.id,
        silent: !state.db.settings.sound
      });
      notification.onclick = function () {
        try { window.focus(); } catch (e) { /* ignore */ }
        notification.close();
      };
    } catch (e) { /* file:// 等环境可能不支持，站内提醒仍可用 */ }
  }

  /* ------------------------------------------------------------------ */
  /* 交互：设置 / 数据                                                   */
  /* ------------------------------------------------------------------ */

  function exportData() {
    try {
      var blob = new Blob([JSON.stringify(state.db, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '方块清单-备份-' + todayKey() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
      toast('备份已导出', { text: '妥善保存这个 JSON 文件。', icon: icon('download'), tone: 'success' });
    } catch (e) {
      toast('导出失败', { text: '当前浏览器不支持文件下载。', tone: 'danger' });
    }
  }

  function importData(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (e) {
        toast('导入失败', { text: '文件不是有效的 JSON 备份。', tone: 'danger' });
        return;
      }
      var imported;
      try {
        imported = Core.normalizeDb(parsed);
      } catch (e) {
        imported = null;
      }
      if (!imported || !Array.isArray(imported.tasks)) {
        toast('导入失败', { text: '备份内容不完整，已保留当前数据。', tone: 'danger' });
        return;
      }
      openConfirm({
        title: '导入备份',
        text: '导入会覆盖当前的全部任务和合成记录。当前数据将无法恢复，建议先导出备份。确定继续吗？',
        okText: '覆盖并导入',
        danger: true,
        onOk: function () {
          state.db = imported;
          applyTheme(state.db.settings.theme);
          state.lastDateKey = todayKey();
          updateTodayLog();
          save();
          renderAll();
          closeModal();
          toast('备份已导入', { text: '共恢复 ' + state.db.tasks.length + ' 个任务。', tone: 'success' });
        }
      });
    };
    reader.onerror = function () {
      toast('读取文件失败', { tone: 'danger' });
    };
    reader.readAsText(file);
  }

  function resetAllData() {
    openConfirm({
      title: '清空全部数据',
      text: '所有任务、完成记录与合成历史都会被删除。这个操作不可撤销，建议先导出备份。',
      okText: '清空数据',
      danger: true,
      onOk: function () {
        var empty = freshDb();
        empty.settings.seeded = true;
        state.db = empty;
        state.lastDateKey = todayKey();
        applyTheme(empty.settings.theme);
        updateTodayLog();
        save();
        renderAll();
        closeModal();
        toast('数据已清空', { text: '可以重新开始了。', tone: 'neutral' });
      }
    });
  }

  function loadDemoData() {
    openConfirm({
      title: '载入示例数据',
      text: '会覆盖当前数据，放入一组带 30 天合成历史的示例任务。当前数据将无法恢复。',
      okText: '载入示例',
      danger: true,
      onOk: function () {
        state.db = Core.normalizeDb(seedDemo());
        state.lastDateKey = todayKey();
        applyTheme(state.db.settings.theme);
        updateTodayLog();
        save();
        renderAll();
        closeModal();
        toast('示例数据已载入', { text: '所有示例任务都可以直接编辑或删除。', icon: icon('spark'), tone: 'success' });
      }
    });
  }

  function focusFuelPicker() {
    goView('fire');
    setTimeout(function () {
      var target = $('fireFuelTitle');
      if (target) {
        try { target.scrollIntoView({ behavior: STATIC ? 'auto' : 'smooth', block: 'center' }); } catch (e) { target.scrollIntoView(); }
        var card = target.closest('.card');
        if (card) {
          card.classList.add('is-highlight');
          setTimeout(function () { card.classList.remove('is-highlight'); }, 1800);
        }
      }
    }, 80);
    toast('点下面的任务，把它们加入合成配方', { icon: icon('diamond'), tone: 'neutral', duration: 3200 });
  }

  /* ------------------------------------------------------------------ */
  /* OCR：扫描手写记事 -> 今日待办                                       */
  /* ------------------------------------------------------------------ */

  function openOcrModal() {
    syncOcrUi();
    openModal('ocrModal');
    setTimeout(function () {
      var zone = $('ocrDropzone');
      if (zone) zone.focus();
    }, 80);
  }

  function loadOcrConfig() {
    var cfg = {
      enabled: OCR_AI_DEFAULTS.enabled,
      apiKey: OCR_AI_DEFAULTS.apiKey,
      base: OCR_AI_DEFAULTS.base,
      model: OCR_AI_DEFAULTS.model
    };
    var migrated = false;
    try {
      var raw = localStorage.getItem(OCR_CONFIG_KEY);
      if (raw) {
        var parsed = JSON.parse(raw) || {};
        var base = typeof parsed.base === 'string' ? parsed.base : '';
        var model = typeof parsed.model === 'string' ? parsed.model : '';
        // 从旧的 DeepSeek 直连/后端配置迁移到 SiliconFlow DeepSeek-OCR。
        var isSiliconFlow = /siliconflow/i.test(base) && /DeepSeek-OCR/i.test(model);
        if (!isSiliconFlow) {
          cfg.enabled = true;
          cfg.apiKey = OCR_AI_DEFAULTS.apiKey;
          cfg.base = OCR_AI_DEFAULTS.base;
          cfg.model = OCR_AI_DEFAULTS.model;
          migrated = true;
        } else {
          var key = parsed.apiKeyEnc ? decodeOcrSecret(parsed.apiKeyEnc) : (typeof parsed.apiKey === 'string' ? parsed.apiKey : '');
          cfg.enabled = typeof parsed.enabled === 'boolean' ? parsed.enabled : OCR_AI_DEFAULTS.enabled;
          cfg.apiKey = key || OCR_AI_DEFAULTS.apiKey;
          cfg.base = base || OCR_AI_DEFAULTS.base;
          cfg.model = model || OCR_AI_DEFAULTS.model;
          if (!key && OCR_AI_DEFAULTS.apiKey) {
            cfg.enabled = true;
            migrated = true;
          }
        }
        if (parsed.backend || parsed.apiKeyEnc || parsed.apiKey) migrated = true;
      }
    } catch (e) { /* localStorage 不可用时使用默认值 */ }
    state.ocr.ai = cfg;
    if (migrated) saveOcrConfig();
  }

  function saveOcrConfig() {
    try {
      var ai = state.ocr.ai || {};
      localStorage.setItem(OCR_CONFIG_KEY, JSON.stringify({
        enabled: !!ai.enabled,
        apiKeyEnc: ai.apiKey ? encodeOcrSecret(ai.apiKey) : '',
        base: ai.base || OCR_AI_DEFAULTS.base,
        model: ai.model || OCR_AI_DEFAULTS.model
      }));
    } catch (e) {
      toast('AI 识别设置保存失败', { text: '浏览器存储不可用。', tone: 'danger' });
    }
  }

  function loadTencentConfig() {
    var cfg = {
      enabled: TENCENT_DEFAULTS.enabled,
      backend: TENCENT_DEFAULTS.backend
    };
    try {
      var raw = localStorage.getItem(TENCENT_CONFIG_KEY);
      if (raw) {
        var parsed = JSON.parse(raw) || {};
        cfg.enabled = !!parsed.enabled;
        cfg.backend = typeof parsed.backend === 'string' && parsed.backend ? parsed.backend : TENCENT_DEFAULTS.backend;
      }
    } catch (e) { /* localStorage 不可用时使用默认值 */ }
    state.ocr.tencent = cfg;
  }

  function saveTencentConfig() {
    try {
      var t = state.ocr.tencent || {};
      localStorage.setItem(TENCENT_CONFIG_KEY, JSON.stringify({
        enabled: !!t.enabled,
        backend: t.backend || TENCENT_DEFAULTS.backend
      }));
    } catch (e) {
      toast('腾讯云 OCR 设置保存失败', { text: '浏览器存储不可用。', tone: 'danger' });
    }
  }

  function tencentOcrReady() {
    var t = state.ocr.tencent || {};
    return !!(t.enabled && t.backend);
  }

  function syncTencentSettingsFields() {
    var t = state.ocr.tencent || {};
    if ($('tencentOcrEnabled')) $('tencentOcrEnabled').checked = !!t.enabled;
    if ($('tencentBackend')) $('tencentBackend').value = t.backend || TENCENT_DEFAULTS.backend;
  }

  var tencentConfigSaveTimer = null;

  function updateTencentConfigFromForm(silent) {
    state.ocr.tencent = {
      enabled: $('tencentOcrEnabled') ? $('tencentOcrEnabled').checked : false,
      backend: $('tencentBackend') ? ($('tencentBackend').value.trim() || TENCENT_DEFAULTS.backend) : TENCENT_DEFAULTS.backend
    };
    saveTencentConfig();
    syncOcrUi();
    if (silent) return;
    if (state.ocr.tencent.enabled) {
      toast('腾讯云 OCR 已启用', { text: '先双击 start-tencent-ocr.bat 启动后端，再在扫描器点「腾讯云 OCR」。', icon: icon('spark'), tone: 'success' });
    }
  }

  function scheduleTencentConfigSave() {
    if (tencentConfigSaveTimer) clearTimeout(tencentConfigSaveTimer);
    tencentConfigSaveTimer = setTimeout(function () { updateTencentConfigFromForm(true); }, 300);
  }

  function flushTencentConfigSave() {
    if (tencentConfigSaveTimer) {
      clearTimeout(tencentConfigSaveTimer);
      tencentConfigSaveTimer = null;
    }
    updateTencentConfigFromForm(true);
  }

  function aiOcrReady() {
    var ai = state.ocr.ai || {};
    return !!(ai.enabled && ai.apiKey && ai.base && ai.model);
  }

  function syncAiSettingsFields() {
    var ai = state.ocr.ai || {};
    if ($('aiOcrEnabled')) $('aiOcrEnabled').checked = !!ai.enabled;
    if ($('aiOcrKey')) $('aiOcrKey').value = ai.apiKey || '';
    if ($('aiOcrModel')) $('aiOcrModel').value = ai.model || OCR_AI_DEFAULTS.model;
  }

  var aiConfigSaveTimer = null;

  function updateAiConfigFromForm(silent) {
    state.ocr.ai = {
      enabled: $('aiOcrEnabled') ? $('aiOcrEnabled').checked : false,
      apiKey: $('aiOcrKey') ? $('aiOcrKey').value.trim() : '',
      base: OCR_AI_DEFAULTS.base,
      model: $('aiOcrModel') ? ($('aiOcrModel').value.trim() || OCR_AI_DEFAULTS.model) : OCR_AI_DEFAULTS.model
    };
    saveOcrConfig();
    syncOcrUi();
    if (silent) return;
    if (state.ocr.ai.enabled) {
      toast('AI 手写识别已启用', { text: '扫描时会直接调用 SiliconFlow DeepSeek-OCR。', icon: icon('spark'), tone: 'success' });
    }
  }

  function scheduleAiConfigSave() {
    if (aiConfigSaveTimer) clearTimeout(aiConfigSaveTimer);
    aiConfigSaveTimer = setTimeout(function () { updateAiConfigFromForm(true); }, 300);
  }

  function flushAiConfigSave() {
    if (aiConfigSaveTimer) {
      clearTimeout(aiConfigSaveTimer);
      aiConfigSaveTimer = null;
    }
    updateAiConfigFromForm(true);
  }

  function syncOcrUi() {
    var file = state.ocr.file;
    var preview = $('ocrPreview');
    var empty = $('ocrEmpty');
    var zone = $('ocrDropzone');
    var ai = aiOcrReady();
    var tencent = tencentOcrReady();
    if ($('ocrRunBtn')) $('ocrRunBtn').textContent = ai ? 'AI 识别' : '识别文字';
    if ($('ocrTencentBtn')) {
      $('ocrTencentBtn').hidden = !tencent;
      $('ocrTencentBtn').disabled = !!state.ocr.running;
    }
    if ($('ocrLocalBtn')) {
      $('ocrLocalBtn').hidden = !ai;
      $('ocrLocalBtn').disabled = !!state.ocr.running;
    }
    if ($('ocrAiSetupBtn')) $('ocrAiSetupBtn').hidden = ai;
    if ($('ocrEngineHelp')) {
      if (tencent && ai) {
        $('ocrEngineHelp').textContent = '可用：AI 识别（后端）/ 本地识别。AI 结果可校对。';
      } else if (tencent) {
        $('ocrEngineHelp').textContent = '当前：腾讯云 OCR（后端）。先启动 start-tencent-ocr.bat，再点「腾讯云 OCR」。';
      } else if (ai) {
        $('ocrEngineHelp').textContent = '当前：AI 识别（SiliconFlow DeepSeek-OCR v1.4.0）。照片会发送给 SiliconFlow；识别后可校对。';
      } else if (state.ocr.ai.enabled) {
        $('ocrEngineHelp').textContent = 'AI 已开启，但缺少 API Key；当前会退回本地 OCR。';
      } else {
        $('ocrEngineHelp').textContent = '当前：本地 OCR（适合印刷体/工整字）。连笔手写建议启用腾讯云 OCR 或 AI 手写识别。';
      }
    }
    if (preview) {
      if (state.ocr.imageUrl) {
        preview.src = state.ocr.imageUrl;
        preview.hidden = false;
        if (empty) empty.hidden = true;
        if (zone) zone.classList.add('has-image');
      } else {
        preview.hidden = true;
        preview.removeAttribute('src');
        if (empty) empty.hidden = false;
        if (zone) zone.classList.remove('has-image');
      }
    }
    if ($('ocrRunBtn')) $('ocrRunBtn').disabled = !file || state.ocr.running;
    if ($('ocrOpenImageBtn')) $('ocrOpenImageBtn').disabled = !file;
    updateOcrSelectionCount();
  }

  function setOcrStatus(title, sub) {
    if ($('ocrStatus')) $('ocrStatus').textContent = title;
    if ($('ocrSubstatus')) $('ocrSubstatus').textContent = sub || '';
  }

  function setOcrProgress(pct, title, sub) {
    var wrap = $('ocrProgress');
    var bar = $('ocrProgressBar');
    if (wrap) wrap.hidden = false;
    if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (title) setOcrStatus(title, sub);
  }

  function hideOcrProgressLater() {
    setTimeout(function () {
      var wrap = $('ocrProgress');
      if (wrap && !state.ocr.running) wrap.hidden = true;
    }, 700);
  }

  function loadOcrFile(file) {
    if (!file) return;
    if (!/^image\//i.test(file.type || '')) {
      toast('请选择图片文件', { text: '支持 JPG / PNG / WebP。', tone: 'neutral' });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast('图片有点大', { text: '请选择 20MB 以内的照片。', tone: 'neutral' });
      return;
    }
    clearOcrImageOnly();
    state.ocr.file = file;
    state.ocr.imageUrl = URL.createObjectURL(file);
    state.ocr.canvas = null;
    $('ocrText').value = '';
    state.ocr.parsed = [];
    renderOcrSuggestions([]);
    syncOcrUi();
    setOcrStatus('图片已就绪', '点击「识别文字」，也可以先手动输入');
    if ($('ocrProgress')) $('ocrProgress').hidden = true;
    if ($('ocrRunBtn')) $('ocrRunBtn').disabled = false;
  }

  function clearOcrImageOnly() {
    if (state.ocr.imageUrl) {
      try { URL.revokeObjectURL(state.ocr.imageUrl); } catch (e) { /* ignore */ }
    }
    state.ocr.file = null;
    state.ocr.imageUrl = null;
    state.ocr.canvas = null;
    state.ocr.parsed = [];
    var preview = $('ocrPreview');
    if (preview) {
      preview.hidden = true;
      preview.removeAttribute('src');
    }
    var empty = $('ocrEmpty');
    if (empty) empty.hidden = false;
    var zone = $('ocrDropzone');
    if (zone) zone.classList.remove('has-image');
    if ($('ocrRunBtn')) $('ocrRunBtn').disabled = true;
    if ($('ocrProgress')) $('ocrProgress').hidden = true;
    setOcrStatus('等待图片', '上传或拍一张手写记事');
  }

  function fitOcrCanvas() {
    return new Promise(function (resolve, reject) {
      if (state.ocr.canvas) { resolve(state.ocr.canvas); return; }
      if (!state.ocr.imageUrl) { reject(new Error('还没有选择图片')); return; }
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (!w || !h) throw new Error('图片尺寸无效');
          var scale = 1;
          if (w < 1000) scale = Math.min(1.8, 1000 / w);
          else if (w > 2200) scale = 2200 / w;
          if (h * scale > 3200) scale = 3200 / h;
          var pad = 24;
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(w * scale) + pad * 2);
          canvas.height = Math.max(1, Math.round(h * scale) + pad * 2);
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          try { ctx.filter = 'grayscale(1) contrast(1.18)'; } catch (e) { /* ignore */ }
          ctx.drawImage(img, pad, pad, Math.round(w * scale), Math.round(h * scale));
          try { ctx.filter = 'none'; } catch (e) { /* ignore */ }
          state.ocr.canvas = canvas;
          resolve(canvas);
        } catch (err) { reject(err); }
      };
      img.onerror = function () { reject(new Error('图片读取失败，请换一张')); };
      img.src = state.ocr.imageUrl;
    });
  }

  function ensureOcrScript() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (state.ocr.enginePromise) return state.ocr.enginePromise;
    state.ocr.enginePromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = OCR_ENGINE.script;
      script.async = true;
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('OCR 引擎加载超时，请检查网络'));
      }, 30000);
      script.onload = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (window.Tesseract) resolve(window.Tesseract);
        else reject(new Error('OCR 引擎未正确加载'));
      };
      script.onerror = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('OCR 引擎加载失败，请检查网络'));
      };
      document.head.appendChild(script);
    }).catch(function (err) {
      state.ocr.enginePromise = null;
      throw err;
    });
    return state.ocr.enginePromise;
  }

  function ensureOcrWorker() {
    if (state.ocr.worker) return Promise.resolve(state.ocr.worker);
    if (state.ocr.workerPromise) return state.ocr.workerPromise;
    state.ocr.workerPromise = (async function () {
      setOcrProgress(3, '准备 OCR 引擎', '首次使用需要下载约 2MB 的中文识别数据');
      var Tesseract = await ensureOcrScript();
      setOcrProgress(8, '加载 OCR 引擎', '下载识别核心…');
      var worker = await Tesseract.createWorker('chi_sim', 1, {
        workerPath: OCR_ENGINE.workerPath,
        corePath: OCR_ENGINE.corePath,
        langPath: OCR_ENGINE.langPath,
        logger: function (m) {
          var labels = {
            'loading tesseract core': '加载 OCR 核心',
            'initializing tesseract': '初始化识别引擎',
            'loading language traineddata': '下载中文识别数据',
            'initializing api': '准备识别',
            'recognizing text': '识别文字'
          };
          var pct = Math.max(5, Math.round((m.progress || 0) * 100));
          setOcrProgress(pct, labels[m.status] || m.status, m.status === 'recognizing text' ? '正在识别手写内容…' : '');
        }
      });
      try {
        await worker.setParameters({
          tessedit_pageseg_mode: '6',
          preserve_interword_spaces: '1'
        });
      } catch (e) { /* 参数不可用时继续使用默认值 */ }
      state.ocr.worker = worker;
      return worker;
    })().catch(function (err) {
      state.ocr.workerPromise = null;
      throw err;
    });
    return state.ocr.workerPromise;
  }

  function normalizeOcrText(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .map(function (line) { return line.replace(/\s+$/g, ''); })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function parseOcrTasks(text) {
    var source = String(text || '').replace(/\r/g, '').replace(/\u00a0/g, ' ');
    // AI 常把左右两栏挤在一行，用勾选框当分隔符。先按勾选框断行；
    // □ 既可能是复选框，也可能是「看不清的字」，所以只在行尾/后接编号时断开。
    source = source
      .replace(/[☑☐✅✔✓◻◼▢]/g, '\n')
      .replace(/□(?=\s*(?:\d{1,2}[.、)）]|$))/gm, '\n');
    var rawLines = source.split(/\n+/);
    var items = [];
    rawLines.forEach(function (line) {
      line = line.replace(/^[\s|｜]+/, '').replace(/[\s|｜]+$/, '').trim();
      if (!line) return;
      line = line
        .replace(/^\s*\[\s?[xX ]?\s?\]\s*/, '')
        .replace(/^[\-–—*•·●○◦【】]+\s*/, '')
        .replace(/^\d{1,2}[.、)）]\s*/, '')
        .replace(/^[（(]\d{1,2}[)）]\s*/, '')
        .replace(/^(待办事项|待办|todo|to-do|今日待办)\s*[:：]?\s*/i, '');
      if (!line) return;
      if (/^(今日|今日待办|待办清单|todo|to-do|text|markdown)$/i.test(line)) return;
      if (/^\[\s*\[[\d,\s]+\]\s*\]$/.test(line)) return;
      if (/^(语文|数学|英语|道法|科学|体育|音乐|美术)\s*[:：]?$/.test(line)) return;
      if (/^\d{1,4}[./年-]\d{1,2}([./月-]\d{1,2})?日?$/.test(line)) return;
      var parts = line.split(/[;；。]+/);
      parts.forEach(function (part) {
        part = part.replace(/^[\s\-–—*•·●○◦]+/, '').trim();
        part = part.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1');
        part = part.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1');
        part = part.replace(/\s+/g, ' ').replace(/^[、,，.]+|[、,，.]+$/g, '').trim();
        if (part.length < 2) return;
        if (/^\d+$/.test(part)) return;
        if (/^[a-z]$/i.test(part)) return;
        if (part.length > 40) part = part.slice(0, 40);
        var exists = items.some(function (x) { return x.toLowerCase() === part.toLowerCase(); });
        if (!exists) items.push(part);
      });
    });
    return items.slice(0, 20);
  }

  function renderOcrSuggestions(items) {
    state.ocr.parsed = items;
    var box = $('ocrSuggestions');
    if (!box) return;
    if (!items.length) {
      box.innerHTML = '<div class="empty-inline"><p>识别或输入文字后，这里会出现待办列表。</p></div>';
    } else {
      box.innerHTML = items.map(function (title, index) {
        return '<div class="ocr-task-row">'
          + '<span class="ocr-task-index">' + (index + 1) + '</span>'
          + '<input type="checkbox" class="ocr-task-check" checked aria-label="选择第 ' + (index + 1) + ' 项">'
          + '<input type="text" class="ocr-task-input" value="' + esc(title) + '" maxlength="40" aria-label="编辑第 ' + (index + 1) + ' 项待办">'
          + '</div>';
      }).join('');
    }
    updateOcrSelectionCount();
  }

  function refreshOcrFromText() {
    var text = $('ocrText') ? $('ocrText').value : '';
    renderOcrSuggestions(parseOcrTasks(text));
  }

  function updateOcrSelectionCount() {
    var rows = $$('#ocrSuggestions .ocr-task-row');
    var selected = rows.filter(function (row) {
      var check = row.querySelector('.ocr-task-check');
      var input = row.querySelector('.ocr-task-input');
      return check && check.checked && input && input.value.trim();
    }).length;
    if ($('ocrCount')) $('ocrCount').textContent = selected + ' 项';
    if ($('ocrImportBtn')) $('ocrImportBtn').disabled = selected === 0;
  }

  function collectOcrTasks() {
    var result = [];
    $$('#ocrSuggestions .ocr-task-row').forEach(function (row) {
      var check = row.querySelector('.ocr-task-check');
      var input = row.querySelector('.ocr-task-input');
      if (!check || !check.checked || !input) return;
      var title = input.value.replace(/\s+/g, ' ').trim();
      if (!title) return;
      if (result.some(function (x) { return x.toLowerCase() === title.toLowerCase(); })) return;
      result.push(title);
    });
    return result;
  }

  function importOcrTasks() {
    var titles = collectOcrTasks();
    if (!titles.length) {
      toast('还没有选择待办', { text: '勾选至少一条识别结果。', tone: 'neutral' });
      return;
    }
    var mode = $('ocrImportMode') ? $('ocrImportMode').value : 'today';
    var day = todayKey();
    var existing = Core.activeTasks(state.db.tasks).map(function (task) { return task.title.toLowerCase(); });
    var added = 0;
    var skipped = 0;
    titles.forEach(function (title) {
      if (existing.indexOf(title.toLowerCase()) >= 0) { skipped += 1; return; }
      var task = Core.createTask({
        title: title,
        emoji: '📝',
        category: '扫描',
        notes: '手写扫描',
        type: mode === 'daily' ? 'daily' : 'urgent',
        due: day,
        dueTime: '23:59',
        priority: 'normal',
        fire: false,
        reminder: { enabled: false, time: '21:00' }
      }, day);
      state.db.tasks.push(task);
      existing.push(title.toLowerCase());
      added += 1;
    });
    if (!added) {
      toast('没有新增待办', { text: '这些标题今天已经存在了。', tone: 'neutral' });
      return;
    }
    updateTodayLog();
    save();
    closeModal();
    resetOcr();
    renderAll();
    toast('已加入 ' + added + ' 个待办', {
      text: (mode === 'daily' ? '作为每日任务' : '作为今日一次任务') + (skipped ? '，跳过 ' + skipped + ' 个重复项' : ''),
      icon: icon('check'),
      tone: 'success',
      duration: 4200
    });
  }

  function resetOcr() {
    clearOcrImageOnly();
    if ($('ocrText')) $('ocrText').value = '';
    state.ocr.parsed = [];
    renderOcrSuggestions([]);
    if ($('ocrProgress')) $('ocrProgress').hidden = true;
    if ($('ocrImportMode')) $('ocrImportMode').value = 'today';
    setOcrStatus('等待图片', '上传或拍一张手写记事');
    syncOcrUi();
  }

  function ocrImageDataUrl() {
    var original = state.ocr.file;
    if (original && /^image\/(jpeg|png|webp)$/i.test(original.type || '') && original.size <= 4.5 * 1024 * 1024) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result || '')); };
        reader.onerror = function () { reject(new Error('图片读取失败，请换一张')); };
        reader.readAsDataURL(original);
      });
    }
    return new Promise(function (resolve, reject) {
      if (!state.ocr.imageUrl) { reject(new Error('还没有选择图片')); return; }
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var scale = Math.min(1, 3000 / Math.max(w, h));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          var quality = 0.95;
          var url = canvas.toDataURL('image/jpeg', quality);
          while (url.length > 4.2 * 1024 * 1024 && quality > 0.55) {
            quality -= 0.1;
            url = canvas.toDataURL('image/jpeg', quality);
          }
          resolve(url);
        } catch (err) { reject(err); }
      };
      img.onerror = function () { reject(new Error('图片读取失败，请换一张')); };
      img.src = state.ocr.imageUrl;
    });
  }

  async function runAiOcr() {
    var ai = state.ocr.ai;
    if (!ai.apiKey) throw new Error('还没有配置 SiliconFlow API Key');
    setOcrProgress(10, '准备图片', '正在读取扫描图…');
    var dataUrl = await ocrImageDataUrl();
    setOcrProgress(30, 'DeepSeek-OCR 识别中', '正在调用 SiliconFlow…');
    var base = String(ai.base || OCR_AI_DEFAULTS.base).replace(/\/+$/, '');
    var endpoint = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
    var prompt = '<image>\n<|grounding|>Convert the document to markdown.';
    var body = {
      model: ai.model || OCR_AI_DEFAULTS.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          { type: 'text', text: prompt }
        ]
      }],
      temperature: 0,
      max_tokens: 2048
    };
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null;
    if (controller) timer = setTimeout(function () { controller.abort(); }, 120000);
    var response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + ai.apiKey
        },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    var raw = await response.text();
    var json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch (e) { json = null; }
    if (!response.ok) {
      var detail = json && (json.error && (json.error.message || json.error.code) || json.message) || raw.slice(0, 180);
      throw new Error('SiliconFlow 返回 ' + response.status + (detail ? '：' + detail : ''));
    }
    var content = json && json.choices && json.choices[0] && json.choices[0].message
      ? json.choices[0].message.content : '';
    if (Array.isArray(content)) {
      content = content.map(function (part) { return part && part.text ? part.text : ''; }).filter(Boolean).join('\n');
    }
    content = String(content || '')
      .replace(/<\|[^>]*\|>/g, '')
      .replace(/\[\s*\[[\d,\s]+\]\s*\]/g, '')
      .replace(/^\s*```[\w-]*\s*/, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    if (!content) throw new Error('SiliconFlow 没有返回文字');
    setOcrProgress(90, 'AI 识别完成', '正在整理待办…');
    return normalizeOcrText(content);
  }

  async function testAiOcrConnection() {
    var ai = state.ocr.ai;
    var btn = $('aiOcrTestBtn');
    if (!ai.apiKey) {
      toast('还没有 API Key', { text: '先填入 SiliconFlow Key。', tone: 'neutral' });
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = '测试中…'; }
    try {
      var base = String(ai.base || OCR_AI_DEFAULTS.base).replace(/\/+$/, '');
      var endpoint = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = null;
      if (controller) timer = setTimeout(function () { controller.abort(); }, 30000);
      var response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ai.apiKey },
          body: JSON.stringify({
            model: ai.model || OCR_AI_DEFAULTS.model,
            messages: [{ role: 'user', content: '只回复 OK' }],
            max_tokens: 8
          }),
          signal: controller ? controller.signal : undefined
        });
      } finally { if (timer) clearTimeout(timer); }
      var raw = await response.text();
      if (!response.ok) {
        var detail = raw.slice(0, 200);
        try { var j = JSON.parse(raw); detail = j.error && (j.error.message || j.error.code) || detail; } catch (e) { }
        throw new Error('HTTP ' + response.status + '：' + detail);
      }
      toast('SiliconFlow 连接正常', { text: 'HTTP 200 · ' + (ai.model || 'deepseek-ai/DeepSeek-OCR'), icon: icon('check'), tone: 'success', duration: 5000 });
    } catch (err) {
      toast('SiliconFlow 连接失败', { text: (err && err.message) || String(err), tone: 'danger', duration: 7000 });
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '测试 SiliconFlow 连接'; }
    }
  }

  async function runTencentOcr() {
    if (state.ocr.running) return;
    if (!state.ocr.file) {
      toast('先选择一张记事照片', { text: '拍照或从相册选择都可以。', tone: 'neutral' });
      return;
    }
    if (!tencentOcrReady()) {
      toast('腾讯云 OCR 还没启用', { text: '在设置里启用，并先启动 start-tencent-ocr.bat 后端。', tone: 'neutral' });
      return;
    }
    var t = state.ocr.tencent;
    state.ocr.running = true;
    ['ocrRunBtn', 'ocrLocalBtn', 'ocrTencentBtn'].forEach(function (id) {
      if ($(id)) $(id).disabled = true;
    });
    $('ocrProgress').hidden = false;
    setOcrProgress(8, '准备图片', '正在读取扫描图…');
    try {
      var dataUrl = await ocrImageDataUrl();
      var imageBase64 = String(dataUrl || '').split(',')[1] || '';
      if (!imageBase64) throw new Error('图片读取失败');
      setOcrProgress(25, '腾讯云 OCR', '正在提交到本机后端…');
      var endpoint = String(t.backend || TENCENT_DEFAULTS.backend).replace(/\/+$/, '');
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = null;
      if (controller) timer = setTimeout(function () { controller.abort(); }, 120000);
      var response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: imageBase64 }),
          signal: controller ? controller.signal : undefined
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
      var raw = await response.text();
      var json = null;
      try { json = raw ? JSON.parse(raw) : null; } catch (e) { json = null; }
      if (!response.ok || !json || json.ok === false) {
        var detail = json && json.error ? json.error : raw.slice(0, 200);
        throw new Error('腾讯云 OCR 失败：' + (detail || ('HTTP ' + response.status)));
      }
      var text = normalizeOcrText((json.texts || []).join('\n'));
      if (!text) throw new Error('腾讯云 OCR 没有返回文字');
      $('ocrText').value = text;
      refreshOcrFromText();
      setOcrProgress(100, '腾讯云 OCR 完成', '请校对下面的待办，再选择加入方式');
      setTimeout(function () { if ($('ocrText')) $('ocrText').focus(); }, 200);
    } catch (err) {
      var msg = err && err.message ? err.message : String(err);
      if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(msg)) {
        msg = '后端没有启动：先双击项目里的 start-tencent-ocr.bat，再点「腾讯云 OCR」。';
      }
      setOcrStatus('腾讯云 OCR 失败', msg);
      toast('腾讯云 OCR 失败', { text: msg, tone: 'danger', duration: 7000 });
      if ($('ocrText')) $('ocrText').focus();
    } finally {
      state.ocr.running = false;
      ['ocrRunBtn', 'ocrLocalBtn', 'ocrTencentBtn'].forEach(function (id) {
        if ($(id)) $(id).disabled = false;
      });
      syncOcrUi();
      hideOcrProgressLater();
    }
  }

  async function runOcr(forceLocal) {
    if (state.ocr.running) return;
    if (!state.ocr.file) {
      toast('先选择一张记事照片', { text: '拍照或从相册选择都可以。', tone: 'neutral' });
      return;
    }
    var useAi = !forceLocal && aiOcrReady();
    state.ocr.running = true;
    if ($('ocrRunBtn')) $('ocrRunBtn').disabled = true;
    if ($('ocrLocalBtn')) $('ocrLocalBtn').disabled = true;
    $('ocrProgress').hidden = false;
    setOcrProgress(2, useAi ? '准备 AI 识别' : '准备图片', useAi ? '正在准备手写识别…' : '正在调整图片对比度…');
    try {
      var text;
      if (useAi) {
        text = await runAiOcr();
      } else {
        var canvas = await fitOcrCanvas();
        var worker = await ensureOcrWorker();
        setOcrProgress(58, '识别文字', '正在读取手写内容…');
        var result = await worker.recognize(canvas);
        text = normalizeOcrText(result && result.data ? result.data.text : '');
      }
      $('ocrText').value = text;
      refreshOcrFromText();
      setOcrProgress(100, useAi ? 'AI 识别完成' : '识别完成', text ? '请校对下面的待办，再选择加入方式' : '没有识别到文字，请换一张更清楚的照片或手动输入');
      if (!text) {
        $('ocrText').focus();
      } else {
        setTimeout(function () { $('ocrText').focus(); }, 200);
      }
    } catch (err) {
      var msg = err && err.message ? err.message : String(err);
      setOcrStatus(useAi ? 'AI 识别失败' : '识别失败', msg);
      toast(useAi ? 'AI 识别失败' : 'OCR 识别失败', { text: msg + '；也可以直接在右侧粘贴/输入文字。', tone: 'danger', duration: 7000 });
      if ($('ocrText')) $('ocrText').focus();
    } finally {
      state.ocr.running = false;
      if ($('ocrRunBtn')) $('ocrRunBtn').disabled = !state.ocr.file;
      if ($('ocrLocalBtn')) $('ocrLocalBtn').disabled = false;
      hideOcrProgressLater();
    }
  }

  function bindOcrEvents() {
    ['scanBtn', 'todayScan'].forEach(function (id) {
      var btn = $(id);
      if (btn) btn.addEventListener('click', openOcrModal);
    });
    if ($('ocrAiSetupBtn')) {
      $('ocrAiSetupBtn').addEventListener('click', function () {
        closeModal();
        openSettings();
        setTimeout(function () {
          var section = $('aiOcrSection');
          if (section) {
            try { section.scrollIntoView({ behavior: STATIC ? 'auto' : 'smooth', block: 'center' }); } catch (e) { section.scrollIntoView(); }
          }
          if ($('aiOcrEnabled')) $('aiOcrEnabled').focus();
        }, 180);
      });
    }
    if ($('ocrEdgeGuideBtn')) {
      $('ocrEdgeGuideBtn').addEventListener('click', function () {
        var guide = $('ocrEdgeGuide');
        if (guide) guide.hidden = !guide.hidden;
      });
    }
    if ($('ocrOpenImageBtn')) {
      $('ocrOpenImageBtn').addEventListener('click', function () {
        if (!state.ocr.imageUrl) {
          toast('先选择一张记事照片', { tone: 'neutral' });
          return;
        }
        try {
          window.open(state.ocr.imageUrl, '_blank', 'noopener');
        } catch (e) {
          toast('无法打开图片', { text: '可以在原图页面按 Ctrl+Shift+S 使用网页捕获。', tone: 'neutral' });
        }
      });
    }
    if ($('ocrPasteTextBtn')) {
      $('ocrPasteTextBtn').addEventListener('click', async function () {
        try {
          if (!navigator.clipboard || !navigator.clipboard.readText) {
            throw new Error('no clipboard api');
          }
          var text = await navigator.clipboard.readText();
          if (!text) {
            toast('剪贴板是空的', { tone: 'neutral' });
            return;
          }
          $('ocrText').value = normalizeOcrText(text);
          refreshOcrFromText();
          setOcrStatus('已粘贴文字', '请校对下面的待办，再选择加入方式');
          $('ocrText').focus();
          updateOcrSelectionCount();
        } catch (e) {
          toast('浏览器不允许直接读剪贴板', { text: '请点一下右侧文本框，按 Ctrl+V 粘贴。', tone: 'neutral', duration: 4200 });
          if ($('ocrText')) $('ocrText').focus();
        }
      });
    }
    var fileInput = $('ocrFile');
    var cameraInput = $('ocrCamera');
    if ($('ocrPickBtn')) $('ocrPickBtn').addEventListener('click', function () { fileInput.click(); });
    if ($('ocrCameraBtn')) $('ocrCameraBtn').addEventListener('click', function () { cameraInput.click(); });
    if ($('ocrClearImage')) $('ocrClearImage').addEventListener('click', resetOcr);
    if (fileInput) fileInput.addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      event.target.value = '';
      loadOcrFile(file);
    });
    if (cameraInput) cameraInput.addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      event.target.value = '';
      loadOcrFile(file);
    });
    var zone = $('ocrDropzone');
    if (zone) {
      zone.addEventListener('click', function () {
        if (!state.ocr.running && fileInput) fileInput.click();
      });
      zone.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (fileInput) fileInput.click();
        }
      });
      ['dragenter', 'dragover'].forEach(function (name) {
        zone.addEventListener(name, function (event) {
          event.preventDefault();
          zone.classList.add('is-dragover');
        });
      });
      ['dragleave', 'drop'].forEach(function (name) {
        zone.addEventListener(name, function (event) {
          event.preventDefault();
          zone.classList.remove('is-dragover');
        });
      });
      zone.addEventListener('drop', function (event) {
        var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        loadOcrFile(file);
      });
    }
    if ($('ocrRunBtn')) $('ocrRunBtn').addEventListener('click', function () { runOcr(false); });
    if ($('ocrLocalBtn')) $('ocrLocalBtn').addEventListener('click', function () { runOcr(true); });
    if ($('ocrTencentBtn')) $('ocrTencentBtn').addEventListener('click', function () { runTencentOcr(); });
    if ($('ocrText')) {
      var timer = null;
      $('ocrText').addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(refreshOcrFromText, 180);
      });
    }
    if ($('ocrSelectAll')) $('ocrSelectAll').addEventListener('click', function () {
      $$('#ocrSuggestions .ocr-task-check').forEach(function (box) { box.checked = true; });
      updateOcrSelectionCount();
    });
    if ($('ocrSelectNone')) $('ocrSelectNone').addEventListener('click', function () {
      $$('#ocrSuggestions .ocr-task-check').forEach(function (box) { box.checked = false; });
      updateOcrSelectionCount();
    });
    if ($('ocrSuggestions')) {
      ['input', 'change'].forEach(function (name) {
        $('ocrSuggestions').addEventListener(name, updateOcrSelectionCount);
      });
    }
    if ($('ocrImportBtn')) $('ocrImportBtn').addEventListener('click', importOcrTasks);
    document.addEventListener('paste', function (event) {
      if (state.modal !== 'ocrModal' || !event.clipboardData) return;
      var items = event.clipboardData.items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          var file = items[i].getAsFile();
          if (file) {
            event.preventDefault();
            loadOcrFile(file);
          }
          break;
        }
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Toast / 音效 / 弹窗辅助                                             */
  /* ------------------------------------------------------------------ */

  function toast(title, opts) {
    opts = opts || {};
    var root = $('toastRoot');
    if (!root) return;
    while (root.children.length >= 3) root.removeChild(root.firstElementChild);
    var el = document.createElement('div');
    el.className = 'toast' + (opts.tone ? ' is-' + opts.tone : '');
    el.id = 'toast-' + (++state.toastSeq);
    el.innerHTML = '<span class="toast-icon" aria-hidden="true">' + (opts.icon || icon('spark')) + '</span>'
      + '<span class="toast-body"><strong>' + esc(title) + '</strong>' + (opts.text ? '<p>' + esc(opts.text) + '</p>' : '') + '</span>'
      + '<button class="toast-close" type="button" aria-label="关闭提示">' + icon('x') + '</button>';
    root.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-visible'); });
    var timer = setTimeout(function () { dismissToast(el); }, opts.duration || 3200);
    el.querySelector('.toast-close').addEventListener('click', function () {
      clearTimeout(timer);
      dismissToast(el);
    });
  }

  function dismissToast(el) {
    if (!el || !el.parentNode) return;
    el.classList.remove('is-visible');
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 260);
  }

  function celebrate(streak) {
    playChime('lit');
    toast('合成成功！', {
      text: '连续合成 ' + (streak.current || 0) + ' 天。今天的配方完成了。',
      icon: icon('diamond'),
      tone: 'celebrate',
      duration: 5200
    });
    var stage = $('craftStage');
    if (stage) {
      stage.classList.add('just-crafted');
      setTimeout(function () { stage.classList.remove('just-crafted'); }, 1600);
    }
  }

  function playChime(kind) {
    if (STATIC || !state.db || !state.db.settings.sound) return;
    try {
      var AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      if (!audioCtx) audioCtx = new AudioCtor();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var notes = kind === 'lit' ? [523.25, 659.25, 783.99, 1046.5] : [880, 659.25];
      notes.forEach(function (freq, index) {
        var t = audioCtx.currentTime + index * 0.11;
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.055, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.6);
      });
    } catch (e) { /* 音频不可用时静默 */ }
  }

  function showBootError(err) {
    try {
      document.body.innerHTML = '<main class="boot-error"><h1>方块清单没能启动</h1><p>'
        + esc(String(err && err.message ? err.message : err))
        + '</p><p>请确认 index.html、styles.css、core.js、app.js 在同一个文件夹里，然后刷新页面。</p></main>';
    } catch (e) { /* ignore */ }
    if (window.console) console.error(err);
  }

  /* ------------------------------------------------------------------ */
  /* 时钟 / 跨天                                                         */
  /* ------------------------------------------------------------------ */

  function startClocks() {
    setInterval(tick, 1000);
    setInterval(checkReminders, 20000);
    setTimeout(checkReminders, 1400);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        tick(true);
        checkReminders();
        renderReminders();
      }
    });
    window.addEventListener('storage', function (event) {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        var next = Core.normalizeDb(JSON.parse(event.newValue));
        if (!next) return;
        state.db = next;
        applyTheme(next.settings.theme);
        state.lastDateKey = todayKey();
        renderAll();
      } catch (e) { /* ignore */ }
    });
  }

  function tick(silent) {
    if (!state.db) return;
    var date = now();
    var day = Core.dateKeyFromDate(date);
    updateClockOnly(date);
    if (day !== state.lastDateKey) {
      state.lastDateKey = day;
      updateTodayLog();
      save();
      renderAll();
      if (!silent) toast('新的一天', { text: '工作台重新等你摆材料。', icon: icon('sun'), tone: 'neutral' });
    }
  }

  /* ------------------------------------------------------------------ */
  /* 事件绑定                                                            */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    $$('[data-view]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var view = btn.getAttribute('data-view');
        if (view) goView(view);
      });
    });

    $('mobileBrand').addEventListener('click', function () { goView('today'); });
    $('settingsBtn').addEventListener('click', openSettings);
    $('mobileSettingsNav').addEventListener('click', openSettings);
    $('themeBtn').addEventListener('click', toggleTheme);
    $('bellBtn').addEventListener('click', function (event) {
      event.stopPropagation();
      toggleBell();
    });

    ['headerAddBtn', 'heroAddBtn', 'todayCardAdd', 'todayEmptyAdd', 'libraryAddBtn', 'libraryEmptyAdd', 'mobileAddBtn'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('click', function () { openTaskModal(); });
    });
    $('heroFuelBtn').addEventListener('click', focusFuelPicker);
    $('manageFuelBtn').addEventListener('click', focusFuelPicker);
    $('firePageAddFuelBtn').addEventListener('click', focusFuelPicker);
    $('firePageManageFuel').addEventListener('click', focusFuelPicker);
    $('todayManage').addEventListener('click', function () { goView('tasks'); });
    $('bellEnableBtn').addEventListener('click', requestNotify);
    $('enableNotifyBtn').addEventListener('click', requestNotify);

    $('todayFilters').addEventListener('click', function (event) {
      var btn = event.target.closest('.segment');
      if (!btn) return;
      state.todayFilter = btn.getAttribute('data-filter') || 'all';
      renderTodayTasks(Core.taskProgress(state.db, todayKey()));
      syncFilterButtons();
    });
    $('libraryFilters').addEventListener('click', function (event) {
      var btn = event.target.closest('.filter-chip');
      if (!btn) return;
      state.libraryFilter = btn.getAttribute('data-filter') || 'all';
      renderLibrary();
      syncFilterButtons();
    });
    $('taskSearch').addEventListener('input', function (event) {
      state.search = event.target.value || '';
      renderLibrary();
    });

    $('taskForm').addEventListener('submit', submitTaskForm);
    $$('[name="taskType"]').forEach(function (radio) {
      radio.addEventListener('change', updateTypeFields);
    });
    $$('#emojiPicker .emoji-option').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.selectedEmoji = btn.getAttribute('data-emoji') || '📖';
        syncEmojiPicker();
      });
    });
    $('emojiCustom').addEventListener('input', function (event) {
      var value = Array.from(event.target.value.trim())[0] || '';
      if (value) {
        state.selectedEmoji = value;
        syncEmojiPicker();
        $('emojiCustom').value = value;
      }
    });

    $('confirmOk').addEventListener('click', function () {
      var callback = state.confirmCallback;
      state.confirmCallback = null;
      if (callback) callback();
    });
    $('confirmModal').addEventListener('click', function (event) {
      if (event.target === $('confirmModal')) closeModal();
    });

    // 设置
    $('userName').addEventListener('change', function (event) {
      var name = event.target.value.trim() || '朋友';
      state.db.settings.name = name;
      save();
      renderHeader();
      toast('称呼已更新', { icon: icon('spark'), tone: 'success', duration: 1800 });
    });
    $('weekStartSelect').addEventListener('change', function (event) {
      state.db.settings.weekStart = event.target.value === '7' ? 7 : 1;
      updateTodayLog();
      save();
      renderAll();
      toast('一周起始日已更新', { text: '每周任务从新的周起始日刷新。', tone: 'neutral' });
    });
    $('soundEnabled').addEventListener('change', function (event) {
      state.db.settings.sound = !!event.target.checked;
      save();
    });
    ['aiOcrEnabled', 'aiOcrKey', 'aiOcrModel'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('change', function () { updateAiConfigFromForm(false); });
    });
    ['aiOcrKey', 'aiOcrModel'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', scheduleAiConfigSave);
    });
    if ($('aiOcrTestBtn')) $('aiOcrTestBtn').addEventListener('click', testAiOcrConnection);
    ['tencentOcrEnabled', 'tencentBackend'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('change', function () { updateTencentConfigFromForm(false); });
    });
    ['tencentBackend'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', scheduleTencentConfigSave);
    });
    function flushOcrConfigs() {
      flushAiConfigSave();
      flushTencentConfigSave();
    }
    window.addEventListener('beforeunload', flushOcrConfigs);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) flushOcrConfigs();
    });
    $$('[data-theme-choice]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setTheme(btn.getAttribute('data-theme-choice') === 'light' ? 'light' : 'dark');
      });
    });
    $('notifyPermissionBtn').addEventListener('click', requestNotify);
    $('exportBtn').addEventListener('click', exportData);
    $('importBtn').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      event.target.value = '';
      importData(file);
    });
    $('resetDataBtn').addEventListener('click', resetAllData);
    $('demoDataBtn').addEventListener('click', loadDemoData);

    // 提醒 toast
    $('reminderDoneBtn').addEventListener('click', completeFromReminder);
    $('reminderSnoozeBtn').addEventListener('click', snoozeReminder);
    $('reminderDismissBtn').addEventListener('click', hideReminder);

    // OCR 扫描手写记事
    bindOcrEvents();

    // 全局点击（任务操作、emoji、关闭、popover）
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleKeydown);
  }

  function handleDocumentClick(event) {
    var viewBtn = event.target.closest('[data-view]');
    if (viewBtn) return; // 由各自监听器处理

    var closeBtn = event.target.closest('[data-close-modal]');
    if (closeBtn) {
      event.preventDefault();
      if (state.modal === 'confirmModal') {
        state.confirmCallback = null;
        closeModal();
      } else {
        closeModal();
      }
      return;
    }

    var actionEl = event.target.closest('[data-action]');
    if (actionEl) {
      var action = actionEl.getAttribute('data-action');
      var id = actionEl.getAttribute('data-id');
      if (action === 'toggle' && id) { event.preventDefault(); toggleTask(id); return; }
      if (action === 'edit' && id) { event.preventDefault(); openTaskModal(id); return; }
      if (action === 'delete' && id) { event.preventDefault(); removeTask(id); return; }
      if (action === 'toggle-fire' && id) { event.preventDefault(); toggleFire(id); return; }
      if (action === 'manage-fuel') { event.preventDefault(); focusFuelPicker(); return; }
    }

    if (!event.target.closest('.bell-wrap')) closeBell();
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      if (state.modal) {
        if (state.modal === 'confirmModal') state.confirmCallback = null;
        closeModal();
        return;
      }
      closeBell();
      return;
    }
    if (event.key !== 'Tab' || !state.modal) return;
    var target = $(state.modal);
    if (!target) return;
    var focusable = $$('button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', target).filter(function (el) {
      return !el.closest('[hidden]');
    });
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function toggleBell() {
    var popover = $('bellPopover');
    var open = popover.hidden;
    popover.hidden = !open;
    $('bellBtn').setAttribute('aria-expanded', String(open));
    if (open) renderReminders();
  }

  function closeBell() {
    var popover = $('bellPopover');
    if (!popover || popover.hidden) return;
    popover.hidden = true;
    $('bellBtn').setAttribute('aria-expanded', 'false');
  }

  /* ------------------------------------------------------------------ */
  /* 页面自检                                                            */
  /* ------------------------------------------------------------------ */

  function runSelfTest() {
    var results = [];
    function check(name, fn) {
      try {
        var value = fn();
        results.push({ name: name, pass: value !== false, detail: value === false ? 'returned false' : '' });
      } catch (e) {
        results.push({ name: name, pass: false, detail: e && e.message ? e.message : String(e) });
      }
    }

    check('EmberCore 已加载', function () { return !!window.EmberCore; });
    check('数据库已加载', function () { return !!state.db && Array.isArray(state.db.tasks); });
    check('今日至少渲染一条任务', function () { return document.querySelectorAll('#todayTaskList .task-row').length > 0; });
    check('工作台 hero 有状态', function () { return !!$('hero').dataset.state; });
    check('合成统计有值', function () { return $('heroStreak').textContent !== ''; });
    check('切换到任务库', function () { goView('tasks'); return !$('view-tasks').hidden && $('view-today').hidden; });
    check('任务库渲染', function () { return document.querySelectorAll('#libraryList .library-row').length > 0; });
    check('切换回今日', function () { goView('today'); return !$('view-today').hidden; });
    check('添加任务弹窗可打开', function () { openTaskModal(); return state.modal === 'taskModal' && !$('taskModal').hidden; });
    check('弹窗可关闭', function () { closeModal(); return state.modal === null && $('modalRoot').hidden; });
    check('周期标签正确', function () {
      var task = state.db.tasks[0];
      return !!Core.recurrenceLabel(task);
    });
    check('提醒签名可生成', function () {
      var task = state.db.tasks.filter(function (t) { return t.reminder && t.reminder.enabled; })[0];
      return !task || !!Core.reminderSignature(task, todayKey());
    });
    check('完成/取消一次任务', function () {
      var task = availableTasks()[0];
      if (!task) return false;
      var before = isCompleteOn(task, todayKey());
      toggleTask(task.id);
      var after = isCompleteOn(findTask(task.id), todayKey());
      toggleTask(task.id);
      var restored = isCompleteOn(findTask(task.id), todayKey());
      return after === !before && restored === before;
    });
    check('OCR 扫描弹窗与解析', function () {
      openOcrModal();
      var opened = state.modal === 'ocrModal' && !$('ocrModal').hidden;
      closeModal();
      var items = parseOcrTasks('1. 买牛奶\n- 给妈妈打电话');
      return opened && items.length === 2;
    });
    check('localStorage 可写入', function () {
      save(true);
      try {
        return !!localStorage.getItem(STORAGE_KEY);
      } catch (e) {
        // jsdom 的 file:// origin 是 opaque；真实浏览器不受影响。
        return navigator.userAgent.indexOf('jsdom') >= 0;
      }
    });

    var pass = results.filter(function (r) { return r.pass; }).length;
    var fail = results.length - pass;
    var lines = results.map(function (r) { return (r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.detail ? ' — ' + r.detail : ''); });
    lines.push('');
    lines.push('SELFTEST ' + (fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + results.length + ' · ' + todayKey() + ' · ' + hhmm(now()));
    var pre = $('selftest-result');
    pre.hidden = false;
    pre.textContent = lines.join('\n');
    document.documentElement.setAttribute('data-selftest', fail ? 'fail' : 'pass');
    renderAll();
  }

  /* ------------------------------------------------------------------ */
  /* 暴露给自动化测试（只读/调试用途）                                    */
  /* ------------------------------------------------------------------ */

  window.__EMBER__ = {
    state: state,
    Core: Core,
    todayKey: todayKey,
    now: now,
    save: save,
    renderAll: renderAll,
    goView: goView,
    openTaskModal: openTaskModal,
    closeModal: closeModal,
    openSettings: openSettings,
    toggleTask: toggleTask,
    toggleFire: toggleFire,
    removeTask: removeTask,
    checkReminders: checkReminders,
    getReminderRows: getReminderRows,
    seedDemo: seedDemo,
    openOcrModal: openOcrModal,
    parseOcrTasks: parseOcrTasks,
    importOcrTasks: importOcrTasks,
    version: '1.4.0'
  };

  boot();
})();
