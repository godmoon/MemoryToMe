import { api } from '../api.js';
import { dueText, escapeHtml, fmtDateCN, kindBadge, speak, toast, todayStr } from '../utils.js';

const EXTRA_KEY = 'mt-en-extra-count';

const SPEAKER_ICON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4z"></path>
        <path d="M15.5 8.5a5 5 0 0 1 0 7"></path>
        <path d="M18.5 5.5a9 9 0 0 1 0 13"></path>
    </svg>`;

function savedExtraCount() {
    const saved = Number(localStorage.getItem(EXTRA_KEY));
    return Number.isInteger(saved) && saved >= 1 && saved <= 100 ? saved : 10;
}

function extraControl() {
    return `
        <div class="extra-practice">
            <span class="extra-title">今天还想多认几个？</span>
            <div class="extra-fields">
                <label for="en-extra-count">认词</label>
                <input class="input extra-input" id="en-extra-count" type="number" min="1" max="100" step="1"
                    inputmode="numeric" value="${savedExtraCount()}" aria-label="额外认词数量">
                <span class="extra-unit">个</span>
                <button class="btn btn-primary" id="en-extra-start" type="button">开始</button>
            </div>
        </div>`;
}

function bindExtra(root, ctx) {
    const input = root.querySelector('#en-extra-count');
    const button = root.querySelector('#en-extra-start');
    if (!input || !button) return;

    const start = async () => {
        let count = Math.round(Number(input.value));
        if (!Number.isFinite(count)) count = 10;
        count = Math.min(100, Math.max(1, count));
        input.value = String(count);
        localStorage.setItem(EXTRA_KEY, String(count));
        button.disabled = true;
        button.textContent = '正在准备…';
        try {
            const session = await api.post('/api/session/extra', { lang: 'en', count });
            ctx.navigate(`#/english/${session.id}`);
        } catch (error) {
            toast(error.message, 'error');
            button.disabled = false;
            button.textContent = '开始';
        }
    };

    button.addEventListener('click', start);
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') start();
    });
    input.addEventListener('change', () => {
        const value = Math.min(100, Math.max(1, Math.round(Number(input.value) || 10)));
        input.value = String(value);
        localStorage.setItem(EXTRA_KEY, String(value));
    });
}

function answeredCount(session) {
    return (session.items || []).filter((item) => item.result).length;
}

/* -------------------------------- 英语首页 ------------------------------- */

