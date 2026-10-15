(function () {
  var DATA = window.CHAR_DATA || { books: [] };
  var HANZI = window.HANZI_DATA || {};
  var STORE_KEY = 'hanzi.progress.v1';

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
  var prevBtn = document.getElementById('prevBtn');
  var nextBtn = document.getElementById('nextBtn');
  var posLabel = document.getElementById('posLabel');

  var progress = loadProgress();
  var state = { grade: 1, volume: 'up', query: '', onlyUndone: false };
  var currentList = [];
  var currentIndex = -1;
  var writer = null;

  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveProgress() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) {}
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
    var rec = HANZI[it.c] || {};
    mChar.textContent = it.c;
    mPinyin.textContent = it.p || '';
    mMeta.textContent = [it.unit || '', it.lesson || '',
      rec.strokeCount ? rec.strokeCount + '画' : ''].filter(Boolean).join(' · ');
    createWriter(it.c);
    posLabel.textContent = (index + 1) + ' / ' + currentList.length;
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= currentList.length - 1;
    overlay.classList.remove('hidden');
  }

  function createWriter(ch) {
    writer = null;
    writerBox.innerHTML = '';
    var target = document.createElement('div');
    writerBox.appendChild(target);
    writer = HanziWriter.create(target, ch, {
      width: 300,
      height: 300,
      padding: 6,
      showOutline: true,
      showCharacter: false,
      strokeColor: '#2b6cb0',
      radicalColor: '#2b6cb0',
      outlineColor: '#f2b8b8',
      drawingColor: '#e11d48',
      drawingWidth: 28,
      highlightColor: '#4ade80',
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
    });
    writer.animateCharacter();
  }

  function markDone() {
    var it = currentList[currentIndex];
    if (!it) return;
    progress[keyOf(currentBook(), it.c)] = true;
    saveProgress();
    updateProgress();
    var cards = contentEl.querySelectorAll('.card');
    if (cards[currentIndex]) cards[currentIndex].classList.add('done');
  }

  function closeModal() {
    overlay.classList.add('hidden');
    if (writer) { try { writer.cancelQuiz(); } catch (e) {} }
  }

  animBtn.onclick = function () { if (writer) writer.animateCharacter(); };
  resetBtn.onclick = function () { if (currentList[currentIndex]) createWriter(currentList[currentIndex].c); };
  quizBtn.onclick = function () {
    if (!writer) return;
    writer.quiz({
      showHintAfterMisses: 2,
      highlightOnComplete: true,
      onComplete: function () { markDone(); }
    });
  };
  speakBtn.onclick = function () {
    var it = currentList[currentIndex];
    if (!it) return;
    cancelSpeech();
    speak(it.c);
  };
  prevBtn.onclick = function () { openChar(currentIndex - 1); };
  nextBtn.onclick = function () { openChar(currentIndex + 1); };
  closeBtn.onclick = closeModal;
  overlay.onclick = function (e) { if (e.target === overlay) closeModal(); };
  document.addEventListener('keydown', function (e) {
    if (!overlay.classList.contains('hidden')) {
      if (e.key === 'Escape') closeModal();
      if (e.key === 'ArrowLeft') openChar(currentIndex - 1);
      if (e.key === 'ArrowRight') openChar(currentIndex + 1);
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

  gradeSel.onchange = function () {
    state.grade = parseInt(gradeSel.value, 10);
    var list = booksFor(state.grade);
    var has = list.some(function (b) { return b.volume === state.volume; });
    if (!has && list.length) state.volume = list[0].volume;
    buildVolTabs();
    render();
  };
  searchEl.oninput = function () { state.query = searchEl.value.trim(); render(); };
  onlyUndoneEl.onchange = function () { state.onlyUndone = onlyUndoneEl.checked; render(); };

  /* ---------- 测试模式 · 拼音闪卡 ---------- */

  var testBtn = document.getElementById('testBtn');
  var testView = document.getElementById('testView');
  var testSetup = document.getElementById('testSetup');
  var testQuiz = document.getElementById('testQuiz');
  var testGrade = document.getElementById('testGrade');
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
  var testUnitSel = {}; // grade -> { unitName: bool }

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

  function testUnits(grade) {
    var out = [];
    booksFor(grade).forEach(function (b) {
      var tag = b.volume === 'up' ? '上' : '下';
      b.units.forEach(function (u) {
        out.push({ name: u.name, volume: b.volume, tag: tag });
      });
    });
    return out;
  }

  function renderUnitList() {
    var units = testUnits(testState.grade);
    var saved = testUnitSel[testState.grade];
    unitList.innerHTML = '';
    if (!units.length) {
      unitList.innerHTML = '<div class="empty">该年级暂无数据</div>';
      updateStartState();
      return;
    }
    units.forEach(function (u) {
      var key = u.name + '|' + u.volume;
      var lab = document.createElement('label');
      lab.className = 'uitem';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('data-unit', key);
      cb.checked = saved ? !!saved[key] : true;
      var name = document.createElement('span');
      name.textContent = u.name + '（' + u.tag + '）';
      lab.appendChild(cb);
      lab.appendChild(name);
      unitList.appendChild(lab);
    });
    updateStartState();
  }

  function saveUnitSel() {
    var map = {};
    var cbs = unitList.querySelectorAll('input[type=checkbox]');
    for (var i = 0; i < cbs.length; i++) {
      map[cbs[i].getAttribute('data-unit')] = cbs[i].checked;
    }
    testUnitSel[testState.grade] = map;
  }

  function updateStartState() {
    startTestBtn.disabled =
      !unitList.querySelectorAll('input[type=checkbox]:checked').length;
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

  function collectTestCards(grade, selectedKeys) {
    var selected = {};
    selectedKeys.forEach(function (k) {
      var parts = k.split('|');
      if (parts.length === 2) selected[parts[0] + '|' + parts[1]] = true;
    });
    var seen = {};
    var out = [];
    booksFor(grade).forEach(function (b) {
      b.units.forEach(function (u) {
        if (!selected[u.name + '|' + b.volume]) return;
        u.lessons.forEach(function (l) {
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
    unitList.querySelectorAll('input[type=checkbox]:checked').forEach(function (cb) {
      selected.push(cb.getAttribute('data-unit'));
    });
    var cards = collectTestCards(testState.grade, selected);
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

  function pickHintWords(words, ch, n) {
    if (!words || !words.length) return [];
    var valid = words.filter(function (w) { return typeof w === 'string' && w.indexOf(ch) >= 0; });
    if (valid.length <= n) return valid.slice();

    // Prefer 2-character words; only fall back to longer words/phrases if needed.
    var twoChar = valid.filter(function (w) { return w.length === 2; });
    var longer = valid.filter(function (w) { return w.length !== 2; });
    var out = [];
    if (twoChar.length >= n) {
      out = shuffle(twoChar.slice()).slice(0, n);
    } else {
      out = twoChar.slice();
      var need = n - out.length;
      if (need > 0 && longer.length) {
        out = out.concat(shuffle(longer.slice()).slice(0, need));
      }
    }
    return out;
  }

  function speakHints(char, hints) {
    cancelSpeech();
    var text = char || '';
    if (hints && hints.length) {
      text += '，' + hints.join('，');
    }
    speak(text);
  }

  function renderHint(it, hints, py) {
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
      var span = document.createElement('span');
      span.className = 'fc-word';
      span.textContent = maskWord(w, it.c, py);
      fcHint.appendChild(span);
    });
  }

  function renderTestCard() {
    cancelSpeech();
    destroyTestWriter();
    var it = testState.cards[testState.index];
    if (!it) return;
    testState.flipped = false;
    flashCard.classList.remove('flipped');
    fcPinyin.textContent = it.p || '暂无拼音';
    fcChar.textContent = it.c;
    var rec = HANZI[it.c] || {};
    fcMeta.textContent = [it.p || '', it.unit || '', it.lesson || '',
      rec.strokeCount ? rec.strokeCount + '画' : ''].filter(Boolean).join(' · ');
    var py = it.p || '';
    var hints = pickHintWords(rec.words, it.c, 3);
    renderHint(it, hints, py);
    testPos.textContent = (testState.index + 1) + ' / ' + testState.cards.length;
    testPrev.disabled = testState.index <= 0;
    testNext.disabled = testState.index >= testState.cards.length - 1;
    fcReplay.disabled = !('speechSynthesis' in window) || !hints.length;
    testState.speakTimer = setTimeout(function () {
      speakHints(it.c, hints);
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
    testState.writer = HanziWriter.create(target, it.c, {
      width: 156,
      height: 156,
      padding: 4,
      showOutline: true,
      showCharacter: false,
      strokeColor: '#2b6cb0',
      radicalColor: '#2b6cb0',
      outlineColor: '#f2b8b8',
      strokeAnimationSpeed: 1,
      delayBetweenStrokes: 200,
      charDataLoader: function (c, onComplete, onError) {
        var d = HANZI[c];
        if (d && d.strokes) {
          onComplete({ strokes: d.strokes, medians: d.medians, radStrokes: d.radStrokes });
        } else {
          onError(new Error('缺少字形数据：' + c));
        }
      }
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
    renderUnitList();
  };
  unitList.addEventListener('change', function () { saveUnitSel(); updateStartState(); });
  flashCard.onclick = flipCard;
  fcReplay.onclick = function (e) {
    e.stopPropagation();
    var it = testState.cards[testState.index];
    if (!it) return;
    var rec = HANZI[it.c] || {};
    var hints = pickHintWords(rec.words, it.c, 3);
    speakHints(it.c, hints);
  };
  testPrev.onclick = function () {
    if (testState.index > 0) { testState.index--; renderTestCard(); }
  };
  testNext.onclick = function () {
    if (testState.index < testState.cards.length - 1) { testState.index++; renderTestCard(); }
  };

  buildGradeSelect();
  buildVolTabs();
  render();
})();