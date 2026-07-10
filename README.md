# kmword

[在线使用](https://unplage.github.io/kmword/) — PWA 离线背单词应用，纯前端，无构建步骤。

## 功能

- **间隔重复** — SM-2 算法，认词/拼写两种模式，熟悉度追踪，按遗忘曲线自动安排复习
- **单词分级** — 1~5 级难度，支持筛选复习
- **词典** — Free Dictionary API（默认） + Merriam-Webster API（可选，免费申请）
- **单词库** — 多词库管理，库内单词唯一，库间可重复；支持导入 TXT/MD/HTML
- **阅读模块** — 上传英文文章，全文 TTS 朗读（播放/暂停/停止，`onboundary` 词级高亮），点击任意单词查词，阅读位置自动记忆，工具栏可折叠
- **生词本** — 独立收集困难单词
- **学习计划** — 每日学习目标设置
- **数据导出/导入** — 完整 JSON 备份（含阅读文章）
- **PWA** — 离线可用，可安装到桌面
- **主题** — 浅色/深色/跟随系统
- **快捷键**（学习页面）— `1`/`←` 不认识，`2`/`→` 认识，`Space` 发音，`d` 详情

## 快速开始

直接打开 [https://unplage.github.io/kmword/](https://unplage.github.io/kmword/) 即可使用。支持从 `专四/专八/托福/雅思` 内置词库导入，也可上传自定义单词表。

## 导入词库

- 从 [kajweb/dict](https://github.com/kajweb/dict) 下载单词库，用 `extract_txt.py` 转换为编号 TXT 格式后导入
- 上传 TXT/MD/HTML 文章，可选「单词模式」提取生词或「阅读模式」在线阅读

## 参考资源

| 资源 | 涵盖考试 | 特点 | 链接 |
|---|---|---|---|
| KyleBing/english-vocabulary | CET4/CET6、考研、SAT | TXT/JSON 格式，结构清晰 | [GitHub](https://github.com/KyleBing/english-vocabulary) |
| kajweb/dict | 四级、六级、考研、雅思、托福、SAT、GMAT、GRE | 综合词库，覆盖面最全 | [GitHub](https://github.com/kajweb/dict) |
| skywind3000/ECDICT | 全品类 | 77 万+词条，含音标、释义、例句 | [GitHub](https://github.com/skywind3000/ECDICT) |
| fanhongtao/IELTS | 雅思专项 | 专攻雅思词汇 | [GitHub](https://github.com/fanhongtao/IELTS) |

<img width="1895" height="855" alt="截图" src="https://github.com/user-attachments/assets/d3a9c8f1-8e9e-4690-86fb-d2a7b6b8c4cb" />