export async function render(root, ctx) {
    root.innerHTML = `
        <div class="page-loading">
            <div class="loader"></div>
            <p>正在打开英语单词…</p>
        </div>`;

    let todayData;
    try {
        todayData = await api.get('/api/session/today?lang=en');
    } catch (error) {
        root.innerHTML = `
            <div class="empty">
                <div class="empty-emoji">🫠</div>
                <h3>英语单词没有打开</h3>
                <p>${escapeHtml(error.message)}</p>
                <button class="btn btn-primary" onclick="location.reload()">刷新试试</button>
            </div>`;
        return;
    }

    const totalWords = todayData.totalWords || 0;
    const preview = todayData.preview || {};
    const active = todayData.active;
    const lastDone = todayData.lastDone;
    const planned = preview.planned || 0;

    if (!totalWords) {
        root.innerHTML = `
            <div class="fade-up">
                <div class="section-head">
                    <div>
                        <h1 class="page-title">英语单词</h1>
                        <p class="page-sub">看英文认中文，认识就行，不用默写。</p>
                    </div>
                    <span class="badge badge-blue">EN</span>
                </div>
                <div class="card card-pad empty" style="min-height:320px">
                    <div class="empty-emoji">🔤</div>
                    <h3>还没有英语单词</h3>
                    <p>先去导入一个词包，再回来认单词。</p>
                    <div class="row" style="justify-content:center;margin-top:14px">
                        <a class="btn btn-primary" href="#/import?tab=english">去导入英语词库</a>
                    </div>
                </div>
            </div>`;
        return;
    }

    let headline = '今天先认几个单词。';
    let sub = escapeHtml(todayData.message || '看英文，想中文，认识就行。');
    let actions = '';
    let heroNumber = planned;
    let heroLabel = '今日词量';

    if (active) {
        const answered = answeredCount(active);
        const total = active.total || (active.items || []).length;
        heroNumber = Math.max(0, total - answered);
        heroLabel = '还剩几个';
        headline = '接着上次，继续认词。';
        sub = `这次练习还有 <b>${heroNumber}</b> 个单词没认，慢慢来。`;
        actions = `<a class="btn btn-primary btn-lg" href="#/english/${active.id}">继续认词</a>`;
    } else if (lastDone) {
        const total = lastDone.total || 0;
        const score = total ? Math.round((lastDone.correct / total) * 100) : 0;
        heroNumber = lastDone.correct || 0;
        heroLabel = '今天认对';
        headline = score >= 90 ? '今天认得真准！' : '今天的英语认完啦。';
        sub = `认对 <b>${lastDone.correct}</b> 个，没记住 <b>${lastDone.wrong}</b> 个。没记住的词已经安排到下次复习。`;
        actions = `
            ${extraControl()}
            <a class="btn btn-lg" href="#/english/${lastDone.id}">查看结果</a>`;
    } else if (planned) {
        headline = '准备好了吗？开始认单词。';
        sub = `今天有 <b>${planned}</b> 个单词，看英文想中文，认识就点“记住了”。`;
        actions = `<button class="btn btn-primary btn-lg" id="en-start">开始认词</button>`;
    } else {
        heroNumber = 0;
        heroLabel = '今日词量';
        headline = '今天的单词都认完了。';
        sub = '今天没有到期的单词，也可以额外认几个，趁热多看一眼。';
        actions = extraControl();
    }

    root.innerHTML = `
        <div class="fade-up">
            <div class="section-head">
                <div>
                    <h1 class="page-title">英语单词</h1>
                    <p class="page-sub">看英文认中文，认识就行，不用默写。</p>
                </div>
                <span class="badge badge-blue">EN</span>
            </div>

            <div class="card card-pad en-hero">
                <div class="en-hero-main">
                    <div class="eyebrow">今日英语 · ${escapeHtml(fmtDateCN(todayData.today || todayStr()))}</div>
                    <h2>${escapeHtml(headline)}</h2>
                    <p class="muted">${sub}</p>
                    <div class="hero-actions">${actions}</div>
                </div>
                <div class="en-hero-count">
                    <strong>${heroNumber}</strong>
                    <span>${heroLabel}</span>
                </div>
            </div>

            <div class="result-grid" style="margin-top:18px">
                <div class="stat-tile"><b>${preview.reviewCount || 0}</b><span>到期复习</span></div>
                <div class="stat-tile"><b>${preview.newCount || 0}</b><span>今日新词</span></div>
                <div class="stat-tile"><b>${totalWords}</b><span>词库单词</span></div>
            </div>

            <div class="card card-pad" style="margin-top:18px">
                <div class="section-head" style="margin-bottom:10px">
                    <div><h2>怎么认</h2><p>不用写，也不用拼，看到单词能想起中文就算认识。</p></div>
                </div>
                <ol class="help-list">
                    <li>先看英文单词，自己在心里想一想中文意思。</li>
                    <li>点下面的“查看释义”（或按空格）查看中文释义。</li>
                    <li>想起来了点“记住了”，没想起来点“没记住”。</li>
                    <li>答对的词间隔会拉长，没记住的词明天再来。</li>
                </ol>
                <div class="divider"></div>
                <a class="btn btn-block" href="#/import?tab=english">管理英语词库</a>
            </div>
        </div>`;

    const startButton = root.querySelector('#en-start');
    if (startButton) {
        startButton.addEventListener('click', async () => {
            startButton.disabled = true;
            startButton.textContent = '正在准备…';
            try {
                const session = await api.post('/api/session/start', { lang: 'en' });
                ctx.navigate(`#/english/${session.id}`);
            } catch (error) {
                toast(error.message, 'error');
                startButton.disabled = false;
                startButton.textContent = '开始认词';
            }
        });
    }

    bindExtra(root, ctx);
}

/* -------------------------------- 认词练习 ------------------------------- */

