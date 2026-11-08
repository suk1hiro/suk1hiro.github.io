/*!
 * dom-shim.mjs — 极简 DOM/BOM 桩件
 * 只为在 Node 里跑通页面脚本：够用的解析、查询、样式类、事件与 localStorage。
 * 不是完整的 DOM 实现，仅用于冒烟测试（不做真实布局与层叠样式）。
 */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr', 'path', 'circle', 'rect', 'line',
  'polygon', 'polyline', 'ellipse', 'use', 'stop']);

const RAW_TEXT_TAGS = new Set(['script', 'style']);

/** 匹配 node 上挂载的 class 列表 */
class ClassList {
  constructor(node) { this.node = node; this.set = new Set(); }
  _sync() { this.node._className = [...this.set].join(' '); }
  add(...names) { names.forEach((n) => n && this.set.add(n)); this._sync(); }
  remove(...names) { names.forEach((n) => this.set.delete(n)); this._sync(); }
  contains(name) { return this.set.has(name); }
  toggle(name, force) {
    const want = force === undefined ? !this.set.has(name) : !!force;
    if (want) this.set.add(name); else this.set.delete(name);
    this._sync();
    return want;
  }
  item(i) { return [...this.set][i] ?? null; }
  get length() { return this.set.size; }
  toString() { return this._className; }
}

class Node {
  constructor(tagName, doc) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.nodeName = this.tagName;
    this.ownerDocument = doc;
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.style = makeStyle();
    this.listeners = {};
    this._className = '';
    this._text = '';
    this._html = null;
    this.hidden = false;
    this.disabled = false;
    this.type = '';
    this.value = '';
    this.href = '';
    this.title = '';
    this.id = '';
    this.classList = new ClassList(this);
  }

  /* ---------------------------------------------------------- 属性 */

  get className() { return this._className; }
  set className(v) {
    this._className = String(v == null ? '' : v);
    this.classList.set = new Set(this._className.split(/\s+/).filter(Boolean));
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this.children.forEach((c) => { c.parentNode = null; });
    this.children.length = 0;
    this._text = String(v == null ? '' : v);
  }

  get firstChild() { return this.children[0] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get offsetWidth() { return Math.round(this.getBoundingClientRect().width); }
  get offsetHeight() { return Math.round(this.getBoundingClientRect().height); }

  /** 桩件的“布局”：只有显式尺寸提示，没有真实盒模型 */
  getBoundingClientRect() {
    const rect = { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0 };
    if (this._rect) return Object.assign(rect, this._rect);
    return rect;
  }
  scrollIntoView() {}

  /* ------------------------------------------------------ DOM 变更 */

  set innerHTML(v) {
    this.children.forEach((c) => { c.parentNode = null; });
    this.children.length = 0;
    this._text = '';
    this._html = String(v == null ? '' : v);
    if (this._html === '') return;
    const parsed = parseFragment(this._html, this.ownerDocument);
    parsed.forEach((child) => this.appendChild(child));
  }
  get innerHTML() { return this._html == null ? this.textContent : this._html; }

  appendChild(child) {
    if (child && child.__fragment) {
      child.children.slice().forEach((c) => this.appendChild(c));
      return child;
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...nodes) { nodes.forEach((n) => this.appendChild(n)); }
  insertBefore(child, ref) {
    child.parentNode = this;
    const i = this.children.indexOf(ref);
    if (i < 0) this.children.push(child); else this.children.splice(i, 0, child);
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) { this.children.splice(i, 1); child.parentNode = null; }
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(node) {
    if (node === this) return true;
    return this.children.some((c) => c.contains && c.contains(node));
  }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'id') this.id = String(v);
    if (k === 'class') this.className = String(v);
    if (k === 'hidden') this.hidden = true;
    if (k === 'disabled') this.disabled = true;
    if (k.startsWith('data-')) {
      this.dataset[k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = String(v);
    }
  }
  getAttribute(k) { return this.attributes[k] === undefined ? null : this.attributes[k]; }
  removeAttribute(k) {
    delete this.attributes[k];
    if (k === 'hidden') this.hidden = false;
    if (k === 'disabled') this.disabled = false;
  }
  hasAttribute(k) { return this.attributes[k] !== undefined; }

  /* --------------------------------------------------------- 事件 */

  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const list = this.listeners[type];
    if (list) this.listeners[type] = list.filter((f) => f !== fn);
  }
  dispatchEvent(event) {
    (this.listeners[event.type] || []).slice().forEach((fn) => fn(event));
    const handler = this['on' + event.type];
    if (typeof handler === 'function' && !event._stopped) handler(event);
    if (!event._stopped && this.parentNode && this.parentNode.dispatchEvent) this.parentNode.dispatchEvent(event);
    return true;
  }
  click() { this.dispatchEvent(makeEvent('click', this)); }

  /* --------------------------------------------------------- 查询 */

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const out = [];
    const walk = (node) => {
      node.children.forEach((child) => {
        if (matches(child, selector)) out.push(child);
        walk(child);
      });
    };
    walk(this);
    return out;
  }
  /** 与浏览器一致：closest 会检查自身 */
  closest(selector) {
    let node = this;
    while (node) { if (matches(node, selector)) return node; node = node.parentNode; }
    return null;
  }
  matches(selector) { return matches(this, selector); }
  getElementsByTagName(tag) { return this.querySelectorAll(tag); }
}

