// ECDICT CSV 流式导入 Worker
// 主线程每写完一批回传 ack，Worker 才继续解析，避免把 77 万条记录全部堆在内存里。
(function () {
    'use strict';

    let ackResolver = null;
    let cancelled = false;

    function parseCsvLine(line) {
        const out = [];
        let cur = '';
        let quoted = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (quoted) {
                if (c === '"') {
                    if (line[i + 1] === '"') {
                        cur += '"';
                        i++;
                    } else {
                        quoted = false;
                    }
                } else {
                    cur += c;
                }
            } else if (c === '"') {
                quoted = true;
            } else if (c === ',') {
                out.push(cur);
                cur = '';
            } else {
                cur += c;
            }
        }
        out.push(cur);
        return out;
    }

    function makeRecord(fields) {
        const word = (fields[0] || '').trim();
        if (!word) return null;
        const key = word.toLowerCase();
        const record = { w: key };
        const head = word;
        if (head !== key) record.h = head;

        const phonetic = (fields[1] || '').trim();
        const definition = (fields[2] || '').trim();
        const translation = (fields[3] || '').trim();
        const pos = (fields[4] || '').trim();
        const collins = (fields[5] || '').trim();
        const oxford = (fields[6] || '').trim();
        const tag = (fields[7] || '').trim();
        const bnc = (fields[8] || '').trim();
        const frq = (fields[9] || '').trim();
        const exchange = (fields[10] || '').trim();

        if (phonetic) record.p = phonetic;
        if (definition) record.d = definition;
        if (translation) record.t = translation;
        if (pos) record.pos = pos;
        if (collins) record.c = collins;
        if (oxford) record.o = oxford;
        if (tag) record.g = tag;
        if (bnc && bnc !== '0') record.b = bnc;
        if (frq && frq !== '0') record.f = frq;
        if (exchange) record.e = exchange;
        return record;
    }

    function waitForAck() {
        return new Promise((resolve) => {
            ackResolver = resolve;
        });
    }

    async function flushBatch(batch, count, loaded, total) {
        if (batch.length === 0) return;
        self.postMessage({
            type: 'batch',
            records: batch,
            count,
            loaded,
            total
        });
        batch.length = 0;
        await waitForAck();
    }

    async function importFile(file, batchSize) {
        const total = file.size || 0;
        const decoder = new TextDecoder('utf-8');
        let header = null;
        let count = 0;
        let skipped = 0;
        let loaded = 0;
        const batch = [];
        const lines = [];
        let lineIdx = 0;
        let buffer = '';
        let scanPos = 0;
        let inQuotes = false;

        // 只在引号外按换行切出完整记录；跨 chunk 的引号字段留在 buffer 里拼接。
        const scan = (text, final) => {
            buffer += text;
            let start = 0;
            let i = scanPos;
            for (; i < buffer.length; i++) {
                const c = buffer[i];
                if (c === '"') {
                    // 末尾的引号可能是跨 chunk 的 ""，等下一个字符到了再判断
                    if (i + 1 >= buffer.length && !final) break;
                    if (inQuotes && buffer[i + 1] === '"') {
                        i++;
                    } else {
                        inQuotes = !inQuotes;
                    }
                } else if (c === '\n' && !inQuotes) {
                    let line = buffer.slice(start, i);
                    if (line.endsWith('\r')) line = line.slice(0, -1);
                    lines.push(line);
                    start = i + 1;
                }
            }
            buffer = buffer.slice(start);
            scanPos = i - start;
            if (final && buffer) {
                let line = buffer;
                if (line.endsWith('\r')) line = line.slice(0, -1);
                lines.push(line);
                buffer = '';
                scanPos = 0;
            }
        };

        const processLine = (rawLine) => {
            const line = rawLine;
            if (!header) {
                if (!line) return;
                let firstLine = line;
                if (firstLine.charCodeAt(0) === 0xFEFF) firstLine = firstLine.slice(1);
                header = parseCsvLine(firstLine);
                const first = (header[0] || '').replace(/^\uFEFF/, '').trim().toLowerCase();
                if (first !== 'word') {
                    throw new Error('不是有效的 ECDICT CSV：缺少 word 列');
                }
                if (header.length < 13) {
                    throw new Error('ECDICT CSV 列数不足（应为 13 列）');
                }
                return;
            }
            if (!line) return;
            const fields = parseCsvLine(line);
            if (fields.length !== 13) {
                skipped++;
                return;
            }
            const record = makeRecord(fields);
            if (!record) {
                skipped++;
                return;
            }
            batch.push(record);
            count++;
        };

        async function drainLines() {
            while (lineIdx < lines.length) {
                processLine(lines[lineIdx++]);
                if (batch.length >= batchSize) {
                    await flushBatch(batch, count, loaded, total);
                    if (cancelled) return false;
                }
            }
            lines.length = 0;
            lineIdx = 0;
            return !cancelled;
        }

        if (typeof file.stream === 'function') {
            const reader = file.stream().getReader();
            while (!cancelled) {
                const { done, value } = await reader.read();
                if (done) break;
                loaded += value.byteLength || value.length || 0;
                scan(decoder.decode(value, { stream: true }), false);
                if (!(await drainLines())) return;
            }
            scan(decoder.decode(), true);
        } else {
            const CHUNK_SIZE = 1024 * 1024;
            for (let pos = 0; pos < total; pos += CHUNK_SIZE) {
                if (cancelled) return;
                const end = Math.min(pos + CHUNK_SIZE, total);
                const text = await file.slice(pos, end).text();
                loaded = end;
                scan(text, end >= total);
                if (!(await drainLines())) return;
            }
            if (total === 0) scan('', true);
        }

        if (cancelled) return;
        if (!(await drainLines())) return;
        await flushBatch(batch, count, loaded, total);
        self.postMessage({ type: 'done', count, skipped, loaded, total });
    }

    self.onmessage = async (event) => {
        const message = event.data || {};
        if (message.type === 'start') {
            cancelled = false;
            try {
                await importFile(message.file, Math.max(100, parseInt(message.batchSize, 10) || 1000));
            } catch (error) {
                self.postMessage({
                    type: 'error',
                    message: (error && error.message) || String(error),
                    stack: (error && error.stack) || ''
                });
            }
        } else if (message.type === 'ack') {
            if (ackResolver) {
                const resolve = ackResolver;
                ackResolver = null;
                resolve();
            }
        } else if (message.type === 'cancel') {
            cancelled = true;
            if (ackResolver) {
                const resolve = ackResolver;
                ackResolver = null;
                resolve();
            }
        }
    };
})();
