import { api } from '../api.js';
import {
    dueText,
    escapeHtml,
    fmtDateCN,
    kindBadge,
    pinyinPairs,
    pct,
    toast,
    todayStr,
} from '../utils.js';

function wordIdKey(id) {
    return `mt-dictation-wrong-${id}`;
}

function loadMarks(id) {
    try {
        const list = JSON.parse(localStorage.getItem(wordIdKey(id)) || '[]');
        return new Set(Array.isArray(list) ? list.map(Number) : []);
    } catch {
        return new Set();
    }
}

function clearMarks(id) {
    try {
        localStorage.removeItem(wordIdKey(id));
        localStorage.removeItem(`mt-dictation-${id}`);
    } catch {
        /* ignore */
    }
}

function charCells(word, wrongSet = new Set()) {
    if (word.lang === 'en') return escapeHtml(word.text);
    return pinyinPairs(word.text, word.pinyin)
        .map(
            (pair, index) => `
            <span class="char-cell clickable ${wrongSet.has(index) ? 'wrong' : ''}" data-index="${index}">
                <span class="char-py">${escapeHtml(pair.py)}</span>
                <span class="char-hz">${escapeHtml(pair.char)}</span>
            </span>`,
        )
        .join('');
}

function stateOf(state, wordId) {
    if (!state.has(wordId)) state.set(wordId, { whole: false, chars: new Set() });
    return state.get(wordId);
}

function isWrong(state, wordId) {
    const item = state.get(wordId);
    return !!item && (item.whole || item.chars.size > 0);
}

function reviewCard(item, state) {
    const word = item.word;
    const st = stateOf(state, word.id);
    const wrong = st.whole || st.chars.size > 0;
    const notes = [];
    if (word.meaning) notes.push(word.meaning);
    if (st.whole) notes.push('整词没记住');
    else if (st.chars.size) notes.push(`标红了 ${st.chars.size} 个字`);

    return `
        <div class="review-card ${wrong ? 'wrong' : 'correct'}" data-word="${word.id}">
            <div class="review-top">
                <div class="row" style="gap:6px">
                    ${kindBadge(item.kind)}
                    ${word.lang === 'en' ? '<span class="badge badge-blue">EN</span>' : ''}
                </div>
                <span class="review-state">${wrong ? '✕' : '✓'}</span>
            </div>
            <div class="review-word ${word.lang === 'en' ? 'en' : ''}">${charCells(word, st.chars)}</div>
            ${notes.length ? `<div class="review-note">${escapeHtml(notes.join(' · '))}</div>` : ''}
        </div>`;
}

function resultWord(word, charsWrong) {
    if (word.lang === 'en') return escapeHtml(word.text);
    const wrong = new Set(charsWrong || []);
    return pinyinPairs(word.text, word.pinyin)
        .map(
            (pair, index) => `
            <span class="char-cell ${wrong.has(index) ? 'wrong' : ''}" style="cursor:default">
                <span class="char-py">${escapeHtml(pair.py)}</span>
                <span class="char-hz">${escapeHtml(pair.char)}</span>
            </span>`,
        )
        .join('');
}

function scoreCopy(score) {
    if (score === 100) return { title: '全对！今天的词都记住了。', sub: '太棒了，下一次复习会在合适的时候回来。' };
    if (score >= 80) return { title: '很棒，只差一点点。', sub: '错的词已经记下来，明天或之后会再出现。' };
    if (score >= 60) return { title: '记住大半啦。', sub: '没记住的词不用怕，多见面就熟了。' };
    return { title: '没关系，再来一次。', sub: '错的词正是最值得练的词，下次一定更顺。' };
}

