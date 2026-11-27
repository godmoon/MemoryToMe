import { api } from '../api.js';
import { openCharPractice } from '../char-sheet.js';
import {
    addDays,
    bindDragSelect,
    debounce,
    dueClass,
    dueText,
    escapeHtml,
    fmtDateCN,
    speak,
    statusBadge,
    toast,
    todayStr,
    confirmDialog,
    openModal,
} from '../utils.js';

const FILTERS = [
    ['all', '全部'],
    ['due', '今天复习'],
    ['wrong', '易错词'],
    ['new', '未学习'],
    ['learning', '学习中'],
    ['review', '复习中'],
    ['mastered', '已掌握'],
    ['suspended', '已暂停'],
];

const SORTS = [
    ['due', '按复习时间'],
    ['recent', '最近加入'],
    ['wrong', '错误最多'],
    ['accuracy', '正确率最低'],
    ['reviews', '练习最多'],
    ['text', '按拼音排序'],
];

function parseListParams() {
    const raw = location.hash.split('?')[1] || '';
    const params = new URLSearchParams(raw);
    return {
        q: params.get('q') || '',
        status: FILTERS.some(([key]) => key === params.get('status')) ? params.get('status') : 'all',
        lang: ['zh', 'en'].includes(params.get('lang')) ? params.get('lang') : '',
        sort: SORTS.some(([key]) => key === params.get('sort')) ? params.get('sort') : 'due',
        page: Math.max(1, Number(params.get('page')) || 1),
    };
}

function writeListParams(state) {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.status !== 'all') params.set('status', state.status);
    if (state.lang) params.set('lang', state.lang);
    if (state.sort !== 'due') params.set('sort', state.sort);
    if (state.page > 1) params.set('page', String(state.page));
    const query = params.toString();
    history.replaceState(null, '', `#/words${query ? `?${query}` : ''}`);
}

function recentStrip(word) {
    let html = '';
    for (let i = 13; i >= 0; i -= 1) {
        const date = addDays(todayStr(), -i);
        const result = word.recent?.[date] || '';
        const label = result === 'correct' ? '记住了' : result === 'wrong' ? '写错了' : '没听写';
        html += `<i class="${result}" title="${date} ${label}"></i>`;
    }
    return html;
}

function wordCard(word, { batch = false, selected = false } = {}) {
    const isEn = word.lang === 'en';
    const sub = isEn ? word.meaning : word.pinyin;
    const practice = word.correctCount + word.wrongCount;
    return `
        <article class="word-card ${batch ? 'selectable' : ''} ${selected ? 'selected' : ''}" data-id="${word.id}" tabindex="0" role="${batch ? 'checkbox' : 'button'}" ${
            batch ? `aria-checked="${selected}"` : ''
        } aria-label="${batch ? '选择' : '查看'} ${escapeHtml(word.text)}">
            <div class="word-card-top">
                ${batch ? '<span class="select-box" aria-hidden="true"></span>' : ''}
                <div class="word-title">
                    <div class="word-hz ${isEn ? 'en' : ''}">${escapeHtml(word.text)}</div>
                    ${sub ? `<div class="word-pinyin">${escapeHtml(sub)}</div>` : ''}
                </div>
                <div class="word-badges">
                    ${statusBadge(word)}
                    ${word.advanceRank > 0 ? '<span class="badge badge-blue">已提前</span>' : ''}
                    ${word.wrongCount > 0 ? `<span class="badge badge-coral">错 ${word.wrongCount}</span>` : ''}
                </div>
            </div>
            <div class="row-between">
                <div class="word-stats">
                    <span>练 <b>${practice}</b> 次</span>
                    <span>正确率 <b>${practice ? `${word.accuracy}%` : '—'}</b></span>
                </div>
                <div class="mini-strip" title="最近 14 天">${recentStrip(word)}</div>
            </div>
            <div class="word-due">
                <span>${escapeHtml(word.category || '自定义')} · ${escapeHtml(dueText(word))}</span>
                <span class="badge ${dueClass(word)}">${word.dueDate ? escapeHtml(fmtDateCN(word.dueDate, false)) : '未安排'}</span>
            </div>
        </article>`;
}

function emptyState(state) {
    if (state.q || state.status !== 'all' || state.lang) {
        return `
            <div class="empty">
                <div class="empty-emoji">🔍</div>
                <h3>没有找到符合条件的词</h3>
                <p>换个关键词，或者清除筛选再看看。</p>
                <button class="btn" id="clear-filters">清除筛选</button>
            </div>`;
    }
    return `
        <div class="empty">
            <div class="empty-emoji">📚</div>
            <h3>词库还是空的</h3>
            <p>可以粘贴自己的词，也可以从统编版教材里挑一册导入。</p>
            <div class="row wrap" style="justify-content:center">
                <a class="btn btn-primary" href="#/import?tab=textbook">从教材导入</a>
                <a class="btn" href="#/import?tab=paste">粘贴词语</a>
            </div>
        </div>`;
}

