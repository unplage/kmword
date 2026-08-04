        (function() {
            const DB_NAME = 'WordLearnerDB';
            const DB_VERSION = 8;

            const STORES = {
                WORDS: 'words',
                WORD_LISTS: 'word_lists',
                USER_PROGRESS: 'user_progress',
                NEW_WORDS: 'new_words',
                DAILY_PLAN: 'daily_plan',
                LEARNING_HISTORY: 'learning_history',
                NOVELS: 'novels',
                SETTINGS: 'settings',
                LISTENING_FILES: 'listening_files',
                AUDIO_SEGMENTS: 'audio_segments'
            };

            class WordDatabase {
                constructor() {
                    this.db = null;
                    this.initPromise = null;
                    this.isInitializing = false;
                }

                async batchDeleteWordsByList(listId) {
                    await this.ready();
                    const parsedId = parseInt(listId);
                    const words = await this.getWordsByList(parsedId);
                    const wordIds = words.map(w => w.id);
                    if (wordIds.length === 0) return 0;
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction(
                            [STORES.WORDS, STORES.USER_PROGRESS, STORES.NEW_WORDS],
                            'readwrite'
                        );
                        const wordsStore = transaction.objectStore(STORES.WORDS);
                        const progressStore = transaction.objectStore(STORES.USER_PROGRESS);
                        const newWordsStore = transaction.objectStore(STORES.NEW_WORDS);
                        let deletedCount = 0;
                        transaction.oncomplete = () => {
                            console.log(`批量删除完成，共删除 ${deletedCount} 个单词`);
                            resolve(deletedCount);
                        };
                        transaction.onerror = (e) => {
                            console.error('批量删除事务失败:', e.target.error);
                            reject(e.target.error);
                        };
                        wordIds.forEach(id => {
                            wordsStore.delete(id);
                            progressStore.delete(id);
                            newWordsStore.delete(id);
                            deletedCount++;
                        });
                    });
                }

                async deleteWordListRecord(listId) {
                    await this.ready();
                    const parsedId = parseInt(listId);
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.WORD_LISTS], 'readwrite');
                        const store = transaction.objectStore(STORES.WORD_LISTS);
                        const request = store.delete(parsedId);
                        request.onsuccess = () => resolve();
                        request.onerror = () => reject(request.error);
                    });
                }

                async batchAddWords(wordDataArray, listId) {
                    await this.ready();
                    const targetListId = listId ? parseInt(listId) : null;
                    const existingWordsSet = new Set();
                    const existingWords = await this.getWordsByList(targetListId);
                    existingWords.forEach(w => existingWordsSet.add(w.word.toLowerCase().trim()));

                    const toInsert = [];
                    const skipped = [];
                    for (const wordData of wordDataArray) {
                        const normalizedWord = wordData.word.toLowerCase().trim();
                        if (existingWordsSet.has(normalizedWord)) {
                            skipped.push(normalizedWord);
                            console.log(`单词 "${normalizedWord}" 已存在，跳过`);
                        } else {
                            toInsert.push({
                                ...wordData,
                                word: normalizedWord,
                                listId: targetListId,
                                createdAt: new Date().toISOString(),
                                lastReviewed: null,
                                reviewCount: 0
                            });
                        }
                    }

                    if (toInsert.length === 0) {
                        return { saved: 0, skipped: skipped.length };
                    }

                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.WORDS], 'readwrite');
                        const store = transaction.objectStore(STORES.WORDS);
                        let savedCount = 0;
                        transaction.oncomplete = () => {
                            console.log(`批量保存完成：保存 ${savedCount} 个，跳过 ${skipped.length} 个`);
                            resolve({ saved: savedCount, skipped: skipped.length });
                        };
                        transaction.onerror = (e) => {
                            console.error('批量保存事务失败:', e.target.error);
                            reject(e.target.error);
                        };
                        for (const data of toInsert) {
                            const request = store.add(data);
                            request.onsuccess = () => {
                                savedCount++;
                            };
                            request.onerror = (e) => {
                                if (e.target.error.name === 'ConstraintError') {
                                    console.warn('批量保存时出现意外重复:', data.word);
                                } else {
                                    transaction.abort();
                                    reject(e.target.error);
                                }
                            };
                        }
                    });
                }

                async init() {
                    if (this.initPromise) return this.initPromise;
                    if (this.isInitializing) {
                        while (this.isInitializing) {
                            await new Promise(resolve => setTimeout(resolve, 50));
                        }
                        return this.db;
                    }

                    this.isInitializing = true;
                    
                    this.initPromise = new Promise((resolve, reject) => {
                        const request = indexedDB.open(DB_NAME, DB_VERSION);
                        
                        request.onerror = () => {
                            console.error('数据库打开失败:', request.error);
                            this.isInitializing = false;
                            reject(request.error);
                        };
                        
                        request.onsuccess = () => {
                            console.log('数据库打开成功');
                            this.db = request.result;
                            this.db.onerror = (event) => {
                                console.error('数据库错误:', event.target.error);
                            };
                            this.isInitializing = false;
                            resolve(this.db);
                        };
                        
                        request.onupgradeneeded = (event) => {
                            console.log('数据库升级，版本:', event.oldVersion, '->', event.newVersion);
                            const db = event.target.result;
                            const transaction = event.target.transaction;
                            const oldVersion = event.oldVersion;
                            
                            if (oldVersion < 1) {
                                this.createInitialStores(db);
                            }
                            
                            if (oldVersion < 2) {
                                this.migrateToVersion2(db);
                            }
                            
                            if (oldVersion < 3) {
                                this.migrateToVersion3(db);
                            }
                            
                            if (oldVersion < 5) {
                                console.log('迁移到版本 5：创建复合唯一索引 [word, listId]');
                                const wordsStore = transaction.objectStore(STORES.WORDS);
                                
                                if (wordsStore.indexNames.contains('word')) {
                                    wordsStore.deleteIndex('word');
                                }
                                
                                if (!wordsStore.indexNames.contains('word_list')) {
                                    try {
                                        wordsStore.createIndex('word_list', ['word', 'listId'], { unique: true });
                                        console.log('成功创建复合唯一索引 word_list');
                                    } catch (e) {
                                        console.warn('创建唯一索引失败，可能存在重复数据，创建非唯一索引:', e);
                                        wordsStore.createIndex('word_list', ['word', 'listId'], { unique: false });
                                    }
                                }
                            }
							if (oldVersion < 6) {
								console.log('迁移到版本 6：添加 word 索引');
								const wordsStore = transaction.objectStore(STORES.WORDS);
								if (!wordsStore.indexNames.contains('word')) {
									wordsStore.createIndex('word', 'word', { unique: false });
								}
							}
							if (oldVersion < 7) {
								console.log('迁移到版本 7：添加 createdAt 索引到 novels');
								const novelsStore = transaction.objectStore(STORES.NOVELS);
								if (!novelsStore.indexNames.contains('createdAt')) {
									novelsStore.createIndex('createdAt', 'createdAt', { unique: false });
								}
							}
							if (oldVersion < 8) {
								console.log('迁移到版本 8：添加听力模块 stores');
								if (!db.objectStoreNames.contains(STORES.LISTENING_FILES)) {
									const lfStore = db.createObjectStore(STORES.LISTENING_FILES, { keyPath: 'id', autoIncrement: true });
									lfStore.createIndex('createdAt', 'createdAt', { unique: false });
								}
								if (!db.objectStoreNames.contains(STORES.AUDIO_SEGMENTS)) {
									const asStore = db.createObjectStore(STORES.AUDIO_SEGMENTS, { keyPath: 'id', autoIncrement: true });
									asStore.createIndex('fileId', 'fileId', { unique: false });
									asStore.createIndex('fileId_segmentIndex', ['fileId', 'segmentIndex'], { unique: true });
								}
							}
                        };
                        
                        request.onblocked = () => {
                            console.warn('数据库被阻塞，请关闭其他标签页');
                        };
                    });

                    return this.initPromise;
                }

                createInitialStores(db) {
                    console.log('创建初始表结构');
                    
                    if (!db.objectStoreNames.contains(STORES.WORDS)) {
                        const wordsStore = db.createObjectStore(STORES.WORDS, { keyPath: 'id', autoIncrement: true });
                        wordsStore.createIndex('word_list', ['word', 'listId'], { unique: true });
                        wordsStore.createIndex('difficulty', 'difficulty');
                        wordsStore.createIndex('source', 'source');
                        wordsStore.createIndex('lastReviewed', 'lastReviewed');
                    }
                                        
                    if (!db.objectStoreNames.contains(STORES.USER_PROGRESS)) {
                        const progressStore = db.createObjectStore(STORES.USER_PROGRESS, { keyPath: 'wordId' });
                        progressStore.createIndex('nextReview', 'nextReview');
                        progressStore.createIndex('familiarity', 'familiarity');
                    }
                    
                    if (!db.objectStoreNames.contains(STORES.NEW_WORDS)) {
                        db.createObjectStore(STORES.NEW_WORDS, { keyPath: 'wordId' });
                    }
                    
                    if (!db.objectStoreNames.contains(STORES.DAILY_PLAN)) {
                        db.createObjectStore(STORES.DAILY_PLAN, { keyPath: 'id' });
                    }
                    
                    if (!db.objectStoreNames.contains(STORES.LEARNING_HISTORY)) {
                        const historyStore = db.createObjectStore(STORES.LEARNING_HISTORY, { keyPath: 'id', autoIncrement: true });
                        historyStore.createIndex('date', 'date');
                        historyStore.createIndex('wordId', 'wordId');
                    }
                    
                    if (!db.objectStoreNames.contains(STORES.NOVELS)) {
                        const novelsStore = db.createObjectStore(STORES.NOVELS, { keyPath: 'id', autoIncrement: true });
                        novelsStore.createIndex('title', 'title');
                    }
                    
                    if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
                        db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
                    }
                }

                migrateToVersion2(db) {
                    console.log('迁移到版本 2');
                }

                migrateToVersion3(db) {
                    console.log('迁移到版本 3：添加单词库管理');
                    if (!db.objectStoreNames.contains(STORES.WORD_LISTS)) {
                        const listStore = db.createObjectStore(STORES.WORD_LISTS, { keyPath: 'id', autoIncrement: true });
                        listStore.createIndex('name', 'name', { unique: true });
                        listStore.createIndex('createdAt', 'createdAt');
                    }
                }

                async ready() {
                    if (this.db) return this.db;
                    return this.init();
                }

                close() {
                    if (this.db) {
                        this.db.close();
                        this.db = null;
                        this.initPromise = null;
                        console.log('数据库已关闭');
                    }
                }

                async createWordList(name, description = '') {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.WORD_LISTS], 'readwrite');
                        const store = transaction.objectStore(STORES.WORD_LISTS);
                        
                        const data = {
                            name: name.trim(),
                            description: description.trim(),
                            createdAt: new Date().toISOString(),
                            wordCount: 0,
                            isDefault: false
                        };
                        
                        const request = store.add(data);
                        request.onsuccess = () => {
                            console.log('单词库创建成功:', name, 'ID:', request.result);
                            resolve(request.result);
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                async getWordLists() {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.WORD_LISTS], 'readonly');
                        const store = transaction.objectStore(STORES.WORD_LISTS);
                        const request = store.getAll();
                        request.onsuccess = () => {
                            const lists = request.result || [];
                            lists.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                            resolve(lists);
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                async getWordList(id) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.WORD_LISTS], 'readonly');
                        const store = transaction.objectStore(STORES.WORD_LISTS);
                        const request = store.get(parseInt(id));
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });
                }

                async updateWordListWordCount(listId) {
                    await this.ready();
                    const count = await this.getWordCountByList(listId);
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.WORD_LISTS], 'readwrite');
                        const store = transaction.objectStore(STORES.WORD_LISTS);
                        const getReq = store.get(parseInt(listId));
                        getReq.onsuccess = () => {
                            const list = getReq.result;
                            if (list) {
                                list.wordCount = count;
                                list.updatedAt = new Date().toISOString();
                                const putReq = store.put(list);
                                putReq.onsuccess = () => resolve(count);
                                putReq.onerror = () => reject(putReq.error);
                            } else {
                                resolve(0);
                            }
                        };
                        getReq.onerror = () => reject(getReq.error);
                    });
                }

                async deleteWordList(listId) {
                    await this.ready();
                    const parsedId = parseInt(listId);
                    const words = await this.getWordsByList(parsedId);
                    const wordIds = words.map(w => w.id);
                    if (wordIds.length > 0) {
                        await new Promise((resolve, reject) => {
                            const transaction = this.db.transaction(
                                [STORES.WORDS, STORES.USER_PROGRESS, STORES.NEW_WORDS],
                                'readwrite'
                            );
                            const wordsStore = transaction.objectStore(STORES.WORDS);
                            const progressStore = transaction.objectStore(STORES.USER_PROGRESS);
                            const newWordsStore = transaction.objectStore(STORES.NEW_WORDS);
                            transaction.oncomplete = resolve;
                            transaction.onerror = (e) => reject(e.target.error);
                            wordIds.forEach(id => {
                                wordsStore.delete(id);
                                progressStore.delete(id);
                                newWordsStore.delete(id);
                            });
                        });
                    }
                    await new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.WORD_LISTS], 'readwrite');
                        const store = transaction.objectStore(STORES.WORD_LISTS);
                        const request = store.delete(parsedId);
                        request.onsuccess = resolve;
                        request.onerror = () => reject(request.error);
                    });
                    console.log('单词库删除成功:', parsedId);
                }

                async setDefaultWordList(listId) {
                    await this.ready();
                    const parsedId = parseInt(listId);
                    const currentDefault = await this.getDefaultWordList();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.WORD_LISTS], 'readwrite');
                        transaction.onerror = () => reject(transaction.error);
                        transaction.oncomplete = () => resolve();
                        const store = transaction.objectStore(STORES.WORD_LISTS);
                        if (currentDefault && currentDefault.id !== parsedId) {
                            currentDefault.isDefault = false;
                            store.put(currentDefault);
                        }
                        const getReq = store.get(parsedId);
                        getReq.onsuccess = () => {
                            const list = getReq.result;
                            if (list) {
                                list.isDefault = true;
                                store.put(list);
                            }
                        };
                        getReq.onerror = () => reject(getReq.error);
                    });
                }

                async getDefaultWordList() {
                    const lists = await this.getWordLists();
                    return lists.find(l => l.isDefault) || lists[0] || null;
                }

                async addWord(wordData) {
                    await this.ready();
                    const normalizedWord = wordData.word.toLowerCase().trim();
                    const targetListId = wordData.listId ? parseInt(wordData.listId) : null;
                    const existing = await this.getWordInList(normalizedWord, targetListId);
                    if (existing) {
                        console.log(`单词 "${normalizedWord}" 已在单词库 ${targetListId || '未分类'} 中存在，跳过`);
                        return null;
                    }
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.WORDS], 'readwrite');
                        transaction.onerror = (e) => reject(e.target.error);
                        const store = transaction.objectStore(STORES.WORDS);
                        const data = {
                            ...wordData,
                            word: wordData.word.toLowerCase().trim(),
                            listId: parseInt(wordData.listId) || null,
                            createdAt: new Date().toISOString(),
                            lastReviewed: null,
                            reviewCount: 0
                        };
                        const request = store.add(data);
                        request.onsuccess = () => {
                            console.log('单词保存成功:', data.word, 'ID:', request.result);
                            if (data.listId) {
                                this.updateWordListWordCount(data.listId).catch(console.error);
                            }
                            resolve(request.result);
                        };
                        request.onerror = (e) => {
                            if (e.target.error.name === 'ConstraintError') {
                                resolve(null);
                            } else {
                                reject(e.target.error);
                            }
                        };
                    });
                }

                async getWordInList(word, listId) {
                    await this.ready();
                    const normalizedWord = word.toLowerCase().trim();
                    const targetListId = listId ? parseInt(listId) : null;
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.WORDS], 'readonly');
                        const store = transaction.objectStore(STORES.WORDS);
                        if (targetListId != null) {
                            // 有具体词库：用复合索引精确查 [word, listId]
                            const index = store.index('word_list');
                            const range = IDBKeyRange.only([normalizedWord, targetListId]);
                            const request = index.get(range);
                            request.onsuccess = () => resolve(request.result);
                            request.onerror = () => reject(request.error);
                        } else {
                            // 未分类（listId=null）：复合索引不含 null 键，回退全表扫描过滤
                            const request = store.getAll();
                            request.onsuccess = () => {
                                const all = request.result || [];
                                resolve(all.find(w => w.word === normalizedWord && (w.listId == null)) || null);
                            };
                            request.onerror = () => reject(request.error);
                        }
                    });
                }

                async getWordsByList(listId, filter = {}) {
                    await this.ready();
                    const effectiveListId = (listId === 'all' || listId === null) ? null : listId;
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.WORDS], 'readonly');
                        const store = transaction.objectStore(STORES.WORDS);
                        const request = store.getAll();
                        request.onsuccess = () => {
                            let words = request.result || [];
                            if (effectiveListId === null) {
                            } else if (effectiveListId === 'uncategorized') {
                                words = words.filter(w => !w.listId);
                            } else {
                                const parsedId = parseInt(effectiveListId);
                                if (!isNaN(parsedId)) {
                                    words = words.filter(w => w.listId === parsedId);
                                }
                            }
                            if (filter.difficulty && filter.difficulty !== 'all') {
                                words = words.filter(w => w.difficulty == filter.difficulty);
                            }
                            if (filter.search) {
                                const searchTerm = filter.search.toLowerCase().trim();
                                words = words.filter(w => 
                                    w.word.toLowerCase().includes(searchTerm) ||
                                    (w.meaning && w.meaning.toLowerCase().includes(searchTerm))
                                );
                            }
                            resolve(words);
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                async getWordCountByList(listId) {
                    const words = await this.getWordsByList(listId);
                    return words.length;
                }

                async deleteWord(wordId) {
                    await this.ready();
                    const word = await this.getWordById(wordId);
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.WORDS], 'readwrite');
                        const store = transaction.objectStore(STORES.WORDS);
                        const request = store.delete(parseInt(wordId));
                        request.onsuccess = () => {
                            if (word && word.listId) {
                                this.updateWordListWordCount(word.listId).catch(console.error);
                            }
                            resolve();
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                async updateWord(id, fields) {
                    await this.ready();
                    const word = await this.getWordById(id);
                    if (!word) throw new Error('单词不存在');
                    Object.assign(word, fields, { updatedAt: new Date().toISOString() });
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.WORDS], 'readwrite');
                        const store = transaction.objectStore(STORES.WORDS);
                        const request = store.put(word);
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });
                }

                async getWord(word) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.WORDS], 'readonly');
                        const store = transaction.objectStore(STORES.WORDS);
                        const index = store.index('word');
                        const request = index.get(word.toLowerCase().trim());
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });
                }

                async getWordById(id) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.WORDS], 'readonly');
                        const store = transaction.objectStore(STORES.WORDS);
                        const request = store.get(parseInt(id));
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });
                }

                async getAllWords(filter = {}) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.WORDS], 'readonly');
                        const store = transaction.objectStore(STORES.WORDS);
                        const request = store.getAll();
                        request.onsuccess = () => {
                            let words = request.result || [];
                            if (filter.listId !== undefined && filter.listId !== 'all') {
                                if (filter.listId === null || filter.listId === 'uncategorized') {
                                    words = words.filter(w => !w.listId);
                                } else {
                                    words = words.filter(w => w.listId === parseInt(filter.listId));
                                }
                            }
                            if (filter.difficulty && filter.difficulty !== 'all') {
                                words = words.filter(w => w.difficulty == filter.difficulty);
                            }
                            if (filter.search) {
                                const searchTerm = filter.search.toLowerCase().trim();
                                words = words.filter(w => 
                                    w.word.toLowerCase().includes(searchTerm) ||
                                    (w.meaning && w.meaning.toLowerCase().includes(searchTerm))
                                );
                            }
                            resolve(words);
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                async getWordsByIds(ids) {
                    if (!ids || ids.length === 0) return [];
                    await this.ready();
                    const idSet = new Set(ids.map(id => parseInt(id)));
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.WORDS], 'readonly');
                        const store = transaction.objectStore(STORES.WORDS);
                        const request = store.getAll();
                        request.onsuccess = () => {
                            const all = request.result || [];
                            resolve(all.filter(w => idSet.has(w.id)));
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                async updateProgress(wordId, correct) {
                    await this.ready();
                    const progress = await this.getProgress(wordId);
                    const word = await this.getWordById(wordId);
                    if (!word) {
                        console.warn(`单词ID ${wordId} 不存在，无法更新进度`);
                        return;
                    }
                    const now = new Date();

                    // ---- SM-2 算法（向后兼容旧 familiarity-only 记录）----
                    // 旧记录缺 easeFactor/repetition/interval 时，按 familiarity 即时迁移：
                    //   easeFactor -> 2.5；repetition -> familiarity；interval -> 旧间隔表对应值
                    const OLD_INTERVALS = [1, 3, 7, 14, 30];
                    let repetition, interval, easeFactor, familiarity;
                    if (progress && (progress.easeFactor != null || progress.repetition != null)) {
                        // 已是 SM-2 记录
                        easeFactor = progress.easeFactor != null ? progress.easeFactor : 2.5;
                        repetition = progress.repetition || 0;
                        interval = progress.interval || 1;
                        familiarity = progress.familiarity || 0;
                    } else if (progress) {
                        // 旧记录迁移
                        familiarity = progress.familiarity || 0;
                        repetition = familiarity;
                        interval = familiarity > 0
                            ? OLD_INTERVALS[Math.min(familiarity - 1, OLD_INTERVALS.length - 1)]
                            : 1;
                        easeFactor = 2.5;
                    } else {
                        repetition = 0;
                        interval = 1;
                        easeFactor = 2.5;
                        familiarity = 0;
                    }

                    // 二元答题映射为 SM-2 质量 q：认识=5（完美），不认识=2（有印象但答错，q<3 触发重置）
                    const q = correct ? 5 : 2;

                    if (q >= 3) {
                        if (repetition === 0) {
                            interval = 1;
                        } else if (repetition === 1) {
                            interval = 6;
                        } else {
                            interval = Math.max(1, Math.round(interval * easeFactor));
                        }
                        repetition += 1;
                        familiarity = Math.min(familiarity + 1, 5);
                    } else {
                        repetition = 0;
                        interval = 1;
                        familiarity = Math.max(familiarity - 1, 0);
                    }

                    // 更新 ease factor，下限 1.3
                    easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
                    if (easeFactor < 1.3) easeFactor = 1.3;

                    const nextReview = new Date(now);
                    nextReview.setDate(nextReview.getDate() + interval);
                    const progressData = {
                        wordId: parseInt(wordId),
                        familiarity,
                        repetition,
                        interval,
                        easeFactor,
                        nextReview: nextReview.toISOString(),
                        lastReview: now.toISOString(),
                        totalReviews: (progress?.totalReviews || 0) + 1
                    };
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.USER_PROGRESS], 'readwrite');
                        transaction.onerror = (e) => reject(e.target.error);
                        const store = transaction.objectStore(STORES.USER_PROGRESS);
                        const request = store.put(progressData);
                        request.onsuccess = () => resolve(progressData);
                        request.onerror = () => reject(request.error);
                    });
                }

                async getProgress(wordId) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.USER_PROGRESS], 'readonly');
                        const store = transaction.objectStore(STORES.USER_PROGRESS);
                        const request = store.get(parseInt(wordId));
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });
                }

                async getAllProgress() {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.USER_PROGRESS], 'readonly');
                        const store = transaction.objectStore(STORES.USER_PROGRESS);
                        const request = store.getAll();
                        request.onsuccess = () => resolve(request.result || []);
                        request.onerror = () => reject(request.error);
                    });
                }

                async addToNewWords(wordId) {
                    await this.ready();
                    const parsedId = parseInt(wordId);
                    if (isNaN(parsedId)) {
                        console.error('无效的单词ID:', wordId);
                        throw new Error('无效的单词ID');
                    }
                    const existing = await this.isInNewWords(parsedId);
                    if (existing) {
                        console.log(`单词 ${parsedId} 已在生词本中`);
                        return;
                    }
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.NEW_WORDS], 'readwrite');
                        transaction.onerror = (e) => reject(e.target.error);
                        const store = transaction.objectStore(STORES.NEW_WORDS);
                        const request = store.put({
                            wordId: parsedId,
                            addedAt: new Date().toISOString()
                        });
                        request.onsuccess = () => {
                            console.log(`单词 ${parsedId} 已加入生词本`);
                            resolve();
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                async removeFromNewWords(wordId) {
                    await this.ready();
                    const parsedId = parseInt(wordId);
                    if (isNaN(parsedId)) {
                        throw new Error('无效的单词ID');
                    }
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.NEW_WORDS], 'readwrite');
                        transaction.onerror = (e) => reject(e.target.error);
                        const store = transaction.objectStore(STORES.NEW_WORDS);
                        const request = store.delete(parsedId);
                        request.onsuccess = () => {
                            console.log(`单词 ${parsedId} 已从生词本移除`);
                            resolve();
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                async clearAllNewWords() {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.NEW_WORDS], 'readwrite');
                        const store = transaction.objectStore(STORES.NEW_WORDS);
                        const request = store.clear();
                        request.onsuccess = () => resolve();
                        request.onerror = () => reject(request.error);
                    });
                }

                async isInNewWords(wordId) {
                    await this.ready();
                    const parsedId = parseInt(wordId);
                    if (isNaN(parsedId)) return false;
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.NEW_WORDS], 'readonly');
                        const store = transaction.objectStore(STORES.NEW_WORDS);
                        const request = store.get(parsedId);
                        request.onsuccess = () => resolve(!!request.result);
                        request.onerror = () => reject(request.error);
                    });
                }

                async getNewWords(listIdFilter = null) {
                    await this.ready();
                    const newWordRecords = await new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.NEW_WORDS], 'readonly');
                        const store = transaction.objectStore(STORES.NEW_WORDS);
                        const request = store.getAll();
                        request.onsuccess = () => resolve(request.result || []);
                        request.onerror = () => reject(request.error);
                    });
                    console.log(`生词表原始记录数: ${newWordRecords.length}`);
                    if (newWordRecords.length === 0) return [];
                    const wordIds = newWordRecords.map(r => parseInt(r.wordId)).filter(id => !isNaN(id));
                    const words = await this.getWordsByIds(wordIds);
                    const wordMap = new Map();
                    words.forEach(w => wordMap.set(w.id, w));
                    const wordDetails = [];
                    for (const record of newWordRecords) {
                        const wordId = parseInt(record.wordId);
                        if (isNaN(wordId)) continue;
                        const word = wordMap.get(wordId);
                        if (!word) continue;
                        if (listIdFilter && listIdFilter !== 'all') {
                            if (listIdFilter === 'uncategorized') {
                                if (word.listId) continue;
                            } else {
                                const targetListId = parseInt(listIdFilter);
                                if (isNaN(targetListId) || word.listId !== targetListId) continue;
                            }
                        }
                        wordDetails.push({ ...word, addedAt: record.addedAt });
                    }
                    console.log(`成功获取 ${wordDetails.length}/${newWordRecords.length} 个生词详情（已过滤）`);
                    return wordDetails;
                }

                async saveDailyPlan(plan) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.DAILY_PLAN], 'readwrite');
                        transaction.onerror = (e) => reject(e.target.error);
                        const store = transaction.objectStore(STORES.DAILY_PLAN);
                        const request = store.put({
                            id: 1,
                            ...plan,
                            updatedAt: new Date().toISOString()
                        });
                        request.onsuccess = () => {
                            console.log('学习计划已保存');
                            resolve();
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                async getDailyPlan() {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.DAILY_PLAN], 'readonly');
                        const store = transaction.objectStore(STORES.DAILY_PLAN);
                        const request = store.get(1);
                        request.onsuccess = () => {
                            const result = request.result;
                            if (result) {
                                resolve(result);
                            } else {
                                resolve({
                                    id: 1,
                                    dailyGoal: 20,
                                    reviewGoal: 50,
                                    studyTime: 'any',
                                    notifications: false,
                                    updatedAt: new Date().toISOString()
                                });
                            }
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                async addLearningHistory(wordId, correct) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.LEARNING_HISTORY], 'readwrite');
                        transaction.onerror = (e) => reject(e.target.error);
                        const store = transaction.objectStore(STORES.LEARNING_HISTORY);
                        const request = store.add({
                            wordId: parseInt(wordId),
                            date: new Date().toISOString(),
                            correct
                        });
                        request.onsuccess = () => resolve();
                        request.onerror = () => reject(request.error);
                    });
                }

                async getTodayHistory() {
                    await this.ready();
                    const beijingDate = new Date().toLocaleDateString('zh-CN', {
                        timeZone: 'Asia/Shanghai',
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit'
                    }).replace(/\//g, '-');
                    const start = new Date(beijingDate + 'T00:00:00+08:00').toISOString();
                    const end = new Date(beijingDate + 'T23:59:59.999+08:00').toISOString();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.LEARNING_HISTORY], 'readonly');
                        const store = transaction.objectStore(STORES.LEARNING_HISTORY);
                        const index = store.index('date');
                        const range = IDBKeyRange.bound(start, end);
                        const request = index.getAll(range);
                        request.onsuccess = () => resolve(request.result || []);
                        request.onerror = () => reject(request.error);
                    });
                }

                async updateStreak() {
                    const todayBeijing = new Date().toLocaleDateString('zh-CN', {
                        timeZone: 'Asia/Shanghai',
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit'
                    }).replace(/\//g, '-');
                    const lastStudy = await this.getSetting('lastStudyDate');
                    let currentStreak = await this.getSetting('learningStreak') || 0;
                    let newStreak = currentStreak;
                    if (lastStudy) {
                        const lastBeijing = new Date(lastStudy).toLocaleDateString('zh-CN', {
                            timeZone: 'Asia/Shanghai',
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit'
                        }).replace(/\//g, '-');
                        const lastDate = new Date(lastBeijing);
                        const todayDate = new Date(todayBeijing);
                        const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
                        if (diffDays === 1) {
                            newStreak = currentStreak + 1;
                        } else if (diffDays > 1) {
                            newStreak = 1;
                        }
                    } else {
                        newStreak = 1;
                    }
                    await this.saveSetting('lastStudyDate', new Date().toISOString());
                    await this.saveSetting('learningStreak', newStreak);
                    return newStreak;
                }

                async getLearningStats(days = 30) {
                    await this.ready();
                    const cutoffDate = new Date();
                    cutoffDate.setDate(cutoffDate.getDate() - days);
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.LEARNING_HISTORY], 'readonly');
                        const store = transaction.objectStore(STORES.LEARNING_HISTORY);
                        const request = store.getAll();
                        request.onsuccess = () => {
                            const allHistory = request.result || [];
                            const recentHistory = allHistory.filter(h => 
                                new Date(h.date) >= cutoffDate
                            );
                            const stats = {
                                total: recentHistory.length,
                                correct: recentHistory.filter(h => h.correct).length,
                                incorrect: recentHistory.filter(h => !h.correct).length,
                                byDay: {}
                            };
                            recentHistory.forEach(h => {
                                const day = h.date.split('T')[0];
                                if (!stats.byDay[day]) {
                                    stats.byDay[day] = { total: 0, correct: 0 };
                                }
                                stats.byDay[day].total++;
                                if (h.correct) stats.byDay[day].correct++;
                            });
                            resolve(stats);
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                // 统计 USER_PROGRESS：按 familiarity 分布、已掌握数、总学习单词数、累计复习次数
                async getProgressStats() {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.USER_PROGRESS], 'readonly');
                        const store = transaction.objectStore(STORES.USER_PROGRESS);
                        const request = store.getAll();
                        request.onsuccess = () => {
                            const records = request.result || [];
                            const distribution = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
                            let mastered = 0;
                            let totalReviews = 0;
                            records.forEach(p => {
                                const f = Math.max(0, Math.min(5, p.familiarity || 0));
                                distribution[f]++;
                                if (f >= 4) mastered++;
                                totalReviews += p.totalReviews || 0;
                            });
                            resolve({
                                distribution,
                                mastered,
                                total: records.length,
                                totalReviews
                            });
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                async getAllLearnedWordIds(listIdFilter = null) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.USER_PROGRESS, STORES.WORDS], 'readonly');
                        const progressStore = transaction.objectStore(STORES.USER_PROGRESS);
                        const request = progressStore.getAll();
                        request.onsuccess = async () => {
                            const progressList = request.result || [];
                            const learnedIds = new Set();
                            for (const progress of progressList) {
                                if (listIdFilter && listIdFilter !== 'all') {
                                    if (listIdFilter === 'uncategorized') {
                                        const word = await this.getWordById(progress.wordId);
                                        if (word && !word.listId) {
                                            learnedIds.add(progress.wordId);
                                        }
                                    } else {
                                        const word = await this.getWordById(progress.wordId);
                                        if (word && word.listId === parseInt(listIdFilter)) {
                                            learnedIds.add(progress.wordId);
                                        }
                                    }
                                } else {
                                    learnedIds.add(progress.wordId);
                                }
                            }
                            resolve(learnedIds);
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                async getWordsForReview(listIdFilter = null) {
                    await this.ready();
                    const now = new Date().toISOString();
                    let targetListId = listIdFilter;
                    if (targetListId === null) {
                        targetListId = await this.getSetting('currentListId');
                    }
                    const progressItems = await new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.USER_PROGRESS], 'readonly');
                        const store = transaction.objectStore(STORES.USER_PROGRESS);
                        const index = store.index('nextReview');
                        const range = IDBKeyRange.upperBound(now);
                        const request = index.getAll(range);
                        request.onsuccess = () => resolve(request.result || []);
                        request.onerror = (event) => reject(event.target.error);
                    });
                    console.log(`找到 ${progressItems.length} 条需要复习的进度记录`);
                    if (progressItems.length === 0) return [];
                    const wordIds = progressItems.map(p => p.wordId);
                    const words = await this.getWordsByIds(wordIds);
                    const wordMap = new Map();
                    words.forEach(w => wordMap.set(w.id, w));
                    const wordDetails = [];
                    for (const progress of progressItems) {
                        const word = wordMap.get(progress.wordId);
                        if (!word) continue;
                        if (targetListId && targetListId !== 'all') {
                            if (targetListId === 'uncategorized') {
                                if (word.listId) continue;
                            } else {
                                if (word.listId !== parseInt(targetListId)) continue;
                            }
                        }
                        wordDetails.push({ ...word, progress });
                    }
                    console.log(`成功获取 ${wordDetails.length} 个复习单词（已按单词库过滤）`);
                    return wordDetails;
                }

                async getTodayWords(limit = 20) {
                    const plan = await this.getDailyPlan();
                    const currentListId = await this.getSetting('currentListId');
                    const dueReviewWords = await this.getWordsForReview(currentListId);
                    const reviewQuota = Math.min(dueReviewWords.length, plan.reviewGoal);
                    const reviewWordsToLearn = dueReviewWords.slice(0, reviewQuota);
                    const remainingQuota = Math.max(0, plan.dailyGoal - reviewWordsToLearn.length);
                    let allWords;
                    if (currentListId && currentListId !== 'all') {
                        allWords = await this.getWordsByList(currentListId);
                    } else {
                        allWords = await this.getAllWords();
                    }
                    const allLearnedIds = await this.getAllLearnedWordIds(currentListId);
                    const trulyNewWords = allWords
                        .filter(w => !allLearnedIds.has(w.id))
                        .sort((a, b) => {
                            const freqA = a.frequency || 0;
                            const freqB = b.frequency || 0;
                            if (freqA !== freqB) return freqB - freqA;
                            return Math.random() - 0.5;
                        })
                        .slice(0, remainingQuota);
                    const todayWords = [...reviewWordsToLearn, ...trulyNewWords];
                    console.log(`获取今日单词: 复习 ${reviewWordsToLearn.length} 个, 新学 ${trulyNewWords.length} 个, 总计 ${todayWords.length} 个`);
                    console.log(`  - 到期复习: ${dueReviewWords.length} 个, 取 ${reviewQuota} 个`);
                    console.log(`  - 真正新词: ${trulyNewWords.length}/${allWords.length - allLearnedIds.size} 个可用`);
                    return todayWords;
                }

                async saveSetting(key, value) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.SETTINGS], 'readwrite');
                        transaction.onerror = (e) => reject(e.target.error);
                        const store = transaction.objectStore(STORES.SETTINGS);
                        const request = store.put({ 
                            key, 
                            value, 
                            updatedAt: new Date().toISOString() 
                        });
                        request.onsuccess = () => resolve();
                        request.onerror = () => reject(request.error);
                    });
                }

                async getSetting(key, defaultValue = null) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.SETTINGS], 'readonly');
                        const store = transaction.objectStore(STORES.SETTINGS);
                        const request = store.get(key);
                        request.onsuccess = () => {
                            const result = request.result;
                            resolve(result ? result.value : defaultValue);
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                async getAllSettings() {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.SETTINGS], 'readonly');
                        const store = transaction.objectStore(STORES.SETTINGS);
                        const request = store.getAll();
                        request.onsuccess = () => {
                            const settings = {};
                            (request.result || []).forEach(setting => {
                                settings[setting.key] = setting.value;
                            });
                            resolve(settings);
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                async debugDatabase() {
                    await this.ready();
                    const allWords = await this.getAllWords();
                    const newWords = await this.getNewWords();
                    const reviewWords = await this.getWordsForReview();
                    const todayHistory = await this.getTodayHistory();
                    const plan = await this.getDailyPlan();
                    const settings = await this.getAllSettings();
                    const wordLists = await this.getWordLists();
                    console.log('=== 数据库调试信息 ===');
                    console.log(`总单词数: ${allWords.length}`);
                    console.log(`生词本单词数: ${newWords.length}`);
                    console.log(`需要复习的单词数: ${reviewWords.length}`);
                    console.log(`今日学习记录数: ${todayHistory.length}`);
                    console.log(`单词库数量: ${wordLists.length}`);
                    console.log(`学习计划:`, plan);
                    console.log(`设置:`, settings);
                    return {
                        allWords,
                        newWords,
                        reviewWords,
                        todayHistory,
                        plan,
                        settings,
                        wordLists
                    };
                }

                async clearAllData() {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        this.close();
                        const request = indexedDB.deleteDatabase(DB_NAME);
                        request.onsuccess = () => {
                            console.log('数据库已清空');
                            this.initPromise = null;
                            resolve();
                        };
                        request.onerror = () => reject(request.error);
                        request.onblocked = () => {
                            console.warn('删除数据库被阻塞');
                            reject(new Error('请关闭其他标签页后重试'));
                        };
                    });
                }

                // ===== 阅读文章 CRUD =====
                async saveArticle({ title, content, format, currentPosition, wordCount, createdAt, updatedAt }) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.NOVELS], 'readwrite');
                        const store = transaction.objectStore(STORES.NOVELS);
                        const request = store.add({
                            title: title || '未命名文章',
                            content: content || '',
                            format: format || 'txt',
                            wordCount: wordCount || (content ? content.split(/\s+/).filter(w => w.length > 0).length : 0),
                            currentPosition: currentPosition != null ? currentPosition : 0,
                            createdAt: createdAt || new Date().toISOString(),
                            updatedAt: updatedAt || new Date().toISOString()
                        });
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });
                }

                async getArticles() {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.NOVELS], 'readonly');
                        const store = transaction.objectStore(STORES.NOVELS);
                        const request = store.getAll();
                        request.onsuccess = () => {
                            const articles = request.result || [];
                            articles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                            resolve(articles);
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                async getArticle(id) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.NOVELS], 'readonly');
                        const store = transaction.objectStore(STORES.NOVELS);
                        const request = store.get(parseInt(id));
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });
                }

                async deleteArticle(id) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.NOVELS], 'readwrite');
                        const store = transaction.objectStore(STORES.NOVELS);
                        const request = store.delete(parseInt(id));
                        request.onsuccess = () => resolve();
                        request.onerror = () => reject(request.error);
                    });
                }

                async updateArticlePosition(id, scrollPercent) {
                    await this.ready();
                    const parsedId = parseInt(id);
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.NOVELS], 'readwrite');
                        const store = transaction.objectStore(STORES.NOVELS);
                        const getReq = store.get(parsedId);
                        getReq.onsuccess = () => {
                            const article = getReq.result;
                            if (article) {
                                article.currentPosition = scrollPercent;
                                article.updatedAt = new Date().toISOString();
                                store.put(article);
                            }
                            resolve();
                        };
                        getReq.onerror = () => reject(getReq.error);
                    });
                }

                // ===== 听力模块 CRUD =====
                async saveListeningFile({ title, content, totalDuration, segmentCount }) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.LISTENING_FILES], 'readwrite');
                        const store = transaction.objectStore(STORES.LISTENING_FILES);
                        const request = store.add({
                            title: title || '未命名',
                            content: content || '',
                            totalDuration: totalDuration || 0,
                            segmentCount: segmentCount || 0,
                            status: 'generating',
                            generatedSegments: 0,
                            lastSegmentIndex: 0,
                            lastSegmentTime: 0,
                            createdAt: new Date().toISOString()
                        });
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });
                }

                async getListeningFiles() {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.LISTENING_FILES], 'readonly');
                        const store = transaction.objectStore(STORES.LISTENING_FILES);
                        const request = store.getAll();
                        request.onsuccess = () => {
                            const files = request.result || [];
                            files.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                            resolve(files);
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                async getListeningFile(id) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.LISTENING_FILES], 'readonly');
                        const store = transaction.objectStore(STORES.LISTENING_FILES);
                        const request = store.get(parseInt(id));
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });
                }

                async deleteListeningFile(id) {
                    await this.ready();
                    const parsedId = parseInt(id);
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.LISTENING_FILES, STORES.AUDIO_SEGMENTS], 'readwrite');
                        const lfStore = transaction.objectStore(STORES.LISTENING_FILES);
                        const asStore = transaction.objectStore(STORES.AUDIO_SEGMENTS);
                        const idx = asStore.index('fileId');
                        const getAllReq = idx.getAll(parsedId);
                        getAllReq.onsuccess = () => {
                            const segments = getAllReq.result || [];
                            segments.forEach(seg => asStore.delete(seg.id));
                            lfStore.delete(parsedId);
                        };
                        transaction.oncomplete = () => resolve();
                        transaction.onerror = () => reject(transaction.error);
                    });
                }

                async saveAudioSegment({ fileId, segmentIndex, title, text, duration, audioBlob }) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.AUDIO_SEGMENTS], 'readwrite');
                        const store = transaction.objectStore(STORES.AUDIO_SEGMENTS);
                        const request = store.add({
                            fileId: parseInt(fileId),
                            segmentIndex,
                            title: title || '',
                            text: text || '',
                            duration: duration || 0,
                            audioBlob,
                            createdAt: new Date().toISOString()
                        });
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });
                }

                async getAudioSegmentsByFile(fileId) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.AUDIO_SEGMENTS], 'readonly');
                        const store = transaction.objectStore(STORES.AUDIO_SEGMENTS);
                        const idx = store.index('fileId');
                        const request = idx.getAll(parseInt(fileId));
                        request.onsuccess = () => {
                            const segments = request.result || [];
                            segments.sort((a, b) => a.segmentIndex - b.segmentIndex);
                            resolve(segments);
                        };
                        request.onerror = () => reject(request.error);
                    });
                }

                async getAudioSegment(id) {
                    await this.ready();
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.AUDIO_SEGMENTS], 'readonly');
                        const store = transaction.objectStore(STORES.AUDIO_SEGMENTS);
                        const request = store.get(parseInt(id));
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });
                }

                async updateListeningFileStatus(id, fields) {
                    await this.ready();
                    const parsedId = parseInt(id);
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.LISTENING_FILES], 'readwrite');
                        const store = transaction.objectStore(STORES.LISTENING_FILES);
                        const getReq = store.get(parsedId);
                        getReq.onsuccess = () => {
                            const file = getReq.result;
                            if (file) {
                                Object.assign(file, fields, { updatedAt: new Date().toISOString() });
                                const putReq = store.put(file);
                                putReq.onsuccess = () => resolve(putReq.result);
                                putReq.onerror = () => reject(putReq.error);
                            } else {
                                resolve(null);
                            }
                        };
                        getReq.onerror = () => reject(getReq.error);
                    });
                }

                async updateListeningPosition(id, lastSegmentIndex, lastSegmentTime) {
                    await this.ready();
                    const parsedId = parseInt(id);
                    return new Promise((resolve, reject) => {
                        const transaction = this.db.transaction([STORES.LISTENING_FILES], 'readwrite');
                        const store = transaction.objectStore(STORES.LISTENING_FILES);
                        const getReq = store.get(parsedId);
                        getReq.onsuccess = () => {
                            const file = getReq.result;
                            if (file) {
                                file.lastSegmentIndex = lastSegmentIndex != null ? parseInt(lastSegmentIndex) : 0;
                                file.lastSegmentTime = lastSegmentTime != null ? lastSegmentTime : 0;
                                file.updatedAt = new Date().toISOString();
                                const putReq = store.put(file);
                                putReq.onsuccess = () => resolve();
                                putReq.onerror = () => reject(putReq.error);
                            } else {
                                resolve();
                            }
                        };
                        getReq.onerror = () => reject(getReq.error);
                    });
                }
            }

            window.wordDB = new WordDatabase();
        })();
