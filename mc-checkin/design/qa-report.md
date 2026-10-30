# 方块清单 · Craft Check-in — QA 验收报告

- 报告人：qa-dev（独立 QA）
- 日期：2026-10-24 22:58（Asia/Hong_Kong）
- 被测版本：`app.js` 22:55:48（P3-1 修复后 22:59 重新验证）/ `index.html` 22:55:45 / `styles.css` 22:58:28（最终锁定 23:00:48，147319 bytes）/ `core.js` 21:58:36（与 ember 版逻辑一致，仅注释主题化）
- 被测对象：`craft-checkin/index.html` + `styles.css` + `core.js` + `app.js`（源文件，非 standalone）
- 测试方式：jsdom 30.1.1 对 `file://` 源页面做 DOM/行为回归 + 静态品牌词/资源/可访问性检查
- 本次结论：**PASS 19 / FAIL 0（exit code 0）**；P0 阻断 **0**，P1 功能错 **0**，P2 视觉/可访问性 **0**，P3 建议/记录 **2 项**
- 主题改造验收：火苗主题词、`i-flame`、旧 class（`chip-fire`/`is-fuel`/`fuel-*`/`fire-action`/`flameStage` 等）在源码与渲染 DOM 中均为 **0**；工作台/材料/配方/合成记录四态与 9 格上限均通过

---

## 1. 实际运行命令与结果

环境：Node v24.21.0（`C:\Users\Chris\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`），jsdom 30.1.1（`E:\workspace\paint\.audit\node_modules`），时区 Asia/Hong_Kong。

```powershell
$env:NODE_PATH='E:\workspace\paint\.audit\node_modules'
& 'C:\Users\Chris\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' `
  'E:\workspace\paint\craft-checkin\tests\ui.test.js'
```

最终实跑输出（2026-10-24 22:58:51，重复执行结果一致）：

```
方块清单 · Craft Check-in — jsdom UI 测试
页面: file:///E:/workspace/paint/craft-checkin/index.html
Node: v24.21.0 · jsdom: 30.1.1
固定时间: 2026-10-24T21:50（2026-10-24）· 本地时区: Asia/Hong_Kong

PASS  T01 demo 首开：合成成功 / 连续 12 天 / 9 任务 / 3 材料 / 工作台输出铁镐 / localStorage craftCheckin.v1 / 无错误
PASS  T02 ?state=frozen：合成中 / 输出 ? / 还差 1 种材料 / 补材料转合成成功并可回退
PASS  T02b ?state=crafting 别名 = frozen：合成中 + 输出 ?；?state=empty/interrupted 走 unset/out
PASS  T03 勾选与取消：任务行 is-done / 进度环 --pct / 待合成 badge 同步变化
PASS  T04 添加任务：弹窗 / 空标题校验 / 每周+提醒 / DOM 与 localStorage 出现 / 默认不计入配方
PASS  T05 五种类型条件字段：#fieldWeekly/#fieldMonthly/#fieldInterval/#fieldUrgent 显示隐藏 + monthday 1–31/最后一天
PASS  T06 编辑：回填字段 / 改标题保存 / 列表与 localStorage 更新
PASS  T07 删除：确认弹窗 / 取消不删 / 确认后从 DOM 与 localStorage 移除
PASS  T08 配方材料：任务行 .recipe-action 切换 / 合成记录页 .material-select 切换 / #fuelList 数量同步
PASS  T08b 配方产出：4 材料完成 -> 金苹果 / 5 材料完成 -> 钻石 is-legendary
PASS  T09 视图与筛选：导航 hidden / 今日 daily·extra / 任务库 urgent / 搜索 / 合成记录页四种状态与图例
PASS  T10 主题：切换 html[data-theme] 并写入 localStorage，重新加载后保持
PASS  T11 提醒：到点 toast / 完成后不重复 / 10 分钟后再提醒写入 snoozes
PASS  T12 持久化：同一份 JSON 注入新页面后任务 / 完成状态 / 主题 / 工作台一致
PASS  T13 ?selftest=1：等待后 #selftest-result 含 SELFTEST PASS 且 html[data-selftest=pass]
      CSS 覆盖检查时间: 2026-10-24T14:58:51.646Z · styles.css mtime: 2026-10-24T14:58:28.424Z · styles.css 大小: 147319 bytes
      styles.css 暂无对应规则的渲染 class (8): bell-popover, conditional-fields, craft-slot-mini, recipe-page-card,
        reminder-card, task-group-daily, task-group-extra, tasks-card
