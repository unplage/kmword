const test = require('node:test');
const assert = require('node:assert/strict');
const mw = require('../js/mw-parser.js');

test('cleanText / cleanRich 去掉标记并保留强调语义', () => {
    assert.equal(mw.cleanText('a {sc}b{/sc} {it}c{/it} {dx_def}d{/dx_def}'), 'a b c d');
    assert.equal(mw.cleanText(['{sx|word|1}', ' second ']), 'word second');
    assert.equal(
        mw.cleanRich('{sc}a{/sc} {it}b{/it} {wi}c{/wi} {b}d{/b} {sup}e{/sup} {zz}f{/zz}'),
        '<strong>a</strong> <i>b</i> <i>c</i> <b>d</b> <sup>e</sup> f'
    );
});

test('buildAudioUrl 按官方 subdir 规则拼装', () => {
    const base = 'https://media.merriam-webster.com/audio/prons/en/us/mp3/';
    assert.equal(mw.buildAudioUrl('bix123'), base + 'bix/bix123.mp3');
    assert.equal(mw.buildAudioUrl('ggabc'), base + 'gg/ggabc.mp3');
    assert.equal(mw.buildAudioUrl('1try'), base + 'number/1try.mp3');
    assert.equal(mw.buildAudioUrl('hello'), base + 'h/hello.mp3');
    assert.equal(mw.buildAudioUrl(''), '');
});

test('parseDictEntry 解析 shortdef、音标、sseq 义项与例句', () => {
    const sense = {
        sn: '1a',
        dt: [
            ['text', 'to move {it}quickly{/it}'],
            ['vis', [{ t: 'he ran home', aq: { auth: 'Smith' } }]]
        ],
        sdsense: { sd: 'to flee', dt: [['text', 'to run away']] }
    };
    const entry = {
        hwi: { hw: 'run', prs: [{ mw: 'rən', sound: { audio: 'runni01' } }] },
        fl: 'verb',
        shortdef: ['to go fast', 'to operate'],
        def: [{ vd: 'especially of a person', sseq: [[['sense', sense]]] }]
    };
    const [parsed] = mw.parseDict([entry]);
    assert.equal(parsed.headword, 'run');
    assert.deepEqual(parsed.shortDefs, ['to go fast', 'to operate']);
    assert.equal(parsed.pronunciations[0].audioUrl, mw.buildAudioUrl('runni01'));
    assert.equal(parsed.definitions.length, 1);
    assert.equal(parsed.definitions[0].number, '1a');
    assert.equal(parsed.definitions[0].division, 'especially of a person');
    assert.equal(parsed.definitions[0].text, 'to move <i>quickly</i>');
    assert.equal(parsed.definitions[0].examples[0].text, 'he ran home');
    assert.equal(parsed.definitions[0].examples[0].source, 'Smith');
    assert.equal(parsed.definitions[0].subsenses[0].division, 'to flee');
    assert.equal(parsed.definitions[0].subsenses[0].text, 'to run away');
});

test('parseThesaurus 汇总 meta 词表、义项同反义词与词级标签', () => {
    const data = [{
        meta: { syns: [['big', 'large']], ants: [['small']] },
        def: [{ sseq: [[['sense', {
            sn: '1',
            syn_list: [[{ wd: 'huge' }, { wd: 'vast', wsls: { wsl: 'chiefly British' } }]],
            ant_list: [[{ wd: 'tiny' }]]
        }]]] }]
    }];
    const result = mw.parseThesaurus(data);
    assert.ok(result.synonyms.includes('big'));
    assert.ok(result.synonyms.includes('huge'));
    assert.ok(result.antonyms.includes('small'));
    assert.ok(result.antonyms.includes('tiny'));
    assert.equal(result.synonymGroups.length, 1);
    assert.equal(result.statuses.find(s => s.word === 'vast').status, 'chiefly British');
});

test('parseSense / parseDict 对空输入安全返回', () => {
    assert.deepEqual(mw.parseDict([]), []);
    assert.deepEqual(mw.parseDict(['Word not found']), []);
    const sense = mw.parseSense({ dt: [['text', 'a {ds|xxx} b']] });
    assert.equal(sense.text, 'a b');
    assert.deepEqual(sense.examples, []);
    assert.deepEqual(sense.subsenses, []);
});
