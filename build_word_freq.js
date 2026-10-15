// 生成 js/word-freq.js —— NovelProcessor 使用的词频排名数据
//
// 数据来源：hermitdave/FrequencyWords 的 OpenSubtitles 2018 英文词频表
//   https://github.com/hermitdave/FrequencyWords （MIT License）
// 取词频最高的 TOP_N 个纯字母单词（小写、去重），按频率降序排列，
// 数组下标 + 1 即词频排名（1 = 最高频）。
//
// 用法：node build_word_freq.js
//   - 数据源自动下载并缓存到系统临时目录，重新生成时无需重新下载

const fs = require('fs');
const os = require('os');
const path = require('path');

const SOURCE_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt';
const CACHE_PATH = path.join(os.tmpdir(), 'en_50k.txt');
const TOP_N = 12000;
const OUT_PATH = path.join(__dirname, 'js', 'word-freq.js');

async function loadSource() {
    if (fs.existsSync(CACHE_PATH)) {
        console.log(`使用缓存: ${CACHE_PATH}`);
        return fs.readFileSync(CACHE_PATH, 'utf8');
    }
    console.log(`下载数据源: ${SOURCE_URL}`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`下载失败: HTTP ${res.status}`);
    const raw = await res.text();
    fs.writeFileSync(CACHE_PATH, raw);
    return raw;
}

async function main() {
    const raw = await loadSource();
    const seen = new Set();
    const words = [];
    for (const line of raw.split('\n')) {
        const word = line.trim().split(/\s+/)[0];
        if (!word || !/^[a-z]+$/.test(word) || word.length < 2) continue;
        if (seen.has(word)) continue;
        seen.add(word);
        words.push(word);
        if (words.length >= TOP_N) break;
    }
    if (words.length < TOP_N) throw new Error(`只收集到 ${words.length} 个单词，低于目标 ${TOP_N}`);
    const header = [
        '// 词频排名数据（自动生成，勿手动编辑）',
        '// 来源：hermitdave/FrequencyWords · OpenSubtitles 2018 英文词频表（MIT License）',
        `// 词频最高的 ${TOP_N} 个单词，按频率降序；数组下标 + 1 = 排名`,
        '// 重新生成：node build_word_freq.js',
        ''
    ].join('\n');
    fs.writeFileSync(OUT_PATH, `${header}window.WORD_FREQ = '${words.join(' ')}'.split(' ');\n`);
    const size = fs.statSync(OUT_PATH).size;
    console.log(`已生成 ${OUT_PATH} (${words.length} 词, ${(size / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
