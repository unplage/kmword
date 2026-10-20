// ECDICT 词条解析与渲染辅助
// 只负责把 CSV 字段转成结构化 HTML；数据查询仍由 db.js 负责。
(function () {
    'use strict';

    const TAG_LABELS = {
        zk: '中考',
        gk: '高考',
        cet4: '四级',
        cet6: '六级',
        ky: '考研',
        toefl: '托福',
        ielts: '雅思',
        gre: 'GRE'
    };

    const EXCHANGE_LABELS = {
        p: '过去式',
        d: '过去分词',
        i: '现在分词',
        '3': '第三人称单数',
        r: '比较级',
        t: '最高级',
        s: '复数',
        '0': '原形',
        '1': '变形类型'
    };

    const POS_PATTERN = /^(interj|adj|adv|prep|conj|pron|abbr|modal|vt|vi|aux|num|art|int|det|pl|suf|pref|phr|ad|a|n|v)\.\s*/i;
    // ECDICT 的英文释义里有一部分词性不带点号（如 gave 的 "v cause ..."）
    const BARE_POS_PATTERN = /^(interj|adj|adv|prep|conj|pron|abbr|modal|vt|vi|aux|num|art|int|det|pl|suf|pref|phr|ad|a|n|v)\s+/i;
    const DOMAIN_PATTERN = /^\[([^\]]{1,24})\]\s*/;

    function escapeText(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function escapeAttr(value) {
        return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function splitLines(text) {
        return String(text || '')
            .replace(/\r\n?/g, '\n')
            .replace(/\\n/g, '\n')
            .split('\n');
    }

    function parseSenseLine(line, allowBarePos) {
        let rest = String(line || '').trim();
        const domains = [];
        let pos = '';
        let match;

        while ((match = rest.match(DOMAIN_PATTERN))) {
            domains.push(match[1].trim());
            rest = rest.slice(match[0].length);
        }

        match = rest.match(POS_PATTERN);
        if (!match && allowBarePos) {
            match = rest.match(BARE_POS_PATTERN);
        }
        if (match) {
            pos = match[1].toLowerCase();
            rest = rest.slice(match[0].length).trim();
        }

        while ((match = rest.match(DOMAIN_PATTERN))) {
            domains.push(match[1].trim());
            rest = rest.slice(match[0].length);
        }

        return { pos, domains, text: rest.trim() };
    }

    function parseChinese(text) {
        return splitLines(text)
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => parseSenseLine(line, false))
            .filter(sense => sense.text || sense.pos || sense.domains.length > 0);
    }

    function parseEnglish(text) {
        const senses = [];
        let current = null;

        for (const rawLine of splitLines(text)) {
            if (!rawLine.trim()) continue;
            const indented = /^\s{2,}/.test(rawLine);
            const sense = parseSenseLine(rawLine, true);

            if (indented && current) {
                current.text = (current.text + ' ' + sense.text).trim();
                current.domains.push(...sense.domains);
                continue;
            }

            if (sense.pos) {
                if (current) senses.push(current);
                current = sense;
            } else if (current) {
                current.text = (current.text + ' ' + sense.text).trim();
                current.domains.push(...sense.domains);
            } else {
                current = sense;
            }
        }

        if (current) senses.push(current);
        return senses.filter(sense => sense.text);
    }

    function parseExchange(text) {
        const out = [];
        const seen = new Set();
        for (const part of String(text || '').split('/')) {
            const index = part.indexOf(':');
            if (index < 0) continue;
            const type = part.slice(0, index).trim();
            const value = part.slice(index + 1).trim();
            if (!type || !value) continue;
            const key = type + ':' + value;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                type,
                value,
                label: type === '1'
                    ? (EXCHANGE_LABELS[value] || value)
                    : (EXCHANGE_LABELS[type] || type)
            });
        }
        return out;
    }

    function renderBadges(entry, esc) {
        const badges = [];
        const tags = String(entry.g || '').split(/\s+/).filter(Boolean);
        for (const tag of tags) {
            badges.push(`<span class="ecdict-tag">${esc(TAG_LABELS[tag] || tag)}</span>`);
        }

        const collins = parseInt(entry.c, 10);
        if (collins > 0) {
            badges.push(`<span class="ecdict-badge ecdict-stars" title="柯林斯 ${collins} 星">${'★'.repeat(Math.min(collins, 5))}</span>`);
        }
        if (entry.o === '1') {
            badges.push('<span class="ecdict-badge ecdict-oxford">牛津3000</span>');
        }
        if (entry.pos) {
            badges.push(`<span class="ecdict-badge">${esc(entry.pos)}</span>`);
        }
        if (entry.b && Number(entry.b) > 0) {
            badges.push(`<span class="ecdict-rank">BNC #${esc(entry.b)}</span>`);
        }
        if (entry.f && Number(entry.f) > 0) {
            badges.push(`<span class="ecdict-rank">COCA #${esc(entry.f)}</span>`);
        }
        return badges.join('');
    }

    function renderSense(sense, esc, textClass, number) {
        const parts = [];
        parts.push('<div class="ecdict-sense">');
        if (number != null) {
            parts.push(`<span class="ecdict-sense-num">${number}.</span>`);
        }
        if (sense.pos) {
            parts.push(`<span class="ecdict-pos">${esc(sense.pos)}.</span>`);
        }
        for (const domain of sense.domains || []) {
            parts.push(`<span class="ecdict-domain">[${esc(domain)}]</span>`);
        }
        if (sense.text) {
            parts.push(`<span class="${textClass}">${esc(sense.text)}</span>`);
        }
        parts.push('</div>');
        return parts.join('');
    }

    function renderEnglishSenses(senses, esc, startIndex) {
        let offset = startIndex || 0;
        return senses.map(sense => {
            offset++;
            return renderSense(sense, esc, 'ecdict-en-text', offset);
        }).join('');
    }

    function renderForms(forms, esc, escAttrFn) {
        if (forms.length === 0) return '';
        const items = forms.map(form => {
            if (form.type === '1') {
                return `<span class="ecdict-form ecdict-form-note">该词为${esc(form.label)}</span>`;
            }
            const label = form.label === '原形' ? '原形' : form.label;
            return `<span class="ecdict-form"><span class="ecdict-form-label">${esc(label)}</span>` +
                `<span class="clickable-word ecdict-form-value" data-word="${escAttrFn(form.value)}">${esc(form.value)}</span></span>`;
        });
        return `
            <div class="ecdict-section">
                <h5><i class="fas fa-code-branch"></i> 词形变化</h5>
                <div class="ecdict-forms">${items.join('')}</div>
            </div>`;
    }

    function renderEntry(entry, options) {
        if (!entry) return '';
        const opts = options || {};
        const esc = opts.esc || escapeText;
        const escAttrFn = opts.escAttr || escapeAttr;
        const displayWord = entry.h || entry.w || '';
        const phonetic = entry.p
            ? (/^[\/\[]/.test(entry.p) ? esc(entry.p) : `/${esc(entry.p)}/`)
            : '';
        const badges = renderBadges(entry, esc);

        let html = '<div class="ecdict-result">';
        html += '<div class="ecdict-head">';
        html += `<span class="ecdict-word">${esc(displayWord)}</span>`;
        if (phonetic) html += `<span class="ecdict-phonetic">${phonetic}</span>`;
        html += '</div>';
        if (badges) html += `<div class="ecdict-meta">${badges}</div>`;

        const chineseSenses = parseChinese(entry.t);
        if (chineseSenses.length > 0) {
            html += `
                <div class="ecdict-section">
                    <h5><i class="fas fa-language"></i> 中文释义</h5>
                    <div class="ecdict-senses">${chineseSenses.map(sense => renderSense(sense, esc, 'ecdict-cn-text')).join('')}</div>
                </div>`;
        }

        const englishSenses = parseEnglish(entry.d);
        if (englishSenses.length > 0) {
            const totalChars = englishSenses.reduce((sum, sense) => sum + (sense.text || '').length, 0);
            const needsCollapse = englishSenses.length > 6 || totalChars > 1800;
            html += `
                <div class="ecdict-section">
                    <h5><i class="fas fa-book-open"></i> 英文释义</h5>`;
            if (needsCollapse) {
                const rest = englishSenses.slice(6);
                if (rest.length > 0) {
                    const visible = englishSenses.slice(0, 6);
                    html += `<div class="ecdict-senses">${renderEnglishSenses(visible, esc, 0)}</div>`;
                    html += `<details class="ecdict-more">
                        <summary>展开全部 ${englishSenses.length} 条英文释义</summary>
                        <div class="ecdict-senses">${renderEnglishSenses(rest, esc, 6)}</div>
                    </details>`;
                } else {
                    html += `<details class="ecdict-more">
                        <summary>展开英文释义（${englishSenses.length} 条，约 ${totalChars} 字）</summary>
                        <div class="ecdict-senses">${renderEnglishSenses(englishSenses, esc, 0)}</div>
                    </details>`;
                }
            } else {
                html += `<div class="ecdict-senses">${renderEnglishSenses(englishSenses, esc, 0)}</div>`;
            }
            html += '</div>';
        }

        const forms = parseExchange(entry.e);
        html += renderForms(forms, esc, escAttrFn);

        html += `<div class="ecdict-source">来源：<a href="https://github.com/skywind3000/ECDICT" target="_blank" rel="noopener">ECDICT</a> · MIT License</div>`;
        html += '</div>';
        return html;
    }

    window.ecdict = {
        TAG_LABELS,
        EXCHANGE_LABELS,
        parseChinese,
        parseEnglish,
        parseExchange,
        renderEntry,
        escapeText,
        escapeAttr
    };
})();