function renderResult(root, ctx, session) {
    const total = session.total || session.items.length || 0;
    const correct = session.correct || 0;
    const wrong = session.wrong || 0;
    const score = total ? Math.round((correct / total) * 100) : 0;
    const copy = scoreCopy(score);
    const wrongItems = session.items.filter((item) => item.result === 'wrong');
    const correctItems = session.items.filter((item) => item.result !== 'wrong');
    const list = [...wrongItems, ...correctItems];

    const rows = list
        .map((item) => {
            const word = item.word;
            const isWrong = item.result === 'wrong';
            return `
            <div class="result-item ${isWrong ? 'wrong' : ''}">
                <div class="row" style="gap:12px;min-width:0;flex-wrap:wrap">
                    <span class="badge ${isWrong ? 'badge-coral' : 'badge-jade'}">${isWrong ? '没记住' : '记住了'}</span>
                    <span class="word-mini">${resultWord(word, item.charsWrong)}</span>
                    ${word.meaning ? `<span class="small muted">${escapeHtml(word.meaning)}</span>` : ''}
                </div>
                <div style="text-align:right;flex:none">
                    <div class="small"><strong>${escapeHtml(dueText(word))}</strong></div>
                    <div class="small muted">${word.dueDate ? escapeHtml(fmtDateCN(word.dueDate, false)) : ''} · 间隔 ${word.intervalDays} 天</div>
                </div>
            </div>`;
        })
        .join('');

    root.innerHTML = `
        <div class="review-page fade-up" style="padding-bottom:60px">
            <div class="review-head">
                <div>
                    <div class="eyebrow">听写成绩 · ${escapeHtml(fmtDateCN(session.date || todayStr()))}</div>
                    <h1>${copy.title}</h1>
                    <p>${copy.sub}</p>
                </div>
                <div class="row wrap">
                    <a class="btn btn-sm" href="#/today">回到今日</a>
                    <a class="btn btn-sm" href="#/stats">看看统计</a>
                </div>
            </div>

            <div class="result-hero">
                <div class="result-score">${score}<small>分</small></div>
                <h1>${correct} 个记住 · ${wrong} 个再练</h1>
                <p>${session.lang === 'en' ? '英语单词' : '语文听写'} · 共 ${total} 个词</p>
                <div class="hero-actions" style="justify-content:center;margin-top:18px">
                    <a class="btn btn-primary" href="#/today">明天继续</a>
                    <a class="btn" href="#/words?status=wrong">看看易错词</a>
                </div>
            </div>

            <div class="result-grid">
                <div class="stat-tile"><b>${correct}</b><span>记住的词</span></div>
                <div class="stat-tile"><b>${wrong}</b><span>需要再练</span></div>
                <div class="stat-tile"><b>${pct(score)}</b><span>本次正确率</span></div>
            </div>

            <div class="card card-pad">
                <div class="section-head" style="margin-bottom:12px">
                    <div><h2>每个词的去向</h2><p>答对的词会拉长间隔，答错的词明天回来。</p></div>
                    <span class="badge badge-jade">${total} 个词</span>
                </div>
                <div class="result-list">${rows || '<p class="muted">这次没有词。</p>'}</div>
            </div>
        </div>`;

    Promise.resolve(ctx.refresh?.()).catch(() => {});
}