PASS  T14 静态检查：品牌词/无 i-flame/图标完整/无外部资源/无重复 id/label/[hidden]/CSS 覆盖记录
PASS  T15 跨周设置：settings.weekStart=7 时周任务 occurrenceKey 使用周日，UI 周条 7 格
PASS  T15b 跨周设置回归：weekStart=7 时 #weekBars 星期标签按周日起排（日,一,二,三,四,五,六）
PASS  T16 工作台 9 格上限：第 10 个材料被拒绝（表单与 .recipe-action 两条路径），移出一个后可再加入

PASS 19 / FAIL 0
```

包装脚本（本机默认执行策略禁止未签名脚本，必须带 `-ExecutionPolicy Bypass`）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File E:\workspace\paint\craft-checkin\tests\run-ui.ps1
# 结果同上：PASS 19 / FAIL 0，exit code 0
```

测试文件：`craft-checkin/tests/ui.test.js`、`craft-checkin/tests/run-ui.ps1`。全部 19 个用例、约 20 次页面加载，`VirtualConsole` 捕获的 `jsdomError` / `console.error` 均为 0；`?selftest=1` 页面自检 **14/14 PASS**。

> 说明：QA 期间 `app.js`/`index.html`/`styles.css` 由 Lead、visual-dev 持续更新（styles.css 22:46 时仍为 389 bytes 占位，22:57 已 146KB）。上表是 22:58:51 针对当时版本的结果；若源文件在此之后继续改动请重跑本套件。

---

## 2. 已验证范围