export async function renderSession(root, ctx, id) {
    let session;
    try {
        session = await api.get(`/api/sessions/${id}`);
    } catch (error) {
        root.innerHTML = `
            <div class="focus-page">
                <div class="empty">
                    <div class="empty-emoji">🔤</div>
                    <h3>没有找到这次练习</h3>
                    <p>${escapeHtml(error.message)}</p>
                    <a class="btn btn-primary" href="#/english">回到英语</a>
                </div>
            </div>`;
        return;
    }

    // 语文听写会话误入英语页时，交还给听写页
    if (session.lang !== 'en') {
        ctx.navigate(`#/dictation/${id}`);
        return;
    }

    if (session.status === 'done') {
        renderSummary(root, ctx, session);
        return;
    }
    if (session.status !== 'active') {
        root.innerHTML = `
            <div class="focus-page">
                <div class="empty">
                    <div class="empty-emoji">🕰️</div>
                    <h3>这次练习已经结束</h3>
                    <p>可以回到英语页，重新开始一组。</p>
                    <a class="btn btn-primary" href="#/english">回到英语</a>
                </div>
            </div>`;
        return;
    }

    const items = session.items || [];
    if (!items.length) {
        root.innerHTML = `
            <div class="focus-page">
                <div class="empty">
                    <div class="empty-emoji">🫙</div>
                    <h3>这次练习没有词</h3>
                    <p>回到英语页重新开始一组吧。</p>
                    <a class="btn btn-primary" href="#/english">回到英语</a>
                </div>
            </div>`;
        return;
    }

    let index = items.findIndex((item) => !item.result);
    if (index < 0) {
        renderSummary(root, ctx, session);
        return;
    }

    let revealed = false;
    let busy = false;
    let revealCurrent = null;

    function cleanup() {
        document.removeEventListener('keydown', onKey);
    }

    function speakWord() {
        const word = items[index].word;
        const settings = ctx.store.settings || {};
        speak(word.text, 'en', settings.speechRate ?? 0.85, settings.enVoiceURI || '');
    }

    function renderCard() {
        const item = items[index];
        const word = item.word;
        const total = items.length;
        const progress = Math.round(((index + 1) / total) * 100);
        const dots = items
            .map((entry, position) => {
                const cls = entry.result === 'wrong' ? 'wrong' : entry.result ? 'done' : position === index ? 'current' : '';
                return `<i class="${cls}"></i>`;
            })
            .join('');

        root.innerHTML = `
            <div class="focus-page">
                <div class="focus-top">
                    <a class="back-btn" href="#/english">← 英语</a>
                    <div class="focus-progress"><b>${index + 1}</b> / ${total}</div>
                    <span class="badge badge-blue">认识就行</span>
                </div>
                <div class="progress-line"><i style="width:${progress}%"></i></div>

                <div class="dictation-stage">
                    <div class="dictation-meta">
                        ${kindBadge(item.kind)}
                        <span>英语单词</span>
                    </div>

                    <div class="dictation-card en-card" id="en-card">
                        <div class="en-word">${escapeHtml(word.text)}</div>
                        <div class="en-meaning ${revealed ? '' : 'hidden'}" id="en-meaning">
                            ${escapeHtml(word.meaning || '（这个词还没有释义）')}
                        </div>
                        <div class="dictation-hint" id="en-hint">
                            ${revealed ? '想起来了就点下面的按钮' : '先想一想中文意思，再点下面的“查看释义”'}
                        </div>
                    </div>

                    <button class="speak-orb" id="en-speak" type="button" aria-label="朗读这个单词">${SPEAKER_ICON}</button>
                    <div class="dots">${dots}</div>
                </div>

                <div class="en-actions" id="en-actions"></div>
                <p class="small muted" style="text-align:center;margin:14px 0 0">
                    键盘：<span class="mono">空格</span> 看释义 · <span class="mono">←</span> 没记住 · <span class="mono">→</span> 记住了
                </p>
            </div>`;

        // 未看释义时这里是“查看释义”，看过之后换成同一位置的“没记住 / 记住了”
        function renderActions() {
            const box = root.querySelector('#en-actions');
            if (!box) return;
            if (!revealed) {
                box.innerHTML = '<button class="btn btn-primary en-reveal" id="en-reveal" type="button">查看释义</button>';
                box.querySelector('#en-reveal').addEventListener('click', reveal);
                return;
            }
            box.innerHTML = `
                <button class="btn btn-coral" data-result="wrong" type="button">没记住</button>
                <button class="btn btn-primary" data-result="correct" type="button">记住了</button>`;
            box.querySelectorAll('[data-result]').forEach((button) => {
                button.addEventListener('click', () => answer(button.dataset.result));
            });
        }

        function reveal() {
            if (revealed) return;
            revealed = true;
            root.querySelector('#en-meaning')?.classList.remove('hidden');
            const hint = root.querySelector('#en-hint');
            if (hint) hint.textContent = '想起来了就点下面的按钮';
            renderActions();
        }

        root.querySelector('#en-speak').addEventListener('click', () => speakWord());

        revealCurrent = reveal;
        renderActions();

        if (ctx.store.settings?.autoSpeak) speakWord();
    }

    async function answer(result) {
        if (busy || !revealed) return;
        busy = true;
        root.querySelectorAll('#en-actions button').forEach((button) => {
            button.disabled = true;
        });
        try {
            const updated = await api.post(`/api/sessions/${id}/answer`, {
                wordId: items[index].word.id,
                result,
            });
            items[index].result = result;
            if (updated.status === 'done') {
                cleanup();
                renderSummary(root, ctx, updated);
                return;
            }
            const next = items.findIndex((item) => !item.result);
            index = next >= 0 ? next : index;
            revealed = false;
            busy = false;
            renderCard();
        } catch (error) {
            toast(error.message, 'error');
            busy = false;
            root.querySelectorAll('#en-actions button').forEach((button) => {
                button.disabled = false;
            });
        }
    }

    function onKey(event) {
        if (event.key === ' ' || event.key === 'Enter') {
            if (event.target?.closest?.('button, a, input, select, textarea')) return;
            event.preventDefault();
            if (!revealed) revealCurrent?.();
        } else if (event.key === 'ArrowLeft' || event.key === '1') {
            answer('wrong');
        } else if (event.key === 'ArrowRight' || event.key === '2') {
            answer('correct');
        }
    }

    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', cleanup, { once: true });
    renderCard();
}

