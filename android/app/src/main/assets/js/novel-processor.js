        (function() {
            const COMMON_WORDS = new Set([
                'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
                'of', 'with', 'by', 'from', 'up', 'down', 'out', 'off', 'over', 'under',
                'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
                'my', 'your', 'his', 'her', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
                'this', 'that', 'these', 'those',
                'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
                'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall', 'should',
                'can', 'could', 'may', 'might', 'must',
                'go', 'went', 'gone', 'come', 'came', 'get', 'got', 'gotten',
                'see', 'saw', 'seen', 'look', 'looked', 'say', 'said', 'tell', 'told',
                'know', 'knew', 'known', 'think', 'thought',
                'one', 'two', 'three', 'first', 'second', 'third',
                'good', 'bad', 'big', 'small', 'new', 'old', 'young',
                'time', 'times', 'year', 'years', 'day', 'days', 'week', 'weeks',
                'man', 'men', 'woman', 'women', 'child', 'children',
                'very', 'just', 'not', 'no', 'yes', 'so', 'as', 'if', 'then', 'than', 'when', 'where',
                'why', 'how', 'all', 'any', 'some', 'such', 'same', 'other', 'another',
                'more', 'most', 'less', 'least', 'many', 'much', 'few', 'little',
                'here', 'there', 'now', 'then', 'again', 'always', 'never', 'often', 'sometimes',
                'well', 'better', 'best', 'also', 'too', 'either', 'neither', 'only', 'even',
                'back', 'way', 'like', 'people', 'made', 'make', 'part', 'take', 'took', 'taken',
                'put', 'set', 'let', 'use', 'used', 'work', 'worked', 'life', 'live', 'lived',
                'give', 'gave', 'given', 'find', 'found', 'try', 'tried', 'ask', 'asked',
                'need', 'needed', 'feel', 'felt', 'become', 'became', 'leave', 'left',
                'call', 'called', 'seem', 'seemed', 'help', 'helped', 'show', 'showed', 'shown',
                'hear', 'heard', 'play', 'played', 'run', 'ran', 'move', 'moved'
            ]);

            // 不规则变形 -> 原形（仅收录常见高频词，原形优先于规则变形）
            const IRREGULAR_LEMMAS = {
                children: 'child', men: 'man', women: 'woman', people: 'person',
                teeth: 'tooth', feet: 'foot', mice: 'mouse', geese: 'goose', oxen: 'ox',
                analyses: 'analysis', crises: 'crisis', matrices: 'matrix', phenomena: 'phenomenon',
                criteria: 'criterion', indices: 'index', vertices: 'vertex', appendices: 'appendix',
                been: 'be', being: 'be', am: 'be', is: 'be', are: 'be', was: 'be', were: 'be',
                has: 'have', had: 'have', does: 'do', did: 'do', done: 'do',
                went: 'go', gone: 'go', saw: 'see', seen: 'see', said: 'say',
                told: 'tell', knew: 'know', known: 'know', thought: 'think',
                took: 'take', taken: 'take', gave: 'give', given: 'give',
                found: 'find', felt: 'feel', became: 'become', left: 'leave',
                heard: 'hear', made: 'make', held: 'hold', kept: 'keep', lost: 'lose',
                met: 'meet', paid: 'pay', ran: 'run', sang: 'sing', sung: 'sing',
                sat: 'sit', slept: 'sleep', spoke: 'speak', spoken: 'speak',
                stood: 'stand', spent: 'spend', taught: 'teach', threw: 'throw', thrown: 'throw',
                understood: 'understand', wore: 'wear', worn: 'wear', won: 'win',
                wrote: 'write', written: 'write', bought: 'buy', brought: 'bring',
                caught: 'catch', chose: 'choose', chosen: 'choose', came: 'come',
                drank: 'drink', drunk: 'drink', drove: 'drive', driven: 'drive',
                ate: 'eat', eaten: 'eat', fell: 'fall', fallen: 'fall',
                flew: 'fly', flown: 'fly', forgot: 'forget', forgotten: 'forget',
                froze: 'freeze', frozen: 'freeze', grew: 'grow', grown: 'grow',
                hid: 'hide', hidden: 'hide', laid: 'lay', led: 'lead', lent: 'lend',
                lit: 'light', rode: 'ride', ridden: 'ride', rose: 'rise', risen: 'rise',
                sold: 'sell', sent: 'send', shook: 'shake', shaken: 'shake',
                shot: 'shoot', shut: 'shut', sank: 'sink', sunk: 'sink',
                stole: 'steal', stolen: 'steal', swam: 'swim', swum: 'swim',
                swept: 'sweep', tore: 'tear', torn: 'tear', woke: 'wake', woken: 'wake',
                drew: 'draw', drawn: 'draw', dealt: 'deal', dug: 'dig', fed: 'feed',
                fought: 'fight', fled: 'flee', flung: 'fling', hung: 'hang',
                meant: 'mean', rang: 'ring', rung: 'ring', sought: 'seek',
                stuck: 'stick', struck: 'strike', swore: 'swear', sworn: 'swear',
                wept: 'weep', began: 'begin', begun: 'begin', bent: 'bend',
                bit: 'bite', bitten: 'bite', bled: 'bleed', blew: 'blow', blown: 'blow',
                broke: 'break', broken: 'break', bred: 'breed', built: 'build',
                burst: 'burst', cast: 'cast', crept: 'creep', cut: 'cut',
                dove: 'dive', dreamt: 'dream', dwelt: 'dwell', knelt: 'kneel',
                leapt: 'leap', learnt: 'learn', mistook: 'mistake', mistaken: 'mistake',
                overcame: 'overcome', quit: 'quit', read: 'read', rid: 'rid',
                sewn: 'sew', shed: 'shed', shone: 'shine', shrank: 'shrink', shrunk: 'shrink',
                slid: 'slide', spilt: 'spill', spun: 'spin', spat: 'spit', split: 'split',
                spread: 'spread', sprang: 'spring', sprung: 'spring', stung: 'sting',
                stank: 'stink', stunk: 'stink', strode: 'stride', swung: 'swing',
                thrust: 'thrust', trod: 'tread', wove: 'weave', woven: 'weave',
                withdrew: 'withdraw', withdrawn: 'withdraw', wrung: 'wring',
                lying: 'lie', dying: 'die',
                better: 'good', best: 'good', worse: 'bad', worst: 'bad'
            };

            // 特殊缩写 -> 原形
            const CONTRACTION_LEMMAS = {
                "can't": 'can', "won't": 'will', "shan't": 'shall', "ain't": 'be',
                "don't": 'do', "doesn't": 'do', "didn't": 'do',
                "isn't": 'be', "aren't": 'be', "wasn't": 'be', "weren't": 'be',
                "haven't": 'have', "hasn't": 'have', "hadn't": 'have',
                "wouldn't": 'will', "couldn't": 'can', "shouldn't": 'should', "mustn't": 'must'
            };

            const CLITIC_RULES = [
                [/['’]s$/, ''], [/s'$/, 's'], [/n't$/, ''],
                [/['’](re|ve|ll|d|m)$/, '']
            ];

            class NovelProcessor {
                constructor() {
                    this.wordFrequency = new Map();
                    this.dictionaryCache = new Map();
                    this.abortController = null;
                    this._freqRankMap = null;
                    this._variants = new Map();
                    this._lemmaCache = new Map();
                }

                abort() {
                    if (this.abortController) {
                        this.abortController.abort();
                        this.abortController = null;
                    }
                }

                // 词频排名（1 = 最高频）；不在词频表内返回 0
                frequencyRank(word) {
                    if (!this._freqRankMap) {
                        this._freqRankMap = new Map();
                        const list = (typeof window !== 'undefined' && Array.isArray(window.WORD_FREQ))
                            ? window.WORD_FREQ : [];
                        list.forEach((w, i) => this._freqRankMap.set(w, i + 1));
                    }
                    return this._freqRankMap.get(word) || 0;
                }

                // 提取词元（保留大小写信息用于专有名词判断），剥离 HTML 标签
                tokenize(text) {
                    const stripped = String(text || '').replace(/<[^>]*>/g, ' ');
                    return stripped.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || [];
                }

                lemmatize(word, lexicon) {
                    if (!word) return word;
                    if (this._lemmaCache.has(word)) return this._lemmaCache.get(word);
                    const result = this._lemmatizeUncached(word, lexicon);
                    this._lemmaCache.set(word, result);
                    return result;
                }

                _lemmatizeUncached(word, lexicon) {
                    if (CONTRACTION_LEMMAS[word]) return CONTRACTION_LEMMAS[word];
                    if (IRREGULAR_LEMMAS[word]) return IRREGULAR_LEMMAS[word];
                    const has = (c) => c && c.length >= 2 && c !== word && lexicon.has(c);
                    const candidates = [];
                    const add = (c) => { if (c && c !== word && !candidates.includes(c)) candidates.push(c); };
                    for (const [re, rep] of CLITIC_RULES) {
                        if (re.test(word)) add(word.replace(re, rep));
                    }
                    if (/ies$/.test(word) && word.length > 4) add(word.slice(0, -3) + 'y');
                    if (/s$/.test(word) && !/ss$/.test(word) && word.length > 3) add(word.slice(0, -1));
                    if (/(?:xes|ses|zes|ches|shes|oes)$/.test(word)) add(word.slice(0, -2));
                    if (/ves$/.test(word) && word.length > 4) {
                        add(word.slice(0, -3) + 'f');
                        add(word.slice(0, -3) + 'fe');
                    }
                    if (/ied$/.test(word) && word.length > 4) add(word.slice(0, -3) + 'y');
                    if (/ing$/.test(word) && word.length > 4) {
                        const stem = word.slice(0, -3);
                        add(stem);
                        if (stem.length >= 3) {
                            add(stem + 'e');
                            add(this._undouble(stem));
                        }
                    }
                    if (/ed$/.test(word) && word.length > 4) {
                        const stem = word.slice(0, -2);
                        add(stem);
                        if (stem.length >= 3) {
                            add(stem + 'e');
                            add(this._undouble(stem));
                        }
                    }
                    for (const c of candidates) {
                        if (has(c)) return c;
                    }
                    return word;
                }

                // 双写辅音去重（running: runn -> run），仅用于规则变形的候选
                _undouble(stem) {
                    if (stem.length >= 4 && /([bcdfgklmnprtvz])\1$/.test(stem)) {
                        return stem.slice(0, -1);
                    }
                    return null;
                }

                async processNovel(text, options = {}) {
                    const {
                        minFrequency = 3,
                        skipRank = 0,
                        allowedWords = null,
                        excludeProperNouns = true
                    } = options;
                    console.log('开始处理小说文本...');
                    const stripped = String(text || '').replace(/<[^>]*>/g, ' ');
                    const tokenRegex = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
                    const tokens = [];
                    const tokenStarts = [];
                    let tokenMatch;
                    while ((tokenMatch = tokenRegex.exec(stripped)) !== null) {
                        tokens.push(tokenMatch[0]);
                        tokenStarts.push(tokenMatch.index);
                    }
                    console.log(`提取到 ${tokens.length} 个词元`);
                    this._lemmaCache.clear();
                    this._variants.clear();
                    this.wordFrequency.clear();

                    const surfaceCounts = new Map();
                    for (const token of tokens) {
                        const surface = token.replace(/’/g, "'").toLowerCase();
                        surfaceCounts.set(surface, (surfaceCounts.get(surface) || 0) + 1);
                    }
                    // 词形还原的词典校验集：文中所有词形 + 词频表 + 限定词表
                    const lexicon = new Set(surfaceCounts.keys());
                    const freqList = (typeof window !== 'undefined' && Array.isArray(window.WORD_FREQ))
                        ? window.WORD_FREQ : [];
                    for (const w of freqList) lexicon.add(w);
                    if (allowedWords) for (const w of allowedWords) lexicon.add(w);

                    const lemmaStats = new Map();
                    let prevEnd = 0;
                    tokens.forEach((token, index) => {
                        const start = tokenStarts[index];
                        const sentenceInitial = prevEnd === 0 || /[.!?…]/.test(stripped.slice(prevEnd, start));
                        prevEnd = start + token.length;
                        const raw = token.replace(/’/g, "'");
                        const surface = raw.toLowerCase();
                        const lemma = this.lemmatize(surface, lexicon);
                        let stat = lemmaStats.get(lemma);
                        if (!stat) {
                            stat = { count: 0, lower: 0, capMid: 0, first: index, variants: new Set() };
                            lemmaStats.set(lemma, stat);
                        }
                        stat.count++;
                        stat.variants.add(surface);
                        if (/^[a-z]/.test(raw)) stat.lower++;
                        else if (!sentenceInitial) stat.capMid++;
                    });
                    console.log(`合并词形后得到 ${lemmaStats.size} 个原形`);

                    const wordList = [];
                    for (const [lemma, stat] of lemmaStats) {
                        if (stat.count < minFrequency) continue;
                        if (COMMON_WORDS.has(lemma) && !(allowedWords && allowedWords.has(lemma))) continue;
                        if (lemma.length < 3 || lemma.length > 20) continue;
                        if (allowedWords && !allowedWords.has(lemma)) continue;
                        if (skipRank > 0 && !(allowedWords && allowedWords.has(lemma))) {
                            const rank = this.frequencyRank(lemma);
                            if (rank > 0 && rank <= skipRank) continue;
                        }
                        if (excludeProperNouns && stat.capMid > 0 && stat.lower === 0 && !(allowedWords && allowedWords.has(lemma))) continue;
                        wordList.push(lemma);
                    }
                    wordList.sort((a, b) => lemmaStats.get(b).count - lemmaStats.get(a).count
                        || (a < b ? -1 : a > b ? 1 : 0));
                    for (const lemma of wordList) {
                        const stat = lemmaStats.get(lemma);
                        this.wordFrequency.set(lemma, stat.count);
                        this._variants.set(lemma, stat.variants);
                    }
                    console.log(`过滤后剩余 ${wordList.length} 个待学单词`);
                    return {
                        totalWords: tokens.length,
                        uniqueWords: lemmaStats.size,
                        wordList,
                        frequencyMap: this.wordFrequency,
                        difficultyDistribution: this.getDifficultyDistribution(wordList)
                    };
                }

                assignDifficulty(word) {
                    const rank = this.frequencyRank(word);
                    if (rank > 0) {
                        if (rank <= 2000) return 1;
                        if (rank <= 4000) return 2;
                        if (rank <= 6000) return 3;
                        if (rank <= 9000) return 4;
                        return 5;
                    }
                    // 词频表之外的生僻词：沿用启发式评分
                    const frequency = this.wordFrequency.get(word) || 0;
                    const length = word.length;
                    const lowerWord = word.toLowerCase();
                    let difficultyScore = 0;
                    let maxPossibleScore = 0;
                    let freqScore;
                    if (frequency >= 100) freqScore = 1;
                    else if (frequency >= 30) freqScore = 2;
                    else if (frequency >= 10) freqScore = 3;
                    else if (frequency >= 5) freqScore = 4;
                    else freqScore = 5;
                    difficultyScore += freqScore * 0.2;
                    maxPossibleScore += 5 * 0.2;
                    let lengthScore;
                    if (length <= 3) lengthScore = 1;
                    else if (length <= 5) lengthScore = 2;
                    else if (length <= 7) lengthScore = 3;
                    else if (length <= 9) lengthScore = 4;
                    else lengthScore = 5;
                    difficultyScore += lengthScore * 0.5;
                    maxPossibleScore += 5 * 0.5;
                    const vowelGroups = (lowerWord.match(/[aeiouy]+/g) || []).length;
                    let syllableScore;
                    if (vowelGroups <= 1) syllableScore = 1;
                    else if (vowelGroups === 2) syllableScore = 2;
                    else if (vowelGroups === 3) syllableScore = 3;
                    else if (vowelGroups === 4) syllableScore = 4;
                    else syllableScore = 5;
                    difficultyScore += syllableScore * 0.2;
                    maxPossibleScore += 5 * 0.2;
                    let academicScore = 0;
                    const strictAcademicSuffixes = /(ology|ologist|ism|ist|ize|ise|ify|ation|ition|ance|ence|ency|ancy|ive|ous|able|ible|ent|ant)$/i;
                    const strictAcademicPrefixes = /^(anti|auto|bi|co|counter|de|dis|en|ex|extra|fore|hyper|il|im|in|ir|inter|intra|macro|micro|mid|mis|mono|multi|non|over|post|pre|pro|pseudo|re|semi|sub|super|trans|tri|ultra|un|under|uni|bio|cardio|chrono|cosmo|cycl|demo|dyn|eco|ethno|geo|graph|helio|hemo|hydro|hypo|iso|mega|meta|micro|mono|morph|neo|neuro|omni|para|path|phil|phobia|photo|physio|pod|poly|psych|pyro|scope|socio|techno|tele|thermo|typo|xeno)/i;
                    if (strictAcademicSuffixes.test(lowerWord)) academicScore += 1;
                    if (strictAcademicPrefixes.test(lowerWord)) academicScore += 1;
                    if (academicScore >= 2 && length >= 8) academicScore += 1;
                    difficultyScore += Math.min(3, academicScore) * 0.1;
                    maxPossibleScore += 3 * 0.1;
                    const normalizedScore = (difficultyScore / maxPossibleScore) * 5;
                    if (normalizedScore <= 1.6) return 1;
                    if (normalizedScore <= 2.4) return 2;
                    if (normalizedScore <= 3.2) return 3;
                    if (normalizedScore <= 4.0) return 4;
                    return 5;
                }

                getDifficultyDistribution(words) {
                    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
                    words.forEach(word => {
                        const level = this.assignDifficulty(word);
                        distribution[level]++;
                    });
                    return distribution;
                }

                async getDictionaryData(word, signal) {
                    if (this.dictionaryCache.has(word)) {
                        return this.dictionaryCache.get(word);
                    }
                    const shared = (typeof window !== 'undefined' && window.dictionaryAPI) ? window.dictionaryAPI : null;
                    const externalSignal = signal || (this.abortController ? this.abortController.signal : undefined);
                    if (!shared || typeof shared.fetchWordData !== 'function') {
                        return this.getFallbackData(word);
                    }
                    try {
                        const data = await shared.fetchWordData(word, {
                            signal: externalSignal,
                            persist: false,
                            memory: false
                        });
                        const examples = Array.isArray(data.allMeanings)
                            ? data.allMeanings.map(item => item.example).filter(Boolean)
                            : [];
                        const result = {
                            meaning: data.meaning,
                            phonetic: data.phonetic,
                            examples: examples.length > 0
                                ? examples
                                : (data.example ? [data.example] : [`This is an example sentence for ${word}.`]),
                            audioUrl: data.audioUrl || '',
                            allMeanings: data.allMeanings || [],
                            rawApiData: data.rawData || null
                        };
                        // 网络失败时不要缓存兜底结果，方便用户稍后重试
                        if (!(data.source === 'fallback' && !data.notFound)) {
                            this.dictionaryCache.set(word, result);
                        }
                        return result;
                    } catch (error) {
                        if (error && error.name === 'AbortError') throw error;
                        console.warn(`获取"${word}"词典数据失败:`, error);
                        return this.getFallbackData(word);
                    }
                }

                generatePhoneticFallback(word) {
                    const simpleRules = {
                        'a': 'æ', 'e': 'ɛ', 'i': 'ɪ', 'o': 'ɒ', 'u': 'ʌ',
                        'ay': 'aɪ', 'ee': 'iː', 'oo': 'uː', 'th': 'θ'
                    };
                    let phonetic = word.toLowerCase();
                    for (const [pattern, replacement] of Object.entries(simpleRules)) {
                        phonetic = phonetic.replace(new RegExp(pattern, 'g'), replacement);
                    }
                    return phonetic;
                }

                getFallbackData(word) {
                    return {
                        meaning: `${word} 的释义（网络数据获取失败，请检查网络）`,
                        phonetic: `/${this.generatePhoneticFallback(word)}/`,
                        examples: [`This is an example sentence for ${word}.`],
                        allMeanings: [],
                        audioUrl: ''
                    };
                }

                async batchProcessWords(words, callback, concurrency = 12) {
                    const results = [];
                    const queue = [...words];
                    let processed = 0;
                    const controller = new AbortController();
                    this.abortController = controller;
                    const workers = Array(concurrency).fill().map(async () => {
                        while (queue.length > 0) {
                            const word = queue.shift();
                            try {
                                const data = await this.getDictionaryData(word, controller.signal);
                                const difficulty = this.assignDifficulty(word);
                                const frequency = this.wordFrequency.get(word) || 0;
                                results.push({
                                    word,
                                    difficulty,
                                    frequency,
                                    meaning: data.meaning,
                                    phonetic: data.phonetic,
                                    example: Array.isArray(data.examples) ? data.examples[0] : data.examples,
                                    collins: null,
                                    rawData: data.rawApiData
                                });
                                processed++;
                                if (callback) callback(processed, words.length, word);
                            } catch (error) {
                                if (error.name === 'AbortError') {
                                    console.log(`获取单词"${word}"被取消`);
                                    throw error;
                                }
                                console.error(`处理单词 "${word}" 时出错:`, error);
                                const fallbackData = this.getFallbackData(word);
                                results.push({
                                    word,
                                    difficulty: this.assignDifficulty(word),
                                    frequency: this.wordFrequency.get(word) || 0,
                                    meaning: fallbackData.meaning,
                                    phonetic: fallbackData.phonetic,
                                    example: fallbackData.examples[0],
                                    collins: null
                                });
                                processed++;
                            }
                            await new Promise(r => setTimeout(r, 20));
                        }
                    });
                    await Promise.all(workers);
                    if (this.abortController === controller) this.abortController = null;
                    return results;
                }

                // 从原文中截取包含该单词（或其变形）的上下文
                extractSentence(word, text) {
                    if (!text || !word) return '';
                    const variants = this._variants.get(word);
                    const candidates = variants && variants.size > 0
                        ? [word, ...variants]
                        : [word];
                    const escaped = candidates
                        .map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                        .sort((a, b) => b.length - a.length);
                    const re = new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
                    const match = re.exec(text);
                    if (!match) return '';
                    const idx = match.index;
                    const start = Math.max(0, idx - 60);
                    const end = Math.min(text.length, idx + match[0].length + 60);
                    let sentence = text.slice(start, end);
                    if (start > 0) sentence = '...' + sentence;
                    if (end < text.length) sentence = sentence + '...';
                    return sentence;
                }
            }

            window.novelProcessor = new NovelProcessor();
        })();