| 需求 | 对应测试 | 覆盖点（全部实测通过） |
| --- | --- | --- |
| 存储键 | T01/T12 | localStorage 键为 `craftCheckin.v1`；快照注入新页面后任务/完成/主题/工作台完整恢复 |
| 品牌/标题 | T01/T14 | `document.title` 含「方块清单 · Craft Check-in」；侧栏品牌「方块清单 / CRAFT CHECK-IN」；无任何火苗主题词 |
| demo 首开 | T01 | `#hero[data-state=lit]`、`#craftStage[data-state=lit]`、`#craftStateText=合成成功`、`#heroStreak=12`、`#heroFuelCount=3/3`、今日 9 任务（每日 4/额外 5）、3 材料、任务库 9 条、`#todayBadge="2 项待合成"`、`--pct=78` |
| 工作台 3×3 | T01/T02/T02b/T08b/T16 | `#craftGrid` 恰好 9 `.craft-slot`；demo 3 `.is-filled` + 3 `.is-done` + 6 `.is-empty`；`#craftResultItem=⛏️`、`#craftResultName=铁镐`、`.craft-output.is-ready`；unset 时 9 格全空 |
| 冻结/合成中 | T02/T02b | `?state=frozen`：hero/stage frozen、`#craftStateText=合成中`、`#craftResultItem=?`、`#craftResultName=等待材料`、`.craft-output.is-empty`、`#heroStreak=11`（SPEC 语义未变）、`还差 1 种材料`；补材料→合成成功（⛏️/铁镐/连续 12 + 「合成成功！」toast），取消回退 |
| 状态别名 | T02b | `?state=crafting`→frozen；`?state=empty`→unset（空配方）；`?state=interrupted`→out（等待材料）；`#firePageStateLabel` 四态同步 |
| 勾选/取消 | T03 | 普通任务行 `.is-done`、`--pct 78→89→78`、`#todayBadge` `2 项待合成→1 项待合成→2`、`#navTodayCount` 同步、localStorage completions 写入/删除、完成 toast |
| 添加 | T04 | 弹窗+焦点、空标题校验「给任务起个名字吧。」不写库、每周+提醒 22:30 提交后 DOM/localStorage 一致、新任务默认不计入配方 |
| 五类条件字段 | T05 | 默认 daily 四块全 hidden；weekly/monthly/interval/urgent 分别只显示 `#fieldWeekly/#fieldMonthly/#fieldInterval/#fieldUrgent`；`#monthday` 32 项（1–31 + 最后一天/-1）；urgent 三字段存在 |
| 编辑/删除 | T06/T07 | 编辑回填（含 `#fireEnabled=true` 材料）、改标题保存列表+localStorage 更新；删除取消不删、确认后 9→8、DOM 与 localStorage 同步，确认文案用「合成记录」 |
| 材料切换 | T08 | 任务行 `.recipe-action`（`is-on`/`aria-pressed`/`is-material`）3→4→3；合成记录页 `.material-select` 切换同步 `#fuelList .recipe-item` 数量；新增未完成材料→等待状态（预期） |
| 配方产出 | T08b | 4 材料完成→🍎 金苹果；5 材料完成→💎 钻石且 `is-legendary`；移出后回 4 材料产出；`#craftHint` 随产出更新 |
| 视图/筛选/搜索 | T09 | today/tasks/fire hidden 切换与 `aria-current`；今日 daily 4/extra 5/all 9；任务库 urgent 2；搜索命中/无结果空态/清空恢复；合成记录页 `#firePageTitle=合成记录`、`#craftPageGrid` 9 格、`#craftPageResultItem=⛏️`、4 个 `.craft-stat`、30 天格、图例「已合成/进行中/中断」 |
| 主题 | T10 | data-theme dark↔light、meta `#17150f`↔`#e9e2cf`、写入 localStorage；快照重载后保持 |
| 提醒 | T11 | 到点 `#reminderToast` 可见+标题正确+fired 签名；点「完成了」→任务完成/toast 隐藏/不重复；「10 分钟后再提醒」写 `db.snoozes=now+10min`，未到时间不重复 |
| 持久化 | T12 | 完成 `demo_journal`+切 light 的快照注入新页面：9 任务不重新种子、完成状态、主题、连续 12、工作台 ⛏️/3 完成格全部保持 |
| 自检 | T13 | `html[data-selftest=pass]`、`#selftest-result` 含 `SELFTEST PASS n/n` 与工作台/合成统计分项 |
| 静态检查 | T14 | index.html/app.js 无「火苗/火焰/燃烧/冻结/熄灭/燃料」；无可执行 `i-flame`/`flameStage`/`chip-fire`/`is-fuel`/`fuel-*`/`fire-action` 残留；渲染 DOM 无 i-flame 且所有 `<use href>` 图标引用可解析（app.js `icon()` 名全部存在）；无 http(s) 外链/CDN/远程字体；179 个 id 无重复；表单控件均有可访问名称；`[hidden]` 规则存在；CSS 覆盖记录（见 P3-2） |
| 跨周设置 | T15/T15b | `weekStart=7`：`startOfWeek=2026-10-18`（周日）、weekly occurrenceKey `W:2026-10-18`、勾选后写 `W:2026-10-18` 且保留历史 `W:2026-10-19`、周条 7 格 + 标签 `日,一,二,三,四,五,六`；`#weeklyHint=周日开始`、`#weeklyHintText` 含「下周日」（Lead 修复后） |
| 9 格上限 | T16 | 3+6 材料=9，`#craftGrid` 9 格填满；第 10 个经表单/编辑/`.recipe-action` 三条路径均被拒绝（错误文案「工作台只有 9 个格子」）；移出一个后可加入第 9 个 |

---

## 3. 缺陷列表（按严重度）

### P0 阻断（0 条）

无。

### P1 功能错（0 条）

无。工作台四态、材料/配方切换、9 格上限正常路径、提醒、持久化、跨周计算均符合预期。

### P2 视觉 / 可访问性（0 条）

无。

### P3 建议 / 记录（2 条）

#### P3-1 材料上限按「可用材料数」判断，理论边界下可配置超过 9 个材料（多出的材料不显示）— ✅ Lead 已修复

