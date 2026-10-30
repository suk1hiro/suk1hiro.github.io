'use strict';
/**
 * Ember Check-in — core.js 单元测试
 * 仅使用 Node 内置 assert，无第三方依赖。
 * 运行：node tests/core.test.js
 */

const assert = require('node:assert');
const Core = require('../core.js');

// ------------------------------------------------------------
// 迷你测试框架（统计用例数与断言数）
// ------------------------------------------------------------
let passed = 0;
let failed = 0;
let assertions = 0;
const failures = [];

function check(fn) {
  assertions += 1;
  return fn();
}

const A = {
  equal(actual, expected, message) {
    check(() => assert.strictEqual(actual, expected, message));
  },
  deep(actual, expected, message) {
    check(() => assert.deepStrictEqual(actual, expected, message));
  },
  ok(value, message) {
    check(() => assert.ok(value, message));
  },
  notEqual(actual, expected, message) {
    check(() => assert.notStrictEqual(actual, expected, message));
  },
  throws(fn, message) {
    check(() => assert.throws(fn, message));
  }
};

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('ok   - ' + name);
  } catch (err) {
    failed += 1;
    failures.push({ name, err });
    console.log('FAIL - ' + name);
    console.log(String(err && err.stack ? err.stack : err).replace(/^/gm, '       '));
  }
}

// ------------------------------------------------------------
// 测试夹具
// ------------------------------------------------------------
const TODAY = '2026-10-24'; // 周六，默认周一为周首

let taskSeq = 0;
function makeTask(overrides, todayKey) {
  taskSeq += 1;
  return Core.normalizeTask(
    Object.assign(
      {
        id: 't_' + taskSeq,
        title: '测试任务 ' + taskSeq,
        type: 'daily',
        createdAt: '2026-01-01T00:00:00.000Z'
      },
      overrides || {}
    ),
    todayKey || TODAY
  );
}

function makeDb(overrides) {
  const base = {
    version: 1,
    tasks: [],
    settings: { name: '朋友', weekStart: 1 },
    dayLog: {},
    fired: {},
    snoozes: {}
  };
  return Core.normalizeDb(Object.assign(base, overrides || {}));
}

function dayLogEntry(lit, done) {
  return {
    lit: !!lit,
    required: done || [],
    done: done || [],
    total: (done || []).length,
    updatedAt: '2026-10-01T00:00:00.000Z'
  };
}

function at(y, m, d, h, min) {
  return new Date(y, m - 1, d, h, min, 0, 0);
}

/** 本地时刻 -> ISO 字符串（保证跨时区测试稳定）。 */
function localIso(y, m, d, h, min) {
  return at(y, m, d, h, min).toISOString();
}

// ============================================================
// 1. 日期工具
// ============================================================
test('pad2 补零', () => {
  A.equal(Core.pad2(3), '03');
  A.equal(Core.pad2(12), '12');
  A.equal(Core.pad2(0), '00');
  A.equal(Core.pad2('7'), '07');
});

test('isKey 严格校验 YYYY-MM-DD', () => {
  A.equal(Core.isKey('2026-10-24'), true);
  A.equal(Core.isKey('2024-02-29'), true);
  A.equal(Core.isKey('2026-02-29'), false); // 非闰年
  A.equal(Core.isKey('2026-02-30'), false);
  A.equal(Core.isKey('2026-13-01'), false);
  A.equal(Core.isKey('2026-2-3'), false);
  A.equal(Core.isKey(''), false);
  A.equal(Core.isKey(null), false);
  A.equal(Core.isKey(20261024), false);
});

test('parseDateKey 返回 {y,m,d}，非法抛错', () => {
  A.deep(Core.parseDateKey('2026-10-24'), { y: 2026, m: 10, d: 24 });
  A.deep(Core.parseDateKey('2024-02-29'), { y: 2024, m: 2, d: 29 });
  A.throws(() => Core.parseDateKey('2026-02-30'));
  A.throws(() => Core.parseDateKey('2026/10/24'));
  A.throws(() => Core.parseDateKey(null));
});

