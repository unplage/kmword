// Multi-source online English dictionary client.
// Sources are tried in parallel/fallback order so one dead free API does not
// leave the user without a definition. Successful results are cached in
// word_cache.en and reused offline.
(function () {
    'use strict';

    const SOURCES = {
        FREEDICT_COM: 'https://freedictionaryapi.com/api/v1/entries/en',
        FREEDICT_DEV: 'https://api.dictionaryapi.dev/api/v2/entries/en',
        DATAMUSE: 'https://api.datamuse.com/words',
        WIKTIONARY: 'https://en.wiktionary.org/wiki/'
    };

    const PRIMARY_TIMEOUT = 3500;
    const FREEDICT_DEV_DELAY = 700;
    const WIKTIONARY_TIMEOUT = 4000;
    const DATAMUSE_TIMEOUT = 2500;
    const DATAMUSE_DELAY = 350;
    const MAX_MEANINGS = 12;
    const MEMORY_LIMIT = 800;
    const CACHE_SCHEMA = 2;

    const LOW_VALUE_TAGS = new Set(['obsolete', 'archaic', 'rare', 'nonstandard', 'dialectal']);
    const POS_LABELS = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', u: '' };

    const memoryCache = new Map();

    function normalizeWord(word) {
        return String(word == null ? '' : word).trim().toLowerCase();
    }

    function getDb() {
        return (typeof window !== 'undefined' && window.wordDB) ? window.wordDB : null;
    }

    function abortError() {
        try {
            return new DOMException('Aborted', 'AbortError');
        } catch (error) {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            return err;
        }
    }

    function generatePhoneticFallback(word) {
        const simpleRules = { 'a': 'æ', 'e': 'ɛ', 'i': 'ɪ', 'o': 'ɒ', 'u': 'ʌ', 'ay': 'aɪ', 'ee': 'iː', 'oo': 'uː', 'th': 'θ' };
        let phonetic = normalizeWord(word);
        for (const [pattern, replacement] of Object.entries(simpleRules)) {
            phonetic = phonetic.replace(new RegExp(pattern, 'g'), replacement);
        }
        return phonetic;
    }

    function cleanText(value) {
        return String(value == null ? '' : value)
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function uniqueWords(list, limit) {
        const out = [];
        const seen = new Set();
        for (const item of Array.isArray(list) ? list : []) {
            const word = cleanText(typeof item === 'string' ? item : (item && item.word));
            const key = word.toLowerCase();
            if (!word || seen.has(key)) continue;
            seen.add(key);
            out.push(word);
            if (out.length >= limit) break;
        }
        return out;
    }

    function addMeaning(out, seen, partOfSpeech, definition, example, synonyms, antonyms, tagList, exampleList) {
        const def = cleanText(definition);
        if (!def) return;
        const pos = cleanText(partOfSpeech);
        const key = `${pos}|${def}`.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        const examples = (Array.isArray(exampleList) ? exampleList : [])
            .map(item => ({
                text: cleanText(item && item.text).slice(0, 400),
                source: cleanText(item && item.source).slice(0, 200)
            }))
            .filter(item => item.text);
        out.push({
            partOfSpeech: pos,
            definition: def,
            example: cleanText(example).slice(0, 400) || (examples.length ? examples[0].text : ''),
            examples: examples,
            tags: (Array.isArray(tagList) ? tagList : []).map(t => cleanText(t)).filter(Boolean),
            synonyms: uniqueWords(synonyms, 8),
            antonyms: uniqueWords(antonyms, 8)
        });
    }

    function fallbackAudioUrl(word) {
        const key = normalizeWord(word);
        if (!/^[a-z][a-z' -]*$/.test(key)) return '';
        const encoded = encodeURIComponent(key).replace(/'/g, '%27');
        return `https://dict.youdao.com/dictvoice?audio=${encoded}&type=2`;
    }

    function buildResult(word, payload) {
        const allMeanings = (payload.allMeanings || [])
            .filter(item => item && item.definition)
            .slice(0, MAX_MEANINGS);
        if (allMeanings.length === 0) return null;
        const first = allMeanings[0];
        return {
            word: word,
            phonetic: payload.phonetic || `/${generatePhoneticFallback(word)}/`,
            meaning: `${first.partOfSpeech ? first.partOfSpeech + '. ' : ''}${first.definition}`,
            example: first.example || '',
            allMeanings: allMeanings,
            audioUrl: payload.audioUrl || fallbackAudioUrl(word),
            source: payload.source || '',
            sourceUrl: payload.sourceUrl || '',
            sourceName: payload.sourceName || '',
            pronunciations: payload.pronunciations || [],
            forms: payload.forms || [],
            wordSynonyms: uniqueWords(payload.wordSynonyms, 24),
            wordAntonyms: uniqueWords(payload.wordAntonyms, 24),
            related: uniqueWords(payload.related, 24),
            categories: payload.categories || [],
            headwords: payload.headwords || [],
            derived: payload.derived || [],
            license: payload.license || null,
            frequency: payload.frequency || 0,
            numFound: payload.numFound || 0,
            score: payload.score || 0,
            rawData: payload.rawData || { source: payload.source || '' }
        };
    }

    function fallbackData(word) {
        return {
            word: word,
            phonetic: `/${generatePhoneticFallback(word)}/`,
            meaning: `${word} 的释义（网络查询失败）`,
            example: `This is an example for ${word}.`,
            allMeanings: [],
            audioUrl: fallbackAudioUrl(word),
            source: 'fallback',
            sourceUrl: '',
            rawData: null
        };
    }

    function createAbortLink(external) {
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        if (external) {
            if (external.aborted) controller.abort();
            else external.addEventListener('abort', onAbort);
        }
        return {
            signal: controller.signal,
            abort: () => controller.abort(),
            cleanup: () => {
                if (external) external.removeEventListener('abort', onAbort);
            }
        };
    }

    function delayed(fn, ms, signal) {
        return new Promise(resolve => {
            let settled = false;
            let timer = null;
            const done = (value) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                if (signal) signal.removeEventListener('abort', onAbort);
                resolve(value);
            };
            const onAbort = () => done({ status: 'aborted' });
            timer = setTimeout(() => done(fn()), ms);
            if (signal) {
                if (signal.aborted) done({ status: 'aborted' });
                else signal.addEventListener('abort', onAbort, { once: true });
            }
        });
    }

    async function fetchJson(url, options = {}) {
        const timeout = options.timeout || PRIMARY_TIMEOUT;
        const external = options.signal;
        if (external && external.aborted) return { status: 'aborted' };

        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeout);
        const onAbort = () => controller.abort();
        if (external) external.addEventListener('abort', onAbort);

        try {
            const response = await fetch(url, {
                method: 'GET',
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            });
            if (response.status === 404) return { status: 404 };
            if (!response.ok) return { status: response.status, error: `HTTP ${response.status}` };
            const data = await response.json();
            return { status: response.status, data };
        } catch (error) {
            if (external && external.aborted) return { status: 'aborted' };
            return { status: 0, error: timedOut ? 'timeout' : ((error && error.message) || 'network error') };
        } finally {
            clearTimeout(timer);
            if (external) external.removeEventListener('abort', onAbort);
        }
    }

    function hasLowValueTag(sense) {
        return Array.isArray(sense && sense.tags) &&
            sense.tags.some(tag => LOW_VALUE_TAGS.has(String(tag).toLowerCase()));
    }

    function flattenSenses(senses, out = []) {
        if (!Array.isArray(senses)) return out;
        for (const sense of senses) {
            if (!sense || typeof sense !== 'object') continue;
            out.push(sense);
            if (Array.isArray(sense.subsenses)) flattenSenses(sense.subsenses, out);
            if (out.length >= 50) break;
        }
        return out;
    }

    // 义项例句 + 引文（引文带出处），全部保留
    function collectExamples(sense) {
        const examples = [];
        if (Array.isArray(sense && sense.examples)) {
            for (const item of sense.examples) {
                const text = cleanText(typeof item === 'string' ? item : (item && item.text));
                if (text) examples.push({ text, source: '' });
            }
        }
        if (Array.isArray(sense && sense.quotes)) {
            for (const quote of sense.quotes) {
                const text = cleanText(quote && quote.text);
                if (text) examples.push({ text, source: cleanText((quote && quote.reference) || '') });
            }
        }
        return examples;
    }

    // 全部读音（含英音/美音等标签）
    function pickPronunciations(entry) {
        const list = Array.isArray(entry && entry.pronunciations) ? entry.pronunciations : [];
        const out = [];
        for (const item of list) {
            if (!item) continue;
            const text = cleanText(item.text || '');
            const audio = item.audio ? normalizeAudioUrl(item.audio) : '';
            if (!text && !audio) continue;
            out.push({
                text: text ? (item.type === 'enpr' ? `/${text}/` : text) : '',
                type: item.type || '',
                tags: Array.isArray(item.tags) ? item.tags.map(cleanText).filter(Boolean) : [],
                audio: audio,
                source: cleanText((item.source && (item.source.url || item.source)) || '')
            });
        }
        return out;
    }

    function pickPronunciation(entry) {
        const list = pickPronunciations(entry);
        const ipa = list.find(item => item.text && (item.type === 'ipa' || !item.type));
        if (ipa) return ipa.text;
        const enpr = list.find(item => item.text && item.type === 'enpr');
        return enpr ? enpr.text : '';
    }

    function pickAudio(entry) {
        const list = Array.isArray(entry && entry.pronunciations) ? entry.pronunciations : [];
        const found = list.find(item => item && item.audio);
        return found ? normalizeAudioUrl(found.audio) : '';
    }

    function normalizeAudioUrl(url) {
        const text = String(url || '').trim();
        if (!text) return '';
        return text.startsWith('//') ? `https:${text}` : text;
    }

    function pickForms(entry) {
        const list = Array.isArray(entry && entry.forms) ? entry.forms : [];
        const out = [];
        for (const form of list) {
            if (!form) continue;
            const word = cleanText(form.word || '');
            if (!word) continue;
            out.push({ word, tags: Array.isArray(form.tags) ? form.tags.map(cleanText).filter(Boolean) : [] });
        }
        return out;
    }

    function pickLicense(source) {
        if (!source) return null;
        const license = source.license || null;
        if (!license) return null;
        return { name: cleanText(license.name || ''), url: cleanText(license.url || '') };
    }

    async function fromFreeDictCom(word, options = {}) {
        const response = await fetchJson(`${SOURCES.FREEDICT_COM}/${encodeURIComponent(word)}`, {
            timeout: PRIMARY_TIMEOUT,
            signal: options.signal
        });
        if (response.status === 'aborted') return { status: 'aborted' };
        if (response.status === 404) return { status: 'notFound' };
        if (!response.data) return { status: 'error', error: response.error || 'no data' };

        const entries = Array.isArray(response.data.entries) ? response.data.entries : [];
        if (entries.length === 0) return { status: 'notFound' };

        const meanings = [];
        const seen = new Set();
        const pronunciations = [];
        const forms = [];
        const wordSynonyms = [];
        const wordAntonyms = [];
        let phonetic = '';
        let audioUrl = '';
        let languageName = '';

        for (const entry of entries) {
            if (entry && entry.language && entry.language.code && entry.language.code !== 'en') continue;
            if (!languageName && entry && entry.language) languageName = cleanText(entry.language.name || '');
            if (!phonetic) phonetic = pickPronunciation(entry);
            if (!audioUrl) audioUrl = pickAudio(entry);
            for (const pr of pickPronunciations(entry)) {
                if (!pronunciations.some(item => item.text === pr.text && item.type === pr.type)) pronunciations.push(pr);
            }
            for (const form of pickForms(entry)) {
                if (!forms.some(item => item.word === form.word)) forms.push(form);
            }
            for (const syn of (Array.isArray(entry && entry.synonyms) ? entry.synonyms : [])) {
                const text = cleanText(syn);
                if (text && !wordSynonyms.includes(text)) wordSynonyms.push(text);
            }
            for (const ant of (Array.isArray(entry && entry.antonyms) ? entry.antonyms : [])) {
                const text = cleanText(ant);
                if (text && !wordAntonyms.includes(text)) wordAntonyms.push(text);
            }

            const senses = flattenSenses(entry && entry.senses);
            // 常见义项优先，但低价值标签的义项不再丢弃（只是排后面并加标签）
            const primary = senses.filter(sense => !hasLowValueTag(sense));
            const secondary = senses.filter(sense => hasLowValueTag(sense));
            const ordered = primary.concat(secondary);
            for (const sense of ordered) {
                const examples = collectExamples(sense);
                addMeaning(
                    meanings, seen, entry && entry.partOfSpeech, sense && sense.definition,
                    examples.length ? examples[0].text : '',
                    (sense && sense.synonyms && sense.synonyms.length) ? sense.synonyms : [],
                    (sense && sense.antonyms && sense.antonyms.length) ? sense.antonyms : [],
                    Array.isArray(sense && sense.tags) ? sense.tags.map(cleanText).filter(Boolean) : [],
                    examples
                );
                if (meanings.length >= MAX_MEANINGS) break;
            }
            if (meanings.length >= MAX_MEANINGS) break;
        }

        if (meanings.length === 0) return { status: 'notFound' };
        const source = response.data.source || {};
        const result = buildResult(word, {
            phonetic,
            allMeanings: meanings,
            audioUrl,
            pronunciations,
            forms,
            wordSynonyms,
            wordAntonyms,
            license: pickLicense(source),
            source: 'freedictionaryapi.com',
            sourceUrl: cleanText((source && source.url) || ''),
            sourceName: languageName ? `FreeDictionaryAPI.com（${languageName}）` : 'FreeDictionaryAPI.com'
        });
        return result ? { status: 'ok', data: result } : { status: 'notFound' };
    }

    async function fromFreeDictDev(word, options = {}) {
        const response = await fetchJson(`${SOURCES.FREEDICT_DEV}/${encodeURIComponent(word)}`, {
            timeout: PRIMARY_TIMEOUT,
            signal: options.signal
        });
        if (response.status === 'aborted') return { status: 'aborted' };
        if (response.status === 404) return { status: 'notFound' };
        if (!response.data) return { status: 'error', error: response.error || 'no data' };
        if (!Array.isArray(response.data) || response.data.length === 0) return { status: 'notFound' };

        const entry = response.data[0];
        const meanings = [];
        const seen = new Set();
        const pronunciations = [];
        const wordSynonyms = [];
        const wordAntonyms = [];
        let phonetic = '';
        let audioUrl = '';

        for (const pr of (Array.isArray(entry.phonetics) ? entry.phonetics : [])) {
            if (!pr) continue;
            const text = cleanText(pr.text || '');
            const audio = pr.audio ? normalizeAudioUrl(pr.audio) : '';
            if (!text && !audio) continue;
            pronunciations.push({
                text,
                type: '',
                tags: [],
                audio: audio,
                source: cleanText(pr.sourceUrl || '')
            });
        }
        phonetic = cleanText(entry.phonetic || '');
        if (!phonetic) {
            const withText = pronunciations.find(p => p.text);
            if (withText) phonetic = withText.text;
        }
        const withAudio = pronunciations.find(p => p.audio);
        if (withAudio) audioUrl = withAudio.audio;

        for (const meaning of (Array.isArray(entry.meanings) ? entry.meanings : [])) {
            for (const syn of (Array.isArray(meaning.synonyms) ? meaning.synonyms : [])) {
                const text = cleanText(syn);
                if (text && !wordSynonyms.includes(text)) wordSynonyms.push(text);
            }
            for (const ant of (Array.isArray(meaning.antonyms) ? meaning.antonyms : [])) {
                const text = cleanText(ant);
                if (text && !wordAntonyms.includes(text)) wordAntonyms.push(text);
            }
            for (const definition of (Array.isArray(meaning.definitions) ? meaning.definitions : [])) {
                addMeaning(
                    meanings, seen, meaning.partOfSpeech, definition.definition,
                    cleanText(definition.example || ''),
                    (definition.synonyms && definition.synonyms.length) ? definition.synonyms : (meaning.synonyms || []),
                    (definition.antonyms && definition.antonyms.length) ? definition.antonyms : (meaning.antonyms || []),
                    [],
                    definition.example ? [{ text: cleanText(definition.example), source: '' }] : []
                );
                if (meanings.length >= MAX_MEANINGS) break;
            }
            if (meanings.length >= MAX_MEANINGS) break;
        }

        if (meanings.length === 0) return { status: 'notFound' };
        const sourceUrl = (Array.isArray(entry.sourceUrls) && entry.sourceUrls[0]) || '';
        const result = buildResult(word, {
            phonetic,
            allMeanings: meanings,
            audioUrl,
            pronunciations,
            wordSynonyms,
            wordAntonyms,
            license: pickLicense(entry),
            source: 'dictionaryapi.dev',
            sourceUrl: cleanText(sourceUrl),
            sourceName: 'Free Dictionary API'
        });
        return result ? { status: 'ok', data: result } : { status: 'notFound' };
    }

    async function fromWiktionary(word, options = {}) {
        if (typeof window === 'undefined' || !window.wiktionaryAPI || typeof window.wiktionaryAPI.query !== 'function') {
            return { status: 'error', error: 'wiktionary unavailable' };
        }
        try {
            const parsed = await window.wiktionaryAPI.query(word, {
                timeout: WIKTIONARY_TIMEOUT,
                signal: options.signal
            });
            if (parsed === false) return { status: 'notFound' };
            if (!parsed) return { status: 'error', error: 'wiktionary request failed' };

            const meanings = [];
            const seen = new Set();
            for (const meaning of (Array.isArray(parsed.allMeanings) ? parsed.allMeanings : [])) {
                const examples = Array.isArray(meaning.examples) ? meaning.examples : [];
                addMeaning(
                    meanings, seen, meaning.partOfSpeech, meaning.definition,
                    examples.length ? examples[0].text : '',
                    meaning.synonyms || [], meaning.antonyms || [],
                    meaning.tags || [],
                    examples
                );
                if (meanings.length >= MAX_MEANINGS) break;
            }
            if (meanings.length === 0) return { status: 'notFound' };
            const sourceUrl = `${SOURCES.WIKTIONARY}${encodeURIComponent(word)}`;
            const result = buildResult(word, {
                phonetic: parsed.phonetic || '',
                allMeanings: meanings,
                audioUrl: parsed.audioUrl || '',
                pronunciations: parsed.pronunciations || [],
                headwords: parsed.headwords || [],
                categories: parsed.categories || [],
                related: parsed.related || [],
                derived: parsed.derived || [],
                license: null,
                source: 'wiktionary',
                sourceUrl,
                sourceName: 'Wiktionary'
            });
            return result ? { status: 'ok', data: result } : { status: 'notFound' };
        } catch (error) {
            if (error && error.name === 'AbortError') {
                return { status: options.signal && options.signal.aborted ? 'aborted' : 'error' };
            }
            return { status: 'error', error: (error && error.message) || 'wiktionary error' };
        }
    }

    async function fromDatamuse(word, options = {}) {
        const params = new URLSearchParams({ sp: word, md: 'dpfr', ipa: '1', max: '5' });
        const response = await fetchJson(`${SOURCES.DATAMUSE}?${params.toString()}`, {
            timeout: DATAMUSE_TIMEOUT,
            signal: options.signal
        });
        if (response.status === 'aborted') return { status: 'aborted' };
        if (!response.data) return { status: 'error', error: response.error || 'no data' };
        if (!Array.isArray(response.data) || response.data.length === 0) return { status: 'notFound' };

        const hit = response.data.find(item => item && normalizeWord(item.word) === word);
        if (!hit) return { status: 'notFound' };

        const meanings = [];
        const seen = new Set();
        for (const line of (Array.isArray(hit.defs) ? hit.defs : [])) {
            const text = String(line || '');
            const tab = text.indexOf('\t');
            const code = tab >= 0 ? text.slice(0, tab).trim() : '';
            const rest = tab >= 0 ? text.slice(tab + 1) : text;
            const tab2 = rest.indexOf('\t');
            const definition = tab2 >= 0 ? rest.slice(0, tab2) : rest;
            const sense = tab2 >= 0 ? rest.slice(tab2 + 1) : '';
            addMeaning(
                meanings, seen, POS_LABELS[code] || '', definition, '',
                [], [], [],
                sense ? [{ text: sense, source: '' }] : []
            );
            if (meanings.length >= MAX_MEANINGS) break;
        }
        if (meanings.length === 0) return { status: 'notFound' };

        let phonetic = '';
        let frequency = 0;
        const tags = Array.isArray(hit.tags) ? hit.tags : [];
        for (const tag of tags) {
            const str = String(tag);
            if (str.startsWith('pron:') && !phonetic) phonetic = cleanText(str.slice(5));
            if (str.startsWith('f:') && !frequency) frequency = parseFloat(str.slice(2)) || 0;
        }
        const related = (Array.isArray(hit.words) ? hit.words : []).map(cleanText).filter(Boolean);
        const result = buildResult(word, {
            phonetic,
            allMeanings: meanings,
            audioUrl: '',
            related,
            frequency,
            numFound: Number(hit.numFound) || 0,
            score: Number(hit.score) || 0,
            license: null,
            source: 'datamuse',
            sourceUrl: 'https://www.datamuse.com/api/',
            sourceName: 'Datamuse'
        });
        return result ? { status: 'ok', data: result } : { status: 'notFound' };
    }

    async function fromEcdict(word) {
        const db = getDb();
        if (!db || typeof db.getEcdictEntry !== 'function') return { status: 'notFound' };

        let entry;
        try {
            entry = await db.getEcdictEntry(word);
        } catch (error) {
            return { status: 'error', error: (error && error.message) || 'ecdict error' };
        }
        if (!entry) return { status: 'notFound' };

        const meanings = [];
        const seen = new Set();
        const parser = (typeof window !== 'undefined' && window.ecdict) ? window.ecdict : null;

        if (parser && typeof parser.parseEnglish === 'function') {
            for (const sense of parser.parseEnglish(entry.d || '')) {
                addMeaning(meanings, seen, sense.pos, sense.text, '', [], []);
                if (meanings.length >= MAX_MEANINGS) break;
            }
        }
        if (meanings.length === 0 && parser && typeof parser.parseChinese === 'function') {
            for (const sense of parser.parseChinese(entry.t || '')) {
                addMeaning(meanings, seen, sense.pos, sense.text, '', [], []);
                if (meanings.length >= MAX_MEANINGS) break;
            }
        }
        if (meanings.length === 0) return { status: 'notFound' };

        const result = buildResult(word, {
            phonetic: entry.p || '',
            allMeanings: meanings,
            audioUrl: '',
            source: 'ecdict',
            sourceUrl: 'https://github.com/skywind3000/ECDICT',
            rawData: { source: 'ecdict' }
        });
        return result ? { status: 'ok', data: result } : { status: 'notFound' };
    }

    function setMemory(key, data) {
        memoryCache.set(key, data);
        if (memoryCache.size > MEMORY_LIMIT) {
            const oldest = memoryCache.keys().next().value;
            if (oldest !== undefined) memoryCache.delete(oldest);
        }
    }

    async function readCache(key) {
        const db = getDb();
        if (!db || typeof db.getWordCache !== 'function') return null;
        try {
            const record = await db.getWordCache(key);
            const cached = record && record.en;
            const data = cached && cached.data;
            if (!data || !Array.isArray(data.allMeanings) || data.allMeanings.length === 0) return null;
            // 旧版本缓存缺少新字段，直接视为未命中以重新拉取
            if ((cached.schema || 1) !== CACHE_SCHEMA) return null;
            return { ...data, cached: true, cachedAt: cached.cachedAt || '' };
        } catch (error) {
            return null;
        }
    }

    async function writeCache(key, data) {
        const db = getDb();
        if (!db || typeof db.saveWordCache !== 'function') return;
        if (!data || !data.source || data.source === 'fallback' || data.source === 'ecdict') return;
        const cachedData = {
            ...data,
            rawData: data.rawData ? { source: data.source, sourceUrl: data.sourceUrl || '' } : null,
            cached: false
        };
        try {
            await db.saveWordCache(key, {
                en: {
                    data: cachedData,
                    cachedAt: new Date().toISOString(),
                    source: data.source,
                    schema: CACHE_SCHEMA
                }
            });
        } catch (error) {
            // Cache writes are best-effort; a failed write must not break lookup.
        }
    }

    async function remember(key, data, persist, useMemory) {
        if (useMemory) setMemory(key, data);
        if (persist) await writeCache(key, data);
        return data;
    }

    function raceProviders(providers, signal) {
        if (!providers.length) {
            return Promise.resolve({ ok: false, outcomes: [], allNotFound: true });
        }
        return new Promise(resolve => {
            let remaining = providers.length;
            let done = false;
            const outcomes = [];
            const finish = (payload) => {
                if (done) return;
                done = true;
                resolve(payload);
            };

            for (const provider of providers) {
                Promise.resolve()
                    .then(provider.run)
                    .then(outcome => {
                        outcomes.push({ name: provider.name, ...outcome });
                        remaining--;
                        if (outcome.status === 'aborted' && signal && signal.aborted) {
                            finish({ ok: false, aborted: true, outcomes });
                            return;
                        }
                        if (outcome.status === 'ok') {
                            finish({ ok: true, data: outcome.data, outcomes });
                            return;
                        }
                        if (remaining === 0) {
                            finish({
                                ok: false,
                                outcomes,
                                allNotFound: outcomes.every(item => item.status === 'notFound')
                            });
                        }
                    })
                    .catch(error => {
                        outcomes.push({
                            name: provider.name,
                            status: 'error',
                            error: (error && error.message) || String(error)
                        });
                        remaining--;
                        if (remaining === 0) {
                            finish({ ok: false, outcomes, allNotFound: false });
                        }
                    });
            }
        });
    }

    async function fetchWordData(word, options = {}) {
        const displayWord = String(word == null ? '' : word).trim();
        const key = normalizeWord(displayWord);
        if (!key) return fallbackData(displayWord);

        const signal = options.signal;
        const persist = options.persist !== false;
        const useMemory = options.memory !== false;
        const force = options.force === true;

        if (!force) {
            if (useMemory && memoryCache.has(key)) return memoryCache.get(key);
            if (persist) {
                const cached = await readCache(key);
                if (cached) {
                    if (useMemory) setMemory(key, cached);
                    return cached;
                }
            }
        }

        const primaryLink = createAbortLink(signal);
        const primary = await raceProviders([
            { name: 'freedictionaryapi.com', run: () => fromFreeDictCom(key, { signal: primaryLink.signal }) },
            {
                name: 'dictionaryapi.dev',
                run: () => delayed(
                    () => fromFreeDictDev(key, { signal: primaryLink.signal }),
                    FREEDICT_DEV_DELAY,
                    primaryLink.signal
                )
            }
        ], primaryLink.signal);

        if (primary.aborted) {
            primaryLink.cleanup();
            throw abortError();
        }
        primaryLink.abort();
        primaryLink.cleanup();
        if (primary.ok) {
            return remember(key, { ...primary.data, word: displayWord }, persist, useMemory);
        }

        const fallbackLink = createAbortLink(signal);
        const wikPromise = fromWiktionary(key, { signal: fallbackLink.signal });
        const datamusePromise = delayed(
            () => fromDatamuse(key, { signal: fallbackLink.signal }),
            DATAMUSE_DELAY,
            fallbackLink.signal
        );
        const fallbackPair = await raceProviders([
            { name: 'wiktionary', run: () => wikPromise },
            { name: 'datamuse', run: () => datamusePromise }
        ], fallbackLink.signal);

        if (fallbackPair.aborted) {
            fallbackLink.cleanup();
            throw abortError();
        }
        fallbackLink.abort();
        fallbackLink.cleanup();
        if (fallbackPair.ok) {
            return remember(key, { ...fallbackPair.data, word: displayWord }, persist, useMemory);
        }

        const local = await fromEcdict(key);
        if (local.status === 'ok') {
            return { ...local.data, word: displayWord };
        }

        const fallback = fallbackData(displayWord);
        fallback.notFound = primary.allNotFound && fallbackPair.allNotFound && local.status === 'notFound';
        return fallback;
    }

    async function probe(options = {}) {
        const timeout = options.timeout || 4000;
        const checks = [
            fetchJson(`${SOURCES.FREEDICT_COM}/test`, { timeout, signal: options.signal }),
            fetchJson(`${SOURCES.DATAMUSE}?sp=test&md=d&max=1`, { timeout, signal: options.signal })
        ];
        const results = await Promise.allSettled(checks);
        return results.some(result =>
            result.status === 'fulfilled' &&
            result.value &&
            (result.value.status === 200 || result.value.status === 404)
        );
    }

    window.dictionaryAPI = {
        fetchWordData,
        probe,
        getAudioUrl: fallbackAudioUrl,
        getFallbackData: fallbackData,
        sources: { ...SOURCES }
    };
})();
