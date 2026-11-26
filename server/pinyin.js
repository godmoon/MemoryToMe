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

/** 判断一个字段是否更像拼音，用于导入时的格式猜测。 */
export function looksLikePinyin(value) {
    const v = normalizeText(value);
    if (!v || /[\u4e00-\u9fff]/.test(v)) return false;
    if (!PINYIN_CHARS.test(v)) return false;
    // 至少包含一个元音，避免把英文缩写误判为拼音
    return /[aeiouāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i.test(v);
}

/** 把拼音按音节拆开，数量与汉字对齐；对不齐时返回 null。 */
export function splitPinyin(pinyinText) {
    const parts = normalizePinyin(pinyinText).split(' ').filter(Boolean);
    return parts.length ? parts : null;
}
