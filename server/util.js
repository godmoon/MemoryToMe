/** 日期与小工具。所有“今天”都按服务器本地时区计算。 */

export function pad2(n) {
    return String(n).padStart(2, '0');
}

export function dateStr(d = new Date()) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayStr() {
    return dateStr(new Date());
}

export function parseDate(value) {
    const [y, m, d] = String(value).split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function addDays(value, days) {
    const d = parseDate(value);
    d.setDate(d.getDate() + days);
    return dateStr(d);
}

export function diffDays(a, b) {
    const [ay, am, ad] = String(a).split('-').map(Number);
    const [by, bm, bd] = String(b).split('-').map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function weekdayCN(value) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parseDate(value).getDay()];
}

export function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, Math.round(n)));
}

export function safeJson(value, fallback) {
    if (value == null || value === '') return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

export function normalizeText(text) {
    return String(text || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[\u200b-\u200d\ufeff]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normKey(text, lang) {
    const value = normalizeText(text);
    return lang === 'en' ? value.toLowerCase() : value;
}

export function humanInterval(days) {
    if (days <= 0) return '今天';
    if (days === 1) return '明天';
    if (days < 7) return `${days} 天后`;
    if (days < 30) return `${Math.round(days / 7)} 周后`;
    if (days < 365) return `${Math.round(days / 30)} 个月后`;
    return `${(days / 365).toFixed(1)} 年后`;
}
