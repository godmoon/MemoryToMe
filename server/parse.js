import { autoPinyin, looksLikePinyin } from './pinyin.js';
import { normKey, normalizeText } from './util.js';

const ZH_RE = /[\u4e00-\u9fff]/;
const EN_RE = /^[A-Za-z][A-Za-z' -]*$/;

function stripListMarker(line) {
    return line
        .replace(/^\s*(?:[-*•·]|\d+[.、)）]|[①-⑳])\s*/, '')
        .replace(/^\s*["'“”‘’]|["'“”‘’]\s*$/g, '')
        .trim();
}

function cleanWord(text, lang) {
    let value = stripListMarker(normalizeText(text));
    if (lang === 'zh') {
        value = value.replace(/[，。；、,.;!?！？：:]+$/g, '').replace(/\s+/g, '');
    } else {
        value = value.replace(/^[,;]+|[,;]+$/g, '').trim();
    }
    return value;
}

function isValidWord(text, lang) {
    if (!text) return false;
    if (lang === 'zh') {
        return text.length <= 30 && ZH_RE.test(text) && !/[A-Za-z]/.test(text);
    }
    return text.length <= 48 && EN_RE.test(text);
}

function splitFields(line) {
    if (line.includes('\t')) return line.split('\t');
    if (line.includes('|')) return line.split('|');
    if (line.includes('｜')) return line.split('｜');
    return null;
}

/**
 * 解析一行。返回若干个词条。
 * 支持：词 / 词,拼音 / 词,拼音,释义 / 词|拼音|释义
 * 也支持：苹果,香蕉,梨（逗号分隔的多个词）
 */
function parseLine(rawLine, lang) {
    const line = stripListMarker(rawLine);
    if (!line || line.startsWith('#')) return [];

    const fields = splitFields(line);
    if (fields) {
        const [text, pinyin, meaning, ...rest] = fields.map((x) => normalizeText(x));
        const cleaned = cleanWord(text, lang);
        if (!isValidWord(cleaned, lang)) return [];
        return [
            {
                text: cleaned,
                pinyin: lang === 'zh' ? (pinyin || '') : '',
                meaning: lang === 'en' ? [pinyin, meaning, ...rest].filter(Boolean).join(' ') : (meaning || ''),
            },
        ];
    }

    if (line.includes(',') || line.includes('，')) {
        const parts = line.split(/[,，]/).map((x) => normalizeText(x)).filter(Boolean);
        if (parts.length === 2) {
            const [first, second] = parts;
            const firstWord = cleanWord(first, lang);
            const secondWord = cleanWord(second, lang);
            if (lang === 'zh' && isValidWord(firstWord, 'zh') && looksLikePinyin(second)) {
                return [{ text: firstWord, pinyin: normalizeText(second), meaning: '' }];
            }
            if (lang === 'en' && isValidWord(firstWord, 'en') && ZH_RE.test(second)) {
                return [{ text: firstWord, pinyin: '', meaning: secondWord }];
            }
            if (isValidWord(firstWord, lang) && isValidWord(secondWord, lang)) {
                return [
                    { text: firstWord, pinyin: '', meaning: '' },
                    { text: secondWord, pinyin: '', meaning: '' },
                ];
            }
            return [];
        }
        if (parts.length >= 3) {
            // 词,拼音,释义
            const text = cleanWord(parts[0], lang);
            if (isValidWord(text, lang)) {
                if (lang === 'zh' && looksLikePinyin(parts[1])) {
                    return [{ text, pinyin: normalizeText(parts[1]), meaning: parts.slice(2).join(' ') }];
                }
                if (lang === 'en' && ZH_RE.test(parts[1])) {
                    return [{ text, pinyin: '', meaning: parts.slice(1).join(' ') }];
                }
            }
            // 否则当成逗号分隔的多个词
            return parts
                .map((p) => cleanWord(p, lang))
                .filter((p) => isValidWord(p, lang))
                .map((text) => ({ text, pinyin: '', meaning: '' }));
        }
    }

    const text = cleanWord(line, lang);
    if (!isValidWord(text, lang)) return [];
    return [{ text, pinyin: '', meaning: '' }];
}

function parseJson(text, lang) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data.words || data.items || [];
    if (!Array.isArray(list)) throw new Error('JSON 需要是数组，或包含 words 数组');
    return list.map((item) => {
        if (typeof item === 'string') return { text: item, pinyin: '', meaning: '' };
        return {
            text: item.text || item.word || item.词语 || '',
            pinyin: item.pinyin || item.拼音 || '',
            meaning: item.meaning || item.translation || item.释义 || '',
            category: item.category || item.分类 || '',
            tags: item.tags || item.标签 || '',
        };
    });
}

function parseCsv(text, lang) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) return [];
    const first = lines[0].split(',').map((x) => x.trim().toLowerCase());
    const hasHeader = first.some((x) =>
        ['text', 'word', '词语', '单词', 'pinyin', '拼音', 'meaning', '释义'].includes(x),
    );
    const header = hasHeader ? first : null;
    const body = hasHeader ? lines.slice(1) : lines;
    const idx = (names, fallback) => {
        if (!header) return fallback;
        const i = header.findIndex((h) => names.includes(h));
        return i >= 0 ? i : fallback;
    };
    const textIdx = idx(['text', 'word', '词语', '单词'], 0);
    const pinyinIdx = idx(['pinyin', '拼音'], 1);
    const meaningIdx = idx(['meaning', 'translation', '释义', '中文'], 2);

    return body.map((line) => {
        const cells = line.split(',').map((x) => x.replace(/^"|"$/g, '').trim());
        return {
            text: cells[textIdx] || '',
            pinyin: lang === 'zh' ? cells[pinyinIdx] || '' : '',
            meaning: lang === 'en' ? cells[meaningIdx] || cells[pinyinIdx] || '' : cells[meaningIdx] || '',
        };
    });
}

