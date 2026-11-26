/**
 * 生成内置教材词库。
 *
 * 数据来源（均为公开整理资料，仅作学习用途）：
 *  - 生字、拼音、组词、例句：https://github.com/lm16688/xiaoxuewordslearning
 *  - 词语表：https://github.com/7jul/yuwen_words
 *
 * 用法：
 *   node scripts/build-seed.mjs /tmp/lm-data.json /tmp/words.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { pinyin } from 'pinyin-pro';

const lmPath = process.argv[2] || '/tmp/lm-data.json';
const wordsPath = process.argv[3] || '/tmp/words.json';

const lm = JSON.parse(fs.readFileSync(lmPath, 'utf8'));
const officialWords = JSON.parse(fs.readFileSync(wordsPath, 'utf8'));

const BOOKS = [
    { grade: 1, semester: '上', key: '一年级上册', id: 'rj-1a' },
    { grade: 1, semester: '下', key: '一年级下册', id: 'rj-1b' },
    { grade: 2, semester: '上', key: '二年级上册', id: 'rj-2a' },
    { grade: 2, semester: '下', key: '二年级下册', id: 'rj-2b' },
    { grade: 3, semester: '上', key: '三年级上册', id: 'rj-3a' },
    { grade: 3, semester: '下', key: '三年级下册', id: 'rj-3b' },
    { grade: 4, semester: '上', key: '四年级上册', id: 'rj-4a' },
    { grade: 4, semester: '下', key: '四年级下册', id: 'rj-4b' },
    { grade: 5, semester: '上', key: '五年级上册', id: 'rj-5a' },
    { grade: 5, semester: '下', key: '五年级下册', id: 'rj-5b' },
    { grade: 6, semester: '上', key: '六年级上册', id: 'rj-6a' },
    { grade: 6, semester: '下', key: '六年级下册', id: 'rj-6b' },
];

function normPinyin(value) {
    return String(value || '')
        .replace(/ɡ/g, 'g')
        .replace(/ü/g, 'ü')
        .replace(/\s+/g, ' ')
        .trim();
}

function wordPinyin(text) {
    const arr = pinyin(text, { toneType: 'symbol', type: 'array', nonZh: 'consecutive' });
    return normPinyin(arr.join(' '));
}

const ZH_ONLY = /^[\u4e00-\u9fff]+$/;

const lmByGrade = new Map(lm.map((book) => [book.grade, book]));

const textbooks = BOOKS.map((book) => {
    const source = lmByGrade.get(book.key);
    if (!source) throw new Error('缺少教材数据：' + book.key);

    const seenChars = new Set();
    const chars = [];
    for (const item of source.characters) {
        const text = String(item.word || '').trim();
        if (!text || seenChars.has(text) || !ZH_ONLY.test(text)) continue;
        seenChars.add(text);
        const words = [...new Set((item.words || []).map((w) => String(w).trim()).filter((w) => w && w !== text && ZH_ONLY.test(w)))].slice(0, 4);
        chars.push({
            text,
            pinyin: normPinyin(item.pinyin),
            words,
            sentence: String(item.sentence || '').trim(),
        });
    }

    // 词语表：优先使用官方整理词语表；没有的册次用生字组词补齐。
    const officialKey = `${book.key}词语表`;
    const seenWords = new Set();
    const words = [];
    const addWord = (text) => {
        const value = String(text || '').trim();
        if (!value || value.length < 2 || !ZH_ONLY.test(value) || seenWords.has(value)) return;
        seenWords.add(value);
        words.push({ text: value, pinyin: wordPinyin(value) });
    };

    if (Array.isArray(officialWords[officialKey]) && officialWords[officialKey].length) {
        officialWords[officialKey].forEach(addWord);
    } else {
        for (const char of chars) char.words.forEach(addWord);
    }

    return {
        id: book.id,
        publisher: '统编版（人教版）',
        edition: '2024',
        grade: book.grade,
        semester: book.semester,
        title: book.key,
        chars,
        words,
    };
});

const out = {
    meta: {
        title: '统编版小学语文生字词库（整理版）',
        note: '依据公开整理资料生成，供听写练习使用。字表与教材如有出入，可在词库中直接修改。',
        sources: [
            'https://github.com/lm16688/xiaoxuewordslearning',
            'https://github.com/7jul/yuwen_words',
        ],
        builtAt: new Date().toISOString(),
    },
    books: textbooks,
};

const outPath = path.join(process.cwd(), 'server/seed/textbooks.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('已写入', outPath);
for (const book of textbooks) {
    console.log(`${book.title}: ${book.chars.length} 字 / ${book.words.length} 词`);
}
