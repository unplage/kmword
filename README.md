# kmword

[在线使用](https://unplage.github.io/kmword/) — PWA 离线背单词应用，纯前端，无构建步骤。

## 功能

- **间隔重复** — FSRS-6 算法，认词/拼写两种模式，熟悉度追踪，按遗忘曲线自动安排复习
- **单词分级** — 1~5 级难度，支持筛选复习
- **词典** — 在线多源英英释义：FreeDictionaryAPI.com（主）+ Free Dictionary API（700ms 延迟备用）+ Wiktionary + Datamuse 兜底，结果本地缓存；Merriam-Webster API（可选，免费申请）；可选导入 ECDICT 离线全量词典
- **AI 分析** — 可选接入智谱 GLM / DeepSeek / 小米 MiMo / 通义千问 / 自定义 OpenAI 兼容接口；支持批量导入 AI 释义缓存
- **单词库** — 多词库管理，库内单词唯一，库间可重复；支持导入 TXT/MD/HTML
- **阅读模块** — 上传英文文章，全文 TTS 朗读（播放/暂停/停止，`onboundary` 词级高亮），点击任意单词查词，阅读位置自动记忆，工具栏可折叠
- **听力模块** — 上传文章生成分段听力音频（MiMo 云 TTS），支持断点续传，播放位置自动记忆
- **生词本** — 独立收集困难单词
- **学习计划** — 每日学习目标设置
- **数据导出/导入** — JSON 备份（含阅读文章、韦氏/AI/在线释义缓存；不含 ECDICT 外部词典）
- **PWA** — 离线可用，可安装到桌面
- **主题** — 浅色/深色/跟随系统
- **快捷键**（学习页面）— `1`/`←` 不认识，`2`/`→` 认识，`Space` 发音，`d` 详情

## 快速开始

直接打开 [https://unplage.github.io/kmword/](https://unplage.github.io/kmword/) 即可使用。支持从 `专四/专八/托福/雅思` 内置词库导入，也可上传自定义单词表。

## 在线词典

查词按以下顺序自动容错，无需配置 API Key：

1. [FreeDictionaryAPI.com](https://freedictionaryapi.com/)（Wiktionary 数据，1000 次/小时/IP）
2. [Free Dictionary API](https://dictionaryapi.dev/)（主源启动 700ms 后并行请求，先成功者胜出）
3. [Wiktionary REST](https://en.wiktionary.org/api/rest_v1/page/definition)（官方兜底）
4. [Datamuse](https://www.datamuse.com/api/)（轻量释义兜底）
5. 本地 ECDICT 英文/中文释义（如已导入）

成功结果写入 `word_cache.en`，重复查询和离线时可立即显示。释义底部会标注来源；使用这些数据时请遵守对应许可（Wiktionary/FreeDictionaryAPI 为 CC BY-SA 4.0）。

## 导入词库

- 从 [kajweb/dict](https://github.com/kajweb/dict) 下载单词库，用 `extract_txt.py` 转换为编号 TXT 格式后导入
- 上传 TXT/MD/HTML 文章，可选「单词模式」提取生词、「阅读模式」在线阅读或「听力模式」生成听力音频

## AI 释义缓存

查词弹窗提供「AI 分析」（实时调用设置中的大模型）。也可以批量生成释义后预先导入为缓存：

- **查看缓存** — 单词存在缓存时，查词弹窗显示「AI 分析（缓存）」按钮，点击直接展示，不走网络，也不影响实时「AI 分析」功能
- **仓库内置数据** — `ai_gloss_toefl.jsonl`：托福 **4,264 词**的 7 段式中文分析（词性和基本释义、词根词缀、记忆技巧、常用搭配、近义词辨析、例句、学习建议）
- **导入方式** — 设置 → 数据管理 → 「导入 AI 释义缓存」→ 选择文件。默认只补充没有缓存的单词；勾选「覆盖已有 AI 缓存」才会覆盖。导入分批进行，可随时取消，已写入部分不会丢失
- **支持格式** — `.jsonl`（每行 `{"word","content","cachedAt"}`）、`.json`（数组或 `{word: content}` 映射）、`.tsv`（`word<TAB>content`）
- **备份** — 导入的缓存会包含在「导出学习数据」的 JSON 备份中（`wordCache` 字段）
- **排版** — 导入内容会自动规范化为 Markdown 标题，和实时 AI 分析保持一致的配色、字号、图标与表格样式

### 自行生成释义文件

`build_ai_gloss.py` 调用 OpenAI 兼容接口批量生成释义，支持断点续跑，无需第三方依赖：

```bash
# 默认：智谱免费模型（glm-4.7-flash / glm-4.5-flash），2 并发
python3 build_ai_gloss.py

# 小米 MiMo（关闭 thinking + 全文 600 字限制），32 并发
python3 build_ai_gloss.py --backend mimo --concise --workers 32

# 先试跑 20 个
python3 build_ai_gloss.py --backend mimo --concise --limit 20
```

- 输入 `words_toefl.txt`（每行一个单词），输出 `ai_gloss_toefl.jsonl`；已完成的词会自动跳过
- **停止**：`touch ai_gloss.stop`（写完手头单词后退出）；**恢复**：再次运行同一命令，不丢失已生成内容
- 可用后端：`zhipu`（默认，免费 flash）、`mimo`、`deepseek`、`openrouter`、`opencode`；可用 `--models` 覆盖模型
- 内置词表：`words_dedup.txt`（托福 + 雅思 + 专四 + 专八去重 13,210 词）、`words_toefl.txt`（托福 4,264 词）
- API Key 从 opencode 的 `~/.local/share/opencode/auth.json` 读取；也可自行改用环境变量
- 生成完成后，按上面的导入方式在 PWA 中导入即可

## ECDICT 离线词典

设置 → 数据管理 → 「导入 ECDICT 词典」，选择 [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT) 的 `ecdict.csv`（本仓库根目录也附带了一份 `ecdict.csv`，可直接使用）：

- **规模** — 约 77 万词条，CSV 约 63MB，导入后浏览器占用约 150MB，仅保存在本机
- **查词** — 导入完成后，查词弹窗出现「ECDICT」按钮，展示音标、考试标签、柯林斯星级、BNC/COCA 排名、中英文释义与词形变化
- **备份** — ECDICT 属于外部词典，不进入「导出学习数据」的 JSON 备份；导入备份也不会删除已安装的词典
- **删除** — 可在同一位置删除词典，不影响单词、复习进度和生词本
- **许可** — ECDICT 使用 MIT License，详见 `ECDICT-LICENSE.txt`；词条来源 attribution 显示在释义底部

## 听力模块

基于小米 MiMo 云 TTS（模型 `mimo-v2.5-tts`，需在设置中配置 MiMo API Key）将文章合成为分段听力音频：

- **段落切分** — 以原文段落为切分边界（不过度硬切句子），每段约 3~6 分钟，在段落结束处切分，仅当单段过长时才按句子拆分；支持倍速播放、10 秒快进/快退
- **音色与发音风格** — 生成时可选音色（跟随设置/8 种预置）与发音风格（标准/温柔/活泼/严肃/平静/磁性/深沉/自定义指令），风格以 MiMo 音频标签或自然语言指令生效；设置页也提供全局发音风格（同时作用于阅读器全文朗读），选择固化到该听力记录、续传保持一致
- **断点续传** — 生成过程中网络波动或退出应用后，未完成的文件（`status = generating`）可在听力列表点击「继续生成」续跑，重新打开应用时也会弹窗提示续传，已生成的段不会重复生成；删除听力文件即清除全部内容
- **播放记忆** — 退出播放器后重新进入，自动定位到上次播放的分段与时间点
- **下载到本地** — 播放器工具栏可下载合并后的完整 WAV 音频，分段列表每段也可单独下载
- **可播放进度** — 生成中的文件已生成部分即可试听，完成后按分段列出

## 参考资源

| 资源 | 涵盖考试 | 特点 | 链接 |
|---|---|---|---|
| KyleBing/english-vocabulary | CET4/CET6、考研、SAT | TXT/JSON 格式，结构清晰 | [GitHub](https://github.com/KyleBing/english-vocabulary) |
| kajweb/dict | 四级、六级、考研、雅思、托福、SAT、GMAT、GRE | 综合词库，覆盖面最全 | [GitHub](https://github.com/kajweb/dict) |
| skywind3000/ECDICT | 全品类 | 77 万+词条，含音标、释义、例句；可在设置中导入为离线词典 | [GitHub](https://github.com/skywind3000/ECDICT) |
| fanhongtao/IELTS | 雅思专项 | 专攻雅思词汇 | [GitHub](https://github.com/fanhongtao/IELTS) |