/**
 * 解析导入文本。
 * @param {string} raw
 * @param {{lang?:string, category?:string, tags?:string}} options
 */
export function parseImport(raw, options = {}) {
    const lang = options.lang === 'en' ? 'en' : 'zh';
    const text = String(raw || '').replace(/^\ufeff/, '').replace(/\r\n/g, '\n');
    const trimmed = text.trim();
    const stats = { total: 0, valid: 0, duplicates: 0, invalid: 0, autoPinyin: 0 };
    if (!trimmed) return { items: [], stats, error: null };

    let parsed = [];
    let format = 'lines';
    try {
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
            parsed = parseJson(trimmed, lang);
            format = 'json';
        } else if (
            trimmed.includes('\n') &&
            /^\s*(text|word|词语|单词|pinyin|拼音)\s*,/i.test(trimmed.split('\n')[0])
        ) {
            parsed = parseCsv(trimmed, lang);
            format = 'csv';
        } else {
            parsed = trimmed.split('\n').flatMap((line) => parseLine(line, lang));
        }
    } catch (error) {
        return { items: [], stats, error: error.message || '无法解析导入内容' };
    }

    const seen = new Set();
    const items = [];
    for (const item of parsed) {
        const word = cleanWord(item.text, lang);
        if (!isValidWord(word, lang)) {
            stats.invalid += 1;
            continue;
        }
        const key = normKey(word, lang);
        if (seen.has(key)) {
            stats.duplicates += 1;
            continue;
        }
        seen.add(key);
        let pinyin = lang === 'zh' ? normalizeText(item.pinyin) : '';
        if (lang === 'zh' && !pinyin) {
            pinyin = autoPinyin(word, lang);
            if (pinyin) stats.autoPinyin += 1;
        }
        items.push({
            text: word,
            pinyin,
            meaning: normalizeText(item.meaning || ''),
            category: normalizeText(item.category || options.category || '自定义') || '自定义',
            tags: item.tags || options.tags || '',
            lang,
        });
    }

    stats.total = stats.valid + stats.duplicates + stats.invalid;
    stats.valid = items.length;
    return { items, stats, format, error: null };
}
