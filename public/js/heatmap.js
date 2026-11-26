import { addDays, escapeHtml, fmtDateCN, heatLevel, todayStr } from './utils.js';

export function heatmapRange(days = 84) {
    const end = todayStr();
    let start = addDays(end, -days + 1);
    const [y, m, d] = start.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    start = addDays(start, -dow);
    return { start, end };
}

export function fillDays(start, end, rows = []) {
    const map = new Map(rows.map((row) => [row.date, row]));
    const out = [];
    let cursor = start;
    let guard = 0;
    while (cursor <= end && guard < 800) {
        out.push(map.get(cursor) || { date: cursor, count: 0, correct: 0, wrong: 0 });
        cursor = addDays(cursor, 1);
        guard += 1;
    }
    return out;
}

function cell(day) {
    const level = day.count ? heatLevel(day.count) : 0;
    const wrong = day.count && day.wrong > day.correct ? ' level-wrong' : '';
    const today = day.date === todayStr() ? ' today' : '';
    const title = day.count
        ? `${fmtDateCN(day.date)}：复习 ${day.count} 次，对 ${day.correct}，错 ${day.wrong}`
        : `${fmtDateCN(day.date)}：没有复习`;
    return `<span class="heat-cell level-${level}${wrong}${today}" title="${escapeHtml(title)}" data-date="${day.date}"></span>`;
}

/** 用于今日页的迷你热力图，返回 7 行 × N 列的格子。 */
export function miniHeatmap(rows, days = 84) {
    const { start, end } = heatmapRange(days);
    const filled = fillDays(start, end, rows);
    return filled.map(cell).join('');
}

/** 用于统计页的大热力图。 */
export function bigHeatmap(rows, days = 365) {
    const { start, end } = heatmapRange(days);
    const filled = fillDays(start, end, rows);
    const padStart = 0;
    const padEnd = (7 - (filled.length % 7)) % 7;
    return `${Array.from({ length: padStart }, () => '<span class="heat-cell empty"></span>').join('')}${filled
        .map(cell)
        .join('')}${Array.from({ length: padEnd }, () => '<span class="heat-cell empty"></span>').join('')}`;
}

export function monthMarkers(rows, days = 365) {
    const { start, end } = heatmapRange(days);
    const filled = fillDays(start, end, rows);
    const marks = [];
    let lastMonth = '';
    filled.forEach((day, index) => {
        const month = day.date.slice(0, 7);
        if (month !== lastMonth) {
            const [, m] = month.split('-');
            marks.push({ index, label: `${Number(m)} 月` });
            lastMonth = month;
        }
    });
    return marks;
}