- **修复（2026-10-24 23:00，Lead）**：两处 `>= 9` 判断改为 `Core.activeTasks(state.db.tasks).filter(t => t.fire).length`，统计所有已配置材料（含未来才可用的 interval），不再只看 `fireState().total`；修复后再次运行本套件 PASS 19 / FAIL 0。以下保留原始复现记录。
- 复现（全部走 UI 可达，`?now=2026-10-24T21:50`）：
  1. demo 开启后通过「添加任务」新建一个 **interval 任务，起始日期设为未来**（如 `2026-10-30`），并勾选「完成后计入合成」——此时可用材料 3 个，未超限，允许加入；
  2. 再通过添加任务连续加入 6 个每日材料（每次加入时可用材料 < 9，均被允许）；
  3. 此时 localStorage 中 `fire=true` 的任务共 **10 个**，但「可用材料数」为 9：`#craftGrid` 仍只显示 9 格，第 10 个（未来才可用的）材料不可见；`#fuelCountBadge` 为 `3/9`。
- 期望：工作台 9 格是「已配置配方材料」上限；无论材料当前是否可用，配置材料数都应 ≤ 9，或至少给出超限提示/隐藏逻辑说明。
- 实际（探针实测）：`configured fire tasks = 10`、`available total = 9`、`#craftGrid` 9 格、`#fuelList` 9 条、无错误；等未来材料可用后会出现「配置 10 / 格子 9」的不一致。
- 相关代码：`app.js:1301`（`toggleFire`）与 `app.js:1389`（`submitTaskForm`）均使用 `Core.fireState(state.db, todayKey()).total >= 9`，而 `core.js` 的 `fireState.total` 只统计 **available** 的火苗任务。
- 建议：上限判断改用「所有未归档且 `fire===true` 的任务数」（如 `Core.activeTasks(state.db.tasks).filter(t => t.fire).length >= 9`），或在 `fireState` 增加 `configuredCount` 供 UI 使用。
- 严重度判断：P3（边界场景，需要先加入未来才可用的周期任务；正常路径 9→10 已被正确拒绝，见 T16，不影响数据与主流程，仅显示/计数边界）。

#### P3-2 `styles.css` 重写中的 class 覆盖记录（不判失败，仅记录时间点）

- 检查时间：2026-10-24T14:58:51Z；`styles.css` mtime 14:58:28Z、大小 147319 bytes（QA 开始时为 389 bytes 占位，visual-dev 正在并行重写）。
- 当次仍有 8 个渲染/结构 class 无对应 CSS 规则：
  `bell-popover, conditional-fields, craft-slot-mini, recipe-page-card, reminder-card, task-group-daily, task-group-extra, tasks-card`
- 判断：其中 `craft-slot-mini` 属于火苗/记录页迷你工作台的状态变体，`task-group-*`/`tasks-card`/`reminder-card`/`recipe-page-card`/`bell-popover`/`conditional-fields` 为装饰性或布局容器 class；关键契约 class（`craft-slot`/`craft-output`/`chip-material`/`recipe-action`/`recipe-item`/`material-select`/`craft-stat`/`heat-cell`/`week-bar`/`toast` 等）均有规则。**因 visual-dev 仍在改样式，本项仅记录，不判 app/CSS 失败**；交付前建议以其最终版本再跑一次本套件确认清单收敛。
- 相关：`craft-checkin/styles.css`（最终检查见上表 T14 输出）。

### 已确认修复（QA 过程中发现问题 → Lead 修复 → 复验通过）

- `#fieldWeekly` 条件说明文案固定写「…下周一重新出现」，`weekStart=7` 时不正确。初测记录后 Lead 给该 `<p>` 加了 `id="weeklyHintText"` 并在 `app.js:1203-1204` 按 `weekStart` 更新；本套件 T15 现断言 `weekStart=7` 时 `#weeklyHintText` 含「下周日」，已 PASS。

---

## 4. 测试环境限制（明确不判 app 失败）

