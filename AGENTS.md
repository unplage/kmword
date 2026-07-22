# AGENTS.md — kmword

**PWA vocabulary app** — pure frontend, no build step, no bundler, no package.json.

## Architecture

- **Entrypoint:** `index.html` (HTML + all pages in one file).
- **Styles:** `styles.css`.
- **Scripts (IIFE, no module system):**
  - `js/db.js` — WordDatabase class + `window.wordDB` instance.
  - `js/novel-processor.js` — NovelProcessor class + `window.novelProcessor` instance.
  - `js/app.js` — WordLearnerApp class + `window.app` instance.
- **Load order (manifest in `<script>` tags):** `db.js` → `novel-processor.js` → `app.js`.
- **Storage:** IndexedDB `WordLearnerDB` (v7), stores: `words`, `word_lists`, `user_progress`, `new_words`, `daily_plan`, `learning_history`, `novels`, `settings`.
- **PWA:** `sw.js` (cache-first static, network-first for Dictionary APIs), `manifest.json` (scope `/kmword/`).
- **Deployment:** GitHub Pages at `https://unplage.github.io/kmword/`.
- **Android wrapper:** `android/` is a separate Gradle/Kotlin project for a WebView-based Android app; not part of the PWA frontend.

## API dependencies

- **Free Dictionary API** (`api.dictionaryapi.dev`) — used by default, no key.
- **Merriam-Webster API** (`dictionaryapi.com`) — optional, configure `mwDictKey` + `mwThesKey` in Settings. Free registration at https://dictionaryapi.com/register/index.htm.
- **Browser SpeechSynthesis** — built-in TTS used by the reading module. Configurable voice (named) and speed via Settings. No API key needed.

## Word list import

Upload supports `.txt`, `.md`, `.html`. Two modes:
- **单词模式 (word)** — extracts words from text.
- **阅读模式 (reading)** — saves file as-is for in-app reading with TTS + word lookup.

TXT files in this repo follow a numbered-list format (header of "Level4_2 单词列表", "共 N 个单词", `====` divider, then `   1. word`). Exception: `雅思260314-3427.txt` is one-word-per-line, no header.

## Key data model

| Store | Key | Notes |
|-------|-----|-------|
| `words` | auto-increment `id` | Unique constraint on `[word, listId]` |
| `word_lists` | auto-increment `id` | `name` unique index |
| `user_progress` | `wordId` | SM-2 fields: `easeFactor`, `repetition`, `interval`, `familiarity`, `nextReview` |
| `new_words` | `wordId` | JS does manual dedup before `put()` to avoid overwriting existing entries |
| `novels` | auto-increment `id` | `title`, `content`, `format`, `wordCount`, `currentPosition`, `createdAt`, `updatedAt` |

## SM-2 spaced repetition

- Recognition: correct = quality 5 (perfect), incorrect = quality 2 (reset).
- Spelling: same logic, fed into `handleAnswer(correct)`.
- Familiarity 0–5; ≥4 considered "mastered".

## Learning session shortcuts

On learn page (not in input fields):
- `1` / `ArrowLeft` = don't know
- `2` / `ArrowRight` = know
- `Space` = speak word
- `d` / `D` = toggle details

## Learning modes

Toggle `recognition` (show word + buttons) vs `spelling` (hide word, show meaning as hint, hide examples). Mode persists in IndexedDB settings.

## Reading module

- **阅读** page lists saved articles (title, word count, date, progress bar, delete).
- **Reader** view: collapsible toolbar with font size (+/-), TTS play/pause/stop, delete.
- Click any word → word lookup modal.
- Scroll position auto-saves on leave. Font size 12–32px (step 2), persisted in IndexedDB.
- Full-article TTS with word-level highlight (`onboundary`).

## Settings (IndexedDB keys)

`autoPlaySound`, `showPhonetic`, `autoNextWord`, `theme`, `fontSize`, `mwDictKey`, `mwThesKey`, `learningMode`, `readerFontSize`, `currentListId`, `lastStudyDate`, `learningStreak`, `ttsVoice`, `ttsSpeaker`, `ttsSpeed`, `llmModel`, `llmWebSearch`.

- `llmModel` — GLM model name (default `glm-4.7-flash`). User-configurable text input; empty = default.
- `llmWebSearch` — Boolean toggle for AI web search via GLM `web_search` tool.

## Data export/import

- Export via Settings → downloads JSON (`word-learner-backup-<date>.json`), includes all stores.
- Import via Settings → overwrites all data (double confirm).
- Clear data: `clear2.html` (scoped to `kmword` prefix) or `clear3.html` (scoped to current origin).

## Helper script

`extract_txt.py` — converts `kajweb/dict` JSONL to numbered TXT. Edit filenames in the script, then run manually.

## Word text files (reference data)

In-repo TXT files used as import sources: 专四 (4025), 专八 (12197), 托福 (4264), 雅思 (3427).

## Cache versioning

`sw.js` (`CACHE_VERSION`) must be incremented whenever `js/app.js`, `index.html`, or `styles.css` are modified. Same for the Android copy at `android/app/src/main/assets/sw.js`. Check before syncing to GitHub.

## Quirks

- **Timezone:** Learning streaks use `Asia/Shanghai` (Beijing time), not device local time (`js/db.js:896`).
- **Word normalization:** All words lowercased + `.trim()`-ed before storage or lookup.
- **`new_words` store:** `wordId` primary key prevents true duplicates; JS does manual dedup before `put()` to avoid overwriting `addedAt`.
