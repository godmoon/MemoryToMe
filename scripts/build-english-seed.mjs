/**
 * 生成内置英语词库（server/seed/english.json）。
 *
 * 数据来源（BSD-3-Clause）：
 *   https://github.com/KyleBing/english-vocabulary
 *   使用其中的 full_line_tsv/simple/正序 文本，按“词条 \t 词性::释义 \t 词组”组织。
 *
 * 下载方式（示例，需联网）：
 *   BASE=https://raw.githubusercontent.com/KyleBing/english-vocabulary/master
 *   curl -L "$BASE/full_line_tsv/simple/%E6%AD%A3%E5%BA%8F/%E5%88%9D%E4%B8%AD.txt" -o 初中.txt
 *
 * 用法：
 *   node scripts/build-english-seed.mjs /path/to/english-source
 *
 * 目录里需要这些文件：
 *   人教小学三年级.txt 人教小学四年级.txt 人教小学五年级.txt 人教小学六年级.txt
 *   初中.txt 高中.txt 四级.txt 六级.txt 考研.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'server/seed/english.json');

const sourceDir = process.argv[2] || '/tmp/english-source';

if (!fs.existsSync(sourceDir)) {
    console.error(`找不到词库目录：${sourceDir}`);
    console.error('请先按脚本顶部说明下载 txt 文件。');
    process.exit(1);
}

/* ------------------------------- 释义清洗 ------------------------------- */

// 常见词性缩写，统一补上句点，避免出现 "v 吸收" 这种夹生格式
const POS_SET = new Set([
    'n', 'v', 'vt', 'vi', 'adj', 'adv', 'prep', 'pron', 'conj', 'num',
    'art', 'int', 'aux', 'abbr', 'pl', 'modal', 'det', 'interj',
]);

function posLabel(raw) {
    const tokens = String(raw)
        .split('&')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
        .map((item) => (POS_SET.has(item) ? `${item}.` : item));
    return tokens.join(' & ');
}

/**
 * 把 "v::吸收（液体、气体等）¦n::熊" 这类词典释义压成一句适合小学生看的中文。
 * - 去掉人名、地名等词典噪声
 * - 去掉 [经管] 之类的领域标注
 * - 最多保留 3 个义项，总长不超过 60 字
 */
function cleanMeaning(raw) {
    const senses = [];
    for (const sense of String(raw || '').split('¦')) {
        const text = sense.trim();
        if (!text) continue;
        const split = text.indexOf('::');
        const pos = split >= 0 ? text.slice(0, split).trim() : '';
        let tran = split >= 0 ? text.slice(split + 2).trim() : text;
        if (!tran) continue;
        if (/人名|姓氏|地名|部落名/.test(tran)) continue;
        tran = tran
            .replace(/\[[^\]]*\]/g, '')
            .replace(/\([^)]*人名[^)]*\)/g, '')
            .replace(/\s+/g, ' ')
            // 统一中文标点，顺手清掉“效用， 有用”这类空格
            .replace(/,/g, '，')
            .replace(/;/g, '；')
            .replace(/([，。；、！？：])\s+/g, '$1')
            .replace(/\s+([，。；、！？：])/g, '$1')
            .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2')
            .replace(/^[，,；;、\s]+|[，,；;、\s]+$/g, '');
        if (!tran) continue;
        const label = pos ? posLabel(pos) : '';
        senses.push(label ? `${label} ${tran}` : tran);
        if (senses.length >= 3) break;
    }
    if (!senses.length) return '';

    let out = senses.join('；').replace(/；{2,}/g, '；');
    if (out.length > 60) {
        // 优先在义项分隔处截断，读起来更自然
        const cut = Math.max(out.lastIndexOf('；', 60), out.lastIndexOf('，', 60), out.lastIndexOf('、', 60));
        out = cut >= 20 ? out.slice(0, cut) : out.slice(0, 60);
        out = out.replace(/[，,；;、\s]+$/g, '');
    }
    return out;
}