1. **jsdom `file://` 的 localStorage**：jsdom 30.1.1 中 file:// origin 为 opaque，`window.localStorage` 抛 `SecurityError`（真实 Chrome/Edge 允许 file:// 使用 localStorage，是本应用目标场景）。测试在 `beforeParse` 注入内存版 Storage（键 `craftCheckin.v1`）以验证持久化/提醒去重/主题保存；app 自身对 localStorage 异常已有 try/catch 守卫。
2. **无法使用 headless Chromium/Edge**：本沙箱 Chromium IPC 命名管道被拒，**未做截图/像素级视觉验证**；布局、Minecraft 像素质感、响应式断点、动画、主题对比度、截图验收由 Lead 另行负责。
3. **`requestAnimationFrame`**：测试使用 `pretendToBeVisual: true`，否则 toast/提醒动画会因无 rAF 报错。
4. **CSSOM 解析告警**：jsdom 的 cssom 对现代 CSS 可能产生 `css parsing` 类 jsdomError，测试单独收集、不计入失败（本次运行 0 条）。
5. jsdom 不实现 `Notification`/`AudioContext`/`Blob` 下载：app 有 guard（`notifyPermission` 返回 unsupported、`playChime`/导出 try/catch），测试只验证站内提醒与站内行为。

---

## 5. 未覆盖范围与剩余风险

- **真实浏览器视觉/布局**：1440×1000、390×844、无横向滚动、像素风纹理与主题对比度未验证（Chromium 不可用，交 Lead）。
- **动画/交互细节**：点燃/合成动画、toast 滑入、`prefers-reduced-motion`、临时 class（`just-crafted`、`is-highlight`、`is-visible`）的视觉表现未做像素级检查。
- **系统级能力**：桌面通知权限与后台提醒、提示音（AudioContext）、导出/导入 JSON、清空数据、载入示例（Blob/FileReader/下载）未覆盖。
- **URL 调试参数**：`?modal=add|settings`、`?view=today|tasks|fire`、`?state=crafted`、`?selftest=1` 之外的组合未逐一验证（`?state=frozen|crafting|empty|interrupted` 已覆盖）。
- **跨天/跨周真实时钟**：`tick()` 的跨天自动刷新未用真实时钟长跑；跨周期计算由 `tests/core.test.js` 覆盖，本次仅在 `weekStart=7` 的 occurrenceKey 层做 UI 集成验证。
- **P3-1 边界**：9 格上限的「未来才可用材料」边界只做了手动探针验证并记录，未纳入自动断言（若 Lead 决定按配置数收紧上限，可补 T17 回归）。
- **standalone.html 与源文件一致性**：未覆盖（本次仅测源文件）。
- **坏 JSON 降级与 localStorage 配额**：未构造（app 有 `normalizeDb`/try-catch，建议补一条回归）。
- **移动端导航**：`mobile-nav`/`mobileAddBtn` 等移动端专用入口的交互未逐一断言（桌面路径已覆盖视图切换）。

---

## 6. 任务书验收点对照

| 任务书要点 | 结论 |
| --- | --- |
| 1. 存储键 `craftCheckin.v1` | ✅ T01/T12 |
| 2. 品牌/标题「方块清单 · Craft Check-in」 | ✅ T01（document.title/侧栏/移动端品牌） |
| 3. 工作台 `#craftStage` 四态 / `#craftStateText` / `#craftHint` / 9 格 / ⛏️铁镐 / frozen·crafting 输出 `?` | ✅ T01/T02/T02b（含 `.craft-output.is-ready/.is-empty`、3 filled/3 done） |
| 4. `.chip-material` / `.recipe-action` / `is-material` / `.recipe-item` / `.material-select`，文案「材料/配方」 | ✅ T01/T06/T08（`chip-material`、`recipe-action`、`is-material`、`recipe-item`、`material-select` 均断言） |
| 5. 「合成记录」页（ID 保留 firePage*）/ 四态 label / 图例「已合成/进行中/中断」/ `.craft-stat` | ✅ T09（+T02/T02b 四态 label） |
| 6. 源码/DOM 无火苗主题词、无 i-flame；`#craftGrid` 9 格；材料上限 9 | ✅ T14/T01/T16（上限正常路径全拒绝；边界见 P3-1） |
| 7. 原 16 用例保留 + 选择器/文案改造（demo 首开 9 任务/3 材料、streak 12、frozen current=11） | ✅ T01–T15b 全部通过（新增 T02b/T08b/T16） |
| 8. `?selftest=1` PASS；app 逻辑 bug 报告给 Lead 不自改 | ✅ T13 自检 14/14 PASS；本报告 P3-1 已书面反馈，未改 app |
| 9. 运行方式（NODE_PATH + node tests/ui.test.js） | ✅ 命令与结果见第 1 节 |

