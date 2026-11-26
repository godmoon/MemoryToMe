/* 通用工具：日期、拼音拆分、朗读、提示、弹窗 */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(value, days) {
    const [y, m, d] = String(value).split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function diffDays(a, b) {
    const [ay, am, ad] = String(a).split('-').map(Number);
    const [by, bm, bd] = String(b).split('-').map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function fmtDateCN(value, withWeek = true) {
    if (!value) return '';
    const [y, m, d] = String(value).split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
    return `${m} 月 ${d} 日${withWeek ? ` · ${week}` : ''}`;
}

export function fmtDateShort(value) {
    if (!value) return '';
    const [, m, d] = String(value).split('-').map(Number);
    return `${m}/${d}`;
}

export function dueText(word) {
    if (word.status === 'suspended') return '已暂停';
    if (!word.dueDate) return '还没开始';
    const d = diffDays(todayStr(), word.dueDate);
    if (d < 0) return `逾期 ${-d} 天`;
    if (d === 0) return '今天';
    if (d === 1) return '明天';
    if (d < 7) return `${d} 天后`;
    if (d < 30) return `${Math.round(d / 7)} 周后`;
    return `${Math.round(d / 30)} 个月后`;
}

export function dueClass(word) {
    if (word.status === 'suspended') return 'muted';
    if (!word.dueDate) return 'muted';
    const d = diffDays(todayStr(), word.dueDate);
    if (d < 0) return 'badge-coral';
    if (d === 0) return 'badge-amber';
    return 'badge-jade';
}

export function statusBadge(word) {
    const map = {
        new: ['未学习', 'badge-blue'],
        learning: ['学习中', 'badge-amber'],
        review: ['复习中', 'badge-jade'],
        mastered: ['已掌握', 'badge-jade'],
        suspended: ['已暂停', 'badge'],
    };
    const [label, cls] = map[word.status] || [word.status, 'badge'];
    return `<span class="badge ${cls}">${label}</span>`;
}

export function kindBadge(kind) {
    const map = {
        new: ['新词', 'badge-amber'],
        review: ['复习', 'badge-jade'],
        error: ['易错', 'badge-coral'],
    };
    const [label, cls] = map[kind] || [kind, 'badge'];
    return `<span class="badge ${cls}">${label}</span>`;
}

/** 把“词”和“拼音”按字对齐。拼音数量对不上时，退化为整词拼音。 */
export function pinyinPairs(text, pinyinText) {
    const chars = Array.from(String(text || ''));
    const parts = String(pinyinText || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (parts.length === chars.length) {
        return chars.map((char, index) => ({ char, py: parts[index] }));
    }
    return chars.map((char) => ({ char, py: '' }));
}

export function charsHTML(word, options = {}) {
    const { interactive = false, showPinyin = true } = options;
    const pairs = pinyinPairs(word.text, word.pinyin);
    return pairs
        .map(
            (pair, index) => `
            <span class="char-cell${interactive ? ' clickable' : ''}" data-index="${index}">
                ${showPinyin ? `<span class="char-py">${escapeHtml(pair.py)}</span>` : ''}
                <span class="char-hz">${escapeHtml(pair.char)}</span>
            </span>`,
        )
        .join('');
}

export function pct(value) {
    if (value == null || Number.isNaN(Number(value))) return '—';
    return `${Math.round(Number(value))}%`;
}

export function debounce(fn, wait = 300) {
    let timer = null;
    const wrapped = (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
    wrapped.cancel = () => clearTimeout(timer);
    return wrapped;
}

/* 记录所有拖动绑定，容器从页面移除后自动清理 window 监听 */
const dragBindings = new Set();

function pruneDragBindings(container = null) {
    for (const entry of [...dragBindings]) {
        if (!entry.container.isConnected || entry.container === container) {
            entry.cleanup();
            dragBindings.delete(entry);
        }
    }
}

/**
 * 绑定拖动多选。
 * 鼠标：按下就开始拖动选择；触屏：按住约 150ms 后再滑动，避免和页面滚动冲突。
 * 只负责判断拖过哪些元素，具体选中状态由 isSelected / setSelected 维护。
 */
export function bindDragSelect(container, options = {}) {
    pruneDragBindings(container);
    const {
        itemSelector,
        canSelect = () => true,
        isSelected = (el) => el.classList.contains('active'),
        setSelected = () => {},
        onUpdate = () => {},
        longPressMs = 150,
        threshold = 8,
        edge = 48,
        maxScroll = 18,
        getScroller = null,
    } = options;

    let active = false;
    let dragging = false;
    let mode = true;
    let touchMode = false;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let pressTimer = null;
    let scrollRaf = 0;
    let scrollDy = 0;
    let scroller = null;
    let suppressUntil = 0;
    let lastTouchAt = 0;

    const itemAt = (x, y) => {
        const el = document.elementFromPoint(x, y);
        const item = el?.closest(itemSelector);
        return item && container.contains(item) ? item : null;
    };

    const paint = (el, on) => {
        if (!el || !canSelect(el) || isSelected(el) === on) return;
        setSelected(el, on);
        onUpdate();
    };

    function findScroller() {
        const preferred = typeof getScroller === 'function' ? getScroller() : null;
        if (preferred) {
            const style = getComputedStyle(preferred);
            if (/(auto|scroll)/.test(style.overflowY) && preferred.scrollHeight > preferred.clientHeight + 1) {
                return preferred;
            }
        }
        let el = container;
        while (el && el !== document.body && el !== document.documentElement) {
            const style = getComputedStyle(el);
            if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) return el;
            el = el.parentElement;
        }
        return null;
    }

    function stopAutoScroll() {
        scrollDy = 0;
        if (scrollRaf) cancelAnimationFrame(scrollRaf);
        scrollRaf = 0;
    }

    function autoScrollTick() {
        scrollRaf = 0;
        if (!dragging || !scrollDy) return;
        if (scroller) scroller.scrollTop += scrollDy;
        else window.scrollBy(0, scrollDy);
        paint(itemAt(lastX, lastY), mode);
        scrollRaf = requestAnimationFrame(autoScrollTick);
    }

    function updateAutoScroll(y) {
        const rect = scroller
            ? scroller.getBoundingClientRect()
            : { top: 0, bottom: window.innerHeight };
        let dy = 0;
        if (y < rect.top + edge) dy = -Math.min(maxScroll, Math.ceil((rect.top + edge - y) / 3));
        else if (y > rect.bottom - edge) dy = Math.min(maxScroll, Math.ceil((y - (rect.bottom - edge)) / 3));
        scrollDy = dy;
        if (scrollDy && !scrollRaf) scrollRaf = requestAnimationFrame(autoScrollTick);
        if (!scrollDy) stopAutoScroll();
    }

    function begin(el, x, y, isTouch) {
        if (!el || !canSelect(el)) return;
        active = true;
        dragging = true;
        touchMode = isTouch;
        mode = !isSelected(el);
        startX = x;
        startY = y;
        lastX = x;
        lastY = y;
        scroller = findScroller();
        paint(el, mode);
        suppressUntil = Date.now() + (isTouch ? 700 : 100);
        container.classList.add('drag-selecting');
        document.body.classList.add('drag-selecting');
    }

    function move(x, y) {
        if (!active) return;
        lastX = x;
        lastY = y;
        paint(itemAt(x, y), mode);
        updateAutoScroll(y);
    }

    function finish() {
        clearTimeout(pressTimer);
        pressTimer = null;
        if (!active) return;
        active = false;
        dragging = false;
        container.classList.remove('drag-selecting');
        document.body.classList.remove('drag-selecting');
        stopAutoScroll();
        suppressUntil = Date.now() + (touchMode ? 700 : 100);
    }

    function onMouseDown(event) {
        if (event.button !== 0) return;
        // 忽略触屏后浏览器补发的鼠标事件，避免一次点击切换两次
        if (Date.now() - lastTouchAt < 800) return;
        const item = event.target.closest(itemSelector);
        if (!item || !container.contains(item) || !canSelect(item)) return;
        event.preventDefault();
        begin(item, event.clientX, event.clientY, false);
    }

    function onMouseMove(event) {
        if (!container.isConnected) {
            cleanup();
            return;
        }
        if (!active) return;
        event.preventDefault();
        move(event.clientX, event.clientY);
    }

    function onTouchStart(event) {
        lastTouchAt = Date.now();
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        const item = event.target.closest(itemSelector);
        if (!item || !container.contains(item) || !canSelect(item)) return;
        startX = touch.clientX;
        startY = touch.clientY;
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
            pressTimer = null;
            begin(item, startX, startY, true);
        }, longPressMs);
    }

    function onTouchMove(event) {
        if (!container.isConnected) {
            cleanup();
            return;
        }
        const touch = event.touches[0];
        if (!touch) return;
        if (!active) {
            if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > threshold) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
            return;
        }
        event.preventDefault();
        move(touch.clientX, touch.clientY);
    }

    function onClickCapture(event) {
        if (Date.now() < suppressUntil) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }

    function stampTouchEnd() {
        lastTouchAt = Date.now();
    }

    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('click', onClickCapture, true);
    // 移动和松开挂在 window 上，拖到浮动条或容器外也能继续
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', finish);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', finish);
    window.addEventListener('touchend', stampTouchEnd);
    window.addEventListener('touchcancel', finish);
    window.addEventListener('touchcancel', stampTouchEnd);

    function cleanup() {
        clearTimeout(pressTimer);
        pressTimer = null;
        stopAutoScroll();
        container.classList.remove('drag-selecting');
        document.body.classList.remove('drag-selecting');
        container.removeEventListener('mousedown', onMouseDown);
        container.removeEventListener('touchstart', onTouchStart);
        container.removeEventListener('click', onClickCapture, true);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', finish);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', finish);
        window.removeEventListener('touchend', stampTouchEnd);
        window.removeEventListener('touchcancel', finish);
        window.removeEventListener('touchcancel', stampTouchEnd);
        dragBindings.delete(entry);
    }

    const entry = { container, cleanup };
    dragBindings.add(entry);
    return cleanup;
}

