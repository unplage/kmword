(function() {
    class TextChunker {
        constructor() {
            this.TARGET_MINUTES = 5;
            this.CHARS_PER_MINUTE = 250;
            this.TARGET_CHARS = this.TARGET_MINUTES * this.CHARS_PER_MINUTE; // ~5 min
            this.MAX_CHARS = Math.round(this.TARGET_CHARS * 1.2);             // ~6 min hard cap
            this.MIN_CHARS = Math.round(3 * this.CHARS_PER_MINUTE);           // ~3 min floor
        }

        splitText(content) {
            if (!content || !content.trim()) return [];

            const paragraphs = this._splitParagraphs(content);
            const chunks = [];
            let current = '';

            const flush = () => {
                if (current.trim()) {
                    chunks.push(current.trim());
                    current = '';
                }
            };

            for (const paragraph of paragraphs) {
                // 单段过长：不得不按句子硬切
                if (paragraph.length > this.MAX_CHARS) {
                    flush();
                    const pieces = this._splitLongParagraph(paragraph);
                    for (const piece of pieces) chunks.push(piece);
                    continue;
                }
                if (current && current.length + paragraph.length > this.MAX_CHARS) {
                    flush();
                }
                current += (current ? '\n\n' : '') + paragraph;
            }
            flush();

            // 末尾短段（< 3 min）并入上一段（受 MAX 上限约束）
            if (chunks.length > 1) {
                const merged = [chunks[0]];
                for (let i = 1; i < chunks.length; i++) {
                    const prev = merged[merged.length - 1];
                    if (chunks[i].length < this.MIN_CHARS && prev.length + chunks[i].length <= this.MAX_CHARS) {
                        merged[merged.length - 1] = prev + '\n\n' + chunks[i];
                    } else {
                        merged.push(chunks[i]);
                    }
                }
                chunks.length = 0;
                chunks.push(...merged);
            }

            return chunks.map((text, i) => ({
                index: i,
                text,
                estimatedMinutes: Math.round(text.length / this.CHARS_PER_MINUTE * 10) / 10
            }));
        }

        _splitParagraphs(content) {
            const lines = content.split('\n');
            const paragraphs = [];
            let buf = [];
            for (const line of lines) {
                if (!line.trim()) {
                    if (buf.length) {
                        paragraphs.push(buf.join('\n').trim());
                        buf = [];
                    }
                    continue;
                }
                buf.push(line.trim());
            }
            if (buf.length) paragraphs.push(buf.join('\n').trim());
            return paragraphs;
        }

        _splitLongParagraph(paragraph) {
            const pieces = [];
            let piece = '';
            for (const sentence of this._splitSentences(paragraph)) {
                if (piece && piece.length + sentence.length > this.MAX_CHARS) {
                    pieces.push(piece.trim());
                    piece = '';
                }
                piece += (piece ? ' ' : '') + sentence;
            }
            if (piece.trim()) pieces.push(piece.trim());
            return pieces;
        }

        _splitSentences(text) {
            const result = [];
            let current = '';
            for (let i = 0; i < text.length; i++) {
                current += text[i];
                if ((text[i] === '.' || text[i] === '!' || text[i] === '?' ||
                     text[i] === '。' || text[i] === '！' || text[i] === '？') &&
                    (i + 1 >= text.length || text[i + 1] === ' ' || text[i + 1] === '\n')) {
                    result.push(current.trim());
                    current = '';
                }
            }
            if (current.trim()) {
                result.push(current.trim());
            }
            return result;
        }
    }

    class TTSGenerator {
        constructor() {
            this.apiEndpoint = 'https://api.xiaomimimo.com/v1/chat/completions';
            this.model = 'mimo-v2.5-tts';
            this.SAMPLE_RATE = 24000;
            this.aborter = null;
        }

        generateWavBlob(pcm16Data) {
            const numChannels = 1;
            const bitsPerSample = 16;
            const byteRate = this.SAMPLE_RATE * numChannels * (bitsPerSample / 8);
            const blockAlign = numChannels * (bitsPerSample / 8);
            const dataSize = pcm16Data.length * 2;
            const fileSize = 44 + dataSize;

            const buffer = new ArrayBuffer(fileSize);
            const view = new DataView(buffer);

            this._writeString(view, 0, 'RIFF');
            view.setUint32(4, fileSize - 8, true);
            this._writeString(view, 8, 'WAVE');
            this._writeString(view, 12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, numChannels, true);
            view.setUint32(24, this.SAMPLE_RATE, true);
            view.setUint32(28, byteRate, true);
            view.setUint16(32, blockAlign, true);
            view.setUint16(34, bitsPerSample, true);
            this._writeString(view, 36, 'data');
            view.setUint32(40, dataSize, true);

            const pcm16View = new Int16Array(buffer, 44);
            for (let i = 0; i < pcm16Data.length; i++) {
                pcm16View[i] = Math.max(-32768, Math.min(32767, Math.round(pcm16Data[i] * 32768)));
            }

            return new Blob([buffer], { type: 'audio/wav' });
        }

        _writeString(view, offset, str) {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        }

        async streamToWav(text, apiKey, voice, style, styleCustom) {
            this.aborter = new AbortController();
            const allPcm = [];

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
                model: this.model,
                messages,
                audio: { format: 'pcm16', voice: voice || 'mimo_default' },
                stream: true
            };

            const res = await fetch(this.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': apiKey,
                    'Authorization': 'Bearer ' + apiKey
                },
                body: JSON.stringify(body),
                signal: this.aborter.signal
            });

            if (!res.ok) {
                let msg = 'HTTP ' + res.status;
                try {
                    const j = await res.json();
                    msg = (j && j.error && j.error.message) || msg;
                } catch (e) {}
                throw new Error(msg);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buf = '';

            const processLine = (line) => {
                const t = line.trim();
                if (!t || !t.startsWith('data:')) return;
                const data = t.slice(5).trim();
                if (!data || data === '[DONE]') return;
                try {
                    const json = JSON.parse(data);
                    const delta = json && json.choices && json.choices[0] && json.choices[0].delta;
                    const audio = delta && delta.audio;
                    if (audio && typeof audio === 'object' && audio.data) {
                        const pcm = this._decodeBase64PCM16(audio.data);
                        if (pcm) {
                            allPcm.push(pcm);
                        }
                    }
                } catch (e) {}
            };

            const pump = () => {
                return reader.read().then(({ done, value }) => {
                    if (done) {
                        if (buf.trim()) processLine(buf);
                        return;
                    }
                    buf += decoder.decode(value, { stream: true });
                    const lines = buf.split('\n');
                    buf = lines.pop();
                    lines.forEach(processLine);
                    return pump();
                });
            };

            await pump();

            if (allPcm.length === 0) {
                throw new Error('未收到音频数据');
            }

            const totalLen = allPcm.reduce((sum, arr) => sum + arr.length, 0);
            const merged = new Float32Array(totalLen);
            let offset = 0;
            for (const chunk of allPcm) {
                merged.set(chunk, offset);
                offset += chunk.length;
            }

            const duration = merged.length / this.SAMPLE_RATE;
            const wavBlob = this.generateWavBlob(merged);

            return { wavBlob, duration };
        }

        _decodeBase64PCM16(base64) {
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

        abort() {
            if (this.aborter) {
                try { this.aborter.abort(); } catch (e) {}
                this.aborter = null;
            }
        }

        static async mergeWavBlobs(blobs) {
            if (!blobs || blobs.length === 0) return null;
            if (blobs.length === 1) return blobs[0];

            const parseWav = (buf) => {
                const view = new DataView(buf);
                const readStr = (off, len) => {
                    let s = '';
                    for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(off + i));
                    return s;
                };
                if (readStr(0, 4) !== 'RIFF' || readStr(8, 4) !== 'WAVE') return null;
                let fmt = null;
                let dataStart = -1;
                let dataSize = 0;
                let off = 12;
                while (off + 8 <= buf.byteLength) {
                    const id = readStr(off, 4);
                    const size = view.getUint32(off + 4, true);
                    if (id === 'fmt ') {
                        fmt = {
                            audioFormat: view.getUint16(off + 8, true),
                            channels: view.getUint16(off + 10, true),
                            sampleRate: view.getUint32(off + 12, true),
                            byteRate: view.getUint32(off + 16, true),
                            blockAlign: view.getUint16(off + 20, true),
                            bitsPerSample: view.getUint16(off + 22, true)
                        };
                    } else if (id === 'data') {
                        dataStart = off + 8;
                        dataSize = size;
                        break;
                    }
                    off += 8 + size + (size % 2);
                }
                if (!fmt || dataStart < 0) return null;
                return { fmt, dataStart, dataSize };
            };

            const parsed = [];
            let firstFmt = null;
            let totalData = 0;
            for (const blob of blobs) {
                const buf = await blob.arrayBuffer();
                const info = parseWav(buf);
                if (!info) {
                    console.warn('跳过非 WAV 分段');
                    continue;
                }
                if (!firstFmt) firstFmt = info.fmt;
                parsed.push({ buf, info });
                totalData += info.dataSize;
            }
            if (parsed.length === 0) return null;

            const { audioFormat, channels, sampleRate, byteRate, blockAlign, bitsPerSample } = firstFmt;
            const dataSize = totalData;
            const fileSize = 44 + dataSize;
            const out = new ArrayBuffer(fileSize);
            const view = new DataView(out);
            const writeStr = (off, str) => {
                for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
            };
            writeStr(0, 'RIFF');
            view.setUint32(4, fileSize - 8, true);
            writeStr(8, 'WAVE');
            writeStr(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, audioFormat, true);
            view.setUint16(22, channels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, byteRate, true);
            view.setUint16(32, blockAlign, true);
            view.setUint16(34, bitsPerSample, true);
            writeStr(36, 'data');
            view.setUint32(40, dataSize, true);

            const outU8 = new Uint8Array(out);
            let writePos = 44;
            for (const { buf, info } of parsed) {
                const src = new Uint8Array(buf, info.dataStart, info.dataSize);
                outU8.set(src, writePos);
                writePos += info.dataSize;
            }

            return new Blob([out], { type: 'audio/wav' });
        }
    }

    window.TextChunker = TextChunker;
    window.TTSGenerator = TTSGenerator;
})();
