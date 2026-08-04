# kmword

[在线使用](https://unplage.github.io/kmword/) — PWA 离线背单词应用，纯前端，无构建步骤。

## 功能

- **间隔重复** — SM-2 算法，认词/拼写两种模式，熟悉度追踪，按遗忘曲线自动安排复习
- **单词分级** — 1~5 级难度，支持筛选复习
- **词典** — Free Dictionary API（默认） + Merriam-Webster API（可选，免费申请）
- **单词库** — 多词库管理，库内单词唯一，库间可重复；支持导入 TXT/MD/HTML
- **阅读模块** — 上传英文文章，全文 TTS 朗读（播放/暂停/停止，`onboundary` 词级高亮），点击任意单词查词，阅读位置自动记忆，工具栏可折叠
- **听力模块** — 上传文章生成分段听力音频（MiMo 云 TTS），支持断点续传，播放位置自动记忆
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
- 上传 TXT/MD/HTML 文章，可选「单词模式」提取生词、「阅读模式」在线阅读或「听力模式」生成听力音频

## 听力模块

基于小米 MiMo 云 TTS（模型 `mimo-v2.5-tts`，需在设置中配置 MiMo API Key）将文章合成为分段听力音频：

- **分段生成** — 文章按句自动切分为约 5 分钟一段，逐段生成并保存到本地（IndexedDB），支持倍速播放、10 秒快进/快退
- **断点续传** — 生成过程中网络波动或退出应用后，未完成的文件（`status = generating`）可在听力列表点击「继续生成」续跑，重新打开应用时也会弹窗提示续传，已生成的段不会重复生成；删除听力文件即清除全部内容
- **播放记忆** — 退出播放器后重新进入，自动定位到上次播放的分段与时间点
- **可播放进度** — 生成中的文件已生成部分即可试听，完成后按分段列出

## 参考资源

| 资源 | 涵盖考试 | 特点 | 链接 |
|---|---|---|---|
| KyleBing/english-vocabulary | CET4/CET6、考研、SAT | TXT/JSON 格式，结构清晰 | [GitHub](https://github.com/KyleBing/english-vocabulary) |
| kajweb/dict | 四级、六级、考研、雅思、托福、SAT、GMAT、GRE | 综合词库，覆盖面最全 | [GitHub](https://github.com/kajweb/dict) |
| skywind3000/ECDICT | 全品类 | 77 万+词条，含音标、释义、例句 | [GitHub](https://github.com/skywind3000/ECDICT) |
| fanhongtao/IELTS | 雅思专项 | 专攻雅思词汇 | [GitHub](https://github.com/fanhongtao/IELTS) |

<img width="1895" height="855" alt="截图" src="https://github.com/user-attachments/assets/d3a9c8f1-8e9e-4690-86fb-d2a7b6b8c4cb" />
