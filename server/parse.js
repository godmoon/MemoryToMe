import { autoPinyin, isPinyinPhrase } from './pinyin.js';
import { normKey, normalizeText } from './util.js';

const ZH_RE = /[\u4e00-\u9fff]/;
const EN_RE = /^[A-Za-z][A-Za-z' -]*$/;
const FIELD_SEP = /[\t|｜,，]/;

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
 * 猜一行是什么语言：看第一个字段。
 * 含汉字就是中文，纯英文单词就是英文，其余按中文处理。
 * 粘贴导入选“自动”时逐行调用，中英文可以混在一起。
 */
function detectLang(line) {
    const head = String(line || '').split(FIELD_SEP)[0].trim();
    if (ZH_RE.test(head)) return 'zh';
    if (EN_RE.test(cleanWord(head, 'en'))) return 'en';
    return 'zh';
}

/**
 * 解析一行。返回若干个词条。
 * 支持：词 / 词,拼音 / 词,拼音,释义 / 词|拼音|释义
 * 也支持：苹果,香蕉,梨（逗号分隔的多个词）
 * @param {string} rawLine
 * @param {'zh'|'en'|'auto'} mode
 */
function parseLine(rawLine, mode) {
    const line = stripListMarker(rawLine);
    if (!line || line.startsWith('#')) return [];
    const lang = mode === 'auto' ? detectLang(line) : mode;

    const fields = splitFields(line);
    if (fields) {
        const [text, pinyin, meaning, ...rest] = fields.map((x) => normalizeText(x));
        const cleaned = cleanWord(text, lang);
        if (!isValidWord(cleaned, lang)) return [];
        if (lang === 'en') {
            return [
                {
                    text: cleaned,
                    pinyin: '',
                    meaning: [pinyin, meaning, ...rest].filter(Boolean).join(' '),
                    lang,
                },
            ];
        }
        return [
            {
                text: cleaned,
                pinyin: isPinyinPhrase(pinyin) ? pinyin : '',
                meaning: meaning || '',
                lang,
            },
        ];
    }

    if (line.includes(',') || line.includes('，')) {
        const parts = line.split(/[,，]/).map((x) => normalizeText(x)).filter(Boolean);
        if (parts.length === 2) {
            const [first, second] = parts;
            const firstWord = cleanWord(first, lang);
            const secondWord = cleanWord(second, lang);

            if (lang === 'zh' && isValidWord(firstWord, 'zh')) {
                if (isPinyinPhrase(second)) {
                    return [{ text: firstWord, pinyin: normalizeText(second), meaning: '', lang }];
                }
                if (isValidWord(secondWord, 'zh')) {
                    return [
                        { text: firstWord, pinyin: '', meaning: '', lang },
                        { text: secondWord, pinyin: '', meaning: '', lang },
                    ];
                }
                // 第二列既不是拼音也不是中文（多半是英文），只导入中文这个词
                return [{ text: firstWord, pinyin: '', meaning: '', lang }];
            }

            if (lang === 'en' && isValidWord(firstWord, 'en') && ZH_RE.test(second)) {
                return [{ text: firstWord, pinyin: '', meaning: secondWord, lang }];
            }

            if (isValidWord(firstWord, lang) && isValidWord(secondWord, lang)) {
                return [
                    { text: firstWord, pinyin: '', meaning: '', lang },
                    { text: secondWord, pinyin: '', meaning: '', lang },
                ];
            }
            return [];
        }
        if (parts.length >= 3) {
            // 词,拼音,释义
            const text = cleanWord(parts[0], lang);
            if (isValidWord(text, lang)) {
                if (lang === 'zh' && isPinyinPhrase(parts[1])) {
                    return [{ text, pinyin: normalizeText(parts[1]), meaning: parts.slice(2).join(' '), lang }];
                }
                if (lang === 'en') {
                    // 音标可能带符号，取后面所有含汉字的字段当释义
                    const zhParts = parts.slice(1).filter((p) => ZH_RE.test(p));
                    if (zhParts.length) {
                        return [{ text, pinyin: '', meaning: zhParts.join(' '), lang }];
                    }
                }
            }
            // 否则当成逗号分隔的多个词
            return parts
                .map((p) => cleanWord(p, lang))
                .filter((p) => isValidWord(p, lang))
                .map((text) => ({ text, pinyin: '', meaning: '', lang }));
        }
    }

    const text = cleanWord(line, lang);
    if (!isValidWord(text, lang)) return [];
    return [{ text, pinyin: '', meaning: '', lang }];
}

function parseJson(text, lang) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data.words || data.items || [];
    if (!Array.isArray(list)) throw new Error('JSON 需要是数组，或包含 words 数组');
    return list.map((item) => {
        if (typeof item === 'string') {
            return { text: item, pinyin: '', meaning: '', lang: lang === 'auto' ? detectLang(item) : '' };
        }
        const text = item.text || item.word || item.词语 || '';
        const explicit = item.lang === 'en' || item.lang === 'zh' ? item.lang : '';
        return {
            text,
            pinyin: item.pinyin || item.拼音 || '',
            meaning: item.meaning || item.translation || item.释义 || '',
            category: item.category || item.分类 || '',
            tags: item.tags || item.标签 || '',
            lang: explicit || (lang === 'auto' ? detectLang(text) : ''),
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
        const text = cells[textIdx] || '';
        const rowLang = lang === 'auto' ? detectLang(text) : lang;
        return {
            text,
            pinyin: rowLang === 'zh' ? cells[pinyinIdx] || '' : '',
            meaning: rowLang === 'en' ? cells[meaningIdx] || cells[pinyinIdx] || '' : cells[meaningIdx] || '',
            lang: rowLang,
        };
    });
}

/**
 * 解析导入文本。
 * @param {string} raw
 * @param {{lang?:'zh'|'en'|'auto', category?:string, tags?:string}} options
 */
export function parseImport(raw, options = {}) {
    const mode = options.lang === 'en' || options.lang === 'auto' ? options.lang : 'zh';
    const text = String(raw || '').replace(/^\ufeff/, '').replace(/\r\n/g, '\n');
    const trimmed = text.trim();
    const stats = { total: 0, valid: 0, duplicates: 0, invalid: 0, autoPinyin: 0 };
    if (!trimmed) return { items: [], stats, error: null };

    let parsed = [];
    let format = 'lines';
    let dropped = 0;
    try {
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
            parsed = parseJson(trimmed, mode);
            format = 'json';
        } else if (
            trimmed.includes('\n') &&
            /^\s*(text|word|词语|单词|pinyin|拼音)\s*,/i.test(trimmed.split('\n')[0])
        ) {
            parsed = parseCsv(trimmed, mode);
            format = 'csv';
        } else {
            for (const rawLine of trimmed.split('\n')) {
                const line = stripListMarker(rawLine);
                if (!line || line.startsWith('#')) continue;
                const lineItems = parseLine(line, mode);
                if (!lineItems.length) dropped += 1;
                parsed.push(...lineItems);
            }
        }
    } catch (error) {
        return { items: [], stats, error: error.message || '无法解析导入内容' };
    }

    const seen = new Set();
    const items = [];
    for (const item of parsed) {
        const lang =
            item.lang === 'en' || item.lang === 'zh' ? item.lang : mode === 'auto' ? detectLang(item.text || '') : mode;
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

    // 整行都没解析出来的也算无效，避免“看起来全都导入了”
    stats.invalid += dropped;
    stats.valid = items.length;
    stats.total = stats.valid + stats.duplicates + stats.invalid;
    return { items, stats, format, error: null };
}
