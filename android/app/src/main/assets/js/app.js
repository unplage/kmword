        (function() {
            class WordLearnerApp {
                constructor() {
                    this.AI_DEFAULT_PROMPT = '请分析英文单词 "{word}"，使用中文回答。请包含以下内容：\n\n1. 词性和基本释义\n2. 词根词缀分析\n3. 记忆技巧\n4. 常用搭配和短语\n5. 近义词辨析\n6. 例句';
                    this.db = window.wordDB;
                    this.novelProcessor = window.novelProcessor;
                    this.currentPage = 'home';
                    this.learningWords = [];
                    this.currentWordIndex = 0;
                    this.showingDetails = false;
                    this.networkAvailable = true;
                    this.currentAudioUrl = null;
                    this.lookupModalAudioUrl = '';
                    this.speechSynthesis = null;
                    this.voices = [];
                    this.searchDebounceTimer = null;
                    this.isProcessing = false;
                    this.isStudyingPreparedSession = false;
                    this.learningMode = 'recognition'; // 'recognition' | 'spelling'
                    this.spellingLocked = false;        // 提交后锁定输入直到推进
                    this.currentReadingArticleId = null;
                    this.currentReadingArticle = null;
                    this.currentReadingScrollPct = 0;
                    this.currentReaderFontSize = 18;
                    this.uploadMode = 'word';
                    this.readerParagraphs = [];
                    this._readerEventsBound = false;
                    this._readerStarting = false;
                    this._ttsStartTimer = null;
                    this._isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
                    this.mimoConfig = { engine: 'system', apiKey: '', voice: 'mimo_default', style: 'standard', styleCustom: '' };
                    this._mimoCtx = null;
                    this._mimoSources = [];
                    this._mimoSession = null;
                    this._mimoAborter = null;
                    this.currentListeningFileId = null;
                    this.currentListeningFile = null;
                    this.currentListeningSegments = [];
                    this.playerAudio = null;
                    this.playerSegmentIndex = 0;
                    this.playerSpeed = 1;
                    this.playerPlaying = false;
                    this._playerTimeRaf = null;
                    this._restorePlayerTime = 0;
                    this._lastPlayerPositionSave = 0;
                    this._listeningGenAborter = null;

                    this.LLM_PROVIDERS = {
                        zhipu: {
                            name: '智谱 GLM',
                            baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
                            defaultModel: 'glm-4.7-flash',
                            webSearch: true
                        },
                        deepseek: {
                            name: 'DeepSeek',
                            baseUrl: 'https://api.deepseek.com/v1',
                            defaultModel: 'deepseek-v4-flash',
                            webSearch: false
                        },
                        mimo: {
                            name: '小米 MiMo',
                            baseUrl: 'https://api.xiaomimimo.com/v1',
                            defaultModel: 'mimo-v2.5',
                            webSearch: false
                        },
                        qwen: {
                            name: '通义千问',
                            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                            defaultModel: 'qwen-plus',
                            webSearch: false
                        },
                        custom: {
                            name: '自定义 (OpenAI兼容)',
                            baseUrl: '',
                            defaultModel: '',
                            webSearch: false
                        }
                    };

					// 多源在线词典（freedictionaryapi.com / dictionaryapi.dev / Wiktionary / Datamuse）
					// 共享模块见 js/dictionary-api.js；下面的对象仅作为模块加载失败时的兜底。
					this.dictionaryAPI = window.dictionaryAPI || {
						baseUrl: 'https://api.dictionaryapi.dev/api/v2/entries/en',
						cache: new Map(),
					async fetchWordData(word) {
						const cacheKey = (word || '').toLowerCase().trim();
						if (!cacheKey) return this.getFallbackData(word);
						if (this.cache.has(cacheKey)) { return this.cache.get(cacheKey); }
						const freeResult = await this._fetchFromFreeDict(word);
						if (freeResult) {
							this.cache.set(cacheKey, freeResult);
							return freeResult;
						}
						const wikResult = await this._fetchFromWiktionary(word);
						if (wikResult) {
							this.cache.set(cacheKey, wikResult);
							return wikResult;
						}
						// 仅当两个源都明确未收录时才缓存兜底；网络/超时错误不缓存，便于重试
						const fallback = this.getFallbackData(word);
						if (freeResult === false && wikResult === false) {
							this.cache.set(cacheKey, fallback);
						}
						return fallback;
					},
					async _fetchFromFreeDict(word) {
						const controller = new AbortController();
						const timer = setTimeout(() => controller.abort(), 10000);
						try {
							console.log(`正在获取单词"${word}"的数据...`);
							const response = await fetch(`${this.baseUrl}/${encodeURIComponent(word)}`, { signal: controller.signal });
							if (response.status === 404) return false;
							if (!response.ok) throw new Error(`API请求失败: ${response.status}`);
							const data = await response.json();
							if (!Array.isArray(data) || data.length === 0) return false;
							console.log(`单词"${word}"数据获取成功（Free Dictionary）`);
							return this.parseApiData(data, word);
						} catch (error) {
							console.error(`Free Dictionary 获取"${word}"失败:`, error);
							return null;
						} finally {
							clearTimeout(timer);
						}
					},
					async _fetchFromWiktionary(word) {
						if (typeof window === 'undefined' || !window.wiktionaryAPI) return null;
						try {
							const wik = await window.wiktionaryAPI.query(word);
							if (!wik) return wik === false ? false : null;
							console.log(`单词"${word}"数据获取成功（Wiktionary 备用源）`);
							return {
								word: word,
								phonetic: wik.phonetic || `/${this.generatePhoneticFallback(word)}/`,
								meaning: wik.meaning,
								example: wik.example || '',
								allMeanings: wik.allMeanings,
								audioUrl: wik.audioUrl || '',
								rawData: { source: 'wiktionary' }
							};
						} catch (error) {
							console.error(`Wiktionary 获取"${word}"失败:`, error);
							return null;
						}
					},
						parseApiData(apiData, originalWord) {
							if (!apiData || !Array.isArray(apiData) || apiData.length === 0) {
								return this.getFallbackData(originalWord);
							}
							const entry = apiData[0];
							let phonetic = '';
							if (entry.phonetic) { phonetic = entry.phonetic; }
							else if (entry.phonetics && entry.phonetics.length > 0) {
								const firstPhonetic = entry.phonetics.find(p => p.text);
								if (firstPhonetic) { phonetic = firstPhonetic.text; }
							}
							let meaning = ''; let example = ''; let allMeanings = [];
							if (entry.meanings && entry.meanings.length > 0) {
								const firstMeaning = entry.meanings[0];
								const partOfSpeech = firstMeaning.partOfSpeech || '';
								if (firstMeaning.definitions && firstMeaning.definitions.length > 0) {
									const firstDefinition = firstMeaning.definitions[0];
									meaning = `${partOfSpeech ? partOfSpeech + '. ' : ''}${firstDefinition.definition || '暂无释义'}`;
									example = firstDefinition.example || '';
								}
								// 遍历所有词性下的定义，提取同义词和反义词
								entry.meanings.forEach(meaningObj => {
									const partOfSpeech = meaningObj.partOfSpeech || '';
									if (meaningObj.definitions) {
										meaningObj.definitions.forEach((def) => {
											allMeanings.push({
												partOfSpeech,
												definition: def.definition || '',
												example: def.example || '',
												synonyms: def.synonyms || [], // 提取同义词
												antonyms: def.antonyms || []  // 提取反义词
											});
										});
									}
								});
							}
							let audioUrl = '';
							if (entry.phonetics && entry.phonetics.length > 0) {
								const audioPhonetic = entry.phonetics.find(p => p.audio && p.audio.length > 0);
								if (audioPhonetic) { audioUrl = audioPhonetic.audio; }
							}
							return {
								word: originalWord,
								phonetic: phonetic || `/${this.generatePhoneticFallback(originalWord)}/`,
								meaning: meaning || `${originalWord} 的释义`,
								example: example || '',
								allMeanings: allMeanings,
								audioUrl: audioUrl,
								rawData: entry
							};
						},
						generatePhoneticFallback(word) {
							const simpleRules = { 'a': 'æ', 'e': 'ɛ', 'i': 'ɪ', 'o': 'ɒ', 'u': 'ʌ', 'ay': 'aɪ', 'ee': 'iː', 'oo': 'uː', 'th': 'θ' };
							let phonetic = word.toLowerCase();
							for (const [pattern, replacement] of Object.entries(simpleRules)) { phonetic = phonetic.replace(new RegExp(pattern, 'g'), replacement); }
							return phonetic;
						},
						getFallbackData(word) {
							return {
								word: word,
								phonetic: `/${this.generatePhoneticFallback(word)}/`,
								meaning: `${word} 的释义（网络查询失败）`,
								example: `This is an example for ${word}.`,
								allMeanings: [],
								audioUrl: '',
								rawData: null
							};
						}
					};
                    
                    this.playAudio = async function(url, fallbackWord) {
                        if (url) {
                            try {
                                const audio = new Audio(url);
                                await audio.play();
                                return;
                            } catch (e) {
                                console.warn('音频播放失败，使用 TTS:', e);
                            }
                        }
                        if (fallbackWord) this.speakWord(fallbackWord);
                    };

                    this.speakText = function(text) {
                        if (!text || !this.speechSynthesis) {
                            this.showNotification('语音合成不可用', 'warning');
                            return;
                        }
                        if (this.readerTTS) this.stopReaderTTS();
                        this.speechSynthesis.cancel();
                        const utterance = new SpeechSynthesisUtterance(text);
                        utterance.rate = 0.9;
                        const enVoice = this.voices.find(v => v.lang.startsWith('en'));
                        if (enVoice) utterance.voice = enVoice;
                        this.speechSynthesis.speak(utterance);
                    };
                    
					// ===== 2. 全新升级的 Merriam-Webster API 解析与渲染 =====
					// ===== 2. Merriam-Webster API 客户端（解析见 js/mw-parser.js）=====
					this.mwAPI = {
						dictBase: 'https://www.dictionaryapi.com/api/v3/references/collegiate/json',
						thesBase: 'https://www.dictionaryapi.com/api/v3/references/thesaurus/json',
						get parser() {
							return typeof window !== 'undefined' ? window.mwParser : null;
						},
						cleanMWText(text) {
							const p = this.parser;
							return p ? p.cleanText(text) : '';
						},
						getAudioUrl(audioId) {
							const p = this.parser;
							return p ? p.buildAudioUrl(audioId) : '';
						},
						parseDict(dictData) {
							const p = this.parser;
							return p ? p.parseDict(dictData) : [];
						},
						parseThesaurus(thesData) {
							const p = this.parser;
							return p ? p.parseThesaurus(thesData) : null;
						},
						async lookupWord(word) {
							const dictKey = await window.wordDB.getSetting('mwDictKey');
							const thesKey = await window.wordDB.getSetting('mwThesKey');
							if (!dictKey && !thesKey) { throw new Error('请至少配置一个 Merriam-Webster API Key（词典或同义词）'); }
							const promises = [];
							if (dictKey) { promises.push( fetch(`${this.dictBase}/${encodeURIComponent(word)}?key=${dictKey}`).then(response => ({ type: 'dict', response })) ); }
							if (thesKey) { promises.push( fetch(`${this.thesBase}/${encodeURIComponent(word)}?key=${thesKey}`).then(response => ({ type: 'thes', response })) ); }
							const results = await Promise.all(promises);
							let dictData = null; let thesData = null;
							for (const result of results) {
								const { type, response } = result;
								if (type === 'dict') { if (response.ok) { dictData = await response.json(); } else if (response.status !== 404) { throw new Error(`词典API请求失败 (${response.status})`); } }
								else if (type === 'thes') { if (response.ok) { thesData = await response.json(); } else if (response.status !== 404) { throw new Error(`同义词API请求失败 (${response.status})`); } }
							}
							return { dict: dictData, thesaurus: thesData };
						}
					};

					if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => this.init()); }
					else { this.init(); }
				}

                async init() {
                    console.log('应用初始化开始');
                    this._initCount = (this._initCount || 0) + 1;
                    try { sessionStorage.setItem('kw_app_loads', String(Number(sessionStorage.getItem('kw_app_loads') || 0) + 1)); } catch (e) {}
                    try {
                        // 先绑定事件，保证网络探测期间界面依然可交互
                        this.bindEvents();
                        this.registerServiceWorker();
                        this.setupNetworkListeners();
                        await this.db.ready();
                        console.log('数据库初始化完成');
                        await this.db.loadSrsConfig();
                        this.initSpeech();
                        await this.loadInitialData();
                        await this.updateTodayProgress();
                        await this.testNetworkConnection();
                        this.learningMode = await this.db.getSetting('learningMode', 'recognition') || 'recognition';
                        this.syncModeToggleUI();
                        this.mimoConfig = {
                            engine: (await this.db.getSetting('ttsEngine')) || 'system',
                            apiKey: (await this.db.getSetting('mimoApiKey')) || '',
                            voice: (await this.db.getSetting('mimoVoice')) || 'mimo_default',
                            style: (await this.db.getSetting('mimoStyle')) || 'standard',
                            styleCustom: (await this.db.getSetting('mimoStyleCustom')) || ''
                        };
                        await this.promptResumeListening();
                        const savedFontSize = await this.db.getSetting('fontSize', 'medium');
                        this.applyFontSize(savedFontSize);
                        document.getElementById('mwLookupBtn')?.addEventListener('click', () => this.lookupMerriamWebster());
                        window.addEventListener('beforeunload', () => {
                            this.cleanup();
                        });
                        console.log('应用初始化完成');
                    } catch (error) {
                        console.error('应用初始化失败:', error);
                        this.showNotification('应用初始化失败，部分功能可能受限', 'error');
                    } finally {
                        this._initialized = true;
                    }
                }

                registerServiceWorker() {
                    if ('serviceWorker' in navigator) {
                        window.addEventListener('load', async () => {
                            try {
                                const registration = await navigator.serviceWorker.register('./sw.js');
                                console.log('Service Worker 注册成功:', registration.scope);
                                registration.addEventListener('updatefound', () => {
                                    const newWorker = registration.installing;
                                    newWorker.addEventListener('statechange', () => {
                                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                            this.showNotification('发现新版本，请刷新页面更新', 'info');
                                        }
                                    });
                                });
                            } catch (error) {
                                console.error('Service Worker 注册失败:', error);
                            }
                        });
                    }
                }

                setupNetworkListeners() {
                    const offlineIndicator = document.getElementById('offlineIndicator');
                    const updateOnlineStatus = () => {
                        this.networkAvailable = navigator.onLine;
                        if (navigator.onLine) {
                            offlineIndicator.classList.remove('show');
                            this.testNetworkConnection();
                        } else {
                            offlineIndicator.classList.add('show');
                            this.networkAvailable = false;
                        }
                    };
                    window.addEventListener('online', updateOnlineStatus);
                    window.addEventListener('offline', updateOnlineStatus);
                    updateOnlineStatus();
                }

                cleanup() {
                    this.clearPendingTimer();
                    if (this._ecdictWorker) {
                        try { this._ecdictWorker.terminate(); } catch (e) {}
                        this._ecdictWorker = null;
                    }
                    this._abortListeningGeneration();
                    if (this.novelProcessor) {
                        this.novelProcessor.abort();
                    }
                    if (this.db) {
                        this.db.close();
                    }
                    if (this.speechSynthesis) {
                        this.speechSynthesis.cancel();
                    }
                    this.mimoStop();
                }

                async testNetworkConnection() {
                    if (!navigator.onLine) {
                        this.networkAvailable = false;
                        return;
                    }
                    try {
                        console.log('正在测试网络连接...');
                        const online = window.dictionaryAPI && typeof window.dictionaryAPI.probe === 'function'
                            ? await window.dictionaryAPI.probe({ timeout: 4000 })
                            : navigator.onLine;
                        this.networkAvailable = !!online;
                        console.log(`网络连接测试: ${this.networkAvailable ? '成功' : '失败'}`);
                    } catch (error) {
                        console.warn('网络连接测试失败，将使用本地数据');
                        this.networkAvailable = false;
                    }
                }

                bindEvents() {
                    console.log('开始绑定事件...');
                    window.addEventListener('scroll', () => {
                        if (this.currentPage !== 'reader') return;
                        const bar = document.getElementById('readerProgressBar');
                        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
                        const pct = maxScroll > 0 ? window.scrollY / maxScroll : 0;
                        this.currentReadingScrollPct = pct;
                        if (bar) bar.style.width = (pct * 100) + '%';
                    });
                    window.addEventListener('pagehide', () => {
                        if (this.currentPage === 'reader') this.saveCurrentReadingPosition();
                        if (this.currentPage === 'player') this._savePlayerPosition();
                        this._abortListeningGeneration();
                    });
                    document.addEventListener('visibilitychange', () => {
                        if (document.visibilityState === 'hidden') {
                            if (this.currentPage === 'reader') this.saveCurrentReadingPosition();
                            if (this.currentPage === 'player') this._savePlayerPosition();
                        }
                    });
                    document.querySelectorAll('.menu-item').forEach(item => {
                        item.addEventListener('click', (e) => {
                            e.preventDefault();
                            const page = item.dataset.page;
                            console.log(`菜单点击: ${page}`);
                            this.switchPage(page);
                            this.closeSidebar();
                        });
                    });
					document.getElementById('lookupModalAddNewWordBtn')?.addEventListener('click', () => this.addLookupWordToNewWords());
                    document.getElementById('menuBtn').addEventListener('click', () => this.openSidebar());
                    document.getElementById('closeSidebar').addEventListener('click', () => this.closeSidebar());
                    document.getElementById('overlay').addEventListener('click', () => this.closeSidebar());

                    document.getElementById('startLearning').addEventListener('click', () => this.switchPage('learn'));
                    document.getElementById('quickReview').addEventListener('click', () => this.switchPage('review'));
                    document.getElementById('addWords').addEventListener('click', () => this.switchPage('novel'));

                    document.getElementById('knowBtn').addEventListener('click', () => this.handleAnswer('good'));
                    document.getElementById('notKnowBtn').addEventListener('click', () => this.handleAnswer('again'));
                    document.getElementById('hardBtn')?.addEventListener('click', () => this.handleAnswer('hard'));
                    document.getElementById('easyBtn')?.addEventListener('click', () => this.handleAnswer('easy'));
                    document.getElementById('speakBtn').addEventListener('click', () => this.speakCurrentWord());
                    document.getElementById('addToNewWords').addEventListener('click', () => this.toggleNewWord());
                    document.getElementById('showDetails').addEventListener('click', () => this.toggleDetails());

                    this.bindFileUploadEvents();

                    document.getElementById('processBtn').addEventListener('click', () => this.processNovelFile());
                    document.getElementById('saveWordsBtn').addEventListener('click', () => this.saveWordsFromNovel());

                    const searchInput = document.getElementById('wordSearch');
                    if (searchInput) {
                        searchInput.addEventListener('input', () => {
                            clearTimeout(this.searchDebounceTimer);
                            this.searchDebounceTimer = setTimeout(() => this.loadWordsList(), 300);
                        });
                    }
                    document.getElementById('difficultyFilter')?.addEventListener('change', () => this.loadWordsList());

                    document.getElementById('studyNewWords')?.addEventListener('click', () => this.studyNewWords());
                    document.getElementById('clearNewWords')?.addEventListener('click', () => this.clearNewWords());

                    document.getElementById('savePlanBtn')?.addEventListener('click', () => this.saveDailyPlan());

                    document.getElementById('statsBtn')?.addEventListener('click', () => this.showStats());
                    // 统计页：时间范围切换 / 导出 / 易忘词跳转
                    document.getElementById('statsRange')?.addEventListener('click', (e) => {
                        const btn = e.target.closest('.stats-range-btn');
                        if (!btn) return;
                        const range = parseInt(btn.dataset.range, 10);
                        if (!Number.isFinite(range)) return;
                        this._statsRange = range;
                        document.querySelectorAll('#statsRange .stats-range-btn').forEach(item => {
                            item.classList.toggle('active', item === btn);
                        });
                        this.loadStatsPage();
                    });
                    document.getElementById('statsExportBtn')?.addEventListener('click', () => this.exportStatsCsv());
                    document.getElementById('statsHardWords')?.addEventListener('click', (e) => {
                        const item = e.target.closest('.hard-word-text');
                        if (!item) return;
                        const wordId = parseInt(item.dataset.wordid, 10);
                        const word = item.dataset.word || '';
                        const open = async () => {
                            if (word) { this.openWordLookup(word); return; }
                            if (!Number.isNaN(wordId)) {
                                const w = await this.db.getWordById(wordId);
                                if (w && w.word) this.openWordLookup(w.word);
                            }
                        };
                        open().catch(err => console.warn('打开词条失败:', err));
                    });
                    document.getElementById('statsBackBtn')?.addEventListener('click', () => this.switchPage('home'));

                    document.getElementById('startReviewSession')?.addEventListener('click', () => this.startReviewSession());

                    document.addEventListener('keydown', (e) => this.handleKeyboard(e));

                    const minFreqSlider = document.getElementById('minFrequency');
                    if (minFreqSlider) {
                        minFreqSlider.addEventListener('input', function() {
                            const valueDisplay = document.getElementById('minFreqValue');
                            if (valueDisplay) {
                                valueDisplay.textContent = this.value;
                            }
                        });
                    }

                    // 查词弹窗：主单词点击 + 全局单词委托 + 弹窗按钮
                    const currentWordEl = document.getElementById('currentWord');
                    if (currentWordEl) {
                        currentWordEl.addEventListener('click', () => {
                            const w = this.learningWords[this.currentWordIndex]?.word;
                            if (w) this.openWordLookup(w);
                        });
                    }
                    // 全局委托：任何 .clickable-word（释义/例句/词典详情/韦氏/词库列表/生词本/复习列表/最近活动）点击均打开查词弹窗
                    document.addEventListener('click', (e) => {
                        const target = e.target.closest && e.target.closest('.clickable-word');
                        if (target && target.dataset.word) {
                            this.openWordLookup(target.dataset.word);
                        }
                    });
                    // 韦氏发音按钮（事件委托，避免内联 onclick 拼接 URL/单词）
                    document.addEventListener('click', (e) => {
                        const btn = e.target.closest && e.target.closest('.mw-audio-btn');
                        if (!btn) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const url = btn.dataset.audio || '';
                        const word = btn.dataset.word || '';
                        if (url) this.playAudio(url, word);
                        else this.speakWord(word);
                    });
                    // 例句朗读按钮（事件委托，避免内联 onclick 处理含引号的例句）
                    document.addEventListener('click', (e) => {
                        const btn = e.target.closest && e.target.closest('.example-play');
                        if (!btn) return;
                        e.preventDefault();
                        e.stopPropagation();
                        this.speakSentence(btn.dataset.sentence || '', btn);
                    });
                    document.getElementById('lookupModalClose')?.addEventListener('click', () => this.closeWordLookup());
                    document.getElementById('wordLookupModal')?.addEventListener('click', (e) => {
                        if (e.target.id === 'wordLookupModal') this.closeWordLookup();
                    });
                    document.getElementById('lookupModalAddBtn')?.addEventListener('click', () => this.addLookupWordToDB());
                    document.getElementById('lookupModalSpeakBtn')?.addEventListener('click', () => {
                        if (this.lookupModalWord) this.speakWord(this.lookupModalWord, this.lookupModalAudioUrl);
                    });
                    document.getElementById('lookupModalEcdictBtn')?.addEventListener('click', () => this.lookupModalEcdict());
                    document.getElementById('lookupModalMwBtn')?.addEventListener('click', () => this.lookupModalMw());
                    document.getElementById('lookupModalAiBtn')?.addEventListener('click', () => this.lookupModalAi());
                    document.getElementById('lookupModalMwCacheBtn')?.addEventListener('click', () => this.lookupModalMwCache());
                    document.getElementById('lookupModalAiCacheBtn')?.addEventListener('click', () => this.lookupModalAiCache());
                    // 弹窗内单词标题也可点击发音
                    document.getElementById('lookupModalWord')?.addEventListener('click', () => {
                        if (this.lookupModalWord) this.speakWord(this.lookupModalWord, this.lookupModalAudioUrl);
                    });

                    // 学习模式切换 + 拼写提交
                    document.querySelectorAll('.mode-btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            this.setLearningMode(btn.dataset.mode);
                        });
                    });
                    document.getElementById('spellingSubmit')?.addEventListener('click', () => this.submitSpelling());
                    document.getElementById('spellingGiveUp')?.addEventListener('click', () => this.giveUpSpelling());
					// 在 bindEvents 方法的末尾或合适位置添加
					document.getElementById('homeSearchBtn')?.addEventListener('click', () => {
						const input = document.getElementById('homeSearchInput');
						const word = input.value.trim();
						if (word) {
							this.openWordLookup(word);
							input.value = ''; // 清空输入框（可选）
						} else {
							this.showNotification('请输入要查询的单词', 'warning');
						}
					});

					document.getElementById('homeSearchInput')?.addEventListener('keydown', (e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							document.getElementById('homeSearchBtn')?.click();
						}
					});

					document.getElementById('logoutBtn')?.addEventListener('click', () => {
						if (confirm('确定退出当前词库？')) {
							this.db.saveSetting('currentListId', null).then(() => {
								this.db.saveSetting('defaultListId', null);
								this.switchPage('home');
								this.showNotification('已退出词库选择', 'info');
							});
						}
					});

                    const spellingInput = document.getElementById('spellingInput');
                    if (spellingInput) {
                        spellingInput.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                this.submitSpelling();
                            }
                        });
                    }

                    // 阅读模块事件
                    document.getElementById('readingUploadBtn')?.addEventListener('click', () => {
                        this.switchPage('novel');
                        this.showNotification('请上传文件后选择「阅读模式」', 'info');
                    });

                    // 听力模块事件
                    document.getElementById('listeningUploadBtn')?.addEventListener('click', () => {
                        this.switchPage('novel');
                        this.showNotification('请上传文件后选择「听力模式」', 'info');
                    });

                    // 上传页模式切换
                    document.querySelectorAll('[data-upload-mode]').forEach(btn => {
                        btn.addEventListener('click', () => {
                            document.querySelectorAll('[data-upload-mode]').forEach(b => b.classList.remove('active'));
                            btn.classList.add('active');
                            const mode = btn.dataset.uploadMode;
                            const isReading = mode === 'reading';
                            const isListening = mode === 'listening';
                            document.getElementById('wordModeOptions').style.display = isReading || isListening ? 'none' : 'block';
                            document.getElementById('processBtn').style.display = isReading || isListening ? 'none' : '';
                            document.getElementById('readingSaveContainer').style.display = isReading ? 'block' : 'none';
                            document.getElementById('listeningGenContainer').style.display = isListening ? 'block' : 'none';
                            this.uploadMode = mode;
                        });
                    });

                    document.getElementById('readingSaveBtn')?.addEventListener('click', () => this.saveAsReading());
                    document.getElementById('listeningGenBtn')?.addEventListener('click', () => this.generateListeningAudio());

                    const listeningStyleSel = document.getElementById('listeningStyle');
                    const listeningCustomItem = document.getElementById('listeningStyleCustomItem');
                    if (listeningStyleSel && listeningCustomItem) {
                        listeningStyleSel.addEventListener('change', () => {
                            listeningCustomItem.style.display = listeningStyleSel.value === 'custom' ? '' : 'none';
                        });
                    }

                    console.log('事件绑定完成');
                }

                bindFileUploadEvents() {
                    const uploadArea = document.getElementById('uploadArea');
                    const fileInput = document.getElementById('novelFile');
                    const selectBtn = document.getElementById('selectFileBtn');

                    if (selectBtn) {
                        selectBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            fileInput?.click();
                        });
                    }

                    if (uploadArea) {
                        uploadArea.addEventListener('click', () => fileInput?.click());
                        uploadArea.addEventListener('dragover', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            uploadArea.classList.add('dragover');
                        });
                        uploadArea.addEventListener('dragleave', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            uploadArea.classList.remove('dragover');
                        });
                        uploadArea.addEventListener('drop', async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            uploadArea.classList.remove('dragover');
                            const file = e.dataTransfer.files[0];
                            if (file && (file.name.endsWith('.txt') || file.name.endsWith('.md') || file.name.endsWith('.html') || file.name.endsWith('.htm') || file.type === 'text/plain')) {
                                await this.handleFileUpload(file);
                            } else {
                                this.showNotification('请上传 txt / md / html 格式的文件', 'error');
                            }
                        });
                        uploadArea.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                fileInput?.click();
                            }
                        });
                    }

                    if (fileInput) {
                        fileInput.addEventListener('change', async (e) => {
                            const file = e.target.files[0];
                            if (file) {
                                await this.handleFileUpload(file);
                            }
                        });
                    }
                }

                handleKeyboard(e) {
                    // 输入框/文本域中不触发全局快捷键
                    const tag = e.target && e.target.tagName;
                    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
                    if (e.key === 'Escape') {
                        if (this.currentPage === 'reader') {
                            this.switchPage('reading');
                        } else {
                            this.closeSidebar();
                        }
                        return;
                    }
                    if (this.currentPage === 'reader') {
                        if (e.key === '=' || e.key === '+') {
                            e.preventDefault();
                            this.changeReaderFontSize(2);
                        } else if (e.key === '-') {
                            e.preventDefault();
                            this.changeReaderFontSize(-2);
                        }
                    }
                    if (this.currentPage === 'learn' && this.learningWords.length > 0) {
                        if (e.key === '1' || e.key === 'ArrowLeft') {
                            e.preventDefault();
                            this.handleAnswer('again');
                        } else if (e.key === '2' || e.key === 'ArrowRight') {
                            e.preventDefault();
                            this.handleAnswer('good');
                        } else if (e.key === '3') {
                            e.preventDefault();
                            this.handleAnswer('hard');
                        } else if (e.key === '4') {
                            e.preventDefault();
                            this.handleAnswer('easy');
                        } else if (e.key === ' ') {
                            e.preventDefault();
                            this.speakCurrentWord();
                        } else if (e.key === 'd' || e.key === 'D') {
                            this.toggleDetails();
                        }
                    }
                }

                // ===== 学习模式（认词 / 拼写）=====
                syncModeToggleUI() {
                    document.querySelectorAll('.mode-btn').forEach(btn => {
                        if (btn.dataset.mode === this.learningMode) {
                            btn.classList.add('active');
                        } else {
                            btn.classList.remove('active');
                        }
                    });
                }

                async setLearningMode(mode) {
                    if (mode !== 'recognition' && mode !== 'spelling') return;
                    if (mode === this.learningMode) return;
                    this.learningMode = mode;
                    await this.db.saveSetting('learningMode', mode);
                    this.syncModeToggleUI();
                    // 重新渲染当前单词以应用新模式
                    if (this.currentPage === 'learn' && this.learningWords.length > 0) {
                        await this.displayCurrentWord();
                    }
                }

                submitSpelling() {
                    if (this.spellingLocked) return;
                    const wordData = this.learningWords[this.currentWordIndex];
                    if (!wordData) return;
                    const inputEl = document.getElementById('spellingInput');
                    const feedbackEl = document.getElementById('spellingFeedback');
                    const currentWordEl = document.getElementById('currentWord');
                    if (!inputEl || !feedbackEl) return;
                    const input = inputEl.value.toLowerCase().trim();
                    const target = (wordData.word || '').toLowerCase().trim();
                    if (!input) {
                        feedbackEl.className = 'spelling-feedback wrong';
                        feedbackEl.textContent = '请输入拼写';
                        inputEl.focus();
                        return;
                    }
                    this.spellingLocked = true;
                    inputEl.disabled = true;
                    const correct = input === target;
                    if (correct) {
                        feedbackEl.className = 'spelling-feedback correct';
                        feedbackEl.textContent = '✓ 正确！';
                        if (currentWordEl) {
                            currentWordEl.style.display = '';
                            currentWordEl.textContent = wordData.word;
                        }
                        setTimeout(() => {
                            this.handleAnswer(true);
                        }, 1000);
                    } else {
                        feedbackEl.className = 'spelling-feedback wrong';
                        feedbackEl.innerHTML = this.getLetterFeedback(input, target, false);
                        setTimeout(() => {
                            if (inputEl) { inputEl.value = ''; inputEl.disabled = false; }
                            if (feedbackEl) { feedbackEl.className = 'spelling-feedback'; feedbackEl.textContent = ''; }
                            this.spellingLocked = false;
                            if (inputEl) inputEl.focus();
                        }, 1000);
                    }
                }

                getLetterFeedback(input, target, showAnswer = true) {
                    const maxLen = Math.max(input.length, target.length);
                    const result = target.split('').map((ch, i) => {
                        if (i >= input.length) {
                            return `<span class="letter-missing">${ch}</span>`;
                        }
                        if (input[i] === ch) {
                            return `<span class="letter-correct">${input[i]}</span>`;
                        }
                        if (target.includes(input[i])) {
                            return `<span class="letter-wrong-position">${input[i]}</span>`;
                        }
                        return `<span class="letter-wrong">${input[i]}</span>`;
                    });
                    // 额外输入
                    if (input.length > target.length) {
                        for (let i = target.length; i < input.length; i++) {
                            result.push(`<span class="letter-extra">${input[i]}</span>`);
                        }
                    }
                    let feedback = '✗ ' + result.join('');
                    if (showAnswer) {
                        feedback += `<br><small style="color:var(--gray-color);">正确答案：${target}</small>`;
                    }
                    return feedback;
                }

                giveUpSpelling() {
                    if (this.spellingLocked) return;
                    const wordData = this.learningWords[this.currentWordIndex];
                    if (!wordData) return;
                    const inputEl = document.getElementById('spellingInput');
                    const feedbackEl = document.getElementById('spellingFeedback');
                    const currentWordEl = document.getElementById('currentWord');
                    this.spellingLocked = true;
                    if (inputEl) inputEl.disabled = true;
                    if (feedbackEl) {
                        feedbackEl.className = 'spelling-feedback wrong';
                        feedbackEl.textContent = `正确答案：${wordData.word}`;
                    }
                    if (currentWordEl) {
                        currentWordEl.style.display = '';
                        currentWordEl.textContent = wordData.word;
                    }
                    setTimeout(() => {
                        this.handleAnswer(false);
                    }, 1200);
                }

                async loadInitialData() {
                    try {
                        console.log('加载初始数据...');
                        await this.updateTodayProgress();
                        const plan = await this.db.getDailyPlan();
                        console.log('加载学习计划:', plan);
                        const dailyGoalInput = document.getElementById('dailyGoal');
                        const reviewGoalInput = document.getElementById('reviewGoal');
                        const studyTimeSelect = document.getElementById('studyTime');
                        const notificationCheckbox = document.getElementById('notification');
                        if (dailyGoalInput) dailyGoalInput.value = plan.dailyGoal;
                        if (reviewGoalInput) reviewGoalInput.value = plan.reviewGoal;
                        if (studyTimeSelect) studyTimeSelect.value = plan.studyTime;
                        if (notificationCheckbox) notificationCheckbox.checked = plan.notifications;
                        await this.loadRecentActivity();
                        this.updatePlanStats();
                        console.log('初始数据加载完成');
                    } catch (error) {
                        console.error('加载初始数据失败:', error);
                    }
                }

                async updateTodayProgress() {
                    try {
                        const todayHistory = await this.db.getTodayHistory();
                        const plan = await this.db.getDailyPlan();
                        const todayLearned = todayHistory.length;
                        const dailyGoal = plan.dailyGoal;
                        const progress = Math.min((todayLearned / dailyGoal) * 100, 100);
                        const progressCircle = document.getElementById('todayCircle');
                        if (progressCircle) {
                            const circumference = 2 * Math.PI * 15.9155;
                            const offset = circumference - (progress / 100) * circumference;
                            progressCircle.style.strokeDasharray = `${circumference - offset} ${offset}`;
                        }
                        const todayCount = document.getElementById('todayCount');
                        const totalGoal = document.getElementById('totalGoal');
                        const todayProgress = document.getElementById('todayProgress');
                        if (todayCount) todayCount.textContent = todayLearned;
                        if (totalGoal) totalGoal.textContent = dailyGoal;
                        if (todayProgress) todayProgress.textContent = `${todayLearned}/${dailyGoal}`;
                        const progressBar = document.getElementById('todayProgressBar');
                        if (progressBar) {
                            progressBar.style.width = `${progress}%`;
                        }
                        const streak = await this.db.getSetting('learningStreak') || '0';
                        const streakDays = document.getElementById('streakDays');
                        if (streakDays) streakDays.textContent = streak;
                        const allWords = await this.db.getAllWords();
                        const totalWords = document.getElementById('totalWords');
                        if (totalWords) totalWords.textContent = allWords.length;
                    } catch (error) {
                        console.error('更新今日进度失败:', error);
                    }
                }

                async loadRecentActivity() {
                    try {
                        const recentList = document.getElementById('recentList');
                        if (!recentList) return;
                        const todayHistory = await this.db.getTodayHistory();
                        if (todayHistory.length === 0) {
                            recentList.innerHTML = '<p class="empty-state">今天还没有学习记录，开始学习吧！</p>';
                            return;
                        }
                        const recentItems = todayHistory.slice(-10).reverse();
                        let html = '';
                        for (const item of recentItems) {
                            const word = await this.db.getWordById(item.wordId);
                            if (word) {
                                const time = new Date(item.date).toLocaleTimeString('zh-CN', {
                                    hour: '2-digit',
                                    minute: '2-digit'
                                });
                                html += `
                                    <div class="recent-item">
                                        <div>
                                            <span class="recent-word">${word.word}</span>
                                            <small style="color: var(--gray-color); margin-left: 8px;">${time}</small>
                                        </div>
                                        <span class="recent-result ${item.correct ? 'correct' : 'incorrect'}">
                                            ${item.correct ? '✓' : '✗'}
                                        </span>
                                    </div>
                                `;
                            }
                        }
                        recentList.innerHTML = html;
                        // 让首页最近活动里的单词可点击查词
                        this.makeClickable(recentList);
                    } catch (error) {
                        console.error('加载最近活动失败:', error);
                    }
                }

                switchPage(pageName) {
                    console.log(`切换到页面: ${pageName}`);
                    document.querySelectorAll('.page').forEach(page => {
                        page.classList.remove('active');
                    });
                    document.querySelectorAll('.menu-item').forEach(item => {
                        item.classList.remove('active');
                    });
                    const targetPage = document.getElementById(`${pageName}Page`);
                    if (targetPage) {
                        targetPage.classList.add('active');
                        const menuItem = document.querySelector(`[data-page="${pageName}"]`);
                        if (menuItem) {
                            menuItem.classList.add('active');
                        }
                        // 阅读器模式下无内边距
                        document.querySelector('.main-content')
                            .classList.toggle('reader-mode', pageName === 'reader');
                        // 离开阅读器时保存进度并停止朗读
                    if (this.currentPage === 'reader' && pageName !== 'reader') {
                        this.saveCurrentReadingPosition();
                        this.stopReaderTTS();
                    }
                    // 离开播放器时停止播放
                    if (this.currentPage === 'player' && pageName !== 'player') {
                        this.stopPlayer();
                    }
                    this.currentPage = pageName;
                        window.scrollTo(0, 0);
                        requestAnimationFrame(() => {
                            this.initializePage(pageName);
                        });
                    } else {
                        console.error(`页面 ${pageName}Page 不存在`);
                    }
                }

                async initializePage(pageName) {
                    console.log(`初始化页面: ${pageName}`);
                    try {
                        switch(pageName) {
                            case 'learn':
                                await this.startLearningSession();
                                break;
                            case 'words':
                                await this.loadWordsList();
                                break;
                            case 'new-words':
                                await this.loadNewWordsList();
                                break;
                            case 'review':
                                await this.loadReviewPage();
                                break;
                            case 'settings':
                                await this.loadSettingsPage();
                                break;
                            case 'plan':
                                await this.loadPlanPage();
                                break;
                            case 'stats':
                                await this.loadStatsPage();
                                break;
                            case 'reading':
                                await this.loadReadingList();
                                break;
                            case 'reader':
                                await this.loadReader();
                                break;
                            case 'novel':
                                await this.populateVocabFilterSelect();
                                break;
                            case 'listening':
                                await this.loadListeningList();
                                break;
                            case 'player':
                                await this.loadPlayer();
                                break;
                            case 'home':
                                await this.updateTodayProgress();
                                await this.loadRecentActivity();
                                break;
                        }
                    } catch (error) {
                        console.error(`初始化页面 ${pageName} 失败:`, error);
                        this.showNotification(`加载页面失败，请重试`, 'error');
                    }
                }

                openSidebar() {
                    const sidebar = document.getElementById('sidebar');
                    const overlay = document.getElementById('overlay');
                    if (sidebar) sidebar.style.left = '0';
                    if (overlay) overlay.classList.add('active');
                    document.body.style.overflow = 'hidden';
                }

                closeSidebar() {
                    const sidebar = document.getElementById('sidebar');
                    const overlay = document.getElementById('overlay');
                    if (sidebar) sidebar.style.left = '-300px';
                    if (overlay) overlay.classList.remove('active');
                    document.body.style.overflow = '';
                }

                async startLearningSession() {
                    try {
                        this.showLoader('正在准备学习内容...');
                        this._pendingLearning = [];
                        this.clearPendingTimer();
                        this.renderPendingLearning();
                        if (this.isStudyingPreparedSession) {
                            console.log('继续已准备的学习会话，跳过默认加载');
                            this.isStudyingPreparedSession = false;
                            this.showingDetails = false;
                            const learnedCount = document.getElementById('learnedCount');
                            const totalToLearn = document.getElementById('totalToLearn');
                            if (learnedCount) learnedCount.textContent = '1';
                            if (totalToLearn) totalToLearn.textContent = this.learningWords.length;
                            await this.displayCurrentWord();
                            this.hideLoader();
                            return;
                        }
                        this.learningWords = await this.db.getTodayWords();
                        this.currentWordIndex = 0;
                        this.showingDetails = false;
                        console.log(`开始学习会话，共 ${this.learningWords.length} 个单词`);
                        if (this.learningWords.length === 0) {
                            this.hideLoader();
                            this.showNotification('今天的学习任务已完成！或当前单词库为空，请先上传小说', 'warning');
                            setTimeout(() => this.switchPage('home'), 1500);
                            return;
                        }
                        const learnedCount = document.getElementById('learnedCount');
                        const totalToLearn = document.getElementById('totalToLearn');
                        if (learnedCount) learnedCount.textContent = '1';
                        if (totalToLearn) totalToLearn.textContent = this.learningWords.length;
                        await this.displayCurrentWord();
                        this.hideLoader();
                    } catch (error) {
                        console.error('开始学习会话失败:', error);
                        this.hideLoader();
                        this.showNotification('加载学习内容失败，请重试', 'error');
                    }
                }

                async displayCurrentWord() {
                    if (this.currentWordIndex >= this.learningWords.length) {
                        await this.completeLearningSession();
                        return;
                    }
                    const wordData = this.learningWords[this.currentWordIndex];
                    console.log(`显示单词: ${wordData.word} (${this.currentWordIndex + 1}/${this.learningWords.length})`);
                    if (!wordData.id) {
                        console.error('单词数据缺少ID:', wordData);
                    }
                    this.showLoader('加载单词数据中...');
                    try {
                        let freshData;
                        if (this.networkAvailable || navigator.onLine) {
                            freshData = await this.dictionaryAPI.fetchWordData(wordData.word);
                        } else {
                            freshData = {
                                word: wordData.word,
                                phonetic: wordData.phonetic || '/ˈwɜːd/',
                                meaning: wordData.meaning || '暂无释义（离线模式）',
                                example: wordData.example || '暂无例句',
                                allMeanings: [],
                                audioUrl: ''
                            };
                        }
                        const currentWord = document.getElementById('currentWord');
                        const wordPhonetic = document.getElementById('wordPhonetic');
                        const wordMeaning = document.getElementById('wordMeaning');
                        const wordExample = document.getElementById('wordExample');
                        if (currentWord) currentWord.textContent = freshData.word;
                        if (wordPhonetic) wordPhonetic.textContent = freshData.phonetic;
                        if (wordMeaning) wordMeaning.textContent = freshData.meaning;
                        if (wordExample) wordExample.textContent = freshData.example || '暂无例句';
                        this.updateCardExampleButton(freshData.example);
                        this.updateDictionaryDetails(freshData);
                        this.currentAudioUrl = freshData.audioUrl;
                        const autoPlay = await this.db.getSetting('autoPlaySound');
                        if (autoPlay && freshData.audioUrl) {
                            setTimeout(() => this.speakCurrentWord(), 500);
                        }
                    } catch (error) {
                        console.error('加载单词数据失败:', error);
                        const currentWord = document.getElementById('currentWord');
                        const wordPhonetic = document.getElementById('wordPhonetic');
                        const wordMeaning = document.getElementById('wordMeaning');
                        const wordExample = document.getElementById('wordExample');
                        if (currentWord) currentWord.textContent = wordData.word;
                        if (wordPhonetic) wordPhonetic.textContent = wordData.phonetic || '/ˈwɜːd/';
                        if (wordMeaning) wordMeaning.textContent = wordData.meaning || '暂无释义';
                        if (wordExample) wordExample.textContent = wordData.example || '暂无例句';
                        this.updateCardExampleButton(wordData.example);
                    }
                    const difficultyBadge = document.getElementById('difficultyBadge');
                    if (difficultyBadge) {
                        difficultyBadge.textContent = this.getDifficultyText(wordData.difficulty);
                        difficultyBadge.dataset.level = wordData.difficulty;
                    }
                    const learnedCount = document.getElementById('learnedCount');
                    if (learnedCount) {
                        learnedCount.textContent = this.currentWordIndex + 1;
                    }
                    const sessionProgress = document.getElementById('sessionProgress');
                    if (sessionProgress && this.learningWords.length > 0) {
                        const pct = ((this.currentWordIndex + 1) / this.learningWords.length) * 100;
                        sessionProgress.style.width = `${pct}%`;
                    }
                    await this.updateNewWordButton(wordData.id);
                    const detailsSection = document.getElementById('wordDetails');
                    const showDetailsBtn = document.getElementById('showDetails');
                    if (detailsSection) {
                        const showPhonetic = await this.db.getSetting('showPhonetic');
                        if (showPhonetic !== false) {
                            detailsSection.style.display = this.showingDetails ? 'block' : 'none';
                        } else {
                            detailsSection.style.display = 'none';
                        }
                    }
                    if (showDetailsBtn) {
                        showDetailsBtn.innerHTML = this.showingDetails 
                            ? '<i class="fas fa-eye-slash"></i> 隐藏信息'
                            : '<i class="fas fa-info-circle"></i> 详细信息';
                    }
                    const mwResult = document.getElementById('mwResult');
                    if (mwResult) {
                        mwResult.style.display = 'none';
                        mwResult.innerHTML = '';
                    }
                    // 让释义/例句/词典详情里的所有英文单词可点击查词
                    this.makeClickable(document.getElementById('wordDetails'));
                    this.applyLearningModeLayout();
                    // 记忆状态（FSRS）信息展示
                    this.renderSrsInfo(wordData.id);
                    // 上下文展示（来自小说原文）
                    const contextEl = document.getElementById('wordContext');
                    if (contextEl && wordData.context) {
                        contextEl.textContent = wordData.context;
                        contextEl.style.display = 'block';
                    } else if (contextEl) {
                        contextEl.style.display = 'none';
                    }
                    this.hideLoader();
                }

                // 学习卡片例句的朗读按钮
                updateCardExampleButton(example) {
                    const btn = document.getElementById('cardExamplePlay');
                    if (!btn) return;
                    const sentence = this.sanitizeSentence(example);
                    if (!sentence || sentence === '暂无例句') {
                        btn.style.display = 'none';
                        btn.dataset.sentence = '';
                        return;
                    }
                    btn.dataset.sentence = sentence;
                    btn.style.display = '';
                }

                // 根据当前学习模式（认词/拼写）调整卡片可见性
                applyLearningModeLayout() {
                    const wordCard = document.getElementById('wordCard');
                    if (!wordCard) return;
                    const currentWordEl = document.getElementById('currentWord');
                    const spellingSection = document.getElementById('spellingSection');
                    const recognitionActions = document.getElementById('recognitionActions');
                    const detailsSection = document.getElementById('wordDetails');
                    const showDetailsBtn = document.getElementById('showDetails');
                    const exampleSection = wordCard.querySelector('.example-section');
                    const collinsSection = wordCard.querySelector('.collins-section');

                    if (this.learningMode === 'spelling') {
                        if (currentWordEl) currentWordEl.style.display = 'none';          // 隐藏单词（不泄露答案）
                        if (spellingSection) spellingSection.style.display = 'block';     // 显示拼写区
                        if (recognitionActions) recognitionActions.style.display = 'none';// 隐藏认词/不认识按钮
                        if (detailsSection) detailsSection.style.display = 'block';       // 露出释义作为提示
                        if (exampleSection) exampleSection.style.display = 'none';        // 例句含目标词，隐藏
                        if (collinsSection) collinsSection.style.display = 'none';        // 词典区无需展示
                        if (showDetailsBtn) showDetailsBtn.style.display = 'none';        // 拼写模式下禁用详情切换
                        // 重置拼写输入
                        const inputEl = document.getElementById('spellingInput');
                        const feedbackEl = document.getElementById('spellingFeedback');
                        if (inputEl) { inputEl.value = ''; inputEl.disabled = false; }
                        if (feedbackEl) { feedbackEl.className = 'spelling-feedback'; feedbackEl.textContent = ''; }
                        this.spellingLocked = false;
                        setTimeout(() => { if (inputEl) inputEl.focus(); }, 100);
                    } else {
                        if (currentWordEl) currentWordEl.style.display = '';              // 恢复单词
                        if (spellingSection) spellingSection.style.display = 'none';      // 隐藏拼写区
                        if (recognitionActions) recognitionActions.style.display = '';    // 恢复认词按钮
                        if (exampleSection) exampleSection.style.display = '';
                        if (collinsSection) collinsSection.style.display = '';
                        if (showDetailsBtn) showDetailsBtn.style.display = '';
                        const clozeEl = document.getElementById('spellingClozeHint');
                        if (clozeEl) clozeEl.style.display = 'none';
                        // details 可见性由上方 showingDetails/showPhonetic 逻辑控制，不在此处覆盖
                    }
                }

                async renderSrsInfo(wordId) {
                    const el = document.getElementById('sm2Info');
                    if (!el) return;
                    try {
                        const progress = await this.db.getProgress(wordId);
                        const word = await this.db.getWordById(wordId);
                        if (!word) { el.style.display = 'none'; return; }
                        if (!progress) { el.style.display = 'none'; return; }
                        const daysSinceReview = progress.lastReview
                            ? Math.ceil((new Date() - new Date(progress.lastReview)) / (1000 * 60 * 60 * 24))
                            : '-';
                        const nextMs = progress.nextReview ? new Date(progress.nextReview) - new Date() : null;
                        const nextReviewText = nextMs === null
                            ? '-'
                            : nextMs < 86400000 ? '今天' : Math.round(nextMs / 86400000) + '天后';
                        const retrievability = await this.db.getCardRetrievability(progress);
                        const reps = progress.reps != null ? progress.reps : (progress.repetition || 0);
                        const scheduledDays = progress.scheduled_days != null
                            ? progress.scheduled_days
                            : (progress.interval || 0);
                        el.innerHTML = `
                            <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;">
                                <span title="熟悉度">📊 ${'★'.repeat(progress.familiarity || 0)}${'☆'.repeat(5 - (progress.familiarity || 0))}</span>
                                <span title="复习次数">🔄 ${reps}次</span>
                                <span title="间隔天数">📅 ${scheduledDays}天</span>
                                <span title="记忆稳定性（天）">🧠 ${progress.stability != null ? progress.stability.toFixed(1) + '天' : '-'}</span>
                                <span title="难度（1-10）">⚡ ${progress.difficulty != null ? progress.difficulty.toFixed(1) : '-'}</span>
                                <span title="当前记忆保持率">💧 ${retrievability != null ? Math.round(retrievability * 100) + '%' : '-'}</span>
                                <span title="上次复习">📝 ${daysSinceReview === '-' ? '-' : daysSinceReview + '天前'}</span>
                                <span title="下次复习">⏰ ${nextReviewText}</span>
                                <span title="错误次数">❌ ${word.errorCount || 0}次</span>
                                <span title="总复习次数">📖 ${progress.totalReviews || 0}次</span>
                                ${progress.isLeech ? '<span class="leech-badge" title="遗忘次数过多，已自动加入生词本">⚠️ 易忘词</span>' : ''}
                            </div>
                        `;
                        el.style.display = 'block';
                    } catch (e) {
                        console.warn('记忆状态信息加载失败:', e);
                        el.style.display = 'none';
                    }
                }

                updateDictionaryDetails(wordData) {
                    this.renderDictDetails(wordData, document.getElementById('collinsContent'));
                }

                // 参数化版本：可向任意容器渲染 free dict 详细释义，供学习卡片与查词弹窗复用
				// ===== 修改：Free Dict 渲染 =====
				renderDictDetails(wordData, containerEl) {
					if (!containerEl) return;
					const esc = (s) => this.escapeHtml(s == null ? '' : String(s));
					if (wordData.allMeanings && wordData.allMeanings.length > 0) {
						const total = wordData.allMeanings.length;
						const showAll = total <= 3;
						const visibleCount = showAll ? total : 3;
						let html = '<div class="dictionary-details">';
						wordData.allMeanings.slice(0, visibleCount).forEach((meaning) => {
							html += `<div class="meaning-item" style="margin-bottom: 15px;">`;
							if (meaning.partOfSpeech) html += `<div class="part-of-speech">${esc(meaning.partOfSpeech)}</div>`;
							if (meaning.definition) html += `<div class="definition">${esc(meaning.definition)}</div>`;
							if (meaning.example) html += `<div class="example"><em>例句:</em> ${esc(meaning.example)}${this.examplePlayButton(meaning.example)}</div>`;
							if (meaning.synonyms && meaning.synonyms.length > 0) {
								html += `<div style="margin-top: 6px; font-size: 0.9rem;">`;
								html += `<span style="color: var(--gray-color); font-weight: 500;">同义词：</span>`;
								meaning.synonyms.forEach(syn => {
									html += `<span class="clickable-word" style="color: var(--secondary-color); cursor: pointer; margin-right: 4px; margin-left: 4px; text-decoration: underline;" data-word="${this.escapeAttr(syn)}">${esc(syn)}</span>`;
								});
								html += `</div>`;
							}
							if (meaning.antonyms && meaning.antonyms.length > 0) {
								html += `<div style="margin-top: 4px; font-size: 0.9rem;">`;
								html += `<span style="color: var(--gray-color); font-weight: 500;">反义词：</span>`;
								meaning.antonyms.forEach(ant => {
									html += `<span class="clickable-word" style="color: var(--danger-color); cursor: pointer; margin-right: 4px; margin-left: 4px; text-decoration: underline;" data-word="${this.escapeAttr(ant)}">${esc(ant)}</span>`;
								});
								html += `</div>`;
							}
							html += `</div>`;
						});
						if (!showAll) {
							const remaining = total - 3;
							html += `<div style="text-align:center;margin-top:8px;">
								<button class="action-btn small expand-meanings-btn" data-meaning-count="${remaining}">
									展开全部${remaining}个释义 ↓
								</button>
							</div>`;
						}
						html += '</div>';
						const sourceMeta = {
							'freedictionaryapi.com': { label: 'FreeDictionaryAPI.com', url: 'https://freedictionaryapi.com' },
							'dictionaryapi.dev': { label: 'Free Dictionary API', url: 'https://dictionaryapi.dev' },
							'wiktionary': { label: 'Wiktionary', url: 'https://en.wiktionary.org' },
							'datamuse': { label: 'Datamuse', url: 'https://www.datamuse.com/api/' },
							'ecdict': { label: 'ECDICT', url: 'https://github.com/skywind3000/ECDICT' }
						};
						const sourceInfo = sourceMeta[wordData.source];
						if (sourceInfo) {
							const href = wordData.sourceUrl || sourceInfo.url;
							const safeHref = esc(href).replace(/"/g, '&quot;');
							html += `<div class="dict-source" style="margin-top:10px;font-size:0.8rem;color:var(--gray-color);">来源：<a href="${safeHref}" target="_blank" rel="noopener">${esc(sourceInfo.label)}</a>${wordData.cached ? ' · 本地缓存' : ''}</div>`;
						}
						containerEl.innerHTML = html;
						const expandBtn = containerEl.querySelector('.expand-meanings-btn');
						if (expandBtn) {
							// 释义数据放在 WeakMap 里，不塞进 HTML 属性：
							// 例句里的撇号（don't）等字符会截断单引号包裹的属性，导致点击时 JSON 解析失败、按钮毫无反应。
							this._expandMeanings = this._expandMeanings || new WeakMap();
							this._expandMeanings.set(expandBtn, (wordData.allMeanings || []).slice(3));
							expandBtn.addEventListener('click', () => {
								try {
									const meanings = this._expandMeanings.get(expandBtn);
									if (!Array.isArray(meanings) || meanings.length === 0) return;
									let allHtml = '';
									meanings.forEach(m => {
										allHtml += '<div class="meaning-item" style="margin-bottom: 15px;">';
										if (m.partOfSpeech) allHtml += '<div class="part-of-speech">' + this.escapeHtml(m.partOfSpeech) + '</div>';
										if (m.definition) allHtml += '<div class="definition">' + this.escapeHtml(m.definition) + '</div>';
										if (m.example) allHtml += '<div class="example"><em>例句:</em> ' + this.escapeHtml(m.example) + this.examplePlayButton(m.example) + '</div>';
										allHtml += '</div>';
									});
									const details = expandBtn.closest('.dictionary-details');
									if (details) details.insertAdjacentHTML('beforeend', allHtml);
									expandBtn.remove();
									// 新增释义里的单词同样可点击查词
									this.makeClickable(containerEl);
								} catch (error) {
									console.error('展开全部释义失败:', error);
									this.showNotification('展开释义失败，请重试', 'error');
								}
							});
						}
					} else { containerEl.innerHTML = '<p class="empty-state">暂无详细词典数据</p>'; }
					this.makeClickable(containerEl);
				}


                // 评分：'again' | 'hard' | 'good' | 'easy'（也兼容旧的 boolean）
                async handleAnswer(grade) {
                    if (this.isProcessing) return;
                    const wordData = this.learningWords[this.currentWordIndex];
                    if (!wordData) return;
                    this.isProcessing = true;
                    const rating = this.normalizeGrade(grade);
                    const isSuccess = rating !== 'again';
                    const gradeLabel = { again: '不认识', hard: '困难', good: '认识', easy: '简单' }[rating];
                    console.log(`处理答案: ${wordData.word} - ${gradeLabel}`);
                    try {
                        const progressData = await this.db.updateProgress(wordData.id, rating);
                        await this.db.addLearningHistory(wordData.id, isSuccess);
                        if (isSuccess) {
                            await this.db.updateStreak();
                        }
                        this.scheduleLearningCard(wordData, progressData);
                        this.playAnswerSound(isSuccess);
                        if (rating === 'easy') {
                            this.showNotification('⚡ 太简单了，延长了复习间隔', 'success');
                        } else if (rating === 'hard') {
                            this.showNotification('◔ 已记录：记得但不熟，间隔会短一些', 'info');
                        } else if (isSuccess) {
                            this.showNotification('✓ 很好！继续加油', 'success');
                        } else {
                            this.showNotification('✗ 别灰心，已加入生词本', 'warning');
                            await this.db.addToNewWords(wordData.id);
                            // 追踪错误次数
                            const word = await this.db.getWordById(wordData.id);
                            if (word) {
                                const errCount = (word.errorCount || 0) + 1;
                                await this.db.updateWord(wordData.id, { errorCount: errCount });
                            }
                        }
                        if (progressData && progressData.justBecameLeech) {
                            this.showNotification('⚠️ 该词已成为「易忘词」，已加入生词本', 'warning');
                        }
                        const autoNext = await this.db.getSetting('autoNextWord');
                        const delay = autoNext ? 800 : 0;
                        setTimeout(async () => {
                            try {
                                this.currentWordIndex++;
                                if (this.currentWordIndex < this.learningWords.length) {
                                    await this.displayCurrentWord();
                                } else {
                                    await this.completeLearningSession();
                                }
                                await this.updateTodayProgress();
                                await this.loadRecentActivity();
                            } catch (error) {
                                console.error('切换到下一个单词失败:', error);
                            } finally {
                                this.isProcessing = false;
                            }
                        }, delay);
                    } catch (error) {
                        console.error('处理答案失败:', error);
                        this.showNotification('处理失败，请重试', 'error');
                        this.isProcessing = false;
                    }
                }

                normalizeGrade(grade) {
                    if (grade === true) return 'good';
                    if (grade === false) return 'again';
                    if (typeof grade === 'number') {
                        if (grade <= 1) return 'again';
                        if (grade === 2) return 'hard';
                        if (grade === 3) return 'good';
                        if (grade >= 4) return 'easy';
                    }
                    if (typeof grade === 'string') {
                        const name = grade.trim().toLowerCase();
                        if (name === 'again' || name === 'forget' || name === '不认识') return 'again';
                        if (name === 'hard' || name === '困难') return 'hard';
                        if (name === 'easy' || name === '简单') return 'easy';
                        if (name === 'good' || name === '认识' || name === 'normal') return 'good';
                    }
                    return 'good';
                }

                // FSRS 学习/重学阶段的卡片按其到期时间回到队列：到期前不提前复习（尊重 learning steps）
                scheduleLearningCard(wordData, progressData) {
                    if (!progressData || !window.FSRS || !wordData) return;
                    const state = progressData.state;
                    if (state !== window.FSRS.State.Learning && state !== window.FSRS.State.Relearning) return;
                    const requeues = wordData._sessionRequeues || 0;
                    if (requeues >= 2) return;
                    const dueMs = progressData.nextReview ? new Date(progressData.nextReview).getTime() : 0;
                    if (!dueMs || !Number.isFinite(dueMs)) return;
                    wordData._sessionRequeues = requeues + 1;
                    const delay = dueMs - Date.now();
                    if (delay <= 0) {
                        this.learningWords.push(wordData);
                        this.updateSessionCounters();
                        return;
                    }
                    this._pendingLearning = this._pendingLearning || [];
                    this._pendingLearning.push({ wordData, due: dueMs });
                    this._pendingLearning.sort((a, b) => a.due - b.due);
                    this.renderPendingLearning();
                    this.ensurePendingTimer();
                }

                updateSessionCounters() {
                    const totalToLearn = document.getElementById('totalToLearn');
                    if (totalToLearn) totalToLearn.textContent = this.learningWords.length;
                    const learnedCount = document.getElementById('learnedCount');
                    if (learnedCount) learnedCount.textContent = this.currentWordIndex + 1;
                }

                ensurePendingTimer() {
                    if (this._pendingTimer) return;
                    this._pendingTimer = setInterval(() => this.tickPendingLearning(), 1000);
                }

                clearPendingTimer() {
                    if (this._pendingTimer) {
                        clearInterval(this._pendingTimer);
                        this._pendingTimer = null;
                    }
                }

                tickPendingLearning() {
                    if (!this._pendingLearning || this._pendingLearning.length === 0) {
                        this.clearPendingTimer();
                        this.renderPendingLearning();
                        return;
                    }
                    const now = Date.now();
                    const ready = this._pendingLearning.filter(item => item.due <= now);
                    if (ready.length > 0) {
                        this._pendingLearning = this._pendingLearning.filter(item => item.due > now);
                        const sessionActive = this.currentPage === 'learn' && this.currentWordIndex < this.learningWords.length;
                        if (sessionActive) {
                            for (const item of ready) {
                                this.learningWords.push(item.wordData);
                            }
                            this.updateSessionCounters();
                        }
                    }
                    this.renderPendingLearning();
                    if (this._pendingLearning.length === 0) this.clearPendingTimer();
                }

                renderPendingLearning() {
                    const el = document.getElementById('pendingLearning');
                    if (!el) return;
                    const pending = this._pendingLearning || [];
                    if (pending.length === 0) {
                        el.style.display = 'none';
                        el.innerHTML = '';
                        return;
                    }
                    const first = pending[0];
                    const remain = Math.max(0, Math.ceil((first.due - Date.now()) / 1000));
                    const minutes = Math.floor(remain / 60);
                    const seconds = remain % 60;
                    const timeText = minutes > 0 ? `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒` : `${seconds} 秒`;
                    el.style.display = 'block';
                    el.innerHTML = `<i class="fas fa-clock"></i> 还有 <strong>${pending.length}</strong> 个词待复习，最近一个 <strong>${timeText}</strong>后到期`;
                }

                async completeLearningSession() {
                    const todayHistory = await this.db.getTodayHistory();
                    const total = todayHistory.length;
                    const correct = todayHistory.filter(item => item.correct).length;
                    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
                    const pendingCount = (this._pendingLearning || []).length;
                    let message = '恭喜完成今日学习！';
                    if (accuracy >= 80) message += ' 表现很棒！🎉';
                    else if (accuracy >= 60) message += ' 继续保持！💪';
                    else message += ' 记得复习错词哦 📚';
                    if (pendingCount > 0) {
                        message += `（还有 ${pendingCount} 个词将在学习步长到期后复习）`;
                    }
                    this.showNotification(message, 'success');
                    this.clearPendingTimer();
                    setTimeout(() => {
                        this.switchPage('home');
                    }, 2000);
                }

                initSpeech() {
                    // Android WebView 原生 TTS 桥接
                    if (typeof AndroidTTS !== 'undefined') {
                        this.voices = [];
                        this._loadBridgeVoices();
                        // 轮询等待（TTS 就绪后 getVoices 才会返回数据）
                        if (this.voices.length === 0) {
                            let attempts = 0;
                            const poll = setInterval(() => {
                                this._loadBridgeVoices();
                                if (this.voices.length > 0 || ++attempts > 100) clearInterval(poll);
                            }, 100);
                        }
                        this.speechSynthesis = {
                            speak: (utterance) => {
                                this._currentAndroidUtterance = utterance;
                                AndroidTTS.speak(
                                    utterance.text,
                                    utterance.rate || 1.0,
                                    (utterance.voice && utterance.voice.name) || ''
                                );
                            },
                            cancel: () => {
                                AndroidTTS.stop();
                                this._currentAndroidUtterance = null;
                            },
                            pause: () => { AndroidTTS.pause(); },
                            resume: () => { AndroidTTS.resume(); }
                        };
                        this._onAndroidTTSDone = () => {
                            const u = this._currentAndroidUtterance;
                            if (!u) return;
                            this._currentAndroidUtterance = null;
                            if (u.onend) u.onend();
                        };
                        return;
                    }
                    // 浏览器 speechSynthesis
                    if ('speechSynthesis' in window) {
                        this.speechSynthesis = window.speechSynthesis;
                        this._speechSynthUtterance = null;
                        const loadVoices = () => {
                            this.voices = this.speechSynthesis.getVoices();
                            console.log('加载了 ' + this.voices.length + ' 个语音');
                        };
                        if (this.speechSynthesis.onvoiceschanged !== undefined) {
                            this.speechSynthesis.onvoiceschanged = loadVoices;
                        }
                        loadVoices();
                        if (this.voices.length === 0) {
                            let attempts = 0;
                            const poll = setInterval(() => {
                                this.voices = this.speechSynthesis.getVoices();
                                if (this.voices.length > 0 || ++attempts > 30) clearInterval(poll);
                            }, 100);
                        }
                    } else {
                        console.warn('浏览器不支持语音合成');
                    }
                }

                _onTTSReady() {
                    console.log('Android TTS 就绪');
                    this._loadBridgeVoices();
                }

                _onTTSFailed() {
                    console.warn('Android TTS 初始化失败，尝试浏览器备选');
                    // 清除桥接，降级到浏览器 speechSynthesis
                    this.speechSynthesis = null;
                    if ('speechSynthesis' in window) {
                        this.speechSynthesis = window.speechSynthesis;
                        this.voices = this.speechSynthesis.getVoices() || [];
                        if (this.voices.length === 0) {
                            let attempts = 0;
                            const poll = setInterval(() => {
                                this.voices = this.speechSynthesis.getVoices() || [];
                                if (this.voices.length > 0 || ++attempts > 30) clearInterval(poll);
                            }, 100);
                        }
                        console.log('降级到浏览器语音合成，已加载 ' + this.voices.length + ' 个语音');
                    }
                }

                _loadBridgeVoices() {
                    if (typeof AndroidTTS === 'undefined') return;
                    try {
                        const json = AndroidTTS.getVoices();
                        if (json) {
                            const parsed = JSON.parse(json);
                            if (parsed && parsed.length > 0) {
                                this.voices = parsed;
                                console.log('从 Android TTS 加载了 ' + this.voices.length + ' 个语音');
                                // 如果设置页已打开，刷新音色下拉框
                                const select = document.getElementById('ttsSpeaker');
                                const voiceSelect = document.getElementById('ttsVoice');
                                if (select && voiceSelect) {
                                    const targetLang = voiceSelect.value;
                                    const matched = this.voices.filter(v =>
                                        v.lang === targetLang || v.lang.startsWith(targetLang)
                                    );
                                    const fallback = this.voices.filter(v => v.lang.startsWith('en'));
                                    const candidates = matched.length > 0 ? matched : fallback;
                                    let html = '<option value="">系统默认</option>';
                                    const seen = new Set();
                                    candidates.forEach(v => {
                                        const key = v.name + v.lang;
                                        if (seen.has(key)) return;
                                        seen.add(key);
                                        html += '<option value="' + v.name + '">' + v.name + ' (' + v.lang + ')</option>';
                                    });
                                    select.innerHTML = html;
                                    const saved = this._savedSpeaker;
                                    if (saved) select.value = saved;
                                }
                            }
                        }
                    } catch (e) {}
                }

                async speakCurrentWord() {
                    const word = document.getElementById('currentWord')?.textContent;
                    if (!word || word === 'Loading...') return;
                    const audioUrl = this.currentAudioUrl || this.getWordAudioUrl(word);
                    if (audioUrl && (this.networkAvailable || navigator.onLine)) {
                        try {
                            const audio = new Audio(audioUrl);
                            audio.playbackRate = 0.9;
                            await new Promise((resolve, reject) => {
                                audio.onended = resolve;
                                audio.onerror = reject;
                                audio.play().catch(reject);
                            });
                            return;
                        } catch (error) {
                            console.warn('网络音频播放失败，使用 TTS:', error);
                        }
                    }
                    this.speakWithSynthesis(word);
                }

                getWordAudioUrl(word) {
                    const api = this.dictionaryAPI;
                    return api && typeof api.getAudioUrl === 'function'
                        ? api.getAudioUrl(word)
                        : '';
                }

                speakWithSynthesis(word) {
                    if (!this.speechSynthesis) {
                        this.showNotification('您的浏览器不支持语音播放', 'warning');
                        return;
                    }
                    if (this.readerTTS) this.stopReaderTTS();
                    this.speechSynthesis.cancel();
                    const utterance = new SpeechSynthesisUtterance(word);
                    utterance.rate = 0.8;
                    utterance.pitch = 1;
                    utterance.volume = 1;
                    const englishVoice = this.voices.find(v => 
                        v.lang.startsWith('en') && v.name.includes('Female')
                    ) || this.voices.find(v => v.lang.startsWith('en'));
                    if (englishVoice) {
                        utterance.voice = englishVoice;
                    }
                    utterance.onstart = () => {
                        const btn = document.getElementById('speakBtn');
                        if (btn) btn.classList.add('speaking');
                    };
                    utterance.onend = () => {
                        const btn = document.getElementById('speakBtn');
                        if (btn) btn.classList.remove('speaking');
                    };
                    this.speechSynthesis.speak(utterance);
                }

                async toggleNewWord() {
                    const wordData = this.learningWords[this.currentWordIndex];
                    const button = document.getElementById('addToNewWords');
                    if (!wordData.id) {
                        console.error('无法添加到生词本：单词ID无效', wordData);
                        this.showNotification('操作失败：单词ID无效', 'error');
                        return;
                    }
                    try {
                        const isInNewWords = await this.db.isInNewWords(wordData.id);
                        if (isInNewWords) {
                            await this.db.removeFromNewWords(wordData.id);
                            if (button) {
                                button.innerHTML = '<i class="far fa-star"></i> 加入生词本';
                                button.classList.remove('in-new-words');
                            }
                            this.showNotification('已移出生词本', 'success');
                        } else {
                            await this.db.addToNewWords(wordData.id);
                            if (button) {
                                button.innerHTML = '<i class="fas fa-star"></i> 移出生词本';
                                button.classList.add('in-new-words');
                            }
                            this.showNotification('已加入生词本', 'success');
                        }
                        if (this.currentPage === 'new-words') {
                            await this.loadNewWordsList();
                        }
                    } catch (error) {
                        console.error('操作生词本失败:', error);
                        this.showNotification('操作失败，请重试', 'error');
                    }
                }

                async updateNewWordButton(wordId) {
                    const button = document.getElementById('addToNewWords');
                    if (!button) return;
                    if (!wordId) {
                        button.innerHTML = '<i class="far fa-star"></i> 加入生词本';
                        button.classList.remove('in-new-words');
                        return;
                    }
                    try {
                        const isInNewWords = await this.db.isInNewWords(wordId);
                        if (isInNewWords) {
                            button.innerHTML = '<i class="fas fa-star"></i> 移出生词本';
                            button.classList.add('in-new-words');
                        } else {
                            button.innerHTML = '<i class="far fa-star"></i> 加入生词本';
                            button.classList.remove('in-new-words');
                        }
                    } catch (error) {
                        console.error('更新生词本按钮状态失败:', error);
                    }
                }

                toggleDetails() {
                    this.showingDetails = !this.showingDetails;
                    const detailsSection = document.getElementById('wordDetails');
                    const button = document.getElementById('showDetails');
                    if (detailsSection && button) {
                        detailsSection.style.display = this.showingDetails ? 'block' : 'none';
                        button.innerHTML = this.showingDetails 
                            ? '<i class="fas fa-eye-slash"></i> 隐藏信息'
                            : '<i class="fas fa-info-circle"></i> 详细信息';
                    }
                }

                async handleFileUpload(file) {
                    try {
                        if (file.size > 10 * 1024 * 1024) {
                            this.showNotification('文件过大，请选择小于 10MB 的文件', 'error');
                            return;
                        }
                        const text = await file.text();
                        const uploadArea = document.getElementById('uploadArea');
                        if (uploadArea) {
                            uploadArea.innerHTML = `
                                <i class="fas fa-file-alt upload-icon" style="color: #4CAF50;"></i>
                                <p><strong>${file.name}</strong></p>
                                <p>大小: ${(file.size / 1024).toFixed(2)} KB | 单词数: 计算中...</p>
                                <button class="upload-btn" id="changeFileBtn">更换文件</button>
                            `;
                            document.getElementById('changeFileBtn')?.addEventListener('click', (e) => {
                                e.stopPropagation();
                                document.getElementById('novelFile')?.click();
                            });
                        }
                        this.novelFileContent = text;
                        this.novelFileName = file.name;
                        const processBtn = document.getElementById('processBtn');
                        if (processBtn) {
                            processBtn.disabled = false;
                        }
                        const estimatedWords = text.split(/\s+/).length;
                        const uploadAreaP = uploadArea?.querySelector('p:last-of-type');
                        if (uploadAreaP) {
                            uploadAreaP.textContent = `大小: ${(file.size / 1024).toFixed(2)} KB | 预估单词数: ~${estimatedWords}`;
                        }
                    } catch (error) {
                        console.error('读取文件失败:', error);
                        this.showNotification('读取文件失败，请重试', 'error');
                    }
                }

                async populateVocabFilterSelect() {
                    const select = document.getElementById('vocabFilter');
                    if (!select) return;
                    try {
                        const lists = await this.db.getWordLists();
                        const current = select.value;
                        select.innerHTML = '<option value="">全部单词</option>' + lists
                            .map(l => `<option value="${l.id}">${l.name} (${l.wordCount || 0})</option>`)
                            .join('');
                        if (current && Array.from(select.options).some(o => o.value === current)) {
                            select.value = current;
                        }
                    } catch (error) {
                        console.error('加载词表列表失败:', error);
                    }
                }

                async processNovelFile() {
                    if (!this.novelFileContent) {
                        this.showNotification('请先选择文件', 'error');
                        return;
                    }
                    if (this.isProcessing) return;
                    this.isProcessing = true;
                    try {
                        this.showLoader('正在分析小说内容...');
                        const options = {
                            minFrequency: parseInt(document.getElementById('minFrequency')?.value || '3'),
                            skipRank: parseInt(document.getElementById('skipRank')?.value || '0'),
                            autoDifficulty: document.getElementById('autoDifficulty')?.checked ?? true
                        };
                        const filterListId = document.getElementById('vocabFilter')?.value;
                        if (filterListId) {
                            this.showLoader('正在读取词表...');
                            const listWords = await this.db.getWordsByList(parseInt(filterListId));
                            options.allowedWords = new Set(
                                listWords.map(w => (w.word || '').toLowerCase().trim()).filter(Boolean)
                            );
                            if (options.allowedWords.size === 0) {
                                this.hideLoader();
                                this.isProcessing = false;
                                this.showNotification('所选词表为空，请先导入单词或更换词表', 'error');
                                return;
                            }
                            console.log(`词表过滤启用：${options.allowedWords.size} 个单词`);
                        }
                        this.showLoader('正在分析小说内容...');
                        const result = await this.novelProcessor.processNovel(
                            this.novelFileContent, 
                            options
                        );
                        this.currentNovelWords = result.wordList;
                        this.currentNovelResult = result;
                        this.showProcessingResult(result);
                        this.hideLoader();
                        this.isProcessing = false;
                    } catch (error) {
                        console.error('处理小说失败:', error);
                        this.hideLoader();
                        this.isProcessing = false;
                        this.showNotification('处理小说失败: ' + error.message, 'error');
                    }
                }

                async saveAsReading() {
                    if (!this.novelFileContent) {
                        this.showNotification('请先选择文件', 'error');
                        return;
                    }
                    const fileName = this.novelFileName || '未命名';
                    const title = fileName.replace(/\.(txt|md|html|htm)$/i, '');
                    const wordCount = this.novelFileContent.split(/\s+/).length;
                    try {
                        await this.db.saveArticle({
                            title,
                            content: this.novelFileContent,
                            format: fileName.endsWith('.md') ? 'markdown' : fileName.endsWith('.html') || fileName.endsWith('.htm') ? 'html' : 'plain',
                            wordCount,
                            currentPosition: 0
                        });
                        this.showNotification('已保存到阅读列表', 'success');
                        this.switchPage('reading');
                        this.novelFileContent = null;
                        this.novelFileName = null;
                    } catch (err) {
                        console.error('保存阅读文件失败:', err);
                        this.showNotification('保存失败: ' + err.message, 'error');
                    }
                }

                showProcessingResult(result) {
                    const resultSection = document.getElementById('processingResult');
                    if (!resultSection) return;
                    resultSection.style.display = 'block';
                    const totalWordsCount = document.getElementById('totalWordsCount');
                    const uniqueWordsCount = document.getElementById('uniqueWordsCount');
                    const validWordsCount = document.getElementById('validWordsCount');
                    if (totalWordsCount) totalWordsCount.textContent = result.totalWords.toLocaleString();
                    if (uniqueWordsCount) uniqueWordsCount.textContent = result.uniqueWords.toLocaleString();
                    if (validWordsCount) validWordsCount.textContent = result.wordList.length.toLocaleString();
                    const difficultyBars = document.getElementById('difficultyBars');
                    if (difficultyBars) {
                        let html = '';
                        const total = result.wordList.length;
                        Object.entries(result.difficultyDistribution).forEach(([level, count]) => {
                            const percentage = total > 0 ? (count / total * 100).toFixed(1) : 0;
                            const levelText = this.getDifficultyText(level);
                            html += `
                                <div class="difficulty-bar">
                                    <div class="difficulty-label">${levelText}</div>
                                    <div class="bar-container">
                                        <div class="bar" style="width: ${percentage}%" data-level="${level}"></div>
                                        <span class="bar-count">${count} (${percentage}%)</span>
                                    </div>
                                </div>
                            `;
                        });
                        difficultyBars.innerHTML = html;
                    }
                    resultSection.scrollIntoView({ behavior: 'smooth' });
                }

                async saveWordsFromNovel() {
                    if (!this.currentNovelWords || this.currentNovelWords.length === 0) {
                        this.showNotification('没有可保存的单词', 'error');
                        return;
                    }
                    if (this.isProcessing) return;
                    this.isProcessing = true;
                    const defaultName = this.novelFileName ? 
                        this.novelFileName.replace('.txt', '').substring(0, 30) : 
                        `单词库 ${new Date().toLocaleDateString()}`;
                    const listName = prompt('请输入单词库名称:', defaultName);
                    if (!listName || !listName.trim()) {
                        this.isProcessing = false;
                        this.showNotification('取消保存', 'info');
                        return;
                    }
                    const downloadData = document.getElementById('downloadData')?.checked ?? true;
                    try {
                        this.showLoader('正在创建单词库...');
                        const listId = await this.db.createWordList(listName, `从 ${this.novelFileName || '上传文件'} 导入`);
                        console.log('创建单词库成功，ID:', listId);
                        this.showLoader('正在处理词典数据...');
                        let processedWords;
                        if (downloadData && (this.networkAvailable || navigator.onLine)) {
                            processedWords = await this.novelProcessor.batchProcessWords(
                                this.currentNovelWords,
                                (current, total, word) => {
                                    this.showLoader(`正在获取词典数据: ${word} (${current}/${total})`);
                                },
                                3
                            );
                        } else {
                            processedWords = this.currentNovelWords.map(word => ({
                                word,
                                difficulty: this.novelProcessor.assignDifficulty(word),
                                frequency: this.novelProcessor.wordFrequency.get(word) || 0,
                                meaning: `${word} 的释义（离线模式）`,
                                phonetic: `/${word.toLowerCase()}/`,
                                example: `Example for ${word}.`,
                                collins: null
                            }));
                        }
                        this.showLoader(`正在保存 ${processedWords.length} 个单词到 "${listName}"...`);
                        const originalText = this.novelFileContent || '';
                        const wordDataArray = processedWords.map(wordData => ({
                            word: wordData.word,
                            difficulty: wordData.difficulty,
                            frequency: wordData.frequency,
                            meaning: wordData.meaning,
                            phonetic: wordData.phonetic,
                            example: wordData.example,
                            collins: wordData.collins,
                            source: 'novel',
                            novelName: this.novelFileName,
                            context: this.novelProcessor.extractSentence(wordData.word, originalText)
                        }));
                        const result = await this.db.batchAddWords(wordDataArray, listId);
                        const savedCount = result.saved;
                        const skippedCount = result.skipped;
                        await this.db.updateWordListWordCount(listId);
                        this.hideLoader();
                        this.isProcessing = false;
                        this.showNotification(
                            `成功保存 ${savedCount} 个单词${skippedCount > 0 ? `（${skippedCount} 个重复）` : ''}`,
                            'success'
                        );
                        const setAsDefault = confirm(`成功保存 ${savedCount} 个单词到 "${listName}"\n\n是否设为当前学习单词库？`);
                        if (setAsDefault) {
                            await this.db.setDefaultWordList(listId);
                            await this.db.saveSetting('currentListId', listId);
                        }
                        this.hideLoader();
                        this.isProcessing = false;
                        this.currentNovelWords = null;
                        this.currentNovelResult = null;
                        this.resetUploadInterface();
                        await this.updateTodayProgress();
                        if (this.currentPage === 'words') {
                            await this.loadWordsList();
                        }
                    } catch (error) {
                        console.error('保存单词失败:', error);
                        this.hideLoader();
                        this.isProcessing = false;
                        this.showNotification('保存单词失败: ' + error.message, 'error');
                    }
                }

                resetUploadInterface() {
                    const uploadArea = document.getElementById('uploadArea');
                    if (uploadArea) {
                        uploadArea.innerHTML = `
                            <i class="fas fa-cloud-upload-alt upload-icon"></i>
                            <p>点击或拖拽文件到此区域</p>
                            <input type="file" id="novelFile" accept=".txt,.md,.html" style="display: none;">
                            <button class="upload-btn" id="selectFileBtn">选择文件</button>
                        `;
                        // 重新绑定文件上传事件
                        this.bindFileUploadEvents();
                    }
                    const processingResult = document.getElementById('processingResult');
                    if (processingResult) processingResult.style.display = 'none';
                    const processBtn = document.getElementById('processBtn');
                    if (processBtn) processBtn.disabled = true;
                    this.novelFileContent = null;
                    this.novelFileName = null;
                }

                async ensureWordListSelector(container) {
                    if (!container) return;
                    let selector = document.getElementById('wordListSelector');
                    if (!selector) {
                        const lists = await this.db.getWordLists();
                        const currentListId = await this.db.getSetting('currentListId') || 'all';
                        let currentListName = '全部单词';
                        if (currentListId !== 'all' && currentListId !== 'uncategorized') {
                            const currentList = lists.find(l => l.id == currentListId);
                            if (currentList) {
                                currentListName = currentList.name;
                            }
                        }
                        const selectHtml = `
                            <div class="word-list-selector" id="wordListSelector">
                                <label for="wordListSelect" style="color: var(--gray-color); white-space: nowrap;">单词库:</label>
                                <select id="wordListSelect" class="word-list-select">
                                    <option value="all">全部单词</option>
                                    <option value="uncategorized">未分类</option>
                                    ${lists.map(list => `
                                        <option value="${list.id}" ${list.id == currentListId ? 'selected' : ''}>
                                            ${list.name} (${list.wordCount || 0}词)
                                        </option>
                                    `).join('')}
                                </select>
                                <button class="action-btn small" id="manageListsBtn" style="white-space: nowrap;">
                                    <i class="fas fa-cog"></i> 管理
                                </button>
                            </div>
                            <div style="margin-bottom: 15px; padding: 0 15px;">
                                <span class="current-list-badge">
                                    <i class="fas fa-book"></i> 当前: ${currentListName}
                                </span>
                            </div>
                        `;
                        container.insertAdjacentHTML('afterend', selectHtml);
                        document.getElementById('wordListSelect')?.addEventListener('change', async (e) => {
                            const listId = e.target.value;
                            const saveId = listId === 'all' || listId === 'uncategorized' ? listId : parseInt(listId);
                            await this.db.saveSetting('currentListId', saveId);
                            await this.loadWordsList();
                            const selectedText = e.target.options[e.target.selectedIndex].text;
                            const badge = document.querySelector('.current-list-badge');
                            if (badge) {
                                badge.innerHTML = `<i class="fas fa-book"></i> 当前: ${selectedText.split(' (')[0]}`;
                            }
                            this.showNotification(`已切换到: ${selectedText}`, 'success');
                        });
                        document.getElementById('manageListsBtn')?.addEventListener('click', () => {
                            this.showWordListManager();
                        });
                    } else {
                        const lists = await this.db.getWordLists();
                        const currentListId = await this.db.getSetting('currentListId') || 'all';
                        const select = document.getElementById('wordListSelect');
                        const currentSelectedText = select.options[select.selectedIndex]?.text || '全部单词';
                        select.innerHTML = `
                            <option value="all">全部单词</option>
                            <option value="uncategorized">未分类</option>
                            ${lists.map(list => `
                                <option value="${list.id}" ${list.id == currentListId ? 'selected' : ''}>
                                    ${list.name} (${list.wordCount || 0}词)
                                </option>
                            `).join('')}
                        `;
                        const badge = document.querySelector('.current-list-badge');
                        if (badge) {
                            const displayName = currentSelectedText.includes('(') ? 
                                currentSelectedText.split(' (')[0] : currentSelectedText;
                            badge.innerHTML = `<i class="fas fa-book"></i> 当前: ${displayName}`;
                        }
                    }
                }

                async showWordListManager() {
                    const lists = await this.db.getWordLists();
                    const html = `
                        <div class="debug-modal" id="listManagerModal" style="z-index: 1005;">
                            <div class="debug-content" style="max-width: 600px; max-height: 80vh;">
                                <h3>管理单词库</h3>
                                <div class="word-lists-container" style="max-height: 400px; overflow-y: auto; margin: 20px 0;">
                                    ${lists.length === 0 ? '<p class="empty-state">暂无单词库</p>' : ''}
                                    ${lists.map(list => `
                                        <div class="word-list-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid var(--border-color);">
                                            <div style="flex: 1;">
                                                <div style="font-weight: 600;">${list.name} ${list.isDefault ? '<span style="color: var(--primary-color); font-size: 0.8em;">[默认]</span>' : ''}</div>
                                                <div style="font-size: 0.85em; color: var(--gray-color);">
                                                    ${list.wordCount || 0} 个单词 · ${new Date(list.createdAt).toLocaleDateString()}
                                                    ${list.description ? ' · ' + list.description : ''}
                                                </div>
                                            </div>
                                            <div style="display: flex; gap: 8px;">
                                                ${!list.isDefault ? `
                                                    <button class="action-btn small" onclick="window.app.setDefaultList(${list.id})" title="设为默认">
                                                        <i class="fas fa-check"></i> 默认
                                                    </button>
                                                ` : '<span style="color: var(--primary-color); font-size: 0.85em; padding: 8px;">当前默认</span>'}
                                                <button class="action-btn small danger" onclick="window.app.deleteWordList(${list.id})" title="删除">
                                                    <i class="fas fa-trash"></i>
                                                </button>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                                <div style="display: flex; gap: 10px; margin-top: 20px;">
                                    <button class="action-btn" onclick="window.app.createNewWordList()" style="flex: 1;">
                                        <i class="fas fa-plus"></i> 新建空库
                                    </button>
                                    <button class="close-debug" onclick="document.getElementById('listManagerModal').remove()" style="flex: 1;">
                                        关闭
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                    document.querySelector('#listManagerModal')?.remove();
                    document.body.insertAdjacentHTML('beforeend', html);
                }

                async setDefaultList(listId) {
                    try {
                        await this.db.setDefaultWordList(listId);
                        await this.db.saveSetting('currentListId', listId);
                        this.showNotification('已设为默认单词库', 'success');
                        this.showWordListManager();
                        await this.loadWordsList();
                    } catch (error) {
                        this.showNotification('设置失败', 'error');
                    }
                }

                async deleteWordList(listId) {
                    console.log('应用层 deleteWordList 被调用，ID:', listId);
                    const list = await this.db.getWordList(listId);
                    console.log('获取到的单词库:', list);
                    if (!list) {
                        this.showNotification('单词库不存在', 'error');
                        return;
                    }
                    if (!confirm(`确定要删除单词库 "${list.name}" 吗？\n这将同时删除其中的 ${list.wordCount || 0} 个单词！`)) {
                        return;
                    }
                    try {
                        this.showLoader('正在删除...');
                        await this.db.deleteWordList(listId);
                        this.hideLoader();
                        this.showNotification('单词库已删除', 'success');
                        this.showWordListManager();
                        await this.loadWordsList();
                    } catch (error) {
                        console.error('删除失败:', error);
                        this.hideLoader();
                        this.showNotification('删除失败: ' + error.message, 'error');
                    }
                }

                async createNewWordList() {
                    const name = prompt('请输入新单词库名称:');
                    if (!name || !name.trim()) return;
                    try {
                        const id = await this.db.createWordList(name.trim());
                        this.showNotification('单词库创建成功', 'success');
                        this.showWordListManager();
                    } catch (error) {
                        if (error.name === 'ConstraintError') {
                            this.showNotification('该名称已存在', 'error');
                        } else {
                            this.showNotification('创建失败', 'error');
                        }
                    }
                }

                async loadWordsList() {
                    try {
                        const wordsList = document.getElementById('wordsList');
                        const wordsHeader = document.querySelector('.words-header');
                        await this.ensureWordListSelector(wordsHeader);
                        wordsList.innerHTML = '<div class="loading">加载中...</div>';
                        const currentListId = await this.db.getSetting('currentListId');
                        const filter = {
                            listId: currentListId || 'all',
                            difficulty: document.getElementById('difficultyFilter')?.value || 'all',
                            search: document.getElementById('wordSearch')?.value || ''
                        };
                        let words;
                        if (filter.listId === 'all') {
                            words = await this.db.getAllWords({ 
                                difficulty: filter.difficulty,
                                search: filter.search
                            });
                        } else {
                            words = await this.db.getWordsByList(filter.listId, {
                                difficulty: filter.difficulty,
                                search: filter.search
                            });
                        }
                        console.log(`加载单词列表: ${words.length} 个单词，库ID: ${filter.listId}`);
                        if (words.length === 0) {
                            wordsList.innerHTML = filter.search 
                                ? '<p class="empty-state">没有找到匹配的单词</p>'
                                : '<p class="empty-state">该单词库暂无单词，请先上传小说</p>';
                            return;
                        }
                        const batchSize = 20;
                        let html = '';
                        // 批量获取所有进度，避免 N+1
                        const allProgress = await this.db.getAllProgress();
                        const progressMap = new Map();
                        allProgress.forEach(p => progressMap.set(p.wordId, p));
                        for (let i = 0; i < words.length; i += batchSize) {
                            const batch = words.slice(i, i + batchSize);
                            const batchHtml = batch.map((word) => {
                                const progress = progressMap.get(word.id);
                                const familiarity = progress ? progress.familiarity : 0;
                                return `
                                    <div class="word-item" data-word-id="${word.id}">
                                        <div class="word-content">
                                            <div class="word-text">${word.word}</div>
                                            <div class="word-phonetic">${word.phonetic || ''}</div>
                                            <div class="word-meaning">${word.meaning || ''}</div>
                                            <div class="word-meta">
                                                <span class="difficulty-badge small" data-level="${word.difficulty}">
                                                    ${this.getDifficultyText(word.difficulty)}
                                                </span>
                                                <span class="familiarity">
                                                    ${'★'.repeat(familiarity)}${'☆'.repeat(5 - familiarity)}
                                                </span>
                                                ${word.novelName ? `<small style="color: var(--gray-color);">来自: ${word.novelName}</small>` : ''}
                                            </div>
                                        </div>
                                        <div class="word-actions">
                                            <button class="icon-btn small" onclick="window.app.speakWord('${word.word}')" title="发音">
                                                <i class="fas fa-volume-up"></i>
                                            </button>
                                            <button class="icon-btn small" onclick="window.app.addWordToStudy(${word.id})" title="学习">
                                                <i class="fas fa-book-open"></i>
                                            </button>
                                        </div>
                                    </div>
                                `;
                            });
                            html += batchHtml.join('');
                            if (i === 0) {
                                wordsList.innerHTML = html;
                            } else {
                                wordsList.insertAdjacentHTML('beforeend', batchHtml.join(''));
                            }
                            // 让本批新增单词文本/释义中的英文单词可点击查词
                            this.makeClickable(wordsList);
                            await new Promise(resolve => setTimeout(resolve, 10));
                        }
                    } catch (error) {
                        console.error('加载单词列表失败:', error);
                        const wordsList = document.getElementById('wordsList');
                        if (wordsList) {
                            wordsList.innerHTML = `
                                <div class="error-state">
                                    <i class="fas fa-exclamation-triangle"></i>
                                    <p>加载失败</p>
                                    <button class="retry-btn" onclick="window.app.loadWordsList()">重试</button>
                                </div>
                            `;
                        }
                    }
                }

                async loadNewWordsList() {
                    try {
                        const newWordsList = document.getElementById('newWordsList');
                        if (!newWordsList) {
                            console.error('找不到 newWordsList 元素');
                            return;
                        }
                        newWordsList.innerHTML = '<div class="loading">加载中...</div>';
                        const currentListId = await this.db.getSetting('currentListId');
                        console.log(`=== 开始加载生词本，当前库: ${currentListId || '全部'} ===`);
                        const newWords = await this.db.getNewWords(currentListId);
                        console.log(`生词本最终数据: ${newWords.length} 个`);
                        if (newWords.length === 0) {
                            try {
                                const rawRecords = await new Promise((resolve) => {
                                    const tx = this.db.db.transaction(['new_words'], 'readonly');
                                    const store = tx.objectStore('new_words');
                                    const req = store.getAll();
                                    req.onsuccess = () => resolve(req.result);
                                });
                                console.log('原始生词记录:', rawRecords);
                                if (rawRecords.length > 0) {
                                    const sampleId = rawRecords[0].wordId;
                                    const testWord = await this.db.getWordById(parseInt(sampleId));
                                    console.log(`测试查询ID ${sampleId}:`, testWord ? '找到' : '未找到');
                                }
                            } catch (e) {
                                console.error('调试查询失败:', e);
                            }
                            newWordsList.innerHTML = '<p class="empty-state">生词本为空，学习过程中标记不认识的单词会出现在这里</p>';
                            return;
                        }
                        const sortedWords = newWords.sort((a, b) => 
                            new Date(b.addedAt) - new Date(a.addedAt)
                        );
                        let html = '';
                        for (const word of sortedWords) {
                            if (!word || !word.word) continue;
                            const addedDate = new Date(word.addedAt);
                            const dateStr = addedDate.toLocaleDateString('zh-CN', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric'
                            });
                            html += `
                                <div class="word-item" data-word-id="${word.id}">
                                    <div class="word-content">
                                        <div class="word-text">${word.word}</div>
                                        <div class="word-phonetic">${word.phonetic || ''}</div>
                                        <div class="word-meaning">${word.meaning || '暂无释义'}</div>
                                        <div class="word-meta">
                                            <span class="added-date">
                                                <i class="far fa-clock"></i> ${dateStr}
                                            </span>
                                            <span class="difficulty-badge small" data-level="${word.difficulty || 3}">
                                                ${this.getDifficultyText(word.difficulty || 3)}
                                            </span>
                                        </div>
                                    </div>
                                    <div class="word-actions">
                                        <button class="icon-btn small" onclick="window.app.speakWord('${word.word}')" title="发音">
                                            <i class="fas fa-volume-up"></i>
                                        </button>
                                        <button class="icon-btn small" onclick="window.app.removeFromNewWords(${word.id})" title="移除">
                                            <i class="fas fa-trash-alt"></i>
                                        </button>
                                    </div>
                                </div>
                            `;
                        }
                        newWordsList.innerHTML = html;
                        // 让生词本里的单词文本/释义可点击查词
                        this.makeClickable(newWordsList);
                    } catch (error) {
                        console.error('加载生词本失败:', error);
                        const newWordsList = document.getElementById('newWordsList');
                        if (newWordsList) {
                            newWordsList.innerHTML = `
                                <div class="error-state">
                                    <i class="fas fa-exclamation-triangle"></i>
                                    <p>加载失败: ${error.message}</p>
                                    <button class="retry-btn" onclick="window.app.retryLoadNewWords()">重试</button>
                                </div>
                            `;
                        }
                    }
                }

                async removeFromNewWords(wordId) {
                    try {
                        await this.db.removeFromNewWords(wordId);
                        await this.loadNewWordsList();
                        this.showNotification('已从生词本移除', 'success');
                    } catch (error) {
                        console.error('移除生词失败:', error);
                        this.showNotification('移除失败', 'error');
                    }
                }

                async studyNewWords() {
                    try {
                        const currentListId = await this.db.getSetting('currentListId');
                        const newWords = await this.db.getNewWords(currentListId);
                        if (newWords.length === 0) {
                            this.showNotification('生词本为空', 'info');
                            return;
                        }
                        this.isStudyingPreparedSession = true;
                        this.learningWords = newWords;
                        this.currentWordIndex = 0;
                        this.showingDetails = false;
                        this.switchPage('learn');
                    } catch (error) {
                        console.error('开始学习生词失败:', error);
                        this.showNotification('开始学习失败', 'error');
                        this.isStudyingPreparedSession = false;
                    }
                }

                async clearNewWords() {
                    if (!confirm('确定要清空生词本吗？此操作不可恢复。')) {
                        return;
                    }
                    try {
                        await this.db.clearAllNewWords();
                        await this.loadNewWordsList();
                        this.showNotification('生词本已清空', 'success');
                    } catch (error) {
                        console.error('清空生词本失败:', error);
                        this.showNotification('清空失败', 'error');
                    }
                }

                async saveDailyPlan() {
                    try {
                        const dailyGoalInput = document.getElementById('dailyGoal');
                        const reviewGoalInput = document.getElementById('reviewGoal');
                        const studyTimeSelect = document.getElementById('studyTime');
                        const notificationCheckbox = document.getElementById('notification');
                        const plan = {
                            dailyGoal: parseInt(dailyGoalInput?.value) || 20,
                            reviewGoal: parseInt(reviewGoalInput?.value) || 50,
                            studyTime: studyTimeSelect?.value || 'any',
                            notifications: notificationCheckbox?.checked || false
                        };
                        if (plan.dailyGoal < 5 || plan.dailyGoal > 100) {
                            this.showNotification('每日目标应在 5-100 之间', 'warning');
                            return;
                        }
                        await this.db.saveDailyPlan(plan);
                        this.showNotification('学习计划已保存', 'success');
                        await this.updateTodayProgress();
                        this.updatePlanStats();
                        if (plan.notifications && 'Notification' in window) {
                            Notification.requestPermission();
                        }
                    } catch (error) {
                        console.error('保存学习计划失败:', error);
                        this.showNotification('保存失败', 'error');
                    }
                }

                async loadPlanPage() {
                    try {
                        const plan = await this.db.getDailyPlan();
                        const dailyGoalInput = document.getElementById('dailyGoal');
                        const reviewGoalInput = document.getElementById('reviewGoal');
                        const studyTimeSelect = document.getElementById('studyTime');
                        const notificationCheckbox = document.getElementById('notification');
                        if (dailyGoalInput) dailyGoalInput.value = plan.dailyGoal;
                        if (reviewGoalInput) reviewGoalInput.value = plan.reviewGoal;
                        if (studyTimeSelect) studyTimeSelect.value = plan.studyTime;
                        if (notificationCheckbox) notificationCheckbox.checked = plan.notifications;
                        await this.updatePlanStats();
                    } catch (error) {
                        console.error('加载计划页面失败:', error);
                    }
                }

                async updatePlanStats() {
                    try {
                        const plan = await this.db.getDailyPlan();
                        const todayHistory = await this.db.getTodayHistory();
                        const currentListId = await this.db.getSetting('currentListId');
                        let allWords;
                        if (currentListId && currentListId !== 'all') {
                            allWords = await this.db.getWordsByList(currentListId);
                        } else {
                            allWords = await this.db.getAllWords();
                        }
                        const completionRate = plan.dailyGoal > 0 ? 
                            Math.min((todayHistory.length / plan.dailyGoal) * 100, 100) : 0;
                        const streak = await this.db.getSetting('learningStreak') || '0';
                        const planCompletion = document.getElementById('planCompletion');
                        const planDays = document.getElementById('planDays');
                        const planLearned = document.getElementById('planLearned');
                        if (planCompletion) planCompletion.textContent = `${Math.round(completionRate)}%`;
                        if (planDays) planDays.textContent = streak;
                        if (planLearned) planLearned.textContent = allWords.length;
                    } catch (error) {
                        console.error('更新计划统计失败:', error);
                    }
                }

                async loadReviewPage() {
                    try {
                        const reviewList = document.getElementById('reviewList');
                        if (!reviewList) return;
                        reviewList.innerHTML = '<div class="loading">加载中...</div>';
                        const reviewWords = await this.db.getWordsForReview();
                        console.log(`加载复习页面: ${reviewWords.length} 个复习单词`);
                        const reviewCount = document.getElementById('reviewCount');
                        const urgentCount = document.getElementById('urgentCount');
                        const avgFamiliarity = document.getElementById('avgFamiliarity');
                        if (reviewCount) reviewCount.textContent = reviewWords.length;
                        const urgent = reviewWords.filter(w => {
                            const days = w.progress?.nextReview ? 
                                Math.ceil((new Date(w.progress.nextReview) - new Date()) / (1000 * 60 * 60 * 24)) : 0;
                            return days <= 0;
                        }).length;
                        if (urgentCount) urgentCount.textContent = urgent;
                        const avg = reviewWords.length > 0 ?
                            (reviewWords.reduce((sum, w) => sum + (w.progress?.familiarity || 0), 0) / reviewWords.length).toFixed(1) : 0;
                        if (avgFamiliarity) avgFamiliarity.textContent = `${avg}/5`;
                        if (reviewWords.length === 0) {
                            reviewList.innerHTML = '<p class="empty-state">暂时没有需要复习的单词，学习新单词后会自动安排复习</p>';
                            return;
                        }
                        const sortedWords = reviewWords.sort((a, b) => {
                            const daysA = a.progress?.nextReview ? 
                                new Date(a.progress.nextReview) - new Date() : Infinity;
                            const daysB = b.progress?.nextReview ? 
                                new Date(b.progress.nextReview) - new Date() : Infinity;
                            if (daysA !== daysB) return daysA - daysB;
                            const freqA = a.frequency || 0;
                            const freqB = b.frequency || 0;
                            return freqB - freqA;
                        });
                        let html = '';
                        for (const word of sortedWords.slice(0, 50)) {
                            const progress = word.progress || {};
                            const nextReviewDate = progress.nextReview ? new Date(progress.nextReview) : null;
                            const daysLeft = nextReviewDate ? 
                                Math.ceil((nextReviewDate - new Date()) / (1000 * 60 * 60 * 24)) : 0;
                            let reviewStatus = '';
                            let statusClass = '';
                            if (daysLeft <= 0) {
                                reviewStatus = '今天复习';
                                statusClass = 'review-urgent';
                            } else if (daysLeft <= 3) {
                                reviewStatus = `${daysLeft}天后`;
                                statusClass = 'review-soon';
                            } else {
                                reviewStatus = `${daysLeft}天后`;
                                statusClass = 'review-later';
                            }
                            html += `
                                <div class="review-item" data-word-id="${word.id}">
                                    <div class="review-content">
                                        <div class="review-word">
                                            <strong>${word.word}</strong>
                                            <span class="review-phonetic">${word.phonetic || ''}</span>
                                        </div>
                                        <div class="review-meaning">${word.meaning || '暂无释义'}</div>
                                        ${word.context ? `<div class="review-context">📖 ${this.escapeHtml(word.context)}</div>` : ''}
                                        <div class="review-meta">
                                            <span class="review-status ${statusClass}">${reviewStatus}</span>
                                            <span class="review-familiarity">
                                                熟悉度: ${'★'.repeat(progress.familiarity || 0)}${'☆'.repeat(5 - (progress.familiarity || 0))}
                                            </span>
                                            ${word.errorCount ? `<span class="review-error" style="color:var(--danger-color);font-weight:600;">⚠ 易错${word.errorCount}次</span>` : ''}
                                            ${word.novelName ? `<small style="color: var(--gray-color);">来自: ${word.novelName}</small>` : ''}
                                        </div>
                                    </div>
                                    <div class="review-actions">
                                        <button class="review-btn" onclick="window.app.quickReviewWord(${word.id})">
                                            立即复习
                                        </button>
                                    </div>
                                </div>
                            `;
                        }
                        if (sortedWords.length > 50) {
                            html += `<p class="empty-state">还有 ${sortedWords.length - 50} 个单词待复习...</p>`;
                        }
                        reviewList.innerHTML = html;
                        // 让复习列表里的单词文本/释义可点击查词
                        this.makeClickable(reviewList);
                    } catch (error) {
                        console.error('加载复习页面失败:', error);
                        const reviewList = document.getElementById('reviewList');
                        if (reviewList) {
                            reviewList.innerHTML = `
                                <div class="error-state">
                                    <i class="fas fa-exclamation-triangle"></i>
                                    <p>加载失败</p>
                                    <button class="retry-btn" onclick="window.app.loadReviewPage()">重试</button>
                                </div>
                            `;
                        }
                    }
                }

                async quickReviewWord(wordId) {
                    try {
                        const word = await this.db.getWordById(wordId);
                        if (word) {
                            this.isStudyingPreparedSession = true;
                            this.learningWords = [word];
                            this.currentWordIndex = 0;
                            this.switchPage('learn');
                        }
                    } catch (error) {
                        console.error('快速复习单词失败:', error);
                    }
                }

                async startReviewSession() {
                    try {
                        const reviewWords = await this.db.getWordsForReview();
                        if (reviewWords.length === 0) {
                            this.showNotification('暂时没有需要复习的单词', 'info');
                            return;
                        }
                        const plan = await this.db.getDailyPlan();
                        const limit = Math.min(reviewWords.length, plan.reviewGoal);
                        this.isStudyingPreparedSession = true;
                        this.learningWords = reviewWords.slice(0, limit);
                        this.currentWordIndex = 0;
                        this.showingDetails = false;
                        this.switchPage('learn');
                    } catch (error) {
                        console.error('开始复习失败:', error);
                        this.showNotification('开始复习失败', 'error');
                    }
                }

                async loadSettingsPage() {
                    try {
                        const settingsPage = document.getElementById('settingsPage');
                        if (!settingsPage) return;
                        if (!settingsPage.innerHTML.trim() || settingsPage.dataset.loaded !== 'true') {
                            settingsPage.innerHTML = this.createSettingsPageHTML();
                            settingsPage.dataset.loaded = 'true';
                            this.bindSettingsEvents();
                        }
                        await this.loadSettingsData();
                        await this.refreshEcdictSettings();
                    } catch (error) {
                        console.error('加载设置页面失败:', error);
                    }
                }

                createSettingsPageHTML() {
                    return `
                        <div class="page-header">
                            <h2>设置</h2>
                        </div>
                        <div class="settings-container">
                            <div class="settings-section">
                                <h3>学习设置</h3>
                                <div class="setting-item">
                                    <label for="autoPlaySound">自动播放单词发音</label>
                                    <div class="setting-control">
                                        <label class="switch">
                                            <input type="checkbox" id="autoPlaySound">
                                            <span class="slider"></span>
                                        </label>
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label for="showPhonetic">显示音标</label>
                                    <div class="setting-control">
                                        <label class="switch">
                                            <input type="checkbox" id="showPhonetic" checked>
                                            <span class="slider"></span>
                                        </label>
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label for="autoNextWord">答对后自动下一个</label>
                                    <div class="setting-control">
                                        <label class="switch">
                                            <input type="checkbox" id="autoNextWord">
                                            <span class="slider"></span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                            <div class="settings-section">
                                <h3>记忆算法（FSRS-6）</h3>
                                <div class="setting-item">
                                    <label for="fsrsRetention">目标记忆保持率</label>
                                    <div class="setting-control">
                                        <select id="fsrsRetention">
                                            <option value="0.85">85%（长期记忆，间隔更长）</option>
                                            <option value="0.9">90%（默认）</option>
                                            <option value="0.95">95%（考前冲刺，复习更频繁）</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="setting-item" style="flex-direction:column; align-items:stretch; gap:6px;">
                                    <label for="fsrsParams">自定义 FSRS 参数 w（数字用逗号或空格分隔，留空使用官方默认）</label>
                                    <textarea id="fsrsParams" rows="3" placeholder="例如：0.212, 1.2931, 2.3065, 8.2956, ..."></textarea>
                                    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                                        <button class="action-btn small primary" id="applyFsrsParams">应用参数</button>
                                        <button class="action-btn small" id="resetFsrsParams">恢复默认</button>
                                        <span id="fsrsParamsStatus" class="import-status"></span>
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label>复习日志（可用于离线优化参数）</label>
                                    <div class="setting-control">
                                        <span id="reviewLogCount" class="import-status">0 条</span>
                                        <button class="action-btn small" id="exportReviewLog">
                                            <i class="fas fa-download"></i> 导出 CSV
                                        </button>
                                        <button class="action-btn small danger" id="clearReviewLog">
                                            <i class="fas fa-trash-alt"></i> 清空
                                        </button>
                                    </div>
                                </div>
                                <p style="font-size:0.85rem; color:var(--gray-color); margin-top:10px;">导出的 CSV 符合官方 FSRS review log 格式，可在 fsrs-analyzer 中优化参数后，把新的 w 粘贴回「自定义参数」应用。</p>
                            </div>
                            <div class="settings-section">
                                <h3>词典 API 设置</h3>
                                <div class="setting-item">
                                    <label for="mwDictKey">Merriam-Webster 词典 API Key</label>
                                    <div class="setting-control" style="flex: 1;">
                                        <input type="text" id="mwDictKey" placeholder="输入 Collegiate Dictionary API Key" style="flex:1; min-width:200px;">
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label for="mwThesKey">Merriam-Webster 同义词 API Key</label>
                                    <div class="setting-control" style="flex: 1;">
                                        <input type="text" id="mwThesKey" placeholder="输入 Collegiate Thesaurus API Key" style="flex:1; min-width:200px;">
                                    </div>
                                </div>
                                <p style="font-size:0.85rem; color:var(--gray-color); margin-top:10px;">请从 Merriam-Webster 开发者中心获取这两个 Key。</p>
                            </div>
                            <div class="settings-section">
                                <h3>语音合成设置</h3>
                                <div class="setting-item">
                                    <label for="ttsEngine">全文朗读引擎</label>
                                    <div class="setting-control">
                                        <select id="ttsEngine">
                                            <option value="system">系统语音</option>
                                            <option value="mimo">MiMo 云端 (mimo-v2.5-tts)</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="setting-item" id="mimoApiKeyItem">
                                    <label for="mimoApiKey">MiMo API Key</label>
                                    <div class="setting-control" style="flex: 1;">
                                        <input type="password" id="mimoApiKey" placeholder="输入 MiMo API Key" style="flex:1; min-width:200px;">
                                    </div>
                                </div>
                                <div class="setting-item" id="mimoVoiceItem">
                                    <label for="mimoVoice">MiMo 音色</label>
                                    <div class="setting-control">
                                        <select id="mimoVoice">
                                            <option value="mimo_default">MiMo 默认</option>
                                            <option value="冰糖">冰糖 (中文·女)</option>
                                            <option value="茉莉">茉莉 (中文·女)</option>
                                            <option value="苏打">苏打 (中文·男)</option>
                                            <option value="白桦">白桦 (中文·男)</option>
                                            <option value="Mia">Mia (英文·女)</option>
                                            <option value="Chloe">Chloe (英文·女)</option>
                                            <option value="Milo">Milo (英文·男)</option>
                                            <option value="Dean">Dean (英文·男)</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="setting-item" id="mimoStyleItem">
                                    <label for="mimoStyle">MiMo 发音风格</label>
                                    <div class="setting-control">
                                        <select id="mimoStyle">
                                            <option value="standard">标准 (默认)</option>
                                            <option value="温柔">温柔</option>
                                            <option value="活泼">活泼</option>
                                            <option value="严肃">严肃</option>
                                            <option value="平静">平静</option>
                                            <option value="磁性">磁性</option>
                                            <option value="深沉">深沉</option>
                                            <option value="custom">自定义指令...</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="setting-item" id="mimoStyleCustomItem" style="display:none;">
                                    <label for="mimoStyleCustom">自定义风格指令</label>
                                    <div class="setting-control" style="flex:1;">
                                        <input type="text" id="mimoStyleCustom" placeholder="例如：用沉稳缓慢的语调朗读，语气平缓自然" style="flex:1; min-width:200px;">
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label for="ttsVoice">朗读语言</label>
                                    <div class="setting-control">
                                        <select id="ttsVoice">
                                            <option value="en-us">美式英语 (en-us)</option>
                                            <option value="en-uk">英式英语 (en-uk)</option>
                                            <option value="en-au">澳洲英语 (en-au)</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label for="ttsSpeaker">朗读音色</label>
                                    <div class="setting-control">
                                        <select id="ttsSpeaker"></select>
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label for="ttsSpeed">朗读语速</label>
                                    <div class="setting-control" style="flex-direction:column; align-items:stretch; gap:4px;">
                                        <input type="range" id="ttsSpeed" min="-10" max="10" value="0" step="0.25" style="width:100%;">
                                        <span id="ttsSpeedValue" style="font-size:0.9rem; color:var(--gray-color); text-align:center;">0 (正常)</span>
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label for="sentenceTtsEngine">例句播放策略</label>
                                    <div class="setting-control">
                                        <select id="sentenceTtsEngine">
                                            <option value="auto">自动（有 MiMo Key 用云端，否则系统语音）</option>
                                            <option value="system">系统语音（免费、离线可用）</option>
                                            <option value="mimo">MiMo 云端（默认语音）</option>
                                            <option value="follow">跟随全文朗读引擎</option>
                                        </select>
                                    </div>
                                </div>
                                <p style="font-size:0.85rem; color:var(--gray-color); margin-top:10px;">引擎仅影响阅读器全文朗读；单词发音仍使用系统语音或词典音频。MiMo API Key 请到 Xiaomi MiMo 开放平台获取。</p>
                                <p style="font-size:0.85rem; color:var(--gray-color); margin-top:6px;">例句朗读会打断正在进行的全文朗读；MiMo 云端生成成功的例句音频会缓存到本地（系统语音不缓存）。</p>
                            </div>
                            <div class="settings-section">
                                <h3>AI 分析设置</h3>
                                <div class="setting-item">
                                    <label for="llmProvider">AI 提供商</label>
                                    <div class="setting-control">
                                        <select id="llmProvider">
                                            <option value="zhipu">智谱 GLM</option>
                                            <option value="deepseek">DeepSeek</option>
                                            <option value="mimo">小米 MiMo</option>
                                            <option value="qwen">通义千问</option>
                                            <option value="custom">自定义 (OpenAI兼容)</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label for="llmApiBase">API 地址</label>
                                    <div class="setting-control" style="flex:1;">
                                        <input type="text" id="llmApiBase" placeholder="留空使用提供商默认地址" style="flex:1; min-width:200px;">
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label for="llmApiKey">API Key</label>
                                    <div class="setting-control" style="flex: 1;">
                                        <input type="password" id="llmApiKey" placeholder="输入 API Key" style="flex:1; min-width:200px;">
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label for="llmModel">模型</label>
                                    <div class="setting-control" style="flex:1;">
                                        <input type="text" id="llmModel" placeholder="留空使用提供商默认模型" style="flex:1; min-width:200px;">
                                        <span id="llmModelHint" style="font-size:0.8rem; color:var(--gray-color);">默认: glm-4.7-flash</span>
                                    </div>
                                </div>
                                <div class="setting-item" style="flex-direction:column; align-items:stretch; gap:6px;">
                                    <label for="llmPrompt">AI 提示词（使用 {word} 作为单词占位符）</label>
                                    <textarea id="llmPrompt" rows="5" style="width:100%; padding:10px; border:1px solid var(--border-color); border-radius:8px; font-size:0.9rem; resize:vertical; box-sizing:border-box;"></textarea>
                                </div>
                                <div class="setting-item">
                                    <label for="llmWebSearch">AI 联网搜索</label>
                                    <div class="setting-control">
                                        <label class="switch">
                                            <input type="checkbox" id="llmWebSearch" checked>
                                            <span class="slider"></span>
                                        </label>
                                        <span id="llmWebSearchHint" style="font-size:0.8rem; color:var(--gray-color); margin-left:8px;">仅智谱可用</span>
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label for="llmTemperature">Temperature (随机性)</label>
                                    <div class="setting-control" style="flex-direction:column; align-items:stretch; gap:4px;">
                                        <input type="range" id="llmTemperature" min="0" max="2" step="0.1" value="0.7" style="width:100%;">
                                        <span id="llmTemperatureValue" style="font-size:0.9rem; color:var(--gray-color); text-align:center;">0.7</span>
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label for="llmTopP">Top P (多样性)</label>
                                    <div class="setting-control" style="flex-direction:column; align-items:stretch; gap:4px;">
                                        <input type="range" id="llmTopP" min="0" max="1" step="0.1" value="0.9" style="width:100%;">
                                        <span id="llmTopPValue" style="font-size:0.9rem; color:var(--gray-color); text-align:center;">0.9</span>
                                    </div>
                                </div>
                            </div>
                            <div class="settings-section">
                                <h3>显示设置</h3>
                                <div class="setting-item">
                                    <label for="theme">主题</label>
                                    <div class="setting-control">
                                        <select id="theme">
                                            <option value="light">浅色主题</option>
                                            <option value="dark">深色主题</option>
                                            <option value="auto">跟随系统</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label for="fontSize">字体大小</label>
                                    <div class="setting-control">
                                        <select id="fontSize">
                                            <option value="small">小</option>
                                            <option value="medium" selected>中</option>
                                            <option value="large">大</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div class="settings-section">
                                <h3>数据管理</h3>
                                <div class="setting-item">
                                    <label>导出学习数据</label>
                                    <div class="setting-control">
                                        <button class="action-btn small" id="exportData">
                                            <i class="fas fa-download"></i> 导出
                                        </button>
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label>导入学习数据</label>
                                    <div class="setting-control">
                                        <button class="action-btn small" id="importDataBtn">
                                            <i class="fas fa-upload"></i> 导入
                                        </button>
                                        <input type="file" id="importFile" accept=".json" style="display: none;">
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label>导入 AI 释义缓存</label>
                                    <div class="setting-control ai-cache-row">
                                        <label class="ai-cache-overwrite">
                                            <input type="checkbox" id="aiCacheOverwrite"> 覆盖已有 AI 缓存
                                        </label>
                                        <button class="action-btn small" id="importAiCacheBtn">
                                            <i class="fas fa-brain"></i> 导入
                                        </button>
                                        <input type="file" id="importAiCacheFile" accept=".json,.jsonl,.txt" style="display: none;">
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label>导入进度</label>
                                    <div class="setting-control ai-cache-status-row">
                                        <span id="aiCacheImportStatus" class="import-status">未开始</span>
                                        <button class="action-btn small danger" id="cancelAiCacheImport" style="display: none;">取消</button>
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label>ECDICT 外部词典</label>
                                    <div class="setting-control ecdict-import-row">
                                        <span id="ecdictStatus" class="import-status">未安装</span>
                                        <button class="action-btn small" id="importEcdictBtn">
                                            <i class="fas fa-book-open"></i> 导入
                                        </button>
                                        <button class="action-btn small danger" id="deleteEcdictBtn" style="display: none;">
                                            <i class="fas fa-trash-alt"></i> 删除
                                        </button>
                                        <button class="action-btn small danger" id="cancelEcdictImport" style="display: none;">取消</button>
                                        <input type="file" id="importEcdictFile" accept=".csv,text/csv" style="display: none;">
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label>ECDICT 导入进度</label>
                                    <div class="setting-control">
                                        <div class="ecdict-progress-wrap" id="ecdictProgressWrap" style="display: none;">
                                            <div class="ecdict-progress-bar" id="ecdictProgressBar"></div>
                                        </div>
                                        <span class="ecdict-hint">全量约 63MB，导入后约 150MB；仅存本机，不进入学习数据备份。</span>
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label>清空所有数据</label>
                                    <div class="setting-control">
                                        <button class="action-btn small danger" id="clearAllData">
                                            <i class="fas fa-trash-alt"></i> 清空
                                        </button>
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label>调试信息</label>
                                    <div class="setting-control">
                                        <button class="action-btn small" id="showDebugInfo">
                                            <i class="fas fa-bug"></i> 查看
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div class="settings-actions">
                                <button class="save-settings-btn" id="saveSettings">
                                    <i class="fas fa-save"></i> 保存设置
                                </button>
                            </div>
                        </div>
                    `;
                }

                bindSettingsEvents() {
                    document.getElementById('exportData')?.addEventListener('click', () => this.exportData());
                    document.getElementById('importDataBtn')?.addEventListener('click', () => {
                        document.getElementById('importFile')?.click();
                    });
                    document.getElementById('importFile')?.addEventListener('change', (e) => {
                        if (e.target.files[0]) {
                            this.importData(e.target.files[0]);
                        }
                    });
                    document.getElementById('importAiCacheBtn')?.addEventListener('click', () => {
                        document.getElementById('importAiCacheFile')?.click();
                    });
                    document.getElementById('importAiCacheFile')?.addEventListener('change', async (e) => {
                        if (e.target.files[0]) await this.importAiCache(e.target.files[0]);
                        e.target.value = '';
                    });
                    document.getElementById('cancelAiCacheImport')?.addEventListener('click', () => {
                        if (this._aiCacheAbort) this._aiCacheAbort.abort();
                        document.getElementById('cancelAiCacheImport')?.setAttribute('style', 'display: none;');
                    });
                    document.getElementById('importEcdictBtn')?.addEventListener('click', () => {
                        document.getElementById('importEcdictFile')?.click();
                    });
                    document.getElementById('importEcdictFile')?.addEventListener('change', async (e) => {
                        if (e.target.files[0]) await this.importEcdict(e.target.files[0]);
                        e.target.value = '';
                    });
                    document.getElementById('deleteEcdictBtn')?.addEventListener('click', () => this.deleteEcdict());
                    document.getElementById('cancelEcdictImport')?.addEventListener('click', () => this.cancelEcdictImport());
                    document.getElementById('clearAllData')?.addEventListener('click', () => this.clearAllData());
                    document.getElementById('showDebugInfo')?.addEventListener('click', () => this.showDebugInfo());
                    document.getElementById('saveSettings')?.addEventListener('click', () => this.saveSettings());
                    document.getElementById('applyFsrsParams')?.addEventListener('click', () => this.applyFsrsParams());
                    document.getElementById('resetFsrsParams')?.addEventListener('click', () => this.resetFsrsParams());
                    document.getElementById('exportReviewLog')?.addEventListener('click', () => this.exportReviewLog());
                    document.getElementById('clearReviewLog')?.addEventListener('click', () => this.clearReviewLog());

                    // Populate speaker list from browser voices filtered by language
                    const populateSpeakers = () => {
                        const select = document.getElementById('ttsSpeaker');
                        const langSelect = document.getElementById('ttsVoice');
                        if (!select || !langSelect) return;
                        const targetLang = langSelect.value;
                        const matched = this.voices.filter(v =>
                            v.lang === targetLang || v.lang.startsWith(targetLang)
                        );
                        const fallback = this.voices.filter(v => v.lang.startsWith('en'));
                        const candidates = matched.length > 0 ? matched : fallback;
                        let html = '<option value="">系统默认</option>';
                        const seen = new Set();
                        candidates.forEach(v => {
                            const key = v.name + v.lang;
                            if (seen.has(key)) return;
                            seen.add(key);
                            const gender = v.name.match(/female|male/i)?.[0]?.toLowerCase() || '';
                            const label = `${v.name} (${v.lang})${gender ? ' - ' + gender : ''}`;
                            html += `<option value="${v.name}">${label}</option>`;
                        });
                        select.innerHTML = html;
                        // restore saved selection if still available
                        const saved = this._savedSpeaker;
                        if (saved) select.value = saved;
                    };
                    const voiceSelect = document.getElementById('ttsVoice');
                    if (voiceSelect) {
                        populateSpeakers();
                        voiceSelect.addEventListener('change', populateSpeakers);
                    }

                    const toggleMimoFields = () => {
                        const engine = document.getElementById('ttsEngine')?.value;
                        const keyItem = document.getElementById('mimoApiKeyItem');
                        const voiceItem = document.getElementById('mimoVoiceItem');
                        const styleItem = document.getElementById('mimoStyleItem');
                        const styleCustomItem = document.getElementById('mimoStyleCustomItem');
                        const isMimo = engine === 'mimo';
                        if (keyItem) keyItem.style.display = isMimo ? '' : 'none';
                        if (voiceItem) voiceItem.style.display = isMimo ? '' : 'none';
                        if (styleItem) styleItem.style.display = isMimo ? '' : 'none';
                        if (styleCustomItem) {
                            styleCustomItem.style.display = (isMimo && document.getElementById('mimoStyle')?.value === 'custom') ? '' : 'none';
                        }
                    };
                    const engineSelect = document.getElementById('ttsEngine');
                    if (engineSelect) {
                        engineSelect.addEventListener('change', toggleMimoFields);
                        toggleMimoFields();
                    }
                    const styleSelect = document.getElementById('mimoStyle');
                    if (styleSelect) {
                        styleSelect.addEventListener('change', toggleMimoFields);
                    }

                    // Speed slider label
                    const speedSlider = document.getElementById('ttsSpeed');
                    const speedLabel = document.getElementById('ttsSpeedValue');
                    if (speedSlider && speedLabel) {
                        const updateSpeedLabel = () => {
                            const v = parseFloat(speedSlider.value);
                            let label;
                            if (v <= -6) label = '很慢';
                            else if (v <= -2) label = '慢速';
                            else if (v <= 2) label = '正常';
                            else if (v <= 6) label = '快速';
                            else label = '很快';
                            speedLabel.textContent = `${v} (${label})`;
                        };
                        speedSlider.addEventListener('input', updateSpeedLabel);
                        updateSpeedLabel();
                    }

                    const tempSlider = document.getElementById('llmTemperature');
                    const tempLabel = document.getElementById('llmTemperatureValue');
                    if (tempSlider && tempLabel) {
                        const updateTemp = () => { tempLabel.textContent = parseFloat(tempSlider.value).toFixed(1); };
                        tempSlider.addEventListener('input', updateTemp);
                        updateTemp();
                    }

                    const topPSlider = document.getElementById('llmTopP');
                    const topPLabel = document.getElementById('llmTopPValue');
                    if (topPSlider && topPLabel) {
                        const updateTopP = () => { topPLabel.textContent = parseFloat(topPSlider.value).toFixed(1); };
                        topPSlider.addEventListener('input', updateTopP);
                        updateTopP();
                    }

                    const providerSelect = document.getElementById('llmProvider');
                    if (providerSelect) {
                        const updateProviderFields = () => {
                            const pk = providerSelect.value;
                            const p = this.LLM_PROVIDERS[pk] || this.LLM_PROVIDERS.zhipu;
                            const apiBaseInput = document.getElementById('llmApiBase');
                            if (apiBaseInput) apiBaseInput.placeholder = p.baseUrl || '请输入API地址（必填）';
                            const modelHint = document.getElementById('llmModelHint');
                            if (modelHint) modelHint.textContent = p.defaultModel ? '默认: ' + p.defaultModel : '必填';
                            const wsCb = document.getElementById('llmWebSearch');
                            const wsHint = document.getElementById('llmWebSearchHint');
                            if (wsCb) { wsCb.disabled = !p.webSearch; if (!p.webSearch) wsCb.checked = false; }
                            if (wsHint) wsHint.style.display = p.webSearch ? 'none' : 'inline';
                        };
                        providerSelect.addEventListener('change', updateProviderFields);
                        updateProviderFields();
                    }
                }

                async loadSettingsData() {
                    try {
                        const settings = await this.db.getAllSettings();
                        const setCheckbox = (id, value) => {
                            const el = document.getElementById(id);
                            if (el) el.checked = value !== undefined ? value : el.checked;
                        };
                        const setSelect = (id, value) => {
                            const el = document.getElementById(id);
                            if (el && value) el.value = value;
                        };
                        const setInputValue = (id, value) => {
                            const el = document.getElementById(id);
                            if (el) el.value = value || '';
                        };
                        setCheckbox('autoPlaySound', settings.autoPlaySound);
                        setCheckbox('showPhonetic', settings.showPhonetic);
                        setCheckbox('autoNextWord', settings.autoNextWord);
                        setSelect('theme', settings.theme);
                        setSelect('fontSize', settings.fontSize);
                        setInputValue('mwDictKey', settings.mwDictKey);
                        setInputValue('mwThesKey', settings.mwThesKey);
                        setSelect('ttsEngine', settings.ttsEngine || 'system');
                        const ttsEngineEl = document.getElementById('ttsEngine');
                        if (ttsEngineEl) ttsEngineEl.dispatchEvent(new Event('change'));
                        setInputValue('mimoApiKey', settings.mimoApiKey);
                        setSelect('mimoVoice', settings.mimoVoice || 'mimo_default');
                        setSelect('mimoStyle', settings.mimoStyle || 'standard');
                        setInputValue('mimoStyleCustom', settings.mimoStyleCustom || '');
                        const loadedStyleSel = document.getElementById('mimoStyle');
                        if (loadedStyleSel) loadedStyleSel.dispatchEvent(new Event('change'));
                        this.mimoConfig = {
                            engine: settings.ttsEngine || 'system',
                            apiKey: settings.mimoApiKey || '',
                            voice: settings.mimoVoice || 'mimo_default',
                            style: settings.mimoStyle || 'standard',
                            styleCustom: settings.mimoStyleCustom || ''
                        };
                        this._savedSpeaker = settings.ttsSpeaker || '';
                        setSelect('ttsVoice', settings.ttsVoice);
                        setSelect('sentenceTtsEngine', settings.sentenceTtsEngine || 'auto');
                        if (settings.ttsSpeed != null) {
                            const el = document.getElementById('ttsSpeed');
                            if (el) el.value = settings.ttsSpeed;
                        }
                        setSelect('llmProvider', settings.llmProvider || 'zhipu');
                        setInputValue('llmApiBase', settings.llmApiBase || '');
                        setInputValue('llmApiKey', settings.llmApiKey);
                        const promptEl = document.getElementById('llmPrompt');
                        if (promptEl) promptEl.value = settings.llmPrompt || this.AI_DEFAULT_PROMPT;
                        setInputValue('llmModel', settings.llmModel || '');
                        const wsEl = document.getElementById('llmWebSearch');
                        if (wsEl && settings.llmWebSearch != null) {
                            wsEl.checked = settings.llmWebSearch;
                        }
                        const providerEl = document.getElementById('llmProvider');
                        if (providerEl) providerEl.dispatchEvent(new Event('change'));
                        if (settings.llmTemperature != null) {
                            const el = document.getElementById('llmTemperature');
                            if (el) el.value = settings.llmTemperature;
                        }
                        if (settings.llmTopP != null) {
                            const el = document.getElementById('llmTopP');
                            if (el) el.value = settings.llmTopP;
                        }
                        // FSRS-6 参数
                        const retention = parseFloat(settings.fsrsRequestRetention);
                        setSelect('fsrsRetention', Number.isFinite(retention) ? String(retention) : '0.9');
                        const paramsEl = document.getElementById('fsrsParams');
                        if (paramsEl) {
                            const current = this.db.getSrsParams();
                            const custom = this.db.parseSrsParams(settings.fsrsParams);
                            const shown = custom || current.w || [];
                            paramsEl.value = shown.join(', ');
                        }
                        await this.updateReviewLogCount();
                        this.applyTheme(settings.theme || 'light');
                        this.applyFontSize(settings.fontSize || 'medium');
                    } catch (error) {
                        console.error('加载设置数据失败:', error);
                    }
                }

                async saveSettings() {
                    try {
                        const getCheckbox = (id) => document.getElementById(id)?.checked;
                        const getSelect = (id) => document.getElementById(id)?.value;
                        const getInputValue = (id) => document.getElementById(id)?.value;
                        const settings = {
                            autoPlaySound: getCheckbox('autoPlaySound'),
                            showPhonetic: getCheckbox('showPhonetic'),
                            autoNextWord: getCheckbox('autoNextWord'),
                            theme: getSelect('theme'),
                            fontSize: getSelect('fontSize'),
                            mwDictKey: getInputValue('mwDictKey'),
                            mwThesKey: getInputValue('mwThesKey'),
                            ttsVoice: getSelect('ttsVoice'),
                            ttsSpeaker: getInputValue('ttsSpeaker'),
                            ttsSpeed: parseFloat(getInputValue('ttsSpeed')) || 0,
                            ttsEngine: getSelect('ttsEngine') || 'system',
                            mimoApiKey: getInputValue('mimoApiKey'),
                            mimoVoice: getSelect('mimoVoice') || 'mimo_default',
                            mimoStyle: getSelect('mimoStyle') || 'standard',
                            mimoStyleCustom: getInputValue('mimoStyleCustom') || '',
                            sentenceTtsEngine: getSelect('sentenceTtsEngine') || 'auto',
                            llmProvider: getSelect('llmProvider') || 'zhipu',
                            llmApiBase: (getInputValue('llmApiBase') || '').trim(),
                            llmApiKey: getInputValue('llmApiKey'),
                            llmPrompt: getInputValue('llmPrompt'),
                            llmModel: (getInputValue('llmModel') || '').trim(),
                            llmWebSearch: document.getElementById('llmWebSearch')?.checked ?? true,
                            llmTemperature: parseFloat(getInputValue('llmTemperature')) || 0.7,
                            llmTopP: parseFloat(getInputValue('llmTopP')) || 0.9,
                            fsrsRequestRetention: parseFloat(getSelect('fsrsRetention')) || 0.9
                        };
                        const paramsText = (getInputValue('fsrsParams') || '').trim();
                        let paramsValid = true;
                        if (paramsText) {
                            const parsed = this.db.parseSrsParams(paramsText);
                            if (!parsed) {
                                paramsValid = false;
                                this.showNotification('FSRS 参数无效（需至少 19 个数字），已保留原参数', 'error');
                            } else {
                                settings.fsrsParams = JSON.stringify(parsed);
                            }
                        } else {
                            settings.fsrsParams = '';
                        }
                        for (const [key, value] of Object.entries(settings)) {
                            if (key === 'fsrsParams' && !paramsValid) continue;
                            await this.db.saveSetting(key, value);
                        }
                        await this.db.loadSrsConfig();
                        this.mimoConfig = {
                            engine: settings.ttsEngine || 'system',
                            apiKey: settings.mimoApiKey || '',
                            voice: settings.mimoVoice || 'mimo_default',
                            style: settings.mimoStyle || 'standard',
                            styleCustom: settings.mimoStyleCustom || ''
                        };
                        this.showNotification('设置已保存', 'success');
                        this.applyTheme(settings.theme);
                        this.applyFontSize(settings.fontSize);
                    } catch (error) {
                        console.error('保存设置失败:', error);
                        this.showNotification('保存设置失败', 'error');
                    }
                }

                // ===== FSRS-6 参数与复习日志 =====
                async applyFsrsParams() {
                    const el = document.getElementById('fsrsParams');
                    const statusEl = document.getElementById('fsrsParamsStatus');
                    const raw = (el?.value || '').trim();
                    try {
                        if (!raw) {
                            await this.db.saveSetting('fsrsParams', '');
                            await this.db.loadSrsConfig();
                            if (statusEl) statusEl.textContent = '已恢复官方默认参数';
                            this.showNotification('已恢复官方默认参数', 'success');
                            this.refreshFsrsParamsField();
                            return;
                        }
                        const parsed = this.db.parseSrsParams(raw);
                        if (!parsed) {
                            if (statusEl) statusEl.textContent = '参数无效：需要至少 19 个数字';
                            this.showNotification('FSRS 参数无效，请输入至少 19 个数字', 'error');
                            return;
                        }
                        await this.db.saveSetting('fsrsParams', JSON.stringify(parsed));
                        await this.db.loadSrsConfig();
                        if (statusEl) statusEl.textContent = `已应用 ${parsed.length} 个参数`;
                        this.showNotification('FSRS 参数已应用', 'success');
                        this.refreshFsrsParamsField();
                    } catch (error) {
                        console.error('应用 FSRS 参数失败:', error);
                        this.showNotification('应用 FSRS 参数失败', 'error');
                    }
                }

                async resetFsrsParams() {
                    try {
                        await this.db.saveSetting('fsrsParams', '');
                        await this.db.loadSrsConfig();
                        this.refreshFsrsParamsField();
                        const statusEl = document.getElementById('fsrsParamsStatus');
                        if (statusEl) statusEl.textContent = '已恢复官方默认参数';
                        this.showNotification('已恢复官方默认参数', 'success');
                    } catch (error) {
                        console.error('恢复默认参数失败:', error);
                        this.showNotification('恢复默认参数失败', 'error');
                    }
                }

                refreshFsrsParamsField() {
                    const el = document.getElementById('fsrsParams');
                    if (!el) return;
                    const current = this.db.getSrsParams();
                    el.value = (current.w || []).join(', ');
                }

                async updateReviewLogCount() {
                    const el = document.getElementById('reviewLogCount');
                    if (!el) return;
                    try {
                        const count = await this.db.getReviewLogCount();
                        el.textContent = `${count} 条`;
                    } catch (error) {
                        el.textContent = '读取失败';
                    }
                }

                async exportReviewLog() {
                    try {
                        const logs = await this.db.getReviewLogs();
                        if (!logs.length) {
                            this.showNotification('暂无复习日志', 'warning');
                            return;
                        }
                        const csv = this.db.exportReviewLogCsv(logs);
                        const filename = `fsrs-review-log-${new Date().toISOString().split('T')[0]}.csv`;
                        if (typeof Android !== 'undefined' && Android.saveFile) {
                            Android.saveFile(filename, csv);
                        } else {
                            const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = filename;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                        }
                        this.showNotification(`已导出 ${logs.length} 条复习日志`, 'success');
                    } catch (error) {
                        console.error('导出复习日志失败:', error);
                        this.showNotification('导出复习日志失败', 'error');
                    }
                }

                async clearReviewLog() {
                    if (!confirm('确定清空复习日志吗？清空后将无法再用于参数优化。')) return;
                    try {
                        await this.db.clearReviewLogs();
                        await this.updateReviewLogCount();
                        this.showNotification('复习日志已清空', 'success');
                    } catch (error) {
                        console.error('清空复习日志失败:', error);
                        this.showNotification('清空复习日志失败', 'error');
                    }
                }

                applyTheme(theme) {
                    document.body.classList.remove('theme-light', 'theme-dark');
                    if (theme === 'dark') {
                        document.body.classList.add('theme-dark');
                    } else if (theme === 'light') {
                        document.body.classList.add('theme-light');
                    } else if (theme === 'auto') {
                        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                            document.body.classList.add('theme-dark');
                        } else {
                            document.body.classList.add('theme-light');
                        }
                    }
                }

                applyFontSize(size) {
                    const sizes = {
                        small: '14px',
                        medium: '16px',
                        large: '18px'
                    };
                    document.documentElement.style.fontSize = sizes[size] || '16px';
                }

                async exportData() {
                    try {
                        this.showLoader('正在导出数据...');
                        const allWords = await this.db.getAllWords();
                        const newWords = await this.db.getNewWords();
                        const plan = await this.db.getDailyPlan();
                        const settings = await this.db.getAllSettings();
                        const stats = await this.db.getLearningStats(365);
                        const wordLists = await this.db.getWordLists();
                        const allProgress = await new Promise((resolve) => {
                            const tx = this.db.db.transaction(['user_progress'], 'readonly');
                            const store = tx.objectStore('user_progress');
                            const req = store.getAll();
                            req.onsuccess = () => resolve(req.result || []);
                        });
                        const allHistory = await new Promise((resolve) => {
                            const tx = this.db.db.transaction(['learning_history'], 'readonly');
                            const store = tx.objectStore('learning_history');
                            const req = store.getAll();
                            req.onsuccess = () => resolve(req.result || []);
                        });
                        const allArticles = await new Promise((resolve) => {
                            const tx = this.db.db.transaction(['novels'], 'readonly');
                            const store = tx.objectStore('novels');
                            const req = store.getAll();
                            req.onsuccess = () => resolve(req.result || []);
                        });
                        const allWordCache = await this.db.getAllWordCache();
                        const allReviewLogs = await this.db.getReviewLogs();
                        const exportData = {
                            version: '3.3',
                            exportDate: new Date().toISOString(),
                            words: allWords,
                            newWords: newWords.map(w => ({ wordId: w.id, addedAt: w.addedAt })),
                            wordLists: wordLists,
                            userProgress: allProgress,
                            learningHistory: allHistory,
                            novels: allArticles,
                            wordCache: allWordCache,
                            reviewLog: allReviewLogs,
                            plan: plan,
                            settings: settings,
                            stats: stats
                        };
                        const dataStr = JSON.stringify(exportData, null, 2);
                        const filename = `word-learner-backup-${new Date().toISOString().split('T')[0]}.json`;
                        if (typeof Android !== 'undefined' && Android.saveFile) {
                            Android.saveFile(filename, dataStr);
                        } else {
                            const dataBlob = new Blob([dataStr], { type: 'application/json' });
                            const url = URL.createObjectURL(dataBlob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = filename;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                        }
                        this.hideLoader();
                        this.showNotification('数据导出成功', 'success');
                    } catch (error) {
                        console.error('导出数据失败:', error);
                        this.hideLoader();
                        this.showNotification('导出数据失败', 'error');
                    }
                }

                async importAiCache(file) {
                    if (!file) return;
                    const statusEl = document.getElementById('aiCacheImportStatus');
                    const cancelEl = document.getElementById('cancelAiCacheImport');
                    const setStatus = (text, isError = false) => {
                        if (statusEl) {
                            statusEl.textContent = text;
                            statusEl.style.color = isError ? 'var(--danger-color)' : 'var(--gray-color)';
                        }
                    };
                    const overwrite = document.getElementById('aiCacheOverwrite')?.checked;
                    setStatus('读取文件中…');
                    let text;
                    try {
                        text = await file.text();
                    } catch (err) {
                        setStatus('读取失败：' + (err && err.message || err), true);
                        return;
                    }
                    let entries;
                    try {
                        entries = this.parseAiCacheFile(text, file.name);
                    } catch (err) {
                        setStatus('解析失败：' + (err && err.message || err), true);
                        return;
                    }
                    if (!entries.length) {
                        setStatus('文件中没有可用的 AI 释义词条', true);
                        return;
                    }
                    const controller = new AbortController();
                    this._aiCacheAbort = controller;
                    cancelEl?.setAttribute('style', '');
                    setStatus(`解析到 ${entries.length} 条，开始写入…`);
                    try {
                        const res = await this.db.importAiCache(entries, {
                            overwrite,
                            signal: controller.signal,
                            batchSize: 200,
                            onProgress: (p) => setStatus(`已处理 ${p.processed}/${p.total}：写入 ${p.imported}，跳过已有 ${p.skipped}${p.aborted ? '（已取消）' : ''}`),
                        });
                        let msg = `导入完成：共 ${res.total} 条，写入 ${res.imported}，跳过已有 ${res.skipped}`;
                        if (res.invalid) msg += `，无效 ${res.invalid}`;
                        if (res.failed) msg += `，失败 ${res.failed}`;
                        if (res.aborted) msg += '（已中止/取消）';
                        setStatus(msg, res.failed && !res.imported ? true : false);
                        if (res.imported) {
                            this.refreshLookupModalCacheButtons();
                        }
                    } catch (err) {
                        setStatus('导入失败：' + (err && err.message || err), true);
                    } finally {
                        this._aiCacheAbort = null;
                        cancelEl?.setAttribute('style', 'display: none;');
                    }
                }

                parseAiCacheFile(text, name) {
                    const trimmed = (text || '').trim();
                    if (!trimmed) return [];
                    let parsed;
                    try {
                        parsed = JSON.parse(trimmed);
                    } catch (e) {
                        return this.parseAiCacheLines(text);
                    }
                    if (Array.isArray(parsed)) return parsed.map((e) => this.normalizeAiCacheEntry(e)).filter(Boolean);
                    if (parsed && parsed.items && Array.isArray(parsed.items)) {
                        return parsed.items.map((e) => this.normalizeAiCacheEntry(e)).filter(Boolean);
                    }
                    if (parsed && typeof parsed === 'object' && (parsed.word || parsed.content || parsed.ai)) {
                        const e = this.normalizeAiCacheEntry(parsed);
                        return e ? [e] : [];
                    }
                    if (parsed && typeof parsed === 'object') {
                        const out = [];
                        for (const k of Object.keys(parsed)) {
                            const v = parsed[k];
                            const e = this.normalizeAiCacheEntry(
                                (v && typeof v === 'object' && !Array.isArray(v))
                                    ? { ...v, word: k }
                                    : { word: k, content: typeof v === 'string' ? v : JSON.stringify(v) }
                            );
                            if (e) out.push(e);
                        }
                        return out;
                    }
                    return [];
                }

                parseAiCacheLines(text) {
                    const out = [];
                    for (const raw of (text || '').split(/\r?\n/)) {
                        const line = raw.trim();
                        if (!line) continue;
                        let obj;
                        try {
                            obj = JSON.parse(line);
                        } catch {
                            obj = null;
                        }
                        if (obj) {
                            const e = this.normalizeAiCacheEntry(obj);
                            if (e) out.push(e);
                        } else {
                            const parts = line.split(/\t/);
                            if (parts.length >= 2) {
                                const e = this.normalizeAiCacheEntry({ word: parts[0].trim(), content: parts.slice(1).join('\t').trim() });
                                if (e) out.push(e);
                            }
                        }
                    }
                    return out;
                }

                normalizeAiCacheEntry(entry) {
                    if (!entry || typeof entry !== 'object') return null;
                    const word = String(entry.word || entry.w || '').trim();
                    let content = entry.content ?? entry.text ?? (entry.ai && entry.ai.content) ?? entry.ai ?? entry.meaning ?? '';
                    if (typeof content !== 'string') content = JSON.stringify(content);
                    content = content.trim();
                    if (!word || /\s/.test(word)) return null;
                    if (!content || content.length < 10) return null;
                    content = this.normalizeAiMarkdown(content);
                    return { word, content, cachedAt: entry.cachedAt || undefined };
                }

                // ===== ECDICT 外部词典导入 / 查询 =====
                async refreshEcdictSettings() {
                    const statusEl = document.getElementById('ecdictStatus');
                    if (!statusEl) return;
                    const importBtn = document.getElementById('importEcdictBtn');
                    const deleteBtn = document.getElementById('deleteEcdictBtn');
                    const cancelBtn = document.getElementById('cancelEcdictImport');
                    const progressWrap = document.getElementById('ecdictProgressWrap');
                    const progressBar = document.getElementById('ecdictProgressBar');
                    const setStatus = (text, isError = false) => {
                        statusEl.textContent = text;
                        statusEl.style.color = isError ? 'var(--danger-color)' : 'var(--gray-color)';
                    };

                    if (this._ecdictImporting) {
                        setStatus(this._ecdictStatusText || '正在导入 ECDICT…');
                        if (importBtn) importBtn.disabled = true;
                        if (deleteBtn) deleteBtn.style.display = 'none';
                        if (cancelBtn) cancelBtn.style.display = '';
                        if (progressWrap) progressWrap.style.display = 'block';
                        if (progressBar) progressBar.style.width = (this._ecdictProgressPct || 0) + '%';
                        return;
                    }

                    if (importBtn) importBtn.disabled = false;
                    if (cancelBtn) cancelBtn.style.display = 'none';
                    if (progressWrap) progressWrap.style.display = 'none';
                    if (progressBar) progressBar.style.width = '0%';

                    let meta = null;
                    try { meta = await this.db.getEcdictMeta(); } catch (e) { meta = null; }
                    if (meta && meta.status === 'ready') {
                        const count = Number(meta.count || 0).toLocaleString('zh-CN');
                        const date = meta.importedAt ? this.formatCacheDate(meta.importedAt) : '';
                        setStatus(`已安装 ${count} 词条${date ? ' · ' + date : ''}`);
                        if (importBtn) importBtn.innerHTML = '<i class="fas fa-sync-alt"></i> 重新导入';
                        if (deleteBtn) deleteBtn.style.display = '';
                    } else if (meta && meta.status === 'incomplete') {
                        const count = Number(meta.count || 0).toLocaleString('zh-CN');
                        setStatus(`导入未完成（已写入 ${count} 条），请重新导入`, true);
                        if (importBtn) importBtn.innerHTML = '<i class="fas fa-sync-alt"></i> 重新导入';
                        if (deleteBtn) deleteBtn.style.display = '';
                    } else {
                        setStatus('未安装 · 全量约 63MB，导入后约 150MB');
                        if (importBtn) importBtn.innerHTML = '<i class="fas fa-book-open"></i> 导入';
                        if (deleteBtn) deleteBtn.style.display = 'none';
                    }
                }

                async importEcdict(file) {
                    if (!file || this._ecdictImporting || this._ecdictStarting) return;
                    if (typeof Worker === 'undefined') {
                        this.showNotification('当前浏览器不支持 Web Worker，无法导入 ECDICT', 'error');
                        return;
                    }

                    // 防止确认/存储检查期间重复触发导入，导致两个 Worker 同时写库
                    this._ecdictStarting = true;
                    try {
                        let existing = null;
                        try { existing = await this.db.getEcdictMeta(); } catch (e) { existing = null; }
                        if (existing && existing.status === 'ready') {
                            if (!confirm(`已安装 ECDICT（${Number(existing.count || 0).toLocaleString('zh-CN')} 词条）。重新导入会覆盖现有词典，是否继续？`)) return;
                        } else if (existing && existing.status === 'incomplete') {
                            if (!confirm('上次导入未完成。重新导入会清空已写入的部分并重新开始，是否继续？')) return;
                        } else if (!confirm('导入 ECDICT 全量词典？\n\nCSV 约 63MB，导入后占用约 150MB，仅保存在本机，不进入学习数据备份。')) {
                            return;
                        }

                        try {
                            if (navigator.storage && navigator.storage.estimate) {
                                const estimate = await navigator.storage.estimate();
                                const free = (estimate.quota || 0) - (estimate.usage || 0);
                                if (estimate.quota && free < 300 * 1024 * 1024) {
                                    const freeMB = Math.max(0, Math.round(free / 1024 / 1024));
                                    if (!confirm(`当前浏览器可用存储约 ${freeMB}MB，建议至少 300MB。继续导入可能导致失败，是否仍要继续？`)) return;
                                }
                            }
                            if (navigator.storage && navigator.storage.persist) {
                                // 不阻塞导入：部分浏览器会等待用户手势，导致 persist() 长时间不返回
                                Promise.resolve(navigator.storage.persist()).catch(() => {});
                            }
                        } catch (e) {
                            console.warn('ECDICT 存储空间检查失败:', e);
                        }

                        // 先校验表头，避免选错文件时把已安装的词典清空
                        let headerLine = '';
                        try {
                            headerLine = await file.slice(0, 4096).text();
                        } catch (e) {
                            headerLine = '';
                        }
                        const headerFields = (headerLine.split(/\r?\n/, 1)[0] || '')
                            .replace(/^\uFEFF/, '')
                            .split(',');
                        if (headerFields.length < 13 || (headerFields[0] || '').trim().toLowerCase() !== 'word') {
                            this.showNotification('不是有效的 ECDICT CSV（缺少 word 列或列数不足）', 'error');
                            return;
                        }
                    } finally {
                        this._ecdictStarting = false;
                    }

                    this._ecdictImporting = true;
                    this._ecdictCancelled = false;
                    this._ecdictStatusText = '准备导入…';
                    this._ecdictProgressPct = 0;
                    this._ecdictImportedRows = 0;
                    await this.refreshEcdictSettings();

                    try {
                        await this.db.clearEcdict();
                        await this.db.saveEcdictMeta({
                            status: 'importing',
                            count: 0,
                            startedAt: new Date().toISOString(),
                            source: file.name || 'ecdict.csv'
                        });
                    } catch (err) {
                        this._ecdictImporting = false;
                        this._ecdictStatusText = '';
                        this._ecdictProgressPct = 0;
                        await this.refreshEcdictSettings();
                        this.showNotification('ECDICT 导入失败：无法初始化数据库', 'error');
                        console.error(err);
                        return;
                    }

                    let worker;
                    try {
                        worker = new Worker('./js/ecdict-worker.js');
                    } catch (err) {
                        this._ecdictImporting = false;
                        this._ecdictStatusText = '';
                        this._ecdictProgressPct = 0;
                        await this.db.saveEcdictMeta({ status: 'incomplete', count: 0 }).catch(() => {});
                        await this.refreshEcdictSettings();
                        this.showNotification('ECDICT 导入失败：无法启动解析 Worker', 'error');
                        console.error(err);
                        return;
                    }
                    this._ecdictWorker = worker;
                    let lastUiUpdate = 0;

                    const cleanupWorker = () => {
                        try { worker.terminate(); } catch (e) {}
                        if (this._ecdictWorker === worker) this._ecdictWorker = null;
                    };

                    const failImport = async (message, error) => {
                        if (!this._ecdictImporting) return;
                        this._ecdictImporting = false;
                        this._ecdictCancelled = false;
                        this._ecdictStatusText = '';
                        this._ecdictProgressPct = 0;
                        cleanupWorker();
                        if (error) console.error(error);
                        const count = await this.db.getEcdictCount().catch(() => 0);
                        await this.db.saveEcdictMeta({
                            status: 'incomplete',
                            count,
                            importedAt: new Date().toISOString(),
                            source: file.name || 'ecdict.csv'
                        }).catch(() => {});
                        await this.refreshEcdictSettings();
                        this.showNotification(message, 'error');
                    };

                    worker.onmessage = async (event) => {
                        const msg = event.data || {};
                        if (msg.type === 'batch') {
                            if (this._ecdictCancelled) return;
                            try {
                                await this.db.importEcdictBatch(msg.records);
                            } catch (err) {
                                await failImport('ECDICT 写入失败：' + ((err && err.message) || err), err);
                                return;
                            }
                            if (this._ecdictCancelled) return;
                            const total = msg.total || file.size || 0;
                            const pct = total ? Math.min(99, Math.round((msg.loaded / total) * 100)) : 0;
                            this._ecdictProgressPct = pct;
                            this._ecdictImportedRows = msg.count || this._ecdictImportedRows;
                            this._ecdictStatusText = `正在导入 ${Number(this._ecdictImportedRows).toLocaleString('zh-CN')} 条（${pct}%）…`;
                            worker.postMessage({ type: 'ack' });
                            const now = Date.now();
                            if (now - lastUiUpdate > 200) {
                                lastUiUpdate = now;
                                await this.refreshEcdictSettings();
                            }
                            return;
                        }

                        if (msg.type === 'done') {
                            if (!this._ecdictImporting || this._ecdictCancelled) return;
                            cleanupWorker();
                            const count = await this.db.getEcdictCount().catch(() => msg.count || 0);
                            const skipped = Number(msg.skipped || 0);
                            await this.db.saveEcdictMeta({
                                status: 'ready',
                                count,
                                importedAt: new Date().toISOString(),
                                source: file.name || 'ecdict.csv',
                                schema: 1
                            }).catch((err) => console.warn('ECDICT 元数据写入失败:', err));
                            this._ecdictImporting = false;
                            this._ecdictStatusText = '';
                            this._ecdictProgressPct = 100;
                            await this.refreshEcdictSettings();
                            await this.refreshLookupModalEcdictButton();
                            this.showNotification(
                                `ECDICT 导入完成：${Number(count).toLocaleString('zh-CN')} 词条` + (skipped ? `（跳过 ${skipped} 行）` : ''),
                                'success'
                            );
                            return;
                        }

                        if (msg.type === 'error') {
                            await failImport('ECDICT 导入失败：' + (msg.message || '解析错误'));
                        }
                    };

                    worker.onerror = (event) => {
                        failImport('ECDICT 导入失败：' + ((event && event.message) || 'Worker 运行错误'));
                    };

                    worker.postMessage({ type: 'start', file, batchSize: 1000 });
                }

                async cancelEcdictImport() {
                    if (!this._ecdictImporting) return;
                    this._ecdictCancelled = true;
                    this._ecdictImporting = false;
                    this._ecdictStatusText = '';
                    this._ecdictProgressPct = 0;
                    if (this._ecdictWorker) {
                        try { this._ecdictWorker.terminate(); } catch (e) {}
                        this._ecdictWorker = null;
                    }
                    const count = await this.db.getEcdictCount().catch(() => 0);
                    await this.db.saveEcdictMeta({
                        status: 'incomplete',
                        count,
                        importedAt: new Date().toISOString(),
                        source: 'ecdict.csv'
                    }).catch(() => {});
                    await this.refreshEcdictSettings();
                    this.showNotification('已取消 ECDICT 导入；已写入的部分保留，可删除或重新导入', 'info');
                }

                async deleteEcdict() {
                    if (this._ecdictImporting) {
                        this.showNotification('请先取消正在进行的 ECDICT 导入', 'warning');
                        return;
                    }
                    if (!confirm('删除已导入的 ECDICT 词典？\n\n学习数据、单词库和复习进度不受影响。')) return;
                    try {
                        await this.db.clearEcdict();
                        await this.refreshEcdictSettings();
                        await this.refreshLookupModalEcdictButton();
                        this.showNotification('ECDICT 词典已删除', 'success');
                    } catch (err) {
                        console.error('删除 ECDICT 失败:', err);
                        this.showNotification('删除 ECDICT 失败', 'error');
                    }
                }

                async refreshLookupModalEcdictButton() {
                    const btn = document.getElementById('lookupModalEcdictBtn');
                    if (!btn) return;
                    try {
                        const meta = await this.db.getEcdictMeta();
                        btn.style.display = (meta && meta.status === 'ready' && Number(meta.count) > 0) ? '' : 'none';
                    } catch (e) {
                        btn.style.display = 'none';
                    }
                }

                async lookupModalEcdict() {
                    const word = this.lookupModalWord;
                    const resultEl = document.getElementById('lookupModalEcdictResult');
                    if (!word || !resultEl) return;
                    resultEl.style.display = 'block';
                    resultEl.innerHTML = '<div class="mw-loading"><i class="fas fa-spinner fa-spin"></i> 正在查询 ECDICT…</div>';
                    const stillCurrent = () => this.lookupModalWord
                        && this.lookupModalWord.toLowerCase() === String(word).toLowerCase();
                    try {
                        const meta = await this.db.getEcdictMeta();
                        if (!stillCurrent()) return;
                        if (!meta || meta.status !== 'ready') {
                            resultEl.innerHTML = '<p class="empty-state">ECDICT 词典未安装或导入未完成，请先在设置中导入。</p>';
                            await this.refreshLookupModalEcdictButton();
                            return;
                        }
                        const entry = await this.db.getEcdictEntry(word);
                        if (!stillCurrent()) return;
                        if (!entry) {
                            resultEl.innerHTML = `<p class="empty-state">ECDICT 未收录「${this.escapeHtml(String(word))}」</p>`;
                            return;
                        }
                        const escAttr = (value) => this.escapeHtml(String(value)).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                        const html = (window.ecdict && window.ecdict.renderEntry)
                            ? window.ecdict.renderEntry(entry, { esc: (value) => this.escapeHtml(String(value)), escAttr })
                            : '';
                        resultEl.innerHTML = html || '<p class="empty-state">ECDICT 词条解析失败</p>';
                        resultEl.querySelectorAll('.ecdict-en-text').forEach((node) => this.makeClickable(node));
                        resultEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    } catch (err) {
                        console.error('ECDICT 查询失败:', err);
                        resultEl.innerHTML = '<p class="mw-error">ECDICT 查询失败，请重试</p>';
                    }
                }

                async importData(file) {
                    if (!file) return;
                    if (!confirm('导入数据将覆盖当前所有学习数据，是否继续？')) return;
                    if (!confirm('⚠️ 警告：此操作将删除所有现有学习数据（包括单词、进度、生词本等），外部 ECDICT 词典会保留。确定要继续吗？')) return;

                    try {
                        this.showLoader('正在读取文件...');
                        const text = await file.text();
                        const importData = JSON.parse(text);

                        if (!importData.words || !Array.isArray(importData.words)) {
                            throw new Error('数据格式不正确：缺少 words 数组');
                        }

                        this.showLoader('正在清空旧数据...');
                        await this.db.clearUserData();

                        const listIdMap = {};
                        if (importData.wordLists && importData.wordLists.length > 0) {
                            this.showLoader(`正在导入 ${importData.wordLists.length} 个单词库...`);
                            for (const oldList of importData.wordLists) {
                                const existing = await this.db.getWordLists();
                                const found = existing.find(l => l.name === oldList.name);
                                let newId;
                                if (found) {
                                    newId = found.id;
                                } else {
                                    newId = await this.db.createWordList(oldList.name, oldList.description || '');
                                }
                                listIdMap[oldList.id] = newId;
                            }
                        }

                        const words = importData.words || [];
                        const totalWords = words.length;
                        const BATCH_SIZE = 5000;
                        const wordIdMap = {};

                        for (let i = 0; i < totalWords; i += BATCH_SIZE) {
                            const batch = words.slice(i, i + BATCH_SIZE);
                            const batchEnd = Math.min(i + BATCH_SIZE, totalWords);
                            this.showLoader(`正在导入单词 ${i + 1} ~ ${batchEnd} / ${totalWords} ...`);

                            const transaction = this.db.db.transaction(['words'], 'readwrite');
                            const store = transaction.objectStore('words');
                            
                            const addPromises = batch.map((oldWord) => {
                                return new Promise((resolve, reject) => {
                                    let newListId = null;
                                    if (oldWord.listId && listIdMap[oldWord.listId]) {
                                        newListId = listIdMap[oldWord.listId];
                                    }
                                    const newWord = {
                                        word: oldWord.word,
                                        difficulty: oldWord.difficulty || 3,
                                        phonetic: oldWord.phonetic || '',
                                        meaning: oldWord.meaning || '',
                                        example: oldWord.example || '',
                                        source: oldWord.source || 'import',
                                        listId: newListId,
                                        novelName: oldWord.novelName || '',
                                        createdAt: oldWord.createdAt || new Date().toISOString(),
                                        lastReviewed: oldWord.lastReviewed || null,
                                        reviewCount: oldWord.reviewCount || 0
                                    };
                                    const request = store.add(newWord);
                                    request.onsuccess = () => resolve({ oldId: oldWord.id, newId: request.result });
                                    request.onerror = () => reject(request.error);
                                });
                            });

                            const results = await Promise.all(addPromises);
                            results.forEach(({ oldId, newId }) => {
                                wordIdMap[oldId] = newId;
                            });
                        }

                        const allLists = await this.db.getWordLists();
                        for (const list of allLists) {
                            await this.db.updateWordListWordCount(list.id);
                        }

                        if (importData.newWords && importData.newWords.length > 0) {
                            this.showLoader(`正在导入生词本...`);
                            const newWords = importData.newWords;
                            const BATCH_SIZE_SMALL = 10000;
                            for (let i = 0; i < newWords.length; i += BATCH_SIZE_SMALL) {
                                const batch = newWords.slice(i, i + BATCH_SIZE_SMALL);
                                const transaction = this.db.db.transaction(['new_words'], 'readwrite');
                                const store = transaction.objectStore('new_words');
                                for (const item of batch) {
                                    const newId = wordIdMap[item.wordId];
                                    if (newId) {
                                        store.add({ wordId: newId, addedAt: item.addedAt || new Date().toISOString() });
                                    }
                                }
                                await new Promise((resolve, reject) => {
                                    transaction.oncomplete = resolve;
                                    transaction.onerror = () => reject(transaction.error);
                                });
                            }
                        }

                        if (importData.userProgress && importData.userProgress.length > 0) {
                            this.showLoader(`正在导入学习进度...`);
                            const progresses = importData.userProgress;
                            const BATCH_SIZE_SMALL = 10000;
                            for (let i = 0; i < progresses.length; i += BATCH_SIZE_SMALL) {
                                const batch = progresses.slice(i, i + BATCH_SIZE_SMALL);
                                const transaction = this.db.db.transaction(['user_progress'], 'readwrite');
                                const store = transaction.objectStore('user_progress');
                                for (const progress of batch) {
                                    const newId = wordIdMap[progress.wordId];
                                    if (newId) {
                                        const record = { ...progress, wordId: newId };
                                        delete record.id;
                                        if (!record.nextReview) record.nextReview = new Date().toISOString();
                                        if (!record.lastReview) record.lastReview = record.nextReview;
                                        if (record.familiarity == null) record.familiarity = 0;
                                        if (record.totalReviews == null) record.totalReviews = 0;
                                        store.put(record);
                                    }
                                }
                                await new Promise((resolve, reject) => {
                                    transaction.oncomplete = resolve;
                                    transaction.onerror = () => reject(transaction.error);
                                });
                            }
                        }

                        if (importData.learningHistory && importData.learningHistory.length > 0) {
                            this.showLoader(`正在导入学习历史...`);
                            const histories = importData.learningHistory;
                            const BATCH_SIZE_SMALL = 10000;
                            for (let i = 0; i < histories.length; i += BATCH_SIZE_SMALL) {
                                const batch = histories.slice(i, i + BATCH_SIZE_SMALL);
                                const transaction = this.db.db.transaction(['learning_history'], 'readwrite');
                                const store = transaction.objectStore('learning_history');
                                for (const history of batch) {
                                    const newId = wordIdMap[history.wordId];
                                    if (newId) {
                                        store.add({
                                            wordId: newId,
                                            date: history.date || new Date().toISOString(),
                                            correct: history.correct
                                        });
                                    }
                                }
                                await new Promise((resolve, reject) => {
                                    transaction.oncomplete = resolve;
                                    transaction.onerror = () => reject(transaction.error);
                                });
                            }
                        }

                        if (importData.plan) {
                            await this.db.saveDailyPlan(importData.plan);
                        }
                        if (importData.settings) {
                            for (const [key, value] of Object.entries(importData.settings)) {
                                await this.db.saveSetting(key, value);
                            }
                        }

                        if (importData.novels && importData.novels.length > 0) {
                            this.showLoader(`正在导入文章...`);
                            for (const article of importData.novels) {
                                await this.db.saveArticle({
                                    title: article.title,
                                    content: article.content,
                                    format: article.format || 'txt',
                                    currentPosition: article.currentPosition || 0,
                                    wordCount: article.wordCount,
                                    createdAt: article.createdAt || new Date().toISOString(),
                                    updatedAt: article.updatedAt || new Date().toISOString()
                                });
                            }
                        }

                        if (importData.wordCache && importData.wordCache.length > 0) {
                            this.showLoader('正在导入 AI/词典缓存...');
                            await this.db.importWordCacheRecords(importData.wordCache, {
                                batchSize: 500,
                                onProgress: (p) => this.showLoader(`正在导入 AI/词典缓存 ${p.processed}/${p.total} ...`)
                            });
                        }

                        if (importData.reviewLog && importData.reviewLog.length > 0) {
                            this.showLoader('正在导入复习日志...');
                            const logResult = await this.db.importReviewLogs(importData.reviewLog);
                            console.log('复习日志导入完成:', logResult);
                        }

                        this.hideLoader();
                        this.showNotification(`成功导入 ${totalWords} 个单词！`, 'success');
                        setTimeout(() => location.reload(), 1500);
                    } catch (error) {
                        console.error('导入数据失败:', error);
                        this.hideLoader();
                        this.showNotification('导入失败: ' + error.message, 'error');
                    }
                }

                async clearAllData() {
                    if (!confirm('确定要清空所有数据吗？此操作不可恢复。')) return;
                    if (!confirm('再次确认：所有学习记录、单词、单词库、设置，以及已导入的 ECDICT 词典都将被删除？')) return;
                    if (this._ecdictWorker) {
                        try { this._ecdictWorker.terminate(); } catch (e) {}
                        this._ecdictWorker = null;
                    }
                    this._ecdictImporting = false;
                    this._ecdictCancelled = false;
                    try {
                        this.showLoader('正在清空数据...');
                        await this.db.clearAllData();
                        this.hideLoader();
                        this.showNotification('数据已清空，页面将刷新', 'success');
                        setTimeout(() => location.reload(), 1500);
                    } catch (error) {
                        console.error('清空数据失败:', error);
                        this.hideLoader();
                        this.showNotification('清空数据失败: ' + error.message, 'error');
                    }
                }

                async showDebugInfo() {
                    try {
                        const debugInfo = await this.db.debugDatabase();
                        const debugHTML = `
                            <div class="debug-modal" onclick="if(event.target===this)this.remove()">
                                <div class="debug-content">
                                    <h3>调试信息</h3>
                                    <div class="debug-section">
                                        <h4>数据库统计</h4>
                                        <p>总单词数: ${debugInfo.allWords.length}</p>
                                        <p>生词本单词数: ${debugInfo.newWords.length}</p>
                                        <p>需要复习的单词数: ${debugInfo.reviewWords.length}</p>
                                        <p>今日学习记录数: ${debugInfo.todayHistory.length}</p>
                                        <p>单词库数量: ${debugInfo.wordLists.length}</p>
                                    </div>
                                    <div class="debug-section">
                                        <h4>存储空间</h4>
                                        <p>浏览器: ${navigator.userAgent.slice(0, 50)}...</p>
                                        <p>在线状态: ${navigator.onLine ? '在线' : '离线'}</p>
                                    </div>
                                    <div class="debug-section">
                                        <h4>单词库列表</h4>
                                        <ul>
                                            ${debugInfo.wordLists.map(l => `<li>${l.name} (ID:${l.id}, ${l.wordCount}词)</li>`).join('')}
                                        </ul>
                                    </div>
                                    <div class="debug-section">
                                        <h4>最近添加的单词</h4>
                                        <ul>
                                            ${debugInfo.allWords.slice(0, 5).map(w => `<li>${w.word} (ID:${w.id}, 库:${w.listId || '无'})</li>`).join('')}
                                        </ul>
                                    </div>
                                    <button class="close-debug" onclick="this.closest('.debug-modal').remove()">关闭</button>
                                </div>
                            </div>
                        `;
                        document.querySelector('.debug-modal')?.remove();
                        document.body.insertAdjacentHTML('beforeend', debugHTML);
                    } catch (error) {
                        console.error('显示调试信息失败:', error);
                        this.showNotification('获取调试信息失败', 'error');
                    }
                }

                // ===== 统计页（FSRS 维度）=====
                async loadStatsPage() {
                    try {
                        const S = window.statsUtil;
                        if (!S) {
                            console.warn('统计模块未加载');
                            return;
                        }
                        const range = this._statsRange || 30;
                        const now = new Date();
                        const [progress, logs, words, lists, history, todayHistory, plan, retentionSetting] = await Promise.all([
                            this.db.getAllProgress(),
                            this.db.getReviewLogs(),
                            this.db.getAllWords(),
                            this.db.getWordLists(),
                            this.db.getAllLearningHistory(),
                            this.db.getTodayHistory(),
                            this.db.getDailyPlan(),
                            this.db.getSetting('fsrsRequestRetention')
                        ]);

                        // 只统计所选时间范围内的复习日志
                        const cutoff = now.getTime() - range * 86400000;
                        const rangeLogs = (logs || []).filter(log => {
                            const t = log && log.review ? new Date(log.review).getTime() : 0;
                            return t >= cutoff;
                        });

                        const progressAgg = S.aggregateProgress(progress || [], {
                            now,
                            fsrs: this.db.srs(),
                            cardFromProgress: (p, n) => this.db.cardFromProgress(p, n)
                        });
                        const forecast = S.forecastDue(progress || [], { now, days: 14 });
                        const logAgg = S.aggregateReviewLog(rangeLogs, { now });
                        const heat = S.activityHeatmap(history || [], { now, weeks: 26 });
                        const hour = S.hourlyHeatmap(rangeLogs);
                        const progressMap = new Map((progress || []).map(p => [p.wordId, p]));
                        const byList = S.aggregateByList(words || [], progressMap, lists || []);
                        const hard = S.hardWords(progress || [], { limit: 10, now });

                        // 学习量按北京时间分桶
                        const byDay = {};
                        for (const item of history || []) {
                            const key = S.dayKey(item.date);
                            if (!key) continue;
                            if (!byDay[key]) byDay[key] = { total: 0, correct: 0 };
                            byDay[key].total++;
                            if (item.correct) byDay[key].correct++;
                        }

                        this._statsData = { range, now, progressAgg, forecast, logAgg, heat, hour, byList, hard, byDay, words, progress };

                        const setText = (id, v) => {
                            const el = document.getElementById(id);
                            if (el) el.textContent = v;
                        };
                        setText('statToday', (todayHistory || []).length);
                        setText('statStudied', progressAgg.total);
                        setText('statStudiedHint', `共 ${(words || []).length} 个词`);
                        setText('statMatured', progressAgg.matured);
                        setText('statRetention', progressAgg.avgRetrievability != null
                            ? `${Math.round(progressAgg.avgRetrievability * 100)}%`
                            : '—');
                        setText('statRetentionHint', `目标 ${Math.round((retentionSetting || 0.9) * 100)}%`);
                        setText('statRecall', logAgg.recallRate != null
                            ? `${Math.round(logAgg.recallRate * 100)}%`
                            : '—');
                        setText('statRecallHint', `近 ${range} 天 · ${logAgg.total} 次复习`);
                        setText('statDue', forecast.days[0] ? forecast.days[0].count : 0);
                        setText('statDueHint', forecast.overdue > 0 ? `含积压 ${forecast.overdue} 个` : '无积压');

                        this.renderStatsStateDist(progressAgg);
                        this.renderStatsStability(progressAgg);
                        this.renderStatsForecast(forecast, plan);
                        this.renderStatsRecallCurve(logAgg, progressAgg);
                        this.renderStatsRatingDist(logAgg);
                        this.renderStatsDifficulty(logAgg);
                        this.renderStatsHardWords(hard, words);
                        this.renderStatsHourHeat(hour, range);
                        this.renderStatsActivityHeat(heat);
                        this.renderStatsByList(byList);
                        this.renderActivityChart(byDay, 30);
                        this.renderAccuracyTrend(byDay, 7);
                    } catch (error) {
                        console.error('加载统计页面失败:', error);
                        this.showNotification('加载统计数据失败', 'error');
                    }
                }

                // 记忆状态分布（New / Learning / Review / Relearning）
                renderStatsStateDist(agg) {
                    const el = document.getElementById('statsStateDist');
                    const hint = document.getElementById('statsStateHint');
                    if (!el) return;
                    const defs = [
                        { key: 'new', label: '新词', color: '#9E9E9E' },
                        { key: 'learning', label: '学习中', color: '#FF9800' },
                        { key: 'review', label: '复习中', color: '#4CAF50' },
                        { key: 'relearning', label: '重学中', color: '#F44336' }
                    ];
                    const total = agg.total || 0;
                    if (!total) {
                        el.innerHTML = '<p class="empty-state">暂无学习数据</p>';
                        if (hint) hint.textContent = '';
                        return;
                    }
                    const segments = defs.map(def => {
                        const count = agg.states[def.key] || 0;
                        const pct = total ? (count / total) * 100 : 0;
                        if (!count) return '';
                        return `<div class="state-seg" style="width:${pct}%;background:${def.color};" title="${def.label} ${count}">${pct >= 8 ? pct.toFixed(0) + '%' : ''}</div>`;
                    }).join('');
                    const legend = defs.map(def => {
                        const count = agg.states[def.key] || 0;
                        const pct = total ? Math.round((count / total) * 100) : 0;
                        return `<span><i style="background:${def.color};"></i>${def.label} ${count}（${pct}%）</span>`;
                    }).join('');
                    el.innerHTML = `<div class="state-bar">${segments}</div><div class="state-legend">${legend}</div>`;
                    if (hint) {
                        hint.textContent = `共 ${total} 个词进入学习；平均难度 ${agg.avgDifficulty.toFixed(1)}/10，平均遗忘 ${agg.avgLapses.toFixed(2)} 次，易忘词 ${agg.leeches} 个。`;
                    }
                }

                // 记忆稳定性分布
                renderStatsStability(agg) {
                    const el = document.getElementById('statsStability');
                    const hint = document.getElementById('statsStabilityHint');
                    if (!el) return;
                    const buckets = ['<7', '7-30', '30-90', '>90'];
                    const labels = { '<7': '不足 1 周', '7-30': '1-4 周', '30-90': '1-3 月', '>90': '3 月以上' };
                    const colors = ['#F44336', '#FF9800', '#2196F3', '#4CAF50'];
                    const max = Math.max(1, ...buckets.map(b => agg.stabilityBuckets[b] || 0));
                    el.innerHTML = buckets.map((b, i) => {
                        const count = agg.stabilityBuckets[b] || 0;
                        const pct = (count / max) * 100;
                        return `<div class="mastery-row">
                            <span class="mastery-label">${labels[b]}</span>
                            <div class="mastery-bar-track"><div class="mastery-bar-fill" style="width:${pct}%;background:${colors[i]};"></div></div>
                            <span class="mastery-count">${count}</span>
                        </div>`;
                    }).join('');
                    if (hint) {
                        const dist = Object.values(agg.retrievabilityBuckets).reduce((a, b) => a + b, 0);
                        const low = (agg.retrievabilityBuckets['<50%'] || 0) + (agg.retrievabilityBuckets['50-70%'] || 0);
                        hint.textContent = dist
                            ? `中位稳定性 ${agg.medianStability.toFixed(1)} 天；${low} 个词当前保持率低于 70%，建议今天优先复习。`
                            : '暂无复习阶段卡片，完成首次学习后即可看到稳定性分布。';
                    }
                }

                // 未来 14 天复习负荷
                renderStatsForecast(forecast, plan) {
                    const el = document.getElementById('statsForecast');
                    const hint = document.getElementById('statsForecastHint');
                    if (!el) return;
                    const max = Math.max(1, ...forecast.days.map(d => d.count));
                    const goal = (plan && plan.reviewGoal) || 0;
                    el.innerHTML = forecast.days.map(d => {
                        const pct = (d.count / max) * 100;
                        const over = goal > 0 && d.count > goal;
                        const label = `${d.date.getMonth() + 1}/${d.date.getDate()}`;
                        const color = over ? 'var(--danger-color)' : 'var(--secondary-color)';
                        return `<div class="activity-bar" title="${label}: ${d.count} 个${over ? '（超出每日复习目标）' : ''}">
                            <div class="activity-bar-fill" style="height:${pct}%;background:${color};"></div>
                            <span class="activity-bar-label">${label}</span>
                        </div>`;
                    }).join('');
                    if (hint) {
                        const total = forecast.total + forecast.overdue;
                        const avg = (forecast.total / Math.max(1, forecast.days.length)).toFixed(1);
                        hint.textContent = `未来 14 天共需复习 ${total} 个词，日均 ${avg} 个${goal ? `（每日目标 ${goal} 个）` : ''}${forecast.overdue ? `；另有 ${forecast.overdue} 个已过期待补` : ''}。`;
                    }
                }

                // 实际回忆率 vs FSRS 理论曲线
                renderStatsRecallCurve(logAgg, progressAgg) {
                    const el = document.getElementById('statsRecallCurve');
                    const hint = document.getElementById('statsRecallCurveHint');
                    if (!el) return;
                    const rows = logAgg.elapsedList || [];
                    if (!rows.some(r => r.total > 0)) {
                        el.innerHTML = '<p class="empty-state">暂无复习日志，积累后可分析实际回忆率</p>';
                        if (hint) hint.textContent = '';
                        return;
                    }
                    const fsrs = this.db.srs();
                    const stability = progressAgg.medianStability > 0 ? progressAgg.medianStability : 10;
                    const html = rows.map(row => {
                        if (!row.total) {
                            return `<div class="recall-row"><span class="recall-label">${row.bucket} 天</span>
                                <div class="recall-track"></div><span class="recall-value">无数据</span></div>`;
                        }
                        const rate = row.rate * 100;
                        const theory = row.avgElapsed > 0 && fsrs && typeof fsrs.forgetting_curve === 'function'
                            ? fsrs.forgetting_curve(row.avgElapsed, stability) * 100
                            : null;
                        const marker = theory != null
                            ? `<div class="recall-theory" style="left:${Math.min(100, Math.max(0, theory))}%;" title="FSRS 理论 ${theory.toFixed(0)}%"></div>`
                            : '';
                        return `<div class="recall-row">
                            <span class="recall-label">${row.bucket} 天</span>
                            <div class="recall-track">
                                <div class="recall-fill" style="width:${Math.min(100, rate)}%;"></div>
                                ${marker}
                            </div>
                            <span class="recall-value">实际 ${rate.toFixed(0)}%${theory != null ? ` / 理论 ${theory.toFixed(0)}%` : ''}</span>
                        </div>`;
                    }).join('');
                    el.innerHTML = html + `<div class="recall-legend"><span><i class="legend-actual"></i>实际回忆率</span><span><i class="legend-theory"></i>FSRS 理论值（中位稳定性 ${stability.toFixed(1)} 天）</span></div>`;
                    if (hint) {
                        const diff = logAgg.elapsedList.filter(r => r.total > 0 && r.rate != null)
                            .map(r => r.rate * 100 - (fsrs && typeof fsrs.forgetting_curve === 'function'
                                ? fsrs.forgetting_curve(r.avgElapsed, stability) * 100 : 0));
                        const avgDiff = diff.length ? diff.reduce((a, b) => a + b, 0) / diff.length : 0;
                        hint.textContent = diff.length
                            ? `实际回忆率平均比 FSRS 理论值${avgDiff >= 0 ? '高' : '低'} ${Math.abs(avgDiff).toFixed(0)} 个百分点：${avgDiff >= 0 ? '模型偏保守，可适当上调目标保持率' : '模型偏乐观，建议下调目标保持率或增加复习频率'}。`
                            : '';
                    }
                }

                // 四档评分分布与平均间隔
                renderStatsRatingDist(logAgg) {
                    const el = document.getElementById('statsRatingDist');
                    const hint = document.getElementById('statsRatingHint');
                    if (!el) return;
                    const defs = [
                        { rating: 1, label: '不认识', color: '#F44336' },
                        { rating: 2, label: '困难', color: '#FF9800' },
                        { rating: 3, label: '认识', color: '#2196F3' },
                        { rating: 4, label: '简单', color: '#4CAF50' }
                    ];
                    const total = logAgg.total || 0;
                    if (!total) {
                        el.innerHTML = '<p class="empty-state">暂无复习日志</p>';
                        if (hint) hint.textContent = '';
                        return;
                    }
                    const max = Math.max(1, ...defs.map(d => logAgg.ratingDist[d.rating] || 0));
                    el.innerHTML = defs.map(def => {
                        const count = logAgg.ratingDist[def.rating] || 0;
                        const pct = (count / max) * 100;
                        const ratio = total ? Math.round((count / total) * 100) : 0;
                        const avg = (logAgg.ratingList.find(r => r.rating === def.rating) || {}).avgInterval || 0;
                        return `<div class="mastery-row">
                            <span class="mastery-label">${def.label}</span>
                            <div class="mastery-bar-track"><div class="mastery-bar-fill" style="width:${pct}%;background:${def.color};"></div></div>
                            <span class="mastery-count">${count}</span>
                            <span class="mastery-extra">${ratio}% · 均 ${avg.toFixed(1)} 天</span>
                        </div>`;
                    }).join('');
                    if (hint) {
                        const hardShare = total ? ((logAgg.ratingDist[1] + logAgg.ratingDist[2]) / total) : 0;
                        hint.textContent = `困难/不认识占比 ${(hardShare * 100).toFixed(0)}%；用四档评分可以让 FSRS 更准确地估计难度与稳定性。`;
                    }
                }

                // 难度 × 回忆率
                renderStatsDifficulty(logAgg) {
                    const el = document.getElementById('statsDifficulty');
                    const hint = document.getElementById('statsDifficultyHint');
                    if (!el) return;
                    const rows = (logAgg.difficultyList || []).filter(r => r.total > 0);
                    if (!rows.length) {
                        el.innerHTML = '<p class="empty-state">暂无数据</p>';
                        if (hint) hint.textContent = '';
                        return;
                    }
                    const max = Math.max(1, ...rows.map(r => r.total));
                    el.innerHTML = rows.map(row => {
                        const pct = (row.total / max) * 100;
                        const rate = row.rate != null ? Math.round(row.rate * 100) : 0;
                        const color = rate >= 85 ? '#4CAF50' : (rate >= 65 ? '#FF9800' : '#F44336');
                        return `<div class="mastery-row">
                            <span class="mastery-label">难度 ${row.bucket}</span>
                            <div class="mastery-bar-track"><div class="mastery-bar-fill" style="width:${pct}%;background:${color};"></div></div>
                            <span class="mastery-count">${row.total}</span>
                            <span class="mastery-extra">回忆率 ${rate}%</span>
                        </div>`;
                    }).join('');
                    if (hint) {
                        const worst = rows.slice().sort((a, b) => (a.rate || 0) - (b.rate || 0))[0];
                        hint.textContent = worst ? `难度 ${worst.bucket} 的词回忆率最低（${Math.round((worst.rate || 0) * 100)}%），可优先安排这些词。` : '';
                    }
                }

                // 易忘词 Top 10
                renderStatsHardWords(hard, words) {
                    const el = document.getElementById('statsHardWords');
                    if (!el) return;
                    if (!hard || !hard.length) {
                        el.innerHTML = '<p class="empty-state">太棒了，暂无易忘词</p>';
                        return;
                    }
                    const wordMap = new Map((words || []).map(w => [w.id, w.word]));
                    el.innerHTML = hard.map(item => {
                        const word = wordMap.get(item.wordId) || `词 #${item.wordId}`;
                        const stability = item.stability ? `${item.stability.toFixed(1)} 天` : '—';
                        return `<div class="hard-word-row">
                            <span class="hard-word-text" data-wordid="${item.wordId}" data-word="${this.escapeHtml(word)}">${this.escapeHtml(word)}</span>
                            <span class="hard-word-meta">遗忘 ${item.lapses} 次</span>
                            <span class="hard-word-meta">稳定 ${stability}</span>
                            <span class="hard-word-meta">难度 ${item.difficulty.toFixed(1)}</span>
                            ${item.isLeech ? '<span class="leech-badge">易忘词</span>' : ''}
                        </div>`;
                    }).join('');
                }

                // 学习时段分布
                renderStatsHourHeat(hours, range) {
                    const el = document.getElementById('statsHourHeat');
                    const hint = document.getElementById('statsHourHint');
                    if (!el) return;
                    const max = Math.max(1, ...hours);
                    el.innerHTML = hours.map((count, hour) => {
                        const ratio = count / max;
                        const alpha = count === 0 ? 0 : 0.2 + ratio * 0.8;
                        return `<div class="hour-cell" style="background:${count ? `rgba(76,175,80,${alpha.toFixed(2)})` : 'var(--light-color)'}" title="${hour}:00 · ${count} 次"></div>`;
                    }).join('');
                    if (hint) {
                        let best = 0;
                        for (let i = 1; i < hours.length; i++) if (hours[i] > hours[best]) best = i;
                        const total = hours.reduce((a, b) => a + b, 0);
                        hint.textContent = total
                            ? `近 ${range} 天共 ${total} 次复习，最活跃时段为 ${best}:00-${best + 1}:00（${hours[best]} 次）。`
                            : `近 ${range} 天暂无复习记录。`;
                    }
                }

                // 近 26 周活跃热力图
                renderStatsActivityHeat(heat) {
                    const el = document.getElementById('statsActivityHeat');
                    const hint = document.getElementById('statsActivityHint');
                    if (!el) return;
                    const max = Math.max(1, heat.max);
                    el.innerHTML = heat.columns.map(col => {
                        return `<div class="calendar-col">${col.map(cell => {
                            const ratio = cell.count / max;
                            const alpha = cell.count === 0 ? 0 : 0.2 + ratio * 0.8;
                            return `<div class="calendar-cell" style="${cell.count ? `background:rgba(76,175,80,${alpha.toFixed(2)})` : ''}" title="${cell.key} · ${cell.count} 次"></div>`;
                        }).join('')}</div>`;
                    }).join('');
                    if (hint) {
                        const active = heat.cells.filter(c => c.count > 0).length;
                        hint.textContent = `近 26 周有 ${active} 天学习记录，单日最多 ${heat.max} 次。`;
                    }
                }

                // 词库维度
                renderStatsByList(rows) {
                    const el = document.getElementById('statsByList');
                    if (!el) return;
                    if (!rows || !rows.length) {
                        el.innerHTML = '<p class="empty-state">暂无词库数据</p>';
                        return;
                    }
                    const headers = ['词库', '总词数', '已学', '成熟', '易忘', '待复习', '平均遗忘'];
                    const body = rows.map(row => `<tr>
                        <td>${this.escapeHtml(row.name)}</td>
                        <td>${row.total}</td>
                        <td>${row.studied}</td>
                        <td>${row.mature}</td>
                        <td>${row.leeches}</td>
                        <td>${row.due}</td>
                        <td>${row.studied ? (row.lapses / row.studied).toFixed(2) : '—'}</td>
                    </tr>`).join('');
                    el.innerHTML = `<table class="stats-table">
                        <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                        <tbody>${body}</tbody>
                    </table>`;
                }

                // 导出统计 CSV
                exportStatsCsv() {
                    try {
                        const S = window.statsUtil;
                        const data = this._statsData;
                        if (!S || !data) {
                            this.showNotification('暂无可导出的统计数据', 'warning');
                            return;
                        }
                        const rows = [];
                        rows.push({ 指标: '统计区间(天)', 数值: data.range });
                        rows.push({ 指标: '已学单词', 数值: data.progressAgg.total });
                        rows.push({ 指标: '成熟词(稳定≥21天)', 数值: data.progressAgg.matured });
                        rows.push({ 指标: '平均保持率', 数值: data.progressAgg.avgRetrievability != null ? (data.progressAgg.avgRetrievability * 100).toFixed(1) + '%' : '—' });
                        rows.push({ 指标: '真实回忆率', 数值: data.logAgg.recallRate != null ? (data.logAgg.recallRate * 100).toFixed(1) + '%' : '—' });
                        rows.push({ 指标: '复习总次数', 数值: data.logAgg.total });
                        for (const row of data.logAgg.ratingList) {
                            rows.push({ 指标: `评分${row.rating}次数`, 数值: row.count });
                            rows.push({ 指标: `评分${row.rating}平均间隔(天)`, 数值: row.avgInterval.toFixed(2) });
                        }
                        for (const row of data.logAgg.elapsedList) {
                            rows.push({ 指标: `间隔${row.bucket}天回忆率`, 数值: row.rate != null ? (row.rate * 100).toFixed(1) + '%' : '—' });
                            rows.push({ 指标: `间隔${row.bucket}天样本数`, 数值: row.total });
                        }
                        for (const row of data.logAgg.difficultyList) {
                            rows.push({ 指标: `难度${row.bucket}回忆率`, 数值: row.rate != null ? (row.rate * 100).toFixed(1) + '%' : '—' });
                        }
                        for (const day of data.forecast.days) {
                            rows.push({ 指标: `到期量${day.key}`, 数值: day.count });
                        }
                        for (const row of data.byList) {
                            rows.push({ 指标: `词库[${row.name}]总词数`, 数值: row.total });
                            rows.push({ 指标: `词库[${row.name}]已学`, 数值: row.studied });
                            rows.push({ 指标: `词库[${row.name}]成熟`, 数值: row.mature });
                            rows.push({ 指标: `词库[${row.name}]易忘`, 数值: row.leeches });
                        }
                        const csv = S.toCsv(rows, ['指标', '数值']);
                        const filename = `kmword-stats-${new Date().toISOString().split('T')[0]}.csv`;
                        if (typeof Android !== 'undefined' && Android.saveFile) {
                            Android.saveFile(filename, csv);
                        } else {
                            const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = filename;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                        }
                        this.showNotification('统计数据已导出', 'success');
                    } catch (error) {
                        console.error('导出统计数据失败:', error);
                        this.showNotification('导出统计数据失败', 'error');
                    }
                }

                // 学习量柱状图：byDay = { 'YYYY-MM-DD': { total, correct } }（北京时间日键）
                renderActivityChart(byDay, days = 30) {
                    const container = document.getElementById('activityChart');
                    const empty = document.getElementById('activityEmpty');
                    if (!container) return;
                    const S = window.statsUtil;
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const bars = [];
                    let maxTotal = 0;
                    const entries = [];
                    for (let i = days - 1; i >= 0; i--) {
                        const d = new Date(today);
                        d.setDate(d.getDate() - i);
                        const key = S ? S.dayKey(d) : d.toISOString().split('T')[0];
                        const stat = byDay[key] || { total: 0, correct: 0 };
                        entries.push({ key, stat, date: d });
                        if (stat.total > maxTotal) maxTotal = stat.total;
                    }
                    if (maxTotal === 0) {
                        container.innerHTML = '';
                        if (empty) empty.style.display = 'block';
                        return;
                    }
                    if (empty) empty.style.display = 'none';
                    entries.forEach(({ stat, date }) => {
                        const heightPct = maxTotal > 0 ? (stat.total / maxTotal) * 100 : 0;
                        const correctPct = stat.total > 0 ? (stat.correct / stat.total) * 100 : 0;
                        const label = `${date.getMonth() + 1}/${date.getDate()}`;
                        const title = `${label}: ${stat.total} 个（正确 ${stat.correct}）`;
                        bars.push(`
                            <div class="activity-bar" title="${title}">
                                <div class="activity-bar-fill" style="height:${heightPct}%;">
                                    <div class="activity-bar-correct" style="height:${correctPct}%;"></div>
                                </div>
                                <span class="activity-bar-label">${label}</span>
                            </div>
                        `);
                    });
                    container.innerHTML = bars.join('');
                }

                // 正确率趋势（用柱状表示，简洁无依赖）
                renderAccuracyTrend(byDay, days = 7) {
                    const container = document.getElementById('accuracyTrend');
                    if (!container) return;
                    const S = window.statsUtil;
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const rows = [];
                    let anyData = false;
                    for (let i = days - 1; i >= 0; i--) {
                        const d = new Date(today);
                        d.setDate(d.getDate() - i);
                        const key = S ? S.dayKey(d) : d.toISOString().split('T')[0];
                        const stat = byDay[key] || { total: 0, correct: 0 };
                        const rate = stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0;
                        if (stat.total > 0) anyData = true;
                        const label = `${d.getMonth() + 1}/${d.getDate()}`;
                        rows.push(`
                            <div class="accuracy-row">
                                <span class="accuracy-label">${label}</span>
                                <div class="accuracy-bar-track">
                                    <div class="accuracy-bar-fill" style="width:${rate}%;"></div>
                                </div>
                                <span class="accuracy-value">${stat.total > 0 ? rate + '%' : '—'}</span>
                            </div>
                        `);
                    }
                    container.innerHTML = anyData ? rows.join('') : '<p class="empty-state">近 7 天暂无数据</p>';
                }

                showStats() {
                    this.switchPage('stats');
                }

                getDifficultyText(level) {
                    const levels = {
                        1: '初级',
                        2: '中级',
                        3: '高级',
                        4: '专业',
                        5: '学术'
                    };
                    return levels[level] || '未知';
                }

                showLoader(message = '加载中...') {
                    const loader = document.getElementById('loader');
                    const loaderText = document.getElementById('loaderText');
                    if (loaderText) loaderText.textContent = message;
                    if (loader) loader.classList.add('active');
                }

                hideLoader() {
                    const loader = document.getElementById('loader');
                    if (loader) loader.classList.remove('active');
                }

                showNotification(message, type = 'info') {
                    const existing = document.querySelectorAll('.notification');
                    if (existing.length > 2) {
                        existing[0].remove();
                    }
                    const notification = document.createElement('div');
                    notification.className = `notification ${type}`;
                    const icons = {
                        success: 'check-circle',
                        error: 'exclamation-circle',
                        warning: 'exclamation-triangle',
                        info: 'info-circle'
                    };
                    notification.innerHTML = `
                        <div class="notification-content">
                            <i class="fas fa-${icons[type] || 'info-circle'}"></i>
                            <span>${message}</span>
                        </div>
                    `;
                    document.body.appendChild(notification);
                    requestAnimationFrame(() => {
                        notification.classList.add('show');
                    });
                    setTimeout(() => {
                        notification.classList.remove('show');
                        setTimeout(() => notification.remove(), 300);
                    }, 3000);
                    notification.addEventListener('click', () => {
                        notification.classList.remove('show');
                        setTimeout(() => notification.remove(), 300);
                    });
                }

                // 生成短促提示音（WAV data URI），避免 AudioContext 在无音频设备的环境阻塞主线程
                buildBeepDataUrl(frequency, duration = 0.14, sampleRate = 8000) {
                    const samples = Math.floor(sampleRate * duration);
                    const buffer = new ArrayBuffer(44 + samples * 2);
                    const view = new DataView(buffer);
                    const writeStr = (offset, str) => {
                        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
                    };
                    writeStr(0, 'RIFF');
                    view.setUint32(4, 36 + samples * 2, true);
                    writeStr(8, 'WAVE');
                    writeStr(12, 'fmt ');
                    view.setUint32(16, 16, true);
                    view.setUint16(20, 1, true);
                    view.setUint16(22, 1, true);
                    view.setUint32(24, sampleRate, true);
                    view.setUint32(28, sampleRate * 2, true);
                    view.setUint16(32, 2, true);
                    view.setUint16(34, 16, true);
                    writeStr(36, 'data');
                    view.setUint32(40, samples * 2, true);
                    for (let i = 0; i < samples; i++) {
                        const t = i / sampleRate;
                        const fade = Math.min(1, t / 0.01) * Math.min(1, (duration - t) / 0.03);
                        const value = Math.sin(2 * Math.PI * frequency * t) * 0.5 * fade;
                        view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * 32767, true);
                    }
                    const bytes = new Uint8Array(buffer);
                    let binary = '';
                    const step = 8192;
                    for (let i = 0; i < bytes.length; i += step) {
                        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
                    }
                    return 'data:audio/wav;base64,' + btoa(binary);
                }

                playAnswerSound(correct) {
                    try {
                        if (!this._beepUrls) this._beepUrls = {};
                        const key = correct ? 'ok' : 'bad';
                        if (!this._beepUrls[key]) {
                            this._beepUrls[key] = this.buildBeepDataUrl(correct ? 880 : 392);
                        }
                        const audio = new Audio(this._beepUrls[key]);
                        audio.volume = 0.3;
                        const playing = audio.play();
                        if (playing && typeof playing.catch === 'function') playing.catch(() => {});
                    } catch (error) {
                        console.warn('播放音效失败:', error);
                    }
                }

                async speakWord(word, audioUrl) {
                    if (!word) return;
                    const url = audioUrl || this.getWordAudioUrl(word);
                    if (url && (this.networkAvailable || navigator.onLine)) {
                        try {
                            const audio = new Audio(url);
                            audio.playbackRate = 0.9;
                            await audio.play();
                            return;
                        } catch (error) {
                            console.warn('网络音频播放失败，使用 TTS:', error);
                        }
                    }
                    this.speakWithSynthesis(word);
                }

                // ===== 例句朗读 =====
                examplePlayButton(text, extraClass) {
                    const sentence = this.sanitizeSentence(text);
                    if (!sentence) return '';
                    const attr = this.escapeHtml(sentence).replace(/"/g, '&quot;');
                    const cls = extraClass ? ' ' + extraClass : '';
                    return `<button type="button" class="example-play${cls}" data-sentence="${attr}" title="朗读例句" aria-label="朗读例句"><i class="fas fa-volume-up"></i></button>`;
                }

                // 去掉 HTML 标签与常见实体（韦氏释义/引文里含 <i>、<span> 等标记）
                stripHtmlTags(text) {
                    return String(text == null ? '' : text)
                        .replace(/<br\s*\/?>/gi, ' ')
                        .replace(/<[^>]*>/g, '')
                        .replace(/&nbsp;/gi, ' ')
                        .replace(/&quot;/gi, '"')
                        .replace(/&#39;/gi, "'")
                        .replace(/&lt;/gi, '<')
                        .replace(/&gt;/gi, '>')
                        .replace(/&amp;/gi, '&');
                }

                sanitizeSentence(text) {
                    const raw = this.stripHtmlTags(text)
                        .replace(/[\u0000-\u001f\u007f]/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    if (!raw) return '';
                    if (raw.length > 300) return raw.slice(0, 300);
                    return raw;
                }

                sentenceAudioKey(text, voice, style, styleCustom) {
                    return `${text}||${voice || ''}||${style || ''}||${styleCustom || ''}`;
                }

                async resolveSentenceEngine() {
                    let setting = 'auto';
                    try { setting = (await this.db.getSetting('sentenceTtsEngine')) || 'auto'; } catch (e) {}
                    const hasKey = !!(this.mimoConfig && this.mimoConfig.apiKey);
                    if (setting === 'system') return 'system';
                    if (setting === 'mimo') return hasKey ? 'mimo' : 'system';
                    if (setting === 'follow') {
                        return (this.mimoConfig.engine === 'mimo' && hasKey) ? 'mimo' : 'system';
                    }
                    return hasKey ? 'mimo' : 'system';
                }

                setSentenceButtonState(btn, playing) {
                    if (!btn) return;
                    if (playing) {
                        btn.classList.add('playing');
                        btn.setAttribute('aria-busy', 'true');
                    } else {
                        btn.classList.remove('playing');
                        btn.removeAttribute('aria-busy');
                    }
                }

                stopSentenceAudio() {
                    const btn = this._sentenceButton;
                    if (btn) this.setSentenceButtonState(btn, false);
                    this._sentenceButton = null;
                    if (this.speechSynthesis) {
                        try { this.speechSynthesis.cancel(); } catch (e) {}
                    }
                }

                speakSentenceSystem(text, handlers = {}) {
                    if (!this.speechSynthesis) {
                        if (handlers.onError) handlers.onError('语音合成不可用');
                        return false;
                    }
                    try { this.speechSynthesis.cancel(); } catch (e) {}
                    const utterance = new SpeechSynthesisUtterance(text);
                    utterance.rate = 0.9;
                    const voice = this.voices.find(v => v.lang && v.lang.startsWith('en')) || null;
                    if (voice) utterance.voice = voice;
                    utterance.onstart = () => { if (handlers.onStart) handlers.onStart(); };
                    utterance.onend = () => { if (handlers.onEnd) handlers.onEnd(); };
                    utterance.onerror = () => { if (handlers.onError) handlers.onError('语音合成失败'); };
                    this.speechSynthesis.speak(utterance);
                    return true;
                }

                async speakSentenceMimo(text, handlers = {}) {
                    const voice = (this.mimoConfig && this.mimoConfig.voice) || 'mimo_default';
                    const style = (this.mimoConfig && this.mimoConfig.style) || 'standard';
                    const styleCustom = (this.mimoConfig && this.mimoConfig.styleCustom) || '';
                    let rate = 1;
                    try {
                        const speed = (await this.db.getSetting('ttsSpeed')) || 0;
                        rate = Math.max(0.3, Math.min(2, 1 + speed * 0.07));
                    } catch (e) {}
                    const key = this.sentenceAudioKey(text, voice, style, styleCustom);
                    let cached = null;
                    try { cached = await this.db.getSentenceAudio(key); } catch (e) {}
                    if (cached && cached.pcm) {
                        this.mimoPlayPcm(cached.pcm, {
                            rate,
                            onStart: handlers.onStart,
                            onEnd: handlers.onEnd,
                            onError: handlers.onError
                        });
                        return;
                    }
                    const chunks = [];
                    this.mimoSpeak({
                        text, voice, rate, style, styleCustom,
                        collect: (chunk) => { if (chunks.length < 400) chunks.push(chunk); },
                        onStart: handlers.onStart,
                        onEnd: () => {
                            try {
                                const pcm = this.concatBase64Chunks(chunks);
                                if (pcm) this.db.saveSentenceAudio({ key, text, voice, style, pcm }).catch(() => {});
                            } catch (e) {}
                            if (handlers.onEnd) handlers.onEnd();
                        },
                        onError: (err) => { if (handlers.onError) handlers.onError(err); }
                    });
                }

                // 播放例句：按设置选择 MiMo 云端或系统语音，MiMo 失败自动降级；会打断全文朗读
                async speakSentence(text, btn) {
                    const content = this.sanitizeSentence(text);
                    if (!content) return;
                    if (this.readerTTS) this.stopReaderTTS();
                    this.stopSentenceAudio();
                    if (btn) {
                        this._sentenceButton = btn;
                        this.setSentenceButtonState(btn, true);
                    }
                    const handlers = {
                        onStart: () => { if (btn) this.setSentenceButtonState(btn, true); },
                        onEnd: () => {
                            if (btn) this.setSentenceButtonState(btn, false);
                            if (this._sentenceButton === btn) this._sentenceButton = null;
                        },
                        onError: () => {
                            if (btn) this.setSentenceButtonState(btn, false);
                            if (this._sentenceButton === btn) this._sentenceButton = null;
                        }
                    };
                    const engine = await this.resolveSentenceEngine();
                    if (engine === 'mimo') {
                        await this.speakSentenceMimo(content, {
                            onStart: handlers.onStart,
                            onEnd: handlers.onEnd,
                            onError: () => {
                                this.speakSentenceSystem(content, handlers);
                            }
                        });
                        return;
                    }
                    this.speakSentenceSystem(content, handlers);
                }

                async addWordToStudy(wordId) {
                    try {
                        const word = await this.db.getWordById(wordId);
                        if (word) {
                            this.isStudyingPreparedSession = true;
                            this.learningWords = [word];
                            this.currentWordIndex = 0;
                            this.switchPage('learn');
                        }
                    } catch (error) {
                        console.error('添加单词到学习失败:', error);
                    }
                }

                async retryLoadNewWords() {
                    await this.loadNewWordsList();
                }

                async lookupMerriamWebster() {
                    const mwResult = document.getElementById('mwResult');
                    if (!mwResult) return;
                    const word = document.getElementById('currentWord')?.textContent;
                    if (!word || word === 'Loading...') {
                        this.showNotification('请先加载一个单词', 'warning');
                        return;
                    }
                    await this.renderMwResult(word, mwResult);
                }

                // 参数化版本：把韦氏查询结果渲染到指定容器，供学习卡片与查词弹窗复用
                // options.cachedResult: { dict, thesaurus } 直接渲染缓存原始 JSON，跳过网络请求
                // options.cachedAt: 缓存时间 ISO 字符串，展示在结果顶部
				// ===== 韦氏渲染辅助 =====
				mwSafeHtml(html) {
					const raw = String(html == null ? '' : html);
					if (typeof window !== 'undefined' && window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
						return window.DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
					}
					return raw
						.replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
						.replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
				}

				mwEscape(text) {
					return this.escapeHtml(text == null ? '' : String(text));
				}

				mwLabelRow(label, value) {
					if (!value) return '';
					return `<div style="font-size:0.9rem;color:var(--gray-color);margin-bottom:6px;"><strong>${this.mwEscape(label)}：</strong> ${value}</div>`;
				}

				mwChipList(words, limit = 30) {
					const list = (words || []).filter(Boolean).slice(0, limit);
					if (!list.length) return '';
					return `<div class="syn-list">${list.map(w => `<span>${this.mwEscape(w)}</span>`).join('')}</div>`;
				}

				// 韦氏词表分组（带义项释义与词标签）
				renderMwGroupHtml(groups) {
					if (!groups || !groups.length) return '';
					let html = '';
					for (const group of groups) {
						const words = [];
						for (const g of (group.words || [])) {
							for (const w of g) {
								const label = w.status ? `${w.word}（${w.status}）` : w.word;
								words.push(label);
							}
						}
						if (!words.length) continue;
						const head = group.label ? `<strong style="color:var(--dark-color);">${this.mwEscape(group.label)}</strong>` : '';
						const def = group.definition ? `<span style="color:var(--gray-color);font-size:0.85rem;">（义项 ${this.mwEscape(group.definition)}）</span>` : '';
						html += `<div style="margin:6px 0;">${head} ${def}<div class="syn-list">${words.map(w => `<span>${this.mwEscape(w)}</span>`).join('')}</div></div>`;
					}
					return html;
				}

				// 韦氏义项
				renderMwSenseHtml(def, depth = 0) {
					const indent = depth * 18;
					const border = depth === 0 ? '3px solid var(--primary-color)' : '2px solid var(--gray-color)';
					let block = `<div style="margin-bottom:12px; padding-left:${indent}px; border-left: ${border};">`;
					const header = [];
					if (def.number) header.push(`<strong>${this.mwEscape(def.number)}.</strong>`);
					if (def.grammaticalLabel) header.push(`<span style="color:var(--gray-color);">[${this.mwEscape(def.grammaticalLabel)}]</span>`);
					if (def.division) header.push(`<span style="color:var(--secondary-color);">（${this.mwEscape(def.division)}）</span>`);
					const labels = (def.subjectLabels || []).concat(def.generalLabels || []).filter(Boolean);
					if (labels.length) header.push(`<span style="color:var(--gray-color);font-style:italic;">（${this.mwEscape(labels.join('、'))}）</span>`);
					if (header.length) block += `<div style="margin-bottom:4px;">${header.join(' ')}</div>`;
					if (def.text) block += `<div class="def-text">${def.text}</div>`;
					if (def.pronunciation) block += `<div style="font-size:0.85rem;color:var(--gray-color);">🔈 ${this.mwEscape(def.pronunciation)}</div>`;
					if (def.examples && def.examples.length > 0) {
						block += '<div style="margin-top:4px; margin-left:12px; font-style:italic; color:var(--gray-color); font-size:0.95rem;">';
						for (const ex of def.examples) {
							block += `<div>“${ex.text}”${ex.source ? `<span style="font-style:normal;font-size:0.85rem;"> — ${this.mwEscape(ex.source)}</span>` : ''}${this.examplePlayButton(ex.text)}</div>`;
						}
						block += '</div>';
					}
					if (def.notes && def.notes.length) {
						block += `<div style="margin-top:4px;font-size:0.9rem;color:var(--dark-color);">📝 ${def.notes.map(n => this.mwEscape(n)).join('；')}</div>`;
					}
					if (def.usages && def.usages.length) {
						block += `<div style="margin-top:4px;font-size:0.9rem;color:var(--secondary-color);">💡 用法：${def.usages.map(n => this.mwEscape(n)).join('；')}</div>`;
					}
					if (def.synonyms && def.synonyms.length) {
						block += this.mwLabelRow('义项同义词', this.mwChipList(def.synonyms, 20));
					}
					if (def.antonyms && def.antonyms.length) {
						block += this.mwLabelRow('义项反义词', this.mwChipList(def.antonyms, 20));
					}
					if (def.rhymes && def.rhymes.length) {
						block += this.mwLabelRow('韵脚', this.mwEscape(def.rhymes.join('、')));
					}
					if (def.citations && def.citations.length) {
						block += this.mwLabelRow('引文出处', this.mwEscape(def.citations.join('；')));
					}
					if (def.inflections && def.inflections.length) {
						block += this.mwLabelRow('屈折形式', this.mwEscape(def.inflections.join('、')));
					}
					if (def.variants && def.variants.length) {
						block += this.mwLabelRow('异体拼写', this.mwEscape(def.variants.map(v => v.va + (v.vl ? `（${v.vl}）` : '')).join('、')));
					}
					if (def.etymology) {
						block += `<div style="margin-top:4px;font-size:0.9rem;color:var(--gray-color);"><strong>词源：</strong> ${def.etymology}</div>`;
					}
					for (const sub of (def.subsenses || [])) {
						block += this.renderMwSenseHtml(sub, depth + 1);
					}
					block += '</div>';
					return block;
				}

				// 韦氏词典词条
				renderMwEntryHtml(entry, word, index, allEntries) {
					let html = '';
					if (index > 0) html += '<hr style="margin: 20px 0; border-color: var(--border-color);">';
					const headLabels = [entry.functionalLabel].concat(entry.additionalLabels || []).filter(Boolean);
					html += '<h4 style="margin: 10px 0 6px;">📖 韦氏词典 (Collegiate Dictionary)';
					if (headLabels.length) {
						html += ` — <span style="color:var(--secondary-color);">${this.mwEscape(headLabels.join(' · '))}</span>`;
					}
					html += '</h4>';

					// 音标（全部读音）
					const prs = entry.pronunciations || [];
					if (prs.length) {
						const items = prs.map(pr => {
							const ipa = pr.ipa || pr.mw;
							return ipa ? `<span style="margin-right:12px;">${this.mwEscape(ipa)}</span>` : '';
						}).filter(Boolean).join('');
						if (items) html += `<div style="font-size:0.95rem;color:var(--secondary-color);margin-bottom:6px;">🔈 ${items}</div>`;
					}
					// 发音按钮（使用第一个带音频的词条）
					const audioEntry = (allEntries || []).find(e => (e.pronunciations || []).some(p => p.audioUrl));
					if (audioEntry) {
						const audio = audioEntry.pronunciations.find(p => p.audioUrl);
						html += `<button class="icon-btn small mw-audio-btn" data-audio="${this.mwEscape(audio.audioUrl)}" data-word="${this.mwEscape(word)}" title="播放韦氏发音"><i class="fas fa-volume-up"></i> 发音</button>`;
					}

					// 元信息
					if (entry.shortDefs && entry.shortDefs.length) {
						html += this.mwLabelRow('简明释义', this.mwEscape(entry.shortDefs.join('；')));
					}
					if (entry.inflections && entry.inflections.length) {
						html += this.mwLabelRow('词形变化', this.mwEscape(entry.inflections.join('、')));
					}
					if (entry.stems && entry.stems.length) {
						html += this.mwLabelRow('词干', this.mwEscape(entry.stems.join('、')));
					}
					if (entry.variants && entry.variants.length) {
						html += this.mwLabelRow('异体拼写', this.mwEscape(entry.variants.map(v => v.va + (v.vl ? `（${v.vl}）` : '')).join('、')));
					}
					if (entry.derivedWords && entry.derivedWords.length) {
						html += this.mwLabelRow('派生词', this.mwEscape(entry.derivedWords.map(d => d.word + (d.pos ? `（${d.pos}）` : '')).join('、')));
					}
					if (entry.rhymes && entry.rhymes.length) {
						html += this.mwLabelRow('押韵', this.mwEscape(entry.rhymes.join('、')));
					}
					if (entry.generalLabels && entry.generalLabels.length) {
						html += this.mwLabelRow('标签', this.mwEscape(entry.generalLabels.join('、')));
					}
					if (entry.subjectLabels && entry.subjectLabels.length) {
						html += this.mwLabelRow('语域', this.mwEscape(entry.subjectLabels.join('、')));
					}
					if (entry.date) {
						html += this.mwLabelRow('最早记录', this.mwEscape(entry.date));
					}
					if (entry.offensive) {
						html += '<div style="font-size:0.9rem;color:var(--danger-color);margin-bottom:6px;">⚠️ 本词可能具有冒犯性</div>';
					}
					if (entry.etymology) {
						html += `<div style="font-size:0.9rem;color:var(--gray-color);margin-bottom:6px;"><strong>词源：</strong> ${entry.etymology}</div>`;
					}

					// 释义
					for (const def of (entry.definitions || [])) {
						html += this.renderMwSenseHtml(def, 0);
					}

					// 同义词 / 反义词（词典条目内）
					if (entry.synonyms && (entry.synonyms.paragraphs.length || entry.synonyms.list.length)) {
						html += '<div style="margin: 12px 0; padding: 10px 12px; background: var(--light-color); border-radius: 8px;">';
						html += '<div style="font-weight:600;margin-bottom:8px;">📌 同义词</div>';
						for (const p of entry.synonyms.paragraphs) {
							html += `<p style="margin:6px 0;line-height:1.6;">${p.text}</p>`;
						}
						if (entry.synonyms.list.length) html += this.mwChipList(entry.synonyms.list, 24);
						for (const ex of (entry.synonyms.examples || [])) {
							html += `<div style="font-style:italic;color:var(--gray-color);margin:6px 0 6px 12px;">“${ex.text}”${ex.source ? ` — ${this.mwEscape(ex.source)}` : ''}${this.examplePlayButton(ex.text)}</div>`;
						}
						html += '</div>';
					}
					if (entry.antonyms && (entry.antonyms.paragraphs.length || entry.antonyms.list.length)) {
						html += '<div style="margin: 12px 0; padding: 10px 12px; background: var(--light-color); border-radius: 8px;">';
						html += '<div style="font-weight:600;margin-bottom:8px;">🚫 反义词</div>';
						for (const p of entry.antonyms.paragraphs) {
							html += `<p style="margin:6px 0;line-height:1.6;">${p.text}</p>`;
						}
						if (entry.antonyms.list.length) html += this.mwChipList(entry.antonyms.list, 24);
						for (const ex of (entry.antonyms.examples || [])) {
							html += `<div style="font-style:italic;color:var(--gray-color);margin:6px 0 6px 12px;">“${ex.text}”${this.examplePlayButton(ex.text)}</div>`;
						}
						html += '</div>';
					}

					// 用法说明
					if (entry.usages && entry.usages.length) {
						html += '<div style="margin: 12px 0;">';
						html += '<div style="font-weight:600;margin-bottom:6px;">💡 用法说明</div>';
						for (const u of entry.usages) {
							html += `<p style="margin:6px 0;font-size:0.9rem;color:var(--gray-color);line-height:1.6;">${u}</p>`;
						}
						html += '</div>';
					}

					// 引文
					if (entry.quotes && entry.quotes.length) {
						html += '<div style="margin: 12px 0;">';
						html += '<div style="font-weight:600; margin-bottom:6px;">📝 引文示例</div>';
						for (const q of entry.quotes) {
							html += '<div style="margin-bottom:8px; padding-left:8px; border-left: 2px solid var(--secondary-color);">';
							html += `<div style="font-style:italic;">“${q.text}”${this.examplePlayButton(q.text)}</div>`;
							if (q.source) {
								html += `<div style="font-size:0.85rem; color:var(--gray-color);">— ${this.mwEscape(q.source)}</div>`;
							}
							html += '</div>';
						}
						html += '</div>';
					}

					// 补充示例
					if (entry.supplementary && entry.supplementary.examples.length) {
						html += '<div style="margin: 12px 0;">';
						html += '<div style="font-weight:600;margin-bottom:6px;">➕ 补充示例</div>';
						for (const ex of entry.supplementary.examples) {
							html += `<div style="font-style:italic;color:var(--gray-color);margin:4px 0 4px 12px;">“${ex.text}”${ex.source ? ` — ${this.mwEscape(ex.source)}` : ''}${this.examplePlayButton(ex.text)}</div>`;
						}
						html += '</div>';
					}
					// 补充长释义
					if (entry.supplementary && entry.supplementary.longDefs.length) {
						html += '<div style="margin: 12px 0;">';
						html += '<div style="font-weight:600;margin-bottom:6px;">🧾 补充释义</div>';
						for (const def of entry.supplementary.longDefs) {
							html += this.renderMwSenseHtml(def, 1);
						}
						html += '</div>';
					}
					// 已定义派生短语
					if (entry.runOns && entry.runOns.length) {
						html += '<div style="margin: 12px 0;">';
						html += '<div style="font-weight:600;margin-bottom:6px;">🌱 派生短语</div>';
						for (const run of entry.runOns) {
							html += `<div style="margin:6px 0;"><strong>${this.mwEscape(run.text)}</strong>${run.pronunciations && run.pronunciations.length ? ` <span style="color:var(--secondary-color);">${this.mwEscape(run.pronunciations.join(', '))}</span>` : ''}</div>`;
							for (const def of (run.definitions || [])) {
								html += this.renderMwSenseHtml(def, 1);
							}
						}
						html += '</div>';
					}
					return html;
				}

				// 韦氏同义词库
				renderMwThesaurusHtml(thes, word) {
					if (!thes) {
						return '<p class="mw-info">未配置同义词 API Key，如需查看同义词请配置。</p>';
					}
					const sections = [
						{ label: '同义词', words: thes.synonyms, groups: thes.synonymGroups },
						{ label: '近义词', words: thes.nearSynonyms, groups: thes.nearSynonymGroups },
						{ label: '反义词', words: thes.antonyms, groups: thes.antonymGroups },
						{ label: '近反义词', words: thes.nearAntonyms, groups: thes.nearAntonymGroups },
						{ label: '反义词与近反义词', words: thes.opposites, groups: thes.oppositeGroups },
						{ label: '相关词', words: thes.related, groups: thes.relatedGroups },
						{ label: '同义短语', words: thes.phrases, groups: thes.phraseGroups }
					];
					let html = '';
					let hasData = false;
					for (const section of sections) {
						const words = section.words || [];
						const groups = section.groups || [];
						if (!words.length && !groups.length) continue;
						hasData = true;
						html += '<div class="mw-synonyms" style="margin-top:10px;">';
						html += `<span class="label">${this.mwEscape(section.label)}：</span>`;
						html += this.mwChipList(words, 24);
						const groupHtml = this.renderMwGroupHtml(groups);
						if (groupHtml) html += groupHtml;
						html += '</div>';
					}
					// 词条释义（简明释义）
					if (thes.definitions && thes.definitions.length) {
						hasData = true;
						html += '<div style="margin-top:12px;">';
						html += '<div style="font-weight:600;margin-bottom:6px;">📗 同义词库释义</div>';
						for (const def of thes.definitions.slice(0, 6)) {
							html += this.renderMwSenseHtml(def, 1);
						}
						html += '</div>';
					}
					if (!hasData) {
						return '<p class="mw-error">未找到同义词数据。</p>';
					}
					return html;
				}

				async renderMwResult(word, containerEl, options = {}) {
					if (!containerEl) return;
					containerEl.style.display = 'block';
					containerEl.innerHTML = '<div class="mw-loading"><i class="fas fa-spinner fa-spin"></i> 正在查询韦氏词典...</div>';
					try {
                        let result;
                        if (options.cachedResult) {
                            result = options.cachedResult;
                        } else {
                            result = await this.mwAPI.lookupWord(word);
                            if (result && (result.dict || result.thesaurus)) {
                                this.db.saveWordCache(word, {
                                    mw: {
                                        dict: result.dict || null,
                                        thesaurus: result.thesaurus || null,
                                        cachedAt: new Date().toISOString()
                                    }
                                }).then(() => this.refreshLookupModalCacheButtons(word))
                                  .catch(err => console.warn('韦氏缓存写入失败:', err));
                            }
                        }
						const dictData = this.mwAPI.parseDict(result.dict);  // 现在是一个数组
						const thesData = this.mwAPI.parseThesaurus(result.thesaurus);
						let html = options.cachedAt
                            ? `<div class="cache-note"><i class="fas fa-database"></i> 缓存于 ${this.formatCacheDate(options.cachedAt)} · 点击「韦氏词典」可重新查询</div>`
                            : '';
                        html += '<div class="mw-result-section">';

						// --- 词典部分：支持多词条 ---
						if (dictData && dictData.length > 0) {
							dictData.forEach((entry, index) => {
								html += this.renderMwEntryHtml(entry, word, index, dictData);
							});
						} else {
							const dictKey = await window.wordDB.getSetting('mwDictKey');
							if (!dictKey) {
								html += '<p class="mw-info">未配置词典 API Key，如需查看词典释义请配置。</p>';
							} else {
								html += '<p class="mw-error">未找到词典释义，可能单词拼写有误。</p>';
							}
						}

						// --- 同义词部分（与词条无关，放在最后） ---
						html += this.renderMwThesaurusHtml(thesData, word);
						html += '</div>';
						containerEl.innerHTML = this.mwSafeHtml(html);
						this.makeClickable(containerEl);

						if (!dictData || dictData.length === 0) {
							// 如果没有任何词典数据，但错误信息已经显示
						}
					} catch (error) {
						console.error('韦氏查询失败:', error);
						containerEl.innerHTML = `<p class="mw-error">查询失败：${error.message}</p>`;
						if (error.message.includes('API Key')) {
							this.showNotification('请至少配置一个 Merriam-Webster API Key', 'warning');
						}
					}
				}

                // ===== 查词弹窗（学习卡片点击单词 / 例句单词）=====
                async openWordLookup(word) {
                    if (!word) return;
                    word = String(word).trim();
                    this.lookupModalWord = word;
                    const modal = document.getElementById('wordLookupModal');
                    const titleEl = document.getElementById('lookupModalWord');
                    const freeDictEl = document.getElementById('lookupModalFreeDict');
                    const mwResultEl = document.getElementById('lookupModalMwResult');
                    if (!modal || !titleEl) return;
                    titleEl.textContent = word;
                    if (freeDictEl) {
                        freeDictEl.innerHTML = '<p class="empty-state"><i class="fas fa-spinner fa-spin"></i> 加载中...</p>';
                    }
                    if (mwResultEl) {
                        mwResultEl.style.display = 'none';
                        mwResultEl.innerHTML = '';
                    }
                    const aiResultEl = document.getElementById('lookupModalAiResult');
                    if (aiResultEl) {
                        aiResultEl.style.display = 'none';
                        aiResultEl.innerHTML = '';
                    }
                    const ecdictResultEl = document.getElementById('lookupModalEcdictResult');
                    if (ecdictResultEl) {
                        ecdictResultEl.style.display = 'none';
                        ecdictResultEl.innerHTML = '';
                    }
                    const mwCacheBtn = document.getElementById('lookupModalMwCacheBtn');
                    const aiCacheBtn = document.getElementById('lookupModalAiCacheBtn');
                    if (mwCacheBtn) mwCacheBtn.style.display = 'none';
                    if (aiCacheBtn) aiCacheBtn.style.display = 'none';
                    modal.style.display = 'flex';
                    this.refreshLookupModalCacheButtons(word);
                    this.refreshLookupModalEcdictButton();
                    // 拉取 free dict 并渲染
                    const requestedWord = word;
                    try {
                        const data = await this.dictionaryAPI.fetchWordData(requestedWord);
                        // 用户可能已切换到别的单词，避免旧请求覆盖新弹窗
                        if (!this.lookupModalWord || this.lookupModalWord.toLowerCase() !== requestedWord.toLowerCase()) return;
                        if (titleEl) titleEl.textContent = data.word || requestedWord;
                        this.renderDictDetails(data, freeDictEl);
                        // 顶部补一行音标 + 释义摘要，便于没展开 details 也能看到
                        const summary = [];
                        if (data.phonetic) summary.push(`<span style="color:var(--gray-color);">${this.escapeHtml(data.phonetic)}</span>`);
                        if (data.meaning) summary.push(`<div style="margin-top:6px;">${this.escapeHtml(data.meaning)}</div>`);
                        if (summary.length && freeDictEl) {
                            freeDictEl.insertAdjacentHTML('afterbegin', `<div style="margin-bottom:8px;">${summary.join(' ')}</div>`);
                        }
                        // 让弹窗内 free dict 释义/音标/摘要中的英文单词可点击查词
                        this.makeClickable(freeDictEl);
                        this.lookupModalAudioUrl = data.audioUrl || '';
                        if (!data.audioUrl && data.meaning && !data.meaning.includes('网络查询失败')) {
                            setTimeout(() => this.speakWord(word), 300);
                        }
                    } catch (e) {
                        if (!this.lookupModalWord || this.lookupModalWord.toLowerCase() !== requestedWord.toLowerCase()) return;
                        if (freeDictEl) freeDictEl.innerHTML = '<p class="empty-state">词典数据加载失败</p>';
                    }
                }

                closeWordLookup() {
                    const modal = document.getElementById('wordLookupModal');
                    if (modal) modal.style.display = 'none';
                    this.lookupModalWord = null;
                    this.lookupModalAudioUrl = '';
                    const aiResultEl = document.getElementById('lookupModalAiResult');
                    if (aiResultEl) {
                        aiResultEl.style.display = 'none';
                        aiResultEl.innerHTML = '';
                    }
                    const ecdictResultEl = document.getElementById('lookupModalEcdictResult');
                    if (ecdictResultEl) {
                        ecdictResultEl.style.display = 'none';
                        ecdictResultEl.innerHTML = '';
                    }
                }
				async addLookupWordToNewWords() {
					const word = this.lookupModalWord;
					if (!word) {
						this.showNotification('没有单词可添加', 'warning');
						return;
					}

					try {
						// 1. 查询单词是否已在库中
						let wordData = await this.db.getWord(word);
						let wordId;

						if (wordData) {
							wordId = wordData.id;
						} else {
							// 2. 不在库中，先加入默认单词库
							const listId = await this.db.getSetting('currentListId');
							const targetListId = (listId && listId !== 'all') ? parseInt(listId) : null;
							wordId = await this.db.addWord({
								word: word,
								meaning: '',
								source: 'lookup',
								difficulty: 3,
								listId: targetListId
							});
							if (!wordId) {
								// 极少数并发冲突，再次查询
								wordData = await this.db.getWord(word);
								if (wordData) wordId = wordData.id;
								else throw new Error('无法将单词加入词库');
							}
						}

						// 3. 检查是否已在生词本
						const inNewWords = await this.db.isInNewWords(wordId);
						if (inNewWords) {
							this.showNotification(`"${word}" 已在生词本中`, 'info');
							return;
						}

						// 4. 加入生词本
						await this.db.addToNewWords(wordId);
						this.showNotification(`"${word}" 已加入生词本`, 'success');

						// 可选：如果当前页面是生词本，刷新列表
						if (this.currentPage === 'new-words') {
							await this.loadNewWordsList();
						}
					} catch (e) {
						console.error('加入生词本失败:', e);
						this.showNotification('加入生词本失败', 'error');
					}
				}
                async addLookupWordToDB() {
                    const word = this.lookupModalWord;
                    if (!word) return;
                    try {
                        const listId = await this.db.getSetting('currentListId');
                        const targetListId = listId && listId !== 'all' ? parseInt(listId) : null;
                        const existing = await this.db.getWordInList(word, targetListId);
                        if (existing) {
                            this.showNotification(`"${word}" 已在词库中`, 'info');
                            return;
                        }
                        await this.db.addWord({
                            word,
                            meaning: '',
                            source: 'lookup',
                            difficulty: 3,
                            listId: targetListId
                        });
                        this.showNotification(`"${word}" 已加入词库`, 'success');
                    } catch (e) {
                        console.error('加入词库失败:', e);
                        this.showNotification('加入词库失败', 'error');
                    }
                }

                async lookupModalMw() {
                    const word = this.lookupModalWord;
                    if (!word) return;
                    const mwResultEl = document.getElementById('lookupModalMwResult');
                    await this.renderMwResult(word, mwResultEl);
                }

                async lookupModalMwCache() {
                    const word = this.lookupModalWord;
                    if (!word) return;
                    const mwResultEl = document.getElementById('lookupModalMwResult');
                    if (!mwResultEl) return;
                    try {
                        const cache = await this.db.getWordCache(word);
                        if (!cache || !cache.mw) {
                            this.showNotification('没有该单词的韦氏词典缓存', 'warning');
                            this.refreshLookupModalCacheButtons(word);
                            return;
                        }
                        await this.renderMwResult(word, mwResultEl, {
                            cachedResult: cache.mw,
                            cachedAt: cache.mw.cachedAt
                        });
                    } catch (e) {
                        console.error('读取韦氏缓存失败:', e);
                        this.showNotification('读取缓存失败', 'error');
                    }
                }

                formatCacheDate(iso) {
                    try {
                        return new Date(iso).toLocaleString('zh-CN', {
                            year: 'numeric', month: '2-digit', day: '2-digit',
                            hour: '2-digit', minute: '2-digit'
                        });
                    } catch (e) {
                        return iso;
                    }
                }

                async refreshLookupModalCacheButtons(word = null) {
                    word = word || this.lookupModalWord;
                    const mwCacheBtn = document.getElementById('lookupModalMwCacheBtn');
                    const aiCacheBtn = document.getElementById('lookupModalAiCacheBtn');
                    if (!word || !mwCacheBtn || !aiCacheBtn) return;
                    if (this.lookupModalWord && this.lookupModalWord.toLowerCase() !== String(word).toLowerCase()) return;
                    try {
                        const cache = await this.db.getWordCache(word);
                        if (this.lookupModalWord && this.lookupModalWord.toLowerCase() !== String(word).toLowerCase()) return;
                        mwCacheBtn.style.display = (cache && cache.mw) ? '' : 'none';
                        aiCacheBtn.style.display = (cache && cache.ai) ? '' : 'none';
                    } catch (e) {
                        if (this.lookupModalWord && this.lookupModalWord.toLowerCase() !== String(word).toLowerCase()) return;
                        mwCacheBtn.style.display = 'none';
                        aiCacheBtn.style.display = 'none';
                    }
                }

                normalizeAiMarkdown(text) {
                    if (!text) return '';
                    let out = String(text).replace(/\r\n/g, '\n');
                    out = out.replace(/^\s*(?:好的|当然|以下是|以下为)[^\n]*\n+/, '');
                    out = out.replace(
                        /^[ \t]*\*\*\s*(\d+)[.、．]\s*([^*\n]{1,40}?)\s*\*\*[ \t]*[：:]?[ \t]*(.*)$/gm,
                        (m, num, title, rest) => {
                            const head = `## ${num}. ${title.trim()}`;
                            return rest && rest.trim() ? `${head}\n\n${rest.trim()}` : head;
                        }
                    );
                    const knownSection = /^(词性和基本释义|词根词缀分析|记忆技巧|常用搭配和短语|近义词辨析|例句|学习建议|学习这个单词.*|单词分析.*)$/;
                    out = out.replace(/^[ \t]*\*\*\s*([^*\n]{2,30}?)\s*\*\*[ \t]*[：:]?[ \t]*$/gm, (m, title) => {
                        return knownSection.test(title.trim()) ? `## ${title.trim()}` : m;
                    });
                    out = out.replace(/([^\n])\n(#{1,4}\s)/g, '$1\n\n$2');
                    return out;
                }

                async lookupModalAi() {
                    const word = this.lookupModalWord;
                    if (!word) return;
                    const aiResultEl = document.getElementById('lookupModalAiResult');
                    if (!aiResultEl) return;

                    const providerKey = (await this.db.getSetting('llmProvider')) || 'zhipu';
                    const provider = this.LLM_PROVIDERS[providerKey] || this.LLM_PROVIDERS.zhipu;
                    const apiKey = await this.db.getSetting('llmApiKey');
                    if (!apiKey) {
                        this.showNotification('请先在设置中配置 ' + provider.name + ' API Key', 'warning');
                        return;
                    }

                    let apiBase = (await this.db.getSetting('llmApiBase')) || '';
                    apiBase = apiBase.trim() || provider.baseUrl;
                    if (!apiBase) {
                        this.showNotification('请配置 API 地址', 'warning');
                        return;
                    }

                    const model = (await this.db.getSetting('llmModel') || provider.defaultModel || '').trim();
                    if (!model) {
                        this.showNotification('请配置模型名称', 'warning');
                        return;
                    }

                    const promptTemplate = (await this.db.getSetting('llmPrompt')) || this.AI_DEFAULT_PROMPT;
                    const temperature = (await this.db.getSetting('llmTemperature')) ?? 0.7;
                    const topP = (await this.db.getSetting('llmTopP')) ?? 0.9;
                    const webSearchEnabled = (await this.db.getSetting('llmWebSearch')) ?? true;
                    const userMessage = promptTemplate.replace(/\{word\}/g, word);

                    aiResultEl.style.display = 'block';
                    aiResultEl.innerHTML = '<div class="ai-loading"><i class="fas fa-spinner fa-spin"></i> AI 分析中...</div>';

                    try {
                        const body = {
                            model: model,
                            messages: [{ role: 'user', content: userMessage }],
                            temperature: temperature,
                            top_p: topP
                        };
                        if (webSearchEnabled && provider.webSearch) {
                            body.tools = [{
                                type: 'web_search',
                                web_search: {
                                    enable: true,
                                    search_result: true,
                                    search_query: word,
                                    count: 5
                                }
                            }];
                        }
                        const response = await fetch(apiBase + '/chat/completions', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': 'Bearer ' + apiKey
                            },
                            body: JSON.stringify(body)
                        });

                        if (!response.ok) {
                            const errText = await response.text();
                            throw new Error('API 错误 (' + response.status + '): ' + errText);
                        }

                        const data = await response.json();
                        const content = data.choices?.[0]?.message?.content || '(无返回内容)';
                        const rendered = this.normalizeAiMarkdown(content);
                        const renderFn = typeof marked?.parse === 'function' ? marked : null;
                        if (renderFn) {
                            const html = renderFn.parse(rendered, { breaks: true });
                            aiResultEl.innerHTML = '<div class="ai-result">' + DOMPurify.sanitize(html) + '</div>';
                        } else {
                            aiResultEl.innerHTML = '<div class="ai-result">' + this.escapeHtml(rendered) + '</div>';
                        }
                        if (content && content !== '(无返回内容)') {
                            this.db.saveWordCache(word, {
                                ai: {
                                    content: content,
                                    cachedAt: new Date().toISOString()
                                }
                            }).then(() => this.refreshLookupModalCacheButtons(word))
                              .catch(err => console.warn('AI 缓存写入失败:', err));
                        }
                    } catch (e) {
                        aiResultEl.innerHTML = '<div class="ai-error"><i class="fas fa-exclamation-triangle"></i> ' + this.escapeHtml(e.message) + '</div>';
                    }
                }

                async lookupModalAiCache() {
                    const word = this.lookupModalWord;
                    if (!word) return;
                    const aiResultEl = document.getElementById('lookupModalAiResult');
                    if (!aiResultEl) return;
                    try {
                        const cache = await this.db.getWordCache(word);
                        if (!cache || !cache.ai || !cache.ai.content) {
                            this.showNotification('没有该单词的 AI 分析缓存', 'warning');
                            this.refreshLookupModalCacheButtons(word);
                            return;
                        }
                        const note = '<div class="cache-note"><i class="fas fa-database"></i> 缓存于 ' +
                            this.formatCacheDate(cache.ai.cachedAt) + ' · 点击「AI 分析」可重新生成</div>';
                        const content = this.normalizeAiMarkdown(cache.ai.content);
                        aiResultEl.style.display = 'block';
                        const renderFn = typeof marked?.parse === 'function' ? marked : null;
                        if (renderFn) {
                            const html = renderFn.parse(content, { breaks: true });
                            aiResultEl.innerHTML = note + '<div class="ai-result">' + DOMPurify.sanitize(html) + '</div>';
                        } else {
                            aiResultEl.innerHTML = note + '<div class="ai-result">' + this.escapeHtml(content) + '</div>';
                        }
                    } catch (e) {
                        console.error('读取 AI 缓存失败:', e);
                        this.showNotification('读取缓存失败', 'error');
                    }
                }

                // ===== 阅读模块 =====
                async loadReadingList() {
                    try {
                        const list = document.getElementById('readingList');
                        if (!list) return;
                        list.innerHTML = '<div class="loading">加载中...</div>';
                        const articles = await this.db.getArticles();
                        if (articles.length === 0) {
                            list.innerHTML = '<p class="empty-state">还没有文章，去上传吧</p>';
                            return;
                        }
                        let html = '';
                        for (const article of articles) {
                            const pct = Math.round((article.currentPosition || 0) * 100);
                            const date = new Date(article.createdAt).toLocaleDateString('zh-CN');
                            html += `
                                <div class="reading-card" data-id="${article.id}">
                                    <div class="reading-card-icon"><i class="fas fa-file-alt"></i></div>
                                    <div class="reading-card-body">
                                        <div class="reading-card-title">${this.escapeHtml(article.title)}</div>
                                        <div class="reading-card-meta">${article.wordCount || 0} 词 · ${date}</div>
                                        <div class="reading-card-progress">
                                            <div class="reading-card-progress-fill" style="width:${pct}%"></div>
                                        </div>
                                    </div>
                                    <button class="reading-card-delete" data-id="${article.id}" title="删除">
                                        <i class="fas fa-trash-alt"></i>
                                    </button>
                                </div>
                            `;
                        }
                        list.innerHTML = html;
                        // 点击卡片进入阅读
                        list.querySelectorAll('.reading-card').forEach(card => {
                            card.addEventListener('click', (e) => {
                                if (e.target.closest('.reading-card-delete')) return;
                                const id = card.dataset.id;
                                this.currentReadingArticleId = id;
                                this.switchPage('reader');
                            });
                            // 删除按钮
                            card.querySelector('.reading-card-delete').addEventListener('click', async (e) => {
                                e.stopPropagation();
                                const id = card.dataset.id;
                                if (!confirm('确定要删除这篇文章吗？')) return;
                                await this.db.deleteArticle(id);
                                this.showNotification('文章已删除', 'success');
                                await this.loadReadingList();
                            });
                        });
                    } catch (error) {
                        console.error('加载阅读列表失败:', error);
                        const list = document.getElementById('readingList');
                        if (list) list.innerHTML = '<div class="error-state">加载失败</div>';
                    }
                }

                async loadReader() {
                    const id = this.currentReadingArticleId;
                    if (!id) { this.switchPage('reading'); return; }
                    try {
                        const article = await this.db.getArticle(id);
                        if (!article) {
                            this.showNotification('文章不存在', 'error');
                            this.switchPage('reading');
                            return;
                        }
                        this.currentReadingArticle = article;
                        // 若文章未分段（纯文本），按段落换行
                        let displayText = article.content;
                        const titleEl = document.getElementById('readerTitle');
                        const textEl = document.getElementById('readerText');
                        const progressBar = document.getElementById('readerProgressBar');
                        if (titleEl) titleEl.textContent = article.title;
                        if (textEl) {
                            this.readerParagraphs = [];
                            let charPos = 0;
                            const lines = displayText.split('\n');
                            textEl.innerHTML = '';
                            for (const line of lines) {
                                const len = line.length;
                                if (line.trim()) {
                                    const p = document.createElement('p');
                                    p.dataset.para = this.readerParagraphs.length;
                                    p.textContent = line;
                                    textEl.appendChild(p);
                                    this.makeClickable(p);
                                    this.readerParagraphs.push({ el: p, start: charPos, end: charPos + len });
                                }
                                charPos += len + 1;
                            }
                        }
                        // 恢复上次阅读位置
                        const pct = article.currentPosition || 0;
                        if (pct > 0) {
                            setTimeout(() => {
                                const restore = () => {
                                    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
                                    if (maxScroll > 0) window.scrollTo(0, pct * maxScroll);
                                };
                                restore();
                                requestAnimationFrame(restore);
                            }, 100);
                        }
                        // 绑定阅读器事件
                        this.bindReaderEvents();
                        // 加载字体设置
                        const savedSize = await this.db.getSetting('readerFontSize', 18);
                        this.currentReaderFontSize = savedSize;
                        const sizeDisplay = document.getElementById('readerFontSize');
                        if (textEl) textEl.style.fontSize = savedSize + 'px';
                        if (sizeDisplay) sizeDisplay.textContent = savedSize;
                    } catch (error) {
                        console.error('加载阅读器失败:', error);
                        this.showNotification('加载文章失败', 'error');
                    }
                }

                bindReaderEvents() {
                    if (this._readerEventsBound) return;
                    this._readerEventsBound = true;
                    const backBtn = document.getElementById('readerBackBtn');
                    const fontMinus = document.getElementById('readerFontMinus');
                    const fontPlus = document.getElementById('readerFontPlus');
                    const playBtn = document.getElementById('readerPlayBtn');
                    const pauseBtn = document.getElementById('readerPauseBtn');
                    const stopBtn = document.getElementById('readerStopBtn');
                    const deleteBtn = document.getElementById('readerDeleteBtn');
                    const toggleBtn = document.getElementById('readerToggleBtn');
                    const toolbar = document.getElementById('readerToolbar');
                    const textEl = document.getElementById('readerText');

                    // 返回
                    const goBack = () => {
                        this.stopReaderTTS();
                        this.saveCurrentReadingPosition();
                        this.switchPage('reading');
                    };
                    backBtn?.addEventListener('click', goBack);

                    // 字体大小
                    fontMinus?.addEventListener('click', () => this.changeReaderFontSize(-2));
                    fontPlus?.addEventListener('click', () => this.changeReaderFontSize(2));

                    // 工具栏折叠/展开
                    toggleBtn?.addEventListener('click', () => {
                        toolbar?.classList.toggle('collapsed');
                        const icon = toggleBtn.querySelector('i');
                        if (icon) icon.className = toolbar?.classList.contains('collapsed') ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
                    });

                    // 全文 TTS 朗读
                    playBtn?.addEventListener('click', () => this.readerPlay(this.currentReadingArticle));

                    pauseBtn?.addEventListener('click', () => {
                        const tts = this.readerTTS;
                        if (!tts) return;
                        if (tts.engine === 'mimo') {
                            if (tts.paused) {
                                this.mimoResume();
                                tts.paused = false;
                                tts.playing = true;
                                this.updateTTSBtnState();
                                this._startMimoProgressLoop();
                                if (!tts.active) {
                                    this._mimoReadChunk(tts.waitingIndex != null ? tts.waitingIndex : tts.index + 1);
                                }
                            } else {
                                this.mimoPause();
                                tts.paused = true;
                                tts.playing = false;
                                this.updateTTSBtnState();
                            }
                            return;
                        }
                        if (this._isAndroid) {
                            if (tts.paused) {
                                tts.paused = false;
                                tts.playing = true;
                                this.updateTTSBtnState();
                                this.speakReaderChunk(tts.index);
                            } else {
                                tts.paused = true;
                                tts.playing = false;
                                this.speechSynthesis?.cancel();
                                this.updateTTSBtnState();
                            }
                            return;
                        }
                        if (tts.paused) {
                            this.speechSynthesis?.resume();
                            tts.paused = false;
                            tts.playing = true;
                        } else {
                            this.speechSynthesis?.pause();
                            tts.paused = true;
                        }
                        this.updateTTSBtnState();
                    });

                    stopBtn?.addEventListener('click', () => this.stopReaderTTS());

                    // 删除
                    deleteBtn?.addEventListener('click', async () => {
                        const cur = this.currentReadingArticle;
                        if (!cur) return;
                        if (!confirm(`确定要删除"${cur.title}"吗？`)) return;
                        await this.db.deleteArticle(cur.id);
                        this.showNotification('文章已删除', 'success');
                        this.switchPage('reading');
                    });

                    // 点击单词查词（通过全局 click 委托实现，见 bindEvents）
                }

                changeReaderFontSize(delta) {
                    const textEl = document.getElementById('readerText');
                    const newSize = (this.currentReaderFontSize || 18) + delta;
                    if (newSize < 12 || newSize > 32) return;
                    this.currentReaderFontSize = newSize;
                    if (textEl) textEl.style.fontSize = newSize + 'px';
                    const disp = document.getElementById('readerFontSize');
                    if (disp) disp.textContent = newSize;
                    this.db.saveSetting('readerFontSize', newSize);
                }

                async saveCurrentReadingPosition() {
                    const article = this.currentReadingArticle;
                    if (!article || this.currentReadingScrollPct == null) return;
                    await this.db.updateArticlePosition(article.id, this.currentReadingScrollPct);
                }

                // ===== MiMo 云端 TTS (mimo-v2.5-tts) =====
                _mimoEnsureCtx() {
                    const AC = window.AudioContext || window.webkitAudioContext;
                    if (!AC) return null;
                    if (!this._mimoCtx) {
                        this._mimoCtx = new AC();
                    }
                    if (this._mimoCtx.state === 'suspended') {
                        this._mimoCtx.resume();
                    }
                    return this._mimoCtx;
                }

                _decodePCM16(base64) {
                    try {
                        const raw = atob(base64);
                        const n = raw.length - (raw.length % 2);
                        if (n <= 0) return null;
                        const buf = new ArrayBuffer(n);
                        const u8 = new Uint8Array(buf);
                        for (let i = 0; i < n; i++) u8[i] = raw.charCodeAt(i);
                        const i16 = new Int16Array(buf);
                        const out = new Float32Array(i16.length);
                        for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 32768;
                        return out;
                    } catch (e) {
                        return null;
                    }
                }

                async _mimoStream(text, voice, style, styleCustom) {
                    const apiKey = this.mimoConfig.apiKey;
                    if (!apiKey) throw new Error('未配置 MiMo API Key');
                    const messages = [];
                    if (style === 'custom' && styleCustom && styleCustom.trim()) {
                        messages.push({ role: 'user', content: styleCustom.trim() });
                    }
                    let content = text;
                    if (style && style !== 'standard' && style !== 'custom' && style !== 'follow') {
                        content = `(${style})${content}`;
                    }
                    messages.push({ role: 'assistant', content });
                    const body = {
                        model: 'mimo-v2.5-tts',
                        messages,
                        audio: { format: 'pcm16', voice: voice || 'mimo_default' },
                        stream: true
                    };
                    const res = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'api-key': apiKey,
                            'Authorization': 'Bearer ' + apiKey
                        },
                        body: JSON.stringify(body),
                        signal: this._mimoAborter ? this._mimoAborter.signal : undefined
                    });
                    if (!res.ok) {
                        let msg = 'HTTP ' + res.status;
                        try {
                            const j = await res.json();
                            msg = (j && j.error && j.error.message) || msg;
                        } catch (e) {}
                        throw new Error(msg);
                    }
                    return res;
                }

                mimoSpeak({ text, voice, rate, style, styleCustom, onStart, onEnd, onError, collect }) {
                    const ctx = this._mimoEnsureCtx();
                    if (!ctx) {
                        if (onError) onError('当前浏览器不支持 Web Audio');
                        return;
                    }
                    this.mimoStop();
                    this._mimoAborter = new AbortController();
                    const sources = [];
                    this._mimoSources = sources;
                    this._mimoSession = null;
                    let started = false;
                    let nextTime = 0;
                    const schedulePCM = (pcmBase64) => {
                        if (typeof collect === 'function') {
                            try { collect(pcmBase64); } catch (e) {}
                        }
                        const float32 = this._decodePCM16(pcmBase64);
                        if (!float32 || float32.length === 0) return;
                        const buffer = ctx.createBuffer(1, float32.length, 24000);
                        buffer.copyToChannel(float32, 0);
                        const src = ctx.createBufferSource();
                        src.buffer = buffer;
                        src.playbackRate.value = rate || 1;
                        src.connect(ctx.destination);
                        if (!started) {
                            started = true;
                            nextTime = Math.max(ctx.currentTime + 0.05, nextTime);
                            this._mimoSession = { started: true, startedAt: nextTime, endAt: nextTime };
                            if (onStart) onStart();
                        } else {
                            nextTime = Math.max(ctx.currentTime, nextTime);
                            if (this._mimoSession) this._mimoSession.endAt = nextTime;
                        }
                        src.start(nextTime);
                        nextTime += buffer.duration;
                        if (this._mimoSession) this._mimoSession.endAt = nextTime;
                        sources.push(src);
                    };
                    this._mimoStream(text, voice, style, styleCustom).then((res) => {
                        const reader = res.body.getReader();
                        const decoder = new TextDecoder('utf-8');
                        let buf = '';
                        const flushLine = (line) => {
                            const t = line.trim();
                            if (!t || !t.startsWith('data:')) return;
                            const data = t.slice(5).trim();
                            if (!data || data === '[DONE]') return;
                            try {
                                const json = JSON.parse(data);
                                const delta = json && json.choices && json.choices[0] && json.choices[0].delta;
                                const audio = delta && delta.audio;
                                if (audio && typeof audio === 'object' && audio.data) {
                                    schedulePCM(audio.data);
                                }
                            } catch (e) {}
                        };
                        const pump = () => {
                            return reader.read().then(({ done, value }) => {
                                if (done) {
                                    if (buf.trim()) flushLine(buf);
                                    return;
                                }
                                buf += decoder.decode(value, { stream: true });
                                const lines = buf.split('\n');
                                buf = lines.pop();
                                lines.forEach(flushLine);
                                return pump();
                            });
                        };
                        return pump();
                    }).then(() => {
                        this._mimoAborter = null;
                        if (onEnd) {
                            if (started && this._mimoSession) {
                                const last = sources[sources.length - 1];
                                if (last) {
                                    last.onended = () => {
                                        const idx = sources.indexOf(last);
                                        if (idx !== -1) sources.splice(idx, 1);
                                        if (onEnd) onEnd();
                                    };
                                } else {
                                    if (onEnd) onEnd();
                                }
                            } else {
                                if (onEnd) onEnd();
                            }
                        }
                    }).catch((err) => {
                        this._mimoAborter = null;
                        if (err && err.name === 'AbortError') return;
                        sources.forEach(src => {
                            try { src.stop(); } catch (e) {}
                            try { src.disconnect(); } catch (e) {}
                        });
                        if (onError) onError((err && err.message) || String(err));
                    });
                }

                // 把多段 base64 PCM 分片拼接为一段完整音频（用于缓存）
                concatBase64Chunks(chunks) {
                    try {
                        const list = Array.isArray(chunks) ? chunks : [];
                        if (!list.length) return '';
                        let binary = '';
                        for (const chunk of list) {
                            const part = atob(chunk);
                            for (let i = 0; i < part.length; i += 8192) {
                                binary += part.substr(i, 8192);
                            }
                        }
                        return btoa(binary);
                    } catch (e) {
                        return '';
                    }
                }

                // 播放一段完整的 base64 PCM16 音频（缓存命中时使用）
                mimoPlayPcm(base64, options = {}) {
                    const ctx = this._mimoEnsureCtx();
                    if (!ctx) {
                        if (options.onError) options.onError('当前浏览器不支持 Web Audio');
                        return;
                    }
                    this.mimoStop();
                    const float32 = this._decodePCM16(base64);
                    if (!float32 || float32.length === 0) {
                        if (options.onError) options.onError('音频数据无效');
                        return;
                    }
                    const buffer = ctx.createBuffer(1, float32.length, 24000);
                    buffer.copyToChannel(float32, 0);
                    const src = ctx.createBufferSource();
                    src.buffer = buffer;
                    src.playbackRate.value = options.rate || 1;
                    src.connect(ctx.destination);
                    this._mimoSources = [src];
                    src.onended = () => {
                        if (options.onEnd) options.onEnd();
                    };
                    src.start();
                    if (options.onStart) options.onStart();
                }

                mimoStop() {
                    if (this._mimoAborter) {
                        try { this._mimoAborter.abort(); } catch (e) {}
                        this._mimoAborter = null;
                    }
                    this._mimoSources.forEach(src => {
                        try { src.onended = null; } catch (e) {}
                        try { src.stop(); } catch (e) {}
                        try { src.disconnect(); } catch (e) {}
                    });
                    this._mimoSources = [];
                    this._mimoSession = null;
                }

                mimoPause() {
                    if (this._mimoCtx && this._mimoCtx.state === 'running') {
                        this._mimoCtx.suspend();
                    }
                }

                mimoResume() {
                    if (this._mimoCtx && this._mimoCtx.state === 'suspended') {
                        this._mimoCtx.resume();
                    }
                }

                mimoProgress() {
                    const session = this._mimoSession;
                    if (!session || !session.started || !session.startedAt || !this._mimoCtx) return null;
                    const dur = session.endAt - session.startedAt;
                    if (dur <= 0) return null;
                    const pct = (this._mimoCtx.currentTime - session.startedAt) / dur;
                    return Math.max(0, Math.min(1, pct));
                }

                async _mimoReadChunk(index) {
                    const tts = this.readerTTS;
                    if (!tts || tts.engine !== 'mimo') return;
                    if (index >= tts.chunks.length) {
                        this.stopReaderTTS();
                        return;
                    }
                    if (tts.paused) {
                        tts.waitingIndex = index;
                        return;
                    }
                    const chunk = tts.chunks[index];
                    tts.index = index;
                    tts.waitingIndex = null;
                    tts.active = true;
                    tts.playing = true;
                    this.updateTTSBtnState();
                    this._startMimoProgressLoop();
                    await this.mimoSpeak({
                        text: chunk.text,
                        voice: this.mimoConfig.voice,
                        style: this.mimoConfig.style,
                        styleCustom: this.mimoConfig.styleCustom,
                        rate: tts.rate,
                        onStart: () => {
                            const cur = this.readerTTS;
                            if (!cur || cur !== tts) return;
                            cur.active = true;
                            cur.playing = true;
                            this.updateTTSBtnState();
                            this._showReadingChunk(chunk, tts.total);
                            this._startMimoProgressLoop();
                        },
                        onEnd: () => {
                            const cur = this.readerTTS;
                            if (!cur || cur !== tts) return;
                            cur.active = false;
                            this._mimoReadChunk(index + 1);
                        },
                        onError: (msg) => {
                            const cur = this.readerTTS;
                            if (!cur || cur !== tts) return;
                            cur.active = false;
                            cur.failed = (cur.failed || 0) + 1;
                            this.showNotification('MiMo 朗读失败: ' + msg, 'error');
                            this._mimoReadChunk(index + 1);
                        }
                    });
                }

                _startMimoProgressLoop() {
                    if (this._mimoProgressRaf) return;
                    const tick = () => {
                        this._mimoProgressRaf = null;
                        const tts = this.readerTTS;
                        if (!tts || tts.engine !== 'mimo' || !tts.playing) return;
                        const chunkPct = this.mimoProgress();
                        if (chunkPct != null) {
                            const chunk = tts.chunks[tts.index];
                            const totalLen = tts.total || 1;
                            const pct = chunk ? (chunk.offset + chunkPct * chunk.text.length) / totalLen : chunkPct;
                            const bar = document.getElementById('readerProgressBar');
                            if (bar) bar.style.width = (pct * 100) + '%';
                        }
                        this._mimoProgressRaf = requestAnimationFrame(tick);
                    };
                    this._mimoProgressRaf = requestAnimationFrame(tick);
                }

                // ===== 阅读器 TTS =====
                buildTTSChunks(content, maxChars) {
                    const MAX = maxChars || 400;
                    const chunks = [];
                    let pos = 0;
                    const total = content.length;
                    while (pos < total) {
                        const newline = content.indexOf('\n', pos);
                        const paraEnd = newline === -1 ? total : newline;
                        const para = content.slice(pos, paraEnd);
                        if (para.trim()) {
                            let start = 0;
                            const len = para.length;
                            while (start < len) {
                                let end = Math.min(start + MAX, len);
                                if (end < len) {
                                    const period = para.lastIndexOf('. ', end - 1);
                                    if (period > start) {
                                        end = period + 1;
                                    } else {
                                        const space = para.lastIndexOf(' ', end);
                                        if (space > start) end = space;
                                    }
                                }
                                const text = para.slice(start, end);
                                if (text.trim()) {
                                    chunks.push({ text, offset: pos + start });
                                }
                                if (end === start) break;
                                start = end;
                            }
                        }
                        pos = paraEnd + 1;
                    }
                    return chunks;
                }

                async readerPlay(article) {
                    if (!article?.content) {
                        this.showNotification('无内容可朗读', 'warning');
                        return;
                    }
                    if (this.readerTTS?.playing) return;
                    if (this._readerStarting) return;
                    this._readerStarting = true;
                    try {
                        const engine = this.mimoConfig.engine;
                        if (engine === 'mimo') this._mimoEnsureCtx();
                        const speedSetting = (await this.db.getSetting('ttsSpeed')) || 0;
                        const rate = Math.max(0.3, Math.min(2, 1 + speedSetting * 0.07));
                        this.stopReaderTTS();
                        this.clearTTSTempHighlight();
                        const readPct = this.currentReadingScrollPct || (this.currentReadingArticle && this.currentReadingArticle.currentPosition) || 0;
                        if (engine === 'mimo') {
                            if (!this.mimoConfig.apiKey) {
                                this.showNotification('请先在设置中配置 MiMo API Key', 'warning');
                                return;
                            }
                            const chunks = this.buildTTSChunks(article.content, 3000);
                            if (chunks.length === 0) {
                                this.showNotification('无内容可朗读', 'warning');
                                return;
                            }
                            const startIndex = this._readerStartIndex(chunks, article.content.length, readPct);
                            this.readerTTS = {
                                engine: 'mimo',
                                playing: true,
                                paused: false,
                                active: false,
                                waitingIndex: null,
                                chunks,
                                index: startIndex,
                                total: article.content.length,
                                rate,
                                failed: 0
                            };
                            this.updateTTSBtnState();
                            this._mimoReadChunk(startIndex);
                            return;
                        }
                        const chunks = this.buildTTSChunks(article.content);
                        if (chunks.length === 0) {
                            this.showNotification('无内容可朗读', 'warning');
                            return;
                        }
                        if (!this.speechSynthesis) {
                            this.showNotification('语音合成不可用', 'warning');
                            return;
                        }
                        const speakerName = (await this.db.getSetting('ttsSpeaker')) || '';
                        let voice = null;
                        if (speakerName) voice = this.voices.find(v => v.name === speakerName) || null;
                        if (!voice) voice = this.voices.find(v => v.lang.startsWith('en')) || null;
                        const startIndex = this._readerStartIndex(chunks, article.content.length, readPct);
                        this.readerTTS = {
                            playing: true,
                            paused: false,
                            chunks,
                            index: startIndex,
                            total: article.content.length,
                            rate,
                            voice,
                            failed: 0
                        };
                        this.updateTTSBtnState();
                        this.speakReaderChunk(startIndex);
                    } finally {
                        this._readerStarting = false;
                    }
                }

                _readerStartIndex(chunks, total, pct) {
                    if (!pct || pct <= 0.001) return 0;
                    const target = pct * total;
                    for (let i = 0; i < chunks.length; i++) {
                        if (target < chunks[i].offset + chunks[i].text.length) return i;
                    }
                    return chunks.length - 1;
                }

                speakReaderChunk(index) {
                    const tts = this.readerTTS;
                    if (!tts) return;
                    if (index >= tts.chunks.length) {
                        const allFailed = tts.failed > 0 && tts.failed >= tts.chunks.length;
                        this.stopReaderTTS();
                        if (allFailed) {
                            this.showNotification('设备 TTS 朗读失败，请检查系统语音设置', 'error');
                        }
                        return;
                    }
                    if (tts.paused) return;
                    const chunk = tts.chunks[index];
                    const utterance = new SpeechSynthesisUtterance(chunk.text);
                    utterance.rate = tts.rate;
                    if (tts.voice) utterance.voice = tts.voice;
                    let started = false;
                    if (this._ttsStartTimer) {
                        clearTimeout(this._ttsStartTimer);
                        this._ttsStartTimer = null;
                    }
                    utterance.onstart = () => {
                        if (this._ttsStartTimer) {
                            clearTimeout(this._ttsStartTimer);
                            this._ttsStartTimer = null;
                        }
                        started = true;
                        if (!this.readerTTS || this.readerTTS !== tts) return;
                        if (tts.paused) return;
                        this._showReadingChunk(chunk, tts.total);
                    };
                    utterance.onend = () => {
                        if (this._ttsStartTimer) {
                            clearTimeout(this._ttsStartTimer);
                            this._ttsStartTimer = null;
                        }
                        if (!this.readerTTS || this.readerTTS !== tts) return;
                        if (tts.paused) return;
                        this.speakReaderChunk(index + 1);
                    };
                    utterance.onerror = () => {
                        if (this._ttsStartTimer) {
                            clearTimeout(this._ttsStartTimer);
                            this._ttsStartTimer = null;
                        }
                        if (!this.readerTTS || this.readerTTS !== tts) return;
                        if (tts.paused) return;
                        tts.failed++;
                        this.speakReaderChunk(index + 1);
                    };
                    utterance.onpause = () => {
                        if (!this.readerTTS || this.readerTTS !== tts) return;
                        tts.paused = true;
                        tts.playing = false;
                        this.updateTTSBtnState();
                    };
                    utterance.onresume = () => {
                        if (!this.readerTTS || this.readerTTS !== tts) return;
                        tts.paused = false;
                        tts.playing = true;
                        this.updateTTSBtnState();
                    };
                    tts.index = index;
                    this.speechSynthesis.speak(utterance);
                    if (!started) {
                        this._ttsStartTimer = setTimeout(() => {
                            this._ttsStartTimer = null;
                            if (!this.readerTTS || this.readerTTS !== tts) return;
                            if (tts.paused || started) return;
                            tts.failed++;
                            this.speechSynthesis.cancel();
                            this.speakReaderChunk(index + 1);
                        }, 4000);
                    }
                }

                stopReaderTTS() {
                    if (this._ttsStartTimer) {
                        clearTimeout(this._ttsStartTimer);
                        this._ttsStartTimer = null;
                    }
                    if (this.speechSynthesis) {
                        this.speechSynthesis.cancel();
                    }
                    this.mimoStop();
                    if (this._mimoProgressRaf) {
                        cancelAnimationFrame(this._mimoProgressRaf);
                        this._mimoProgressRaf = null;
                    }
                    this.readerTTS = null;
                    this.clearTTSTempHighlight();
                    this.updateTTSBtnState();
                }

                updateTTSBtnState() {
                    const playBtn = document.getElementById('readerPlayBtn');
                    const pauseBtn = document.getElementById('readerPauseBtn');
                    const stopBtn = document.getElementById('readerStopBtn');
                    if (!this.readerTTS || !this.readerTTS.playing) {
                        if (playBtn) playBtn.style.display = '';
                        if (pauseBtn) pauseBtn.style.display = 'none';
                        if (stopBtn) stopBtn.style.display = 'none';
                    } else {
                        if (playBtn) playBtn.style.display = 'none';
                        if (pauseBtn) pauseBtn.style.display = '';
                        if (stopBtn) stopBtn.style.display = '';
                    }
                }

                clearTTSTempHighlight() {
                    document.querySelectorAll('.tts-temp-highlight').forEach(el => el.classList.remove('tts-temp-highlight'));
                    document.querySelectorAll('#readerText > p.reader-speaking').forEach(el => el.classList.remove('reader-speaking'));
                }

                _paraForOffset(offset) {
                    const paras = this.readerParagraphs;
                    if (!paras || paras.length === 0) return null;
                    for (let i = 0; i < paras.length; i++) {
                        if (offset < paras[i].end) return paras[i];
                    }
                    return paras[paras.length - 1];
                }

                _showReadingChunk(chunk, total) {
                    document.querySelectorAll('#readerText > p.reader-speaking').forEach(el => el.classList.remove('reader-speaking'));
                    const para = this._paraForOffset(chunk.offset);
                    if (para && para.el) {
                        para.el.classList.add('reader-speaking');
                        const rect = para.el.getBoundingClientRect();
                        const vh = window.innerHeight || 600;
                        if (rect.top < 0 || rect.bottom > vh) {
                            para.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        }
                    }
                    const bar = document.getElementById('readerProgressBar');
                    if (bar) {
                        const pct = Math.min((chunk.offset + chunk.text.length) / (total || 1), 1);
                        bar.style.width = (pct * 100) + '%';
                    }
                }

                escapeHtml(str) {
                    const div = document.createElement('div');
                    div.textContent = str;
                    return div.innerHTML;
                }

                // HTML 属性转义：escapeHtml 不转义引号，属性里必须再补一次
                escapeAttr(str) {
                    return this.escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                }

                // 通用：把容器内所有文本节点的英文单词包成可点击 span（保留中文/标点/HTML 结构）
                // 跳过 button/a/input/textarea/script/style 及已包装的 .clickable-word 子树，避免破坏交互与重复包装
                makeClickable(containerEl) {
                    if (!containerEl || !document.createTreeWalker) return;
                    const skipTags = { BUTTON: 1, A: 1, INPUT: 1, TEXTAREA: 1, SCRIPT: 1, STYLE: 1 };
                    const walker = document.createTreeWalker(
                        containerEl,
                        NodeFilter.SHOW_TEXT,
                        {
                            acceptNode(node) {
                                const parent = node.parentElement;
                                if (!parent) return NodeFilter.FILTER_REJECT;
                                if (skipTags[parent.tagName]) return NodeFilter.FILTER_REJECT;
                                if (parent.closest('button, a, .clickable-word')) return NodeFilter.FILTER_REJECT;
                                if (!/[a-zA-Z]/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
                                return NodeFilter.FILTER_ACCEPT;
                            }
                        }
                    );
                    const nodes = [];
                    while (walker.nextNode()) nodes.push(walker.currentNode);
                    const wordRe = /([a-zA-Z][a-zA-Z'-]*)/g;
                    for (const node of nodes) {
                        const text = node.nodeValue;
                        wordRe.lastIndex = 0;
                        let m;
                        let hasMatch = false;
                        const frag = document.createDocumentFragment();
                        let lastIdx = 0;
                        while ((m = wordRe.exec(text)) !== null) {
                            hasMatch = true;
                            if (m.index > lastIdx) {
                                frag.appendChild(document.createTextNode(text.slice(lastIdx, m.index)));
                            }
                            const span = document.createElement('span');
                            span.className = 'clickable-word';
                            span.dataset.word = m[0];
                            span.textContent = m[0];
                            frag.appendChild(span);
                            lastIdx = m.index + m[0].length;
                        }
                        if (!hasMatch) continue;
                        if (lastIdx < text.length) {
                            frag.appendChild(document.createTextNode(text.slice(lastIdx)));
                        }
                        node.parentNode.replaceChild(frag, node);
                    }
                }

                // ===== 听力模块 =====
                _resolveListeningTTSConfig() {
                    const voiceSel = document.getElementById('listeningVoice')?.value;
                    const styleSel = document.getElementById('listeningStyle')?.value;
                    const customInput = document.getElementById('listeningStyleCustom')?.value;
                    let voice = this.mimoConfig.voice;
                    let style = this.mimoConfig.style || 'standard';
                    let styleCustom = this.mimoConfig.styleCustom || '';
                    if (voiceSel && voiceSel !== 'follow') voice = voiceSel;
                    if (styleSel && styleSel !== 'follow') {
                        if (styleSel === 'custom') {
                            style = 'custom';
                            styleCustom = (customInput || '').trim();
                        } else {
                            style = styleSel;
                        }
                    }
                    return { voice, style, styleCustom };
                }

                async generateListeningAudio() {
                    if (!this.novelFileContent) {
                        this.showNotification('请先选择文件', 'error');
                        return;
                    }
                    if (!this.mimoConfig.apiKey) {
                        this.showNotification('请先在设置中配置 MiMo API Key', 'warning');
                        return;
                    }
                    if (this._listeningGenAborter) {
                        this.showNotification('正在生成中，请等待', 'warning');
                        return;
                    }

                    const btn = document.getElementById('listeningGenBtn');
                    const progressWrap = document.getElementById('listeningGenProgress');
                    const progressBar = document.getElementById('listeningGenProgressBar');
                    const progressText = document.getElementById('listeningGenProgressText');

                    if (btn) btn.disabled = true;
                    if (progressWrap) progressWrap.style.display = 'block';

                    try {
                        const chunker = new TextChunker();
                        const chunks = chunker.splitText(this.novelFileContent);
                        if (chunks.length === 0) {
                            this.showNotification('文件内容为空', 'error');
                            return;
                        }

                        const fileName = this.novelFileName || '未命名';
                        const title = fileName.replace(/\.(txt|md|html|htm)$/i, '');

                        // 检测同名未完成任务，优先续传而非新建
                        const existingFiles = await this.db.getListeningFiles();
                        const pending = existingFiles.find(f => f.title === title && f.status === 'generating');
                        if (pending && (pending.generatedSegments || 0) < (pending.segmentCount || 0)) {
                            if (!confirm(`检测到「${title}」存在未完成的听力生成（${pending.generatedSegments || 0}/${pending.segmentCount || 0} 段），是否继续生成？`)) {
                                return;
                            }
                            this.showNotification('正在继续生成...', 'info');
                            await this.resumeListeningGeneration(pending.id, { progressWrap, progressBar, progressText });
                            this.novelFileContent = null;
                            this.novelFileName = null;
                            this.switchPage('listening');
                            return;
                        }

                        const ttsCfg = this._resolveListeningTTSConfig();
                        const fileId = await this.db.saveListeningFile({
                            title,
                            content: this.novelFileContent,
                            totalDuration: 0,
                            segmentCount: chunks.length,
                            ttsVoice: ttsCfg.voice,
                            ttsStyle: ttsCfg.style,
                            ttsStyleCustom: ttsCfg.styleCustom
                        });

                        if (progressText) progressText.textContent = `共 ${chunks.length} 段，准备生成...`;

                        await this._generateListeningSegments(fileId, chunks, {
                            progressWrap,
                            progressBar,
                            progressText
                        });

                        this.novelFileContent = null;
                        this.novelFileName = null;
                        this.switchPage('listening');
                    } catch (err) {
                        console.error('生成听力音频失败:', err);
                        this.showNotification('生成失败: ' + err.message, 'error');
                    } finally {
                        this._listeningGenAborter = null;
                        if (btn) btn.disabled = false;
                        if (progressBar) progressBar.style.width = '100%';
                    }
                }

                async _generateListeningSegments(fileId, chunks, ui = {}) {
                    const { progressBar, progressText } = ui;
                    const generator = new TTSGenerator();
                    this._listeningGenAborter = generator;

                    const file = await this.db.getListeningFile(fileId);
                    const voice = (file && file.ttsVoice) || this.mimoConfig.voice;
                    const style = (file && file.ttsStyle) || 'standard';
                    const styleCustom = (file && file.ttsStyleCustom) || '';

                    const existing = await this.db.getAudioSegmentsByFile(fileId);
                    const existingIndexes = new Set(existing.map(s => s.segmentIndex));
                    const totalChunks = chunks.length;

                    let totalDuration = (existing || []).reduce((sum, s) => sum + (s.duration || 0), 0);
                    let doneCount = existing.length;
                    let failed = 0;

                    await this.db.updateListeningFileStatus(fileId, {
                        status: 'generating',
                        segmentCount: totalChunks,
                        generatedSegments: doneCount,
                        totalDuration
                    });

                    for (let i = 0; i < totalChunks; i++) {
                        if (this._listeningGenAborter !== generator) {
                            throw new Error('生成已中止');
                        }
                        if (existingIndexes.has(i)) continue;

                        if (progressText) progressText.textContent = `正在生成 Part ${i + 1}/${totalChunks}...`;
                        if (progressBar) progressBar.style.width = (Math.min(i, totalChunks) / totalChunks) * 100 + '%';

                        try {
                            const { wavBlob, duration } = await generator.streamToWav(
                                chunks[i].text,
                                this.mimoConfig.apiKey,
                                voice,
                                style,
                                styleCustom
                            );

                            await this.db.saveAudioSegment({
                                fileId,
                                segmentIndex: i,
                                title: `Part ${i + 1}`,
                                text: chunks[i].text,
                                duration,
                                audioBlob: wavBlob
                            });

                            totalDuration += duration;
                            doneCount++;
                            await this.db.updateListeningFileStatus(fileId, {
                                generatedSegments: doneCount,
                                totalDuration
                            });
                            existingIndexes.add(i);
                        } catch (err) {
                            console.error(`生成 Part ${i + 1} 失败:`, err);
                            failed++;
                            if (failed <= 1) this.showNotification(`Part ${i + 1} 生成失败: ${err.message}，将自动重试`, 'error');
                            await new Promise(r => setTimeout(r, 800));
                            try {
                                const { wavBlob, duration } = await generator.streamToWav(
                                    chunks[i].text,
                                    this.mimoConfig.apiKey,
                                    voice,
                                    style,
                                    styleCustom
                                );
                                await this.db.saveAudioSegment({
                                    fileId,
                                    segmentIndex: i,
                                    title: `Part ${i + 1}`,
                                    text: chunks[i].text,
                                    duration,
                                    audioBlob: wavBlob
                                });
                                totalDuration += duration;
                                doneCount++;
                                await this.db.updateListeningFileStatus(fileId, {
                                    generatedSegments: doneCount,
                                    totalDuration
                                });
                                existingIndexes.add(i);
                            } catch (err2) {
                                console.error(`Part ${i + 1} 重试仍失败:`, err2);
                            }
                        }
                    }

                    const finalSegments = await this.db.getAudioSegmentsByFile(fileId);
                    const completed = finalSegments.length >= totalChunks && failed === 0;
                    await this.db.updateListeningFileStatus(fileId, {
                        status: completed ? 'complete' : 'generating',
                        segmentCount: totalChunks,
                        generatedSegments: finalSegments.length,
                        totalDuration
                    });

                    if (progressText) progressText.textContent = completed ? '生成完成！' : `生成中断，已生成 ${finalSegments.length}/${totalChunks} 段，可稍后继续`;
                    if (completed) this.showNotification(`听力音频已生成 (${totalChunks} 段)`, 'success');

                    return { completed, totalChunks, doneCount: finalSegments.length };
                }

                async resumeListeningGeneration(fileId, ui = {}) {
                    if (!this.mimoConfig.apiKey) {
                        this.showNotification('请先在设置中配置 MiMo API Key', 'warning');
                        return false;
                    }
                    if (this._listeningGenAborter) {
                        this.showNotification('正在生成中，请等待', 'warning');
                        return false;
                    }
                    const file = await this.db.getListeningFile(fileId);
                    if (!file) {
                        this.showNotification('文件不存在', 'error');
                        return false;
                    }
                    const chunker = new TextChunker();
                    const chunks = chunker.splitText(file.content || '');
                    if (chunks.length === 0) {
                        this.showNotification('文件内容为空', 'error');
                        return false;
                    }
                    try {
                        const result = await this._generateListeningSegments(fileId, chunks, ui);
                        return result.completed;
                    } finally {
                        this._listeningGenAborter = null;
                    }
                }

                _abortListeningGeneration() {
                    if (this._listeningGenAborter) {
                        try { this._listeningGenAborter.abort(); } catch (e) {}
                        this._listeningGenAborter = null;
                    }
                }

                async promptResumeListening() {
                    try {
                        const files = await this.db.getListeningFiles();
                        const pending = files.find(f => f.status === 'generating' && (f.generatedSegments || 0) < (f.segmentCount || 0));
                        if (!pending) return;
                        if (confirm(`检测到未完成的听力生成：「${pending.title}」(${pending.generatedSegments || 0}/${pending.segmentCount || 0} 段)，是否继续生成？`)) {
                            this.switchPage('listening');
                            const completed = await this.resumeListeningGeneration(pending.id);
                            if (completed) this.showNotification('听力续传完成', 'success');
                            else this.showNotification('本次未能全部生成，可稍后继续', 'warning');
                            if (this.currentPage === 'listening') await this.loadListeningList();
                        }
                    } catch (err) {
                        console.error('检查未完成听力任务失败:', err);
                    }
                }

                async loadListeningList() {
                    try {
                        const list = document.getElementById('listeningList');
                        if (!list) return;
                        list.innerHTML = '<div class="loading">加载中...</div>';
                        const files = await this.db.getListeningFiles();
                        if (files.length === 0) {
                            list.innerHTML = '<p class="empty-state">还没有听力文件，去上传吧</p>';
                            return;
                        }
                        let html = '';
                        for (const file of files) {
                            const dur = this._formatDuration(file.totalDuration || 0);
                            const date = new Date(file.createdAt).toLocaleDateString('zh-CN');
                            const incomplete = file.status === 'generating' && (file.generatedSegments || 0) < (file.segmentCount || 0);
                            const meta = incomplete
                                ? `${file.generatedSegments || 0}/${file.segmentCount || 0} 段 · 生成中 · ${date}`
                                : `${file.segmentCount || 0} 段 · ${dur} · ${date}`;
                            html += `
                                <div class="reading-card listening-card" data-id="${file.id}">
                                    <div class="reading-card-icon"><i class="fas fa-headphones"></i></div>
                                    <div class="reading-card-body">
                                        <div class="reading-card-title">${this.escapeHtml(file.title)}</div>
                                        <div class="reading-card-meta">${meta}</div>
                                        ${incomplete ? `
                                        <div class="listening-gen-progress">
                                            <div class="progress-bar-wrap">
                                                <div class="progress-bar" data-progress="listening" style="width:${(file.generatedSegments || 0) / (file.segmentCount || 1) * 100}%"></div>
                                            </div>
                                        </div>
                                        <button class="action-btn small primary listening-resume-btn" data-id="${file.id}">
                                            <i class="fas fa-play-circle"></i> 继续生成
                                        </button>` : ''}
                                    </div>
                                    <button class="reading-card-delete" data-id="${file.id}" title="删除">
                                        <i class="fas fa-trash-alt"></i>
                                    </button>
                                </div>
                            `;
                        }
                        list.innerHTML = html;
                        list.querySelectorAll('.listening-card').forEach(card => {
                            card.addEventListener('click', (e) => {
                                if (e.target.closest('.reading-card-delete')) return;
                                if (e.target.closest('.listening-resume-btn')) return;
                                const id = card.dataset.id;
                                this.currentListeningFileId = id;
                                this.switchPage('player');
                            });
                            card.querySelector('.reading-card-delete').addEventListener('click', async (e) => {
                                e.stopPropagation();
                                const id = card.dataset.id;
                                if (!confirm('确定要删除这个听力文件吗？')) return;
                                await this.db.deleteListeningFile(id);
                                this.showNotification('已删除', 'success');
                                await this.loadListeningList();
                            });
                            const resumeBtn = card.querySelector('.listening-resume-btn');
                            if (resumeBtn) {
                                resumeBtn.addEventListener('click', async (e) => {
                                    e.stopPropagation();
                                    const id = resumeBtn.dataset.id;
                                    resumeBtn.disabled = true;
                                    resumeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 生成中...';
                                    try {
                                        const completed = await this.resumeListeningGeneration(id, {
                                            progressBar: card.querySelector('[data-progress="listening"]')
                                        });
                                        if (completed) {
                                            this.showNotification('听力音频已生成', 'success');
                                        } else {
                                            this.showNotification('本次未能全部生成，可再次点击继续', 'warning');
                                        }
                                    } catch (err) {
                                        console.error('继续生成失败:', err);
                                        this.showNotification('继续生成失败: ' + err.message, 'error');
                                    } finally {
                                        await this.loadListeningList();
                                    }
                                });
                            }
                        });
                    } catch (error) {
                        console.error('加载听力列表失败:', error);
                        const list = document.getElementById('listeningList');
                        if (list) list.innerHTML = '<div class="error-state">加载失败</div>';
                    }
                }

                async loadPlayer() {
                    const id = this.currentListeningFileId;
                    if (!id) { this.switchPage('listening'); return; }
                    try {
                        const file = await this.db.getListeningFile(id);
                        if (!file) {
                            this.showNotification('文件不存在', 'error');
                            this.switchPage('listening');
                            return;
                        }
                        this.currentListeningFile = file;
                        const segments = await this.db.getAudioSegmentsByFile(id);
                        this.currentListeningSegments = segments;
                        let startIndex = parseInt(file.lastSegmentIndex) || 0;
                        if (startIndex < 0 || startIndex >= segments.length) startIndex = 0;
                        this.playerSegmentIndex = startIndex;
                        this._restorePlayerTime = (startIndex > 0 || (file.lastSegmentTime > 0)) ? (parseFloat(file.lastSegmentTime) || 0) : 0;

                        const titleEl = document.getElementById('playerTitle');
                        if (titleEl) titleEl.textContent = file.title;

                        const savedSpeed = await this.db.getSetting('playerSpeed', 1);
                        this.playerSpeed = (savedSpeed && savedSpeed >= 0.5 && savedSpeed <= 2) ? savedSpeed : 1;
                        const speedRange = document.getElementById('playerSpeedRange');
                        if (speedRange) speedRange.value = this.playerSpeed;
                        const speedValue = document.getElementById('playerSpeedValue');
                        if (speedValue) speedValue.textContent = this.playerSpeed.toFixed(1) + 'x';

                        this._renderSegmentList();
                        this._bindPlayerEvents();
                        this._loadSegment(startIndex);
                    } catch (err) {
                        console.error('加载播放器失败:', err);
                        this.showNotification('加载失败', 'error');
                        this.switchPage('listening');
                    }
                }

                _renderSegmentList() {
                    const listEl = document.getElementById('playerSegmentList');
                    if (!listEl) return;
                    const segments = this.currentListeningSegments;
                    if (!segments.length) {
                        listEl.innerHTML = '<p class="empty-state">无音频段</p>';
                        return;
                    }
                    let html = '';
                    for (let i = 0; i < segments.length; i++) {
                        const seg = segments[i];
                        const dur = this._formatDuration(seg.duration || 0);
                        const active = i === this.playerSegmentIndex ? ' active' : '';
                        html += `
                            <div class="player-segment-item${active}" data-index="${i}">
                                <span class="player-segment-name">${this.escapeHtml(seg.title || 'Part ' + (i + 1))}</span>
                                <span class="player-segment-dur">${dur}</span>
                                <span class="player-segment-download" data-download="${i}" title="下载此段">
                                    <i class="fas fa-download"></i>
                                </span>
                            </div>
                        `;
                    }
                    listEl.innerHTML = html;
                    listEl.querySelectorAll('.player-segment-item').forEach(item => {
                        item.addEventListener('click', () => {
                            const idx = parseInt(item.dataset.index);
                            this._loadSegment(idx);
                            this._playPlayer();
                        });
                        const dl = item.querySelector('.player-segment-download');
                        if (dl) {
                            dl.addEventListener('click', (e) => {
                                e.stopPropagation();
                                const idx = parseInt(dl.dataset.download);
                                const seg = this.currentListeningSegments[idx];
                                if (seg && seg.audioBlob) {
                                    const name = this.currentListeningFile
                                        ? `${this.currentListeningFile.title}-Part-${idx + 1}.wav`
                                        : `Part-${idx + 1}.wav`;
                                    this._downloadBlob(seg.audioBlob, name);
                                }
                            });
                        }
                    });
                }

                _downloadBlob(blob, filename) {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                }

                async _downloadMergedListening() {
                    const file = this.currentListeningFile;
                    if (!file) return;
                    const segments = this.currentListeningSegments;
                    if (!segments.length) {
                        this.showNotification('暂无音频可下载', 'warning');
                        return;
                    }
                    try {
                        this.showNotification('正在合成完整音频...', 'info');
                        const merged = await TTSGenerator.mergeWavBlobs(segments.map(s => s.audioBlob));
                        if (!merged) {
                            this.showNotification('合成失败：分段格式不兼容', 'error');
                            return;
                        }
                        this._downloadBlob(merged, `${file.title}.wav`);
                        this.showNotification('已开始下载', 'success');
                    } catch (err) {
                        console.error('下载完整音频失败:', err);
                        this.showNotification('下载失败: ' + err.message, 'error');
                    }
                }

                _bindPlayerEvents() {
                    if (this._playerEventsBound) return;
                    this._playerEventsBound = true;

                    document.getElementById('playerBackBtn')?.addEventListener('click', () => {
                        this.stopPlayer();
                        this.switchPage('listening');
                    });

                    document.getElementById('playerPlayBtn')?.addEventListener('click', () => this._playPlayer());
                    document.getElementById('playerPauseBtn')?.addEventListener('click', () => this._pausePlayer());
                    document.getElementById('playerRewindBtn')?.addEventListener('click', () => this._seekPlayer(-10));
                    document.getElementById('playerForwardBtn')?.addEventListener('click', () => this._seekPlayer(10));

                    document.getElementById('playerToggleBtn')?.addEventListener('click', () => {
                        const controls = document.querySelector('#playerPage .reader-controls');
                        if (controls) controls.style.display = controls.style.display === 'none' ? '' : 'none';
                    });

                    document.getElementById('playerProgressBarWrap')?.addEventListener('click', (e) => {
                        if (!this.playerAudio) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const pct = (e.clientX - rect.left) / rect.width;
                        this.playerAudio.currentTime = pct * this.playerAudio.duration;
                    });

                    document.getElementById('playerSpeedRange')?.addEventListener('input', (e) => {
                        const speed = parseFloat(e.target.value);
                        this.playerSpeed = speed;
                        if (this.playerAudio) this.playerAudio.playbackRate = speed;
                        const valEl = document.getElementById('playerSpeedValue');
                        if (valEl) valEl.textContent = speed.toFixed(1) + 'x';
                        this.db.saveSetting('playerSpeed', speed).catch(console.error);
                    });

                    document.getElementById('playerDeleteBtn')?.addEventListener('click', async () => {
                        if (!this.currentListeningFile) return;
                        if (!confirm('确定要删除这个听力文件吗？')) return;
                        const fileId = this.currentListeningFile.id;
                        this.stopPlayer();
                        await this.db.deleteListeningFile(fileId);
                        this.showNotification('已删除', 'success');
                        this.switchPage('listening');
                    });

                    document.getElementById('playerDownloadBtn')?.addEventListener('click', () => this._downloadMergedListening());
                }

                _loadSegment(index) {
                    const segments = this.currentListeningSegments;
                    if (index < 0 || index >= segments.length) return;

                    this._stopPlayerAudio();
                    this.playerSegmentIndex = index;
                    const seg = segments[index];

                    const segTitle = document.getElementById('playerSegmentTitle');
                    if (segTitle) segTitle.textContent = seg.title || `Part ${index + 1}`;

                    const timeEl = document.getElementById('playerCurrentTime');
                    const durEl = document.getElementById('playerDuration');
                    if (timeEl) timeEl.textContent = '0:00';
                    if (durEl) durEl.textContent = this._formatDuration(seg.duration || 0);

                    const bar = document.getElementById('playerProgressBar');
                    if (bar) bar.style.width = '0%';

                    if (seg.audioBlob) {
                        const url = URL.createObjectURL(seg.audioBlob);
                        this.playerAudio = new Audio(url);
                        this.playerAudio.playbackRate = this.playerSpeed;
                        this.playerAudio.addEventListener('ended', () => this._onSegmentEnded());
                        this.playerAudio.addEventListener('timeupdate', () => this._updatePlayerProgress());
                        if (this._restorePlayerTime > 0) {
                            const restoreTime = this._restorePlayerTime;
                            this.playerAudio.addEventListener('loadedmetadata', () => {
                                this.playerAudio.currentTime = Math.min(restoreTime, this.playerAudio.duration || 0);
                                this._updatePlayerProgress();
                            });
                        }
                    }
                    this._restorePlayerTime = 0;

                    this._renderSegmentList();
                    this._updateTotalProgress();
                }

                _playPlayer() {
                    if (!this.playerAudio) return;
                    this.playerAudio.play().catch(() => {});
                    this.playerPlaying = true;
                    const playBtn = document.getElementById('playerPlayBtn');
                    const pauseBtn = document.getElementById('playerPauseBtn');
                    if (playBtn) playBtn.style.display = 'none';
                    if (pauseBtn) pauseBtn.style.display = '';
                    this._startPlayerProgressLoop();
                }

                _pausePlayer() {
                    if (!this.playerAudio) return;
                    this._savePlayerPosition();
                    this.playerAudio.pause();
                    this.playerPlaying = false;
                    const playBtn = document.getElementById('playerPlayBtn');
                    const pauseBtn = document.getElementById('playerPauseBtn');
                    if (playBtn) playBtn.style.display = '';
                    if (pauseBtn) pauseBtn.style.display = 'none';
                    this._stopPlayerProgressLoop();
                }

                _stopPlayerAudio() {
                    if (this.playerAudio) {
                        this.playerAudio.pause();
                        this.playerAudio.src = '';
                        this.playerAudio = null;
                    }
                    this.playerPlaying = false;
                    this._stopPlayerProgressLoop();
                    const playBtn = document.getElementById('playerPlayBtn');
                    const pauseBtn = document.getElementById('playerPauseBtn');
                    if (playBtn) playBtn.style.display = '';
                    if (pauseBtn) pauseBtn.style.display = 'none';
                }

                stopPlayer() {
                    this._savePlayerPosition();
                    this._stopPlayerAudio();
                    this.currentListeningFile = null;
                    this.currentListeningSegments = [];
                    this.playerSegmentIndex = 0;
                    this._restorePlayerTime = 0;
                }

                _seekPlayer(seconds) {
                    if (!this.playerAudio) return;
                    this.playerAudio.currentTime = Math.max(0, Math.min(this.playerAudio.duration || 0, this.playerAudio.currentTime + seconds));
                }

                _onSegmentEnded() {
                    this.playerPlaying = false;
                    const playBtn = document.getElementById('playerPlayBtn');
                    const pauseBtn = document.getElementById('playerPauseBtn');
                    if (playBtn) playBtn.style.display = '';
                    if (pauseBtn) pauseBtn.style.display = 'none';
                    this._stopPlayerProgressLoop();

                    if (this.playerSegmentIndex < this.currentListeningSegments.length - 1) {
                        const nextIndex = this.playerSegmentIndex + 1;
                        if (this.currentListeningFile) {
                            this.db.updateListeningPosition(this.currentListeningFile.id, nextIndex, 0).catch(console.error);
                        }
                        this._loadSegment(nextIndex);
                        this._playPlayer();
                    } else {
                        this._savePlayerPosition();
                    }
                }

                _updatePlayerProgress() {
                    if (!this.playerAudio || !this.playerAudio.duration) return;
                    const pct = this.playerAudio.currentTime / this.playerAudio.duration;
                    const bar = document.getElementById('playerProgressBar');
                    if (bar) bar.style.width = (pct * 100) + '%';
                    const timeEl = document.getElementById('playerCurrentTime');
                    if (timeEl) timeEl.textContent = this._formatDuration(this.playerAudio.currentTime);
                    this._updateTotalProgress();
                    const now = Date.now();
                    if (now - this._lastPlayerPositionSave > 3000) {
                        this._lastPlayerPositionSave = now;
                        this._savePlayerPosition();
                    }
                }

                _savePlayerPosition() {
                    const file = this.currentListeningFile;
                    if (!file || !file.id) return;
                    const t = (this.playerAudio && this.playerAudio.currentTime) || 0;
                    this.db.updateListeningPosition(file.id, this.playerSegmentIndex, t).catch(console.error);
                }

                _startPlayerProgressLoop() {
                    if (this._playerTimeRaf) return;
                    const tick = () => {
                        this._playerTimeRaf = null;
                        if (!this.playerPlaying || !this.playerAudio) return;
                        this._updatePlayerProgress();
                        this._playerTimeRaf = requestAnimationFrame(tick);
                    };
                    this._playerTimeRaf = requestAnimationFrame(tick);
                }

                _stopPlayerProgressLoop() {
                    if (this._playerTimeRaf) {
                        cancelAnimationFrame(this._playerTimeRaf);
                        this._playerTimeRaf = null;
                    }
                }

                _updateTotalProgress() {
                    const el = document.getElementById('playerTotalProgress');
                    if (!el) return;
                    let elapsed = 0;
                    for (let i = 0; i < this.playerSegmentIndex; i++) {
                        elapsed += this.currentListeningSegments[i]?.duration || 0;
                    }
                    if (this.playerAudio) elapsed += this.playerAudio.currentTime || 0;
                    const total = this.currentListeningFile?.totalDuration || 0;
                    el.textContent = `总进度: ${this._formatDuration(elapsed)} / ${this._formatDuration(total)}`;
                }

                _formatDuration(seconds) {
                    if (!seconds || seconds <= 0) return '0:00';
                    const m = Math.floor(seconds / 60);
                    const s = Math.floor(seconds % 60);
                    return m + ':' + (s < 10 ? '0' : '') + s;
                }
            }

            window.app = new WordLearnerApp();
        })();