function wordForm(word = null) {
    const isEdit = !!word;
    const lang = word?.lang || 'zh';
    return `
        <h2>${isEdit ? '编辑词语' : '添加词语'}</h2>
        <p class="modal-sub">${isEdit ? '改完记得保存。' : '拼音留空会自动生成；英文可以填中文释义。'}</p>
        <div class="stack" style="gap:14px">
            <div class="field">
                <span class="field-label">语言</span>
                <div class="segmented" id="form-lang">
                    <button type="button" data-lang="zh" class="${lang === 'zh' ? 'active' : ''}">中文</button>
                    <button type="button" data-lang="en" class="${lang === 'en' ? 'active' : ''}">英文</button>
                </div>
            </div>
            <div class="field">
                <label for="form-text">词语</label>
                <input class="input" id="form-text" value="${escapeHtml(word?.text || '')}" placeholder="例如：春天 / apple" autocomplete="off">
            </div>
            <div class="field" id="form-pinyin-field" style="${lang === 'en' ? 'display:none' : ''}">
                <label for="form-pinyin">拼音（可留空）</label>
                <input class="input" id="form-pinyin" value="${escapeHtml(word?.pinyin || '')}" placeholder="chūn tiān" autocomplete="off">
            </div>
            <div class="field">
                <label for="form-meaning">释义 / 备注</label>
                <input class="input" id="form-meaning" value="${escapeHtml(word?.meaning || '')}" placeholder="${lang === 'en' ? '苹果' : '可选'}" autocomplete="off">
            </div>
            <div class="field">
                <label for="form-category">分类</label>
                <input class="input" id="form-category" value="${escapeHtml(word?.category || '自定义')}" placeholder="自定义">
            </div>
            ${isEdit ? `<div class="field"><label for="form-note">学习笔记</label><textarea class="textarea" id="form-note" style="min-height:90px" placeholder="例如：右边容易多写一横">${escapeHtml(word?.note || '')}</textarea></div>` : ''}
            <p class="small muted" id="form-error" style="margin:0;color:var(--coral)"></p>
        </div>
        <div class="modal-actions">
            <button class="btn btn-ghost" data-cancel>取消</button>
            <button class="btn btn-primary" data-save>${isEdit ? '保存修改' : '添加到词库'}</button>
        </div>`;
}

function openWordForm({ word = null, onSaved } = {}) {
    openModal(wordForm(word), {
        onMount(panel, close) {
            let lang = word?.lang || 'zh';
            const textInput = panel.querySelector('#form-text');
            const pinyinField = panel.querySelector('#form-pinyin-field');
            const meaningInput = panel.querySelector('#form-meaning');
            const errorNode = panel.querySelector('#form-error');
            const saveButton = panel.querySelector('[data-save]');

            panel.querySelectorAll('#form-lang button').forEach((button) => {
                button.addEventListener('click', () => {
                    lang = button.dataset.lang;
                    panel.querySelectorAll('#form-lang button').forEach((item) => item.classList.toggle('active', item === button));
                    pinyinField.style.display = lang === 'en' ? 'none' : '';
                    meaningInput.placeholder = lang === 'en' ? '苹果' : '可选';
                });
            });

            panel.querySelector('[data-cancel]').addEventListener('click', close);

            const submit = async () => {
                const text = textInput.value.trim();
                if (!text) {
                    errorNode.textContent = '先写一个词语吧。';
                    textInput.focus();
                    return;
                }
                saveButton.disabled = true;
                saveButton.textContent = '正在保存…';
                errorNode.textContent = '';
                const body = {
                    text,
                    lang,
                    pinyin: lang === 'zh' ? panel.querySelector('#form-pinyin').value.trim() : '',
                    meaning: meaningInput.value.trim(),
                    category: panel.querySelector('#form-category').value.trim() || '自定义',
                };
                if (word) body.note = panel.querySelector('#form-note')?.value.trim() || '';
                try {
                    const saved = word
                        ? await api.patch(`/api/words/${word.id}`, body)
                        : await api.post('/api/words', body);
                    close();
                    toast(word ? '修改好了' : '已经加入词库', 'success');
                    await onSaved?.(saved);
                } catch (error) {
                    errorNode.textContent = error.message;
                    saveButton.disabled = false;
                    saveButton.textContent = word ? '保存修改' : '添加到词库';
                }
            };

            saveButton.addEventListener('click', submit);
            panel.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.shiftKey && event.target.tagName !== 'TEXTAREA') {
                    event.preventDefault();
                    submit();
                }
            });
            setTimeout(() => textInput.focus(), 40);
        },
    });
}

