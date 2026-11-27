import { api } from '../api.js';
import { openCharPractice, openCharSheet } from '../char-sheet.js';
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

function saveMarks(id, set) {
    try {
        localStorage.setItem(wordIdKey(id), JSON.stringify([...set]));
    } catch {
        /* ignore */
    }
}

function loadHeard(id) {
    try {
        const list = JSON.parse(localStorage.getItem(`mt-dictation-heard-${id}`) || '[]');
        return new Set(Array.isArray(list) ? list.map(Number) : []);
    } catch {
        return new Set();
    }
}

function clearMarks(id) {
    try {
        localStorage.removeItem(wordIdKey(id));
        localStorage.removeItem(`mt-dictation-${id}`);
        localStorage.removeItem(`mt-dictation-heard-${id}`);
    } catch {
        /* ignore */
    }
}

function charCells(word, wrongSet = new Set(), whole = false) {
    if (word.lang === 'en') return escapeHtml(word.text);
    return pinyinPairs(word.text, word.pinyin)
        .map(
            (pair, index) => `
            <span class="char-cell clickable ${whole || wrongSet.has(index) ? 'wrong' : ''}" data-index="${index}">
                <span class="char-py">${escapeHtml(pair.py)}</span>
                <span class="char-hz">${escapeHtml(pair.char)}</span>
            </span>`,
        )
        .join('');
}