function renderGrading(root, ctx, session) {
    const state = new Map();
    for (const item of session.items) {
        state.set(item.word.id, { whole: false, chars: new Set() });
    }
    for (const wordId of loadMarks(session.id)) {
        const st = state.get(Number(wordId));
        if (st) st.whole = true;
    }

    const markedCount = [...state.values()].filter((st) => st.whole || st.chars.size > 0).length;

    root.innerHTML = `
        <div class="review-page fade-up">
            <div class="review-head">
                <div>
                    <div class="eyebrow">听写批改 · ${escapeHtml(fmtDateCN(session.date || todayStr()))}</div>
                    <h1>哪里没记住，就点哪里</h1>
                    <p>默认全部算对。点一下整词，或点单个字，变红表示没记住；再点一次可以取消。</p>
                </div>
                <div class="row wrap">
                    <a class="btn btn-sm" href="#/dictation/${session.id}">继续听写</a>
                    <a class="btn btn-sm btn-ghost" href="#/today">稍后再改</a>
                </div>
            </div>

            <div class="legend-row">
                <span class="legend-item"><span class="badge badge-jade">✓ 记住了</span></span>
                <span class="legend-item"><span class="badge badge-coral">✕ 没记住</span></span>
                <span class="legend-item">${markedCount ? `听写时已标红 ${markedCount} 个` : '听写时没有标红'}</span>
            </div>

            <div class="review-grid" id="review-grid"></div>

            <div class="review-footer">
                <div class="review-footer-inner">
                    <div class="review-count">
                        <span>记住 <b id="count-correct">0</b></span>
                        <span class="wrong-count">没记住 <b id="count-wrong">0</b></span>
                        <span id="count-chars" class="muted"></span>
                    </div>
                    <div class="review-actions">
                        <button class="btn" id="all-correct">全部算对</button>
                        <button class="btn btn-primary" id="submit">提交成绩</button>
                    </div>
                </div>
            </div>
        </div>`;

    const grid = root.querySelector('#review-grid');
    const countCorrect = root.querySelector('#count-correct');
    const countWrong = root.querySelector('#count-wrong');
    const countChars = root.querySelector('#count-chars');

    function paint() {
        grid.innerHTML = session.items.map((item) => reviewCard(item, state)).join('');
        let correct = 0;
        let wrong = 0;
        let chars = 0;
        for (const item of session.items) {
            if (isWrong(state, item.word.id)) wrong += 1;
            else correct += 1;
            const st = state.get(item.word.id);
            if (st) chars += st.chars.size;
        }
        countCorrect.textContent = String(correct);
        countWrong.textContent = String(wrong);
        countChars.textContent = chars ? `按字标红 ${chars} 处` : '';
    }

    paint();

    grid.addEventListener('click', (event) => {
        const card = event.target.closest('.review-card');
        if (!card) return;
        const wordId = Number(card.dataset.word);
        const st = stateOf(state, wordId);
        const cell = event.target.closest('.char-cell');
        if (cell) {
            if (st.whole) {
                st.whole = false;
                st.chars.clear();
            }
            const index = Number(cell.dataset.index);
            if (st.chars.has(index)) st.chars.delete(index);
            else st.chars.add(index);
        } else if (st.whole || st.chars.size > 0) {
            st.whole = false;
            st.chars.clear();
        } else {
            st.whole = true;
        }
        paint();
    });

    root.querySelector('#all-correct')?.addEventListener('click', () => {
        for (const st of state.values()) {
            st.whole = false;
            st.chars.clear();
        }
        paint();
        toast('已全部算对，检查一遍再提交', 'success');
    });

    const submitButton = root.querySelector('#submit');
    submitButton?.addEventListener('click', async () => {
        submitButton.disabled = true;
        submitButton.textContent = '正在提交…';
        const items = session.items.map((item) => {
            const st = stateOf(state, item.word.id);
            const wrong = st.whole || st.chars.size > 0;
            return {
                wordId: item.word.id,
                result: wrong ? 'wrong' : 'correct',
                charsWrong: [...st.chars],
            };
        });
        try {
            const result = await api.post(`/api/sessions/${session.id}/submit`, { items });
            clearMarks(session.id);
            toast(`提交成功：答对 ${result.correct} 个，没记住 ${result.wrong} 个`, 'success');
            renderResult(root, ctx, result);
        } catch (error) {
            toast(error.message, 'error');
            submitButton.disabled = false;
            submitButton.textContent = '提交成绩';
        }
    });
}

export async function render(root, ctx, id) {
    root.innerHTML = `
        <div class="page-loading">
            <div class="loader"></div>
            <p>正在打开批改页…</p>
        </div>`;

    let session;
    try {
        session = await api.get(`/api/sessions/${id}`);
    } catch (error) {
        root.innerHTML = `
            <div class="review-page">
                <div class="empty">
                    <div class="empty-emoji">📝</div>
                    <h3>没有找到这次听写</h3>
                    <p>${escapeHtml(error.message)}</p>
                    <a class="btn btn-primary" href="#/today">回到今日</a>
                </div>
            </div>`;
        return;
    }

    if (session.status === 'done') {
        renderResult(root, ctx, session);
        return;
    }
    if (session.status !== 'active') {
        root.innerHTML = `
            <div class="review-page">
                <div class="empty">
                    <div class="empty-emoji">🕰️</div>
                    <h3>这次听写已经结束</h3>
                    <p>没有可以批改的内容了。</p>
                    <a class="btn btn-primary" href="#/today">回到今日</a>
                </div>
            </div>`;
        return;
    }

    renderGrading(root, ctx, session);
}