export async function render(root, ctx) {
    const state = parseListParams();

    root.innerHTML = `
        <div class="fade-up">
            <div class="section-head">
                <div>
                    <h1 class="page-title">我的词库</h1>
                    <p class="page-sub">每个词都记得自己什么时候该回来复习。</p>
                </div>
                <div class="row wrap">
                    <button class="btn" id="batch-mode" type="button">批量管理</button>
                    <button class="btn btn-primary" id="add-word">+ 添加词语</button>
                </div>
            </div>

            <div class="toolbar">
                <div class="search-box">
                    <input id="search" value="${escapeHtml(state.q)}" placeholder="搜词语、拼音或释义…" autocomplete="off">
                </div>
                <select class="select" id="sort" style="width:auto;min-width:150px">
                    ${SORTS.map(([key, label]) => `<option value="${key}" ${state.sort === key ? 'selected' : ''}>${label}</option>`).join('')}
                </select>
                <div class="segmented" id="lang-filter">
                    <button data-lang="" class="${state.lang === '' ? 'active' : ''}">全部</button>
                    <button data-lang="zh" class="${state.lang === 'zh' ? 'active' : ''}">中文</button>
                    <button data-lang="en" class="${state.lang === 'en' ? 'active' : ''}">英文</button>
                </div>
            </div>

            <div class="filter-row" id="filters">
                ${FILTERS.map(
                    ([key, label]) => `<button class="chip chip-btn ${state.status === key ? 'active' : ''}" data-status="${key}">${label}</button>`,
                ).join('')}
            </div>

            <div class="row-between" id="list-meta" style="margin-bottom:12px">
                <span class="small muted" id="result-count">正在翻词库…</span>
                <span class="small muted" id="result-page"></span>
            </div>

            <div class="word-grid" id="word-grid">
                <div class="card card-pad skeleton" style="height:150px"></div>
                <div class="card card-pad skeleton" style="height:150px"></div>
                <div class="card card-pad skeleton" style="height:150px"></div>
                <div class="card card-pad skeleton" style="height:150px"></div>
            </div>

            <div class="pager" id="pager"></div>
        </div>

        <div class="batch-bar" id="batch-bar">
            <div class="batch-count" id="batch-count">点词卡选择</div>
            <div class="batch-actions">
                <button class="btn btn-sm" id="batch-select-page" type="button">全选本页</button>
                <button class="btn btn-sm" id="batch-select-all" type="button">全选筛选</button>
                <button class="btn btn-sm" id="batch-pick" type="button" title="粘贴词语，一行一个，批量选中">输入选词</button>
                <button class="btn btn-sm btn-ghost" id="batch-clear" type="button">清除</button>
                <button class="btn btn-sm btn-primary" id="batch-advance" type="button" data-batch-action disabled title="按列表顺序排到下次听写的最前面">提前复习</button>
                <button class="btn btn-sm" id="batch-reset" type="button" data-batch-action disabled>重置进度</button>
                <button class="btn btn-sm" id="batch-pause" type="button" data-batch-action disabled>暂停</button>
                <button class="btn btn-sm btn-coral" id="batch-delete" type="button" data-batch-action disabled>删除</button>
                <button class="btn btn-sm btn-ghost" id="batch-exit" type="button">完成</button>
            </div>
        </div>`;

    const searchInput = root.querySelector('#search');
    const grid = root.querySelector('#word-grid');
    const pager = root.querySelector('#pager');
    const countNode = root.querySelector('#result-count');
    const pageNode = root.querySelector('#result-page');
    const pageShell = root.querySelector('.fade-up');
    const batchBar = root.querySelector('#batch-bar');
    const batchCount = root.querySelector('#batch-count');
    const batchPause = root.querySelector('#batch-pause');

    let batchMode = false;
    let batchBusy = false;
    let currentItems = [];
    let listTotal = 0;
    const selected = new Set();
    const selectedMeta = new Map();

    function isSuspended(word) {
        return word.status === 'suspended' || word.archived;
    }

    function syncCards() {
        grid.querySelectorAll('.word-card').forEach((card) => {
            const id = Number(card.dataset.id);
            const on = selected.has(id);
            card.classList.toggle('selected', on);
            card.setAttribute('aria-checked', String(on));
        });
    }

    function updateBatchBar() {
        const count = selected.size;
        batchCount.innerHTML = count ? `<b>${count}</b> 个已选` : '点词卡选择';
        root.querySelectorAll('[data-batch-action]').forEach((button) => {
            button.disabled = count === 0;
        });
        const allSuspended =
            count > 0 && [...selected].every((id) => selectedMeta.get(id)?.suspended === true);
        batchPause.textContent = allSuspended ? '恢复学习' : '暂停';
        batchPause.dataset.mode = allSuspended ? 'resume' : 'suspend';
        const pageAll = currentItems.length > 0 && currentItems.every((word) => selected.has(word.id));
        const selectPage = root.querySelector('#batch-select-page');
        selectPage.textContent = pageAll ? '取消本页' : '全选本页';
        selectPage.disabled = currentItems.length === 0;
        root.querySelector('#batch-select-all').disabled = listTotal === 0;
        root.querySelector('#batch-clear').disabled = count === 0;
    }

    function toggleSelect(word) {
        if (selected.has(word.id)) {
            selected.delete(word.id);
            selectedMeta.delete(word.id);
        } else {
            selected.add(word.id);
            selectedMeta.set(word.id, { suspended: isSuspended(word) });
        }
        syncCards();
        updateBatchBar();
    }

    function clearSelection() {
        selected.clear();
        selectedMeta.clear();
        if (batchMode) {
            syncCards();
            updateBatchBar();
        }
    }

    function setBatchMode(on) {
        batchMode = on;
        if (!on) {
            selected.clear();
            selectedMeta.clear();
        }
        pageShell.classList.toggle('batch-mode', on);
        batchBar.classList.toggle('show', on);
        const button = root.querySelector('#batch-mode');
        button.textContent = on ? '完成' : '批量管理';
        button.classList.toggle('btn-primary', on);
        if (currentItems.length) {
            grid.innerHTML = currentItems.map((word) => wordCard(word, { batch: on, selected: selected.has(word.id) })).join('');
        }
        updateBatchBar();
    }

    function queryParams(extra = {}) {
        const params = new URLSearchParams({
            page: String(state.page),
            limit: '30',
            sort: state.sort,
            status: state.status,
            ...extra,
        });
        if (state.q) params.set('q', state.q);
        if (state.lang) params.set('lang', state.lang);
        if (state.status === 'suspended') params.set('includeArchived', '1');
        return params;
    }

    async function load() {
        writeListParams(state);
        const params = queryParams();

        grid.innerHTML = `
            <div class="card card-pad skeleton" style="height:150px"></div>
            <div class="card card-pad skeleton" style="height:150px"></div>
            <div class="card card-pad skeleton" style="height:150px"></div>
            <div class="card card-pad skeleton" style="height:150px"></div>`;

        try {
            const data = await api.get(`/api/words?${params.toString()}`);
            if (!data.items.length && data.total > 0 && state.page > data.pages) {
                state.page = data.pages;
                return load();
            }
            countNode.textContent = `共 ${data.total} 个词`;
            pageNode.textContent = data.total ? `第 ${data.page} / ${data.pages} 页` : '';
            currentItems = data.items;
            listTotal = data.total;
            for (const word of data.items) {
                if (selected.has(word.id)) selectedMeta.set(word.id, { suspended: isSuspended(word) });
            }
            if (!data.items.length) {
                grid.innerHTML = `<div style="grid-column:1/-1">${emptyState(state)}</div>`;
                pager.innerHTML = '';
                updateBatchBar();
                root.querySelector('#clear-filters')?.addEventListener('click', () => {
                    state.q = '';
                    state.status = 'all';
                    state.lang = '';
                    state.page = 1;
                    searchInput.value = '';
                    root.querySelectorAll('#filters .chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.status === 'all'));
                    root.querySelectorAll('#lang-filter button').forEach((button) => button.classList.toggle('active', button.dataset.lang === ''));
                    load();
                });
                return;
            }
            grid.innerHTML = data.items
                .map((word) => wordCard(word, { batch: batchMode, selected: selected.has(word.id) }))
                .join('');
            updateBatchBar();
            pager.innerHTML = `
                <button class="btn btn-sm" id="prev-page" ${data.page <= 1 ? 'disabled' : ''}>← 上一页</button>
                <span class="small muted">第 ${data.page} / ${data.pages} 页</span>
                <button class="btn btn-sm" id="next-page" ${data.page >= data.pages ? 'disabled' : ''}>下一页 →</button>`;
            pager.querySelector('#prev-page')?.addEventListener('click', () => {
                if (state.page > 1) {
                    state.page -= 1;
                    load();
                    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
            pager.querySelector('#next-page')?.addEventListener('click', () => {
                if (state.page < data.pages) {
                    state.page += 1;
                    load();
                    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        } catch (error) {
            countNode.textContent = '';
            grid.innerHTML = `<div style="grid-column:1/-1"><div class="empty"><div class="empty-emoji">🫠</div><h3>词库没有打开</h3><p>${escapeHtml(error.message)}</p><button class="btn" onclick="location.reload()">刷新试试</button></div></div>`;
            pager.innerHTML = '';
        }
    }

    searchInput.addEventListener(
        'input',
        debounce(() => {
            state.q = searchInput.value.trim();
            state.page = 1;
            clearSelection();
            load();
        }, 320),
    );

    root.querySelector('#sort').addEventListener('change', (event) => {
        state.sort = event.target.value;
        state.page = 1;
        load();
    });

    root.querySelector('#filters').addEventListener('click', (event) => {
        const button = event.target.closest('[data-status]');
        if (!button) return;
        state.status = button.dataset.status;
        state.page = 1;
        clearSelection();
        root.querySelectorAll('#filters .chip').forEach((chip) => chip.classList.toggle('active', chip === button));
        load();
    });

    root.querySelector('#lang-filter').addEventListener('click', (event) => {
        const button = event.target.closest('[data-lang]');
        if (!button) return;
        state.lang = button.dataset.lang;
        state.page = 1;
        clearSelection();
        root.querySelectorAll('#lang-filter button').forEach((item) => item.classList.toggle('active', item === button));
        load();
    });

    grid.addEventListener('click', (event) => {
        const card = event.target.closest('.word-card');
        if (!card) return;
        if (batchMode) {
            const word = currentItems.find((item) => item.id === Number(card.dataset.id));
            if (word) toggleSelect(word);
            return;
        }
        ctx.navigate(`#/words/${card.dataset.id}`);
    });
    grid.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const card = event.target.closest('.word-card');
        if (!card) return;
        event.preventDefault();
        if (batchMode) {
            const word = currentItems.find((item) => item.id === Number(card.dataset.id));
            if (word) toggleSelect(word);
            return;
        }
        ctx.navigate(`#/words/${card.dataset.id}`);
    });

    bindDragSelect(grid, {
        itemSelector: '.word-card',
        canSelect: () => batchMode,
        isSelected: (el) => selected.has(Number(el.dataset.id)),
        setSelected: (el, on) => {
            const id = Number(el.dataset.id);
            const word = currentItems.find((item) => item.id === id);
            if (!word) return;
            if (on) {
                selected.add(id);
                selectedMeta.set(id, { suspended: isSuspended(word) });
            } else {
                selected.delete(id);
                selectedMeta.delete(id);
            }
            el.classList.toggle('selected', on);
            el.setAttribute('aria-checked', String(on));
        },
        onUpdate: updateBatchBar,
    });

    root.querySelector('#batch-mode').addEventListener('click', () => {
        setBatchMode(!batchMode);
    });

    root.querySelector('#batch-exit').addEventListener('click', () => {
        setBatchMode(false);
    });

    root.querySelector('#batch-select-page').addEventListener('click', () => {
        const all = currentItems.length > 0 && currentItems.every((word) => selected.has(word.id));
        for (const word of currentItems) {
            if (all) {
                selected.delete(word.id);
                selectedMeta.delete(word.id);
            } else {
                selected.add(word.id);
                selectedMeta.set(word.id, { suspended: isSuspended(word) });
            }
        }
        syncCards();
        updateBatchBar();
    });

    root.querySelector('#batch-select-all').addEventListener('click', async () => {
        try {
            const data = await api.get(`/api/words?${queryParams({ idsOnly: '1' }).toString()}`);
            for (const item of data.items) {
                selected.add(item.id);
                selectedMeta.set(item.id, { suspended: item.status === 'suspended' || !!item.archived });
            }
            syncCards();
            updateBatchBar();
            toast(`已选择当前筛选结果中的 ${data.items.length} 个词`, 'success');
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    root.querySelector('#batch-pick').addEventListener('click', () => {
        openModal(
            `<h2>按词语选择</h2>
            <p class="modal-sub">一行一个词语，会匹配词库里已有的词；英文不区分大小写，匹配到的词会加入当前选择。</p>
            <div class="field">
                <textarea class="textarea" id="pick-text" style="min-height:170px" placeholder="春天
柳树
apple"></textarea>
            </div>
            <p class="small muted" id="pick-error" style="margin:10px 0 0;color:var(--coral)"></p>
            <div class="modal-actions">
                <button class="btn btn-ghost" data-cancel>取消</button>
                <button class="btn btn-primary" data-pick>选择</button>
            </div>`,
            {
                onMount(panel, close) {
                    const textarea = panel.querySelector('#pick-text');
                    const errorNode = panel.querySelector('#pick-error');
                    const pickButton = panel.querySelector('[data-pick]');

                    panel.querySelector('[data-cancel]').addEventListener('click', close);
                    textarea.addEventListener('input', () => {
                        errorNode.textContent = '';
                    });

                    const submit = async () => {
                        const texts = [...new Set(
                            textarea.value
                                .split(/\r?\n/)
                                .map((line) => line.trim())
                                .filter(Boolean),
                        )];
                        if (!texts.length) {
                            errorNode.textContent = '先粘贴一些词语吧。';
                            textarea.focus();
                            return;
                        }
                        pickButton.disabled = true;
                        pickButton.textContent = '正在匹配…';
                        errorNode.textContent = '';
                        try {
                            const result = await api.post('/api/words/match', { texts });
                            for (const item of result.items) {
                                selected.add(item.id);
                                selectedMeta.set(item.id, { suspended: item.status === 'suspended' || item.archived });
                            }
                            syncCards();
                            updateBatchBar();
                            close();
                            const missed = result.unmatched.length;
                            if (!result.items.length) {
                                toast('词库里没有找到这些词', 'error');
                            } else if (missed) {
                                toast(`已选中 ${result.items.length} 个词，${missed} 个没找到`, 'success');
                            } else {
                                toast(`已选中 ${result.items.length} 个词`, 'success');
                            }
                        } catch (error) {
                            errorNode.textContent = error.message;
                            pickButton.disabled = false;
                            pickButton.textContent = '选择';
                        }
                    };

                    pickButton.addEventListener('click', submit);
                    textarea.addEventListener('keydown', (event) => {
                        // Ctrl / Cmd + Enter 快速提交
                        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                            event.preventDefault();
                            submit();
                        }
                    });
                },
            },
        );
    });

    root.querySelector('#batch-clear').addEventListener('click', () => {
        selected.clear();
        selectedMeta.clear();
        syncCards();
        updateBatchBar();
    });

    async function runBatch(action) {
        if (batchBusy) return null;
        const ids = [...selected];
        if (!ids.length) return null;
        batchBusy = true;
        try {
            const result = await api.post('/api/words/batch', { action, ids });
            selected.clear();
            selectedMeta.clear();
            await ctx.refresh?.();
            await load();
            return result;
        } catch (error) {
            toast(error.message, 'error');
            return null;
        } finally {
            batchBusy = false;
        }
    }

    // 按列表顺序整理选中的词：页面上越靠前的词，越先复习
    function selectedInOrder() {
        const ids = [];
        const seen = new Set();
        for (const word of currentItems) {
            if (selected.has(word.id) && !seen.has(word.id)) {
                seen.add(word.id);
                ids.push(word.id);
            }
        }
        for (const id of selected) {
            if (!seen.has(id)) {
                seen.add(id);
                ids.push(id);
            }
        }
        return ids;
    }

    root.querySelector('#batch-advance').addEventListener('click', async () => {
        if (batchBusy) return;
        const ids = selectedInOrder();
        if (!ids.length) return;
        const button = root.querySelector('#batch-advance');
        batchBusy = true;
        button.disabled = true;
        button.textContent = '正在提前…';
        try {
            const result = await api.post('/api/words/batch/advance', { ids });
            // 只排队，不跳转；清空选择并刷新列表，卡片上会显示“已提前”
            selected.clear();
            selectedMeta.clear();
            syncCards();
            updateBatchBar();
            await load();
            await ctx.refresh?.();
            const skipped = result.skipped ? `，跳过 ${result.skipped} 个暂停的词` : '';
            const merged = result.sessions.filter((session) => session.added > 0);
            if (merged.length) {
                const label = merged
                    .map((session) => `${session.lang === 'en' ? '英文' : '中文'} ${session.added} 个`)
                    .join('，');
                toast(`已提前 ${label}，下次听写会先复习${skipped}`, 'success');
            } else if (result.advanced) {
                toast(`已提前 ${result.advanced} 个词，下次点“听写”会先复习${skipped}`, 'success');
            } else {
                toast(`这些词今天已经练过了${skipped}`);
            }
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            batchBusy = false;
            button.disabled = false;
            button.textContent = '提前复习';
            updateBatchBar();
        }
    });

    root.querySelector('#batch-reset').addEventListener('click', async () => {
        const count = selected.size;
        if (!count) return;
        const ok = await confirmDialog({
            title: `重置 ${count} 个词的进度？`,
            message: '这些词的听写记录、正确率和记忆阶段都会清空，但词语本身会保留。',
            confirmText: '重置进度',
            danger: true,
        });
        if (!ok) return;
        const result = await runBatch('reset');
        if (result) toast(`已重置 ${result.affected} 个词的进度`, 'success');
    });

    root.querySelector('#batch-pause').addEventListener('click', async () => {
        const action = root.querySelector('#batch-pause').dataset.mode === 'resume' ? 'resume' : 'suspend';
        const count = selected.size;
        if (!count) return;
        const result = await runBatch(action);
        if (result) {
            toast(action === 'resume' ? `已恢复 ${result.affected} 个词` : `已暂停 ${result.affected} 个词`, 'success');
        }
    });

    root.querySelector('#batch-delete').addEventListener('click', async () => {
        const count = selected.size;
        if (!count) return;
        const ok = await confirmDialog({
            title: `删除 ${count} 个词？`,
            message: '词语和它们的听写记录都会一起删除，不能恢复。建议先备份。',
            confirmText: '删除',
            danger: true,
        });
        if (!ok) return;
        const result = await runBatch('delete');
        if (result) toast(`已删除 ${result.affected} 个词`, 'success');
    });

    root.querySelector('#add-word').addEventListener('click', () => {
        openWordForm({
            onSaved: async () => {
                state.page = 1;
                await ctx.refresh?.();
                load();
            },
        });
    });

    await load();
}

/* ------------------------------- 词详情 ------------------------------- */

function timelineHTML(word) {
    const days = word.timeline?.days || [];
    const today = todayStr();
    let lastMonth = '';
    let months = '';
    days.forEach((day, index) => {
        const month = day.date.slice(0, 7);
        if (month !== lastMonth) {
            months += `<span class="timeline-month" style="left:${index * 17}px">${Number(month.slice(5))} 月</span>`;
            lastMonth = month;
        }
    });

    const cells = days
        .map((day) => {
            let cls = '';
            if (day.correct && day.wrong) cls = 'mixed';
            else if (day.wrong) cls = 'wrong';
            else if (day.correct) cls = 'correct';
            if (day.due) cls += ' due';
            if (day.added) cls += ' added';
            if (day.date === today) cls += ' today';
            const parts = [`${fmtDateCN(day.date)}：对 ${day.correct}，错 ${day.wrong}`];
            if (day.added) parts.push('加入词库');
            if (day.due) parts.push('计划复习');
            return `<button type="button" class="tl-day ${cls}" data-date="${day.date}" title="${escapeHtml(parts.join('；'))}"></button>`;
        })
        .join('');

    return `
        <div class="timeline-wrap">
            <div class="timeline-months">${months}</div>
            <div class="timeline-scroll" id="tl-scroll">
                <div class="timeline-track" style="width:${Math.max(days.length * 17, 100)}px">${cells}</div>
            </div>
            <div class="timeline-legend">
                <span class="legend-item"><span class="legend-swatch correct"></span>记住了</span>
                <span class="legend-item"><span class="legend-swatch wrong"></span>写错了</span>
                <span class="legend-item"><span class="legend-swatch due"></span>计划复习</span>
                <span class="legend-item"><span class="legend-swatch added"></span>加入词库</span>
            </div>
            <div class="timeline-tip" id="tl-tip">左右拖动看看历史；点一个小方块，看看那天的记录。</div>
        </div>`;
}

function eventList(word) {
    if (!word.events.length) {
        return '<p class="muted small">还没有听写记录。第一次听写后，这里会留下脚印。</p>';
    }
    const chars = Array.from(word.text);
    return `<ul class="event-list">${word.events
        .slice(0, 20)
        .map((event) => {
            const wrongChars = (event.charsWrong || []).map((index) => chars[index]).filter(Boolean).join('、');
            const interval = event.intervalBefore === event.intervalAfter
                ? `${event.intervalAfter} 天`
                : `${event.intervalBefore} 天 → ${event.intervalAfter} 天`;
            return `
            <li class="event-item">
                <div class="row wrap" style="gap:7px">
                    <span class="badge ${event.result === 'wrong' ? 'badge-coral' : 'badge-jade'}">${event.result === 'wrong' ? '没记住' : '记住了'}</span>
                    <span>${escapeHtml(fmtDateCN(event.date))}</span>
                    ${wrongChars ? `<span class="badge badge-coral">字：${escapeHtml(wrongChars)}</span>` : ''}
                </div>
                <span class="small muted">${interval}</span>
            </li>`;
        })
        .join('')}</ul>`;
}

export async function renderDetail(root, ctx, id) {
    root.innerHTML = `
        <div class="page-loading">
            <div class="loader"></div>
            <p>正在翻开这个词的档案…</p>
        </div>`;

    let word;
    try {
        word = await api.get(`/api/words/${id}`);
    } catch (error) {
        root.innerHTML = `
            <div class="empty">
                <div class="empty-emoji">📄</div>
                <h3>没有找到这个词</h3>
                <p>${escapeHtml(error.message)}</p>
                <a class="btn btn-primary" href="#/words">回到词库</a>
            </div>`;
        return;
    }

    const isEn = word.lang === 'en';
    const suspended = word.status === 'suspended' || word.archived;
    const sourceTitle = word.sourceInfo?.title || '';
    const wrongChars = (word.chars || []).filter((char) => char.wrong > 0);
    const todayIndex = (word.timeline?.days || []).findIndex((day) => day.date === todayStr());

    root.innerHTML = `
        <div class="stack fade-up">
            <div class="row-between wrap">
                <a class="btn btn-sm btn-ghost" href="#/words">← 返回词库</a>
                <div class="row wrap">
                    <button class="btn btn-sm" id="review-now">立即复习</button>
                    <button class="btn btn-sm" id="speak-word">朗读</button>
                    <button class="btn btn-sm" id="edit-word">编辑</button>
                    <button class="btn btn-sm" id="toggle-pause">${suspended ? '恢复学习' : '暂停'}</button>
                    <button class="btn btn-sm btn-ghost" id="reset-word">重置</button>
                    <button class="btn btn-sm btn-coral" id="delete-word">删除</button>
                </div>
            </div>

            <div class="card card-pad">
                <div class="detail-head">
                    <div style="min-width:0">
                        <div class="eyebrow">${escapeHtml(word.category || '自定义')} ${sourceTitle ? `· ${escapeHtml(sourceTitle)}` : ''}</div>
                        <div class="detail-word ${isEn ? 'en' : ''}">${escapeHtml(word.text)}</div>
                        ${isEn && word.meaning ? `<div class="detail-pinyin">${escapeHtml(word.meaning)}</div>` : ''}
                        ${!isEn && word.pinyin ? `<div class="detail-pinyin">${escapeHtml(word.pinyin)}</div>` : ''}
                        <div class="row wrap" style="margin-top:12px;gap:7px">
                            ${statusBadge(word)}
                            ${word.dueDate ? `<span class="badge ${dueClass(word)}">下次：${escapeHtml(dueText(word))}</span>` : ''}
                            <span class="badge">加入于 ${escapeHtml(fmtDateCN(word.firstSeen || word.createdAt?.slice(0, 10)))}</span>
                        </div>
                    </div>
                    <div class="detail-stats" style="margin-top:0;min-width:min(360px,100%)">
                        <div class="stat-tile"><b>${word.stats.reviews}</b><span>听写次数</span></div>
                        <div class="stat-tile"><b>${word.stats.accuracy == null ? '—' : `${word.stats.accuracy}%`}</b><span>正确率</span></div>
                        <div class="stat-tile"><b>${word.streak}</b><span>连续记住</span></div>
                        <div class="stat-tile"><b>${word.stage}</b><span>记忆阶段</span></div>
                    </div>
                </div>
            </div>

            <div class="grid-2">
                <div class="card card-pad">
                    <div class="section-head" style="margin-bottom:6px">
                        <div><h2>时间线</h2><p>红绿方块是每次听写的结果，蓝色边框是加入词库的那天。</p></div>
                    </div>
                    ${timelineHTML(word)}
                </div>

                <div class="stack">
                    <div class="card card-pad">
                        <div class="section-head" style="margin-bottom:8px">
                            <div><h2>易错字</h2><p>点一个字可以单独练，看看它还出现在哪些词里。</p></div>
                            <a class="chip chip-btn" href="#/chars">全部 →</a>
                        </div>
                        ${
                            wrongChars.length
                                ? `<div class="char-stat-row">${wrongChars
                                      .map(
                                          (char) => `
                                      <button class="char-stat" type="button" data-char="${escapeHtml(char.char)}">
                                          <b>${escapeHtml(char.char)}</b><span>错 ${char.wrong} 次</span>
                                      </button>`,
                                      )
                                      .join('')}</div>`
                                : '<p class="muted small" style="margin:0">还没有被点红的字。</p>'
                        }
                    </div>

                    <div class="card card-pad">
                        <div class="section-head" style="margin-bottom:8px">
                            <div><h2>学习笔记</h2><p>自己的小提醒，比任何解释都管用。</p></div>
                        </div>
                        <p class="small" style="margin:0;white-space:pre-wrap">${word.note ? escapeHtml(word.note) : '<span class="muted">还没有笔记。点“编辑”可以写一句提醒。</span>'}</p>
                        ${word.meaning ? `<div class="divider"></div><p class="small muted" style="margin:0">释义：${escapeHtml(word.meaning)}</p>` : ''}
                    </div>
                </div>
            </div>

            <div class="card card-pad">
                <div class="section-head" style="margin-bottom:10px">
                    <div><h2>听写记录</h2><p>最近 20 次，时间倒序。</p></div>
                    <span class="badge badge-jade">${word.stats.reviews} 次</span>
                </div>
                ${eventList(word)}
            </div>
        </div>`;

    const scroll = root.querySelector('#tl-scroll');
    if (scroll) {
        if (todayIndex >= 0) {
            scroll.scrollLeft = Math.max(0, todayIndex * 17 - scroll.clientWidth / 2);
        }
        let dragging = false;
        let moved = false;
        let startX = 0;
        let startLeft = 0;
        scroll.addEventListener('pointerdown', (event) => {
            dragging = true;
            moved = false;
            startX = event.clientX;
            startLeft = scroll.scrollLeft;
            scroll.classList.add('dragging');
            scroll.setPointerCapture?.(event.pointerId);
        });
        scroll.addEventListener('pointermove', (event) => {
            if (!dragging) return;
            const delta = event.clientX - startX;
            if (Math.abs(delta) > 5) moved = true;
            scroll.scrollLeft = startLeft - delta;
        });
        const endDrag = () => {
            dragging = false;
            scroll.classList.remove('dragging');
        };
        scroll.addEventListener('pointerup', endDrag);
        scroll.addEventListener('pointercancel', endDrag);
        scroll.addEventListener('pointerleave', () => {
            if (dragging) endDrag();
        });

        const tip = root.querySelector('#tl-tip');
        const dayMap = new Map((word.timeline?.days || []).map((day) => [day.date, day]));
        scroll.addEventListener('click', (event) => {
            if (moved) {
                moved = false;
                return;
            }
            const cell = event.target.closest('.tl-day');
            if (!cell) return;
            const day = dayMap.get(cell.dataset.date);
            if (!day || !tip) return;
            const parts = [`${fmtDateCN(day.date)}：对 ${day.correct} 次，错 ${day.wrong} 次`];
            if (day.added) parts.push('这一天加入词库');
            if (day.due) parts.push('这一天计划复习');
            if (!day.correct && !day.wrong && !day.added && !day.due) parts.push('这一天没有记录');
            tip.textContent = parts.join('；');
        });
    }

    root.querySelector('#speak-word').addEventListener('click', () => {
        speak(word.text, word.lang, ctx.store.settings?.speechRate ?? 0.85, ctx.store.settings?.voiceURI || '');
    });

    // 点易错字：看它出现在哪些词里，也可以单独练
    root.querySelectorAll('.char-stat[data-char]').forEach((button) => {
        button.addEventListener('click', async () => {
            try {
                const detail = await api.get(`/api/chars/${encodeURIComponent(button.dataset.char)}`);
                openCharPractice(detail, { settings: ctx.store.settings });
            } catch (error) {
                toast(error.message, 'error');
            }
        });
    });

    root.querySelector('#review-now').addEventListener('click', async () => {
        try {
            await api.post(`/api/words/${word.id}/review-now`, {});
            toast('已安排到今天复习', 'success');
            await ctx.refresh?.();
            await renderDetail(root, ctx, word.id);
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    root.querySelector('#edit-word').addEventListener('click', () => {
        openWordForm({
            word,
            onSaved: async () => {
                await ctx.refresh?.();
                await renderDetail(root, ctx, word.id);
            },
        });
    });

    root.querySelector('#toggle-pause').addEventListener('click', async () => {
        try {
            await api.patch(`/api/words/${word.id}`, suspended ? { status: 'learning', dueDate: todayStr() } : { status: 'suspended' });
            toast(suspended ? '已经恢复学习' : '先暂停，想学时再回来', 'success');
            await ctx.refresh?.();
            await renderDetail(root, ctx, word.id);
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    root.querySelector('#reset-word').addEventListener('click', async () => {
        const ok = await confirmDialog({
            title: '重置这个词的进度？',
            message: '听写记录和统计会一起清空，但词语本身会保留。',
            confirmText: '重置进度',
            danger: true,
        });
        if (!ok) return;
        try {
            await api.post(`/api/words/${word.id}/reset`, {});
            toast('进度已经重置', 'success');
            await ctx.refresh?.();
            await renderDetail(root, ctx, word.id);
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    root.querySelector('#delete-word').addEventListener('click', async () => {
        const ok = await confirmDialog({
            title: '删除这个词？',
            message: '词语和它的所有听写记录都会删除，不能恢复。',
            confirmText: '删除',
            danger: true,
        });
        if (!ok) return;
        try {
            await api.delete(`/api/words/${word.id}`);
            toast('已经删除', 'success');
            await ctx.refresh?.();
            ctx.navigate('#/words');
        } catch (error) {
            toast(error.message, 'error');
        }
    });
}
