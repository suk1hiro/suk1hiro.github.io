# 小学写字练习（人教版 · 写字表）

按人教版（统编版）小学语文教材的**写字表（会写字）**练习写字的静态网页应用。支持 1–6 年级、12 册，按“单元 → 课文”选择生字；每个字可在田字格中查看拼音、演示笔顺、描红练习，并记录“已练”。另有**测试模式**，以闪卡方式根据拼音和组词提示回忆汉字。**断网可用。**

## 使用
双击 `index.html` 用浏览器打开（Chrome / Edge 最佳）。

- 顶部选择**年级**、**上/下册**，用搜索框按汉字或拼音过滤，勾选“只看未练”。
- 点击任意字卡进入练习：
  - **演示笔顺**：逐笔动画。
  - **描红练习**：按笔顺临摹，写对该笔会自动前进；完成后该字标记为已练。
  - **重置 / 朗读 / 上一个 / 下一个**。
- 点击右上角“测试”进入测试模式：
  - 选择单元（上/下册分开显示），可保持教材顺序或随机顺序。
  - 闪卡正面显示拼音 + 若干提示词；提示词中目标字会被替换成拼音，目标字可以在词语的任意位置，提示词也包含成语。
  - 提示词优先使用 2 字词语；2 字词语不足时才会使用更长的词语或成语。
  - 朗读时读出目标汉字和提示词原文（不会读拼音）。
  - 点击卡片或按空格翻面，查看汉字并自动播放笔顺。
  - 支持键盘 ←/→ 切换卡片、R 重读提示。
- 练习进度保存在浏览器本地（`localStorage`）。

## 数据来源
写字表与单字字形（拼音、部首、笔画、笔顺路径、组词）均来自 **https://dwb2016.cn**（点我帮）的“生字表 / 笔顺查询”，站方声明依据人教版（统编版）小学语文教材各册**写字表**整理，**仅供家庭练习参考**。

- 每册写字表：`/zitie/renjiao/{年级}/{up|down}`（本应用已抓取并内置）
- 单字详情：`/hanzi/{字}`
- 成语提示词来自开源成语表，与教材无关，仅作辅助回忆用。

> 数据仅供家庭练习参考；如需商用或与某一年版教材严格一致，请自行核对。

## 文件结构
```
index.html            应用入口
styles.css            样式（含田字格、闪卡）
app.js                交互逻辑
vendor/hanzi-writer.min.js   Hanzi Writer 3.7.3（本地，离线可用）
data/characters.js    window.CHAR_DATA：册 → 单元 → 课文 → [{c,p}]
data/hanzi.js         window.HANZI_DATA：字 → {strokes,medians,radStrokes,words}
data/hanzi_cache.json 单字缓存汇总（构建时生成，便于部署）
tools/build_data.py   一次性抓取/生成脚本
tools/enrich_words.py 用 CC-CEDICT + 成语扩充提示词
tools/dict/cedict.txt.gz   CC-CEDICT 词典（构建时可选，第三方数据）
tools/dict/idiom.json      成语词典（构建时可选，第三方数据）
tools/pack_hanzi_cache.py  将 data/hanzi/*.json 打包成 data/hanzi_cache.json
tools/rebuild_hanzi_js.py  基于缓存重新生成 data/hanzi.js
tools/validate.py     校验数据完整性
```

## 重新构建数据（可选）
需要 Python 3。

```powershell
python tools\build_data.py
```

脚本会：
1. 抓取 12 册写字表并校验各册字数（1上100 / 1下200 / 2上250 / 2下250 / 3上250 / 3下250 / 4上250 / 4下250 / 5上220 / 5下180 / 6上180 / 6下121）。
2. 抓取每字拼音/笔顺/组词数据，先写入 `data/hanzi/` 临时缓存，最后打包为 `data/hanzi_cache.json`（并清理临时缓存目录）。
3. 若 `tools/dict/cedict.txt.gz` 或 `tools/dict/idiom.json` 存在，自动用常见词语和成语扩充提示词；优先使用 2 字词语，避免冷门长词喧宾夺主。
4. 生成 `data/characters.js` 与 `data/hanzi.js`。
5. 下载 `vendor/hanzi-writer.min.js`。

`data/hanzi.js` 约 6.7 MB（含 2300+ 字的笔顺路径），构建时自动生成，勿手动编辑。

## 语音说明
朗读使用浏览器内置的 Web Speech API。为获得更自然的效果，应用会优先选择系统安装的中文语音，例如 Windows 的“Microsoft Xiaoxiao / Yaoyao / Huihui”、macOS 的“Ting-Ting / Mei-Jia”等；若找不到更优质的本地语音，则回退到默认中文语音。

如需接近真人的朗读效果，需要接入云端 TTS（如 Azure Neural、Google Cloud、百度语音等），这些服务通常需要 API Key 和服务器代理，不适合直接内嵌在静态页面中。如果你已有可用的云服务 Key，可以在 `app.js` 的 `speakHints` 中优先调用该接口，并把现有 Web Speech 逻辑作为 fallback。

## 已知说明
- 笔顺判定由 Hanzi Writer 依据字形路径完成；拼音取站点读音。
- 数据来自第三方站点，个别字/课可能与最新教材略有差异；`data/` 可直接替换更新。