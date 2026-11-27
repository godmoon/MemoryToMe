import { saveSettings, store } from '../store.js';
import { applyTheme } from '../theme.js';
import { escapeHtml, getVoices, loadVoices, speak, toast } from '../utils.js';

const ORDER_LABEL = {
    mixed: '混合穿插（推荐）',
    'reviews-first': '先复习，再新词',
    'new-first': '先新词，再复习',
};

const THEMES = [
    ['paper', '暖纸'],
    ['night', '夜读'],
    ['mint', '薄荷'],
];

function switchRow(id, title, desc, checked) {
    return `
        <div class="setting-row">
            <div class="setting-text"><strong>${title}</strong><span>${desc}</span></div>
            <label class="switch">
                <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
                <span class="track"></span>
            </label>
        </div>`;
}

function voiceOptions(lang, selected) {
    const voices = getVoices(lang);
    if (!voices.length) {
        return '<option value="">浏览器默认声音</option>';
    }
    return `
        <option value="">自动选择</option>
        ${voices
            .map(
                (voice) =>
                    `<option value="${escapeHtml(voice.voiceURI)}" ${voice.voiceURI === selected ? 'selected' : ''}>${escapeHtml(
                        `${voice.name}（${voice.lang}）`,
                    )}</option>`,
            )
            .join('')}`;
}

