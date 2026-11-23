const test = require('node:test');
const assert = require('node:assert/strict');
const stats = require('../js/stats.js');

test('dayKey 按北京时间分桶', () => {
    assert.equal(stats.dayKey('2024-01-01T16:30:00Z'), '2024-01-02');
    assert.equal(stats.dayKey(new Date('2024-06-30T20:00:00Z')), '2024-07-01');
    assert.equal(stats.dayKey('not-a-date'), '');
});

test('hourlyHeatmap 使用北京小时（0-23）', () => {
    const hours = stats.hourlyHeatmap([
        { review: '2024-01-01T16:30:00Z' },
        { review: '2024-01-01T16:45:00Z' },
        { review: '2024-01-01T17:00:00Z' }
    ]);
    assert.equal(hours.length, 24);
    assert.equal(hours[0], 2);
    assert.equal(hours[1], 1);
    assert.equal(hours.reduce((a, b) => a + b, 0), 3);
});

test('aggregateReviewLog 聚合日志、回忆率与北京小时分布', () => {
    const result = stats.aggregateReviewLog([
        { review: '2024-01-01T16:30:00Z', rating: 3, scheduled_days: 2, elapsed_days: 3, difficulty: 4 },
        { review: '2024-01-01T17:30:00Z', rating: 1, scheduled_days: 1, elapsed_days: 10, difficulty: 6 }
    ]);
    assert.equal(result.total, 2);
    assert.equal(result.byDay['2024-01-02'].total, 2);
    assert.equal(result.hourly[0], 1);
    assert.equal(result.hourly[1], 1);
    assert.equal(result.recallRate, 0.5);
    assert.equal(result.ratingDist[3], 1);
    assert.equal(result.ratingList.find(r => r.rating === 3).avgInterval, 2);
    assert.ok(result.elapsedList.find(b => b.bucket === '1-7'));
});

test('aggregateProgress 聚合 FSRS 状态、成熟词与易忘词', () => {
    const result = stats.aggregateProgress([
        { state: 2, stability: 30, difficulty: 5, nextReview: '2024-01-03T00:00:00Z', totalReviews: 3 },
        { state: 2, stability: 10, difficulty: 4, nextReview: '2024-01-01T00:00:00Z' },
        { state: 1, stability: 2, isLeech: true, nextReview: '2025-01-01T00:00:00Z' },
        { state: 0, nextReview: '' }
    ], { now: new Date('2024-01-02T00:00:00Z') });
    assert.equal(result.total, 4);
    assert.deepEqual(result.states, { new: 1, learning: 1, review: 2, relearning: 0 });
    assert.equal(result.matured, 1);
    assert.equal(result.leeches, 1);
    assert.equal(result.dueNow, 1);
    assert.equal(result.avgDifficulty, 4.5);
});

test('forecastDue 按北京日键预测复习负荷', () => {
    const result = stats.forecastDue([
        { nextReview: '2024-01-01T20:00:00Z' },
        { nextReview: '2023-12-30T00:00:00Z' },
        { nextReview: '' }
    ], { now: new Date('2024-01-01T18:00:00Z'), days: 3 });
    assert.equal(result.days.length, 3);
    assert.equal(result.days[0].key, '2024-01-02');
    assert.equal(result.days[0].count, 1);
    assert.equal(result.overdue, 1);
    assert.equal(result.unscheduled, 1);
    assert.equal(result.total, 1);
});

test('toCsv 转义逗号、引号与换行', () => {
    const csv = stats.toCsv(
        [{ word: 'a,b', note: 'say "hi"\nnext' }],
        ['word', 'note']
    );
    assert.equal(csv, 'word,note\n"a,b","say ""hi""\nnext"');
});
