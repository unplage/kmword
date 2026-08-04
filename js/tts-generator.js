(function() {
    class TextChunker {
        constructor() {
            this.TARGET_MINUTES = 5;
            this.CHARS_PER_MINUTE = 250;
            this.TARGET_CHARS = this.TARGET_MINUTES * this.CHARS_PER_MINUTE;
        }

        splitText(content) {
            if (!content || !content.trim()) return [];
            const lines = content.split('\n');
            const chunks = [];
            let currentChunk = '';
            let currentLen = 0;

            for (const line of lines) {
                if (!line.trim()) {
                    if (currentLen > 0) {
                        currentChunk += '\n';
                        currentLen += 1;
                    }
                    continue;
                }
                const sentences = this._splitSentences(line);
                for (const sentence of sentences) {
                    if (currentLen + sentence.length > this.TARGET_CHARS && currentLen > 0) {
                        chunks.push(currentChunk.trim());
                        currentChunk = '';
                        currentLen = 0;
                    }
                    currentChunk += (currentLen > 0 ? ' ' : '') + sentence;
                    currentLen += sentence.length;
                }
                if (currentLen > 0) {
                    currentChunk += '\n';
                    currentLen += 1;
                }
            }
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
            }

            // Merge short chunks (< 2 min) into the previous chunk
            if (chunks.length > 1) {
                const merged = [chunks[0]];
                for (let i = 1; i < chunks.length; i++) {
                    const prevLen = merged[merged.length - 1].length;
                    const curLen = chunks[i].length;
                    const prevMin = prevLen / this.CHARS_PER_MINUTE;
                    const curMin = curLen / this.CHARS_PER_MINUTE;
                    if (curMin < 2 && prevMin + curMin <= this.TARGET_MINUTES * 1.2) {
                        merged[merged.length - 1] = merged[merged.length - 1] + '\n\n' + chunks[i];
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

        async streamToWav(text, apiKey, voice, onProgress) {
            this.aborter = new AbortController();
            const allPcm = [];

            const body = {
                model: this.model,
                messages: [{ role: 'assistant', content: text }],
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
                            if (onProgress) onProgress(allPcm);
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
    }

    window.TextChunker = TextChunker;
    window.TTSGenerator = TTSGenerator;
})();