export async function render(root, ctx) {
    const settings = { ...store.settings };

    root.innerHTML = `
        <div class="fade-up">
            <div class="section-head">
                <div>
                    <h1 class="page-title">设置</h1>
                    <p class="page-sub">把每天的节奏调到刚刚好。改动会自动保存。</p>
                </div>
                <span class="badge badge-jade">数据保存在本机</span>
            </div>

            <div class="settings-grid">
                <div class="card card-pad">
                    <div class="section-head" style="margin-bottom:4px">
                        <div><h2>每日计划</h2><p>太少记不牢，太多容易累，20 个左右刚刚好。</p></div>
                    </div>

                    <div class="setting-row">
                        <div class="setting-text"><strong>每天总词量</strong><span>一次听写最多安排多少个词，包含新词和复习词（1–100）。</span></div>
                        <input class="number-input" id="dailyTotal" type="number" min="1" max="100" value="${settings.dailyTotal}">
                    </div>
                    <div class="setting-row">
                        <div class="setting-text"><strong>每天新词</strong><span>每天最多加入几个第一次听写的词（0–50）。</span></div>
                        <input class="number-input" id="newPerDay" type="number" min="0" max="50" value="${settings.newPerDay}">
                    </div>
                    <div class="setting-row">
                        <div class="setting-text"><strong>新词上限</strong><span>即使当天词量有富余，也不会超过这个数（0–50）。</span></div>
                        <input class="number-input" id="maxNew" type="number" min="0" max="50" value="${settings.maxNew}">
                    </div>
                    <div class="setting-row">
                        <div class="setting-text"><strong>排列方式</strong><span>新词和复习词怎么穿插。</span></div>
                        <select class="select" id="order" style="width:auto;min-width:170px">
                            ${Object.entries(ORDER_LABEL)
                                .map(([key, label]) => `<option value="${key}" ${settings.order === key ? 'selected' : ''}>${label}</option>`)
                                .join('')}
                        </select>
                    </div>
                </div>

                <div class="card card-pad">
                    <div class="section-head" style="margin-bottom:4px">
                        <div><h2>朗读与显示</h2><p>听不清就慢一点；想自己挑战就关掉拼音。</p></div>
                    </div>

                    ${switchRow('showPinyin', '听写时显示拼音', '关掉后只显示字数提示，难度更高。', settings.showPinyin)}
                    ${switchRow('autoSpeak', '自动朗读', '进入每个词时自动读一遍。', settings.autoSpeak)}

                    <div class="setting-row">
                        <div class="setting-text"><strong>朗读速度</strong><span id="rate-label">${Number(settings.speechRate).toFixed(2)} 倍速</span></div>
                        <input class="range" id="speechRate" type="range" min="0.5" max="1.5" step="0.05" value="${settings.speechRate}">
                    </div>

                    <div class="setting-row">
                        <div class="setting-text"><strong>中文语音</strong><span>语文听写时使用。</span></div>
                        <select class="select" id="voiceURI" style="width:auto;max-width:230px">
                            ${voiceOptions('zh', settings.voiceURI)}
                        </select>
                    </div>

                    <div class="setting-row">
                        <div class="setting-text"><strong>英文语音</strong><span>英语认词时使用。</span></div>
                        <select class="select" id="enVoiceURI" style="width:auto;max-width:230px">
                            ${voiceOptions('en', settings.enVoiceURI)}
                        </select>
                    </div>

                    <div class="row wrap" style="margin-top:14px">
                        <button class="btn" id="test-voice" type="button">试听中文</button>
                        <button class="btn" id="test-en-voice" type="button">试听英文</button>
                        <span class="small muted">不同设备的朗读声音会不一样，选一个孩子听着舒服的。</span>
                    </div>
                </div>

                <div class="card card-pad">
                    <div class="section-head" style="margin-bottom:12px">
                        <div><h2>外观</h2><p>白天用暖纸，晚上用夜读，眼睛更轻松。</p></div>
                    </div>
                    <div class="theme-picker" id="theme-picker">
                        ${THEMES.map(
                            ([key, label]) =>
                                `<button class="theme-swatch ${key} ${settings.theme === key ? 'active' : ''}" data-theme="${key}" type="button" title="${label}" aria-label="${label}"></button>`,
                        ).join('')}
                    </div>
                    <p class="small muted" style="margin:12px 0 0">当前：<strong id="theme-name">${THEMES.find(([key]) => key === settings.theme)?.[1] || '暖纸'}</strong></p>

                    <div class="divider"></div>
                    <h3 style="margin:0 0 6px;font-size:15px">小提示</h3>
                    <ul class="help-list">
                        <li>手机上可以“添加到主屏幕”，像小应用一样打开。</li>
                        <li>听写页支持触屏、鼠标和键盘：<span class="mono">←</span> / <span class="mono">→</span> 翻词。</li>
                        <li>每天完成后，第二天的复习量会自动算好。</li>
                    </ul>
                </div>

                <div class="card card-pad">
                    <div class="section-head" style="margin-bottom:10px">
                        <div><h2>记忆曲线怎么安排</h2><p>不是死记硬背，是在快忘记的时候再见一面。</p></div>
                    </div>
                    <div class="about-box">
                        <h3>间隔复习</h3>
                        <p>基础复习节点为 1、2、4、7、15、30、60、120、180 天，再根据每个词的熟练度微调。答对就拉长间隔，答错就退回两级、第二天重来。</p>
                        <h3 style="margin-top:12px">每日分配</h3>
                        <p>先安排今天到期的复习词，再补上 3 天内到期的易错词，然后从未来词里补齐，最后加入当天的新词。新词会均匀穿插在复习词之间，避免连续出现太多生词。</p>
                        <h3 style="margin-top:12px">参考资料</h3>
                        <p>
                            Ebbinghaus, H. (1885). <i>Über das Gedächtnis</i>.<br>
                            Wozniak, P. A. (1987). <i>The SM-2 algorithm</i>.<br>
                            Cepeda, N. J., et al. (2006). Distributed practice in verbal recall tasks. <i>Psychological Bulletin</i>.<br>
                            教育部.《义务教育语文课程标准（2022 年版）》.
                        </p>
                        <p style="margin-bottom:0">这套参数是面向小学生的简化版，重点是“每天少量、经常见面”，不是追求一次记住。</p>
                    </div>
                    <div class="row wrap" style="margin-top:14px">
                        <a class="btn btn-sm" href="#/import?tab=backup">备份数据</a>
                        <a class="btn btn-sm btn-ghost" href="#/stats">看看统计</a>
                    </div>
                </div>
            </div>
        </div>`;

    async function save(patch) {
        try {
            const saved = await saveSettings(patch);
            if (patch.theme) applyTheme(saved.theme);
            toast('已保存', 'success');
            return saved;
        } catch (error) {
            toast(error.message, 'error');
            return null;
        }
    }

    function numberField(id, key, min, max) {
        const input = root.querySelector(`#${id}`);
        input.addEventListener('change', () => {
            const value = Math.min(max, Math.max(min, Number(input.value) || min));
            input.value = String(value);
            save({ [key]: value });
        });
    }

    numberField('dailyTotal', 'dailyTotal', 1, 100);
    numberField('newPerDay', 'newPerDay', 0, 50);
    numberField('maxNew', 'maxNew', 0, 50);

    root.querySelector('#order').addEventListener('change', (event) => save({ order: event.target.value }));

    root.querySelector('#showPinyin').addEventListener('change', (event) => save({ showPinyin: event.target.checked }));
    root.querySelector('#autoSpeak').addEventListener('change', (event) => save({ autoSpeak: event.target.checked }));

    const rate = root.querySelector('#speechRate');
    const rateLabel = root.querySelector('#rate-label');
    rate.addEventListener('input', () => {
        rateLabel.textContent = `${Number(rate.value).toFixed(2)} 倍速`;
    });
    rate.addEventListener('change', () => save({ speechRate: Number(rate.value) }));

    root.querySelector('#voiceURI').addEventListener('change', (event) => save({ voiceURI: event.target.value }));
    root.querySelector('#enVoiceURI').addEventListener('change', (event) => save({ enVoiceURI: event.target.value }));

    root.querySelector('#test-voice').addEventListener('click', () => {
        speak('春天来了，柳树发芽了。', 'zh', store.settings.speechRate, store.settings.voiceURI);
    });

    root.querySelector('#test-en-voice').addEventListener('click', () => {
        speak('Spring is coming. The trees are green.', 'en', store.settings.speechRate, store.settings.enVoiceURI);
    });

    root.querySelector('#theme-picker').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-theme]');
        if (!button) return;
        const theme = button.dataset.theme;
        applyTheme(theme);
        root.querySelectorAll('.theme-swatch').forEach((item) => item.classList.toggle('active', item === button));
        const name = root.querySelector('#theme-name');
        if (name) name.textContent = THEMES.find(([key]) => key === theme)?.[1] || '暖纸';
        await save({ theme });
    });

    // 声音列表有时加载较慢，先让页面可用，再补上可选声音
    loadVoices().then(() => {
        const zhSelect = root.querySelector('#voiceURI');
        if (zhSelect) zhSelect.innerHTML = voiceOptions('zh', store.settings.voiceURI);
        const enSelect = root.querySelector('#enVoiceURI');
        if (enSelect) enSelect.innerHTML = voiceOptions('en', store.settings.enVoiceURI);
    });
}
