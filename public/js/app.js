import { refreshStore, store } from './store.js';
import { applyTheme, cycleTheme, updateStreakUI } from './theme.js';
import { loadVoices } from './utils.js';
import * as todayView from './views/today.js';
import * as englishView from './views/english.js';
import * as wordsView from './views/words.js';
import * as charsView from './views/chars.js';
import * as importView from './views/import.js';
import * as statsView from './views/stats.js';
import * as settingsView from './views/settings.js';
import * as dictationView from './views/dictation.js';
import * as reviewView from './views/review.js';

const app = document.querySelector('#app');

function parseRoute() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [pathPart, queryPart] = raw.split('?');
    const segments = pathPart.split('/').filter(Boolean);
    const params = Object.fromEntries(new URLSearchParams(queryPart || ''));
    return {
        name: segments[0] || 'today',
        id: segments[1] || '',
        segments,
        params,
    };
}

function setNav(route) {
    document.querySelectorAll('[data-nav]').forEach((link) => {
        link.classList.toggle('active', link.dataset.nav === route.name);
    });
}

function setFocusMode(on) {
    document.body.classList.toggle('focus-mode', on);
}

export async function refreshAppData() {
    await refreshStore();
    applyTheme(store.settings?.theme);
    updateStreakUI();
}

const ctx = {
    store,
    refresh: refreshAppData,
    applyTheme,
    navigate: (hash) => {
        location.hash = hash;
    },
};

async function renderRoute() {
    const route = parseRoute();
    setNav(route);
    setFocusMode(route.name === 'dictation' || route.name === 'review' || (route.name === 'english' && !!route.id));
    window.scrollTo(0, 0);

    try {
        switch (route.name) {
            case 'today':
                await todayView.render(app, ctx);
                break;
            case 'english':
                if (route.id) await englishView.renderSession(app, ctx, route.id);
                else await englishView.render(app, ctx);
                break;
            case 'words':
                if (route.id) await wordsView.renderDetail(app, ctx, route.id);
                else await wordsView.render(app, ctx);
                break;
            case 'chars':
                await charsView.render(app, ctx);
                break;
            case 'import':
                await importView.render(app, ctx);
                break;
            case 'stats':
                await statsView.render(app, ctx);
                break;
            case 'settings':
                await settingsView.render(app, ctx);
                break;
            case 'dictation':
                if (!route.id) throw new Error('缺少听写编号');
                await dictationView.render(app, ctx, route.id);
                break;
            case 'review':
                if (!route.id) throw new Error('缺少听写编号');
                await reviewView.render(app, ctx, route.id);
                break;
            default:
                await todayView.render(app, ctx);
                break;
        }
    } catch (error) {
        console.error(error);
        app.innerHTML = `
            <div class="card card-pad" style="max-width:620px;margin:40px auto;text-align:center">
                <div style="font-size:44px">🫠</div>
                <h2 style="margin:10px 0 6px">页面没有打开</h2>
                <p class="muted" style="font-size:13px">${String(error.message || error)}</p>
                <div class="row" style="justify-content:center;margin-top:18px">
                    <a class="btn btn-primary" href="#/today">回到今日</a>
                    <button class="btn" onclick="location.reload()">刷新试试</button>
                </div>
            </div>`;
    }
}

async function init() {
    try {
        await refreshStore();
        applyTheme(store.settings?.theme);
        updateStreakUI();
    } catch (error) {
        console.error(error);
        app.innerHTML = `
            <div class="empty">
                <div class="empty-emoji">🔌</div>
                <h3>连不上记忆小站</h3>
                <p>请确认后端已经启动，然后刷新页面。</p>
                <button class="btn btn-primary" onclick="location.reload()">重新连接</button>
            </div>`;
        return;
    }

    loadVoices();
    document.querySelector('#theme-toggle')?.addEventListener('click', cycleTheme);
    document.querySelector('#mobile-theme')?.addEventListener('click', cycleTheme);

    window.addEventListener('hashchange', renderRoute);
    if (!location.hash) history.replaceState(null, '', '#/today');
    await renderRoute();
}

init();