/* -------------------------------- 练习结果 ------------------------------- */

function renderSummary(root, ctx, session) {
    const total = session.total || (session.items || []).length || 0;
    const correct = session.correct || 0;
    const wrong = session.wrong || 0;
    const score = total ? Math.round((correct / total) * 100) : 0;
    const wrongItems = (session.items || []).filter((item) => item.result === 'wrong');
    const title = score >= 90 ? '认得真准！' : score >= 70 ? '大部分都认识。' : '没关系，多见面就熟了。';

    const rows = wrongItems.length
        ? wrongItems
              .map((item) => {
                  const word = item.word;
                  return `
                    <div class="result-item wrong">
                        <div class="row" style="gap:12px;min-width:0;flex-wrap:wrap">
                            <span class="badge badge-coral">没记住</span>
                            <span class="word-mini">${escapeHtml(word.text)}</span>
                            ${word.meaning ? `<span class="small muted">${escapeHtml(word.meaning)}</span>` : ''}
                        </div>
                        <div style="text-align:right;flex:none">
                            <div class="small"><strong>${escapeHtml(dueText(word))}</strong></div>
                            <div class="small muted">${word.dueDate ? escapeHtml(fmtDateCN(word.dueDate, false)) : ''}</div>
                        </div>
                    </div>`;
              })
              .join('')
        : '<p class="muted">这次全部记住了，下一次会在合适的时候再见到它们。</p>';

    root.innerHTML = `
        <div class="review-page fade-up" style="padding-bottom:60px">
            <div class="review-head">
                <div>
                    <div class="eyebrow">英语认词 · ${escapeHtml(fmtDateCN(session.date || todayStr()))}</div>
                    <h1>${title}</h1>
                    <p>认对 ${correct} 个，没记住 ${wrong} 个。没记住的词已经安排到下次复习。</p>
                </div>
                <a class="btn btn-sm" href="#/english">回到英语</a>
            </div>

            <div class="result-hero">
                <div class="result-score">${score}<small>分</small></div>
                <h1>${correct} 个认识 · ${wrong} 个再认</h1>
                <p>英语单词 · 共 ${total} 个</p>
                <div class="hero-actions" style="justify-content:center;margin-top:18px">
                    <a class="btn btn-primary" href="#/english">明天继续</a>
                    <a class="btn" href="#/words?lang=en">看看英语词库</a>
                </div>
            </div>

            <div class="result-grid">
                <div class="stat-tile"><b>${correct}</b><span>认识的词</span></div>
                <div class="stat-tile"><b>${wrong}</b><span>需要再认</span></div>
                <div class="stat-tile"><b>${score}%</b><span>本次正确率</span></div>
            </div>

            <div class="card card-pad">
                <div class="section-head" style="margin-bottom:12px">
                    <div><h2>没记住的词</h2><p>这些词明天或之后会再出现，多认几次就熟了。</p></div>
                    <span class="badge badge-coral">${wrong} 个</span>
                </div>
                <div class="result-list">${rows}</div>
            </div>

            <div class="card card-pad" style="margin-top:18px">
                ${extraControl()}
            </div>
        </div>`;

    bindExtra(root, ctx);
    Promise.resolve(ctx.refresh?.()).catch(() => {});
}
