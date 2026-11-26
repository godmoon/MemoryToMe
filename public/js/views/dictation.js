import { api } from '../api.js';
import { saveSettings, store } from '../store.js';
import {
    escapeHtml,
    kindBadge,
    speak,
    stopSpeaking,
    toast,
    confirmDialog,
} from '../utils.js';

const SPEAKER_ICON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4z"></path>
        <path d="M15.5 8.5a5 5 0 0 1 0 7"></path>
        <path d="M18.5 5.5a9 9 0 0 1 0 13"></path>
    </svg>`;

function clampIndex(value, max) {
    return Math.min(Math.max(Number(value) || 0, 0), Math.max(0, max));
}

function readWrong(key) {
    try {
        const list = JSON.parse(localStorage.getItem(key) || '[]');
        return new Set(Array.isArray(list) ? list.map(Number) : []);
    } catch {
        return new Set();
    }
}

function writeWrong(key, set) {
    try {
        localStorage.setItem(key, JSON.stringify([...set]));
    } catch {
        /* ignore */
    }
}

function pinyinDisplay(word, showPinyin) {
    if (word.lang === 'en') return '';
    if (showPinyin) return escapeHtml(word.pinyin || '');
    const count = Math.max(1, Array.from(word.text).length);
    return Array.from({ length: count }, () => '·').join(' ');
}

function dotsHTML(total, current, wrongSet, items) {
    return items
        .map((item, index) => {
            const cls = index === current ? 'current' : index < current ? 'done' : '';
            const wrong = wrongSet.has(item.word.id) ? ' wrong' : '';
            return `<i class="${cls}${wrong}" title="第 ${index + 1} 个"></i>`;
        })
        .join('');
}

export async function render(root, ctx, id) {
    root.innerHTML = `
        <div class="page-loading">
            <div class="loader"></div>
            <p>正在翻开听写本…</p>
        </div>`;

    let session;
    try {
        session = await api.get(`/api/sessions/${id}`);
    } catch (error) {
        root.innerHTML = `
            <div class="focus-page">
                <div class="empty">
                    <div class="empty-emoji">📕</div>
                    <h3>没有找到这次听写</h3>
                    <p>${escapeHtml(error.message)}</p>
                    <a class="btn btn-primary" href="#/today">回到今日</a>
                </div>
            </div>`;
        return;
    }

    if (session.status === 'done') {
        ctx.navigate(`#/review/${id}`);
        return;
    }
    if (session.status !== 'active') {
        root.innerHTML = `
            <div class="focus-page">
                <div class="empty">
                    <div class="empty-emoji">🕰️</div>
                    <h3>这次听写已经结束</h3>
                    <p>可以回到今日，重新开始一组。</p>
                    <a class="btn btn-primary" href="#/today">回到今日</a>
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
                    <h3>这次听写没有词</h3>
                    <p>先导入一些词，再来听写吧。</p>
                    <a class="btn btn-primary" href="#/import">去导入</a>
                </div>
            </div>`;
        return;
    }

    const INDEX_KEY = `mt-dictation-${id}`;
    const WRONG_KEY = `mt-dictation-wrong-${id}`;
    let index = clampIndex(localStorage.getItem(INDEX_KEY), items.length - 1);
    let showPinyin = store.settings?.showPinyin !== false;
    let showMeaning = store.settings?.showMeaning !== false;
    let autoSpeak = store.settings?.autoSpeak !== false;
    let peek = false;
    const markedWrong = readWrong(WRONG_KEY);

    function current() {
        return items[index];
    }

    function saveIndex() {
        try {
            localStorage.setItem(INDEX_KEY, String(index));
        } catch {
            /* ignore */
        }
    }

    function cardHTML() {
        const item = current();
        const word = item.word;
        const isEn = word.lang === 'en';
        const meaning = isEn ? word.meaning : '';
        return `
            <div class="dictation-card${peek ? ' peek' : ''}" id="dictation-card">
                ${
                    isEn
                        ? `<div class="dictation-pinyin en">${escapeHtml('· '.repeat(Array.from(word.text).length).trim())}</div>
                           <div class="dictation-answer en" style="font-family:var(--font);font-size:clamp(44px,11vw,92px);letter-spacing:2px">${escapeHtml(word.text)}</div>
                           ${meaning && showMeaning ? `<div class="dictation-meaning">${escapeHtml(meaning)}</div>` : ''}`
                        : `<div class="dictation-pinyin ${showPinyin ? '' : 'hidden'}">${pinyinDisplay(word, showPinyin)}</div>
                           <div class="dictation-answer">${escapeHtml(word.text)}</div>`
                }
                <div class="dictation-hint">${
                    peek
                        ? '看完就松手，继续听写'
                        : isEn
                          ? '听英文，写出单词；想不起来可以按住下面的“偷看”'
                          : '听读音，在纸上写下来；不会写也没关系'
                }</div>
            </div>`;
    }

    function render() {
        const item = current();
        const word = item.word;
        const last = index === items.length - 1;
        const wrong = markedWrong.has(word.id);
        const progress = Math.round(((index + 1) / items.length) * 100);

        root.innerHTML = `
            <div class="focus-page">
                <div class="focus-top">
                    <button class="back-btn" id="back">← 今日</button>
                    <div class="focus-progress"><b>${index + 1}</b> / ${items.length}</div>
                    <button class="btn btn-sm btn-soft" id="to-review">去批改</button>
                </div>
                <div class="progress-line"><i style="width:${progress}%"></i></div>

                <div class="dictation-stage">
                    <div class="dictation-meta">
                        ${kindBadge(item.kind)}
                        ${wrong ? '<span class="badge badge-coral">已标红</span>' : ''}
                        <span>${word.lang === 'en' ? '英语单词' : '语文听写'}</span>
                        ${word.category ? `<span class="badge">${escapeHtml(word.category)}</span>` : ''}
                    </div>
                    ${cardHTML()}
                    <button class="speak-orb" id="speak" type="button" aria-label="朗读这个词">${SPEAKER_ICON}</button>
                    <div class="dots">${dotsHTML(items.length, index, markedWrong, items)}</div>
                </div>

                <div class="dictation-actions">
                    <button class="btn" id="prev" ${index === 0 ? 'disabled' : ''}>上一个</button>
                    <button class="btn btn-primary btn-next" id="next">${last ? '完成，去批改' : '下一个'}</button>
                    <button class="btn ${wrong ? 'btn-coral' : ''}" id="mark">${wrong ? '取消标红' : '不会，标红'}</button>
                </div>

                <div class="dictation-tools" style="margin-top:16px">
                    ${
                        word.lang === 'en'
                            ? `<label class="switch">
                        显示释义
                        <input type="checkbox" id="toggle-meaning" ${showMeaning ? 'checked' : ''}>
                        <span class="track"></span>
                    </label>`
                            : `<label class="switch">
                        显示拼音
                        <input type="checkbox" id="toggle-pinyin" ${showPinyin ? 'checked' : ''}>
                        <span class="track"></span>
                    </label>`
                    }
                    <label class="switch">
                        自动朗读
                        <input type="checkbox" id="toggle-auto" ${autoSpeak ? 'checked' : ''}>
                        <span class="track"></span>
                    </label>
                    <button class="peek-btn" id="peek" type="button">按住偷看</button>
                </div>
                <p class="small muted" style="text-align:center;margin:14px 0 0">
                    键盘：<span class="mono">←</span> 上一个 · <span class="mono">→ / 空格</span> 下一个 · <span class="mono">S</span> 朗读 · <span class="mono">P</span> ${word.lang === 'en' ? '释义' : '拼音'}
                </p>
            </div>`;

        bind();
    }

    function speakCurrent() {
        const word = current().word;
        const orb = root.querySelector('#speak');
        if (orb) orb.classList.add('speaking');
        speak(word.text, word.lang, store.settings?.speechRate ?? 0.85, store.settings?.voiceURI || '').then(() => {
            orb?.classList.remove('speaking');
        });
    }

    function goTo(nextIndex) {
        index = clampIndex(nextIndex, items.length - 1);
        saveIndex();
        peek = false;
        stopSpeaking();
        render();
        if (autoSpeak) setTimeout(speakCurrent, 260);
    }

    function next() {
        if (index >= items.length - 1) {
            finish();
            return;
        }
        goTo(index + 1);
    }

    function finish() {
        stopSpeaking();
        saveIndex();
        ctx.navigate(`#/review/${id}`);
    }

    async function leave() {
        stopSpeaking();
        const ok = await confirmDialog({
            title: '先离开听写？',
            message: '进度会保存下来，回到今日后可以点“继续听写”接着来。',
            confirmText: '保存并离开',
            cancelText: '继续听写',
        });
        if (ok) ctx.navigate('#/today');
    }

    function bind() {
        root.querySelector('#back')?.addEventListener('click', leave);
        root.querySelector('#to-review')?.addEventListener('click', finish);
        root.querySelector('#prev')?.addEventListener('click', () => goTo(index - 1));
        root.querySelector('#next')?.addEventListener('click', next);
        root.querySelector('#speak')?.addEventListener('click', speakCurrent);

        root.querySelector('#mark')?.addEventListener('click', () => {
            const wordId = current().word.id;
            if (markedWrong.has(wordId)) markedWrong.delete(wordId);
            else {
                markedWrong.add(wordId);
                toast('已标红，批改时会默认判错', 'success');
            }
            writeWrong(WRONG_KEY, markedWrong);
            render();
        });

        root.querySelector('#toggle-pinyin')?.addEventListener('change', async (event) => {
            showPinyin = event.target.checked;
            try {
                await saveSettings({ showPinyin });
            } catch {
                toast('设置没有保存成功，但这次仍然生效', 'error');
            }
            render();
        });

        root.querySelector('#toggle-meaning')?.addEventListener('change', async (event) => {
            showMeaning = event.target.checked;
            try {
                await saveSettings({ showMeaning });
            } catch {
                toast('设置没有保存成功，但这次仍然生效', 'error');
            }
            render();
        });

        root.querySelector('#toggle-auto')?.addEventListener('change', async (event) => {
            autoSpeak = event.target.checked;
            try {
                await saveSettings({ autoSpeak });
            } catch {
                toast('设置没有保存成功，但这次仍然生效', 'error');
            }
            if (autoSpeak) speakCurrent();
        });

        const peekButton = root.querySelector('#peek');
        const card = root.querySelector('#dictation-card');
        if (peekButton && card) {
            const show = (event) => {
                event.preventDefault();
                peek = true;
                card.classList.add('peek');
            };
            const hide = () => {
                if (!peek) return;
                peek = false;
                card.classList.remove('peek');
            };
            peekButton.addEventListener('pointerdown', show);
            peekButton.addEventListener('pointerup', hide);
            peekButton.addEventListener('pointerleave', hide);
            peekButton.addEventListener('pointercancel', hide);
            peekButton.addEventListener('contextmenu', (event) => event.preventDefault());
        }
    }

    function onKey(event) {
        const tag = (event.target?.tagName || '').toLowerCase();
        if (['input', 'textarea', 'select'].includes(tag)) return;
        if (document.querySelector('.modal-root.open')) return;
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            if (index > 0) goTo(index - 1);
        } else if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            next();
        } else if (event.key.toLowerCase() === 's') {
            event.preventDefault();
            speakCurrent();
        } else if (event.key.toLowerCase() === 'p') {
            event.preventDefault();
            if (current().word.lang === 'en') {
                showMeaning = !showMeaning;
                saveSettings({ showMeaning }).catch(() => {});
            } else {
                showPinyin = !showPinyin;
                saveSettings({ showPinyin }).catch(() => {});
            }
            render();
        }
    }

    render();
    document.addEventListener('keydown', onKey);

    const cleanup = () => {
        document.removeEventListener('keydown', onKey);
        stopSpeaking();
        window.removeEventListener('hashchange', cleanup);
    };
    window.addEventListener('hashchange', cleanup, { once: true });

    if (autoSpeak) setTimeout(speakCurrent, 360);
}
