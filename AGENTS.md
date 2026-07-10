# AGENTS.md — kmword

**PWA vocabulary app** — pure frontend, no build step, no bundler, no package.json.

## Architecture

- **Entrypoint:** `index.html` (HTML only, ~600 lines).
- **Styles:** `styles.css` (~2200 lines, extracted from the original inline `<style>`).
- **Scripts (IIFE, no module system):**
  - `js/db.js` — WordDatabase class + `window.wordDB` instance (~1260 lines).
  - `js/novel-processor.js` — NovelProcessor class + `window.novelProcessor` instance (~320 lines).
  - `js/app.js` — WordLearnerApp class + `window.app` instance (~3790 lines).
- **Load order:** `db.js` → `novel-processor.js` → `app.js` (handled by `<script>` order in `index.html`).
- **Storage:** IndexedDB `WordLearnerDB` (v7), stores: `words`, `word_lists`, `user_progress`, `new_words`, `daily_plan`, `learning_history`, `novels`, `settings`.
  - `novels` store (v6+) used by the reading module; v7 added `createdAt` index for sorting.
- **PWA:** `sw.js` (cache-first static, network-first for API), `manifest.json` (scope `/kmword/`).
- **Deployment:** GitHub Pages at `https://unplage.github.io/kmword/`.

## API dependencies

- **Free Dictionary API** (`api.dictionaryapi.dev`) — used by default for word data. No key required.
- **Merriam-Webster API** (`dictionaryapi.com`) — optional. Configure keys (`mwDictKey`, `mwThesKey`) in Settings page. Requires free registration at https://dictionaryapi.com/register/index.htm.
- **LLM API** — OpenAI-compatible endpoint (default: Zhipu GLM-4.7-Flash, 128K context). Configure key & model in Settings. Used for reader translation, example sentence generation, and contextual word meaning.

## LLM degradation strategy

When no LLM API key is configured, the app falls back gracefully:
- **Reader translation** → shows "翻译失败: 请先在设置中配置 LLM API Key" (try/catch in `readerTranslate()`)
- **Example generation** → shows Free Dictionary API example or "暂无例句" (`getOrGenerateExample()` checks `hasLLMConfig()` internally)
- **Contextual meaning** → not shown (caller checks `hasLLMConfig()` before calling `getContextualMeaning()`)
- **Spelling cloze hint** → not shown (`updateSpellingClozeHint()` calls `getOrGenerateExample()` which returns null)
- "加载中..." placeholders only shown after confirming `hasLLMConfig()` returns true

## Word list import format (TXT)

Lines parsed via `extract_txt.py` pattern — numbered list with header:

```
Level4_2 单词列表
共 120 个单词
============================================================

   1. word1
   2. word2
```

The upload page accepts `.txt`, `.md`, and `.html` formats. Two modes:
- **单词模式** — extracts words from the text for vocabulary building (legacy flow).
- **阅读模式** — saves the file as-is for in-app reading with LLM-powered translation.

## Key data model

| Store | Key | Notes |
|-------|-----|-------|
| `words` | auto-increment `id` | Unique constraint on `[word, listId]` |
| `word_lists` | auto-increment `id` | `name` unique index |
| `user_progress` | `wordId` | SM-2 fields: `easeFactor`, `repetition`, `interval`, `familiarity`, `nextReview` |
| `new_words` | `wordId` | No constraint on uniqueness — manual dedup in code |
| `novels` | auto-increment `id` | Fields: `title`, `content`, `format` (plain/markdown/html), `wordCount`, `currentPosition`, `createdAt`, `updatedAt` |

## SM-2 spaced repetition
- Recognition: correct = quality 5 (perfect), incorrect = quality 2 (reset).
- Spelling: same logic, fed into `handleAnswer(correct)`.
- Familiarity 0-5; ≥4 considered "mastered" (`familiarity >= 4`).

## Learning session shortcuts

On the learn page (not in input fields):
- `1` or `ArrowLeft` = don't know
- `2` or `ArrowRight` = know
- `Space` = speak word
- `d` / `D` = toggle details

## Learning modes

Toggle between `recognition` (show word + buttons) and `spelling` (hide word, show input). Mode persists in IndexedDB settings. Spelling mode hides the word, shows meaning as hint, hides example sentences.

## Reading module

- **阅读** page lists saved articles (title, word count, date, progress bar, delete).
- **Reader** view renders article content with toolbar (font size +/-), scroll progress bar, and LLM translation popup.
- Click any word in reader → opens word lookup modal.
- Scroll position auto-saves when leaving reader.
- Font size 12–32px (step 2), persisted in IndexedDB.
- Select text + click translate button (or use the `reader-translate` action) → LLM translates selection.

## LLM integration

- **`llmCall`** — generic OpenAI-compatible chat completion call.
- **`llmTranslate`** — translate selected text to Chinese (cached in sessionStorage).
- **`llmGenerateExample`** — generate example sentences for a word.
- Configurable via Settings: API Key, Model name, Base URL.
- Default endpoint: `https://open.bigmodel.cn/api/paas/v4/chat/completions`, model `glm-4-flash`.

## Settings (IndexedDB keys)
`autoPlaySound`, `showPhonetic`, `autoNextWord`, `theme`, `fontSize`, `mwDictKey`, `mwThesKey`, `learningMode`, `llmApiKey`, `llmModel`, `llmBaseUrl`, `readerFontSize`.

## Data export/import

- Export via Settings → downloads JSON (`word-learner-backup-<date>.json`). Contains all stores including novels.
- Import via Settings → overwrites all data (double confirm dialog).
- Clear data: `clear2.html` (scoped to `kmword` prefix) or `clear3.html` (scoped to current origin).

## Helper script

`extract_txt.py` — extracts words from `kajweb/dict` JSONL format to numbered TXT. Run manually, edit filenames in the script itself.

## Word text files (reference data)

In-repo TXT files for CET-4, CET-6, TOEFL, IELTS, 专四, 专八 exams. Used as import sources.