/* ------------------------------- 提示与弹窗 ------------------------------- */

export function toast(message, type = '') {
    const root = $('#toast-root');
    if (!root) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`.trim();
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => {
        node.style.opacity = '0';
        node.style.transform = 'translateY(8px)';
        node.style.transition = 'opacity .2s ease, transform .2s ease';
        setTimeout(() => node.remove(), 220);
    }, 2600);
}

let modalCleanup = null;

export function openModal(content, options = {}) {
    const root = $('#modal-root');
    if (!root) return;
    if (root.classList.contains('open')) closeModal();
    root.innerHTML = `
        <div class="modal-backdrop" data-close></div>
        <div class="modal-panel ${options.className || ''}" role="dialog" aria-modal="true">
            ${content}
        </div>`;
    root.classList.add('open');
    document.body.style.overflow = 'hidden';

    const close = () => closeModal();
    root.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
    const panel = root.querySelector('.modal-panel');
    const focusable = panel.querySelector('input, textarea, select, button');
    if (focusable) setTimeout(() => focusable.focus(), 30);

    if (options.onMount) modalCleanup = options.onMount(panel, close) || null;

    const onKey = (event) => {
        if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const oldCleanup = modalCleanup;
    modalCleanup = () => {
        document.removeEventListener('keydown', onKey);
        if (typeof oldCleanup === 'function') oldCleanup();
    };
}

export function closeModal() {
    const root = $('#modal-root');
    if (!root) return;
    if (typeof modalCleanup === 'function') {
        try {
            modalCleanup();
        } catch {
            /* ignore */
        }
    }
    modalCleanup = null;
    root.classList.remove('open');
    root.innerHTML = '';
    document.body.style.overflow = '';
}

export function confirmDialog({ title, message, confirmText = '确定', cancelText = '取消', danger = false }) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            closeModal();
            resolve(value);
        };
        openModal(
            `
            <h2>${escapeHtml(title)}</h2>
            <p class="modal-sub">${escapeHtml(message)}</p>
            <div class="modal-actions">
                <button class="btn btn-ghost" data-cancel>${escapeHtml(cancelText)}</button>
                <button class="btn ${danger ? 'btn-coral' : 'btn-primary'}" data-confirm>${escapeHtml(confirmText)}</button>
            </div>`,
            {
                onMount(panel) {
                    panel.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
                    panel.querySelector('[data-confirm]').addEventListener('click', () => finish(true));
                    return () => finish(false);
                },
            },
        );
    });
}

/* ------------------------------- 朗读 ------------------------------- */

let voiceCache = [];

export function loadVoices() {
    if (!('speechSynthesis' in window)) return Promise.resolve([]);
    return new Promise((resolve) => {
        const read = () => {
            voiceCache = window.speechSynthesis.getVoices();
            if (voiceCache.length) resolve(voiceCache);
        };
        read();
        if (voiceCache.length) return;
        const timer = setTimeout(() => resolve(voiceCache), 900);
        window.speechSynthesis.addEventListener(
            'voiceschanged',
            () => {
                clearTimeout(timer);
                voiceCache = window.speechSynthesis.getVoices();
                resolve(voiceCache);
            },
            { once: true },
        );
    });
}

export function getVoices(lang) {
    const prefix = lang === 'en' ? 'en' : 'zh';
    return voiceCache.filter((voice) => voice.lang && voice.lang.toLowerCase().startsWith(prefix));
}

export function speak(text, lang = 'zh', rate = 0.85, voiceURI = '') {
    if (!('speechSynthesis' in window)) {
        toast('这个浏览器不支持朗读，可以看拼音来听写', 'error');
        return Promise.resolve(false);
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text));
    utterance.lang = lang === 'en' ? 'en-US' : 'zh-CN';
    utterance.rate = Math.min(1.4, Math.max(0.5, Number(rate) || 0.85));
    utterance.pitch = 1;
    const voices = getVoices(lang);
    const chosen = voices.find((voice) => voice.voiceURI === voiceURI) || voices[0];
    if (chosen) utterance.voice = chosen;
    return new Promise((resolve) => {
        utterance.onend = () => resolve(true);
        utterance.onerror = () => resolve(false);
        synth.speak(utterance);
    });
}

export function stopSpeaking() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

/* ------------------------------- 杂项 ------------------------------- */

export function shuffle(list) {
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

export function heatLevel(count) {
    if (!count) return 0;
    if (count <= 2) return 1;
    if (count <= 5) return 2;
    if (count <= 9) return 3;
    return 4;
}

export function monthLabel(value) {
    const [y, m] = String(value).split('-').map(Number);
    return `${y} 年 ${m} 月`;
}

export function downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function copyText(text) {
    if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
    }
    return Promise.resolve(false);
}
