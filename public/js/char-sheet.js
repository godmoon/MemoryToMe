import { escapeHtml, fmtDateCN, openModal, speak } from './utils.js';

function voiceOptions(settings = {}) {
    return {
        rate: Number(settings.speechRate) || 0.85,
        voiceURI: settings.voiceURI || '',
    };
}

function normalizeWords(words) {
    if (!Array.isArray(words)) return [];
    return words.filter((word) => word && word.text);
}

/**
 * 打开默写单：每个字显示拼音和几行空格，孩子听家长读，凭记忆写。
 * 答案放在最下面，家长检查时用。
 */
export function openCharSheet(entries, options = {}) {
    const list = (Array.isArray(entries) ? entries : []).filter((entry) => entry && entry.char);
    const lines = Math.min(5, Math.max(1, Number(options.lines) || 3));
    const settings = options.settings || {};
    const title = options.title || '易错字默写单';
    const subtitle = options.subtitle || `共 ${list.length} 个字，每个字写 ${lines} 遍。`;

    if (!list.length) {
        openModal(
            `
            <h2>还没有可以默写的字</h2>
            <p class="modal-sub">批改时点具体字，或点词的空白处把整词标红，就会记录到这里。</p>
            <div class="modal-actions">
                <button class="btn btn-primary" data-close type="button">知道了</button>
            </div>`,
        );
        return;
    }

    const items = list
        .map(
            (entry) => `
        <div class="sheet-item">
            <div class="sheet-pinyin">${entry.pinyin ? escapeHtml(entry.pinyin) : '<span class="muted">读一读</span>'}</div>
            <div class="sheet-boxes">${Array.from({ length: lines }, () => '<span class="sheet-box"></span>').join('')}</div>
        </div>`,
        )
        .join('');

    openModal(
        `
        <div class="char-sheet-modal">
            <div class="sheet-head">
                <div>
                    <div class="eyebrow">易错字默写单</div>
                    <h2>${escapeHtml(title)}</h2>
                    <p class="modal-sub">${escapeHtml(subtitle)}</p>
                </div>
                <div class="sheet-actions">
                    <button class="btn btn-sm" id="sheet-speak" type="button">朗读一遍</button>
                    <button class="btn btn-sm btn-primary" id="sheet-print" type="button">打印</button>
                    <button class="btn btn-sm btn-ghost" data-close type="button">关闭</button>
                </div>
            </div>

            <div class="char-sheet" id="char-sheet">
                <div class="sheet-title">读一读，写一写</div>
                <div class="sheet-grid">${items}</div>
                <div class="sheet-answer">
                    <strong>答案（家长用）</strong>
                    <span>${list.map((entry) => escapeHtml(entry.char)).join('　')}</span>
                </div>
            </div>
        </div>`,
        {
            className: 'char-sheet-panel',
            onMount(panel) {
                const { rate, voiceURI } = voiceOptions(settings);
                panel.querySelector('#sheet-speak')?.addEventListener('click', () => {
                    speak(list.map((entry) => entry.char).join('，'), 'zh', rate, voiceURI);
                });

                panel.querySelector('#sheet-print')?.addEventListener('click', () => {
                    document.body.classList.add('printing-sheet');
                    const cleanup = () => {
                        document.body.classList.remove('printing-sheet');
                        window.removeEventListener('afterprint', cleanup);
                    };
                    window.addEventListener('afterprint', cleanup);
                    window.print();
                });
            },
        },
    );
}

/**
 * 单独练一个字：显示拼音和书写线，可以朗读、隐藏/显示字，
 * 也能看到这个字出现在哪些词里。
 */
export function openCharPractice(entry, options = {}) {
    if (!entry || !entry.char) return;
    const settings = options.settings || {};
    const words = normalizeWords(entry.words);
    const { rate, voiceURI } = voiceOptions(settings);
    const count = Number(entry.count) || 0;

    openModal(
        `
        <div class="char-practice">
            <div class="eyebrow">单独练一个字</div>
            <div class="char-practice-head">
                <div class="char-practice-char" id="practice-char">${escapeHtml(entry.char)}</div>
                <div class="char-practice-meta">
                    <div class="char-practice-pinyin">${entry.pinyin ? escapeHtml(entry.pinyin) : ''}</div>
                    <div class="small muted">
                        ${count ? `标红 ${count} 次` : '还没有标红记录'}
                        ${entry.lastDate ? ` · 最近 ${escapeHtml(fmtDateCN(entry.lastDate, false))}` : ''}
                    </div>
                    <div class="row wrap" style="margin-top:12px">
                        <button class="btn btn-sm" id="practice-speak" type="button">朗读</button>
                        <button class="btn btn-sm" id="practice-toggle" type="button">隐藏字</button>
                        <button class="btn btn-sm btn-primary" id="practice-sheet" type="button">生成默写单</button>
                    </div>
                </div>
            </div>

            <div class="practice-lines" aria-label="书写练习">
                <div class="practice-line"></div>
                <div class="practice-line"></div>
                <div class="practice-line"></div>
            </div>

            <div class="section-head" style="margin:18px 0 8px">
                <div><h2>包含这个字的词</h2><p>点词可以打开词语档案。</p></div>
                <span class="badge">${words.length} 个</span>
            </div>
            <div class="row wrap">
                ${
                    words.length
                        ? words
                              .map(
                                  (word) =>
                                      `<a class="chip" href="#/words/${word.id}" data-close>${escapeHtml(word.text)}</a>`,
                              )
                              .join('')
                        : '<p class="muted small" style="margin:0">词库里还没有包含这个字的词。</p>'
                }
            </div>

            <div class="modal-actions">
                <button class="btn btn-ghost" data-close type="button">关闭</button>
            </div>
        </div>`,
        {
            onMount(panel) {
                const charNode = panel.querySelector('#practice-char');
                const toggle = panel.querySelector('#practice-toggle');
                let visible = true;

                panel.querySelector('#practice-speak')?.addEventListener('click', () => {
                    speak(entry.char, 'zh', rate, voiceURI);
                });

                toggle?.addEventListener('click', () => {
                    visible = !visible;
                    charNode.textContent = visible ? entry.char : '？';
                    charNode.classList.toggle('hidden', !visible);
                    toggle.textContent = visible ? '隐藏字' : '显示字';
                });

                panel.querySelector('#practice-sheet')?.addEventListener('click', () => {
                    openCharSheet([entry], {
                        title: `默写单 · ${entry.char}`,
                        subtitle: '听家长读，凭记忆写 3 遍。',
                        settings,
                    });
                });
            },
        },
    );
}
