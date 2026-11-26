import { api } from '../api.js';
import { miniHeatmap } from '../heatmap.js';
import {
    escapeHtml,
    fmtDateCN,
    pct,
    toast,
    todayStr,
} from '../utils.js';

const RING_R = 82;
const RING_LEN = 2 * Math.PI * RING_R;

function ring(percent, strong, label) {
    const safe = Math.max(0, Math.min(100, Number(percent) || 0));
    const offset = RING_LEN - (RING_LEN * safe) / 100;
    return `
        <div class="ring-wrap" title="${safe}%">
            <svg viewBox="0 0 190 190" aria-hidden="true">
                <defs>
                    <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stop-color="var(--jade)"></stop>
                        <stop offset="1" stop-color="var(--amber-2)"></stop>
                    </linearGradient>
                </defs>
                <circle class="ring-bg" cx="95" cy="95" r="${RING_R}"></circle>
                <circle class="ring-fg" cx="95" cy="95" r="${RING_R}"
                    stroke-dasharray="${RING_LEN.toFixed(1)}"
                    stroke-dashoffset="${offset.toFixed(1)}"></circle>
            </svg>
            <div class="ring-center">
                <strong>${escapeHtml(strong)}</strong>
                <span>${escapeHtml(label)}</span>
            </div>
        </div>`;
}

function planCard(kind, value, total, title, desc) {
    const width = total > 0 ? Math.round((value / total) * 100) : 0;
    return `
        <div class="plan-card ${kind}">
            <div class="plan-top">
                <div>
                    <div class="plan-num">${value}</div>
                    <div class="plan-label">${title}</div>
                </div>
                <span class="badge ${kind === 'review' ? 'badge-jade' : kind === 'error' ? 'badge-coral' : 'badge-amber'}">${width}%</span>
            </div>
            <div class="plan-bar"><i style="width:${width}%"></i></div>
            <div class="plan-desc">${desc}</div>
        </div>`;
}

function activeProgress(session) {
    const total = session.total || session.items.length || 0;
    const saved = Number(localStorage.getItem(`mt-dictation-${session.id}`)) || 0;
    return { total, index: Math.min(Math.max(saved, 0), Math.max(0, total - 1)) };
}

const EXTRA_COUNT_KEY = 'mt-extra-count';

function savedExtraCount() {
    const saved = Number(localStorage.getItem(EXTRA_COUNT_KEY));
    return Number.isInteger(saved) && saved >= 1 && saved <= 100 ? saved : 10;
}

function extraControl() {
    return `
        <div class="extra-practice">
            <span class="extra-title">今天还想多练一些？</span>
            <div class="extra-fields">
                <label for="extra-count">听写</label>
                <input class="input extra-input" id="extra-count" type="number" min="1" max="100" step="1"
                    inputmode="numeric" value="${savedExtraCount()}" aria-label="额外听写数量">
                <span class="extra-unit">个</span>
                <button class="btn btn-primary" id="extra-start" type="button">开始</button>
            </div>
        </div>`;
}

function renderEmptyCard() {
    return `
        <div class="card card-pad" style="margin-top:18px">
            <div class="empty" style="padding:34px 16px 26px">
                <div class="empty-emoji">🌱</div>
                <h3>词库还是空的</h3>
                <p>可以先从统编版教材里挑一册导入，也可以把今天要听写的词粘贴进来。每天一点点，记忆就会慢慢长出来。</p>
                <div class="row wrap" style="justify-content:center;margin-top:6px">
                    <a class="btn btn-primary" href="#/import?tab=textbook">从教材导入</a>
                    <a class="btn" href="#/import?tab=paste">粘贴词语</a>
                </div>
            </div>
        </div>`;
}

function renderDifficult(list) {
    if (!list.length) {
        return `
            <div class="card card-pad">
                <div class="section-head" style="margin-bottom:8px">
                    <div><h2>易错小名单</h2><p>目前还没有反复写错的词，继续保持。</p></div>
                </div>
                <div class="empty" style="padding:18px 10px">
                    <div class="empty-emoji">✨</div>
                    <p>错的词会自动进入这里，下次优先复习。</p>
                </div>
            </div>`;
    }
    return `
        <div class="card card-pad">
            <div class="section-head" style="margin-bottom:10px">
                <div><h2>易错小名单</h2><p>这些词可以多看一眼。</p></div>
                <a class="chip chip-btn" href="#/words?status=wrong">全部 →</a>
            </div>
            <ul class="quick-list">
                ${list
                    .map(
                        (word) => `
                    <li>
                        <a href="#/words/${word.id}" class="row" style="gap:10px;min-width:0">
                            <span class="word-mini">${escapeHtml(word.text)}</span>
                            ${word.pinyin ? `<span class="small muted">${escapeHtml(word.pinyin)}</span>` : ''}
                        </a>
                        <span class="badge badge-coral">错 ${word.wrongCount} 次</span>
                    </li>`,
                    )
                    .join('')}
            </ul>
        </div>`;
}