class TextNode extends Node {
  constructor(text, doc) { super('#text', doc); this._text = String(text); }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get nodeType() { return 3; }
}

/** 只解析内联样式声明，够查颜色/尺寸等简单属性 */
function makeStyle() {
  const decls = {};
  const style = {
    setProperty(k, v) { decls[k] = String(v); style[k] = String(v); },
    getPropertyValue(k) { return decls[k] === undefined ? '' : decls[k]; },
    removeProperty(k) { delete decls[k]; delete style[k]; },
    get cssText() { return Object.entries(decls).map(([k, v]) => `${k}: ${v}`).join('; '); },
    _decls: decls
  };
  return style;
}

/** 解析 style="a: b; c: d" */
function parseInlineStyle(text, style) {
  String(text).split(';').forEach((part) => {
    const i = part.indexOf(':');
    if (i < 0) return;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key) style.setProperty(key, value);
  });
}

/* ------------------------------------------------------------ 选择器 */

/** 匹配单个复合选择器（不含空格） */
function matchesSimple(node, selector) {
  if (!node || node.tagName === '#TEXT') return false;
  // documentElement 是合成根，浏览器里它不可能被选择器命中，这里保持一致
  if (node === node.ownerDocument.documentElement) return false;
  let rest = String(selector).trim();

  // 属性选择器：支持 [attr] 与 [attr="v"]，值比较必须做（空串也要比）
  const attrRe = /\[\s*([\w-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/;
  let attrMatch = rest.match(attrRe);
  while (attrMatch) {
    const name = attrMatch[1];
    const wanted = attrMatch[2] !== undefined ? attrMatch[2]
      : attrMatch[3] !== undefined ? attrMatch[3]
      : attrMatch[4];                       // undefined 表示只判断属性是否存在
    const actual = name.startsWith('data-')
      ? node.dataset[name.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())]
      : node.getAttribute(name);
    if (actual == null) return false;
    if (wanted !== undefined && String(actual) !== wanted) return false;
    rest = rest.replace(attrMatch[0], '');
    attrMatch = rest.match(attrRe);
  }

  const classes = (rest.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
  const idMatch = rest.match(/#[\w-]+/);
  const wantedId = idMatch ? idMatch[0].slice(1) : null;
  const tag = rest.replace(/[.#][\w-]+/g, '').replace(/[>+~]/g, '').trim();
  if (tag && tag !== '*' && node.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  if (wantedId && node.id !== wantedId) return false;
  return classes.every((c) => node.classList.contains(c));
}

/** 支持后代组合（空格）、子组合（>）与逗号分组 */
function matches(node, selector) {
  return String(selector).split(',').map((s) => s.trim()).filter(Boolean).some((sel) => {
    const raw = sel.split(/\s+/).filter(Boolean);
    if (!raw.length) return false;
    // 归一化：把 ">" 合并到后一个 token 上，用 childOnly 标记
    const parts = [];
    raw.forEach((token) => {
      if (token === '>') { parts[parts.length - 1].childOnly = true; return; }
      parts.push({ token, childOnly: false });
    });
    const last = parts[parts.length - 1];
    if (!matchesSimple(node, last.token)) return false;
    let ancestor = node.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) {
      const part = parts[i];
      if (part.childOnly) {
        if (!ancestor || !matchesSimple(ancestor, part.token)) return false;
        ancestor = ancestor.parentNode;
        continue;
      }
      let found = false;
      while (ancestor) {
        if (matchesSimple(ancestor, part.token)) { found = true; ancestor = ancestor.parentNode; break; }
        ancestor = ancestor.parentNode;
      }
      if (!found) return false;
    }
    return true;
  });
}

/* ------------------------------------------------------------ 解析器 */

/** 把 HTML 片段解析成节点数组（跳过 script/style 内容与注释） */
function parseFragment(html, doc) {
  const roots = [];
  const stack = [];
  let i = 0;
  const push = (node) => {
    const parent = stack[stack.length - 1];
    if (parent) parent.appendChild(node); else roots.push(node);
  };
  const pushText = (text) => {
    if (!text.trim()) return;
    if (!stack.length) return;                 // 顶层空白丢弃
    push(doc.createTextNode(text.trim()));
  };

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { pushText(html.slice(i)); break; }
    if (lt > i) pushText(html.slice(i, lt));

    // 注释 / doctype / CDATA
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) {
      const end = html.indexOf('>', lt);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    const close = html.indexOf('>', lt);
    if (close < 0) { pushText(html.slice(lt)); break; }

    const raw = html.slice(lt + 1, close);
    const isClosing = raw.startsWith('/');
    const selfClosing = raw.endsWith('/');
    const body = isClosing ? raw.slice(1) : (selfClosing ? raw.slice(0, -1) : raw);
    const nameMatch = /^([a-zA-Z][\w:-]*)/.exec(body.trim());

    if (!nameMatch) { i = close + 1; continue; }   // 非标签内容，忽略
    const tag = nameMatch[1].toLowerCase();
    const rest = body.slice(body.indexOf(nameMatch[1]) + nameMatch[1].length).trim();

    if (isClosing) {                               // 结束标签
      // 找到最近的同名开放标签并闭合
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].tagName.toLowerCase() === tag) { stack.length = s; break; }
      }
      i = close + 1;
      continue;
    }

    // html / head / body 直接展开，避免与桩件的根节点重复嵌套
    const isWrapper = tag === 'html' || tag === 'head' || tag === 'body';
    if (!isWrapper) {
      const node = doc.createElement(tag);
      parseAttributes(rest, node);
      push(node);
      if (!VOID_TAGS.has(tag)) stack.push(node);
    }

    i = close + 1;

    if (RAW_TEXT_TAGS.has(tag)) {                  // 跳过脚本/样式正文
      const end = html.toLowerCase().indexOf('</' + tag, i);
      i = end < 0 ? html.length : end;
      if (isWrapper) continue;
      // 原始文本保留在节点里（不参与查询）
      const owner = isWrapper ? null : stack[stack.length - 1];
      if (owner) owner._text = html.slice(close + 1, i);
    }
  }
  return roots;
}

function parseAttributes(text, node) {
  const re = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1];
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    if (name === 'style') { parseInlineStyle(value, node.style); continue; }
    node.setAttribute(name, value);
  }
}

