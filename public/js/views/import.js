import { api } from '../api.js';
import { bindDragSelect, escapeHtml, toast, confirmDialog } from '../utils.js';

const TABS = [
    ['paste', '粘贴导入'],
    ['textbook', '教材词库'],
    ['english', '英语词包'],
    ['backup', '备份与重置'],
];

const PASTE_PLACEHOLDER = {
    auto: '春天\napple,苹果\n柳树,liǔ shù\nschool,学校',
    zh: '春天\n柳树\n燕子\n或者：春天,chūn tiān',
    en: 'apple,苹果\nbanana,香蕉\n或者一行一个单词',
};

const PASTE_SAMPLE = {
    auto: '春天,chūn tiān\n柳树,liǔ shù\napple,苹果\nschool,学校\nbanana,香蕉',
    zh: '春天,chūn tiān\n柳树,liǔ shù\n燕子,yàn zi\n小溪,xiǎo xī\n桃花,táo huā',
    en: 'apple,苹果\nbanana,香蕉\norange,橙子\nschool,学校\nteacher,老师',
};

function initialTab() {
    const raw = location.hash.split('?')[1] || '';
    const tab = new URLSearchParams(raw).get('tab');
    return TABS.some(([key]) => key === tab) ? tab : 'paste';
}

export async function render(root, ctx) {
    const state = {
        tab: initialTab(),
        books: null,
        bookId: '',
        bookDetail: null,
        bookType: 'char',
        selected: { char: new Set(), word: new Set() },
        english: null,
        pasteLang: 'auto',
        preview: null,
    };

    root.innerHTML = `
        <div class="fade-up">
            <div class="section-head">
                <div>
                    <h1 class="page-title">导入词库</h1>
                    <p class="page-sub">可以粘贴自己的词，也可以从教材里挑；导入后都会按同一条记忆曲线安排复习。</p>
                </div>
            </div>
            <div class="tabs" id="import-tabs">
                ${TABS.map(
                    ([key, label]) => `<button class="tab ${state.tab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`,
                ).join('')}
            </div>
            <div id="tab-body"></div>
        </div>`;

    const body = root.querySelector('#tab-body');

    function setTab(tab) {
        state.tab = tab;
        history.replaceState(null, '', `#/import?tab=${tab}`);
        root.querySelectorAll('#import-tabs .tab').forEach((button) => {
            button.classList.toggle('active', button.dataset.tab === tab);
        });
        renderTab();
    }

    root.querySelector('#import-tabs').addEventListener('click', (event) => {
        const button = event.target.closest('[data-tab]');
        if (button) setTab(button.dataset.tab);
    });

    /* ------------------------------ 粘贴导入 ------------------------------ */

    function renderPaste() {
        body.innerHTML = `
            <div class="import-grid">
                <div class="card card-pad">
                    <div class="section-head" style="margin-bottom:14px">
                        <div><h2>把词语粘贴进来</h2><p>一行一个，或用逗号分隔；选“自动”时中英文可以混在一起。</p></div>
                        <div class="segmented" id="paste-lang">
                            <button data-lang="auto" class="${state.pasteLang === 'auto' ? 'active' : ''}">自动</button>
                            <button data-lang="zh" class="${state.pasteLang === 'zh' ? 'active' : ''}">中文</button>
                            <button data-lang="en" class="${state.pasteLang === 'en' ? 'active' : ''}">英文</button>
                        </div>
                    </div>
                    <div class="field">
                        <label for="paste-text">词语列表</label>
                        <textarea class="textarea" id="paste-text" placeholder="${PASTE_PLACEHOLDER[state.pasteLang]}"></textarea>
                    </div>
                    <div class="row wrap" style="margin-top:12px">
                        <div class="field" style="flex:1 1 180px">
                            <label for="paste-category">分类</label>
                            <input class="input" id="paste-category" value="自定义" placeholder="例如：第二单元">
                        </div>
                        <button class="btn" id="fill-sample" type="button" style="align-self:flex-end">填入示例</button>
                    </div>
                    <div class="row wrap" style="margin-top:16px">
                        <button class="btn" id="preview-btn" type="button">先预览</button>
                        <button class="btn btn-primary" id="commit-btn" type="button" disabled>导入词库</button>
                    </div>
                    <p class="small muted" style="margin:10px 0 0" id="paste-status"></p>
                </div>

                <div class="card card-pad">
                    <div class="section-head" style="margin-bottom:10px">
                        <div><h2>导入说明</h2><p>排重、自动拼音都在预览里完成。</p></div>
                    </div>
                    <ul class="help-list">
                        <li>一行一个词，自动去掉序号、引号和结尾标点。</li>
                        <li>语言选“自动”时逐行识别，中文和英文可以放在一起。</li>
                        <li>逗号分隔的多个词会拆成多个；<code>词,拼音</code> 会当成拼音。</li>
                        <li>英文写 <code>apple,苹果</code>，认词时显示中文释义。</li>
                        <li>拼音留空会自动生成，多音字可以手动改。</li>
                        <li>已经存在的词会自动跳过，不会重复添加。</li>
                    </ul>
                    <div class="divider"></div>
                    <div id="preview-box">
                        <p class="muted small" style="margin:0">粘贴词语后，点“先预览”看看会导入什么。</p>
                    </div>
                </div>
            </div>`;

        const textarea = body.querySelector('#paste-text');
        const categoryInput = body.querySelector('#paste-category');
        const statusNode = body.querySelector('#paste-status');
        const previewBox = body.querySelector('#preview-box');
        const previewButton = body.querySelector('#preview-btn');
        const commitButton = body.querySelector('#commit-btn');

        state.preview = null;

        body.querySelector('#paste-lang').addEventListener('click', (event) => {
            const button = event.target.closest('[data-lang]');
            if (!button) return;
            state.pasteLang = button.dataset.lang;
            body.querySelectorAll('#paste-lang button').forEach((item) => item.classList.toggle('active', item === button));
            state.preview = null;
            commitButton.disabled = true;
            previewBox.innerHTML = '<p class="muted small" style="margin:0">语言换了，重新预览一下吧。</p>';
            textarea.placeholder = PASTE_PLACEHOLDER[state.pasteLang];
        });

        body.querySelector('#fill-sample').addEventListener('click', () => {
            textarea.value = PASTE_SAMPLE[state.pasteLang];
            textarea.focus();
        });

        textarea.addEventListener('input', () => {
            state.preview = null;
            commitButton.disabled = true;
            statusNode.textContent = '';
        });

        previewButton.addEventListener('click', async () => {
            const text = textarea.value.trim();
            if (!text) {
                toast('先粘贴一些词语吧', 'error');
                textarea.focus();
                return;
            }
            previewButton.disabled = true;
            previewButton.textContent = '正在解析…';
            try {
                const data = await api.post('/api/import/preview', {
                    text,
                    lang: state.pasteLang,
                    category: categoryInput.value.trim() || '自定义',
                });
                state.preview = data;
                statusNode.textContent = data.items.length
                    ? `格式：${data.format}，可以导入 ${data.stats.newCount} 个新词。`
                    : '没有解析出有效的词，检查一下格式吧。';
                commitButton.disabled = !data.items.length;
                const stats = data.stats;
                const zhCount = data.items.filter((item) => item.lang === 'zh').length;
                const enCount = data.items.length - zhCount;
                previewBox.innerHTML = `
                    <div class="preview-stats">
                        <span class="chip">解析 ${stats.valid} 个</span>
                        <span class="chip">可新增 ${stats.newCount} 个</span>
                        ${state.pasteLang === 'auto' && data.items.length ? `<span class="chip">中文 ${zhCount}</span><span class="chip">英文 ${enCount}</span>` : ''}
                        ${stats.existing ? `<span class="chip">已有 ${stats.existing} 个</span>` : ''}
                        ${stats.duplicates ? `<span class="chip">列表内重复 ${stats.duplicates}</span>` : ''}
                        ${stats.invalid ? `<span class="chip">无效 ${stats.invalid}</span>` : ''}
                        ${stats.autoPinyin ? `<span class="chip">自动拼音 ${stats.autoPinyin}</span>` : ''}
                    </div>
                    <div class="preview-list">
                        ${data.items
                            .slice(0, 120)
                            .map(
                                (item) => `
                            <div class="preview-item">
                                <span class="pv-main">
                                    ${state.pasteLang === 'auto' ? `<span class="pv-lang ${item.lang}">${item.lang === 'en' ? 'EN' : '中'}</span>` : ''}
                                    <span class="pv-word">${escapeHtml(item.text)}</span>
                                </span>
                                <span class="pv-py">${escapeHtml(item.pinyin || item.meaning || '')}</span>
                            </div>`,
                            )
                            .join('')}
                    </div>
                    ${data.items.length > 120 ? `<p class="small muted" style="margin:8px 0 0">只显示前 120 个。</p>` : ''}`;
            } catch (error) {
                toast(error.message, 'error');
            } finally {
                previewButton.disabled = false;
                previewButton.textContent = '先预览';
            }
        });

        commitButton.addEventListener('click', async () => {
            if (!state.preview?.items?.length) return;
            commitButton.disabled = true;
            commitButton.textContent = '正在导入…';
            try {
                const result = await api.post('/api/import/commit', {
                    items: state.preview.items,
                    source: { type: 'paste', title: categoryInput.value.trim() || '粘贴导入' },
                });
                toast(`导入完成：新增 ${result.inserted} 个，跳过重复 ${result.duplicates} 个`, 'success');
                textarea.value = '';
                state.preview = null;
                previewBox.innerHTML = '<p class="muted small" style="margin:0">导入完成，可以继续粘贴下一批。</p>';
                statusNode.textContent = '';
                commitButton.disabled = true;
                await ctx.refresh?.();
            } catch (error) {
                toast(error.message, 'error');
                commitButton.disabled = false;
            } finally {
                commitButton.textContent = '导入词库';
            }
        });
    }

    /* ------------------------------ 教材词库 ------------------------------ */

    function renderBookGrid() {
        if (!state.books) return '<div class="page-loading" style="min-height:200px"><div class="loader"></div></div>';
        return `
            <div class="book-grid">
                ${state.books
                    .map(
                        (book) => `
                    <button class="book-pick ${state.bookId === book.id ? 'active' : ''}" data-book="${book.id}" type="button">
                        <strong>${escapeHtml(book.title)}</strong>
                        <span>生字 ${book.charCount} · 词语 ${book.wordCount}</span>
                        <span>已导入 ${book.importedChars + book.importedWords} 个</span>
                    </button>`,
                    )
                    .join('')}
            </div>`;
    }

    function renderBookDetail() {
        const book = state.bookDetail;
        if (!book) {
            return '<div class="empty" style="padding:26px 12px"><p>选一册教材，看看里面的生字和词语。</p></div>';
        }
        const items = state.bookType === 'char' ? book.chars : book.words;
        const selected = state.selected[state.bookType];
        const totalSelected = state.selected.char.size + state.selected.word.size;
        const typeLabel = state.bookType === 'char' ? '生字' : '词语';
        const importedCount = items.filter((item) => item.imported).length;

        return `
            <div class="card card-pad" style="margin-top:16px">
                <div class="section-head">
                    <div>
                        <h2>${escapeHtml(book.title)}</h2>
                        <p>${escapeHtml(book.publisher || '')} ${book.edition ? `· ${escapeHtml(book.edition)}` : ''} · 生字 ${book.chars.length} 个 · 词语 ${book.words.length} 个</p>
                    </div>
                    <div class="row wrap">
                        <button class="btn btn-sm" id="import-all">整册导入</button>
                        <button class="btn btn-sm btn-primary" id="import-picked" ${totalSelected ? '' : 'disabled'}>
                            导入选中 ${totalSelected ? `(${totalSelected})` : ''}
                        </button>
                    </div>
                </div>

                <div class="segmented" id="book-type" style="margin-bottom:12px">
                    <button data-type="char" class="${state.bookType === 'char' ? 'active' : ''}">生字 ${book.chars.length}</button>
                    <button data-type="word" class="${state.bookType === 'word' ? 'active' : ''}">词语 ${book.words.length}</button>
                </div>

                <div class="pick-toolbar">
                    <button class="btn btn-sm" data-pick="all">全选本类</button>
                    <button class="btn btn-sm" data-pick="invert">反选</button>
                    <button class="btn btn-sm btn-ghost" data-pick="none">清空选择</button>
                    <span class="small muted" data-pick-count>当前${typeLabel}已选 ${selected.size} 个</span>
                    <span class="small muted">· 已导入 ${importedCount} 个</span>
                </div>

                <p class="small muted pick-hint">鼠标拖动，或触屏按住词语后滑动，可以连续选择；已经导入的词会自动跳过。</p>

                <div class="pick-list" id="pick-list">
                    ${items
                        .map(
                            (item) => `
                        <button class="pick-item ${selected.has(item.text) ? 'active' : ''} ${item.imported ? 'imported' : ''}"
                            data-type="${state.bookType}" data-text="${escapeHtml(item.text)}" type="button"
                            ${item.imported ? 'aria-disabled="true"' : ''}
                            title="${escapeHtml(
                                item.imported
                                    ? '已经在词库里了，导入时会自动跳过'
                                    : [item.sentence, item.words?.length ? `组词：${item.words.join('、')}` : '']
                                          .filter(Boolean)
                                          .join(' '),
                            )}">
                            <span class="pick-word">${escapeHtml(item.text)}</span>
                            <span class="pick-py">${escapeHtml(item.pinyin || '')}</span>
                            ${item.imported ? '<span class="pick-flag">✓ 已导入</span>' : ''}
                        </button>`,
                        )
                        .join('')}
                </div>
                <p class="small muted" style="margin:12px 0 0">教材词库为整理版，供日常练习使用；不同地区、不同年份的教材可能略有差异，可以按需挑选或自行补充。</p>
            </div>`;
    }

    function updatePickToolbar() {
        const detail = body.querySelector('#book-detail');
        if (!detail || !state.bookDetail) return;
        const selected = state.selected[state.bookType];
        const typeLabel = state.bookType === 'char' ? '生字' : '词语';
        const countNode = detail.querySelector('[data-pick-count]');
        if (countNode) countNode.textContent = `当前${typeLabel}已选 ${selected.size} 个`;
        const total = state.selected.char.size + state.selected.word.size;
        const importButton = detail.querySelector('#import-picked');
        if (importButton) {
            importButton.disabled = total === 0;
            importButton.textContent = total ? `导入选中 (${total})` : '导入选中';
        }
    }

    async function loadBooks() {
        const data = await api.get('/api/textbooks');
        state.books = data.books;
    }

    async function loadBook(id) {
        state.bookDetail = null;
        state.bookId = id;
        state.selected = { char: new Set(), word: new Set() };
        state.bookType = 'char';
        const detailNode = body.querySelector('#book-detail');
        if (detailNode) detailNode.innerHTML = '<div class="page-loading" style="min-height:180px"><div class="loader"></div><p>正在打开教材…</p></div>';
        try {
            state.bookDetail = await api.get(`/api/textbooks/${id}`);
            renderTextbook();
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    async function doImport(payload) {
        try {
            const result = await api.post(`/api/textbooks/${state.bookId}/import`, payload);
            toast(`导入完成：新增 ${result.inserted} 个，跳过重复 ${result.duplicates} 个`, 'success');
            state.selected = { char: new Set(), word: new Set() };
            await Promise.all([loadBooks(), ctx.refresh?.()]);
            state.bookDetail = await api.get(`/api/textbooks/${state.bookId}`);
            renderTextbook();
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    async function renderTextbook() {
        body.innerHTML = `
            <div class="card card-pad">
                <div class="section-head" style="margin-bottom:12px">
                    <div><h2>统编版小学语文</h2><p>按年级选择一册，挑生字或词语导入。</p></div>
                    <span class="badge badge-jade">12 册</span>
                </div>
                <div id="book-grid">${renderBookGrid()}</div>
            </div>
            <div id="book-detail">${state.bookDetail ? renderBookDetail() : '<div class="empty" style="padding:26px 12px"><p>选一册教材，看看里面的生字和词语。</p></div>'}</div>`;

        if (!state.books) {
            try {
                await loadBooks();
            } catch (error) {
                toast(error.message, 'error');
                return;
            }
            body.querySelector('#book-grid').innerHTML = renderBookGrid();
        }

        body.querySelector('#book-grid').addEventListener('click', (event) => {
            const button = event.target.closest('[data-book]');
            if (button) loadBook(button.dataset.book);
        });

        const detailNode = body.querySelector('#book-detail');
        detailNode.addEventListener('click', async (event) => {
            const typeButton = event.target.closest('[data-type]');
            if (typeButton && !typeButton.classList.contains('pick-item')) {
                state.bookType = typeButton.dataset.type;
                detailNode.innerHTML = renderBookDetail();
                return;
            }
            const pickButton = event.target.closest('.pick-item');
            if (pickButton) {
                if (pickButton.classList.contains('imported')) {
                    toast('这个词已经在词库里了', 'success');
                    return;
                }
                const set = state.selected[pickButton.dataset.type];
                const text = pickButton.dataset.text;
                if (set.has(text)) set.delete(text);
                else set.add(text);
                pickButton.classList.toggle('active', set.has(text));
                updatePickToolbar();
                return;
            }
            const pickAction = event.target.closest('[data-pick]');
            if (pickAction) {
                const items = (state.bookType === 'char' ? state.bookDetail.chars : state.bookDetail.words).filter(
                    (item) => !item.imported,
                );
                const set = state.selected[state.bookType];
                if (pickAction.dataset.pick === 'all') items.forEach((item) => set.add(item.text));
                if (pickAction.dataset.pick === 'invert') {
                    items.forEach((item) => {
                        if (set.has(item.text)) set.delete(item.text);
                        else set.add(item.text);
                    });
                }
                if (pickAction.dataset.pick === 'none') set.clear();
                detailNode.querySelectorAll('.pick-item').forEach((item) => {
                    item.classList.toggle('active', set.has(item.dataset.text));
                });
                updatePickToolbar();
                return;
            }
            if (event.target.closest('#import-all')) {
                await doImport({});
                return;
            }
            if (event.target.closest('#import-picked')) {
                const chars = [...state.selected.char];
                const words = [...state.selected.word];
                if (!chars.length && !words.length) {
                    toast('先选一些生字或词语吧', 'error');
                    return;
                }
                const payload = { types: [] };
                if (chars.length) {
                    payload.types.push('char');
                    payload.chars = chars;
                }
                if (words.length) {
                    payload.types.push('word');
                    payload.words = words;
                }
                await doImport(payload);
            }
        });

        bindDragSelect(detailNode, {
            itemSelector: '.pick-item',
            canSelect: (el) => !el.classList.contains('imported'),
            isSelected: (el) => el.classList.contains('active'),
            setSelected: (el, on) => {
                const set = state.selected[el.dataset.type];
                if (!set) return;
                if (on) set.add(el.dataset.text);
                else set.delete(el.dataset.text);
                el.classList.toggle('active', on);
            },
            onUpdate: updatePickToolbar,
            getScroller: () => detailNode.querySelector('#pick-list'),
        });
    }

    /* ------------------------------ 英语词包 ------------------------------ */

    async function renderEnglish() {
        body.innerHTML = '<div class="page-loading" style="min-height:200px"><div class="loader"></div><p>正在打开词包…</p></div>';
        try {
            state.english = await api.get('/api/english');
        } catch (error) {
            body.innerHTML = `<div class="empty"><div class="empty-emoji">🫠</div><h3>词包没有打开</h3><p>${escapeHtml(error.message)}</p></div>`;
            return;
        }

        const groups = [];
        for (const pack of state.english) {
            const level = pack.level || '其他';
            let group = groups.find((item) => item.level === level);
            if (!group) {
                group = { level, packs: [], count: 0 };
                groups.push(group);
            }
            group.packs.push(pack);
            group.count += pack.count;
        }

        body.innerHTML = `
            <div class="import-grid">
                <div class="card card-pad">
                    <div class="section-head" style="margin-bottom:12px">
                        <div>
                            <h2>英语词库</h2>
                            <p>从小学到考研，按学段挑一个词包导入。看英文认中文，认识就行，记忆曲线和语文各自独立。</p>
                        </div>
                    </div>
                    <div class="pack-groups">
                        ${groups
                            .map(
                                (group) => `
                        <div class="pack-group">
                            <div class="pack-group-head">
                                <span class="badge badge-jade">${escapeHtml(group.level)}</span>
                                <span class="small muted">${group.packs.length} 个词包 · 共 ${group.count} 个单词</span>
                            </div>
                            <div class="stack">
                                ${group.packs
                                    .map(
                                        (pack) => `
                                <div class="card card-pad" style="box-shadow:none">
                                    <div class="row-between wrap">
                                        <div>
                                            <strong style="font-size:16px">${escapeHtml(pack.title)}</strong>
                                            <p class="small muted" style="margin:4px 0 0">
                                                ${pack.count} 个单词 · 已导入 ${pack.imported} 个${pack.note ? ` · ${escapeHtml(pack.note)}` : ''}
                                            </p>
                                        </div>
                                        <button class="btn btn-sm ${pack.imported >= pack.count ? '' : 'btn-primary'}"
                                            data-pack="${pack.id}" ${pack.imported >= pack.count ? 'disabled' : ''}>
                                            ${pack.imported >= pack.count ? '已全部导入' : '导入词包'}
                                        </button>
                                    </div>
                                </div>`,
                                    )
                                    .join('')}
                            </div>
                        </div>`,
                            )
                            .join('')}
                    </div>
                </div>
                <div class="card card-pad">
                    <div class="section-head" style="margin-bottom:10px">
                        <div><h2>怎么认英语单词</h2><p>英语是单独的一页，不和语文听写混在一起。</p></div>
                    </div>
                    <ol class="help-list">
                        <li>导入词包后，点左侧“英语单词”开始。</li>
                        <li>先看英文，点下面的“查看释义”看中文意思。</li>
                        <li>想起来了点“记住了”，没想起来点“没记住”。</li>
                        <li>不用默写，认识就行；记忆曲线和语文各自独立。</li>
                        <li>词包可以叠加导入，重复的单词会自动跳过。</li>
                    </ol>
                    <div class="divider"></div>
                    <a class="btn btn-block" href="#/english">去英语单词</a>
                </div>
            </div>`;

        body.querySelector('.import-grid').addEventListener('click', async (event) => {
            const button = event.target.closest('[data-pack]');
            if (!button) return;
            button.disabled = true;
            button.textContent = '正在导入…';
            try {
                const result = await api.post(`/api/english/${button.dataset.pack}/import`, {});
                toast(`导入完成：新增 ${result.inserted} 个，跳过重复 ${result.duplicates} 个`, 'success');
                await ctx.refresh?.();
                renderEnglish();
            } catch (error) {
                toast(error.message, 'error');
                button.disabled = false;
                button.textContent = '导入词包';
            }
        });
    }

    /* ------------------------------ 备份与重置 ------------------------------ */

    function renderBackup() {
        body.innerHTML = `
            <div class="import-grid">
                <div class="card card-pad">
                    <div class="section-head" style="margin-bottom:12px">
                        <div><h2>备份</h2><p>把词库、复习记录和设置打包成一个 JSON 文件。</p></div>
                    </div>
                    <div class="row wrap">
                        <a class="btn btn-primary" href="/api/export" download>下载备份 JSON</a>
                        <button class="btn" id="restore-btn" type="button">从备份恢复</button>
                        <input type="file" id="restore-file" accept="application/json,.json" hidden>
                    </div>
                    <p class="small muted" style="margin:12px 0 0">恢复时只会补充词库里还没有的词，不会覆盖已有进度。</p>
                    <div class="divider"></div>
                    <h3 style="margin:0 0 6px;font-size:15px">什么时候备份？</h3>
                    <ul class="help-list">
                        <li>换电脑、换手机之前。</li>
                        <li>导入一大批新教材之前。</li>
                        <li>想清空重来之前，先留一份底。</li>
                    </ul>
                </div>

                <div class="card card-pad">
                    <div class="section-head" style="margin-bottom:12px">
                        <div><h2>重置</h2><p>这两个操作都不能撤销，请先备份。</p></div>
                    </div>
                    <div class="stack">
                        <div class="about-box">
                            <h3>只重置复习进度</h3>
                            <p>保留所有词语，把听写次数、正确率、下次复习时间全部归零。</p>
                            <button class="btn btn-sm" id="reset-progress">重置复习进度</button>
                        </div>
                        <div class="about-box" style="border:1px solid color-mix(in srgb, var(--coral) 30%, var(--line))">
                            <h3 style="color:var(--coral-ink)">清空所有数据</h3>
                            <p>删除词库、听写记录和统计，相当于重新开始。</p>
                            <button class="btn btn-sm btn-coral" id="reset-all">清空所有数据</button>
                        </div>
                    </div>
                </div>
            </div>`;

        const fileInput = body.querySelector('#restore-file');
        body.querySelector('#restore-btn').addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                if (!Array.isArray(data.words)) throw new Error('这个文件不像是 MemoryToMe 的备份');
                const result = await api.post('/api/import/backup', data);
                toast(`恢复完成：新增 ${result.inserted} 个，跳过重复 ${result.duplicates} 个`, 'success');
                await ctx.refresh?.();
            } catch (error) {
                toast(error.message || '备份文件读不出来', 'error');
            } finally {
                fileInput.value = '';
            }
        });

        body.querySelector('#reset-progress').addEventListener('click', async () => {
            const ok = await confirmDialog({
                title: '重置所有复习进度？',
                message: '词语会保留，但所有听写次数、正确率和下次复习时间都会归零。',
                confirmText: '重置进度',
                danger: true,
            });
            if (!ok) return;
            try {
                await api.post('/api/reset-progress', { keepWords: true });
                toast('复习进度已经重置', 'success');
                await ctx.refresh?.();
            } catch (error) {
                toast(error.message, 'error');
            }
        });

        body.querySelector('#reset-all').addEventListener('click', async () => {
            const ok = await confirmDialog({
                title: '清空所有数据？',
                message: '词库、听写记录、统计都会删除，不能恢复。建议先下载备份。',
                confirmText: '确认清空',
                danger: true,
            });
            if (!ok) return;
            try {
                await api.post('/api/reset-progress', { keepWords: false });
                toast('已经清空，从头开始吧', 'success');
                await ctx.refresh?.();
                state.books = null;
                state.bookDetail = null;
            } catch (error) {
                toast(error.message, 'error');
            }
        });
    }

    /* -------------------------------- 路由 -------------------------------- */

    function renderTab() {
        if (state.tab === 'paste') renderPaste();
        else if (state.tab === 'textbook') renderTextbook();
        else if (state.tab === 'english') renderEnglish();
        else renderBackup();
    }

    renderTab();
}
