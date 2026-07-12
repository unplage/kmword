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

            class NovelProcessor {
                constructor() {
                    this.wordFrequency = new Map();
                    this.difficultyLevels = {
                        1: { name: '初级', freqRange: [1000, Infinity] },
                        2: { name: '中级', freqRange: [500, 999] },
                        3: { name: '高级', freqRange: [200, 499] },
                        4: { name: '专业', freqRange: [50, 199] },
                        5: { name: '学术', freqRange: [0, 49] }
                    };
                    this.dictionaryCache = new Map();
                    this.abortController = null;
                }

                abort() {
                    if (this.abortController) {
                        this.abortController.abort();
                        this.abortController = null;
                    }
                }

                async processNovel(text, options = {}) {
                    const { excludeCommon = true, minFrequency = 3, autoDifficulty = true } = options;
                    console.log('开始处理小说文本...');
                    const cleanedText = this.cleanText(text);
                    const words = this.extractWords(cleanedText);
                    console.log(`提取到 ${words.length} 个单词`);
                    this.calculateFrequency(words);
                    let filteredWords = this.filterWords(words, { excludeCommon, minFrequency });
                    console.log(`过滤后剩余 ${filteredWords.length} 个单词`);
                    const uniqueWords = [...new Set(filteredWords)];
                    console.log(`去重后剩余 ${uniqueWords.length} 个单词`);
                    return {
                        totalWords: words.length,
                        uniqueWords: uniqueWords.length,
                        wordList: uniqueWords,
                        frequencyMap: this.wordFrequency,
                        difficultyDistribution: this.getDifficultyDistribution(uniqueWords)
                    };
                }

                cleanText(text) {
                    return text
                        .toLowerCase()
                        .replace(/[^\w\s']/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                }

                extractWords(text) {
                    return text.split(' ')
                        .map(word => word.replace(/^'|'$/g, ''))
                        .filter(word => word.length > 1)
                        .filter(word => !/^\d+$/.test(word));
                }

                calculateFrequency(words) {
                    this.wordFrequency.clear();
                    words.forEach(word => {
                        this.wordFrequency.set(word, (this.wordFrequency.get(word) || 0) + 1);
                    });
                }

                filterWords(words, options) {
                    const { excludeCommon, minFrequency } = options;
                    return words.filter(word => {
                        const frequency = this.wordFrequency.get(word);
                        if (frequency < minFrequency) return false;
                        if (excludeCommon && COMMON_WORDS.has(word)) return false;
                        if (word.length < 3 || word.length > 20) return false;
                        return true;
                    });
                }

                assignDifficulty(word) {
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

                async getDictionaryData(word) {
                    if (this.dictionaryCache.has(word)) {
                        return this.dictionaryCache.get(word);
                    }
                    this.abortController = new AbortController();
                    try {
                        const response = await fetch(
                            `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
                            { signal: this.abortController.signal }
                        );
                        if (!response.ok) {
                            if (response.status === 404) {
                                console.log(`单词 "${word}" 在词典中未找到`);
                                const fallbackData = this.getFallbackData(word);
                                this.dictionaryCache.set(word, fallbackData);
                                return fallbackData;
                            }
                            throw new Error(`API响应错误: ${response.status}`);
                        }
                        const data = await response.json();
                        const parsedData = this.parseDictionaryResponse(data, word);
                        this.dictionaryCache.set(word, parsedData);
                        return parsedData;
                    } catch (error) {
                        if (error.name === 'AbortError') {
                            console.log(`获取单词"${word}"被取消`);
                            throw error;
                        }
                        console.warn(`获取单词"${word}"的词典数据失败:`, error);
                        const fallbackData = this.getFallbackData(word);
                        this.dictionaryCache.set(word, fallbackData);
                        return fallbackData;
                    }
                }

                parseDictionaryResponse(apiData, originalWord) {
                    if (!apiData || !Array.isArray(apiData) || apiData.length === 0) {
                        return this.getFallbackData(originalWord);
                    }
                    const entry = apiData[0];
                    let phonetic = '';
                    if (entry.phonetic) {
                        phonetic = entry.phonetic;
                    } else if (entry.phonetics && entry.phonetics.length > 0) {
                        const firstPhonetic = entry.phonetics.find(p => p.text);
                        if (firstPhonetic) {
                            phonetic = firstPhonetic.text;
                        }
                    }
                    let meaning = '';
                    let example = '';
                    let allMeanings = [];
                    if (entry.meanings && entry.meanings.length > 0) {
                        const firstMeaning = entry.meanings[0];
                        const partOfSpeech = firstMeaning.partOfSpeech || '';
                        if (firstMeaning.definitions && firstMeaning.definitions.length > 0) {
                            const firstDefinition = firstMeaning.definitions[0];
                            meaning = `${partOfSpeech ? partOfSpeech + '. ' : ''}${firstDefinition.definition || '暂无释义'}`;
                            example = firstDefinition.example || '';
                        }
                        entry.meanings.forEach(meaningObj => {
                            if (meaningObj.definitions) {
                                meaningObj.definitions.forEach(def => {
                                    allMeanings.push({
                                        partOfSpeech: meaningObj.partOfSpeech,
                                        definition: def.definition,
                                        example: def.example
                                    });
                                });
                            }
                        });
                    }
                    let audioUrl = '';
                    if (entry.phonetics && entry.phonetics.length > 0) {
                        const audioPhonetic = entry.phonetics.find(p => p.audio && p.audio.length > 0);
                        if (audioPhonetic) {
                            audioUrl = audioPhonetic.audio;
                        }
                    }
                    return {
                        meaning: meaning || `${originalWord} 的释义`,
                        phonetic: phonetic || `/${this.generatePhoneticFallback(originalWord)}/`,
                        examples: allMeanings.length > 0 
                            ? allMeanings.map(m => m.example).filter(e => e) 
                            : [`This is an example sentence for ${originalWord}.`],
                        audioUrl,
                        allMeanings,
                        rawApiData: entry
                    };
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
                    const workers = Array(concurrency).fill().map(async () => {
                        while (queue.length > 0) {
                            const word = queue.shift();
                            try {
                                const data = await this.getDictionaryData(word);
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
                    return results;
                }

                extractSentence(word, text) {
                    const lowerWord = word.toLowerCase();
                    const lowerText = text.toLowerCase();
                    const idx = lowerText.indexOf(lowerWord);
                    if (idx < 0) return '';
                    const start = Math.max(0, idx - 60);
                    const end = Math.min(text.length, idx + word.length + 60);
                    let sentence = text.slice(start, end);
                    if (start > 0) sentence = '...' + sentence;
                    if (end < text.length) sentence = sentence + '...';
                    return sentence;
                }
            }

            window.novelProcessor = new NovelProcessor();
        })();
