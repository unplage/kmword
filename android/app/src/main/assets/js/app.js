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
                    this.speechSynthesis = null;
                    this.voices = [];
                    this.searchDebounceTimer = null;
                    this.isProcessing = false;
                    this.isStudyingNewWords = false;
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
                    this.mimoConfig = { engine: 'system', apiKey: '', voice: 'mimo_default' };
                    this._mimoCtx = null;
                    this._mimoSources = [];
                    this._mimoSession = null;
                    this._mimoAborter = null;

					// ===== 1. 修改 Free Dictionary API 解析 =====
					this.dictionaryAPI = {
						baseUrl: 'https://api.dictionaryapi.dev/api/v2/entries/en',
						cache: new Map(),
						async fetchWordData(word) {
							if (this.cache.has(word)) { return this.cache.get(word); }
							try {
								console.log(`正在获取单词"${word}"的数据...`);
								const response = await fetch(`${this.baseUrl}/${encodeURIComponent(word)}`);
								if (!response.ok) {
									if (response.status === 404) {
										const fallbackData = this.getFallbackData(word);
										this.cache.set(word, fallbackData);
										return fallbackData;
									}
									throw new Error(`API请求失败: ${response.status}`);
								}
								const data = await response.json();
								console.log(`单词"${word}"数据获取成功`);
								const parsedData = this.parseApiData(data, word);
								this.cache.set(word, parsedData);
								return parsedData;
							} catch (error) {
								console.error(`获取单词"${word}"数据失败:`, error);
								const fallbackData = this.getFallbackData(word);
								this.cache.set(word, fallbackData);
								return fallbackData;
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
					this.mwAPI = {
						dictBase: 'https://www.dictionaryapi.com/api/v3/references/collegiate/json',
						thesBase: 'https://www.dictionaryapi.com/api/v3/references/thesaurus/json',
						cleanMWText(text) {
							if (!text) return '';
							// 处理 {dx_ety}...{/dx_ety} 包裹，提取内部内容并递归清理
							let cleaned = text.replace(/\{dx_ety\}(.*?)\{\/dx_ety\}/g, (match, content) => {
								return this.cleanMWText(content);
							});
							// 处理 {dxt|word|...} => word
							cleaned = cleaned.replace(/\{dxt\|([^|]+)(?:\|[^}]*)?\}/g, '$1');
							// 处理 {a_link|word|...} => word  ← 新增
    						cleaned = cleaned.replace(/\{a_link\|([^|]+)(?:\|[^}]*)?\}/g, '$1');
							// 处理 {d_link|word|...} => word
							cleaned = cleaned.replace(/\{d_link\|([^|]+)(?:\|[^}]*)?\}/g, '$1');
							// 处理 {sx|word||} => word
							cleaned = cleaned.replace(/\{sx\|([^|]+)(?:\|[^}]*)?\}/g, '$1');
							// 处理 {et_link|word|...} => word
							cleaned = cleaned.replace(/\{et_link\|([^|]+)(?:\|[^}]*)?\}/g, '$1');
							// 移除其他 {....} 标签（如 {bc}, {it}, {/it}, {sc}, {ma}, {ds||1||} 等）
							cleaned = cleaned.replace(/\{.*?\}/g, '');
							// 清理多余的逗号和空格
							cleaned = cleaned.replace(/\s*,\s*,/g, ',');   // 多个逗号合并
							cleaned = cleaned.replace(/,\s*$/, '');        // 末尾逗号去除
							// 清理空括号
							cleaned = cleaned.replace(/\s*\(\s*,\s*\)/g, '');
							cleaned = cleaned.replace(/\s*\(\s*see\s*\)/g, '');
							// 移除 :数字 后缀（如 compare:1）
							//cleaned = cleaned.replace(/:\d+/g, '');
							return cleaned.trim();
						},
						getAudioUrl(audioId) {
							if (!audioId) return null;
							const subdir = /^\d/.test(audioId) ? 'number' : audioId.charAt(0);
							return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${subdir}/${audioId}.mp3`;
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
						},
						
						// --- 词典解析 ---
						parseDict(dictData) {
							if (!dictData || !Array.isArray(dictData) || dictData.length === 0) return null;
							if (typeof dictData[0] === 'string') return null;

							const extractSynonyms = (text) => {
								const syns = new Set();
								if (!text) return [];
								const scMatches = text.match(/\{sc\}([^{}]+)\{\/sc\}/g);
								if (scMatches) scMatches.forEach(m => syns.add(m.replace(/\{sc\}|\{\/sc\}/g, '').trim()));
								const sxMatches = text.match(/\{sx\|([^|]+)/g);
								if (sxMatches) sxMatches.forEach(m => syns.add(m.replace(/\{sx\|/, '').trim()));
								return Array.from(syns);
							};

							const cleanEtymology = (etData) => {
								if (!etData) return '';
								if (typeof etData === 'string') {
									return this.cleanMWText(etData);
								}
								if (Array.isArray(etData)) {
									// 如果数组第一个元素是字符串键名（如 "text", "et_snote"），则忽略它，只处理后续部分
									if (etData.length >= 2 && typeof etData[0] === 'string') {
										// 从索引1开始递归处理
										let parts = [];
										for (let i = 1; i < etData.length; i++) {
											let val = cleanEtymology(etData[i]);
											if (val) parts.push(val);
										}
										return parts.join(' ');
									}
									// 否则作为普通数组递归每个元素
									let parts = etData.map(item => cleanEtymology(item)).filter(Boolean);
									return parts.join(' ');
								}
								if (typeof etData === 'object') {
									// 如果有 text 属性，取 text
									if (etData.text) return cleanEtymology(etData.text);
									// 如果有 et_snote，递归处理
									if (etData.et_snote) return cleanEtymology(etData.et_snote);
									// 其他：遍历所有值
									let parts = Object.values(etData).map(val => cleanEtymology(val)).filter(Boolean);
									return parts.join(' ');
								}
								return '';
							};

							const parseSense = (senseData, parentLabel = '') => {
								const def = {
									senseNumber: senseData.sn || '',
									grammaticalLabel: senseData.sgram || '',
									definitionText: '',
									examples: [],
									subsenses: [],
									vdLabel: parentLabel
								};
								if (senseData.dt && Array.isArray(senseData.dt)) {
									senseData.dt.forEach(dtItem => {
										if (Array.isArray(dtItem) && dtItem.length === 2) {
											const type = dtItem[0]; const content = dtItem[1];
											if (type === 'text') { def.definitionText = this.cleanMWText(content); }
											else if (type === 'vis' && Array.isArray(content)) {
												content.forEach(visItem => { if (visItem.t) def.examples.push(this.cleanMWText(visItem.t)); });
											}
										}
									});
								}
								if (senseData.sdsense) {
									let subSenseList = senseData.sdsense;
									if (Array.isArray(subSenseList) && subSenseList.length > 0) { subSenseList = subSenseList[0]; }
									const prefix = subSenseList.sd ? this.cleanMWText(subSenseList.sd) + ': ' : '';
									const subDef = parseSense(subSenseList, parentLabel);
									subDef.definitionText = prefix + subDef.definitionText;
									def.subsenses.push(subDef);
								}
								return def;
							};

							return dictData.map(entry => {
								const result = {
									functionalLabel: this.cleanMWText(entry.fl || ''),
									pronunciation: this.cleanMWText(entry.hwi?.prs?.[0]?.mw || ''),
									definitions: [],
									synonymsList: [],
									synonymsInfo: { paragraphs: [], examples: [] },
									etymology: '',
									inflections: [],
									audioId: '',
									// ===== 新增 quotes 字段 =====
									quotes: [],
									stems: entry.meta?.stems ? entry.meta.stems.map(s => this.cleanMWText(s)) : [],
									derivedWords: entry.uros ? entry.uros.map(u => ({
										word: this.cleanMWText(u.ure || ''),
										partOfSpeech: this.cleanMWText(u.fl || '')
									})).filter(u => u.word): [],									
									date: entry.date ? this.cleanMWText(entry.date) : '',
									offensive: entry.meta?.offensive || false
								};
								if (entry.hwi?.prs) {
									const prs = entry.hwi.prs.find(p => p.sound?.audio);
									if (prs) result.audioId = prs.sound.audio;
								}
								if (entry.ins && Array.isArray(entry.ins)) { result.inflections = entry.ins.map(i => i.if).filter(Boolean); }

								// 解析 definitions
								if (entry.def && Array.isArray(entry.def)) {
									entry.def.forEach(defGroup => {
										const vdLabel = defGroup.vd ? this.cleanMWText(defGroup.vd) : '';
										if (defGroup.sseq && Array.isArray(defGroup.sseq)) {
											defGroup.sseq.forEach(sseqItem => {
												if (Array.isArray(sseqItem) && sseqItem.length > 0) {
													sseqItem.forEach(senseCandidate => {
														const type = senseCandidate[0];
														if ((type === 'sense' || type === 'bs') && senseCandidate[1]) {
															const senseData = type === 'bs' ? senseCandidate[1].sense : senseCandidate[1];
															if (senseData) { result.definitions.push(parseSense(senseData, vdLabel)); }
														}
													});
												}
											});
										}
										if (defGroup.bs && defGroup.bs.sense) { result.definitions.push(parseSense(defGroup.bs.sense, vdLabel)); }
									});
								}

								// 解析同义词
								if (entry.syns && Array.isArray(entry.syns)) {
									const allSynonyms = new Set(); const paragraphs = []; const examples = [];
									entry.syns.forEach(synBlock => {
										if (synBlock.pl === 'synonyms' && Array.isArray(synBlock.pt)) {
											synBlock.pt.forEach(item => {
												if (Array.isArray(item) && item[0] === 'text') {
													const text = item[1];
													// 不要调用 cleanMWText，直接 push 原始文本
													paragraphs.push(text);
													// 提取词头用于 synonymsList
													const scMatches = text.match(/\{sc\}([^{}]+)\{\/sc\}/g);
													if (scMatches) scMatches.forEach(m => allSynonyms.add(m.replace(/\{sc\}|\{\/sc\}/g, '').trim()));
													const sxMatches = text.match(/\{sx\|([^|]+)/g);
													if (sxMatches) sxMatches.forEach(m => allSynonyms.add(m.replace(/\{sx\|/, '').trim()));
												} else if (Array.isArray(item) && item[0] === 'vis' && Array.isArray(item[1])) {
													item[1].forEach(vis => vis.t ? examples.push(vis.t) : null);
												}
											});
										}
									});
									result.synonymsList = Array.from(allSynonyms);
									result.synonymsInfo.paragraphs = paragraphs;   // 原始文本
									result.synonymsInfo.examples = examples;
								}

								// 词源
								if (entry.et) { result.etymology = cleanEtymology(entry.et); }

								// ===== 新增：提取引文 (quotes) =====
								if (entry.quotes && Array.isArray(entry.quotes)) {
									entry.quotes.forEach(q => {
										let quoteText = q.t ? this.cleanMWText(q.t) : '';
										let source = '';
										if (q.aq) {
											const auth = this.cleanMWText(q.aq.auth || '');
											const src = this.cleanMWText(q.aq.source || '');
											const date = this.cleanMWText(q.aq.aqdate || '');
											source = `${auth}${src ? ', ' + src : ''}${date ? ', ' + date : ''}`;
										}
										result.quotes.push({ text: quoteText, source: source });
									});
								}

								return result;
							});
						},

						// --- 同义词解析 ---
						parseThesaurus(thesData) {
							if (!thesData || !Array.isArray(thesData) || thesData.length === 0) return null;
							if (typeof thesData[0] === 'string') return null;
							
							const result = {
								synonyms: [], antonyms: [], related: [], nearSynonyms: [], nearAntonyms: [],
								synonymGroups: [], antonymGroups: [], relatedInfo: [], nearSynonymGroups: [], nearAntonymGroups: []
							};

							const extractDefinitionText = (dt) => {
								if (!dt || !Array.isArray(dt)) return '';
								let text = '';
								dt.forEach(item => { if (Array.isArray(item) && item[0] === 'text') text += this.cleanMWText(item[1]) + ' '; });
								return text.trim();
							};

							const parseWordItem = (item) => {
								if (!item) return null;
								if (typeof item === 'string') { return { word: this.cleanMWText(item), label: '', example: '' }; }
								else if (item.wd) { return { word: this.cleanMWText(item.wd), label: Array.isArray(item.wls) ? item.wls.map(l => this.cleanMWText(l)).join(', ') : this.cleanMWText(item.wls || ''), example: '' }; }
								return null;
							};

							for (const entry of thesData) {
								if (entry.syns && Array.isArray(entry.syns)) {
									entry.syns.forEach(synBlock => {
										if (synBlock.pl === 'synonyms' && Array.isArray(synBlock.pt)) {
											synBlock.pt.forEach(item => {
												if (Array.isArray(item) && item[0] === 'text') {
													const text = item[1];
													result.synonymsInfo.paragraphs.push(this.cleanMWText(text));
													const scMatches = text.match(/\{sc\}([^{}]+)\{\/sc\}/g);
													if(scMatches) scMatches.forEach(m=>result.synonyms.push(m.replace(/\{sc\}|\{\/sc\}/g,'').trim()));
													const sxMatches = text.match(/\{sx\|([^|]+)/g);
													if(sxMatches) sxMatches.forEach(m=>result.synonyms.push(m.replace(/\{sx\|/,'').trim()));
												}
											});
										}
									});
								}
								if (entry.def && Array.isArray(entry.def)) {
									entry.def.forEach(defGroup => {
										if (defGroup.sseq && Array.isArray(defGroup.sseq)) {
											defGroup.sseq.forEach(sseqItem => {
												if (Array.isArray(sseqItem) && sseqItem.length > 0) {
													sseqItem.forEach(senseCandidate => {
														if (Array.isArray(senseCandidate) && senseCandidate[0] === 'sense' && senseCandidate[1]) {
															const sense = senseCandidate[1];
															const senseNumber = sense.sn || '';
															const senseDefinition = extractDefinitionText(sense.dt) || '';

															if (sense.sim_list && Array.isArray(sense.sim_list)) {
																const nearSynonymGroup = { sn: senseNumber, definition: senseDefinition, nearSynonyms: [] };
																sense.sim_list.forEach(simGroup => {
																	if (Array.isArray(simGroup)) { simGroup.forEach(simItem => { const wd = parseWordItem(simItem); if(wd) nearSynonymGroup.nearSynonyms.push(wd); }); }
																});
																if (nearSynonymGroup.nearSynonyms.length > 0) {
																	result.nearSynonymGroups.push(nearSynonymGroup);
																	nearSynonymGroup.nearSynonyms.forEach(ns => result.nearSynonyms.push(ns.word));
																}
															}
															if (sense.opp_list && Array.isArray(sense.opp_list)) {
																const nearAntonymGroup = { sn: senseNumber, definition: senseDefinition, nearAntonyms: [] };
																sense.opp_list.forEach(oppGroup => {
																	if (Array.isArray(oppGroup)) { oppGroup.forEach(oppItem => { const wd = parseWordItem(oppItem); if(wd) nearAntonymGroup.nearAntonyms.push(wd); }); }
																});
																if (nearAntonymGroup.nearAntonyms.length > 0) {
																	result.nearAntonymGroups.push(nearAntonymGroup);
																	nearAntonymGroup.nearAntonyms.forEach(na => result.nearAntonyms.push(na.word));
																}
															}
														}
													});
												}
											});
										}
									});
								}
								if (entry.rel_list && Array.isArray(entry.rel_list)) {
									entry.rel_list.forEach(relGroup => {
										if (Array.isArray(relGroup)) {
											const relatedGroup = { type: relGroup[0] || 'related', words: [] };
											relGroup.forEach(relItem => { const wd = parseWordItem(relItem); if(wd) { relatedGroup.words.push(wd.word); result.related.push(wd.word); } });
											if (relatedGroup.words.length > 0) result.relatedInfo.push(relatedGroup);
										}
									});
								}
							}
							result.synonyms = [...new Set(result.synonyms)];
							result.nearSynonyms = [...new Set(result.nearSynonyms)];
							result.nearAntonyms = [...new Set(result.nearAntonyms)];
							return result;
						}
					};

					if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => this.init()); }
					else { this.init(); }
				}

                async init() {
                    console.log('应用初始化开始');
                    try {
                        this.registerServiceWorker();
                        this.setupNetworkListeners();
                        await this.db.ready();
                        console.log('数据库初始化完成');
                        this.initSpeech();
                        await this.loadInitialData();
                        await this.updateTodayProgress();
                        await this.testNetworkConnection();
                        this.learningMode = await this.db.getSetting('learningMode', 'recognition') || 'recognition';
                        this.syncModeToggleUI();
                        this.mimoConfig = {
                            engine: (await this.db.getSetting('ttsEngine')) || 'system',
                            apiKey: (await this.db.getSetting('mimoApiKey')) || '',
                            voice: (await this.db.getSetting('mimoVoice')) || 'mimo_default'
                        };
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
                        this.bindEvents();
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
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 5000);
                        const response = await fetch(
                            'https://api.dictionaryapi.dev/api/v2/entries/en/test',
                            { method: 'HEAD', signal: controller.signal }
                        );
                        clearTimeout(timeoutId);
                        this.networkAvailable = response.ok;
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
                    });
                    document.addEventListener('visibilitychange', () => {
                        if (document.visibilityState === 'hidden' && this.currentPage === 'reader') {
                            this.saveCurrentReadingPosition();
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

                    document.getElementById('knowBtn').addEventListener('click', () => this.handleAnswer(true));
                    document.getElementById('notKnowBtn').addEventListener('click', () => this.handleAnswer(false));
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
                    document.getElementById('lookupModalClose')?.addEventListener('click', () => this.closeWordLookup());
                    document.getElementById('wordLookupModal')?.addEventListener('click', (e) => {
                        if (e.target.id === 'wordLookupModal') this.closeWordLookup();
                    });
                    document.getElementById('lookupModalAddBtn')?.addEventListener('click', () => this.addLookupWordToDB());
                    document.getElementById('lookupModalSpeakBtn')?.addEventListener('click', () => {
                        if (this.lookupModalWord) this.speakWord(this.lookupModalWord);
                    });
                    document.getElementById('lookupModalMwBtn')?.addEventListener('click', () => this.lookupModalMw());
                    document.getElementById('lookupModalAiBtn')?.addEventListener('click', () => this.lookupModalAi());
                    // 弹窗内单词标题也可点击发音
                    document.getElementById('lookupModalWord')?.addEventListener('click', () => {
                        if (this.lookupModalWord) this.speakWord(this.lookupModalWord);
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

                    // 上传页模式切换
                    document.querySelectorAll('[data-upload-mode]').forEach(btn => {
                        btn.addEventListener('click', () => {
                            document.querySelectorAll('[data-upload-mode]').forEach(b => b.classList.remove('active'));
                            btn.classList.add('active');
                            const mode = btn.dataset.uploadMode;
                            const isReading = mode === 'reading';
                            document.getElementById('wordModeOptions').style.display = isReading ? 'none' : 'block';
                            document.getElementById('processBtn').style.display = isReading ? 'none' : '';
                            document.getElementById('readingSaveContainer').style.display = isReading ? 'block' : 'none';
                            this.uploadMode = mode;
                        });
                    });

                    document.getElementById('readingSaveBtn')?.addEventListener('click', () => this.saveAsReading());

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
                            this.handleAnswer(false);
                        } else if (e.key === '2' || e.key === 'ArrowRight') {
                            e.preventDefault();
                            this.handleAnswer(true);
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
                    } else {
                        feedbackEl.className = 'spelling-feedback wrong';
                        feedbackEl.innerHTML = this.getLetterFeedback(input, target);
                    }
                    // 揭示单词（拼写模式下 h1 被隐藏，需恢复显示）
                    if (currentWordEl) {
                        currentWordEl.style.display = '';
                        currentWordEl.textContent = wordData.word;
                    }
                    setTimeout(() => {
                        this.handleAnswer(correct);
                    }, 1000);
                }

                getLetterFeedback(input, target) {
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
                    return '✗ ' + result.join('') + `<br><small style="color:var(--gray-color);">正确答案：${target}</small>`;
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
                        if (this.isStudyingNewWords) {
                            console.log('继续学习生词本，跳过默认加载');
                            this.isStudyingNewWords = false;
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
                        if (this.networkAvailable) {
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
                    // SM-2 信息展示
                    this.renderSM2Info(wordData.id);
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

                async renderSM2Info(wordId) {
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
                        const nextReviewDays = progress.nextReview
                            ? Math.ceil((new Date(progress.nextReview) - new Date()) / (1000 * 60 * 60 * 24))
                            : '-';
                        el.innerHTML = `
                            <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;">
                                <span title="熟悉度">📊 ${'★'.repeat(progress.familiarity || 0)}${'☆'.repeat(5 - (progress.familiarity || 0))}</span>
                                <span title="重复次数">🔄 ${progress.repetition || 0}次</span>
                                <span title="间隔天数">📅 ${progress.interval || 0}天</span>
                                <span title="难度因子">⚡ ${(progress.easeFactor || 0).toFixed(2)}</span>
                                <span title="上次复习">📝 ${daysSinceReview === '-' ? '-' : daysSinceReview + '天前'}</span>
                                <span title="下次复习">⏰ ${nextReviewDays === '-' ? '-' : nextReviewDays <= 0 ? '今天' : nextReviewDays + '天后'}</span>
                                <span title="错误次数">❌ ${word.errorCount || 0}次</span>
                                <span title="总复习次数">📖 ${progress.totalReviews || 0}次</span>
                            </div>
                        `;
                        el.style.display = 'block';
                    } catch (e) {
                        console.warn('SM-2 信息加载失败:', e);
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
					if (wordData.allMeanings && wordData.allMeanings.length > 0) {
						const total = wordData.allMeanings.length;
						const showAll = total <= 3;
						const visibleCount = showAll ? total : 3;
						let html = '<div class="dictionary-details">';
						wordData.allMeanings.slice(0, visibleCount).forEach((meaning) => {
							html += `<div class="meaning-item" style="margin-bottom: 15px;">`;
							if (meaning.partOfSpeech) html += `<div class="part-of-speech">${meaning.partOfSpeech}</div>`;
							if (meaning.definition) html += `<div class="definition">${meaning.definition}</div>`;
							if (meaning.example) html += `<div class="example"><em>例句:</em> ${meaning.example}</div>`;
							if (meaning.synonyms && meaning.synonyms.length > 0) {
								html += `<div style="margin-top: 6px; font-size: 0.9rem;">`;
								html += `<span style="color: var(--gray-color); font-weight: 500;">同义词：</span>`;
								meaning.synonyms.forEach(syn => {
									html += `<span class="clickable-word" style="color: var(--secondary-color); cursor: pointer; margin-right: 4px; margin-left: 4px; text-decoration: underline;" data-word="${syn}">${syn}</span>`;
								});
								html += `</div>`;
							}
							if (meaning.antonyms && meaning.antonyms.length > 0) {
								html += `<div style="margin-top: 4px; font-size: 0.9rem;">`;
								html += `<span style="color: var(--gray-color); font-weight: 500;">反义词：</span>`;
								meaning.antonyms.forEach(ant => {
									html += `<span class="clickable-word" style="color: var(--danger-color); cursor: pointer; margin-right: 4px; margin-left: 4px; text-decoration: underline;" data-word="${ant}">${ant}</span>`;
								});
								html += `</div>`;
							}
							html += `</div>`;
						});
						if (!showAll) {
							const remaining = total - 3;
							html += `<div style="text-align:center;margin-top:8px;">
								<button class="action-btn small expand-meanings-btn" data-meanings='${JSON.stringify(wordData.allMeanings.slice(3))}'>
									展开全部${remaining}个释义 ↓
								</button>
							</div>`;
						}
						html += '</div>';
						containerEl.innerHTML = html;
						const expandBtn = containerEl.querySelector('.expand-meanings-btn');
						if (expandBtn) {
							expandBtn.addEventListener('click', function() {
								const meanings = JSON.parse(this.dataset.meanings);
								let allHtml = '';
								meanings.forEach(m => {
									allHtml += '<div class="meaning-item" style="margin-bottom: 15px;">';
									if (m.partOfSpeech) allHtml += '<div class="part-of-speech">' + m.partOfSpeech + '</div>';
									if (m.definition) allHtml += '<div class="definition">' + m.definition + '</div>';
									if (m.example) allHtml += '<div class="example"><em>例句:</em> ' + m.example + '</div>';
									allHtml += '</div>';
								});
								this.closest('.dictionary-details').insertAdjacentHTML('beforeend', allHtml);
								this.remove();
							});
						}
					} else { containerEl.innerHTML = '<p class="empty-state">暂无详细词典数据</p>'; }
					this.makeClickable(containerEl);
				}


                async handleAnswer(correct) {
                    if (this.isProcessing) return;
                    this.isProcessing = true;
                    const wordData = this.learningWords[this.currentWordIndex];
                    console.log(`处理答案: ${wordData.word} - ${correct ? '认识' : '不认识'}`);
                    try {
                        await this.db.updateProgress(wordData.id, correct);
                        await this.db.addLearningHistory(wordData.id, correct);
                        if (correct) {
                            await this.db.updateStreak();
                        }
                        this.playAnswerSound(correct);
                        if (correct) {
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
                        const autoNext = await this.db.getSetting('autoNextWord');
                        const delay = autoNext ? 800 : 0;
                        setTimeout(async () => {
                            this.currentWordIndex++;
                            if (this.currentWordIndex < this.learningWords.length) {
                                await this.displayCurrentWord();
                            } else {
                                await this.completeLearningSession();
                            }
                            await this.updateTodayProgress();
                            await this.loadRecentActivity();
                            this.isProcessing = false;
                        }, delay);
                    } catch (error) {
                        console.error('处理答案失败:', error);
                        this.showNotification('处理失败，请重试', 'error');
                        this.isProcessing = false;
                    }
                }

                async completeLearningSession() {
                    const stats = await this.db.getLearningStats(1);
                    const correct = stats.correct;
                    const total = stats.total;
                    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
                    let message = '恭喜完成今日学习！';
                    if (accuracy >= 80) message += ' 表现很棒！🎉';
                    else if (accuracy >= 60) message += ' 继续加油！💪';
                    else message += ' 复习一下生词本吧！📚';
                    this.showNotification(message, 'success');
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
                    if (this.currentAudioUrl && this.networkAvailable) {
                        try {
                            const audio = new Audio(this.currentAudioUrl);
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
                            excludeCommon: document.getElementById('excludeCommon')?.checked ?? true,
                            minFrequency: parseInt(document.getElementById('minFrequency')?.value || '3'),
                            autoDifficulty: document.getElementById('autoDifficulty')?.checked ?? true
                        };
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
                        if (downloadData && this.networkAvailable) {
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
                        this.isStudyingNewWords = true;
                        this.learningWords = newWords;
                        this.currentWordIndex = 0;
                        this.showingDetails = false;
                        this.switchPage('learn');
                    } catch (error) {
                        console.error('开始学习生词失败:', error);
                        this.showNotification('开始学习失败', 'error');
                        this.isStudyingNewWords = false;
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
                                <p style="font-size:0.85rem; color:var(--gray-color); margin-top:10px;">引擎仅影响阅读器全文朗读；单词发音仍使用系统语音或词典音频。MiMo API Key 请到 Xiaomi MiMo 开放平台获取。</p>
                            </div>
                            <div class="settings-section">
                                <h3>AI 分析设置</h3>
                                <div class="setting-item">
                                    <label for="llmApiKey">GLM API Key</label>
                                    <div class="setting-control" style="flex: 1;">
                                        <input type="password" id="llmApiKey" placeholder="输入 GLM API Key" style="flex:1; min-width:200px;">
                                    </div>
                                </div>
                                <div class="setting-item" style="flex-direction:column; align-items:stretch; gap:6px;">
                                    <label for="llmPrompt">AI 提示词（使用 {word} 作为单词占位符）</label>
                                    <textarea id="llmPrompt" rows="5" style="width:100%; padding:10px; border:1px solid var(--border-color); border-radius:8px; font-size:0.9rem; resize:vertical; box-sizing:border-box;"></textarea>
                                </div>
                                <div class="setting-item">
                                    <label for="llmModel">GLM 模型</label>
                                    <div class="setting-control" style="flex:1;">
                                        <input type="text" id="llmModel" placeholder="glm-4.7-flash" style="flex:1; min-width:200px;">
                                        <span style="font-size:0.8rem; color:var(--gray-color);">留空则使用默认 glm-4.7-flash</span>
                                    </div>
                                </div>
                                <div class="setting-item">
                                    <label for="llmWebSearch">AI 联网搜索</label>
                                    <div class="setting-control">
                                        <label class="switch">
                                            <input type="checkbox" id="llmWebSearch" checked>
                                            <span class="slider"></span>
                                        </label>
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
                    document.getElementById('clearAllData')?.addEventListener('click', () => this.clearAllData());
                    document.getElementById('showDebugInfo')?.addEventListener('click', () => this.showDebugInfo());
                    document.getElementById('saveSettings')?.addEventListener('click', () => this.saveSettings());

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
                        const isMimo = engine === 'mimo';
                        if (keyItem) keyItem.style.display = isMimo ? '' : 'none';
                        if (voiceItem) voiceItem.style.display = isMimo ? '' : 'none';
                    };
                    const engineSelect = document.getElementById('ttsEngine');
                    if (engineSelect) {
                        engineSelect.addEventListener('change', toggleMimoFields);
                        toggleMimoFields();
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
                        this.mimoConfig = {
                            engine: settings.ttsEngine || 'system',
                            apiKey: settings.mimoApiKey || '',
                            voice: settings.mimoVoice || 'mimo_default'
                        };
                        this._savedSpeaker = settings.ttsSpeaker || '';
                        setSelect('ttsVoice', settings.ttsVoice);
                        if (settings.ttsSpeed != null) {
                            const el = document.getElementById('ttsSpeed');
                            if (el) el.value = settings.ttsSpeed;
                        }
                        setInputValue('llmApiKey', settings.llmApiKey);
                        const promptEl = document.getElementById('llmPrompt');
                        if (promptEl) promptEl.value = settings.llmPrompt || this.AI_DEFAULT_PROMPT;
                        setInputValue('llmModel', settings.llmModel || '');
                        const wsEl = document.getElementById('llmWebSearch');
                        if (wsEl && settings.llmWebSearch != null) {
                            wsEl.checked = settings.llmWebSearch;
                        }
                        if (settings.llmTemperature != null) {
                            const el = document.getElementById('llmTemperature');
                            if (el) el.value = settings.llmTemperature;
                        }
                        if (settings.llmTopP != null) {
                            const el = document.getElementById('llmTopP');
                            if (el) el.value = settings.llmTopP;
                        }
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
                            llmApiKey: getInputValue('llmApiKey'),
                            llmPrompt: getInputValue('llmPrompt'),
                            llmModel: (getInputValue('llmModel') || '').trim(),
                            llmWebSearch: document.getElementById('llmWebSearch')?.checked ?? true,
                            llmTemperature: parseFloat(getInputValue('llmTemperature')) || 0.7,
                            llmTopP: parseFloat(getInputValue('llmTopP')) || 0.9
                        };
                        for (const [key, value] of Object.entries(settings)) {
                            await this.db.saveSetting(key, value);
                        }
                        this.mimoConfig = {
                            engine: settings.ttsEngine || 'system',
                            apiKey: settings.mimoApiKey || '',
                            voice: settings.mimoVoice || 'mimo_default'
                        };
                        this.showNotification('设置已保存', 'success');
                        this.applyTheme(settings.theme);
                        this.applyFontSize(settings.fontSize);
                    } catch (error) {
                        console.error('保存设置失败:', error);
                        this.showNotification('保存设置失败', 'error');
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
                        const exportData = {
                            version: '3.1',
                            exportDate: new Date().toISOString(),
                            words: allWords,
                            newWords: newWords.map(w => ({ wordId: w.id, addedAt: w.addedAt })),
                            wordLists: wordLists,
                            userProgress: allProgress,
                            learningHistory: allHistory,
                            novels: allArticles,
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

                async importData(file) {
                    if (!file) return;
                    if (!confirm('导入数据将覆盖当前所有数据，是否继续？')) return;
                    if (!confirm('⚠️ 警告：此操作将删除所有现有数据（包括单词、进度、生词本等），确定要继续吗？')) return;

                    try {
                        this.showLoader('正在读取文件...');
                        const text = await file.text();
                        const importData = JSON.parse(text);

                        if (!importData.words || !Array.isArray(importData.words)) {
                            throw new Error('数据格式不正确：缺少 words 数组');
                        }

                        this.showLoader('正在清空旧数据...');
                        await this.db.clearAllData();
                        await this.db.ready();

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
                                        store.put({
                                            wordId: newId,
                                            familiarity: progress.familiarity || 0,
                                            nextReview: progress.nextReview || new Date().toISOString(),
                                            lastReview: progress.lastReview || new Date().toISOString(),
                                            totalReviews: progress.totalReviews || 0
                                        });
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
                    if (!confirm('再次确认：所有学习记录、单词、单词库、设置都将被删除？')) return;
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

                async loadStatsPage() {
                    try {
                        const streak = await this.db.getSetting('learningStreak') || 0;
                        const todayStats = await this.db.getLearningStats(1);
                        const monthStats = await this.db.getLearningStats(30);
                        const progressStats = await this.db.getProgressStats();
                        const accuracy = monthStats.total > 0
                            ? Math.round((monthStats.correct / monthStats.total) * 100)
                            : 0;

                        const setText = (id, v) => {
                            const el = document.getElementById(id);
                            if (el) el.textContent = v;
                        };
                        setText('statStreak', streak);
                        setText('statToday', todayStats.total);
                        setText('statMastered', progressStats.mastered);
                        setText('statAccuracy', `${accuracy}%`);

                        this.renderActivityChart(monthStats.byDay);
                        this.renderMasteryDist(progressStats.distribution);
                        this.renderAccuracyTrend(monthStats.byDay);
                    } catch (error) {
                        console.error('加载统计页面失败:', error);
                    }
                }

                // 近 30 天柱状图：byDay = { 'YYYY-MM-DD': { total, correct } }
                renderActivityChart(byDay) {
                    const container = document.getElementById('activityChart');
                    const empty = document.getElementById('activityEmpty');
                    if (!container) return;
                    const days = 30;
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const bars = [];
                    let maxTotal = 0;
                    const entries = [];
                    for (let i = days - 1; i >= 0; i--) {
                        const d = new Date(today);
                        d.setDate(d.getDate() - i);
                        const key = d.toISOString().split('T')[0];
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

                // 掌握度分布：familiarity 0-5 共 6 根条
                renderMasteryDist(distribution) {
                    const container = document.getElementById('masteryDist');
                    if (!container) return;
                    const labels = ['陌生', '初识', '了解', '熟悉', '熟练', '掌握'];
                    const colors = ['#F44336', '#FF9800', '#FFC107', '#2196F3', '#4CAF50', '#388E3C'];
                    const max = Math.max(1, ...Object.values(distribution));
                    let html = '';
                    for (let i = 0; i <= 5; i++) {
                        const count = distribution[i] || 0;
                        const widthPct = (count / max) * 100;
                        html += `
                            <div class="mastery-row">
                                <span class="mastery-label">${i}★ ${labels[i]}</span>
                                <div class="mastery-bar-track">
                                    <div class="mastery-bar-fill" style="width:${widthPct}%; background:${colors[i]};"></div>
                                </div>
                                <span class="mastery-count">${count}</span>
                            </div>
                        `;
                    }
                    container.innerHTML = html;
                }

                // 近 7 天正确率折线（用柱状表示，简洁无依赖）
                renderAccuracyTrend(byDay) {
                    const container = document.getElementById('accuracyTrend');
                    if (!container) return;
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const rows = [];
                    let anyData = false;
                    for (let i = 6; i >= 0; i--) {
                        const d = new Date(today);
                        d.setDate(d.getDate() - i);
                        const key = d.toISOString().split('T')[0];
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

                playAnswerSound(correct) {
                    try {
                        const AudioContext = window.AudioContext || window.webkitAudioContext;
                        if (!AudioContext) return;
                        const audioContext = new AudioContext();
                        const oscillator = audioContext.createOscillator();
                        const gainNode = audioContext.createGain();
                        oscillator.connect(gainNode);
                        gainNode.connect(audioContext.destination);
                        oscillator.frequency.value = correct ? 800 : 400;
                        oscillator.type = 'sine';
                        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
                        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
                        oscillator.start(audioContext.currentTime);
                        oscillator.stop(audioContext.currentTime + 0.3);
                    } catch (error) {
                        console.warn('播放音效失败:', error);
                    }
                }

                speakWord(word) {
                    if (!word) return;
                    if (this.speechSynthesis) {
                        if (this.readerTTS) this.stopReaderTTS();
                        this.speechSynthesis.cancel();
                        const utterance = new SpeechSynthesisUtterance(word);
                        utterance.rate = 0.8;
                        this.speechSynthesis.speak(utterance);
                    }
                }

                async addWordToStudy(wordId) {
                    try {
                        const word = await this.db.getWordById(wordId);
                        if (word) {
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
				async renderMwResult(word, containerEl) {
					if (!containerEl) return;
					containerEl.style.display = 'block';
					containerEl.innerHTML = '<div class="mw-loading"><i class="fas fa-spinner fa-spin"></i> 正在查询韦氏词典...</div>';
					try {
						const result = await this.mwAPI.lookupWord(word);
						const dictData = this.mwAPI.parseDict(result.dict);  // 现在是一个数组
						const thesData = this.mwAPI.parseThesaurus(result.thesaurus);
						let html = '<div class="mw-result-section">';

						// --- 词典部分：支持多词条 ---
						if (dictData && dictData.length > 0) {
							// 遍历所有词条（如形容词、动词、名词）
							dictData.forEach((entry, index) => {
								// 如果词条没有定义，跳过
								if (!entry.definitions || entry.definitions.length === 0) return;

								// 词条分隔线（多个词条时添加）
								if (index > 0) {
									html += `<hr style="margin: 20px 0; border-color: var(--border-color);">`;
								}

								html += `<h4 style="margin: 10px 0 6px;">📖 韦氏词典 (Collegiate Dictionary)`;
								// 显示词性（如果有）
								if (entry.functionalLabel) {
									html += ` — <span style="color: var(--secondary-color);">${entry.functionalLabel}</span>`;
								}
								html += `</h4>`;

								// 发音（仅第一个词条显示，或每个词条都显示，这里选择显示第一个有发音的）
								// 为每个词条显示自己的发音，但按钮可能重复，这里简化为只显示第一个词的发音
								// 但更合理的是每个词条都显示，但为了避免按钮重复，可以只在第一个词条显示
								if (index === 0 && dictData.some(e => e.audioId)) {
									const firstAudio = dictData.find(e => e.audioId);
									if (firstAudio) {
										const audioUrl = this.mwAPI.getAudioUrl(firstAudio.audioId);
										html += `<button class="icon-btn small" onclick="window.app.playAudio('${audioUrl}', '${word}')">
													<i class="fas fa-volume-up"></i> 发音
												</button>`;
									} else {
										html += `<button class="icon-btn small" onclick="window.app.speakWord('${word}')">
													<i class="fas fa-volume-up"></i> 发音
												</button>`;
									}
								}

								// 词源
								if (entry.etymology) {
									html += `<div style="font-size:0.9rem; color:var(--gray-color); margin-bottom:6px;">
												<strong>词源：</strong> ${entry.etymology}
											</div>`;
								}

								// --- 新增：词形变化 (stems) ---
								if (entry.stems && entry.stems.length > 0) {
									html += `<div style="font-size:0.9rem; color:var(--gray-color); margin-bottom:6px;">
												<strong>词形变化：</strong> ${entry.stems.join('、')}
											</div>`;
								}

								// --- 新增：派生词 (derivedWords) ---
								if (entry.derivedWords && entry.derivedWords.length > 0) {
									const derivedText = entry.derivedWords.map(d => 
										d.partOfSpeech ? `${d.word} (${d.partOfSpeech})` : d.word
									).join('、');
									html += `<div style="font-size:0.9rem; color:var(--gray-color); margin-bottom:6px;">
												<strong>派生词：</strong> ${derivedText}
											</div>`;
								}

								// --- 新增：年代 (date) ---
								if (entry.date) {
									html += `<div style="font-size:0.9rem; color:var(--gray-color); margin-bottom:6px;">
												<strong>最早记录：</strong> ${entry.date}
											</div>`;
								}

								// --- 新增：冒犯性标记 ---
								if (entry.offensive) {
									html += `<div style="font-size:0.9rem; color:var(--danger-color); margin-bottom:6px;">
												⚠️ 本词可能具有冒犯性
											</div>`;
								}

								// 定义递归渲染函数
								const renderDef = (def, depth = 0) => {
									const indent = depth * 20;
									let block = `<div style="margin-bottom:12px; padding-left:${indent}px; border-left: ${depth === 0 ? '3px solid var(--primary-color)' : '2px solid var(--gray-color)'};">`;

									let senseHeader = '';
									if (def.senseNumber) senseHeader += `<strong>${def.senseNumber}.</strong> `;
									if (def.grammaticalLabel) senseHeader += `<span style="color:var(--gray-color);">[${def.grammaticalLabel}]</span> `;
									if (def.subjectStatusLabels && def.subjectStatusLabels.length > 0) {
										senseHeader += `<span style="color:var(--gray-color); font-style:italic;">(${def.subjectStatusLabels.join(', ')})</span> `;
									}
									if (senseHeader) block += `<div style="margin-bottom:4px;">${senseHeader}</div>`;

									// 只有有定义文本时才显示
									if (def.definitionText) {
										block += `<div class="def-text">${def.definitionText}</div>`;
									}
									if (def.examples && def.examples.length > 0) {
										block += `<div style="margin-top:4px; margin-left:12px; font-style:italic; color:var(--gray-color); font-size:0.95rem;">`;
										def.examples.forEach(ex => {
											block += `<div>“${ex}”</div>`;
										});
										block += `</div>`;
									}

									if (def.subsenses && def.subsenses.length > 0) {
										def.subsenses.forEach(sub => {
											block += renderDef(sub, depth + 1);
										});
									}

									block += '</div>';
									return block;
								};

								// 渲染当前词条的所有定义
								entry.definitions.forEach(def => {
									html += renderDef(def, 0);
								});

								// 同义词辨析（如果有）
								if (entry.synonymsInfo && (entry.synonymsInfo.paragraphs.length > 0 || entry.synonymsInfo.examples.length > 0)) {
									html += '<div style="margin: 16px 0; padding: 12px; background: var(--light-color); border-radius: 8px;">';
									html += '<div style="font-weight:600; margin-bottom:10px; font-size:1rem;">📌 同义词辨析</div>';
									entry.synonymsInfo.paragraphs.forEach(p => {
										// 将 {sc}...{/sc} 替换为加粗，并在此后添加换行（可选）
										let pText = p.replace(/\{sc\}([^{}]+)\{\/sc\}/g, (match, word) => `<strong>${word}</strong>`);
										// 将 {it}...{/it} 替换为斜体
										pText = pText.replace(/\{it\}([^{}]+)\{\/it\}/g, '<i>$1</i>');
										html += `<p style="margin: 8px 0; line-height:1.6;">${pText}</p>`;
									});
									entry.synonymsInfo.examples.forEach(ex => {
										let cleanEx = ex.replace(/\{.*?\}/g, '').trim();
										html += `<div style="font-style:italic; color:var(--gray-color); margin:6px 0 6px 16px;">“${cleanEx}”</div>`;
									});
									html += '</div>';
								}

								// 引文
								if (entry.quotes && entry.quotes.length > 0) {
									html += '<div style="margin: 12px 0;">';
									html += '<div style="font-weight:600; margin-bottom:6px;">📝 引文示例</div>';
									entry.quotes.forEach(q => {
										html += `<div style="margin-bottom:8px; padding-left:8px; border-left: 2px solid var(--secondary-color);">`;
										html += `<div style="font-style:italic;">“${q.text}”</div>`;
										if (q.source) {
											html += `<div style="font-size:0.85rem; color:var(--gray-color);">— ${q.source}</div>`;
										}
										html += `</div>`;
									});
									html += '</div>';
								}
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
						if (thesData) {
							let hasThesData = false;
							if (thesData.synonyms.length > 0) {
								hasThesData = true;
								html += `<div class="mw-synonyms"><span class="label">同义词：</span><div class="syn-list">`;
								thesData.synonyms.slice(0, 20).forEach(syn => {
									html += `<span>${syn}</span>`;
								});
								html += `</div></div>`;
							}
							if (thesData.nearSynonyms.length > 0) {
								hasThesData = true;
								html += `<div class="mw-synonyms"><span class="label">近义词：</span><div class="syn-list">`;
								thesData.nearSynonyms.slice(0, 20).forEach(syn => {
									html += `<span>${syn}</span>`;
								});
								html += `</div></div>`;
							}
							if (thesData.antonyms.length > 0) {
								hasThesData = true;
								html += `<div class="mw-synonyms"><span class="label">反义词：</span><div class="syn-list">`;
								thesData.antonyms.slice(0, 10).forEach(ant => {
									html += `<span>${ant}</span>`;
								});
								html += `</div></div>`;
							}
							if (thesData.nearAntonyms.length > 0) {
								hasThesData = true;
								html += `<div class="mw-synonyms"><span class="label">近反义词：</span><div class="syn-list">`;
								thesData.nearAntonyms.slice(0, 10).forEach(ant => {
									html += `<span>${ant}</span>`;
								});
								html += `</div></div>`;
							}
							if (thesData.related.length > 0) {
								hasThesData = true;
								html += `<div class="mw-synonyms"><span class="label">相关词：</span><div class="syn-list">`;
								thesData.related.slice(0, 15).forEach(rel => {
									html += `<span>${rel}</span>`;
								});
								html += `</div></div>`;
							}
							if (!hasThesData) {
								const thesKey = await window.wordDB.getSetting('mwThesKey');
								if (!thesKey) {
									html += '<p class="mw-info">未配置同义词 API Key，如需查看同义词请配置。</p>';
								} else {
									html += '<p class="mw-error">未找到同义词数据。</p>';
								}
							}
						} else {
							const thesKey = await window.wordDB.getSetting('mwThesKey');
							if (!thesKey) {
								html += '<p class="mw-info">未配置同义词 API Key，如需查看同义词请配置。</p>';
							} else {
								html += '<p class="mw-error">同义词数据获取失败。</p>';
							}
						}

						html += '</div>';
						containerEl.innerHTML = html;
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
                    modal.style.display = 'flex';
                    // 拉取 free dict 并渲染
                    try {
                        const data = await this.dictionaryAPI.fetchWordData(word);
                        if (titleEl) titleEl.textContent = data.word || word;
                        this.renderDictDetails(data, freeDictEl);
                        // 顶部补一行音标 + 释义摘要，便于没展开 details 也能看到
                        const summary = [];
                        if (data.phonetic) summary.push(`<span style="color:var(--gray-color);">${data.phonetic}</span>`);
                        if (data.meaning) summary.push(`<div style="margin-top:6px;">${data.meaning}</div>`);
                        if (summary.length && freeDictEl) {
                            freeDictEl.insertAdjacentHTML('afterbegin', `<div style="margin-bottom:8px;">${summary.join(' ')}</div>`);
                        }
                        // 让弹窗内 free dict 释义/音标/摘要中的英文单词可点击查词
                        this.makeClickable(freeDictEl);
                        this.currentAudioUrl = data.audioUrl;
                    } catch (e) {
                        if (freeDictEl) freeDictEl.innerHTML = '<p class="empty-state">词典数据加载失败</p>';
                    }
                }

                closeWordLookup() {
                    const modal = document.getElementById('wordLookupModal');
                    if (modal) modal.style.display = 'none';
                    this.lookupModalWord = null;
                    const aiResultEl = document.getElementById('lookupModalAiResult');
                    if (aiResultEl) {
                        aiResultEl.style.display = 'none';
                        aiResultEl.innerHTML = '';
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

                async lookupModalAi() {
                    const word = this.lookupModalWord;
                    if (!word) return;
                    const aiResultEl = document.getElementById('lookupModalAiResult');
                    if (!aiResultEl) return;

                    const apiKey = await this.db.getSetting('llmApiKey');
                    if (!apiKey) {
                        this.showNotification('请先在设置中配置 GLM API Key', 'warning');
                        return;
                    }

                    const promptTemplate = (await this.db.getSetting('llmPrompt')) || this.AI_DEFAULT_PROMPT;
                    const temperature = (await this.db.getSetting('llmTemperature')) ?? 0.7;
                    const topP = (await this.db.getSetting('llmTopP')) ?? 0.9;
                    const model = (await this.db.getSetting('llmModel') || 'glm-4.7-flash').trim();
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
                        if (webSearchEnabled) {
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
                        const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`
                            },
                            body: JSON.stringify(body)
                        });

                        if (!response.ok) {
                            const errText = await response.text();
                            throw new Error(`API 错误 (${response.status}): ${errText}`);
                        }

                        const data = await response.json();
                        const content = data.choices?.[0]?.message?.content || '(无返回内容)';
                        const renderFn = typeof marked?.parse === 'function' ? marked : null;
                        if (renderFn) {
                            const html = renderFn.parse(content, { breaks: true });
                            aiResultEl.innerHTML = `<div class="ai-result">${DOMPurify.sanitize(html)}</div>`;
                        } else {
                            aiResultEl.innerHTML = `<div class="ai-result">${this.escapeHtml(content)}</div>`;
                        }
                    } catch (e) {
                        aiResultEl.innerHTML = `<div class="ai-error"><i class="fas fa-exclamation-triangle"></i> ${this.escapeHtml(e.message)}</div>`;
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

                async _mimoStream(text, voice) {
                    const apiKey = this.mimoConfig.apiKey;
                    if (!apiKey) throw new Error('未配置 MiMo API Key');
                    const body = {
                        model: 'mimo-v2.5-tts',
                        messages: [{ role: 'assistant', content: text }],
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

                mimoSpeak({ text, voice, rate, onStart, onEnd, onError }) {
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
                    this._mimoStream(text, voice).then((res) => {
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
            }

            window.app = new WordLearnerApp();
        })();
