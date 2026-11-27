import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { todayStr, normKey } from './util.js';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'memorytome.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    norm TEXT NOT NULL,
    pinyin TEXT NOT NULL DEFAULT '',
    lang TEXT NOT NULL DEFAULT 'zh',
    meaning TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '自定义',
    tags TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    stage INTEGER NOT NULL DEFAULT 0,
    interval_days INTEGER NOT NULL DEFAULT 0,
    ease REAL NOT NULL DEFAULT 2.5,
    due_date TEXT,
    last_review TEXT,
    first_seen TEXT,
    correct_count INTEGER NOT NULL DEFAULT 0,
    wrong_count INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    advance_rank INTEGER NOT NULL DEFAULT 0,
    UNIQUE (norm, lang)
);

CREATE INDEX IF NOT EXISTS idx_words_due ON words(lang, archived, status, due_date);
CREATE INDEX IF NOT EXISTS idx_words_created ON words(created_at);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    lang TEXT NOT NULL DEFAULT 'zh',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    finished_at TEXT,
    total INTEGER NOT NULL DEFAULT 0,
    correct INTEGER NOT NULL DEFAULT 0,
    wrong INTEGER NOT NULL DEFAULT 0,
    new_count INTEGER NOT NULL DEFAULT 0,
    review_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    config TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date, lang);

CREATE TABLE IF NOT EXISTS session_items (
    session_id TEXT NOT NULL,
    word_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'review',
    result TEXT,
    chars_wrong TEXT NOT NULL DEFAULT '[]',
    answered_at TEXT,
    PRIMARY KEY (session_id, position),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    session_id TEXT,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    result TEXT NOT NULL,
    chars_wrong TEXT NOT NULL DEFAULT '[]',
    interval_before INTEGER NOT NULL DEFAULT 0,
    interval_after INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reviews_word ON reviews(word_id, date);
CREATE INDEX IF NOT EXISTS idx_reviews_date ON reviews(date);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`);

// 旧库没有新列时补上，避免升级后启动失败
function ensureColumn(table, column, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((item) => item.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

// advance_rank > 0 表示被“提前”，数字越小越先复习
ensureColumn('words', 'advance_rank', 'INTEGER NOT NULL DEFAULT 0');

export const DEFAULT_SETTINGS = {
    dailyTotal: 20,
    newPerDay: 5,
    maxNew: 10,
    order: 'mixed',
    showPinyin: true,
    autoSpeak: true,
    speechRate: 0.85,
    voiceURI: '',
    enVoiceURI: '',
    theme: 'paper',
    lang: 'zh',
    showMeaning: true,
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

function readSetting(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row) return undefined;
    try {
        return JSON.parse(row.value);
    } catch {
        return row.value;
    }
}

export function getSettings() {
    const result = {};
    for (const key of SETTING_KEYS) {
        const value = readSetting(key);
        result[key] = value === undefined ? DEFAULT_SETTINGS[key] : value;
    }
    return result;
}

export function saveSettings(patch) {
    const stmt = db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    for (const key of SETTING_KEYS) {
        if (patch[key] === undefined) continue;
        stmt.run(key, JSON.stringify(patch[key]));
    }
    return getSettings();
}

export function wordFromRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        text: row.text,
        pinyin: row.pinyin,
        lang: row.lang,
        meaning: row.meaning,
        note: row.note,
        category: row.category,
        tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
        source: row.source,
        createdAt: row.created_at,
        status: row.status,
        stage: row.stage,
        intervalDays: row.interval_days,
        ease: row.ease,
        dueDate: row.due_date,
        lastReview: row.last_review,
        firstSeen: row.first_seen,
        correctCount: row.correct_count,
        wrongCount: row.wrong_count,
        streak: row.streak,
        lapses: row.lapses,
        archived: !!row.archived,
        advanceRank: row.advance_rank || 0,
        accuracy:
            row.correct_count + row.wrong_count > 0
                ? Math.round((row.correct_count / (row.correct_count + row.wrong_count)) * 100)
                : null,
    };
}

export function getWord(id) {
    return wordFromRow(db.prepare('SELECT * FROM words WHERE id = ?').get(Number(id)));
}

export function findWord(text, lang = 'zh') {
    return wordFromRow(
        db.prepare('SELECT * FROM words WHERE norm = ? AND lang = ?').get(normKey(text, lang), lang),
    );
}

export function listAllActiveWords(lang) {
    const rows = db
        .prepare('SELECT * FROM words WHERE lang = ? AND archived = 0 AND status != ? ORDER BY id ASC')
        .all(lang, 'suspended');
    return rows.map(wordFromRow);
}

/**
 * 插入一个词。已存在时返回 { inserted:false, word }。
 */
export function insertWord(input) {
    const text = String(input.text || '').trim();
    const lang = input.lang === 'en' ? 'en' : 'zh';
    if (!text) return { inserted: false, word: null, reason: 'empty' };
    const norm = normKey(text, lang);
    const existing = db.prepare('SELECT * FROM words WHERE norm = ? AND lang = ?').get(norm, lang);
    if (existing) return { inserted: false, word: wordFromRow(existing), reason: 'duplicate' };

    const now = new Date().toISOString();
    const result = db
        .prepare(
            `INSERT INTO words
             (text, norm, pinyin, lang, meaning, note, category, tags, source, created_at, first_seen)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
            text,
            norm,
            String(input.pinyin || '').trim(),
            lang,
            String(input.meaning || '').trim(),
            String(input.note || '').trim(),
            String(input.category || '自定义').trim() || '自定义',
            Array.isArray(input.tags) ? input.tags.join(',') : String(input.tags || '').trim(),
            String(input.source || '').trim(),
            now,
            todayStr(),
        );
    return {
        inserted: true,
        word: getWord(Number(result.lastInsertRowid)),
        reason: null,
    };
}

export function countWords(where = '', params = []) {
    return db.prepare(`SELECT COUNT(*) AS n FROM words ${where}`).get(...params).n;
}

export function deleteWord(id) {
    return db.prepare('DELETE FROM words WHERE id = ?').run(Number(id)).changes > 0;
}

export function insertReview({ wordId, sessionId, date, result, charsWrong, intervalBefore, intervalAfter }) {
    db.prepare(
        `INSERT INTO reviews
         (word_id, session_id, date, created_at, result, chars_wrong, interval_before, interval_after)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
        wordId,
        sessionId || null,
        date,
        new Date().toISOString(),
        result,
        JSON.stringify(charsWrong || []),
        intervalBefore || 0,
        intervalAfter || 0,
    );
}

export function getReviewDates() {
    return db
        .prepare("SELECT date, COUNT(*) AS n, SUM(result = 'correct') AS correct FROM reviews GROUP BY date ORDER BY date")
        .all();
}