function renderTip() {
    return `
        <div class="card card-pad">
            <div class="section-head" style="margin-bottom:8px">
                <div><h2>听写小妙招</h2><p>慢一点，记得更久。</p></div>
                <span class="badge badge-amber">小贴士</span>
            </div>
            <ol class="help-list" style="line-height:1.85">
                <li>先听清读音，在心里读一遍再动笔。</li>
                <li>写完回看一遍，特别是容易多笔少笔的字。</li>
                <li>不会写没关系，批改时点红它，明天还会再见。</li>
            </ol>
            <div class="divider"></div>
            <p class="small muted" style="margin:0">键盘快捷键：<span class="mono">←</span> 上一个，<span class="mono">→ / 空格</span> 下一个，<span class="mono">S</span> 朗读，<span class="mono">P</span> 拼音。</p>
        </div>`;
}

export async function render(root, ctx) {
    root.innerHTML = `
        <div class="page-loading">
            <div class="loader"></div>
            <p>正在看看今天该听写什么…</p>
        </div>`;

    const lang = ctx.store.settings?.lang || 'zh';
    const [todayData, heatmap, difficult] = await Promise.all([
        api.get(`/api/session/today?lang=${lang}`),
        api.get('/api/stats/heatmap?days=84'),
        api.get('/api/stats/difficult?limit=5'),
    ]);

    const active = todayData.active;
    const lastDone = todayData.lastDone;
    const preview = todayData.preview || {};
    const totalWords = ctx.store.overview?.total ?? 0;
    const streak = ctx.store.overview?.streak?.current ?? 0;

    let percent = 0;
    let ringStrong = preview.planned || 0;
    let ringLabel = '今日计划';
    let headline = '把今天的词，记得更牢一点。';
    let sub = escapeHtml(todayData.message || '每天一小步，复习会自己找上门。');
    let actions = '';

    if (active) {
        const progress = activeProgress(active);
        percent = progress.total ? Math.round((progress.index / progress.total) * 100) : 0;
        ringStrong = `${progress.index + 1}/${progress.total}`;
        ringLabel = '听到第几个';
        headline = '接着上次，继续听写。';
        sub = `这次听写还有 <b>${Math.max(0, progress.total - progress.index)}</b> 个词没听，慢慢来。`;
        actions = `
            <button class="btn btn-primary btn-lg" id="continue">继续听写</button>
            <button class="btn btn-lg" id="grade">先去批改</button>`;
    } else if (lastDone) {
        percent = lastDone.total ? Math.round((lastDone.correct / lastDone.total) * 100) : 0;
        ringStrong = lastDone.correct;
        ringLabel = `答对 / 共 ${lastDone.total}`;
        headline = percent >= 90 ? '今天记得真牢！' : '今天的听写完成啦。';
        sub = `答对 <b>${lastDone.correct}</b> 个，没记住 <b>${lastDone.wrong}</b> 个。错的词已经安排到下次复习。`;
        actions = `
            ${extraControl()}
            <a class="btn btn-lg" href="#/review/${lastDone.id}">查看成绩</a>`;
    } else {
        ringStrong = preview.planned || 0;
        ringLabel = '今日计划';
        if (!totalWords) {
            headline = '先种下一片小词库吧。';
            actions = '<a class="btn btn-primary btn-lg" href="#/import?tab=textbook">去导入词库</a>';
        } else if (preview.planned) {
            headline = '准备好了吗？开始今天的听写。';
            actions = `
                <button class="btn btn-primary btn-lg" id="start">开始听写</button>
                <a class="btn btn-lg" href="#/settings">调整每日词量</a>`;
        } else {
            headline = '今天的词都复习完了。';
            sub = '今天没有到期的词，也可以额外听写几个，趁热多练一遍。';
            actions = extraControl();
        }
    }

    const planTotal = preview.planned || 0;
    const planCards = `
        <div class="plan-cards">
            ${planCard('review', preview.reviewCount || 0, planTotal, '到期复习', '按记忆曲线今天该回看的词')}
            ${planCard('error', preview.errorCount || 0, planTotal, '易错巩固', '最近写错过的词，提前再见一面')}
            ${planCard('new', preview.newCount || 0, planTotal, '今日新词', '第一次听写，慢慢认识它')}
        </div>`;

    const doneBanner =
        lastDone && !active
            ? `
        <div class="done-banner" style="margin-top:18px">
            <span class="done-emoji">🎉</span>
            <div>
                <strong>今天的听写已经完成</strong>
                <span>答对 ${lastDone.correct} / ${lastDone.total}，正确率 ${pct(percent)}。错词会在明天或之后回来找你。</span>
            </div>
        </div>`
            : '';

    const chips = `
        <div class="row wrap" style="margin-top:16px;gap:7px">
            <span class="chip">目标 ${ctx.store.settings?.dailyTotal ?? 20} 词</span>
            <span class="chip">新词 ${ctx.store.settings?.newPerDay ?? 5} 个</span>
            <span class="chip">🔥 连续 ${streak} 天</span>
            <span class="chip">${todayData.lang === 'en' ? '英语模式' : '语文听写'}</span>
        </div>`;

    root.innerHTML = `
        <div class="fade-up">
            <section class="today-hero">
                <div>
                    <div class="eyebrow">今日 · ${escapeHtml(fmtDateCN(todayStr()))}</div>
                    <h1>${headline}</h1>
                    <p class="hero-sub">${sub}</p>
                    <div class="hero-actions">${actions}</div>
                    ${chips}
                </div>
                <div class="hero-ring">${ring(percent, ringStrong, ringLabel)}</div>
            </section>

            ${doneBanner}
            ${totalWords ? planCards : renderEmptyCard()}

            <div class="today-cols">
                <div class="card card-pad">
                    <div class="section-head">
                        <div>
                            <h2>最近 12 周</h2>
                            <p>每个小方块，都是认真复习过的一天。</p>
                        </div>
                        <span class="badge badge-jade">${heatmap.days.length} 天有记录</span>
                    </div>
                    <div class="mini-heatmap">${miniHeatmap(heatmap.days, 84)}</div>
                    <div class="legend-row" style="margin:12px 0 0">
                        <span class="legend-item"><span class="legend-swatch"></span>没复习</span>
                        <span class="legend-item"><span class="legend-swatch correct"></span>复习了</span>
                        <span class="legend-item"><span class="legend-swatch wrong"></span>错得较多</span>
                        <span class="legend-item"><span class="legend-swatch due"></span>今天</span>
                    </div>
                </div>
                <div class="stack">
                    ${renderDifficult(difficult)}
                    ${renderTip()}
                </div>
            </div>
        </div>`;

    const startButton = root.querySelector('#start');
    if (startButton) {
        startButton.addEventListener('click', async () => {
            startButton.disabled = true;
            startButton.textContent = '正在准备…';
            try {
                const session = await api.post('/api/session/start', { lang });
                localStorage.removeItem(`mt-dictation-${session.id}`);
                ctx.navigate(`#/dictation/${session.id}`);
            } catch (error) {
                toast(error.message, 'error');
                startButton.disabled = false;
                startButton.textContent = '开始听写';
            }
        });
    }

    const continueButton = root.querySelector('#continue');
    if (continueButton) {
        continueButton.addEventListener('click', () => ctx.navigate(`#/dictation/${active.id}`));
    }
    const gradeButton = root.querySelector('#grade');
    if (gradeButton) {
        gradeButton.addEventListener('click', () => ctx.navigate(`#/review/${active.id}`));
    }

    const extraInput = root.querySelector('#extra-count');
    const extraButton = root.querySelector('#extra-start');
    if (extraInput && extraButton) {
        const startExtra = async () => {
            let count = Math.round(Number(extraInput.value));
            if (!Number.isFinite(count)) count = 10;
            count = Math.min(100, Math.max(1, count));
            extraInput.value = String(count);
            localStorage.setItem(EXTRA_COUNT_KEY, String(count));
            extraButton.disabled = true;
            extraButton.textContent = '正在准备…';
            try {
                const session = await api.post('/api/session/extra', { lang, count });
                localStorage.removeItem(`mt-dictation-${session.id}`);
                ctx.navigate(`#/dictation/${session.id}`);
            } catch (error) {
                toast(error.message, 'error');
                extraButton.disabled = false;
                extraButton.textContent = '开始';
            }
        };
        extraButton.addEventListener('click', startExtra);
        extraInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') startExtra();
        });
        extraInput.addEventListener('change', () => {
            const value = Math.min(100, Math.max(1, Math.round(Number(extraInput.value) || 10)));
            extraInput.value = String(value);
            localStorage.setItem(EXTRA_COUNT_KEY, String(value));
        });
    }
}
