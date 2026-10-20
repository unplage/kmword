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

    function addMeaning(out, seen, partOfSpeech, definition, example, synonyms, antonyms) {
        const def = cleanText(definition);
        if (!def) return;
        const pos = cleanText(partOfSpeech);
        const key = `${pos}|${def}`.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push({
            partOfSpeech: pos,
            definition: def,
            example: cleanText(example).slice(0, 400),
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

    function firstExample(sense) {
        if (Array.isArray(sense.examples)) {
            for (const example of sense.examples) {
                const text = cleanText(typeof example === 'string' ? example : (example && example.text));
                if (text) return text;
            }
        }
        if (Array.isArray(sense.quotes)) {
            for (const quote of sense.quotes) {
                const text = cleanText(quote && quote.text);
                if (text) return text;
            }
        }
        return '';
    }

    function pickPronunciation(entry) {
        const list = Array.isArray(entry.pronunciations) ? entry.pronunciations : [];
        const ipa = list.find(item => item && item.text && (!item.type || item.type === 'ipa'));
        if (ipa) return cleanText(ipa.text);
        const enpr = list.find(item => item && item.text && item.type === 'enpr');
        return enpr ? `/${cleanText(enpr.text)}/` : '';
    }

    function pickAudio(entry) {
        const list = Array.isArray(entry.pronunciations) ? entry.pronunciations : [];
        const found = list.find(item => item && item.audio);
        if (found) return normalizeAudioUrl(found.audio);
        const sounds = Array.isArray(entry.sounds) ? entry.sounds : [];
        const sound = sounds.find(item => item && item.audio);
        return sound ? normalizeAudioUrl(sound.audio) : '';
    }

    function normalizeAudioUrl(url) {
        const text = String(url || '').trim();
        if (!text) return '';
        return text.startsWith('//') ? `https:${text}` : text;
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
        let phonetic = '';
        let audioUrl = '';

        for (const entry of entries) {
            if (entry && entry.language && entry.language.code && entry.language.code !== 'en') continue;
            if (!phonetic) phonetic = pickPronunciation(entry);
            if (!audioUrl) audioUrl = pickAudio(entry);

            const senses = flattenSenses(entry.senses);
            const preferred = senses.filter(sense => !hasLowValueTag(sense));
            const list = preferred.length > 0 ? preferred : senses;

            for (const sense of list) {
                addMeaning(
                    meanings,
                    seen,
                    entry.partOfSpeech,
                    sense.definition,
                    firstExample(sense),
                    (sense.synonyms && sense.synonyms.length) ? sense.synonyms : entry.synonyms,
                    (sense.antonyms && sense.antonyms.length) ? sense.antonyms : entry.antonyms
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
            source: 'freedictionaryapi.com',
            sourceUrl: source.url || '',
            rawData: { source: 'freedictionaryapi.com', sourceUrl: source.url || '' }
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
        let phonetic = '';
        if (entry.phonetic) phonetic = cleanText(entry.phonetic);
        if (!phonetic && Array.isArray(entry.phonetics)) {
            const found = entry.phonetics.find(item => item && item.text);
            if (found) phonetic = cleanText(found.text);
        }

        for (const meaning of Array.isArray(entry.meanings) ? entry.meanings : []) {
            for (const definition of Array.isArray(meaning.definitions) ? meaning.definitions : []) {
                addMeaning(
                    meanings,
                    seen,
                    meaning.partOfSpeech,
                    definition.definition,
                    definition.example,
                    (definition.synonyms && definition.synonyms.length) ? definition.synonyms : meaning.synonyms,
                    (definition.antonyms && definition.antonyms.length) ? definition.antonyms : meaning.antonyms
                );
                if (meanings.length >= MAX_MEANINGS) break;
            }
            if (meanings.length >= MAX_MEANINGS) break;
        }

        if (meanings.length === 0) return { status: 'notFound' };
        let audioUrl = '';
        if (Array.isArray(entry.phonetics)) {
            const found = entry.phonetics.find(item => item && item.audio);
            if (found) audioUrl = normalizeAudioUrl(found.audio);
        }
        const sourceUrl = (Array.isArray(entry.sourceUrls) && entry.sourceUrls[0]) || '';
        const result = buildResult(word, {
            phonetic,
            allMeanings: meanings,
            audioUrl,
            source: 'dictionaryapi.dev',
            sourceUrl,
            rawData: { source: 'dictionaryapi.dev', sourceUrl }
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
            for (const meaning of Array.isArray(parsed.allMeanings) ? parsed.allMeanings : []) {
                addMeaning(
                    meanings,
                    seen,
                    meaning.partOfSpeech,
                    meaning.definition,
                    meaning.example,
                    meaning.synonyms,
                    meaning.antonyms
                );
                if (meanings.length >= MAX_MEANINGS) break;
            }
            if (meanings.length === 0) return { status: 'notFound' };
            const sourceUrl = `${SOURCES.WIKTIONARY}${encodeURIComponent(word)}`;
            const result = buildResult(word, {
                phonetic: parsed.phonetic || '',
                allMeanings: meanings,
                audioUrl: parsed.audioUrl || '',
                source: 'wiktionary',
                sourceUrl,
                rawData: { source: 'wiktionary', sourceUrl }
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
        for (const line of Array.isArray(hit.defs) ? hit.defs : []) {
            const text = String(line || '');
            const tab = text.indexOf('\t');
            const code = tab >= 0 ? text.slice(0, tab).trim() : '';
            const definition = tab >= 0 ? text.slice(tab + 1) : text;
            addMeaning(meanings, seen, POS_LABELS[code] || '', definition, '', [], []);
            if (meanings.length >= MAX_MEANINGS) break;
        }
        if (meanings.length === 0) return { status: 'notFound' };

        let phonetic = '';
        if (Array.isArray(hit.tags)) {
            const pron = hit.tags.find(tag => String(tag).startsWith('pron:'));
            if (pron) phonetic = cleanText(String(pron).slice(5));
        }
        const result = buildResult(word, {
            phonetic,
            allMeanings: meanings,
            audioUrl: '',
            source: 'datamuse',
            sourceUrl: 'https://www.datamuse.com/api/',
            rawData: { source: 'datamuse' }
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
                    source: data.source
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