---

## 7. 附：测试文件与复现说明

- `tests/ui.test.js`：19 个用例（T01–T16，含 T02b/T08b/T15b），覆盖任务书全部要点 + 9 格上限三路径 + 品牌词/图标完整性静态检查；每用例结束 `dom.window.close()` 清理定时器；断言失败打印期望/实际；末尾 `PASS n / FAIL m`，FAIL>0 时 `process.exitCode=1`。
- `tests/run-ui.ps1`：Node + `NODE_PATH` 包装，本机执行策略需 `-ExecutionPolicy Bypass`（脚本头部已注明）。
- 复跑命令见第 1 节；若 `app.js/index.html/styles.css` 在 22:58:51 之后继续改动，建议直接重跑本套件确认（CSS 覆盖清单尤其受 visual-dev 收尾影响）。

---

## 8. Lead 最终复验（2026-10-24 23:05）

- **CSS 定稿**：`styles.css` 147,319 bytes / mtime 23:00:48，visual-dev 明确不再修改；第二批截图后无功能 CSS 变更。
- **P3-1 已修复**：材料上限判断改为所有已配置 `fire===true` 的活动任务数，包含未来才可用的 interval；正常 9→10 与边界路径均不再产生「配置 10 / 格子 9」。
- **最终测试**：`core.test.js` 57/57 用例、342 断言通过；`ui.test.js` PASS 19 / FAIL 0；源文件与 `standalone.html` 页面自检均 `SELFTEST PASS 14/14`。
- **真实浏览器**：Edge + CDP 验证 1440×1000 / 390×844 无横向溢出；深色/亮色、合成中、合成记录、手机弹窗截图通过。最终预览在根目录 `preview-desktop.png` / `preview-mobile.png` / `preview-craft.png` / `preview-crafting.png` / `preview-light.png`。
- **standalone**：重新构建后 demo 首开、添加任务、坏 JSON 降级、页面自检均通过；静态检查无火苗主题词、无 `i-flame`、无外部资源、无重复 id。

---

## 9. Lead 后续新增：OCR 扫描手写记事（23:46）

在 23:05 定稿后追加的功能，未改变合成台/周期/提醒主体逻辑：

- **入口**：顶栏 `#scanBtn` + 今日清单底部 `#todayScan`；新弹窗 `#ocrModal`（加入 `MODAL_IDS`，焦点/Esc 沿用）。
- **能力**：拍照 / 相册 / 拖拽 / 粘贴图片；本机 Canvas 预处理；Tesseract.js v5 + `chi_sim` 在 Web Worker 中识别；结果可编辑、按行拆分、勾选、全选/清空；可导入为「今日一次（urgent 截止今天）」或「每日任务」，默认不计入合成配方，重复标题跳过。
- **网络**：OCR 引擎/中文数据按需从 unpkg 加载（约 2 MB，首次后浏览器缓存）；日常其余功能离线。
- **验证**：
  - `tests/ocr.test.js`：PASS 24 / FAIL 0（解析、建议、导入两种模式、重复跳过、localStorage）。
  - `?selftest=1`：**15/15 PASS**（新增「OCR 扫描弹窗与解析」）。
  - Edge + CDP 真实 OCR：上传中文手写风格记事图，识别出「买牛奶 / 给妈妈打电话 / 读书二十分钟 / 给花浇水」，成功拆成 4 条并导入今日（9→13 条）。
  - 截图：`design/shots/ocr-desktop.png`、`ocr-mobile.png`；根目录 `preview-ocr.png`。
