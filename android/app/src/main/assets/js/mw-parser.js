// Merriam-Webster (dictionaryapi.com v3) JSON 解析模块（纯函数，Node 可单测）
// 字段说明参考官方 JSON 文档：https://dictionaryapi.com/products/json
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.mwParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ---------- 文本清洗 ----------

    // 去掉 MW 的花括号标记，得到纯文本
    function cleanText(text) {
        if (text == null) return '';
        if (Array.isArray(text)) return text.map(cleanText).filter(Boolean).join(' ').trim();
        let s = String(text);
        s = s.replace(/\{dx_ety\}([\s\S]*?)\{\/dx_ety\}/g, '$1');
        s = s.replace(/\{dx_def\}/g, '').replace(/\{\/dx_def\}/g, '').replace(/\{dx\}/g, '').replace(/\{\/dx\}/g, '').replace(/\{ma\}/g, '');
        s = s.replace(/\{dxt\|([^|]+?)(?::\d+)?(?:\|[^}]*)?\}/g, '$1');
        s = s.replace(/\{(?:a_link|d_link|i_link|et_link)\|([^|]+?)(?:\|[^}]*)?\}/g, '$1');
        s = s.replace(/\{sx\|([^|]+?)(?:\|[^}]*)?\}/g, '$1');
        s = s.replace(/\{ds\|[^}]*\}/g, '');
        s = s.replace(/\{p_br\}/g, ' ');
        s = s.replace(/\{[^}]*\}/g, '');
        s = s.replace(/\s*,\s*,/g, ',');
        s = s.replace(/,\s*$/, '');
        s = s.replace(/\s*\(\s*,\s*\)/g, '');
        s = s.replace(/\s*\(\s*see\s*\)/g, '');
        return s.replace(/\s+/g, ' ').trim();
    }

    // 去掉花括号标记，但保留 {sc}/{it}/{wi}/{b}/{sup} 的强调语义（转成 HTML）
    function cleanRich(text) {
        if (text == null) return '';
        if (Array.isArray(text)) return text.map(cleanRich).filter(Boolean).join(' ').trim();
        let s = String(text);
        s = s.replace(/\{dx_ety\}([\s\S]*?)\{\/dx_ety\}/g, '$1');
        s = s.replace(/\{dx_def\}/g, '').replace(/\{\/dx_def\}/g, '').replace(/\{dx\}/g, '').replace(/\{\/dx\}/g, '').replace(/\{ma\}/g, '');
        s = s.replace(/\{dxt\|([^|]+?)(?::\d+)?(?:\|[^}]*)?\}/g, '$1');
        s = s.replace(/\{(?:a_link|d_link|i_link|et_link)\|([^|]+?)(?:\|[^}]*)?\}/g, '$1');
        s = s.replace(/\{sx\|([^|]+?)(?:\|[^}]*)?\}/g, '$1');
        s = s.replace(/\{ds\|[^}]*\}/g, '');
        s = s.replace(/\{p_br\}/g, ' ');
        s = s.replace(/\{sc\}/g, '<strong>').replace(/\{\/sc\}/g, '</strong>');
        s = s.replace(/\{it\}/g, '<i>').replace(/\{\/it\}/g, '</i>');
        s = s.replace(/\{wi\}/g, '<i>').replace(/\{\/wi\}/g, '</i>');
        s = s.replace(/\{b\}/g, '<b>').replace(/\{\/b\}/g, '</b>');
        s = s.replace(/\{sup\}/g, '<sup>').replace(/\{\/sup\}/g, '</sup>');
        s = s.replace(/\{(?:bc|gloss|phrase|qword|parahw|inf|mat|i_link)\}/g, '');
        s = s.replace(/\{[^}]*\}/g, '');
        s = s.replace(/\s*,\s*,/g, ',');
        s = s.replace(/,\s*$/, '');
        s = s.replace(/\s*\(\s*,\s*\)/g, '');
        s = s.replace(/\s*\(\s*see\s*\)/g, '');
        return s.replace(/[ \t]{2,}/g, ' ').trim();
    }

    // ---------- 工具 ----------

    function toArray(value) {
        if (value == null) return [];
        return Array.isArray(value) ? value : [value];
    }

    // dt 内容可能是字符串、{t: '...'} 对象或它们的数组
    function textOf(content) {
        if (content == null) return '';
        if (Array.isArray(content)) {
            return content.map(textOf).filter(Boolean).join(' ').trim();
        }
        if (typeof content === 'object') {
            return String(content.t || content.text || '').trim();
        }
        return String(content).trim();
    }

    function uniq(list) {
        return Array.from(new Set((list || []).filter(v => v != null && v !== '')));
    }

    // 官方规则：https://media.merriam-webster.com/audio/prons/[lang]/[country]/[format]/[subdir]/[base].[format]
    // subdir：bix* → bix，gg* → gg，数字/标点开头 → number，其它取首字母
    function buildAudioUrl(audio, options = {}) {
        if (!audio) return '';
        const name = String(audio).trim();
        if (!name) return '';
        const lang = options.lang || 'en';
        const country = options.country || 'us';
        const format = options.format || 'mp3';
        let sub = name.charAt(0);
        if (/^bix/i.test(name)) sub = 'bix';
        else if (/^gg/i.test(name)) sub = 'gg';
        else if (/^[0-9_\-.,:;'"()\[\]{}]/.test(name)) sub = 'number';
        return `https://media.merriam-webster.com/audio/prons/${lang}/${country}/${format}/${sub}/${encodeURIComponent(name)}.${format}`;
    }

    function attribution(aq) {
        if (!aq) return '';
        const auth = cleanText(aq.auth || '');
        const source = cleanText(aq.source || '');
        const date = cleanText(aq.aqdate || '');
        return [auth, source, date].filter(Boolean).join(', ');
    }

    function parseEtymology(et) {
        if (!et) return '';
        if (typeof et === 'string') return cleanRich(et);
        if (Array.isArray(et)) {
            const parts = [];
            for (const item of et) {
                if (!item) continue;
                if (Array.isArray(item)) {
                    if (item[0] === 'text') parts.push(cleanRich(item[1]));
                    else if (item[0] === 'date') parts.push('(' + cleanText(item[1]) + ')');
                } else if (typeof item === 'string') {
                    parts.push(cleanRich(item));
                }
            }
            return parts.join(' ').trim();
        }
        if (typeof et === 'object') {
            if (et.text) return parseEtymology(et.text);
            if (et.et_snote) return parseEtymology(et.et_snote);
            return Object.values(et).map(v => parseEtymology(v)).filter(Boolean).join(' ').trim();
        }
        return '';
    }

    // ---------- 义项 ----------

    function parseSense(senseData, context = {}) {
        const sense = {
            number: senseData.sn || '',
            grammaticalLabel: cleanText(senseData.sgram || ''),
            subjectLabels: toArray(senseData.sls).map(cleanText).filter(Boolean),
            generalLabels: toArray(senseData.lbs).map(cleanText).filter(Boolean),
            division: context.vdLabel || '',
            text: '',
            examples: [],
            notes: [],
            usages: [],
            synonyms: [],
            antonyms: [],
            rhymes: [],
            citations: [],
            pronunciation: '',
            etymology: '',
            inflections: [],
            variants: [],
            subsenses: []
        };

        if (senseData.prs) {
            const prs = toArray(senseData.prs)[0] || {};
            sense.pronunciation = cleanText(prs.mw || prs.ipa || '');
        }
        if (senseData.et) sense.etymology = parseEtymology(senseData.et);
        if (senseData.ins) sense.inflections = toArray(senseData.ins).map(i => cleanText(i && i.if)).filter(Boolean);
        if (senseData.vrs) {
            sense.variants = toArray(senseData.vrs).map(v => ({
                va: cleanText(v && v.va),
                vl: cleanText(v && v.vl)
            })).filter(v => v.va);
        }
        if (senseData.snote) {
            sense.notes.push(cleanText(textOf(senseData.snote)));
        }
        if (senseData.uns) {
            for (const un of toArray(senseData.uns)) {
                sense.usages.push(cleanText(textOf(un)));
            }
        }

        const texts = [];
        for (const dt of toArray(senseData.dt)) {
            if (!Array.isArray(dt) || dt.length < 2) continue;
            const type = dt[0];
            const content = dt[1];
            switch (type) {
                case 'text':
                    texts.push(cleanRich(content));
                    break;
                case 'ri':
                    texts.push(cleanRich(content));
                    break;
                case 'vis':
                    for (const vis of toArray(content)) {
                        if (vis && vis.t) {
                            sense.examples.push({ text: cleanRich(vis.t), source: attribution(vis.aq) });
                        }
                    }
                    break;
                case 'snote':
                    sense.notes.push(cleanText(textOf(content)));
                    break;
                case 'uns':
                    sense.usages.push(cleanText(textOf(content)));
                    break;
                case 'ca':
                    sense.notes.push('亦称 ' + cleanText(textOf(content)));
                    break;
                case 'bnw':
                    texts.push(cleanText(content));
                    break;
                case 'pron':
                    sense.pronunciation = cleanText(content);
                    break;
                case 'ety':
                    sense.etymology = cleanText(content);
                    break;
                case 'syn':
                    sense.synonyms.push(cleanText(content));
                    break;
                case 'ant':
                    sense.antonyms.push(cleanText(content));
                    break;
                case 'rvc':
                    sense.rhymes.push(cleanText(content));
                    break;
                case 'cip':
                    sense.citations.push(cleanText(content));
                    break;
                default:
                    break;
            }
        }
        sense.text = texts.join(' ').replace(/\s+/g, ' ').trim();
        sense.synonyms = uniq(sense.synonyms);
        sense.antonyms = uniq(sense.antonyms);
        sense.rhymes = uniq(sense.rhymes);

        // 子义项：sdsense 可能是对象或数组，全部保留
        const subList = senseData.sdsense
            ? (Array.isArray(senseData.sdsense) ? senseData.sdsense : [senseData.sdsense])
            : [];
        for (const sub of subList) {
            if (!sub) continue;
            const sd = sub.sd ? cleanText(sub.sd) : '';
            const subSense = parseSense(sub, { vdLabel: sd || context.vdLabel || '' });
            sense.subsenses.push(subSense);
        }
        return sense;
    }

    // ---------- 词典 ----------

    // 词表区块（syns / ants）：[{ pl, pt: [['text', ...], ['vis', [{t}]]] }]
    function parseWordSection(section, target) {
        for (const block of toArray(section)) {
            if (!block) continue;
            const label = cleanText(block.pl || '');
            for (const item of toArray(block.pt)) {
                if (!Array.isArray(item) || item.length < 2) continue;
                if (item[0] === 'text') {
                    const raw = String(item[1]);
                    target.paragraphs.push({ label, text: cleanRich(raw) });
                    for (const m of raw.matchAll(/\{sc\}([^{}]+)\{\/sc\}/g)) {
                        target.list.push(cleanText(m[1]));
                    }
                    for (const m of raw.matchAll(/\{sx\|([^|]+)(?:\|[^}]*)?\}/g)) {
                        target.list.push(cleanText(m[1]));
                    }
                } else if (item[0] === 'vis') {
                    for (const vis of toArray(item[1])) {
                        if (vis && vis.t) target.examples.push({ text: cleanRich(vis.t), source: attribution(vis.aq) });
                    }
                }
            }
        }
        target.list = uniq(target.list);
    }

    function parseDictEntry(entry) {
        const result = {
            headword: cleanText(entry.hwi && entry.hwi.hw),
            functionalLabel: cleanText(entry.fl || ''),
            additionalLabels: toArray(entry.af).map(cleanText).filter(Boolean),
            generalLabels: toArray(entry.lbs).map(cleanText).filter(Boolean),
            subjectLabels: toArray(entry.sls).map(cleanText).filter(Boolean),
            pronunciations: [],
            rhymes: [],
            variants: [],
            inflections: [],
            stems: [],
            derivedWords: [],
            shortDefs: [],
            date: '',
            offensive: !!(entry.meta && entry.meta.offensive),
            etymology: '',
            definitions: [],
            synonyms: { list: [], paragraphs: [], examples: [] },
            antonyms: { list: [], paragraphs: [], examples: [] },
            quotes: [],
            usages: [],
            runOns: [],
            supplementary: { examples: [], longDefs: [] }
        };

        const hwi = entry.hwi || {};
        for (const pr of toArray(hwi.prs)) {
            const audio = pr && pr.sound ? pr.sound.audio : '';
            result.pronunciations.push({
                mw: cleanText(pr && pr.mw),
                ipa: cleanText(pr && pr.ipa),
                audio: audio || '',
                audioUrl: buildAudioUrl(audio),
                rh: cleanText(pr && pr.rh)
            });
            if (pr && pr.rh) result.rhymes.push(cleanText(pr.rh));
        }
        result.rhymes = uniq(result.rhymes);

        result.variants = toArray(entry.vrs).map(v => ({
            va: cleanText(v && v.va),
            vl: cleanText(v && v.vl)
        })).filter(v => v.va);

        result.inflections = toArray(entry.ins).map(i => cleanText(i && i.if)).filter(Boolean);
        result.stems = uniq([
            ...toArray(entry.meta && entry.meta.stems).map(cleanText),
            ...toArray(entry.stems).map(cleanText)
        ]).filter(Boolean);
        result.derivedWords = toArray(entry.uros).map(u => ({
            word: cleanText(u && u.ure),
            pos: cleanText(u && u.fl)
        })).filter(u => u.word);
        result.shortDefs = toArray(entry.shortdef).map(cleanText).filter(Boolean);
        result.date = cleanText(entry.date || '');
        result.etymology = parseEtymology(entry.et);

        for (const defGroup of toArray(entry.def)) {
            if (!defGroup) continue;
            const vd = defGroup.vd ? cleanText(defGroup.vd) : '';
            for (const sseqItem of toArray(defGroup.sseq)) {
                for (const cand of toArray(sseqItem)) {
                    if (!Array.isArray(cand)) continue;
                    const type = cand[0];
                    const data = type === 'bs' ? (cand[1] && cand[1].sense) : cand[1];
                    if ((type === 'sense' || type === 'bs') && data) {
                        result.definitions.push(parseSense(data, { vdLabel: vd }));
                    }
                }
            }
            if (defGroup.bs && defGroup.bs.sense) {
                result.definitions.push(parseSense(defGroup.bs.sense, { vdLabel: vd }));
            }
        }

        parseWordSection(entry.syns, result.synonyms);
        parseWordSection(entry.ants, result.antonyms);

        for (const q of toArray(entry.quotes)) {
            if (!q) continue;
            result.quotes.push({ text: cleanRich(q.t || ''), source: attribution(q.aq) });
        }

        for (const usage of toArray(entry.usages)) {
            if (!usage) continue;
            if (Array.isArray(usage.pt)) {
                for (const item of usage.pt) {
                    if (Array.isArray(item) && item[0] === 'text') result.usages.push(cleanRich(item[1]));
                }
            } else if (Array.isArray(usage)) {
                if (usage[0] === 'text') result.usages.push(cleanRich(usage[1]));
            } else {
                result.usages.push(cleanText(usage));
            }
        }

        for (const dro of toArray(entry.dros)) {
            if (!dro) continue;
            const runOn = { text: cleanRich(dro.t || ''), definitions: [], pronunciations: [] };
            for (const pr of toArray(dro.prs)) {
                runOn.pronunciations.push(cleanText(pr && pr.mw));
            }
            for (const defGroup of toArray(dro.def)) {
                for (const sseqItem of toArray(defGroup && defGroup.sseq)) {
                    for (const cand of toArray(sseqItem)) {
                        if (Array.isArray(cand) && cand[0] === 'sense' && cand[1]) {
                            runOn.definitions.push(parseSense(cand[1], { vdLabel: defGroup.vd ? cleanText(defGroup.vd) : '' }));
                        }
                    }
                }
            }
            result.runOns.push(runOn);
        }

        if (entry.suppl) {
            for (const ex of toArray(entry.suppl.examples)) {
                if (ex && ex.t) result.supplementary.examples.push({ text: cleanRich(ex.t), source: attribution(ex.aq) });
            }
            const ldq = entry.suppl.ldq;
            if (ldq) {
                for (const defGroup of toArray(ldq.def)) {
                    for (const sseqItem of toArray(defGroup && defGroup.sseq)) {
                        for (const cand of toArray(sseqItem)) {
                            if (Array.isArray(cand) && cand[0] === 'sense' && cand[1]) {
                                result.supplementary.longDefs.push(parseSense(cand[1], { vdLabel: '' }));
                            }
                        }
                    }
                }
            }
        }

        return result;
    }

    function parseDict(dictData) {
        if (!Array.isArray(dictData) || !dictData.length) return [];
        if (typeof dictData[0] === 'string') return [];
        return dictData.map(parseDictEntry).filter(e => e.definitions.length || e.headword);
    }

    // ---------- 同义词库 ----------

    // 词对象：{ wd, wls?, wsls:{wsl}, wvrs? }
    function parseThesaurusWord(item) {
        if (!item) return null;
        if (typeof item === 'string') return { word: cleanText(item), label: '', status: '' };
        if (item.wd) {
            return {
                word: cleanText(item.wd),
                label: cleanText(item.wls || ''),
                status: cleanText(item.wsls && item.wsls.wsl),
                variants: toArray(item.wvrs).map(v => cleanText(v && (v.wv || v.va))).filter(Boolean)
            };
        }
        return null;
    }

    // 词组列表：[[{wd},...],[{wd},...]]
    function collectWordGroups(list, sink) {
        for (const group of toArray(list)) {
            if (!Array.isArray(group)) continue;
            // 兼容多一层嵌套的写法
            const items = group.every(it => Array.isArray(it)) ? group.flat() : group;
            const words = [];
            for (const item of items) {
                const w = parseThesaurusWord(item);
                if (w && w.word) words.push(w);
            }
            if (words.length) sink.push(words);
        }
    }

    function parseThesaurusSense(senseData, result) {
        if (!senseData) return;
        const collect = (list, flatKey, groupKey, label) => {
            const groups = [];
            collectWordGroups(list, groups);
            if (!groups.length) return;
            for (const g of groups) {
                for (const w of g) {
                    result[flatKey].push(w.word);
                    if (w.status) result.statuses.push({ word: w.word, status: w.status });
                }
            }
            result[groupKey].push({ label, definition: cleanText(senseData.sn || ''), words: groups });
        };
        collect(senseData.syn_list, 'synonyms', 'synonymGroups', '同义词');
        collect(senseData.sim_list, 'nearSynonyms', 'nearSynonymGroups', '同义词与近义词');
        collect(senseData.rel_list, 'related', 'relatedGroups', '相关词');
        collect(senseData.ant_list, 'antonyms', 'antonymGroups', '反义词');
        collect(senseData.near_list, 'nearAntonyms', 'nearAntonymGroups', '近反义词');
        collect(senseData.opp_list, 'opposites', 'oppositeGroups', '反义词与近反义词');
        collect(senseData.phrase_list, 'phrases', 'phraseGroups', '同义短语');
    }

    function parseThesaurus(thesData) {
        const result = {
            synonyms: [],
            nearSynonyms: [],
            antonyms: [],
            nearAntonyms: [],
            opposites: [],
            related: [],
            phrases: [],
            statuses: [],
            synonymGroups: [],
            nearSynonymGroups: [],
            relatedGroups: [],
            antonymGroups: [],
            nearAntonymGroups: [],
            oppositeGroups: [],
            phraseGroups: [],
            definitions: []
        };
        if (!Array.isArray(thesData) || !thesData.length) return result;
        if (typeof thesData[0] === 'string') return result;

        for (const entry of thesData) {
            if (!entry) continue;
            const meta = entry.meta || {};
            // meta.syns / meta.ants 形如 [[word, word, ...]]，需要展开一层
            for (const group of toArray(meta.syns)) {
                if (Array.isArray(group)) for (const w of group) result.synonyms.push(cleanText(w));
                else result.synonyms.push(cleanText(group));
            }
            for (const group of toArray(meta.ants)) {
                if (Array.isArray(group)) for (const w of group) result.antonyms.push(cleanText(w));
                else result.antonyms.push(cleanText(group));
            }

            const pushEntryList = (list, groupKey, label) => {
                const groups = [];
                collectWordGroups(list, groups);
                if (groups.length) result[groupKey].push({ label, definition: '', words: groups });
            };
            pushEntryList(entry.syn_list, 'synonymGroups', '同义词');
            pushEntryList(entry.sim_list, 'nearSynonymGroups', '同义词与近义词');
            pushEntryList(entry.rel_list, 'relatedGroups', '相关词');
            pushEntryList(entry.ant_list, 'antonymGroups', '反义词');
            pushEntryList(entry.near_list, 'nearAntonymGroups', '近反义词');
            pushEntryList(entry.opp_list, 'oppositeGroups', '反义词与近反义词');
            pushEntryList(entry.phrase_list, 'phraseGroups', '同义短语');

            for (const defGroup of toArray(entry.def)) {
                for (const sseqItem of toArray(defGroup && defGroup.sseq)) {
                    for (const cand of toArray(sseqItem)) {
                        if (!Array.isArray(cand)) continue;
                        const type = cand[0];
                        const data = type === 'bs' ? (cand[1] && cand[1].sense) : cand[1];
                        if ((type === 'sense' || type === 'bs') && data) {
                            result.definitions.push(parseSense(data, { vdLabel: defGroup.vd ? cleanText(defGroup.vd) : '' }));
                            parseThesaurusSense(data, result);
                        }
                    }
                }
            }
        }

        // 汇总各分组的词
        const pushGroupWords = (groups, flatKey) => {
            for (const g of groups) {
                for (const group of g.words || []) {
                    for (const w of group) {
                        result[flatKey].push(w.word);
                        if (w.status) result.statuses.push({ word: w.word, status: w.status });
                    }
                }
            }
        };
        pushGroupWords(result.synonymGroups, 'synonyms');
        pushGroupWords(result.nearSynonymGroups, 'nearSynonyms');
        pushGroupWords(result.relatedGroups, 'related');
        pushGroupWords(result.antonymGroups, 'antonyms');
        pushGroupWords(result.nearAntonymGroups, 'nearAntonyms');
        pushGroupWords(result.oppositeGroups, 'opposites');
        pushGroupWords(result.phraseGroups, 'phrases');

        for (const key of ['synonyms', 'nearSynonyms', 'antonyms', 'nearAntonyms', 'opposites', 'related', 'phrases']) {
            result[key] = uniq(result[key]);
        }
        return result;
    }

    return {
        cleanText,
        cleanRich,
        buildAudioUrl,
        attribution,
        parseEtymology,
        parseSense,
        parseDict,
        parseDictEntry,
        parseThesaurus
    };
});
