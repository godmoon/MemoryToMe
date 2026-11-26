import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, insertWord } from './db.js';
import { normKey } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const textbookData = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed/textbooks.json'), 'utf8'));
const englishData = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed/english.json'), 'utf8'));

export const books = textbookData.books;
export const bookMeta = textbookData.meta;
export const englishPacks = englishData.packs;

const bookMap = new Map(books.map((book) => [book.id, book]));
const englishMap = new Map(englishPacks.map((pack) => [pack.id, pack]));

function existingZhNorms() {
    return new Set(
        db
            .prepare("SELECT norm FROM words WHERE lang = 'zh'")
            .all()
            .map((row) => row.norm),
    );
}

export function listBooks() {
    const existing = existingZhNorms();
    return books.map((book) => ({
        id: book.id,
        title: book.title,
        grade: book.grade,
        semester: book.semester,
        publisher: book.publisher,
        edition: book.edition,
        charCount: book.chars.length,
        wordCount: book.words.length,
        importedChars: book.chars.filter((char) => existing.has(normKey(char.text, 'zh'))).length,
        importedWords: book.words.filter((word) => existing.has(normKey(word.text, 'zh'))).length,
    }));
}

export function getBook(id) {
    const book = bookMap.get(id);
    if (!book) return null;
    const existing = existingZhNorms();
    return {
        ...book,
        chars: book.chars.map((char) => ({ ...char, imported: existing.has(normKey(char.text, 'zh')) })),
        words: book.words.map((word) => ({ ...word, imported: existing.has(normKey(word.text, 'zh')) })),
    };
}

export function importBook(id, options = {}) {
    const book = bookMap.get(id);
    if (!book) return null;
    const types = Array.isArray(options.types) && options.types.length ? options.types : ['char', 'word'];
    const charSet = Array.isArray(options.chars) ? new Set(options.chars) : null;
    const wordSet = Array.isArray(options.words) ? new Set(options.words) : null;
    const source = (type) => JSON.stringify({ book: book.id, title: book.title, type });

    const result = { inserted: 0, duplicates: 0, invalid: 0, chars: 0, words: 0 };

    if (types.includes('char')) {
        for (const char of book.chars) {
            if (charSet && !charSet.has(char.text)) continue;
            const note = [char.sentence, char.words.length ? `组词：${char.words.join('、')}` : '']
                .filter(Boolean)
                .join('　');
            const outcome = insertWord({
                text: char.text,
                pinyin: char.pinyin,
                note,
                lang: 'zh',
                category: '识字',
                source: source('char'),
            });
            if (outcome.inserted) {
                result.inserted += 1;
                result.chars += 1;
            } else if (outcome.reason === 'duplicate') result.duplicates += 1;
            else result.invalid += 1;
        }
    }

    if (types.includes('word')) {
        for (const word of book.words) {
            if (wordSet && !wordSet.has(word.text)) continue;
            const outcome = insertWord({
                text: word.text,
                pinyin: word.pinyin,
                lang: 'zh',
                category: '词语',
                source: source('word'),
            });
            if (outcome.inserted) {
                result.inserted += 1;
                result.words += 1;
            } else if (outcome.reason === 'duplicate') result.duplicates += 1;
            else result.invalid += 1;
        }
    }

    return result;
}

export function listEnglishPacks() {
    return englishPacks.map((pack) => ({
        id: pack.id,
        title: pack.title,
        lang: 'en',
        count: pack.words.length,
        imported: pack.words.filter((word) => {
            const row = db.prepare('SELECT 1 FROM words WHERE norm = ? AND lang = ?').get(word.text.toLowerCase(), 'en');
            return !!row;
        }).length,
    }));
}

export function importEnglishPack(id) {
    const pack = englishMap.get(id);
    if (!pack) return null;
    const result = { inserted: 0, duplicates: 0, invalid: 0 };
    for (const word of pack.words) {
        const outcome = insertWord({
            text: word.text,
            meaning: word.meaning,
            lang: 'en',
            category: '英语',
            source: JSON.stringify({ book: pack.id, title: pack.title, type: 'word' }),
        });
        if (outcome.inserted) result.inserted += 1;
        else if (outcome.reason === 'duplicate') result.duplicates += 1;
        else result.invalid += 1;
    }
    return result;
}
