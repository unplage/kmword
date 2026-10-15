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
                        .replace(/<[^>]*>/g, '')
                        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
                        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
                }
                return text.replace(/\s+/g, ' ').trim();
            }

            function parse(data, term) {
                const en = data && data.en;
                if (!Array.isArray(en) || en.length === 0) return null;
                const allMeanings = [];
                for (const sense of en) {
                    const partOfSpeech = sense.partOfSpeech || '';
                    const defs = Array.isArray(sense.definitions) ? sense.definitions : [];
                    for (const d of defs) {
                        const definition = htmlToText(d.definition);
                        if (!definition) continue;
                        let example = '';
                        if (Array.isArray(d.parsedExamples) && d.parsedExamples.length > 0) {
                            example = htmlToText(d.parsedExamples[0].example);
                        } else if (Array.isArray(d.examples) && d.examples.length > 0) {
                            example = htmlToText(d.examples[0]);
                        }
                        allMeanings.push({ partOfSpeech, definition, example, synonyms: [], antonyms: [] });
                    }
                }
                if (allMeanings.length === 0) return null;
                const first = allMeanings[0];
                return {
                    word: term,
                    phonetic: '',
                    meaning: `${first.partOfSpeech ? first.partOfSpeech + '. ' : ''}${first.definition}`,
                    example: first.example,
                    allMeanings,
                    audioUrl: '',
                    source: 'wiktionary'
                };
            }

            // 返回值：解析对象 / null（网络错误、超时、5xx，可重试）/ false（明确 404/未收录）
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

            window.wiktionaryAPI = { BASE_URL, query, htmlToText };
        })();
