import argparse
import gzip
import json
import os
import re
from datetime import datetime, timezone

PRIORITY_LABELS = {"core": "核心义", "common": "常用义", "rare": "生僻义"}
WORD_RE = re.compile(r"^\s*(?:\d+\.\s*)?([A-Za-z][A-Za-z'’\-]*)\s*$")
MD_SPECIAL = re.compile(r"([\\*_`\[\]<>])")


def load_word_lists(dict_dir):
    wanted = set()
    if not dict_dir or not os.path.isdir(dict_dir):
        return wanted
    for name in sorted(os.listdir(dict_dir)):
        if not name.lower().endswith(".txt"):
            continue
        with open(os.path.join(dict_dir, name), encoding="utf-8-sig", errors="replace") as fh:
            for line in fh:
                match = WORD_RE.match(line)
                if not match:
                    continue
                word = match.group(1).replace("’", "'").strip().lower()
                if len(word) >= 2:
                    wanted.add(word)
    return wanted


def md(value):
    if value is None or value == "":
        return ""
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (list, tuple)):
        return "、".join(md(item) for item in value if item is not None and item != "")
    if isinstance(value, dict):
        return "；".join(f"{key}: {md(val)}" for key, val in value.items() if val is not None and val != "")
    return MD_SPECIAL.sub(r"\\\1", str(value).strip())


def field(lines, label, value):
    text = md(value)
    if text:
        lines.append(f"- {label}：{text}")


def item_line(item, main, extras=()):
    parts = [md(item.get(main))]
    for label, key in extras:
        value = md(item.get(key))
        if value:
            parts.append(f"{label} {value}")
    return "；".join(part for part in parts if part)


def meaning_block(meaning):
    sense_id = md(meaning.get("sense_id")) or "未编号"
    priority = PRIORITY_LABELS.get(meaning.get("priority"), md(meaning.get("priority")) or "未分级")
    lines = [f"#### 义项 {sense_id} · {priority}"]
    field(lines, "简短释义", meaning.get("short_gloss"))
    field(lines, "学习者释义", meaning.get("learner_explanation"))
    field(lines, "标签", meaning.get("labels"))
    field(lines, "主题", meaning.get("topics"))
    field(lines, "用法说明", meaning.get("usage_note"))
    for index, example in enumerate(meaning.get("examples") or [], 1):
        text = md(example.get("text"))
        translation = md(example.get("translation"))
        if text and translation:
            lines.append(f"- 例句 {index}：{text} —— {translation}")
        elif text:
            lines.append(f"- 例句 {index}：{text}")
    return "\n".join(lines)


def pos_group_block(group):
    pos = md(group.get("pos")) or "未标注词性"
    lines = [f"### {pos}"]
    field(lines, "词性组 ID", group.get("etymology_id"))
    field(lines, "专有名词", group.get("proper_name"))
    field(lines, "组释义", group.get("summary"))
    field(lines, "组用法说明", group.get("usage_note"))
    forms = [item_line(item, "text", (("罗马字", "roman"), ("标记", "tags"))) for item in group.get("forms") or []]
    lines.extend(f"- 词形变化：{form}" for form in forms if form)
    pronunciations = [item_line(item, "ipa", (("文本", "text"), ("标记", "tags"))) for item in group.get("pronunciations") or []]
    lines.extend(f"- 发音：{pronunciation}" for pronunciation in pronunciations if pronunciation)
    relations = [item_line(item, "word", (("类型", "type"), ("语言代码", "lang_code"))) for item in group.get("relations") or []]
    lines.extend(f"- 相关词：{relation}" for relation in relations if relation)
    for meaning in group.get("meanings") or []:
        lines.append(meaning_block(meaning))
    return "\n\n".join(lines)


def build_content(entry):
    language = entry.get("definition_language") or {}
    headword_language = entry.get("headword_language") or {}
    metadata = " ｜ ".join(
        part for part in [
            f"词条 ID：{md(entry.get('entry_id')) or '—'}",
            f"类型：{md(entry.get('entry_type')) or '—'}",
            f"定义语言：{md(language.get('name'))} ({md(language.get('code'))})",
            f"头词语言：{md(headword_language.get('name'))} ({md(headword_language.get('code'))})",
            f"规范词形：{md(entry.get('normalized_headword')) or '—'}",
            f"数据契约：{md(entry.get('schema_version')) or '—'}",
        ] if part
    )
    parts = [f"# {md(entry.get('headword'))} · 学习释义", f"> {metadata}"]

    summary = md(entry.get("headword_summary"))
    if summary:
        parts.append(f"## 核心概述\n\n{summary}")

    groups = [pos_group_block(group) for group in entry.get("pos_groups") or []]
    groups = [group for group in groups if group]
    if groups:
        parts.append("## 词性和基本释义\n\n" + "\n\n".join(groups))

    hook = md(entry.get("memory_hook"))
    if hook:
        parts.append(f"## 记忆主线\n\n{hook}")

    etymology_note = md(entry.get("etymology_note"))
    if etymology_note:
        parts.append(f"## 词源注记\n\n{etymology_note}")

    etymologies = []
    for item in entry.get("etymologies") or []:
        lines = [f"### 词源组 {md(item.get('etymology_id')) or '未编号'}"]
        field(lines, "适用词性", item.get("pos_members"))
        field(lines, "词源文本", item.get("text"))
        etymologies.append("\n".join(lines))
    if etymologies:
        parts.append("## 词源结构\n\n" + "\n\n".join(etymologies))

    notes = [md(n) for n in (entry.get("study_notes") or []) if n]
    if notes:
        parts.append("## 学习建议\n\n" + "\n".join(f"- {n}" for n in notes))

    return "\n\n".join(parts).strip()


def main():
    parser = argparse.ArgumentParser(description="Convert open-dictionary distribution to AI cache JSONL")
    parser.add_argument("--input", default="distribution.jsonl.gz")
    parser.add_argument("--dict-dir", default="dict")
    parser.add_argument("--output", default="ai-dict/open_dict_cache.jsonl")
    parser.add_argument("--all", action="store_true", help="export all entries instead of dict word-list subset")
    parser.add_argument("--limit", type=int, default=0, help="max entries to write (0 = no limit)")
    args = parser.parse_args()

    wanted = set() if args.all else load_word_lists(args.dict_dir)
    cached_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    results = []
    seen = set()
    scanned = 0
    with gzip.open(args.input, "rt", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            scanned += 1
            if not args.all and not wanted:
                continue
            try:
                entry = json.loads(line)
            except (ValueError, TypeError):
                continue
            if entry.get("schema_version") != "distribution_entry_v5":
                continue
            word = str(entry.get("normalized_headword") or entry.get("headword") or "").strip().lower()
            if not word or re.search(r"\s", word):
                continue
            if not args.all and word not in wanted:
                continue
            if word in seen:
                continue
            content = build_content(entry)
            if len(content) < 10:
                continue
            seen.add(word)
            results.append({"word": word, "content": content, "cachedAt": cached_at})
            if args.limit and len(results) >= args.limit:
                break

    results.sort(key=lambda item: item["word"])
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as fh:
        for item in results:
            fh.write(json.dumps(item, ensure_ascii=False) + "\n")

    matched = sum(1 for w in seen if w in wanted)
    print(f"scanned: {scanned}")
    print(f"word list: {len(wanted)}")
    print(f"exported: {len(results)}")
    print(f"subset coverage: {matched}/{len(wanted)}")
    print(f"output: {args.output} ({os.path.getsize(args.output) / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
