import { saveSettings, store } from './store.js';
import { toast } from './utils.js';

const THEME_COLORS = { paper: '#f6f1e6', night: '#131a1c', mint: '#eef5ef' };
const THEME_LABELS = { paper: '暖纸', night: '夜读', mint: '薄荷' };
const THEME_ORDER = ['paper', 'night', 'mint'];

export function applyTheme(theme) {
    const value = THEME_ORDER.includes(theme) ? theme : 'paper';
    document.documentElement.dataset.theme = value;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLORS[value]);
    const label = document.querySelector('#theme-label');
    if (label) label.textContent = THEME_LABELS[value];
}

export function updateStreakUI() {
    const streak = store.overview?.streak?.current || 0;
    const longest = store.overview?.streak?.longest || 0;
    const num = document.querySelector('#streak-num');
    if (num) num.textContent = `${streak} 天`;
    const mobile = document.querySelector('#mobile-streak');
    if (mobile) mobile.textContent = `🔥 ${streak}`;
    const card = document.querySelector('#streak-card');
    if (card) card.title = `当前连续 ${streak} 天，最长 ${longest} 天`;
}

export async function cycleTheme() {
    const current = store.settings?.theme || 'paper';
    const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
    applyTheme(next);
    try {
        await saveSettings({ theme: next });
    } catch {
        toast('主题暂时没有保存成功', 'error');
    }
}