test('dateKeyFromDate 使用本地年月日', () => {
  A.equal(Core.dateKeyFromDate(new Date(2026, 9, 24, 23, 30)), '2026-10-24');
  A.equal(Core.dateKeyFromDate(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
  A.equal(Core.dateKeyFromDate(new Date(2026, 11, 31, 12, 0)), '2026-12-31');
  A.throws(() => Core.dateKeyFromDate(new Date('bad')));
});

test('nowKey 与 dateKeyFromDate 一致', () => {
  const d = new Date(2026, 9, 24, 8, 15);
  A.equal(Core.nowKey(d), Core.dateKeyFromDate(d));
  A.equal(Core.nowKey(d), TODAY);
});

test('addDays 跨月/跨年/闰日', () => {
  A.equal(Core.addDays('2026-10-24', 1), '2026-10-25');
  A.equal(Core.addDays('2026-12-31', 1), '2027-01-01');
  A.equal(Core.addDays('2026-01-01', -1), '2025-12-31');
  A.equal(Core.addDays('2026-02-28', 1), '2026-03-01');
  A.equal(Core.addDays('2024-02-28', 1), '2024-02-29');
  A.equal(Core.addDays('2024-02-29', 1), '2024-03-01');
  A.equal(Core.addDays('2026-10-24', 0), '2026-10-24');
  A.equal(Core.addDays('2026-10-24', -24), '2026-09-30');
});

test('diffDays 整数天（UTC civil，避免 DST）', () => {
  A.equal(Core.diffDays('2026-10-24', '2026-10-24'), 0);
  A.equal(Core.diffDays('2026-10-24', '2026-10-27'), 3);
  A.equal(Core.diffDays('2026-10-27', '2026-10-24'), -3);
  A.equal(Core.diffDays('2025-12-31', '2026-01-01'), 1);
  A.equal(Core.diffDays('2024-02-28', '2024-03-01'), 2);
  // 北美 DST 切换日附近仍应是整数天
  A.equal(Core.diffDays('2026-03-07', '2026-03-09'), 2);
  A.equal(Core.diffDays('2026-10-31', '2026-11-02'), 2);
});

test('weekdayISO 1..7（周一..周日）', () => {
  A.equal(Core.weekdayISO('2026-10-19'), 1);
  A.equal(Core.weekdayISO('2026-10-24'), 6);
  A.equal(Core.weekdayISO('2026-10-25'), 7);
  A.equal(Core.weekdayISO('2026-01-01'), 4);
});

test('startOfWeek/endOfWeek 支持周一或周日开头、跨年', () => {
  A.equal(Core.startOfWeek('2026-10-24'), '2026-10-19');
  A.equal(Core.endOfWeek('2026-10-24'), '2026-10-25');
  A.equal(Core.startOfWeek('2026-10-24', 7), '2026-10-18');
  A.equal(Core.endOfWeek('2026-10-24', 7), '2026-10-24');
  A.equal(Core.startOfWeek('2026-01-01'), '2025-12-29');
  A.equal(Core.endOfWeek('2026-01-01'), '2026-01-04');
  A.equal(Core.startOfWeek('2026-10-19'), '2026-10-19');
});

test('monthKey / formatDateCN / formatDateTimeCN', () => {
  A.equal(Core.monthKey('2026-10-24'), '2026-10');
  A.equal(Core.monthKey('2026-01-01'), '2026-01');
  A.equal(Core.formatDateCN('2026-10-24'), '10月24日 周六');
  A.equal(Core.formatDateCN('2026-01-01'), '1月1日 周四');
  A.equal(Core.formatDateTimeCN(new Date(2026, 9, 24, 21, 50)), '21:50');
  A.equal(Core.formatDateTimeCN(new Date(2026, 0, 2, 9, 5)), '09:05');
  A.equal(Core.formatDateTimeCN(null), '');
});

// ============================================================
// 2. 任务规范化
// ============================================================
test('createTask 补全默认值并生成稳定 id', () => {
  const t = Core.createTask({ title: '   ' }, TODAY);
  A.equal(t.title, '未命名任务');
  A.equal(t.type, 'daily');
  A.equal(t.emoji, '✨');
  A.equal(t.fire, false);
  A.equal(t.archived, false);
  A.deep(t.completions, {});
  A.equal(t.monthday, 1);
  A.equal(t.everyN, 3);
  A.equal(t.anchor, TODAY);
  A.equal(t.due, TODAY);
  A.equal(t.dueTime, '18:00');
  A.equal(t.priority, 'normal');
  A.equal(t.reminder.enabled, false);
  A.equal(t.reminder.time, '21:00');
  A.ok(typeof t.id === 'string' && t.id.indexOf('t_') === 0);
  const another = Core.createTask({ title: '阅读' }, TODAY);
  A.notEqual(t.id, another.id);
  A.equal(another.title, '阅读');
});

test('createTask 保留显式 id 与合法字段', () => {
  const t = Core.createTask(
    {
      id: 't_custom',
      title: '  阅读  ',
      emoji: '📖',
      category: '成长',
      type: 'weekly',
      reminder: { enabled: true, time: '8:05' },
      fire: true
    },
    TODAY
  );
  A.equal(t.id, 't_custom');
  A.equal(t.title, '阅读');
  A.equal(t.emoji, '📖');
  A.equal(t.category, '成长');
  A.equal(t.type, 'weekly');
  A.deep(t.reminder, { enabled: true, time: '08:05' });
  A.equal(t.fire, true);
});

test('normalizeTask 处理 null 与坏字段', () => {
  const a = Core.normalizeTask(null, TODAY);
  A.equal(a.title, '未命名任务');
  A.equal(a.type, 'daily');

  const b = Core.normalizeTask(
    {
      title: '坏数据',
      type: 'hourly',
      monthday: 99,
      everyN: 1,
      anchor: 'nope',
      due: '2026-02-30',
      dueTime: '25:00',
      priority: 'critical',
      reminder: { enabled: 'yes', time: '25:61' },
      fire: 'yes',
      archived: 1,
      completions: 'bad',
      createdAt: 'not-a-date'
    },
    TODAY
  );
  A.equal(b.type, 'daily');
  A.equal(b.monthday, 1);
  A.equal(b.everyN, 3);
  A.equal(b.anchor, TODAY);
  A.equal(b.due, TODAY);
  A.equal(b.dueTime, '18:00');
  A.equal(b.priority, 'normal');
  A.deep(b.reminder, { enabled: false, time: '21:00' });
  A.equal(b.fire, false);
  A.equal(b.archived, false);
  A.deep(b.completions, {});
  A.ok(Core.isKey(b.createdAt) === false); // createdAt 是 ISO 时间戳，不是 dateKey
  A.ok(!isNaN(new Date(b.createdAt).getTime()));
});

test('normalizeTask 接受 -1 / 边界 everyN / 合法 completions', () => {
  const t = Core.normalizeTask(
    {
      type: 'monthly',
      monthday: -1,
      everyN: 365,
      completions: {
        '2026-10-24': '2026-10-24T20:00:00.000Z',
        'W:2026-10-19': '2026-10-19T20:00:00.000Z',
        'M:2026-10': '2026-10-02T20:00:00.000Z',
        'I:2026-10-20': '2026-10-21T20:00:00.000Z',
        once: '2026-10-01T20:00:00.000Z',
        'bad-key': '2026-10-01T20:00:00.000Z',
        '2026-10-25': 123,
        __proto__: { polluted: true }
      }
    },
    TODAY
  );
  A.equal(t.monthday, -1);
  A.equal(t.everyN, 365);
  A.deep(Object.keys(t.completions).sort(), [
    '2026-10-24',
    'I:2026-10-20',
    'M:2026-10',
    'W:2026-10-19',
    'once'
  ]);
  A.equal(t.completions['bad-key'], undefined);
  A.equal({}.polluted, undefined);
});

test('normalizeTask 不修改入参', () => {
  const raw = {
    id: 't_x',
    title: ' 原文 ',
    type: 'weekly',
    completions: { 'W:2026-10-19': '2026-10-19T20:00:00.000Z' }
  };
  const snapshot = JSON.stringify(raw);
  Core.normalizeTask(raw, TODAY);
  A.equal(JSON.stringify(raw), snapshot);
});

// ============================================================
// 3. 周期与状态
// ============================================================
test('recurrenceLabel 五种类型', () => {
  A.equal(Core.recurrenceLabel(makeTask({ type: 'daily' })), '每天');
  A.equal(Core.recurrenceLabel(makeTask({ type: 'weekly' })), '每周');
  A.equal(Core.recurrenceLabel(makeTask({ type: 'monthly', monthday: 15 })), '每月 15 日');
  A.equal(Core.recurrenceLabel(makeTask({ type: 'monthly', monthday: -1 })), '每月最后一天');
  A.equal(Core.recurrenceLabel(makeTask({ type: 'interval', everyN: 3, anchor: TODAY })), '每 3 天');
  A.equal(Core.recurrenceLabel(makeTask({ type: 'urgent', due: TODAY })), '紧要任务');
});

test('occurrenceKey 五种类型', () => {
  A.equal(Core.occurrenceKey(makeTask({ type: 'daily' }), TODAY), '2026-10-24');
  A.equal(Core.occurrenceKey(makeTask({ type: 'weekly' }), TODAY), 'W:2026-10-19');
  A.equal(Core.occurrenceKey(makeTask({ type: 'weekly' }), TODAY, 7), 'W:2026-10-18');
  A.equal(Core.occurrenceKey(makeTask({ type: 'monthly' }), TODAY), 'M:2026-10');
  A.equal(
    Core.occurrenceKey(makeTask({ type: 'interval', everyN: 3, anchor: '2026-10-20' }), '2026-10-25'),
    'I:2026-10-23'
  );
  A.equal(Core.occurrenceKey(makeTask({ type: 'urgent', due: TODAY }), TODAY), 'once');
});

test('occurrenceKey weekly 跨年用 weekStart 计算', () => {
  A.equal(Core.occurrenceKey(makeTask({ type: 'weekly' }), '2026-01-01'), 'W:2025-12-29');
  A.equal(Core.occurrenceKey(makeTask({ type: 'weekly' }), '2026-01-01', 7), 'W:2025-12-28');
});

test('taskState daily 完整字段', () => {
  const t = makeTask({ type: 'daily' });
  const s = Core.taskState(t, TODAY);
  A.deep(s, {
    available: true,
    complete: false,
    occurrenceKey: TODAY,
    cycleStart: TODAY,
    cycleEnd: TODAY,
    daysLeft: 0,
    cycleDay: 1,
    totalDays: 1,
    overdue: false,
    overdueDays: 0
  });
  const done = makeTask({ type: 'daily', completions: { [TODAY]: '2026-10-24T20:00:00.000Z' } });
  A.equal(Core.taskState(done, TODAY).complete, true);
  A.equal(Core.isTaskComplete(done, TODAY), true);
});

test('taskState weekly 周期为周起止', () => {
  const t = makeTask({ type: 'weekly' });
  const s = Core.taskState(t, TODAY);
  A.equal(s.available, true);
  A.equal(s.complete, false);
  A.equal(s.cycleStart, '2026-10-19');
  A.equal(s.cycleEnd, '2026-10-25');
  A.equal(s.cycleDay, 6);
  A.equal(s.daysLeft, 1);
  A.equal(s.totalDays, 7);
  A.equal(s.occurrenceKey, 'W:2026-10-19');

  const done = makeTask({
    type: 'weekly',
    completions: { 'W:2026-10-19': '2026-10-20T20:00:00.000Z' }
  });
  A.equal(Core.taskState(done, TODAY).complete, true);
  A.equal(Core.taskState(done, TODAY, 7).complete, false);
  A.equal(Core.isTaskComplete(done, TODAY, 7), false);
});

test('taskState monthly 为当月 1 号/月末', () => {
  const t = makeTask({ type: 'monthly', monthday: 15 });
  const s = Core.taskState(t, TODAY);
  A.equal(s.cycleStart, '2026-10-01');
  A.equal(s.cycleEnd, '2026-10-31');
  A.equal(s.cycleDay, 24);
  A.equal(s.daysLeft, 7);
  A.equal(s.totalDays, 31);
  A.equal(s.occurrenceKey, 'M:2026-10');

  const feb = makeTask({ type: 'monthly', monthday: 31 });
  A.equal(Core.taskState(feb, '2026-02-10').cycleEnd, '2026-02-28');
  A.equal(Core.taskState(feb, '2024-02-10').cycleEnd, '2024-02-29');
});

test('monthlyDueKey 月末 clamp 与 -1', () => {
  A.equal(Core.monthlyDueKey(makeTask({ type: 'monthly', monthday: 31 }), '2026-02-10'), '2026-02-28');
  A.equal(Core.monthlyDueKey(makeTask({ type: 'monthly', monthday: -1 }), '2026-02-10'), '2026-02-28');
  A.equal(Core.monthlyDueKey(makeTask({ type: 'monthly', monthday: -1 }), '2024-02-10'), '2024-02-29');
  A.equal(Core.monthlyDueKey(makeTask({ type: 'monthly', monthday: 31 }), '2026-04-10'), '2026-04-30');
  A.equal(Core.monthlyDueKey(makeTask({ type: 'monthly', monthday: 15 }), '2026-02-10'), '2026-02-15');
});

test('taskState interval 轮次计算', () => {
  const t = makeTask({ type: 'interval', everyN: 3, anchor: '2026-10-20' });
  const s = Core.taskState(t, '2026-10-25');
  A.equal(s.available, true);
  A.equal(s.cycleStart, '2026-10-23');
  A.equal(s.cycleEnd, '2026-10-25');
  A.equal(s.occurrenceKey, 'I:2026-10-23');
  A.equal(s.cycleDay, 3);
  A.equal(s.daysLeft, 0);
  A.equal(s.totalDays, 3);

  // anchor 当天是第 1 轮第 1 天
  const anchorDay = Core.taskState(t, '2026-10-20');
  A.equal(anchorDay.cycleStart, '2026-10-20');
  A.equal(anchorDay.cycleDay, 1);
  A.equal(anchorDay.daysLeft, 2);
});

test('taskState interval anchor 在未来则不可得', () => {
  const t = makeTask({ type: 'interval', everyN: 3, anchor: '2026-10-30' });
  const s = Core.taskState(t, TODAY);
  A.equal(s.available, false);
  A.equal(s.complete, false);
  A.equal(s.daysLeft, 6);
  A.equal(s.cycleDay, 0);
  A.equal(s.cycleStart, '2026-10-30');
  A.equal(s.occurrenceKey, 'I:2026-10-30');
});

test('taskState urgent 截止与逾期', () => {
  const t = makeTask({ type: 'urgent', due: TODAY, priority: 'high' });
  const today = Core.taskState(t, TODAY);
  A.equal(today.available, true);
  A.equal(today.overdue, false);
  A.equal(today.daysLeft, 0);
  A.equal(today.cycleStart, TODAY);
  A.equal(today.cycleEnd, TODAY);
  A.equal(today.occurrenceKey, 'once');

  const late = Core.taskState(t, '2026-10-27');
  A.equal(late.overdue, true);
  A.equal(late.overdueDays, 3);
  A.equal(late.daysLeft, -3);

  const done = makeTask({
    type: 'urgent',
    due: TODAY,
    completions: { once: '2026-10-24T09:00:00.000Z' }
  });
  const stateDone = Core.taskState(done, '2026-10-27');
  A.equal(stateDone.complete, true);
  A.equal(stateDone.overdue, false);
  A.equal(stateDone.overdueDays, 0);
});

test('setTaskCompletion 返回新对象且不修改 task', () => {
  const t = makeTask({ type: 'daily' });
  const snapshot = JSON.stringify(t);
  const completions = Core.setTaskCompletion(t, TODAY, true);
  A.ok(completions !== t.completions);
  A.equal(Object.keys(t.completions).length, 0);
  A.equal(JSON.stringify(t), snapshot);
  A.ok(typeof completions[TODAY] === 'string');
  A.equal(Core.isTaskComplete(Object.assign({}, t, { completions }), TODAY), true);

  const removed = Core.setTaskCompletion(Object.assign({}, t, { completions }), TODAY, false);
  A.equal(removed[TODAY], undefined);
  A.deep(removed, {});
});

test('dueLabel 文案与 tone', () => {
  const todayUrgent = makeTask({ type: 'urgent', due: TODAY });
  A.deep(Core.dueLabel(todayUrgent, TODAY), { text: '今天截止', tone: 'warn' });
  const overdueUrgent = makeTask({ type: 'urgent', due: '2026-10-22' });
  A.deep(Core.dueLabel(overdueUrgent, TODAY), { text: '逾期 2 天', tone: 'danger' });
  const futureUrgent = makeTask({ type: 'urgent', due: '2026-10-26' });
  A.deep(Core.dueLabel(futureUrgent, TODAY), { text: '2 天后截止', tone: 'normal' });
  const doneUrgent = makeTask({
    type: 'urgent',
    due: TODAY,
    completions: { once: '2026-10-24T09:00:00.000Z' }
  });
  A.deep(Core.dueLabel(doneUrgent, TODAY), { text: '已完成', tone: 'normal' });

  A.deep(Core.dueLabel(makeTask({ type: 'weekly' }), TODAY), { text: '本周', tone: 'normal' });
  A.deep(Core.dueLabel(makeTask({ type: 'monthly' }), TODAY), { text: '本月', tone: 'normal' });
  A.deep(Core.dueLabel(makeTask({ type: 'daily' }), TODAY), { text: '今天', tone: 'normal' });

  const interval = makeTask({ type: 'interval', everyN: 3, anchor: '2026-10-20' });
  A.deep(Core.dueLabel(interval, '2026-10-25'), { text: '本轮剩 0 天', tone: 'warn' });
  A.deep(Core.dueLabel(interval, '2026-10-24'), { text: '本轮剩 1 天', tone: 'warn' });
  A.deep(Core.dueLabel(interval, '2026-10-23'), { text: '本轮剩 2 天', tone: 'normal' });
  const futureInterval = makeTask({ type: 'interval', everyN: 3, anchor: '2026-10-30' });
  A.deep(Core.dueLabel(futureInterval, TODAY), { text: '6 天后开始', tone: 'normal' });
});

test('taskStreak daily 连续完成与断档', () => {
  const streak3 = makeTask({
    type: 'daily',
    completions: {
      '2026-10-24': 'x',
      '2026-10-23': 'x',
      '2026-10-22': 'x',
      '2026-10-20': 'x'
    }
  });
  A.equal(Core.taskStreak(streak3, null, TODAY), 3);

  const missingToday = makeTask({
    type: 'daily',
    completions: { '2026-10-23': 'x', '2026-10-22': 'x' }
  });
  A.equal(Core.taskStreak(missingToday, null, TODAY), 2);

  const gap = makeTask({ type: 'daily', completions: { '2026-10-21': 'x' } });
  A.equal(Core.taskStreak(gap, null, TODAY), 0);
});

test('taskStreak weekly / monthly / interval / urgent', () => {
  const weekly = makeTask({
    type: 'weekly',
    completions: {
      'W:2026-10-19': 'x',
      'W:2026-10-12': 'x',
      'W:2026-10-05': 'x'
    }
  });
  A.equal(Core.taskStreak(weekly, null, TODAY), 3);
  const weeklyGap = makeTask({
    type: 'weekly',
    completions: { 'W:2026-10-12': 'x', 'W:2026-10-05': 'x' }
  });
  A.equal(Core.taskStreak(weeklyGap, null, TODAY), 2);

  const monthly = makeTask({
    type: 'monthly',
    completions: {
      'M:2026-10': 'x',
      'M:2026-09': 'x',
      'M:2026-07': 'x'
    }
  });
  A.equal(Core.taskStreak(monthly, null, TODAY), 2);

  const interval = makeTask({
    type: 'interval',
    everyN: 3,
    anchor: '2026-10-01',
    completions: {
      'I:2026-10-22': 'x',
      'I:2026-10-19': 'x',
      'I:2026-10-16': 'x'
    }
  });
  A.equal(Core.taskStreak(interval, null, TODAY), 3);

  A.equal(Core.taskStreak(makeTask({ type: 'urgent', due: TODAY }), null, TODAY), 0);
});

// ============================================================
// 4. 火苗
// ============================================================
test('fireState 燃料进度与点亮', () => {
  const fuelA = makeTask({
    id: 't_fuel_a',
    fire: true,
    completions: { [TODAY]: 'x' }
  });
  const fuelB = makeTask({ id: 't_fuel_b', fire: true });
  const db = makeDb({ tasks: [fuelA, fuelB] });
  const state = Core.fireState(db, TODAY);
  A.equal(state.configured, true);
  A.equal(state.total, 2);
  A.equal(state.done, 1);
  A.equal(state.lit, false);
  A.equal(state.tasks.length, 2);
  A.equal(state.missing.length, 1);
  A.equal(state.missing[0].id, 't_fuel_b');

  const allDone = makeDb({
    tasks: [
      makeTask({ id: 't_a', fire: true, completions: { [TODAY]: 'x' } }),
      makeTask({ id: 't_b', fire: true, completions: { [TODAY]: 'x' } })
    ]
  });
  const lit = Core.fireState(allDone, TODAY);
  A.equal(lit.lit, true);
  A.equal(lit.done, 2);
  A.deep(lit.missing, []);
});

test('fireState 排除归档/不可得，无燃料为未配置', () => {
  const empty = Core.fireState(makeDb({ tasks: [] }), TODAY);
  A.equal(empty.configured, false);
  A.equal(empty.total, 0);
  A.equal(empty.lit, false);

  const archived = makeDb({
    tasks: [makeTask({ id: 't_arch', fire: true, archived: true })]
  });
  const state = Core.fireState(archived, TODAY);
  A.equal(state.configured, false);
  A.equal(state.total, 0);

  const futureInterval = makeDb({
    tasks: [makeTask({ id: 't_future', fire: true, type: 'interval', everyN: 3, anchor: '2026-10-30' })]
  });
  const future = Core.fireState(futureInterval, TODAY);
  A.equal(future.configured, true);
  A.equal(future.total, 0);
  A.equal(future.lit, false);
});

test('buildDayLog 生成快照且不写 db', () => {
  const fuel = makeTask({ id: 't_fuel', fire: true, completions: { [TODAY]: 'x' } });
  const extra = makeTask({ id: 't_extra', fire: false });
  const db = makeDb({ tasks: [fuel, extra] });
  const snapshot = JSON.stringify(db);
  const log = Core.buildDayLog(db, TODAY, '2026-10-24T22:00:00.000Z');
  A.equal(log.lit, true);
  A.deep(log.required, ['t_fuel']);
  A.deep(log.done, ['t_fuel']);
  A.equal(log.total, 2);
  A.equal(log.updatedAt, '2026-10-24T22:00:00.000Z');
  A.equal(JSON.stringify(db), snapshot);
});

test('taskProgress 统计总量/分组', () => {
  const tasks = [
    makeTask({ id: 'd1', type: 'daily', completions: { [TODAY]: 'x' } }),
    makeTask({ id: 'd2', type: 'daily' }),
    makeTask({
      id: 'w1',
      type: 'weekly',
      completions: { 'W:2026-10-19': 'x' }
    }),
    makeTask({ id: 'i1', type: 'interval', everyN: 3, anchor: '2026-10-30' })
  ];
  const progress = Core.taskProgress(makeDb({ tasks }), TODAY);
  A.equal(progress.total, 3); // 未来 anchor 的 interval 不计入
  A.equal(progress.done, 2);
  A.equal(progress.percent, 67);
  A.equal(progress.daily.total, 2);
  A.equal(progress.daily.done, 1);
  A.equal(progress.daily.percent, 50);
  A.equal(progress.extra.total, 1);
  A.equal(progress.extra.done, 1);
  A.equal(progress.extra.percent, 100);
});

test('streakInfo lit 状态与 30 天窗口', () => {
  const fuel = makeTask({ id: 't_fuel', fire: true, completions: { [TODAY]: 'x' } });
  const db = makeDb({
    tasks: [fuel],
    dayLog: {
      '2026-10-22': dayLogEntry(true, ['t_fuel']),
      '2026-10-23': dayLogEntry(true, ['t_fuel'])
    }
  });
  const info = Core.streakInfo(db, TODAY);
  A.equal(info.state, 'lit');
  A.equal(info.litToday, true);
  A.equal(info.frozen, false);
  A.equal(info.current, 3);
  A.equal(info.best, 3);
  A.equal(info.totalLit, 3);
  A.equal(info.days.length, 30);
  A.equal(info.days[0].date, '2026-09-25');
  A.equal(info.days[29].date, TODAY);
  const byDate = {};
  info.days.forEach((d) => { byDate[d.date] = d.status; });
  A.equal(byDate['2026-10-22'], 'lit');
  A.equal(byDate['2026-10-23'], 'lit');
  A.equal(byDate[TODAY], 'lit');
  A.equal(byDate['2026-10-21'], 'missed');
});

test('streakInfo frozen：今天未亮且昨天亮', () => {
  const fuel = makeTask({ id: 't_fuel', fire: true });
  const db = makeDb({
    tasks: [fuel],
    dayLog: {
      '2026-10-22': dayLogEntry(true, ['t_fuel']),
      '2026-10-23': dayLogEntry(true, ['t_fuel'])
    }
  });
  const info = Core.streakInfo(db, TODAY);
  A.equal(info.state, 'frozen');
  A.equal(info.frozen, true);
  A.equal(info.litToday, false);
  A.equal(info.current, 2); // 保留截至昨天的连续天数
  const todayStatus = info.days.find((d) => d.date === TODAY).status;
  A.equal(todayStatus, 'frozen');
});

test('streakInfo out：昨天也没亮', () => {
  const fuel = makeTask({ id: 't_fuel', fire: true });
  const db = makeDb({
    tasks: [fuel],
    dayLog: { '2026-10-20': dayLogEntry(true, ['t_fuel']) }
  });
  const info = Core.streakInfo(db, TODAY);
  A.equal(info.state, 'out');
  A.equal(info.current, 0);
  A.equal(info.frozen, false);
  const todayStatus = info.days.find((d) => d.date === TODAY).status;
  A.equal(todayStatus, 'missed');
});

test('streakInfo unset：没有燃料任务', () => {
  const db = makeDb({ tasks: [makeTask({ id: 't1', fire: false })] });
  const info = Core.streakInfo(db, TODAY);
  A.equal(info.state, 'unset');
  A.equal(info.current, 0);
  A.equal(info.best, 0);
  A.equal(info.totalLit, 0);
  A.equal(info.days.length, 30);
});

test('streakInfo best 跨窗口统计历史最长连续', () => {
  const fuel = makeTask({ id: 't_fuel', fire: true, completions: { [TODAY]: 'x' } });
  const dayLog = {
    '2026-09-01': dayLogEntry(true, ['x']),
    '2026-09-02': dayLogEntry(true, ['x']),
    '2026-09-03': dayLogEntry(true, ['x']),
    '2026-09-04': dayLogEntry(true, ['x']),
    '2026-09-05': dayLogEntry(true, ['x']),
    '2026-10-22': dayLogEntry(true, ['x']),
    '2026-10-23': dayLogEntry(true, ['x'])
  };
  const info = Core.streakInfo(makeDb({ tasks: [fuel], dayLog }), TODAY);
  A.equal(info.best, 5);
  A.equal(info.current, 3);
  A.equal(info.totalLit, 8);
});

test('streakInfo 今日快照缺失时用 fireState 推导 lit', () => {
  const fuel = makeTask({ id: 't_fuel', fire: true, completions: { [TODAY]: 'x' } });
  const db = makeDb({ tasks: [fuel], dayLog: {} });
  const info = Core.streakInfo(db, TODAY);
  A.equal(info.litToday, true);
  A.equal(info.state, 'lit');
  A.equal(info.current, 1);
  A.equal(info.totalLit, 1);
});

test('streakInfo 有今日快照时以快照为准', () => {
  const fuel = makeTask({ id: 't_fuel', fire: true, completions: { [TODAY]: 'x' } });
  const db = makeDb({
    tasks: [fuel],
    dayLog: { [TODAY]: dayLogEntry(false, []) }
  });
  const info = Core.streakInfo(db, TODAY);
  A.equal(info.litToday, false);
  A.equal(info.state, 'out');
  A.equal(info.current, 0);
});

// ============================================================
// 5. 提醒
// ============================================================
test('reminderAt 构造当天提醒时间', () => {
  const t = makeTask({ type: 'daily', reminder: { enabled: true, time: '21:00' } });
  const atDate = Core.reminderAt(t, TODAY);
  A.ok(atDate instanceof Date);
  A.equal(atDate.getTime(), at(2026, 10, 24, 21, 0).getTime());

  const disabled = makeTask({ type: 'daily', reminder: { enabled: false, time: '21:00' } });
  A.equal(Core.reminderAt(disabled, TODAY), null);

  const completed = makeTask({
    type: 'daily',
    reminder: { enabled: true, time: '21:00' },
    completions: { [TODAY]: 'x' }
  });
  A.equal(Core.reminderAt(completed, TODAY), null);
});

test('reminderAt urgent 只在 due 当天', () => {
  const t = makeTask({ type: 'urgent', due: '2026-10-25', reminder: { enabled: true, time: '21:00' } });
  A.equal(Core.reminderAt(t, TODAY), null);
  const dueDay = Core.reminderAt(t, '2026-10-25');
  A.ok(dueDay instanceof Date);
  A.equal(dueDay.getDate(), 25);
});

test('reminderSignature 格式', () => {
  const t = makeTask({ id: 't_sig', type: 'daily', reminder: { enabled: true, time: '8:05' } });
  A.equal(Core.reminderSignature(t, TODAY), 't_sig|2026-10-24|08:05');
});

test('shouldFireReminder 到点/fired/完成/紧急日', () => {
  const t = makeTask({ id: 't_r', type: 'daily', reminder: { enabled: true, time: '21:00' } });
  const db = makeDb({ tasks: [t] });
  A.equal(Core.shouldFireReminder(db, t, TODAY, at(2026, 10, 24, 20, 59)), false);
  A.equal(Core.shouldFireReminder(db, t, TODAY, at(2026, 10, 24, 21, 0)), true);
  A.equal(Core.shouldFireReminder(db, t, TODAY, at(2026, 10, 24, 23, 0)), true);
  A.equal(Core.shouldFireReminder(db, t, TODAY, at(2026, 10, 25, 21, 0)), false); // 非当天
  A.equal(Core.shouldFireReminder(db, t, TODAY, null), false);

  const firedDb = makeDb({
    tasks: [t],
    fired: { 't_r|2026-10-24|21:00': '2026-10-24T21:00:05.000Z' }
  });
  A.equal(Core.shouldFireReminder(firedDb, t, TODAY, at(2026, 10, 24, 21, 5)), false);

  const doneTask = makeTask({
    id: 't_r2',
    type: 'daily',
    reminder: { enabled: true, time: '21:00' },
    completions: { [TODAY]: 'x' }
  });
  A.equal(Core.shouldFireReminder(makeDb({ tasks: [doneTask] }), doneTask, TODAY, at(2026, 10, 24, 21, 5)), false);
});

test('shouldFireReminder 稍后提醒（snooze）语义', () => {
  const t = makeTask({ id: 't_snooze', type: 'daily', reminder: { enabled: true, time: '21:00' } });
  const futureSnooze = makeDb({
    tasks: [t],
    snoozes: { t_snooze: localIso(2026, 10, 24, 21, 10) }
  });
  A.equal(
    Core.shouldFireReminder(futureSnooze, t, TODAY, at(2026, 10, 24, 21, 5)),
    false
  );
  const pastSnooze = makeDb({
    tasks: [t],
    snoozes: { t_snooze: localIso(2026, 10, 24, 13, 0) },
    fired: { 't_snooze|2026-10-24|21:00': '2026-10-24T21:00:00.000Z' }
  });
  A.equal(
    Core.shouldFireReminder(pastSnooze, t, TODAY, at(2026, 10, 24, 21, 10)),
    true
  );
});

test('collectReminders due/upcoming 排序与过滤', () => {
  const t1 = makeTask({ id: 't_1', type: 'daily', reminder: { enabled: true, time: '21:00' } });
  const t2 = makeTask({ id: 't_2', type: 'daily', reminder: { enabled: true, time: '21:00' } });
  const t3 = makeTask({ id: 't_3', type: 'daily', reminder: { enabled: true, time: '22:00' } });
  const doneT = makeTask({
    id: 't_done',
    type: 'daily',
    reminder: { enabled: true, time: '21:00' },
    completions: { [TODAY]: 'x' }
  });
  const db = makeDb({
    tasks: [t1, t2, t3, doneT],
    fired: { 't_2|2026-10-24|21:00': '2026-10-24T21:00:01.000Z' }
  });
  const result = Core.collectReminders(db, TODAY, at(2026, 10, 24, 21, 5));
  A.equal(result.due.length, 1);
  A.equal(result.due[0].task.id, 't_1');
  A.equal(result.due[0].signature, 't_1|2026-10-24|21:00');
  A.equal(result.upcoming.length, 1);
  A.equal(result.upcoming[0].task.id, 't_3');
  A.ok(result.upcoming[0].at.getTime() > at(2026, 10, 24, 21, 5).getTime());
});

test('collectReminders 紧急任务非 due 日与 snooze 过滤', () => {
  const urgent = makeTask({
    id: 't_urgent',
    type: 'urgent',
    due: '2026-10-25',
    reminder: { enabled: true, time: '21:00' }
  });
  const snoozed = makeTask({ id: 't_sz', type: 'daily', reminder: { enabled: true, time: '22:00' } });
  const db = makeDb({
    tasks: [urgent, snoozed],
    snoozes: { t_sz: localIso(2026, 10, 24, 23, 0) }
  });
  const result = Core.collectReminders(db, TODAY, at(2026, 10, 24, 20, 0));
  A.equal(result.due.length, 0);
  A.equal(result.upcoming.length, 0);
});

test('isReminderActive 规则', () => {
  const daily = makeTask({ type: 'daily', reminder: { enabled: true, time: '21:00' } });
  A.equal(Core.isReminderActive(daily, TODAY), true);
  A.equal(Core.isReminderActive(makeTask({ type: 'daily', reminder: { enabled: false, time: '21:00' } }), TODAY), false);
  A.equal(
    Core.isReminderActive(
      makeTask({ type: 'daily', reminder: { enabled: true, time: '21:00' }, completions: { [TODAY]: 'x' } }),
      TODAY
    ),
    false
  );
  const urgent = makeTask({ type: 'urgent', due: '2026-10-25', reminder: { enabled: true, time: '21:00' } });
  A.equal(Core.isReminderActive(urgent, TODAY), false);
  A.equal(Core.isReminderActive(urgent, '2026-10-25'), true);
});

// ============================================================
// 6. 排序 / 汇总
// ============================================================
test('sortTasksForToday 紧要优先、提醒、未完成、创建时间', () => {
  const u1 = makeTask({ id: 'u1', type: 'urgent', due: '2026-10-20', createdAt: '2026-09-01T00:00:00.000Z' });
  const u2 = makeTask({ id: 'u2', type: 'urgent', due: '2026-10-28', createdAt: '2026-09-02T00:00:00.000Z' });
  const n1 = makeTask({
    id: 'n1',
    type: 'daily',
    reminder: { enabled: true, time: '21:00' },
    createdAt: '2026-09-01T00:00:00.000Z'
  });
  const n2 = makeTask({ id: 'n2', type: 'daily', createdAt: '2026-08-01T00:00:00.000Z' });
  const n3 = makeTask({
    id: 'n3',
    type: 'daily',
    reminder: { enabled: true, time: '21:00' },
    completions: { [TODAY]: 'x' },
    createdAt: '2026-07-01T00:00:00.000Z'
  });
  const n4 = makeTask({
    id: 'n4',
    type: 'daily',
    completions: { [TODAY]: 'x' },
    createdAt: '2026-06-01T00:00:00.000Z'
  });
  const sorted = Core.sortTasksForToday([n4, n2, n1, u2, u1, n3], TODAY);
  A.deep(sorted.map((t) => t.id), ['u1', 'u2', 'n1', 'n3', 'n2', 'n4']);
  A.deep(sorted, [u1, u2, n1, n3, n2, n4]); // 返回入参对象引用
});

test('activeTasks / fireCandidates 过滤归档与非对象', () => {
  const a = makeTask({ id: 'a' });
  const b = makeTask({ id: 'b', archived: true });
  const active = Core.activeTasks([a, b, null, 'x']);
  A.deep(active, [a]);
  A.deep(Core.fireCandidates([a, b]), [a]);
  A.deep(Core.activeTasks(null), []);
});

test('weekOverview 周概览', () => {
  const fuel = makeTask({ id: 't_fuel', fire: true });
  const db = makeDb({
    tasks: [fuel],
    settings: { weekStart: 1 },
    dayLog: {
      '2026-10-19': dayLogEntry(true, ['a', 'b']),
      '2026-10-20': dayLogEntry(false, []),
      '2026-10-21': dayLogEntry(true, ['a']),
      '2026-10-22': dayLogEntry(false, ['b'])
    }
  });
  const overview = Core.weekOverview(db, TODAY);
  A.deep(overview, { litDays: 2, daysElapsed: 6, totalCheckins: 4, frozenDays: 2 });
});

test('weekOverview 支持周日为周首', () => {
  const db = makeDb({ dayLog: { '2026-10-18': dayLogEntry(true, []) } });
  const overview = Core.weekOverview(db, TODAY, 7);
  A.equal(overview.daysElapsed, 7);
  A.equal(overview.litDays, 1);
});

// ============================================================
// 7. normalizeDb 与 UMD/不可变性
// ============================================================
test('normalizeDb 处理 null/字符串/数组', () => {
  const nullDb = Core.normalizeDb(null);
  A.equal(nullDb.version, 1);
  A.deep(nullDb.tasks, []);
  A.deep(nullDb.dayLog, {});
  A.deep(nullDb.fired, {});
  A.deep(nullDb.snoozes, {});
  A.equal(nullDb.settings.name, '朋友');
  A.equal(nullDb.settings.theme, 'dark');
  A.equal(nullDb.settings.sound, true);
  A.equal(nullDb.settings.weekStart, 1);

  const strDb = Core.normalizeDb('garbage');
  A.equal(strDb.version, 1);
  A.deep(strDb.tasks, []);

  const arrDb = Core.normalizeDb([]);
  A.deep(arrDb.tasks, []);
});

test('normalizeDb 修复坏 tasks / dayLog / fired / snoozes / settings', () => {
  const db = Core.normalizeDb({
    version: 'x',
    tasks: [
      null,
      'bad',
      42,
      { id: 't_a', title: '', type: 'monthly', monthday: -1 },
      { id: 't_a', title: '重复 id' },
      { id: 't_b', title: '正常', type: 'weekly', fire: true }
    ],
    settings: { name: '  小明 ', theme: 'blue', sound: 'no', weekStart: 3, seeded: 1 },
    dayLog: {
      'bad-key': { lit: true },
      '2026-02-30': { lit: true },
      '2026-10-20': 'bad',
      '2026-10-21': { lit: 1, total: -5, done: 'x', required: ['a', 2] },
      '2026-10-22': { lit: true, done: ['a'], required: ['a'], total: 1 }
    },
    fired: { 't_a|2026-10-24|21:00': '2026-10-24T21:00:00.000Z', bad: 'x', 'b-k': 'not-date' },
    snoozes: { t_a: '2026-10-24T21:10:00.000Z', t_b: 'bad', '': '2026-10-24T21:10:00.000Z' }
  });
  A.equal(db.version, 1);
  A.equal(db.tasks.length, 2);
  A.equal(db.tasks[0].id, 't_a');
  A.equal(db.tasks[0].title, '未命名任务');
  A.equal(db.tasks[0].monthday, -1);
  A.equal(db.tasks[1].id, 't_b');
  A.equal(db.tasks[1].fire, true);
  A.equal(db.settings.name, '小明');
  A.equal(db.settings.theme, 'dark');
  A.equal(db.settings.sound, true);
  A.equal(db.settings.weekStart, 1);
  A.equal(db.settings.seeded, false);
  A.deep(Object.keys(db.dayLog), ['2026-10-21', '2026-10-22']);
  A.equal(db.dayLog['2026-10-21'].lit, false);
  A.equal(db.dayLog['2026-10-21'].total, 1);
  A.deep(db.dayLog['2026-10-21'].done, []);
  A.deep(db.dayLog['2026-10-21'].required, ['a']);
  A.deep(Object.keys(db.fired), ['t_a|2026-10-24|21:00']);
  A.deep(Object.keys(db.snoozes), ['t_a']);
});

test('normalizeDb 不修改入参', () => {
  const raw = {
    version: 1,
    tasks: [{ id: 't1', title: 'x', fire: true }],
    settings: { weekStart: 7 },
    dayLog: { '2026-10-20': { lit: true, done: ['t1'] } }
  };
  const snapshot = JSON.stringify(raw);
  Core.normalizeDb(raw);
  A.equal(JSON.stringify(raw), snapshot);
});

test('uid 前缀与唯一性', () => {
  const a = Core.uid('t');
  const b = Core.uid('t');
  A.ok(a.indexOf('t_') === 0);
  A.notEqual(a, b);
  A.ok(Core.uid().indexOf('id_') === 0);
  A.ok(Core.uid('x').indexOf('x_') === 0);
});

test('taskState / occurrenceKey 不修改 task', () => {
  const t = makeTask({ type: 'interval', everyN: 3, anchor: '2026-10-20', fire: true });
  const snapshot = JSON.stringify(t);
  Core.taskState(t, '2026-10-25');
  Core.occurrenceKey(t, '2026-10-25');
  Core.fireState(makeDb({ tasks: [t] }), TODAY);
  Core.streakInfo(makeDb({ tasks: [t] }), TODAY);
  A.equal(JSON.stringify(t), snapshot);
});

// ============================================================
// 汇总
// ============================================================
console.log('\n----------------------------------------');
console.log('用例: ' + passed + ' 通过 / ' + failed + ' 失败（共 ' + (passed + failed) + '）');
console.log('断言: ' + assertions + ' 条');
console.log('----------------------------------------');

if (failed > 0) {
  console.log('\n失败详情:');
  failures.forEach((item) => {
    console.log('\n' + item.name);
    console.log(item.err && item.err.stack ? item.err.stack : item.err);
  });
  process.exitCode = 1;
} else if (passed < 35) {
  console.log('未达到至少 35 个用例的要求');
  process.exitCode = 1;
}