const WORD_RE = /^[A-Za-z][A-Za-z'’.\- ]*$/;

function normalizeText(value) {
    return String(value || '')
        .replace(/’/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function readRows(file) {
    const full = path.join(sourceDir, file);
    if (!fs.existsSync(full)) {
        console.error(`缺少文件：${full}`);
        process.exit(1);
    }
    const rows = [];
    for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const [wordRaw, meaningRaw] = line.split('\t');
        const text = normalizeText(wordRaw);
        if (!text || text.length > 32) continue;
        if (!WORD_RE.test(text)) continue;
        const meaning = cleanMeaning(meaningRaw);
        if (!meaning) continue;
        rows.push({ text, meaning });
    }
    return rows;
}

/** 合并多个文件并按小写词形去重，保留第一次出现的顺序 */
function mergeRows(files) {
    const seen = new Set();
    const words = [];
    let skipped = 0;
    for (const file of files) {
        for (const row of readRows(file)) {
            const key = row.text.toLowerCase();
            if (seen.has(key)) {
                skipped += 1;
                continue;
            }
            seen.add(key);
            words.push(row);
        }
    }
    return { words, skipped };
}

/* -------------------------------- 词包定义 ------------------------------- */

const PACK_DEFS = [
    {
        id: 'en-primary',
        level: '小学',
        title: '小学英语 · 人教三至六年级',
        note: '人教 PEP 教材三到六年级单词和短语，按年级顺序排列。',
        files: ['人教小学三年级.txt', '人教小学四年级.txt', '人教小学五年级.txt', '人教小学六年级.txt'],
    },
    {
        id: 'en-junior',
        level: '初中',
        title: '初中英语 · 中考词汇',
        note: '初中阶段常用词汇，覆盖中考常见词。',
        files: ['初中.txt'],
    },
    {
        id: 'en-senior',
        level: '高中',
        title: '高中英语 · 高考词汇',
        note: '高中阶段常用词汇，覆盖高考常见词。',
        files: ['高中.txt'],
    },
    {
        id: 'en-cet4',
        level: '大学',
        title: '大学英语四级 · CET-4',
        note: '大学英语四级核心词汇。',
        files: ['四级.txt'],
    },
    {
        id: 'en-cet6',
        level: '大学',
        title: '大学英语六级 · CET-6',
        note: '大学英语六级核心词汇。',
        files: ['六级.txt'],
    },
    {
        id: 'en-postgrad',
        level: '考研',
        title: '考研英语 · 核心词汇',
        note: '考研英语常用词汇。',
        files: ['考研.txt'],
    },
];

/* --------------------------------- 输出 --------------------------------- */

const oldSeed = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const starter = oldSeed.packs.find((pack) => pack.id === 'en-starter') || {
    id: 'en-starter',
    title: '英语启蒙 · 校园与生活',
    lang: 'en',
    words: [],
};

const packs = [
    { ...starter, level: starter.level || '启蒙', note: starter.note || '日常校园和生活场景的基础词。' },
];

const report = [];
for (const def of PACK_DEFS) {
    const { words, skipped } = mergeRows(def.files);
    packs.push({
        id: def.id,
        title: def.title,
        level: def.level,
        note: def.note,
        lang: 'en',
        words,
    });
    report.push({ pack: def.title, words: words.length, skipped });
}

const seed = {
    meta: {
        title: '英语词库',
        note: '按学段划分的英语词库，听写时朗读英文并显示中文释义。',
        source: {
            name: 'KyleBing/english-vocabulary',
            url: 'https://github.com/KyleBing/english-vocabulary',
            license: 'BSD-3-Clause',
        },
    },
    packs,
};

/** 每个单词写成一行，方便 diff，也能让文件小一半 */
function stringifySeed(data) {
    const packs = data.packs.map((pack) => {
        const head = [
            `            "id": ${JSON.stringify(pack.id)},`,
            `            "title": ${JSON.stringify(pack.title)},`,
            `            "level": ${JSON.stringify(pack.level)},`,
            `            "note": ${JSON.stringify(pack.note)},`,
            '            "lang": "en",',
        ].join('\n');
        const words = pack.words
            .map((word) => `                { "text": ${JSON.stringify(word.text)}, "meaning": ${JSON.stringify(word.meaning)} }`)
            .join(',\n');
        return `        {\n${head}\n            "words": [\n${words}\n            ]\n        }`;
    });
    return `{\n    "meta": ${JSON.stringify(data.meta, null, 4).replace(/\n/g, '\n    ')},\n    "packs": [\n${packs.join(',\n')}\n    ]\n}\n`;
}

fs.writeFileSync(OUT, stringifySeed(seed));

for (const row of report) {
    console.log(`${row.pack}：${row.words} 个词${row.skipped ? `，去重 ${row.skipped} 个` : ''}`);
}
console.log(`共 ${packs.length} 个词包，写入 ${path.relative(ROOT, OUT)}`);