/** 整词标红时，提交要把每个字的序号都带上，易错字统计才有数据。 */
function wrongCharIndexes(word, st) {
    if (word.lang === 'en') return [];
    const length = Array.from(word.text).length;
    if (st.whole) return Array.from({ length }, (_, index) => index);
    return [...st.chars].filter((index) => index >= 0 && index < length).sort((a, b) => a - b);
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
    if (st.whole) {
        const count = word.lang === 'en' ? 0 : Array.from(word.text).length;
        notes.push(count ? `整词没记住 · ${count} 个字都标红` : '整词没记住');
    } else if (st.chars.size) {
        notes.push(`标红了 ${st.chars.size} 个字`);
    }

    return `
        <div class="review-card ${wrong ? 'wrong' : 'correct'}" data-word="${word.id}">
            <div class="review-top">
                <div class="row" style="gap:6px">
                    ${kindBadge(item.kind)}
                    ${word.lang === 'en' ? '<span class="badge badge-blue">EN</span>' : ''}
                </div>
                <span class="review-state">${wrong ? '✕' : '✓'}</span>
            </div>
            <div class="review-word ${word.lang === 'en' ? 'en' : ''}">${charCells(word, st.chars, st.whole)}</div>
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

/** 汇总本次成绩里标红的字，用于成绩页的“本次易错字”和默写单。 */
function collectResultWrongChars(items) {
    const map = new Map();
    for (const item of items) {
        if (item.word.lang === 'en' || item.result !== 'wrong') continue;
        const chars = Array.from(item.word.text);
        const pairs = pinyinPairs(item.word.text, item.word.pinyin);
        const indexes = Array.isArray(item.charsWrong) && item.charsWrong.length
            ? item.charsWrong
            : chars.map((_, index) => index);
        for (const index of indexes) {
            const char = chars[index];
            if (!char) continue;
            let entry = map.get(char);
            if (!entry) {
                entry = { char, pinyin: '', count: 0, words: new Set() };
                map.set(char, entry);
            }
            entry.count += 1;
            entry.words.add(item.word.text);
            if (!entry.pinyin && pairs[index]?.py) entry.pinyin = pairs[index].py;
        }
    }
    return [...map.values()]
        .map((entry) => ({ ...entry, words: [...entry.words] }))
        .sort((a, b) => b.count - a.count || a.char.localeCompare(b.char, 'zh'));
}

function scoreCopy(score, remaining = 0) {
    if (remaining > 0) {
        if (score === 100) return { title: '这一批全对！', sub: `还有 ${remaining} 个词没听，休息一下再继续。` };
        if (score >= 80) return { title: '这批记得不错。', sub: `错的词已经记下来，还有 ${remaining} 个词没听。` };
        if (score >= 60) return { title: '记住大半啦。', sub: `没记住的词会再出现，还有 ${remaining} 个词没听。` };
        return { title: '没关系，再来一次。', sub: `错的词正是最值得练的，还有 ${remaining} 个词没听。` };
    }
    if (score === 100) return { title: '全对！今天的词都记住了。', sub: '太棒了，下一次复习会在合适的时候回来。' };
    if (score >= 80) return { title: '很棒，只差一点点。', sub: '错的词已经记下来，明天或之后会再出现。' };
    if (score >= 60) return { title: '记住大半啦。', sub: '没记住的词不用怕，多见面就熟了。' };
    return { title: '没关系，再来一次。', sub: '错的词正是最值得练的词，下次一定更顺。' };
}

function renderResult(root, ctx, session, { remaining = 0 } = {}) {
    const items = Array.isArray(session.items) ? session.items : [];
    // 只统计真正批改过的词，没听过的词不算分
    const gradedItems = items.filter((item) => item.result === 'correct' || item.result === 'wrong');
    const total = gradedItems.length || session.total || items.length || 0;
    const correct = gradedItems.length ? gradedItems.filter((item) => item.result === 'correct').length : session.correct || 0;
    const wrong = gradedItems.length ? gradedItems.filter((item) => item.result === 'wrong').length : session.wrong || 0;
    const score = total ? Math.round((correct / total) * 100) : 0;
    const copy = scoreCopy(score, remaining);
    const wrongItems = gradedItems.filter((item) => item.result === 'wrong');
    const correctItems = gradedItems.filter((item) => item.result === 'correct');
    const list = [...wrongItems, ...correctItems];
    const wrongChars = collectResultWrongChars(gradedItems);

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
                <p>${session.lang === 'en' ? '英语单词' : '语文听写'} · 本次批改 ${total} 个词${
                    remaining > 0 ? ` · 还剩 ${remaining} 个没听` : ''
                }</p>
                <div class="hero-actions" style="justify-content:center;margin-top:18px">
                    ${
                        remaining > 0
                            ? `<a class="btn btn-primary" href="#/dictation/${session.id}">继续听写（还剩 ${remaining} 个）</a>`
                            : '<a class="btn btn-primary" href="#/today">明天继续</a>'
                    }
                    <a class="btn" href="#/words?status=wrong">看看易错词</a>
                </div>
            </div>

            <div class="result-grid">
                <div class="stat-tile"><b>${correct}</b><span>记住的词</span></div>
                <div class="stat-tile"><b>${wrong}</b><span>需要再练</span></div>
                <div class="stat-tile"><b>${pct(score)}</b><span>本次正确率</span></div>
            </div>

            ${
                session.lang === 'en'
                    ? ''
                    : `<div class="card card-pad">
                <div class="section-head" style="margin-bottom:12px">
                    <div><h2>本次易错字</h2><p>点一个字单独练，或者生成默写单多写几遍。</p></div>
                    <span class="badge ${wrongChars.length ? 'badge-coral' : 'badge-jade'}">${wrongChars.length} 个字</span>
                </div>
                ${
                    wrongChars.length
                        ? `<div class="char-stat-row">${wrongChars
                              .map(
                                  (entry) => `
                              <button class="char-stat" type="button" data-result-char="${escapeHtml(entry.char)}">
                                  <b>${escapeHtml(entry.char)}</b><span>错 ${entry.count} 次</span>
                              </button>`,
                              )
                              .join('')}</div>
                          <div class="row wrap" style="margin-top:14px">
                              <button class="btn btn-primary" id="result-char-sheet" type="button">再默写一遍</button>
                              <a class="btn" href="#/chars">打开易错字本</a>
                          </div>`
                        : '<p class="muted small" style="margin:0">这次没有标红的字。</p>'
                }
            </div>`
            }

            <div class="card card-pad">
                <div class="section-head" style="margin-bottom:12px">
                    <div><h2>每个词的去向</h2><p>答对的词会拉长间隔，答错的词明天回来。</p></div>
                    <span class="badge badge-jade">${total} 个词</span>
                </div>
                <div class="result-list">${rows || '<p class="muted">这次没有词。</p>'}</div>
            </div>
        </div>`;

    root.querySelectorAll('[data-result-char]').forEach((button) => {
        button.addEventListener('click', () => {
            const entry = wrongChars.find((item) => item.char === button.dataset.resultChar);
            if (entry) openCharPractice(entry, { settings: ctx.store.settings });
        });
    });
    root.querySelector('#result-char-sheet')?.addEventListener('click', () => {
        openCharSheet(wrongChars, {
            title: '本次易错字默写单',
            subtitle: `共 ${wrongChars.length} 个字，每个字写 3 遍。`,
            settings: ctx.store.settings,
        });
    });

    Promise.resolve(ctx.refresh?.()).catch(() => {});
}

