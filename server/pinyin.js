import { pinyin } from 'pinyin-pro';
import { normalizeText } from './util.js';

const PINYIN_CHARS = /^[a-zA-Z0-9üÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜêńňǹḿɡ\s]+$/;

export function normalizePinyin(value) {
    return String(value || '')
        .replace(/ɡ/g, 'g')
        .replace(/[·・]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** 给中文词语自动注音，返回以空格分隔的音节。 */
export function autoPinyin(text, lang = 'zh') {
    if (lang !== 'zh') return '';
    const value = normalizeText(text);
    if (!value) return '';
    try {
        const arr = pinyin(value, {
            toneType: 'symbol',
            type: 'array',
            nonZh: 'consecutive',
            v: true,
        });
        return normalizePinyin(arr.join(' '));
    } catch {
        return '';
    }
}

/**
 * 判断一个字段是不是拼音。
 * 只看“像不像拼音字母”不够，school、apple 也全是字母，
 * 所以这里把声调去掉后按音节校验，避免把英文单词当成拼音。
 */
const PINYIN_SYLLABLE =
    /^(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(?:a|o|e|ai|ei|ao|ou|an|en|ang|eng|er|i|ia|ie|iao|iu|ian|in|iang|ing|iong|u|ua|uo|uai|ui|uan|un|uang|ong|v|ve|van|vn|ue)$/;

// 少数不按常规声韵母组合的音节
const PINYIN_SPECIAL = new Set(['n', 'ng', 'm', 'hm', 'hng', 'lo', 'yo', 'ei', 'ê']);

const TONE_TO_BASE = {
    ā: 'a', á: 'a', ǎ: 'a', à: 'a',
    ē: 'e', é: 'e', ě: 'e', è: 'e',
    ī: 'i', í: 'i', ǐ: 'i', ì: 'i',
    ō: 'o', ó: 'o', ǒ: 'o', ò: 'o',
    ū: 'u', ú: 'u', ǔ: 'u', ù: 'u',
    ǖ: 'v', ǘ: 'v', ǚ: 'v', ǜ: 'v',
    ü: 'v',
    ń: 'n', ň: 'n', ǹ: 'n', ḿ: 'm',
    ɡ: 'g',
};

export function isPinyinPhrase(value) {
    const v = normalizeText(value).toLowerCase();
    if (!v || /[\u4e00-\u9fff]/.test(v)) return false;
    if (!PINYIN_CHARS.test(v)) return false;
    const plain = v.replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹḿɡ]/g, (ch) => TONE_TO_BASE[ch] || ch);
    const parts = plain.split(/\s+/).filter(Boolean);
    if (!parts.length || parts.length > 8) return false;
    return parts.every((part) => {
        // 兼容数字声调：ce4、shi4、yi3
        const bare = part.replace(/\d+$/, '');
        return PINYIN_SPECIAL.has(bare) || PINYIN_SYLLABLE.test(bare);
    });
}

/** 把拼音按音节拆开，数量与汉字对齐；对不齐时返回 null。 */
export function splitPinyin(pinyinText) {
    const parts = normalizePinyin(pinyinText).split(' ').filter(Boolean);
    return parts.length ? parts : null;
}