- **已知风险**：手写体准确率取决于字迹/照片质量，必须人工校对；CDN 不可达时扫描器会退回手动输入/粘贴（不影响其他功能）。

---

## 10. Lead 追加：在线 AI 手写识别（2026-10-25 10:38）

用户反馈本地 OCR 对连笔手写几乎不可用（真实照片实测 Tesseract 输出为乱码，RapidOCR/PP-OCRv6 也只能猜中部分行）。因此新增可选的在线视觉 API 通道，默认使用国内网络更稳定的 **DeepSeek Flash（原生支持图片输入的 OpenAI 兼容接口）**：

- 设置 → AI 手写识别：启用开关、API Key、模型（默认 `deepseek-flash`）、OpenAI 兼容 Base（默认 `https://api.deepseek.com`）。
- 扫描器在有 Key 时按钮变为「AI 识别」，图片压缩后发送到配置的视觉服务；无 Key/失败时仍可用「本地识别」或手动粘贴。
- Key 只存 `localStorage` 的 `craftCheckin.ocr.v1`，不写入 DB/导出备份；UI 明确提示图片会发送给服务商。
- **验证**：先用本地 mock OpenAI-compatible 服务跑通前端管线；用户提供真实 DeepSeek Key 后，用真实照片调用 `deepseek-flash` 完成端到端验证（HTTP 200，返回 15 条待办建议）。DeepSeek 思考模式默认开启，会先输出 `reasoning_content` 而 `content` 为空；请求已显式传 `thinking: {type: 'disabled'}`，否则 OCR 结果为空。
- AI 输出常把左右两栏挤在一行，解析器新增按 `☑/□` 断行和过滤科目标题，实际照片可拆成 15 条可编辑建议（个别字仍需人工校对）。
- **刷新丢配置修复**：设置输入改为 `input` 防抖落盘，并在 `beforeunload`/`visibilitychange` 强制 flush；避免填完 Key 直接刷新时 `change` 未触发、回到本地 OCR。扫描器帮助会明确显示「AI 已开启但缺少 Key」。
- 最终 prompt 加入学生作业常见词（准备、预习、摘抄随笔、家听、改卷、跳绳、打疫苗等），实测比原 prompt 更准确；真实照片输出 15 条建议。
- 按用户要求把其 DeepSeek Key 作为 `OCR_AI_DEFAULTS` 内置默认值并默认启用；旧 localStorage 里空 Key 的配置会自动迁移，刷新后仍直接走 AI。UI/README 已提示：Key 会随 HTML 文件保存，分享/上传前应清空。
- 源码与 localStorage 均不保存明文：Key 用 XOR + Base64 混淆为 `apiKeyEnc`，运行时解码；旧版 `apiKey` 明文字段在加载时迁移并重写。客户端混淆不等于加密，能打开文件的人仍可还原。
- 设置控件通过 UI 回归（PASS 19）、OCR 行为测试（PASS 24）、核心 57/57；standalone 自检 15/15。

---

## 11. Lead 最终调整：DeepSeek 前端直连（2026-10-26 14:45）

- 按用户要求去掉后端：浏览器直接 `fetch https://api.deepseek.com/chat/completions`，不再需要 `start-tencent-ocr.bat`、PowerShell 或本地服务。
- 使用 `deepseek-flash` + `image_url`（base64、detail=original）；请求关闭 `thinking`，避免只返回 `reasoning_content`。
- Key 以 XOR + Base64 存在前端 `app.js` 的默认配置里，localStorage 只保存 `apiKeyEnc`；设置页可改 Key/模型，输入即保存。
- 已删除腾讯云/PPOCR 后端文件；前端保留「本地识别」兜底。
- 验证：file:// 打开应用，真实照片直接调用 DeepSeek，HTTP 200，中文正常，拆出 15 条建议；UI 回归 PASS 19，OCR 24/24，核心 57/57，自检 15/15。
- 风险：客户端 Key 可被还原；已提示分享/上传前清空，并建议轮换。