function renderGrading(root, ctx, session) {
    const total = session.total || session.items.length || 0;
    const heard = loadHeard(session.id);
    if (!heard.size) {
        // 兼容旧版本：没有“听过”记录时，按保存的进度兜底；
        // 部分批改过的会话，第一个没批改的词之前的词都已经听过
        const firstPending = session.items.findIndex((item) => !item.result);
        const rawSaved = localStorage.getItem(`mt-dictation-${session.id}`);
        const saved = Number(rawSaved);
        const hasSaved = rawSaved !== null && Number.isInteger(saved) && saved >= 0;
        if (hasSaved || firstPending > 0) {
            const baseline = Math.max(hasSaved ? saved : 0, firstPending > 0 ? firstPending - 1 : 0);
            for (let i = 0; i <= Math.min(baseline, session.items.length - 1); i += 1) {
                heard.add(session.items[i].word.id);
            }
        } else {
            // 完全没有听写记录时，保持旧行为：全部词都可批改
            for (const item of session.items) heard.add(item.word.id);
        }
    }

    const heardCount = session.items.filter((item) => heard.has(item.word.id)).length;
    // 只批改“听过、还没批改”的词
    const gradingItems = session.items.filter((item) => heard.has(item.word.id) && !item.result);
    const gradedCount = session.items.filter((item) => item.result).length;
    const unheardCount = Math.max(0, total - heardCount);

    if (!gradingItems.length) {
        root.innerHTML = `
            <div class="review-page fade-up">
                <div class="review-head">
                    <div>
                        <div class="eyebrow">听写批改 · ${escapeHtml(fmtDateCN(session.date || todayStr()))}</div>
                        <h1>${unheardCount ? '听过的词都批改完了' : '没有可以批改的词'}</h1>
                        <p>${
                            unheardCount
                                ? `还有 ${unheardCount} 个词没听，继续听写后再来批改吧。`
                                : '先去听写几个词，再回来批改。'
                        }</p>
                    </div>
                    <div class="row wrap">
                        <a class="btn btn-sm" href="#/today">回到今日</a>
                    </div>
                </div>
                <div class="empty">
                    <div class="empty-emoji">${unheardCount ? '🎧' : '✅'}</div>
                    <h3>${unheardCount ? '接着听写剩下的词' : '没有可以批改的词'}</h3>
                    <p>${unheardCount ? `还剩 ${unheardCount} 个词没听。` : '这次听写还没有听过的词。'}</p>
                    <div class="row wrap" style="justify-content:center">
                        <a class="btn btn-primary" href="#/dictation/${session.id}">继续听写</a>
                        <a class="btn" href="#/today">回到今日</a>
                    </div>
                </div>
            </div>`;
        return;
    }

    const state = new Map();
    for (const item of gradingItems) {
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
                    <p>只批改已经听过的词，没听过的不会算分。默认全部算对；点单个字只标这个字，点词的空白处会把整词所有字都标红，再点一次可以取消。</p>
                </div>
                <div class="row wrap">
                    <a class="btn btn-sm" href="#/dictation/${session.id}">继续听写</a>
                    <a class="btn btn-sm btn-ghost" href="#/today">稍后再改</a>
                </div>
            </div>

            <div class="legend-row">
                <span class="legend-item"><span class="badge badge-jade">✓ 记住了</span></span>
                <span class="legend-item"><span class="badge badge-coral">✕ 没记住</span></span>
                <span class="legend-item">本次批改 <b>${gradingItems.length}</b> 个</span>
                <span class="legend-item">已听 <b>${heardCount}</b> / ${total} 个</span>
                ${gradedCount ? `<span class="legend-item">之前已批改 ${gradedCount} 个</span>` : ''}
                ${unheardCount ? `<span class="legend-item">还有 ${unheardCount} 个没听，不计入本次</span>` : ''}
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
        grid.innerHTML = gradingItems.map((item) => reviewCard(item, state)).join('');
        let correct = 0;
        let wrong = 0;
        let chars = 0;
        for (const item of gradingItems) {
            if (isWrong(state, item.word.id)) wrong += 1;
            else correct += 1;
            const st = state.get(item.word.id);
            if (!st) continue;
            // 整词标红时所有字都算标红
            if (st.whole) chars += item.word.lang === 'en' ? 0 : Array.from(item.word.text).length;
            else chars += st.chars.size;
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
        } else if (st.whole) {
            // 再点一次空白处取消整词标红
            st.whole = false;
            st.chars.clear();
        } else {
            // 点词的空白处：整个词都算错，所有字一起标红
            st.whole = true;
            st.chars.clear();
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
        const items = gradingItems.map((item) => {
            const st = stateOf(state, item.word.id);
            const wrong = st.whole || st.chars.size > 0;
            return {
                wordId: item.word.id,
                result: wrong ? 'wrong' : 'correct',
                charsWrong: wrongCharIndexes(item.word, st),
            };
        });
        try {
            const result = await api.post(`/api/sessions/${session.id}/submit`, { items });

            // 已经批改过的词，不再保留听写时的标红
            const marks = loadMarks(session.id);
            for (const item of gradingItems) marks.delete(item.word.id);
            saveMarks(session.id, marks);

            const gradedIds = new Set(gradingItems.map((item) => item.word.id));
            const batchItems = result.items.filter((item) => gradedIds.has(item.word.id));
            const batchCorrect = batchItems.filter((item) => item.result === 'correct').length;
            const batchWrong = batchItems.filter((item) => item.result === 'wrong').length;
            const remaining = result.remaining || 0;

            if (result.status === 'done') {
                clearMarks(session.id);
                toast(`提交成功：答对 ${batchCorrect} 个，没记住 ${batchWrong} 个`, 'success');
                renderResult(root, ctx, result);
            } else {
                toast(
                    `本次批改：记住 ${batchCorrect} 个，没记住 ${batchWrong} 个，还剩 ${remaining} 个没听`,
                    'success',
                );
                renderResult(
                    root,
                    ctx,
                    { ...result, total: batchItems.length, correct: batchCorrect, wrong: batchWrong, items: batchItems },
                    { remaining },
                );
            }
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