function makeEvent(type, target, extra = {}) {
  return Object.assign({
    type,
    target,
    currentTarget: target,
    defaultPrevented: false,
    _stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this._stopped = true; }
  }, extra);
}

export function createDom(html) {
  const doc = {
    readyState: 'complete',
    listeners: {},
    documentElement: null,
    body: null,
    createElement(tag) { return new Node(tag, doc); },
    createElementNS(ns, tag) { return new Node(tag, doc); },
    createTextNode(text) { return new TextNode(text, doc); },
    createDocumentFragment() {
      const frag = new Node('fragment', doc);
      frag.__fragment = true;
      return frag;
    },
    getElementById(id) { return doc.body.querySelectorAll('#' + id)[0] || null; },
    querySelector(sel) { return doc.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const out = [];
      // 从 <html> 开始遍历，与浏览器一致（documentElement 是最外层，不是 body 的后代）
      const walk = (node) => {
        node.children.forEach((child) => {
          if (matches(child, sel)) out.push(child);
          walk(child);
        });
      };
      walk(doc.documentElement);
      return out;
    },
    addEventListener(type, fn) { (doc.listeners[type] = doc.listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const list = doc.listeners[type];
      if (list) doc.listeners[type] = list.filter((f) => f !== fn);
    },
    dispatchEvent(event) {
      (doc.listeners[event.type] || []).slice().forEach((fn) => fn(event));
      return true;
    }
  };

  doc.documentElement = doc.createElement('html');
  doc.body = doc.createElement('body');
  doc.documentElement.appendChild(doc.body);
  // 页面里的 <html>/<head>/<body> 会被 parseFragment 展开成普通节点，
  // 若直接挂到 documentElement 下，就会出现「documentElement → html」这种
  // 浏览器里不存在的嵌套，后继选择器遍历时会把根元素的属性当成祖先属性命中。
  // 这里做一次归并：把展开出来的 html 的 <head>/<body> 内容并进来。
  parseFragment(html, doc).forEach((node) => {
    if (node.tagName === 'HTML') {
      node.children.forEach((child) => {
        if (child.tagName === 'BODY') {
          child.children.slice().forEach((n) => doc.body.appendChild(n));
        } else if (child.tagName !== 'HEAD') {
          doc.body.appendChild(child);
        }
      });
      return;
    }
    if (node.tagName === 'BODY') {
      node.children.slice().forEach((n) => doc.body.appendChild(n));
      return;
    }
    if (node.tagName === 'HEAD') return;
    doc.body.appendChild(node);
  });
  return doc;
}

const VIEWPORT = { width: 1280, height: 900 };

/** 建立 window 全局环境 */
export function createWindow(doc, options = {}) {
  // 允许跨页面共享存储，模拟浏览器同一 origin 下的 localStorage
  const store = options.storage || new Map();
  const timers = new Set();
  const size = options.viewport || VIEWPORT;

  const win = {
    document: doc,
    location: {
      search: '',
      pathname: '/index.html',
      href: 'http://localhost/index.html',
      replace() {},
      assign() {}
    },
    history: { replaceState() {}, pushState() {} },
    navigator: { userAgent: 'node-dom-shim' },
    innerWidth: size.width,
    innerHeight: size.height,
    devicePixelRatio: 1,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      key: (i) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
      clear: () => store.clear(),
      __map: store
    },
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timers.add(id); return id; },
    clearTimeout: (id) => { timers.delete(id); clearTimeout(id); },
    setInterval: (fn, ms) => { const id = setInterval(fn, ms); timers.add(id); return id; },
    clearInterval: (id) => { timers.delete(id); clearInterval(id); },
    __dispose: () => { timers.forEach((id) => { clearTimeout(id); clearInterval(id); }); timers.clear(); },
    confirm: () => true,
    alert: () => {},
    addEventListener() {},
    removeEventListener() {},
    scrollTo() {},
    matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
    /** 桩件不做层叠计算，返回内联样式与显式注入的样式 */
    getComputedStyle: (node) => {
      const base = {
        display: node.tagName === 'DIV' ? 'block' : 'inline',
        color: 'rgb(0, 0, 0)',
        backgroundColor: 'rgba(0, 0, 0, 0)',
        width: '', height: '',
        getPropertyValue: (k) => (node.style._decls[k] === undefined ? '' : node.style._decls[k])
      };
      return Object.assign(base, node.__computed || {}, node.style._decls);
    },
    URLSearchParams,
    Math, Date, JSON, Object, Array, String, Number, RegExp, Error, Boolean, Set, Map, Promise, console
  };
  win.window = win;
  win.self = win;
  win.globalThis = win;
  return win;
}

export { makeEvent, parseFragment, matches };
