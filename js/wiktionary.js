    (function() {
        // Wiktionary REST API（无需 key，支持 CORS）作为 Free Dictionary API 的备用源
        const BASE_URL = 'https://en.wiktionary.org/api/rest_v1/page/definition';
        const DEFAULT_TIMEOUT = 10000;

        // 把 Wiktionary 返回的 HTML 释义（含 <a>/<span> 等）转成纯文本
        function htmlToText(html) {
            if (!html) return '';
            let text;
            if (typeof document !== 'undefined' && document.createElement) {
                const div = document.createElement('div');
                div.innerHTML = html;
                text = div.textContent || div.innerText || '';
            } else {
                text = String(html)
                    .replace(/<[^>]+>/g, '')
                    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
                    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
            }
            return text.replace(/\s+/g, ' ').trim();
        }

        function pickAudioUrl(sound) {
            if (!sound) return '';
            const candidates = [
                sound['-audio'],
                sound['-ogg'],
                sound['-mp3'],
                sound.audio2,
                sound.audio,
                sound.other
            ];
            for (const url of candidates) {
                if (!url) continue;
                const text = String(url);
                const abs = text.startsWith('//') ? 'https:' + text : text;
                if (!/\.(ogg|mp3|oga|webm|wav)$/i.test(abs)) continue;
                return abs;
            }
            return '';
        }

        function parse(data, term) {
            const en = data && data.en;
            if (!Array.isArray(en) || en.length === 0) return null;
            const allMeanings = [];
            const pronunciations = [];
            const headwords = [];
            const categories = [];
            const related = [];
            const derived = [];
            let audioUrl = '';
            let phonetic = '';

            for (const entry of en) {
                if (!entry) continue;
                const partOfSpeech = entry.partOfSpeech || '';

                // 词头
                if (Array.isArray(entry.headwords)) {
                    for (const hw of entry.headwords) {
                        const text = htmlToText(hw && (hw.hw || hw.headword || hw.h));
                        if (!text) continue;
                        if (!headwords.some(item => item.text === text)) {
                            headwords.push({ text, pos: partOfSpeech });
                        }
                    }
                }

                // 读音 / 音频
                if (Array.isArray(entry.pronunciations)) {
                    for (const pr of entry.pronunciations) {
                        const text = htmlToText(pr && (pr.text || pr.ipa));
                        if (!text) continue;
                        if (!pronunciations.some(item => item.text === text)) {
                            pronunciations.push({ text, type: 'ipa', tags: [], audio: '', source: '' });
                        }
                    }
                }
                if (!phonetic && Array.isArray(entry.pronunciations) && entry.pronunciations.length) {
                    phonetic = htmlToText(entry.pronunciations[0].text || entry.pronunciations[0].ipa || '');
                }
                if (!phonetic && entry.ts) phonetic = htmlToText(entry.ts);
                if (Array.isArray(entry.sounds)) {
                    for (const sound of entry.sounds) {
                        const url = pickAudioUrl(sound);
                        if (url && !audioUrl) audioUrl = url;
                        if (url && !pronunciations.some(item => item.audio === url)) {
                            pronunciations.push({
                                text: '',
                                type: '',
                                tags: Array.isArray(sound.tags) ? sound.tags.map(t => String(t)) : [],
                                audio: url,
                                source: ''
                            });
                        }
                    }
                }

                // 分类 / 相关 / 派生
                if (Array.isArray(entry.categories)) {
                    for (const cat of entry.categories) {
                        const text = htmlToText(cat);
                        if (text && !categories.includes(text)) categories.push(text);
                    }
                }
                if (Array.isArray(entry.related)) {
                    for (const rel of entry.related) {
                        const text = htmlToText(rel && (rel.word || rel));
                        if (text && !related.includes(text)) related.push(text);
                    }
                }
                if (Array.isArray(entry.derived)) {
                    for (const der of entry.derived) {
                        const text = htmlToText(der && (der.word || der));
                        if (text && !derived.includes(text)) derived.push(text);
                    }
                }

                // 释义
                const defs = Array.isArray(entry.definitions) ? entry.definitions : [];
                for (const d of defs) {
                    const definition = htmlToText(d && d.definition);
                    if (!definition) continue;
                    const examples = [];
                    const parsed = Array.isArray(d && d.parsedExamples) ? d.parsedExamples : [];
                    for (const pe of parsed) {
                        const text = htmlToText(pe && pe.example);
                        if (text) examples.push({ text, english: htmlToText(pe && pe.english) });
                    }
                    if (!examples.length && Array.isArray(d && d.examples)) {
                        for (const ex of d.examples) {
                            const text = htmlToText(ex);
                            if (text) examples.push({ text, english: '' });
                        }
                    }
                    allMeanings.push({
                        partOfSpeech,
                        definition,
                        examples,
                        synonyms: [],
                        antonyms: [],
                        tags: []
                    });
                }
            }
            if (allMeanings.length === 0) return null;
            return {
                word: term,
                phonetic: phonetic ? (phonetic.startsWith('/') ? phonetic : `/${phonetic}/`) : '',
                audioUrl,
                allMeanings,
                pronunciations,
                headwords,
                categories,
                related,
                derived
            };
        }

        // 返回值：解析对象 / null（网络错误、超时，可重试）/ false（明确 404/未收录）
        async function query(word, options = {}) {
            const term = String(word || '').trim();
            if (!term) return null;
            const timeout = options.timeout || DEFAULT_TIMEOUT;
            const controller = new AbortController();
            let timedOut = false;
            const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
            const external = options.signal;
            const onExternalAbort = () => controller.abort();
            if (external) {
                if (external.aborted) controller.abort();
                else external.addEventListener('abort', onExternalAbort);
            }
            try {
                const response = await fetch(`${BASE_URL}/${encodeURIComponent(term)}`, {
                    headers: { 'Accept': 'application/json' },
                    signal: controller.signal
                });
                if (response.status === 404) return false;
                if (!response.ok) return null;
                const data = await response.json();
                return parse(data, term) || false;
            } catch (error) {
                if (error.name === 'AbortError' && !timedOut) throw error;
                console.warn(`Wiktionary 查询"${term}"失败:`, timedOut ? '请求超时' : error);
                return null;
            } finally {
                clearTimeout(timer);
                if (external) external.removeEventListener('abort', onExternalAbort);
            }
        }

        window.wiktionaryAPI = { BASE_URL, query, htmlToText, parse };
    })();
