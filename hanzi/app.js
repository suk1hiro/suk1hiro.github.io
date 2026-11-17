(function () {
  var DATA = window.CHAR_DATA || { books: [] };
  var HANZI = window.HANZI_DATA || {};
  var STORE_KEY = 'hanzi.progress.v1';
  var DICT_KEY = 'hanzi.dictation.v1';
  var DICT_SET_KEY = 'hanzi.dictation.settings.v1';

  var gradeSel = document.getElementById('gradeSel');
  var volTabs = document.getElementById('volTabs');
  var searchEl = document.getElementById('search');
  var onlyUndoneEl = document.getElementById('onlyUndone');
  var progressEl = document.getElementById('progress');
  var contentEl = document.getElementById('content');

  var overlay = document.getElementById('overlay');
  var closeBtn = document.getElementById('closeBtn');
  var mChar = document.getElementById('mChar');
  var mPinyin = document.getElementById('mPinyin');
  var mMeta = document.getElementById('mMeta');
  var writerBox = document.getElementById('writerBox');
  var animBtn = document.getElementById('animBtn');
  var quizBtn = document.getElementById('quizBtn');
  var resetBtn = document.getElementById('resetBtn');
  var speakBtn = document.getElementById('speakBtn');
  var dictateBtn = document.getElementById('dictateBtn');
  var mHint = document.getElementById('mHint');
  var mFeedback = document.getElementById('mFeedback');
  var mSubmit = document.getElementById('mSubmit');
  var prevBtn = document.getElementById('prevBtn');
  var nextBtn = document.getElementById('nextBtn');
  var posLabel = document.getElementById('posLabel');

  var progress = loadProgress();
  var dictStats = loadDictStats();
  var state = { grade: 1, volume: 'up', query: '', onlyUndone: false };
  var currentList = [];
  var currentIndex = -1;
  var writer = null;
  // 弹窗上下文：当前展示的字与所属册（回看模式 modalBook 为 null，不写进度）
  var modalItem = null;
  var modalBook = null;
  var modalMode = 'trace'; // 'trace' 描红 | 'dictate' 默写
  var modalMisses = 0;
  var modalDone = false;
  var modalFreeWriter = null;
  var modalSpeakTimer = null;

  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveProgress() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) {}
  }
  function loadDictStats() {
    try { return JSON.parse(localStorage.getItem(DICT_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveDictStats() {
    try { localStorage.setItem(DICT_KEY, JSON.stringify(dictStats)); } catch (e) {}
  }
  // 记录一次默写结果：pass=true 记通过，否则记未通过；mistakes 为累计错笔数
  function recordDictation(key, pass, mistakes) {
    if (!key) return;
    var rec = dictStats[key] || { p: 0, f: 0, m: 0, t: 0 };
    if (pass) rec.p++; else rec.f++;
    rec.m += mistakes || 0;
    rec.t = Date.now();
    dictStats[key] = rec;
    saveDictStats();
  }

  // 默写判定方式设置：on = 逐笔判定（边写边判），off = 写完提交（自由书写）
  function loadDictSettings() {
    try { return JSON.parse(localStorage.getItem(DICT_SET_KEY)) || {}; }
    catch (e) { return {}; }
  }
  var dictSettings = loadDictSettings();
  function saveDictSettings() {
    try { localStorage.setItem(DICT_SET_KEY, JSON.stringify(dictSettings)); } catch (e) {}
  }
  function strokeCheckMode() {
    return dictSettings.strokeCheck === 'off' ? 'off' : 'on';
  }
  function keyOf(book, ch) { return book.label + '|' + ch; }

  function booksFor(grade) {
    return DATA.books.filter(function (b) { return b.grade === grade; });
  }
  function currentBook() {
    var list = booksFor(state.grade);
    for (var i = 0; i < list.length; i++) {
      if (list[i].volume === state.volume) return list[i];
    }
    return list[0];
  }

  function buildGradeSelect() {
    var grades = [];
    DATA.books.forEach(function (b) {
      if (grades.indexOf(b.grade) < 0) grades.push(b.grade);
    });
    grades.sort(function (a, b) { return a - b; });
    gradeSel.innerHTML = '';
    grades.forEach(function (g) {
      var o = document.createElement('option');
      o.value = g;
      o.textContent = g + ' 年级';
      gradeSel.appendChild(o);
    });
    gradeSel.value = String(state.grade);
  }

  function buildVolTabs() {
    var list = booksFor(state.grade);
    volTabs.innerHTML = '';
    list.forEach(function (b) {
      var btn = document.createElement('button');
      btn.textContent = b.volume === 'up' ? '上册' : '下册';
      btn.className = b.volume === state.volume ? 'on' : '';
      btn.onclick = function () {
        state.volume = b.volume;
        buildVolTabs();
        render();
      };
      volTabs.appendChild(btn);
    });
  }

  function flatten(book) {
    var out = [];
    book.units.forEach(function (u) {
      u.lessons.forEach(function (l) {
        l.chars.forEach(function (c) {
          out.push({ c: c.c, p: c.p, unit: u.name, lesson: l.title });
        });
      });
    });
    return out;
  }

  function matches(item) {
    if (state.onlyUndone && progress[keyOf(currentBook(), item.c)]) return false;
    if (state.query) {
      var q = state.query.toLowerCase();
      var hit = item.c.indexOf(state.query) >= 0 ||
        (item.p && item.p.toLowerCase().indexOf(q) >= 0);
      if (!hit) return false;
    }
    return true;
  }

  function makeCard(book, it, index) {
    var card = document.createElement('div');
    card.className = 'card' + (progress[keyOf(book, it.c)] ? ' done' : '');
    var py = document.createElement('div');
    py.className = 'py';
    py.textContent = it.p || '';
    var tian = document.createElement('div');
    tian.className = 'tian';
    var zi = document.createElement('div');
    zi.className = 'zi';
    zi.textContent = it.c;
    tian.appendChild(zi);
    var badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = '✓';
    card.appendChild(py);
    card.appendChild(tian);
    card.appendChild(badge);
    card.onclick = function () { openChar(index); };
    return card;
  }

  function render() {
    var book = currentBook();
    if (!book) {
      contentEl.innerHTML = '<div class="empty">暂无数据</div>';
      return;
    }
    currentList = flatten(book).filter(matches);
    contentEl.innerHTML = '';

    if (!currentList.length) {
      contentEl.innerHTML = '<div class="empty">没有符合条件的字</div>';
      updateProgress();
      return;
    }

    var order = [];
    var groups = {};
    currentList.forEach(function (item, i) {
      if (!groups[item.unit]) { groups[item.unit] = {}; order.push(item.unit); }
      var g = groups[item.unit];
      if (!g[item.lesson]) g[item.lesson] = [];
      g[item.lesson].push({ it: item, index: i });
    });

    order.forEach(function (uname) {
      var section = document.createElement('section');
      section.className = 'unit';
      var h2 = document.createElement('h2');
      h2.textContent = uname;
      section.appendChild(h2);

      var lessons = groups[uname];
      Object.keys(lessons).forEach(function (lname) {
        var ldiv = document.createElement('div');
        ldiv.className = 'lesson';
        var h3 = document.createElement('h3');
        h3.textContent = lname;
        ldiv.appendChild(h3);
        var grid = document.createElement('div');
        grid.className = 'grid';
        lessons[lname].forEach(function (entry) {
          grid.appendChild(makeCard(book, entry.it, entry.index));
        });
        ldiv.appendChild(grid);
        section.appendChild(ldiv);
      });
      contentEl.appendChild(section);
    });
    updateProgress();
  }

  function updateProgress() {
    var book = currentBook();
    if (!book) { progressEl.textContent = ''; return; }
    var all = flatten(book);
    var done = all.filter(function (it) { return progress[keyOf(book, it.c)]; }).length;
    progressEl.textContent = '本册已练 ' + done + ' / ' + all.length;
  }

  function openChar(index) {
    if (index < 0 || index >= currentList.length) return;
    currentIndex = index;
    var it = currentList[index];
    modalItem = it;
    modalBook = currentBook();
    setModalMode('trace');
    posLabel.textContent = (index + 1) + ' / ' + currentList.length;
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= currentList.length - 1;
    overlay.classList.remove('hidden');
  }

  // 成绩页回看：只展示字形与笔顺，不写进度、不记统计
  function reviewChar(it) {
    if (!it) return;
    currentIndex = -1;
    modalItem = it;
    modalBook = null;
    setModalMode('trace');
    posLabel.textContent = '回看';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    overlay.classList.remove('hidden');
  }

  function setModalFeedback(text, cls) {
    if (!text) {
      mFeedback.classList.add('hidden');
      mFeedback.textContent = '';
      return;
    }
    mFeedback.className = 'dfb' + (cls ? ' ' + cls : '');
    mFeedback.textContent = text;
  }

  // 弹窗模式切换：trace 描红 / dictate 默写。切换即重建 writer，避免 quiz 状态残留
  function setModalMode(mode) {
    modalMode = mode;
    modalMisses = 0;
    modalDone = false;
    modalFreeWriter = null;
    if (modalSpeakTimer) { clearTimeout(modalSpeakTimer); modalSpeakTimer = null; }
    var it = modalItem;
    if (!it) return;
    var rec = HANZI[it.c] || {};
    if (mode === 'dictate') {
      mChar.textContent = '？';
      mChar.classList.add('masked');
      mMeta.textContent = [it.unit || '', it.lesson || ''].filter(Boolean).join(' · ');
      mHint.classList.remove('hidden');
      fillHints(mHint, it, it.p || '', rec.wordPinyin || null);
      animBtn.classList.add('hidden');
      quizBtn.classList.add('hidden');
      dictateBtn.textContent = '退出默写';
      setModalFeedback('');
      if (strokeCheckMode() === 'off') {
        // 写完提交：自由书写，点“提交检查”后整字比对（不要求笔顺）
        mSubmit.classList.remove('hidden');
        modalFreeWriter = createFreeWriter(writerBox);
      } else {
        mSubmit.classList.add('hidden');
        createDictWriter(it.c, {
          onMistake: function (d) {
            modalMisses++;
            setModalFeedback('第 ' + (d.strokeNum + 1) + ' 笔不对，请重写', 'bad');
          },
          onComplete: function () {
            setModalFeedback('写对了！', 'good');
            if (modalBook && modalItem) {
              markDone();
              recordDictation(keyOf(modalBook, modalItem.c), true, modalMisses);
            }
          }
        });
      }
      cancelSpeech();
      var hints = hintsFor(it.c, it.p || '');
      if (hints.length) {
        modalSpeakTimer = setTimeout(function () { speakHints(it.c, hints, true); }, 220);
      }
    } else {
      mChar.textContent = it.c;
      mChar.classList.remove('masked');
      mMeta.textContent = [it.unit || '', it.lesson || '',
        rec.strokeCount ? rec.strokeCount + '画' : ''].filter(Boolean).join(' · ');
      mHint.classList.add('hidden');
      mSubmit.classList.add('hidden');
      animBtn.classList.remove('hidden');
      quizBtn.classList.remove('hidden');
      dictateBtn.textContent = '默写';
      setModalFeedback('');
      createWriter(it.c);
    }
  }

  // 弹窗提交检查：整字比对笔迹与标准笔画
  function submitModalFree() {
    var it = modalItem;
    if (!it || modalMode !== 'dictate' || modalDone || !modalFreeWriter) return;
    var res = evaluateFreeStrokes(it.c, modalFreeWriter.strokes);
    if (!res.targetCount) {
      setModalFeedback('暂无笔顺数据，无法判定', 'bad');
      return;
    }
    if (res.ok) {
      modalDone = true;
      setModalFeedback('写对了！', 'good');
      if (modalBook) {
        markDone();
        recordDictation(keyOf(modalBook, it.c), true, 0);
      }
      // 揭晓：切换到描红视图播放标准笔顺
      setTimeout(function () {
        if (modalItem === it && modalMode === 'dictate') setModalMode('trace');
      }, 900);
    } else if (res.userCount !== res.targetCount) {
      setModalFeedback('笔画数不对：应 ' + res.targetCount + ' 画，写了 ' + res.userCount + ' 画', 'bad');
    } else {
      setModalFeedback('有 ' + res.badCount + ' 笔不对，请修改后重新提交', 'bad');
    }
  }

  // 统一 writer 工厂：共享配置 + 调用方显式覆盖，未传入的选项保留库默认值
  function makeWriter(target, ch, opts) {
    opts = opts || {};
    var base = {
      width: 300,
      height: 300,
      padding: 6,
      showOutline: true,
      showCharacter: false,
      strokeColor: '#2b6cb0',
      radicalColor: '#2b6cb0',
      outlineColor: '#f2b8b8',
      strokeAnimationSpeed: 1,
      delayBetweenStrokes: 220,
      charDataLoader: function (c, onComplete, onError) {
        var d = HANZI[c];
        if (d && d.strokes) {
          onComplete({ strokes: d.strokes, medians: d.medians, radStrokes: d.radStrokes });
        } else {
          onError(new Error('缺少字形数据：' + c));
        }
      }
    };
    Object.keys(opts).forEach(function (k) { base[k] = opts[k]; });
    return HanziWriter.create(target, ch, base);
  }

  // 默写判定参数：宽松模式，无轮廓提示；位置容错提高、允许倒笔顺，
  // 同一笔错 3 次后自动判对并继续（仍计入错笔统计）
  var DICT_QUIZ_OPTS = {
    showOutline: false,
    showCharacter: false,
    acceptBackwardsStrokes: true,
    showHintAfterMisses: 0,
    markStrokeCorrectAfterMisses: 3,
    highlightOnComplete: true,
    leniency: 2
  };

  function createWriter(ch) {
    writer = null;
    writerBox.innerHTML = '';
    var target = document.createElement('div');
    writerBox.appendChild(target);
    writer = makeWriter(target, ch, {
      drawingColor: '#e11d48',
      drawingWidth: 28,
      highlightColor: '#4ade80'
    });
    writer.animateCharacter();
  }

  // 默写 writer：无字形、无轮廓，只有田字格；创建后立即进入严格 quiz
  function createDictWriter(ch, handlers) {
    writer = null;
    writerBox.innerHTML = '';
    var target = document.createElement('div');
    writerBox.appendChild(target);
    writer = makeWriter(target, ch, {
      showOutline: false,
      drawingColor: '#e11d48',
      drawingWidth: 28
    });
    startDictQuiz(writer, handlers);
  }

  function startDictQuiz(w, handlers) {
    handlers = handlers || {};
    var quizOpts = {};
    Object.keys(DICT_QUIZ_OPTS).forEach(function (k) { quizOpts[k] = DICT_QUIZ_OPTS[k]; });
    quizOpts.onMistake = handlers.onMistake || function () {};
    quizOpts.onCorrectStroke = handlers.onCorrectStroke || function () {};
    quizOpts.onComplete = handlers.onComplete || function () {};
    w.quiz(quizOpts);
  }

  /* ---------- 自由书写（写完提交）模式 ---------- */

  var FREE_SAMPLE_N = 24;       // 笔画重采样点数
  var FREE_MATCH_THRESH = 0.20; // DTW 匹配阈值（标定：正确书写 ≤0.16，错误书写 ≥0.24）
  var FREE_MIN_LEN = 0.06;      // 有效笔画最短折线长度（忽略误触小点）

  // 在田字格容器内挂一块透明画布采集手写笔迹，返回句柄
  function createFreeWriter(box) {
    box.innerHTML = '';
    var canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 300;
    canvas.className = 'freecanvas';
    box.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var strokes = [];
    var cur = null;
    var drawing = false;

    function pt(e) {
      var r = canvas.getBoundingClientRect();
      return [
        Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
      ];
    }
    function dot(p) {
      ctx.fillStyle = '#e11d48';
      ctx.beginPath();
      ctx.arc(p[0] * 300, p[1] * 300, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    function lineTo(p) {
      var last = cur[cur.length - 1];
      ctx.strokeStyle = '#e11d48';
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(last[0] * 300, last[1] * 300);
      ctx.lineTo(p[0] * 300, p[1] * 300);
      ctx.stroke();
    }
    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) {} }
      drawing = true;
      cur = [pt(e)];
      dot(cur[0]);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var p = pt(e);
      lineTo(p);
      cur.push(p);
    });
    function finish() {
      if (!drawing) return;
      drawing = false;
      if (cur && cur.length) strokes.push(cur);
      cur = null;
    }
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    // 注意：不监听 pointerleave——已捕获指针，移出画布（写到田字格边缘）不应断笔

    return {
      strokes: strokes,
      clear: function () {
        strokes.length = 0;
        cur = null;
        drawing = false;
        ctx.clearRect(0, 0, 300, 300);
      }
    };
  }

  // 折线等弧长重采样为 n 个点
  function resamplePts(pts, n) {
    if (!pts.length) return [];
    var out = [pts[0].slice()];
    var segs = [], total = 0, i;
    for (i = 1; i < pts.length; i++) {
      var dx = pts[i][0] - pts[i - 1][0];
      var dy = pts[i][1] - pts[i - 1][1];
      var d = Math.sqrt(dx * dx + dy * dy);
      segs.push(d);
      total += d;
    }
    if (total === 0) {
      for (i = 1; i < n; i++) out.push(pts[0].slice());
      return out;
    }
    var step = total / (n - 1);
    var need = step; // 距下一个采样点还差的弧长
    for (i = 1; i < pts.length && out.length < n; i++) {
      var d2 = segs[i - 1]; // 本段全长
      var walked = 0;       // 段内已走弧长
      while (need <= d2 - walked && out.length < n) {
        var t = (walked + need) / d2;
        out.push([
          pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
          pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t
        ]);
        walked += need;
        need = step;
      }
      need -= (d2 - walked);
    }
    while (out.length < n) out.push(pts[pts.length - 1].slice());
    return out;
  }

  // 计算多笔笔迹的整体包围盒（用于整字归一化）
  function strokesUnionBBox(strokes) {
    var x0 = 1, x1 = 0, y0 = 1, y1 = 0;
    strokes.forEach(function (pts) {
      for (var i = 0; i < pts.length; i++) {
        if (pts[i][0] < x0) x0 = pts[i][0];
        if (pts[i][0] > x1) x1 = pts[i][0];
        if (pts[i][1] < y0) y0 = pts[i][1];
        if (pts[i][1] > y1) y1 = pts[i][1];
      }
    });
    if (x1 < x0) return { cx: 0.5, cy: 0.5, d: 1 };
    return {
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
      d: Math.max(0.001, Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)))
    };
  }

  // DTW 弹性对齐平均距离：容忍起笔收笔伸缩与书写快慢不均
  // 返回累计代价 / 路径长度（归一化坐标下的平均距离）
  function dtwDist(a, b) {
    var n = a.length, m = b.length, i, j;
    var INF = 1e9;
    var prev = new Array(m + 1), curr = new Array(m + 1), tmp;
    prev[0] = 0;
    for (j = 1; j <= m; j++) prev[j] = INF;
    for (i = 1; i <= n; i++) {
      curr[0] = INF;
      for (j = 1; j <= m; j++) {
        var dx = a[i - 1][0] - b[j - 1][0];
        var dy = a[i - 1][1] - b[j - 1][1];
        var c = Math.sqrt(dx * dx + dy * dy);
        var best = prev[j];                 // a 走一步
        if (curr[j - 1] < best) best = curr[j - 1]; // b 走一步
        if (prev[j - 1] < best) best = prev[j - 1]; // 两者各走一步
        curr[j] = c + best;
      }
      tmp = prev; prev = curr; curr = tmp;
    }
    return prev[m] / n;
  }

  // 笔画相似度：整字归一化后做 DTW 弹性比对，
  // 取正向/反向（起笔端可不同）较小者
  function strokeScore(u, m) {
    var n = u.length, i, rev = [];
    for (i = n - 1; i >= 0; i--) rev.push(u[i]);
    return Math.min(dtwDist(u, m), dtwDist(rev, m));
  }

  // 计算笔画折线总长（归一化坐标）
  function pathLength(pts) {
    var len = 0, i;
    for (i = 1; i < pts.length; i++) {
      var dx = pts[i][0] - pts[i - 1][0];
      var dy = pts[i][1] - pts[i - 1][1];
      len += Math.sqrt(dx * dx + dy * dy);
    }
    return len;
  }

  // 评估自由书写：与标准笔画贪心最近匹配（不要求笔顺顺序）
  // medians 为 0–1024 坐标系的折线中点序列；过短的笔迹（误触/抖动）忽略
  // 先做整字归一化（用户笔迹整体平移缩放到标准字形包围盒），再逐笔弹性比对
  function evaluateFreeStrokes(ch, strokes) {
    var rec = HANZI[ch] || {};
    var medians = rec.medians || [];
    var users = [];
    strokes.forEach(function (s) {
      if (pathLength(s) >= FREE_MIN_LEN) {
        users.push(resamplePts(s, FREE_SAMPLE_N));
      }
    });
    var targets = medians.map(function (m) {
      // medians 数据为 y 向上坐标系（0–1024），与画布 y 向下方向相反，需翻转
      return resamplePts(m.map(function (p) { return [p[0] / 1024, 1 - p[1] / 1024]; }), FREE_SAMPLE_N);
    });
    // 整字归一化：用户整体包围盒 → 目标整体包围盒（统一平移 + 均匀缩放）
    if (users.length && targets.length) {
      var bu = strokesUnionBBox(users);
      var bt = strokesUnionBBox(targets);
      var s = bt.d / bu.d;
      users = users.map(function (u) {
        return u.map(function (p) {
          return [bt.cx + (p[0] - bu.cx) * s, bt.cy + (p[1] - bu.cy) * s];
        });
      });
    }
    var pairs = [], i, j;
    for (i = 0; i < users.length; i++) {
      for (j = 0; j < targets.length; j++) {
        pairs.push({ u: i, m: j, s: strokeScore(users[i], targets[j]) });
      }
    }
    pairs.sort(function (a, b) { return a.s - b.s; });
    var usedU = {}, usedM = {}, matched = 0, badU = {};
    pairs.forEach(function (p) {
      if (usedU[p.u] || usedM[p.m]) return;
      if (p.s > FREE_MATCH_THRESH) return;
      usedU[p.u] = true;
      usedM[p.m] = true;
      matched++;
    });
    for (i = 0; i < users.length; i++) if (!usedU[i]) badU[i] = true;
    return {
      ok: medians.length > 0 && users.length === medians.length && matched === medians.length,
      userCount: users.length,
      targetCount: medians.length,
      badCount: Object.keys(badU).length
    };
  }

  function markDone() {
    if (!modalItem || !modalBook) return;
    progress[keyOf(modalBook, modalItem.c)] = true;
    saveProgress();
    updateProgress();
    if (currentIndex >= 0) {
      var cards = contentEl.querySelectorAll('.card');
      if (cards[currentIndex]) cards[currentIndex].classList.add('done');
    }
  }

  function closeModal() {
    overlay.classList.add('hidden');
    if (writer) { try { writer.cancelQuiz(); } catch (e) {} }
    if (modalSpeakTimer) { clearTimeout(modalSpeakTimer); modalSpeakTimer = null; }
    cancelSpeech();
    modalItem = null;
    modalBook = null;
    modalMode = 'trace';
  }

  animBtn.onclick = function () {
    if (writer && modalMode === 'trace') writer.animateCharacter();
  };
  resetBtn.onclick = function () {
    if (!modalItem) return;
    if (modalMode === 'dictate') setModalMode('dictate');
    else createWriter(modalItem.c);
  };
  dictateBtn.onclick = function () {
    if (!modalItem) return;
    setModalMode(modalMode === 'dictate' ? 'trace' : 'dictate');
  };
  mSubmit.onclick = submitModalFree;
  quizBtn.onclick = function () {
    if (!writer) return;
    writer.quiz({
      showHintAfterMisses: 2,
      highlightOnComplete: true,
      onComplete: function () { markDone(); }
    });
  };
  speakBtn.onclick = function () {
    var it = modalItem;
    if (!it) return;
    var rec = HANZI[it.c] || {};
    cancelSpeech();
    if (modalMode === 'dictate') {
      // 默写中朗读只读提示词，不读目标字，避免泄露
      var hints = hintsFor(it.c, it.p || '');
      if (hints.length) speakHints(it.c, hints, true);
      return;
    }
    if (rec.wordPinyin) {
      var one = pickHintWords(rec.words, it.c, 1, rec.wordPinyin, it.p || '');
      if (one.length) { speak(one[0]); return; }
    }
    speak(it.c);
  };
  prevBtn.onclick = function () { openChar(currentIndex - 1); };
  nextBtn.onclick = function () { openChar(currentIndex + 1); };
  closeBtn.onclick = closeModal;
  overlay.onclick = function (e) { if (e.target === overlay) closeModal(); };
  document.addEventListener('keydown', function (e) {
    if (!overlay.classList.contains('hidden')) {
      if (e.key === 'Escape') closeModal();
      if (currentIndex >= 0) {
        if (e.key === 'ArrowLeft') openChar(currentIndex - 1);
        if (e.key === 'ArrowRight') openChar(currentIndex + 1);
      }
      return;
    }
    if (!dictView.classList.contains('hidden')) {
      if (e.key === 'Escape') backFromDict();
      if (!dictQuiz.classList.contains('hidden') && e.key === 'Enter' &&
          e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT' &&
          e.target.tagName !== 'INPUT') {
        e.preventDefault();
        dNext.click();
      }
      return;
    }
    if (testView.classList.contains('hidden')) return;
    if (testQuiz.classList.contains('hidden')) {
      if (e.key === 'Escape') backToMain();
      return;
    }
    if (e.key === 'ArrowLeft') testPrev.click();
    if (e.key === 'ArrowRight') testNext.click();
    if ((e.key === ' ' || e.key === 'Enter') &&
        e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT' &&
        e.target.tagName !== 'INPUT') {
      e.preventDefault();
      flipCard();
    }
    if (e.key === 'Escape') exitTest();
  });

  // 统一设置年级：同步顶部下拉、册切换与主列表（测试/默写设置页共用）
  function applyGrade(g) {
    state.grade = g;
    var list = booksFor(state.grade);
    var has = list.some(function (b) { return b.volume === state.volume; });
    if (!has && list.length) state.volume = list[0].volume;
    gradeSel.value = String(state.grade);
    buildVolTabs();
    render();
  }

  gradeSel.onchange = function () {
    applyGrade(parseInt(gradeSel.value, 10));
  };
  searchEl.oninput = function () { state.query = searchEl.value.trim(); render(); };
  onlyUndoneEl.onchange = function () { state.onlyUndone = onlyUndoneEl.checked; render(); };

  /* ---------- 测试模式 · 拼音闪卡 ---------- */

  var testBtn = document.getElementById('testBtn');
  var testView = document.getElementById('testView');
  var testSetup = document.getElementById('testSetup');
  var testQuiz = document.getElementById('testQuiz');
  var testGrade = document.getElementById('testGrade');
  var testScope = document.getElementById('testScope');
  var testOrder = document.getElementById('testOrder');
  var unitList = document.getElementById('unitList');
  var startTestBtn = document.getElementById('startTest');
  var testBackBtn = document.getElementById('testBack');
  var testPos = document.getElementById('testPos');
  var flashCard = document.getElementById('flashCard');
  var fcPinyin = document.getElementById('fcPinyin');
  var fcHint = document.getElementById('fcHint');
  var fcReplay = document.getElementById('fcReplay');
  var fcChar = document.getElementById('fcChar');
  var fcMeta = document.getElementById('fcMeta');
  var fcWriter = document.getElementById('fcWriter');
  var testPrev = document.getElementById('testPrev');
  var testNext = document.getElementById('testNext');
  var testExit = document.getElementById('testExit');

  var testState = { grade: 1, cards: [], index: 0, flipped: false, writer: null, speakTimer: null };
  // grade -> { scope: 'unit'|'lesson', sel: { key: bool } }
  var testUnitSel = {};

  function testGrades() {
    var grades = [];
    DATA.books.forEach(function (b) {
      if (grades.indexOf(b.grade) < 0) grades.push(b.grade);
    });
    return grades.sort(function (a, b) { return a - b; });
  }

  function buildTestGradeSelect() {
    testGrade.innerHTML = '';
    testGrades().forEach(function (g) {
      var o = document.createElement('option');
      o.value = g;
      o.textContent = g + ' 年级';
      testGrade.appendChild(o);
    });
    testGrade.value = String(testState.grade);
  }

  /* ---------- 通用范围勾选（单元 / 课文两级，测试与默写共用） ---------- */

  // 取某年级在指定范围下已保存的选择；范围或年级变化时返回空（即默认全不选）
  function scopeState(selMap, grade, scope) {
    var rec = selMap[grade];
    return (rec && rec.scope === scope && rec.sel) ? rec.sel : {};
  }

  function saveScopeSel(el, selMap, grade, scope) {
    var sel = {};
    el.querySelectorAll('input[type=checkbox][data-leaf]').forEach(function (cb) {
      sel[cb.getAttribute('data-unit')] = cb.checked;
    });
    selMap[grade] = { scope: scope, sel: sel };
  }

  function countLeafChecked(el) {
    return el.querySelectorAll('input[type=checkbox][data-leaf]:checked').length;
  }

  // 单元标题行复选框：批量勾选/取消该单元下的全部课文
  function applyHeadToggle(el, headCb) {
    var unitKey = headCb.getAttribute('data-unit');
    var cbs = el.querySelectorAll('input[type=checkbox][data-leaf]');
    for (var i = 0; i < cbs.length; i++) {
      var key = cbs[i].getAttribute('data-unit') || '';
      if (key.indexOf(unitKey + '|') === 0) cbs[i].checked = headCb.checked;
    }
  }

  function isHeadCheckbox(t) {
    return !!(t && t.parentElement &&
      t.parentElement.classList &&
      t.parentElement.classList.contains('head'));
  }

  // 通用勾选列表渲染（测试模式与默写模式共用）
  function renderUnitListInto(el, grade, selMap, scope) {
    var saved = scopeState(selMap, grade, scope);
    var books = booksFor(grade);
    el.innerHTML = '';
    if (!books.length) {
      el.innerHTML = '<div class="empty">该年级暂无数据</div>';
      return false;
    }
    books.forEach(function (b) {
      var tag = b.volume === 'up' ? '上' : '下';
      b.units.forEach(function (u) {
        var unitKey = u.name + '|' + b.volume;
        if (scope === 'lesson') {
          var head = document.createElement('label');
          head.className = 'uitem head';
          var hcb = document.createElement('input');
          hcb.type = 'checkbox';
          hcb.setAttribute('data-unit', unitKey);
          var lessons = u.lessons || [];
          hcb.checked = lessons.length > 0 && lessons.every(function (l) {
            return !!saved[unitKey + '|' + l.no];
          });
          var hname = document.createElement('span');
          hname.textContent = u.name + '（' + tag + '）';
          head.appendChild(hcb);
          head.appendChild(hname);
          el.appendChild(head);
          lessons.forEach(function (l) {
            var key = unitKey + '|' + l.no;
            var lab = document.createElement('label');
            lab.className = 'uitem lesson';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.setAttribute('data-unit', key);
            cb.setAttribute('data-leaf', '1');
            cb.checked = !!saved[key];
            var name = document.createElement('span');
            name.textContent = l.no === l.title ? l.title : l.no + ' ' + l.title;
            lab.appendChild(cb);
            lab.appendChild(name);
            el.appendChild(lab);
          });
        } else {
          var lab = document.createElement('label');
          lab.className = 'uitem';
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.setAttribute('data-unit', unitKey);
          cb.setAttribute('data-leaf', '1');
          cb.checked = !!saved[unitKey];
          var name = document.createElement('span');
          name.textContent = u.name + '（' + tag + '）';
          lab.appendChild(cb);
          lab.appendChild(name);
          el.appendChild(lab);
        }
      });
    });
    return true;
  }

  function renderUnitList() {
    renderUnitListInto(unitList, testState.grade, testUnitSel, testScope.value);
    updateStartState();
  }

  function updateStartState() {
    startTestBtn.disabled = !countLeafChecked(unitList);
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function collectTestCards(grade, selectedKeys, scope) {
    var selected = {};
    selectedKeys.forEach(function (k) { selected[k] = true; });
    var seen = {};
    var out = [];
    booksFor(grade).forEach(function (b) {
      b.units.forEach(function (u) {
        u.lessons.forEach(function (l) {
          if (scope === 'lesson') {
            if (!selected[u.name + '|' + b.volume + '|' + l.no]) return;
          } else if (!selected[u.name + '|' + b.volume]) return;
          l.chars.forEach(function (c) {
            if (seen[c.c]) return;
            seen[c.c] = true;
            out.push({ c: c.c, p: c.p, unit: u.name + '（' + (b.volume === 'up' ? '上' : '下') + '）', lesson: l.title, book: b.label });
          });
        });
      });
    });
    return out;
  }

  function enterTestMode() {
    testState.grade = state.grade;
    buildTestGradeSelect();
    renderUnitList();
    testSetup.classList.remove('hidden');
    testQuiz.classList.add('hidden');
    contentEl.classList.add('hidden');
    testView.classList.remove('hidden');
  }

  function backToMain() {
    cancelSpeech();
    destroyTestWriter();
    testView.classList.add('hidden');
    contentEl.classList.remove('hidden');
  }

  function exitTest() {
    cancelSpeech();
    destroyTestWriter();
    testQuiz.classList.add('hidden');
    testSetup.classList.remove('hidden');
  }

  function startTest() {
    var selected = [];
    unitList.querySelectorAll('input[type=checkbox][data-leaf]:checked').forEach(function (cb) {
      selected.push(cb.getAttribute('data-unit'));
    });
    var cards = collectTestCards(testState.grade, selected, testScope.value);
    if (!cards.length) return;
    if (testOrder.value === 'random') shuffle(cards);
    testState.cards = cards;
    testState.index = 0;
    testSetup.classList.add('hidden');
    testQuiz.classList.remove('hidden');
    renderTestCard();
  }

  function destroyTestWriter() {
    if (testState.writer) {
      try { testState.writer.cancelQuiz(); } catch (e) {}
      testState.writer = null;
    }
    fcWriter.innerHTML = '';
  }

  function cancelSpeech() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (testState.speakTimer) {
      clearTimeout(testState.speakTimer);
      testState.speakTimer = null;
    }
  }

  var preferredZhVoice = null;
  var ZH_VOICE_PREFS = [
    'xiaoxiao', 'yaoyao', 'huihui', 'kangkang', 'hanhan',
    'yating', 'meijia', 'tingting', 'hiujin', 'tracy', 'sinji'
  ];

  function refreshZhVoice() {
    if (!('speechSynthesis' in window)) return;
    var voices = speechSynthesis.getVoices();
    if (!voices || !voices.length) return;
    var scored = voices.map(function (v) {
      var lang = (v.lang || '').toLowerCase();
      var name = (v.name || '').toLowerCase();
      var score = 0;
      if (lang.indexOf('zh') === 0) score += 100;
      if (name.indexOf('neural') >= 0 || name.indexOf('natural') >= 0) score += 80;
      ZH_VOICE_PREFS.forEach(function (p, i) {
        if (name.indexOf(p) >= 0) score += 1000 - i * 10;
      });
      return { voice: v, score: score };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    if (scored[0] && scored[0].score > 0) preferredZhVoice = scored[0].voice;
  }

  if ('speechSynthesis' in window && 'onvoiceschanged' in speechSynthesis) {
    speechSynthesis.onvoiceschanged = refreshZhVoice;
  }
  refreshZhVoice();

  function pickZhVoice() {
    if (!('speechSynthesis' in window)) return null;
    if (!preferredZhVoice) refreshZhVoice();
    return preferredZhVoice;
  }

  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 0.85;
    var voice = pickZhVoice();
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  }

  function maskWord(word, ch, py) {
    if (!py) return word;
    return word.split(ch).join(py);
  }

  function normPinyin(s) {
    if (!s) return '';
    return String(s).toLowerCase().replace(/u:/g, 'ü').replace(/v/g, 'ü').replace(/\s+/g, '');
  }

  // 取某字的默写提示词（按常用度、读音过滤）
  function hintsFor(ch, py) {
    var rec = HANZI[ch] || {};
    return pickHintWords(rec.words, ch, 3, rec.wordPinyin || null, py);
  }

  // 通用提示词渲染（默写模式 / 批量默写共用，不依赖闪卡容器）
  function fillHints(el, it, py, wordPinyin) {
    var hints = hintsFor(it.c, py);
    el.innerHTML = '';
    if (!hints || !hints.length) {
      var empty = document.createElement('div');
      empty.className = 'hint-empty';
      empty.textContent = '暂无提示词';
      el.appendChild(empty);
      return;
    }
    var title = document.createElement('div');
    title.className = 'hint-title';
    title.textContent = '提示';
    el.appendChild(title);
    hints.forEach(function (w) {
      var wpy = (wordPinyin && wordPinyin[w]) ? wordPinyin[w] : py;
      var span = document.createElement('span');
      span.className = 'hint-word';
      span.textContent = maskWord(w, it.c, wpy);
      el.appendChild(span);
    });
  }

  function pickHintWords(words, ch, n, wordPinyin, targetPinyin) {
    if (!words || !words.length) return [];
    var valid = words.filter(function (w) { return typeof w === 'string' && w.indexOf(ch) >= 0; });

    // For polyphonic characters, keep only words that use the target reading.
    if (wordPinyin && targetPinyin) {
      var target = normPinyin(targetPinyin);
      var matched = valid.filter(function (w) {
        var wp = wordPinyin[w];
        return wp && normPinyin(wp) === target;
      });
      if (matched.length) valid = matched;
    }

    if (valid.length <= n) return valid.slice();

    // Data is already ranked by commonness. Prefer 2-character words,
    // then fall back to longer words/phrases in the same ranking order.
    var twoChar = valid.filter(function (w) { return w.length === 2; });
    var longer = valid.filter(function (w) { return w.length !== 2; });
    var out = twoChar.slice(0, n);
    if (out.length < n) {
      out = out.concat(longer.slice(0, n - out.length));
    }
    return out;
  }

  function speakHints(char, hints, skipChar) {
    cancelSpeech();
    var text = '';
    if (hints && hints.length) {
      text = hints.join('，');
      if (!skipChar) text = char + '，' + text;
    } else {
      text = char || '';
    }
    speak(text);
  }

  function renderHint(it, hints, py, wordPinyin) {
    fcHint.innerHTML = '';
    if (!hints || !hints.length) {
      fcHint.className = 'fc-hint empty';
      fcHint.textContent = '暂无提示词';
      return;
    }
    fcHint.className = 'fc-hint';
    var title = document.createElement('div');
    title.className = 'fc-hint-title';
    title.textContent = '提示';
    fcHint.appendChild(title);
    hints.forEach(function (w) {
      var wpy = (wordPinyin && wordPinyin[w]) ? wordPinyin[w] : py;
      var span = document.createElement('span');
      span.className = 'fc-word';
      span.textContent = maskWord(w, it.c, wpy);
      fcHint.appendChild(span);
    });
  }

  function renderTestCard() {
    cancelSpeech();
    destroyTestWriter();
    var it = testState.cards[testState.index];
    if (!it) return;
    testState.flipped = false;
    // Reset the flip without animating the next card in from the back face.
    var inner = flashCard.querySelector('.flash-inner');
    if (inner) {
      inner.style.transition = 'none';
      flashCard.classList.remove('flipped');
      void inner.offsetWidth;
      inner.style.transition = '';
    } else {
      flashCard.classList.remove('flipped');
    }
    fcPinyin.textContent = it.p || '暂无拼音';
    fcChar.textContent = it.c;
    var rec = HANZI[it.c] || {};
    fcMeta.textContent = [it.p || '', it.unit || '', it.lesson || '',
      rec.strokeCount ? rec.strokeCount + '画' : ''].filter(Boolean).join(' · ');
    var py = it.p || '';
    var wordPinyin = rec.wordPinyin || null;
    var isPolyphonic = !!wordPinyin;
    var hints = pickHintWords(rec.words, it.c, 3, wordPinyin, py);
    renderHint(it, hints, py, wordPinyin);
    testPos.textContent = (testState.index + 1) + ' / ' + testState.cards.length;
    testPrev.disabled = testState.index <= 0;
    testNext.disabled = testState.index >= testState.cards.length - 1;
    fcReplay.disabled = !('speechSynthesis' in window) || !hints.length;
    testState.speakTimer = setTimeout(function () {
      speakHints(it.c, hints, isPolyphonic);
    }, 220);
  }

  function playTestWriter() {
    destroyTestWriter();
    var it = testState.cards[testState.index];
    var rec = it && HANZI[it.c];
    if (!rec || !rec.strokes) {
      fcWriter.innerHTML = '<div class="fc-fallback">暂无笔顺</div>';
      if (window.console && console.warn) console.warn('缺少字形数据：' + (it && it.c));
      return;
    }
    var target = document.createElement('div');
    fcWriter.appendChild(target);
    testState.writer = makeWriter(target, it.c, {
      width: 156,
      height: 156,
      padding: 4,
      delayBetweenStrokes: 200
    });
    testState.writer.animateCharacter();
  }

  function flipCard() {
    if (!testState.cards.length) return;
    testState.flipped = !testState.flipped;
    flashCard.classList.toggle('flipped', testState.flipped);
    if (testState.flipped) {
      cancelSpeech();
      playTestWriter();
    }
  }

  testBtn.onclick = enterTestMode;
  testBackBtn.onclick = backToMain;
  testExit.onclick = exitTest;
  startTestBtn.onclick = startTest;
  testGrade.onchange = function () {
    testState.grade = parseInt(testGrade.value, 10);
    applyGrade(testState.grade); // 同步顶部主界面年级
    renderUnitList();
  };
  unitList.addEventListener('change', function (e) {
    if (isHeadCheckbox(e.target)) applyHeadToggle(unitList, e.target);
    saveScopeSel(unitList, testUnitSel, testState.grade, testScope.value);
    updateStartState();
  });
  testScope.onchange = renderUnitList;
  flashCard.onclick = flipCard;
  fcReplay.onclick = function (e) {
    e.stopPropagation();
    var it = testState.cards[testState.index];
    if (!it) return;
    var rec = HANZI[it.c] || {};
    var py = it.p || '';
    var wordPinyin = rec.wordPinyin || null;
    var hints = pickHintWords(rec.words, it.c, 3, wordPinyin, py);
    speakHints(it.c, hints, !!wordPinyin);
  };
  testPrev.onclick = function () {
    if (testState.index > 0) { testState.index--; renderTestCard(); }
  };
  testNext.onclick = function () {
    if (testState.index < testState.cards.length - 1) { testState.index++; renderTestCard(); }
  };

  /* ---------- 默写模式 · 田字格听写 ---------- */

  var dictBtn = document.getElementById('dictationBtn');
  var dictView = document.getElementById('dictationView');
  var dictSet = document.getElementById('dictSet');
  var dictQuiz = document.getElementById('dictQuiz');
  var dictResult = document.getElementById('dictResult');
  var dictGrade = document.getElementById('dictGrade');
  var dictScope = document.getElementById('dictScope');
  var dictOrder = document.getElementById('dictOrder');
  var dictStrokeCheck = document.getElementById('dictStrokeCheck');
  var dictUnitList = document.getElementById('dictUnitList');
  var startDictBtn = document.getElementById('startDict');
  var dictBackBtn = document.getElementById('dictBack');
  var dictPosEl = document.getElementById('dictPos');
  var dictMissEl = document.getElementById('dictMiss');
  var dPinyin = document.getElementById('dPinyin');
  var dHint = document.getElementById('dHint');
  var dSpeak = document.getElementById('dSpeak');
  var dWriter = document.getElementById('dWriter');
  var dFeedback = document.getElementById('dFeedback');
  var dPrev = document.getElementById('dPrev');
  var dReset = document.getElementById('dReset');
  var dSubmit = document.getElementById('dSubmit');
  var dSkip = document.getElementById('dSkip');
  var dNext = document.getElementById('dNext');
  var dAccuracy = document.getElementById('dAccuracy');
  var dStats = document.getElementById('dStats');
  var dMissedWrap = document.getElementById('dMissedWrap');
  var dMissed = document.getElementById('dMissed');
  var dictAgainBtn = document.getElementById('dictAgain');
  var dictExitBtn = document.getElementById('dictExit');

  var dictState = {
    grade: 1, cards: [], index: 0, writer: null,
    misses: 0, done: false, speakTimer: null, advanceTimer: null
  };
  // grade -> { scope: 'unit'|'lesson', sel: { key: bool } }
  var dictUnitSel = {};

  function destroyDictWriter() {
    if (dictState.writer) {
      try { dictState.writer.cancelQuiz(); } catch (e) {}
      dictState.writer = null;
    }
    dictState.freeWriter = null;
    dWriter.innerHTML = '';
    dWriter.classList.remove('miss', 'pass');
  }

  function clearDictTimers() {
    if (dictState.speakTimer) { clearTimeout(dictState.speakTimer); dictState.speakTimer = null; }
    if (dictState.advanceTimer) { clearTimeout(dictState.advanceTimer); dictState.advanceTimer = null; }
  }

  function showDictPhase(p) {
    dictSet.classList.toggle('hidden', p !== 'setup');
    dictQuiz.classList.toggle('hidden', p !== 'quiz');
    dictResult.classList.toggle('hidden', p !== 'result');
  }

  function enterDictation() {
    cancelSpeech();
    dictState.grade = state.grade;
    dictGrade.innerHTML = '';
    testGrades().forEach(function (g) {
      var o = document.createElement('option');
      o.value = g;
      o.textContent = g + ' 年级';
      dictGrade.appendChild(o);
    });
    dictGrade.value = String(dictState.grade);
    buildDictUnitList();
    showDictPhase('setup');
    contentEl.classList.add('hidden');
    testView.classList.add('hidden');
    dictView.classList.remove('hidden');
  }

  function backFromDict() {
    cancelSpeech();
    destroyDictWriter();
    clearDictTimers();
    dictView.classList.add('hidden');
    contentEl.classList.remove('hidden');
  }

  function buildDictUnitList() {
    renderUnitListInto(dictUnitList, dictState.grade, dictUnitSel, dictScope.value);
    updateDictStartState();
  }

  function updateDictStartState() {
    startDictBtn.disabled = !countLeafChecked(dictUnitList);
  }

  function startDictation() {
    var selected = [];
    dictUnitList.querySelectorAll('input[type=checkbox][data-leaf]:checked').forEach(function (cb) {
      selected.push(cb.getAttribute('data-unit'));
    });
    var picked = collectTestCards(dictState.grade, selected, dictScope.value);
    if (!picked.length) return;
    if (dictOrder.value === 'random') shuffle(picked);
    dictState.cards = picked.map(function (c) {
      return {
        c: c.c, p: c.p, unit: c.unit, lesson: c.lesson, book: c.book,
        status: 'pending', mistakes: 0
      };
    });
    dictState.index = 0;
    showDictPhase('quiz');
    renderDictCard();
  }

  function setDictFeedback(text, cls) {
    if (!text) {
      dFeedback.classList.add('hidden');
      dFeedback.textContent = '';
      return;
    }
    dFeedback.className = 'dfb' + (cls ? ' ' + cls : '');
    dFeedback.textContent = text;
  }

  function dictStatusText(it) {
    if (it.status === 'first') return '已一次通过，可再练一遍';
    if (it.status === 'corrected') return '已通过（有错笔），可再练一遍';
    return '上次未通过';
  }

  function renderDictCard() {
    cancelSpeech();
    destroyDictWriter();
    clearDictTimers();
    var it = dictState.cards[dictState.index];
    if (!it) { showDictResult(); return; }
    dictState.misses = 0;
    dictState.done = false;
    dPinyin.textContent = it.p || '（无拼音）';
    fillHints(dHint, it, it.p || '', (HANZI[it.c] || {}).wordPinyin || null);
    dictPosEl.textContent = (dictState.index + 1) + ' / ' + dictState.cards.length;
    dictMissEl.textContent = '错笔 0';
    dPrev.disabled = dictState.index <= 0;
    dNext.textContent = dictState.index >= dictState.cards.length - 1 ? '查看成绩 →' : '下一字 →';
    var hints = hintsFor(it.c, it.p || '');
    dSpeak.disabled = !('speechSynthesis' in window) || !hints.length;
    setDictFeedback(it.status === 'pending' ? '' : dictStatusText(it), '');
    if (strokeCheckMode() === 'off') {
      dSubmit.classList.remove('hidden');
      mountFreeDict(it);
    } else {
      dSubmit.classList.add('hidden');
      mountDictWriter(it);
    }
    if (hints.length) {
      dictState.speakTimer = setTimeout(function () {
        speakHints(it.c, hints, true);
      }, 220);
    }
  }

  function mountDictWriter(it) {
    destroyDictWriter();
    clearDictTimers();
    dictState.misses = 0;
    dictState.done = false;
    dictMissEl.textContent = '错笔 0';
    var rec = HANZI[it.c] || {};
    if (!rec.strokes) {
      dWriter.innerHTML = '<div class="fc-fallback">暂无笔顺，请跳过</div>';
      if (window.console && console.warn) console.warn('缺少字形数据：' + it.c);
      return;
    }
    var target = document.createElement('div');
    dWriter.appendChild(target);
    dictState.writer = makeWriter(target, it.c, {
      showOutline: false,
      drawingColor: '#e11d48',
      drawingWidth: 28
    });
    startDictQuiz(dictState.writer, {
      onMistake: function (d) {
        dictState.misses++;
        dictMissEl.textContent = '错笔 ' + dictState.misses;
        setDictFeedback('第 ' + (d.strokeNum + 1) + ' 笔不对，请重写', 'bad');
        flashDictMiss();
      },
      onComplete: function () { onDictComplete(it); }
    });
  }

  function flashDictMiss() {
    dWriter.classList.add('miss');
    setTimeout(function () { dWriter.classList.remove('miss'); }, 420);
  }

  // 写完提交模式：挂载自由书写画布
  function mountFreeDict(it) {
    destroyDictWriter();
    clearDictTimers();
    dictState.misses = 0;
    dictState.done = false;
    dictMissEl.textContent = '错笔 0';
    var rec = HANZI[it.c] || {};
    if (!rec.medians || !rec.medians.length) {
      dWriter.innerHTML = '<div class="fc-fallback">暂无笔顺，请跳过</div>';
      return;
    }
    dictState.freeWriter = createFreeWriter(dWriter);
  }

  // 写完提交模式：揭晓标准字形（按笔顺动画展示）
  function revealDictChar(it) {
    destroyDictWriter();
    var target = document.createElement('div');
    dWriter.appendChild(target);
    dictState.writer = makeWriter(target, it.c, {
      showOutline: false,
      showCharacter: true,
      drawingColor: '#e11d48',
      drawingWidth: 28
    });
    try { dictState.writer.animateCharacter(); } catch (e) {}
  }

  // 写完提交模式：整字比对
  function submitFreeDict(it) {
    if (dictState.done || !dictState.freeWriter) return;
    var res = evaluateFreeStrokes(it.c, dictState.freeWriter.strokes);
    if (!res.targetCount) {
      setDictFeedback('暂无笔顺数据，无法判定', 'bad');
      return;
    }
    if (res.ok) {
      dictState.done = true;
      dictState.misses = 0;
      dictMissEl.textContent = '错笔 0';
      dWriter.classList.add('pass');
      setDictFeedback('写对了！', 'good');
      if (it.status === 'pending') {
        it.status = 'first';
        it.mistakes = 0;
        recordDictation(it.book + '|' + it.c, true, 0);
        markCardDone(it);
      }
      revealDictChar(it);
      clearDictTimers();
      dictState.advanceTimer = setTimeout(nextDictChar, 1100);
    } else {
      var msg;
      if (res.userCount !== res.targetCount) {
        msg = '笔画数不对：应 ' + res.targetCount + ' 画，写了 ' + res.userCount + ' 画';
      } else {
        msg = '有 ' + res.badCount + ' 笔不对，请修改后重新提交';
      }
      dictState.misses = res.userCount !== res.targetCount
        ? Math.abs(res.userCount - res.targetCount)
        : res.badCount;
      dictMissEl.textContent = '错笔 ' + dictState.misses;
      setDictFeedback(msg, 'bad');
      flashDictMiss();
      if (it.status === 'pending') {
        it.status = 'corrected';
        recordDictation(it.book + '|' + it.c, false, res.badCount);
      }
    }
  }

  function markCardDone(it) {
    if (!it) return;
    progress[it.book + '|' + it.c] = true;
    saveProgress();
    updateProgress();
  }

  function onDictComplete(it) {
    dictState.done = true;
    dWriter.classList.add('pass');
    setDictFeedback('写对了！', 'good');
    if (it.status === 'pending') {
      it.status = dictState.misses === 0 ? 'first' : 'corrected';
      it.mistakes = dictState.misses;
      recordDictation(it.book + '|' + it.c, true, dictState.misses);
      markCardDone(it);
    }
    // 揭晓：按笔顺展示标准字形
    if (dictState.writer) {
      try { dictState.writer.showCharacter(); } catch (e) {}
    }
    clearDictTimers();
    dictState.advanceTimer = setTimeout(nextDictChar, 900);
  }

  function skipDictChar(reveal) {
    var it = dictState.cards[dictState.index];
    if (!it || dictState.done) return;
    dictState.done = true;
    clearDictTimers();
    if (it.status === 'pending') {
      it.status = 'skipped';
      recordDictation(it.book + '|' + it.c, false, dictState.misses);
    }
    if (reveal) {
      if (dictState.freeWriter || !dictState.writer) revealDictChar(it);
      else { try { dictState.writer.showCharacter(); } catch (e) {} }
    }
    setDictFeedback(reveal ? '未通过，可看笔顺后继续' : '未通过', 'bad');
    dictState.advanceTimer = setTimeout(nextDictChar, reveal ? 1400 : 600);
  }

  function nextDictChar() {
    if (dictState.index < dictState.cards.length - 1) {
      dictState.index++;
      renderDictCard();
    } else {
      showDictResult();
    }
  }

  function showDictResult() {
    cancelSpeech();
    destroyDictWriter();
    clearDictTimers();
    var cards = dictState.cards;
    var first = 0, corrected = 0, skipped = 0;
    cards.forEach(function (c) {
      if (c.status === 'first') first++;
      else if (c.status === 'corrected') corrected++;
      else skipped++;
    });
    var passed = first + corrected;
    var acc = cards.length ? Math.round(passed * 100 / cards.length) : 0;
    dAccuracy.textContent = acc + '%';
    dAccuracy.className = 'd-accuracy' + (acc >= 80 ? ' good' : (acc < 60 ? ' low' : ''));
    dStats.innerHTML = '';
    var blocks = [
      ['一次通过', first, 'first'],
      ['纠正后通过', corrected, 'corrected'],
      ['未通过', skipped, 'skipped']
    ];
    blocks.forEach(function (b) {
      var div = document.createElement('div');
      div.className = 'd-stat ' + b[2];
      var num = document.createElement('div');
      num.className = 'd-stat-num';
      num.textContent = b[1];
      var label = document.createElement('div');
      label.className = 'd-stat-label';
      label.textContent = b[0];
      div.appendChild(num);
      div.appendChild(label);
      dStats.appendChild(div);
    });
    dMissed.innerHTML = '';
    var missed = cards.filter(function (c) { return c.status === 'skipped'; });
    dMissedWrap.classList.toggle('hidden', !missed.length);
    missed.forEach(function (c) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'd-missed-item';
      var zi = document.createElement('span');
      zi.className = 'd-missed-zi';
      zi.textContent = c.c;
      var py = document.createElement('span');
      py.className = 'd-missed-py';
      py.textContent = c.p || '';
      item.appendChild(zi);
      item.appendChild(py);
      item.onclick = function () { reviewChar(c); };
      dMissed.appendChild(item);
    });
    showDictPhase('result');
  }

  dictBtn.onclick = enterDictation;
  dictBackBtn.onclick = backFromDict;
  dictExitBtn.onclick = backFromDict;
  startDictBtn.onclick = startDictation;
  dictAgainBtn.onclick = function () {
    showDictPhase('setup');
    buildDictUnitList();
  };
  dictGrade.onchange = function () {
    dictState.grade = parseInt(dictGrade.value, 10);
    applyGrade(dictState.grade); // 同步顶部主界面年级
    buildDictUnitList();
  };
  dictUnitList.addEventListener('change', function (e) {
    if (isHeadCheckbox(e.target)) applyHeadToggle(dictUnitList, e.target);
    saveScopeSel(dictUnitList, dictUnitSel, dictState.grade, dictScope.value);
    updateDictStartState();
  });
  dictScope.onchange = buildDictUnitList;
  dictStrokeCheck.value = strokeCheckMode();
  dictStrokeCheck.onchange = function () {
    dictSettings.strokeCheck = dictStrokeCheck.value;
    saveDictSettings();
  };
  dSpeak.onclick = function () {
    var it = dictState.cards[dictState.index];
    if (!it) return;
    cancelSpeech();
    var hints = hintsFor(it.c, it.p || '');
    if (hints.length) speakHints(it.c, hints, true);
  };
  dReset.onclick = function () {
    var it = dictState.cards[dictState.index];
    if (!it || dictState.done) return;
    setDictFeedback('');
    if (strokeCheckMode() === 'off') mountFreeDict(it);
    else mountDictWriter(it);
  };
  dSubmit.onclick = function () {
    var it = dictState.cards[dictState.index];
    if (it) submitFreeDict(it);
  };
  dSkip.onclick = function () { skipDictChar(true); };
  dNext.onclick = function () {
    if (dictState.done) nextDictChar();
    else skipDictChar(false);
  };
  dPrev.onclick = function () {
    if (dictState.index > 0) { dictState.index--; renderDictCard(); }
  };

  buildGradeSelect();
  buildVolTabs();
  render();
})();