// 统计聚合与图表数据计算（纯函数，便于单元测试）
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.statsUtil = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const BEIJING = 'Asia/Shanghai';
    const RECALL_RATING = 3; // Good 及以上视为记住

    // ---------- 基础工具 ----------

    function toDate(value) {
        if (value instanceof Date) return value;
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }

    // 北京时间日键（与连续天数、每日计划口径一致）
    function dayKey(value) {
        const d = toDate(value);
        if (!d) return '';
        return d.toLocaleDateString('zh-CN', {
            timeZone: BEIJING,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).replace(/\//g, '-');
    }

    function dayKeyOffset(offsetDays, base) {
        const d = base ? toDate(base) : new Date();
        const copy = new Date(d.getTime());
        copy.setDate(copy.getDate() + offsetDays);
        return dayKey(copy);
    }

    function startOfBeijingDay(value) {
        const d = toDate(value) || new Date();
        const key = dayKey(d);
        return new Date(key + 'T00:00:00+08:00');
    }

    function daysBetween(fromKey, toKeyStr) {
        const a = new Date(fromKey + 'T00:00:00+08:00').getTime();
        const b = new Date(toKeyStr + 'T00:00:00+08:00').getTime();
        if (isNaN(a) || isNaN(b)) return 0;
        return Math.round((b - a) / 86400000);
    }

    function percentile(sortedValues, p) {
        if (!Array.isArray(sortedValues) || !sortedValues.length) return 0;
        const idx = (sortedValues.length - 1) * p;
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        if (lo === hi) return sortedValues[lo];
        return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (idx - lo);
    }

    function median(values) {
        const list = (values || []).filter(v => Number.isFinite(v)).slice().sort((a, b) => a - b);
        if (!list.length) return 0;
        const mid = Math.floor(list.length / 2);
        return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
    }

    function stabilityBucket(days) {
        if (!Number.isFinite(days) || days <= 0) return '<7';
        if (days < 7) return '<7';
        if (days < 30) return '7-30';
        if (days < 90) return '30-90';
        return '>90';
    }

    function elapsedBucket(days) {
        if (!Number.isFinite(days) || days <= 1) return '0-1';
        if (days < 7) return '1-7';
        if (days < 30) return '7-30';
        return '30+';
    }

    function difficultyBucket(difficulty) {
        const d = Number(difficulty);
        if (!Number.isFinite(d) || d <= 0) return '0';
        if (d < 3) return '1-2';
        if (d < 5) return '3-4';
        if (d < 7) return '5-6';
        if (d < 9) return '7-8';
        return '9-10';
    }

    function stateName(state, FSRS) {
        const names = ['new', 'learning', 'review', 'relearning'];
        const name = names[state] || 'new';
        return name;
    }

    // ---------- 单词进度聚合（FSRS 维度）----------

    function aggregateProgress(records, options = {}) {
        const now = options.now || new Date();
        const fsrs = options.fsrs || null;
        const cardFrom = options.cardFromProgress || null;
        const maturedThreshold = Number.isFinite(options.maturedThreshold) ? options.maturedThreshold : 21;

        const out = {
            total: 0,
            states: { new: 0, learning: 0, review: 0, relearning: 0 },
            stabilityBuckets: { '<7': 0, '7-30': 0, '30-90': 0, '>90': 0 },
            retrievabilityBuckets: { '<50%': 0, '50-70%': 0, '70-85%': 0, '85-95%': 0, '>=95%': 0 },
            stabilityValues: [],
            retrievabilityValues: [],
            retrievabilitySum: 0,
            retrievabilityCount: 0,
            difficultySum: 0,
            difficultyCount: 0,
            matured: 0,
            leeches: 0,
            dueNow: 0,
            totalReviews: 0,
            avgLapses: 0,
            lapseSum: 0
        };

        for (const p of records || []) {
            out.total++;
            out.totalReviews += p.totalReviews || 0;
            out.lapseSum += p.lapses || 0;
            if (p.isLeech) out.leeches++;

            const state = stateName(p.state);
            out.states[state] = (out.states[state] || 0) + 1;

            const stability = Number(p.stability) || 0;
            if (state === 'review' && stability > 0) {
                out.stabilityBuckets[stabilityBucket(stability)]++;
                out.stabilityValues.push(stability);
                if (stability >= maturedThreshold) out.matured++;
            }

            const difficulty = Number(p.difficulty) || 0;
            if (difficulty > 0) {
                out.difficultySum += difficulty;
                out.difficultyCount++;
            }

            const due = toDate(p.nextReview);
            if (due && due.getTime() <= now.getTime()) out.dueNow++;

            if (fsrs && cardFrom && state === 'review' && stability > 0) {
                try {
                    const card = cardFrom(p, now);
                    const r = fsrs.get_retrievability(card, now, false);
                    if (Number.isFinite(r)) {
                        out.retrievabilityValues.push(r);
                        out.retrievabilitySum += r;
                        out.retrievabilityCount++;
                        if (r < 0.5) out.retrievabilityBuckets['<50%']++;
                        else if (r < 0.7) out.retrievabilityBuckets['50-70%']++;
                        else if (r < 0.85) out.retrievabilityBuckets['70-85%']++;
                        else if (r < 0.95) out.retrievabilityBuckets['85-95%']++;
                        else out.retrievabilityBuckets['>=95%']++;
                    }
                } catch (e) { /* 单个卡片计算失败不影响整体 */ }
            }
        }

        out.avgRetrievability = out.retrievabilityCount ? out.retrievabilitySum / out.retrievabilityCount : null;
        out.medianStability = median(out.stabilityValues);
        out.avgDifficulty = out.difficultyCount ? out.difficultySum / out.difficultyCount : 0;
        out.avgLapses = out.total ? out.lapseSum / out.total : 0;
        out.stabilityValues = null;
        out.retrievabilityValues = null;
        return out;
    }

    // ---------- 未来复习负荷预测 ----------

    function forecastDue(records, options = {}) {
        const now = options.now || new Date();
        const days = Number.isFinite(options.days) ? options.days : 14;
        const start = startOfBeijingDay(now);
        const buckets = [];
        for (let i = 0; i < days; i++) {
            const d = new Date(start.getTime() + i * 86400000);
            buckets.push({ key: dayKey(d), date: d, count: 0 });
        }
        const index = new Map(buckets.map((b, i) => [b.key, i]));
        let overdue = 0;
        let unscheduled = 0;
        for (const p of records || []) {
            const due = toDate(p.nextReview);
            if (!due) { unscheduled++; continue; }
            const key = dayKey(due);
            if (index.has(key)) {
                buckets[index.get(key)].count++;
            } else if (due.getTime() < start.getTime()) {
                overdue++;
            }
        }
        return { days: buckets, overdue, unscheduled, total: buckets.reduce((s, b) => s + b.count, 0) };
    }

    // ---------- 复习日志聚合 ----------

    function aggregateReviewLog(logs, options = {}) {
        const now = options.now || new Date();
        const out = {
            total: 0,
            byDay: {},
            ratingDist: { 1: 0, 2: 0, 3: 0, 4: 0 },
            ratingIntervalSum: { 1: 0, 2: 0, 3: 0, 4: 0 },
            ratingIntervalCount: { 1: 0, 2: 0, 3: 0, 4: 0 },
            elapsedBuckets: {},
            difficultyBuckets: {},
            hourly: new Array(24).fill(0),
            recallSum: 0,
            recallCount: 0
        };

        for (const log of logs || []) {
            if (!log) continue;
            const review = toDate(log.review);
            if (!review) continue;
            out.total++;
            const key = dayKey(review);
            if (!out.byDay[key]) out.byDay[key] = { total: 0, recall: 0, ratings: { 1: 0, 2: 0, 3: 0, 4: 0 } };
            const day = out.byDay[key];
            day.total++;
            const rating = Number(log.rating) || 0;
            if (rating >= 1 && rating <= 4) {
                out.ratingDist[rating]++;
                day.ratings[rating]++;
                const interval = Number(log.scheduled_days) || 0;
                out.ratingIntervalSum[rating] += interval;
                out.ratingIntervalCount[rating]++;
            }
            if (rating >= RECALL_RATING) {
                day.recall++;
                out.recallSum++;
            }
            out.recallCount++;

            const eb = elapsedBucket(Number(log.elapsed_days) || 0);
            if (!out.elapsedBuckets[eb]) out.elapsedBuckets[eb] = { total: 0, recall: 0, elapsedSum: 0 };
            out.elapsedBuckets[eb].total++;
            out.elapsedBuckets[eb].elapsedSum += Number(log.elapsed_days) || 0;
            if (rating >= RECALL_RATING) out.elapsedBuckets[eb].recall++;

            const db = difficultyBucket(log.difficulty);
            if (!out.difficultyBuckets[db]) out.difficultyBuckets[db] = { total: 0, recall: 0 };
            out.difficultyBuckets[db].total++;
            if (rating >= RECALL_RATING) out.difficultyBuckets[db].recall++;

            const hour = review.getHours();
            if (hour >= 0 && hour < 24) out.hourly[hour]++;
        }

        out.recallRate = out.recallCount ? out.recallSum / out.recallCount : null;
        out.elapsedList = ['0-1', '1-7', '7-30', '30+'].map(b => {
            const item = out.elapsedBuckets[b] || { total: 0, recall: 0, elapsedSum: 0 };
            return {
                bucket: b,
                total: item.total,
                recall: item.recall,
                rate: item.total ? item.recall / item.total : null,
                avgElapsed: item.total ? item.elapsedSum / item.total : 0
            };
        });
        out.difficultyList = ['1-2', '3-4', '5-6', '7-8', '9-10', '0'].map(b => {
            const item = out.difficultyBuckets[b] || { total: 0, recall: 0 };
            return { bucket: b, total: item.total, recall: item.recall, rate: item.total ? item.recall / item.total : null };
        });
        out.ratingList = [1, 2, 3, 4].map(r => ({
            rating: r,
            count: out.ratingDist[r],
            avgInterval: out.ratingIntervalCount[r] ? out.ratingIntervalSum[r] / out.ratingIntervalCount[r] : 0
        }));
        return out;
    }

    // ---------- 理论遗忘曲线（R(t,S)）----------

    function theoreticalCurve(fsrs, stability, elapsedList) {
        if (!fsrs || typeof fsrs.forgetting_curve !== 'function') return [];
        return (elapsedList || []).map(t => ({
            elapsed: t,
            retrievability: fsrs.forgetting_curve(t, stability)
        }));
    }

    // ---------- 学习时段热力图 ----------

    function hourlyHeatmap(logs) {
        const hours = new Array(24).fill(0);
        for (const log of logs || []) {
            const d = toDate(log && log.review);
            if (!d) continue;
            hours[d.getHours()]++;
        }
        return hours;
    }

    // ---------- 活跃热力图（GitHub 风格，近 N 周）----------

    function activityHeatmap(history, options = {}) {
        const weeks = Number.isFinite(options.weeks) ? options.weeks : 26;
        const now = options.now || new Date();
        const end = startOfBeijingDay(now);
        const totalDays = weeks * 7;
        const start = new Date(end.getTime() - (totalDays - 1) * 86400000);
        const counts = new Map();
        for (const item of history || []) {
            const key = dayKey(item && item.date);
            if (!key) continue;
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        const cells = [];
        let max = 0;
        for (let i = 0; i < totalDays; i++) {
            const d = new Date(start.getTime() + i * 86400000);
            const key = dayKey(d);
            const count = counts.get(key) || 0;
            if (count > max) max = count;
            cells.push({ key, count, date: d });
        }
        // 按周分列（每 7 天一列）
        const columns = [];
        for (let i = 0; i < cells.length; i += 7) {
            columns.push(cells.slice(i, i + 7));
        }
        return { columns, max, cells };
    }

    // ---------- 词库维度 ----------

    function aggregateByList(words, progressById, lists) {
        const listMap = new Map((lists || []).map(l => [l.id, l]));
        const buckets = new Map();
        for (const w of words || []) {
            const listId = w.listId || 0;
            const key = listId;
            if (!buckets.has(key)) {
                const list = listMap.get(listId);
                buckets.set(key, {
                    listId,
                    name: list ? list.name : '未分类',
                    total: 0,
                    studied: 0,
                    mature: 0,
                    leeches: 0,
                    due: 0,
                    lapses: 0,
                    reviews: 0
                });
            }
            const bucket = buckets.get(key);
            bucket.total++;
            const p = progressById ? progressById.get(w.id) : null;
            if (p) {
                bucket.studied++;
                bucket.reviews += p.totalReviews || 0;
                bucket.lapses += p.lapses || 0;
                if (p.isLeech) bucket.leeches++;
                if ((Number(p.stability) || 0) >= 21) bucket.mature++;
                const due = toDate(p.nextReview);
                if (due && due.getTime() <= Date.now()) bucket.due++;
            }
        }
        return Array.from(buckets.values()).sort((a, b) => b.total - a.total);
    }

    // ---------- 易忘词排行 ----------

    function hardWords(records, options = {}) {
        const limit = Number.isFinite(options.limit) ? options.limit : 10;
        const now = options.now || new Date();
        const list = (records || []).filter(p => p && (p.lapses > 0 || p.isLeech));
        list.sort((a, b) => {
            const la = (b.lapses || 0) - (a.lapses || 0);
            if (la !== 0) return la;
            const sa = (Number(a.stability) || 0) - (Number(b.stability) || 0);
            if (sa !== 0) return sa;
            return (b.totalReviews || 0) - (a.totalReviews || 0);
        });
        return list.slice(0, limit).map(p => ({
            wordId: p.wordId,
            lapses: p.lapses || 0,
            stability: Number(p.stability) || 0,
            difficulty: Number(p.difficulty) || 0,
            totalReviews: p.totalReviews || 0,
            isLeech: !!p.isLeech,
            nextReview: p.nextReview || ''
        }));
    }

    // ---------- CSV 导出 ----------

    function toCsv(rows, headers) {
        const escape = (value) => {
            const text = value == null ? '' : String(value);
            if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
            return text;
        };
        const lines = [];
        if (headers && headers.length) lines.push(headers.map(escape).join(','));
        for (const row of rows || []) {
            lines.push((headers || Object.keys(row)).map(h => escape(row[h])).join(','));
        }
        return lines.join('\n');
    }

    return {
        BEIJING,
        RECALL_RATING,
        dayKey,
        dayKeyOffset,
        startOfBeijingDay,
        daysBetween,
        percentile,
        median,
        stabilityBucket,
        elapsedBucket,
        difficultyBucket,
        aggregateProgress,
        forecastDue,
        aggregateReviewLog,
        theoreticalCurve,
        hourlyHeatmap,
        activityHeatmap,
        aggregateByList,
        hardWords,
        toCsv
    };
});
