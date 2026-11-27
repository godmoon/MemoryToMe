import { api } from '../api.js';
import { openCharPractice, openCharSheet } from '../char-sheet.js';
import { escapeHtml, fmtDateCN, speak, toast } from '../utils.js';

const SORTS = [
    ['count', '错得最多'],
    ['recent', '最近错的'],
    ['char', '按拼音'],
];

function sortChars(list, sort) {
    const next = [...list];
    if (sort === 'recent') {
        next.sort((a, b) => String(b.lastDate || '').localeCompare(String(a.lastDate || '')) || b.count - a.count);
    } else if (sort === 'char') {
        next.sort(
            (a, b) =>
                String(a.pinyin || '').localeCompare(String(b.pinyin || ''), 'en') ||
                a.char.localeCompare(b.char, 'zh'),
        );
    } else {
        next.sort((a, b) => b.count - a.count || String(b.lastDate || '').localeCompare(String(a.lastDate || '')));
    }
    return next;
}

function matchChars(list, query) {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
        (entry) =>
            entry.char.includes(q) ||
            String(entry.pinyin || '').toLowerCase().includes(q) ||
            (entry.words || []).some((word) => word.text.includes(q)),
    );
}

export async function render(root, ctx) {
    root.innerHTML = `
        <div class="page-loading">
            <div class="loader"></div>
            <p>正在翻易错字本…</p>
        </div>`;

    let data;
    try {
        data = await api.get('/api/chars/wrong?limit=500');
    } catch (error) {
        root.innerHTML = `
            <div class="empty">
                <div class="empty-emoji">📕</div>
                <h3>易错字本没有打开</h3>
                <p>${escapeHtml(error.message)}</p>
                <button class="btn btn-primary" onclick="location.reload()">刷新试试</button>
            </div>`;
        return;
    }

    const all = Array.isArray(data.chars) ? data.chars : [];
    const totalCount = data.totalCount || all.reduce((sum, entry) => sum + entry.count, 0);
    const top = all[0] || null;
    const byChar = new Map(all.map((entry) => [entry.char, entry]));
    const settings = ctx.store.settings || {};
    let query = '';
    let sort = 'count';

    root.innerHTML = `
        <div class="stack fade-up">
            <div class="row-between wrap">
                <div>
                    <div class="eyebrow">易错字本</div>
                    <h1 class="page-title">哪些字总写错</h1>
                    <p class="page-sub">标红过的字会按错误次数排队。点“单独练”可以听、写，也能看到它出现在哪些词里。</p>
                </div>
                <div class="row wrap">
                    <a class="btn btn-sm" href="#/words?status=wrong">易错词</a>
                    <button class="btn btn-sm btn-primary" id="chars-sheet" type="button">生成默写单</button>
                </div>
            </div>

            <div class="stat-grid">
                <div class="stat-tile"><b>${all.length}</b><span>易错字</span></div>
                <div class="stat-tile"><b>${totalCount}</b><span>总标红次数</span></div>
                <div class="stat-tile"><b>${top ? escapeHtml(top.char) : '—'}</b><span>${top ? `最常错 · ${top.count} 次` : '还没有记录'}</span></div>
            </div>

            <div class="card card-pad">
                <div class="filter-row" style="align-items:center;margin-bottom:14px">
                    <input class="input" id="chars-q" type="search" placeholder="搜字、拼音或词语" style="flex:1;min-width:180px">
                    <select class="select" id="chars-sort" style="width:auto;min-width:130px">
                        ${SORTS.map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}
                    </select>
                </div>
                <div id="chars-list"></div>
            </div>

            <p class="small muted" style="margin:0">
                小提示：批改时点单个字，只记录这个字；点词的空白处，会把整词所有字都标红。词的下次复习仍然按整词安排。
            </p>
        </div>`;

    const listNode = root.querySelector('#chars-list');
    const searchInput = root.querySelector('#chars-q');
    const sortSelect = root.querySelector('#chars-sort');

    function currentList() {
        return sortChars(matchChars(all, query), sort);
    }

    function paint() {
        const list = currentList();
        if (!list.length) {
            listNode.innerHTML = all.length
                ? `<div class="empty" style="padding:36px 16px">
                       <div class="empty-emoji">🔍</div>
                       <h3>没有找到这个字</h3>
                       <p>换一个字、拼音或词语试试。</p>
                   </div>`
                : `<div class="empty" style="padding:36px 16px">
                       <div class="empty-emoji">📕</div>
                       <h3>还没有标红的字</h3>
                       <p>批改时点具体字，或点词的空白处把整词标红，就会记录到这里。</p>
                   </div>`;
            return;
        }

        listNode.innerHTML = `<div class="char-book-grid">${list
            .map(
                (entry) => `
            <div class="card card-pad char-book-card">
                <div class="char-book-top">
                    <div class="char-book-char">${escapeHtml(entry.char)}</div>
                    <div class="char-book-meta">
                        <div class="char-book-pinyin">${entry.pinyin ? escapeHtml(entry.pinyin) : '&nbsp;'}</div>
                        <div class="small muted">
                            错 ${entry.count} 次${entry.lastDate ? ` · 最近 ${escapeHtml(fmtDateCN(entry.lastDate, false))}` : ''}
                        </div>
                    </div>
                </div>
                <div class="char-book-words">
                    ${
                        (entry.words || []).length
                            ? entry.words
                                  .slice(0, 5)
                                  .map((word) => `<a class="chip" href="#/words/${word.id}">${escapeHtml(word.text)}</a>`)
                                  .join('')
                            : '<span class="muted small">没有关联词语</span>'
                    }
                </div>
                <div class="row wrap" style="margin-top:auto">
                    <button class="btn btn-sm" type="button" data-speak-char="${escapeHtml(entry.char)}">朗读</button>
                    <button class="btn btn-sm btn-primary" type="button" data-practice-char="${escapeHtml(entry.char)}">单独练</button>
                </div>
            </div>`,
            )
            .join('')}</div>`;
    }

    listNode.addEventListener('click', (event) => {
        const speakButton = event.target.closest('[data-speak-char]');
        if (speakButton) {
            speak(speakButton.dataset.speakChar, 'zh', settings.speechRate, settings.voiceURI);
            return;
        }
        const practiceButton = event.target.closest('[data-practice-char]');
        if (practiceButton) {
            const entry = byChar.get(practiceButton.dataset.practiceChar);
            if (entry) openCharPractice(entry, { settings });
        }
    });

    searchInput.addEventListener('input', () => {
        query = searchInput.value;
        paint();
    });

    sortSelect.addEventListener('change', () => {
        sort = sortSelect.value;
        paint();
    });

    root.querySelector('#chars-sheet')?.addEventListener('click', () => {
        const list = currentList();
        if (!list.length) {
            toast('先筛选出要默写的字', 'error');
            return;
        }
        const picked = list.slice(0, 40);
        openCharSheet(picked, {
            title: '易错字默写单',
            subtitle: `共 ${picked.length} 个字，每个字写 3 遍。${list.length > picked.length ? '（一次最多 40 个，可以先筛选）' : ''}`,
            settings,
        });
    });

    paint();
}
