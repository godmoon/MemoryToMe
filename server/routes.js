import express from 'express';
import crypto from 'node:crypto';
import {
    db,
    DEFAULT_SETTINGS,
    deleteWord,
    findWord,
    getSettings,
    getWord,
    insertReview,
    insertWord,
    saveSettings,
    wordFromRow,
} from './db.js';
import { buildExtraPlan, buildPlan, KIND_LABEL, scheduleWord, summarizePlan } from './srs.js';
import { autoPinyin, splitPinyin } from './pinyin.js';
import { parseImport } from './parse.js';
import { addDays, clamp, diffDays, normKey, normalizeText, safeJson, todayStr } from './util.js';
import { getBook, importBook, importEnglishPack, listBooks, listEnglishPacks, bookMeta } from './textbooks.js';

export const api = express.Router();

const STATUS_LABEL = {
    new: '未学习',
    learning: '学习中',
    review: '复习中',
    mastered: '已掌握',
    suspended: '已暂停',
};

function wrap(handler) {
    return (req, res, next) => {
        try {
            handler(req, res, next);
        } catch (error) {
            next(error);
        }
    };
}

function fail(res, status, message) {
    return res.status(status).json({ error: message });
}

function withMeta(word) {
    if (!word) return null;
    const today = todayStr();
    return {
        ...word,
        statusLabel: STATUS_LABEL[word.status] || word.status,
        dueInDays: word.dueDate ? diffDays(today, word.dueDate) : null,
        overdue: !!(word.dueDate && word.dueDate < today && word.status !== 'new'),
        sourceInfo: safeJson(word.source, null),
    };
}

function allWords(lang) {
    const rows = db
        .prepare('SELECT * FROM words WHERE lang = ? AND archived = 0 AND status != ? ORDER BY id')
        .all(lang, 'suspended');
    return rows.map(wordFromRow);
}

/* ------------------------------- 基础信息 ------------------------------- */

api.get(
    '/health',
    wrap((req, res) => res.json({ ok: true, time: new Date().toISOString() })),
);

api.get(
    '/bootstrap',
    wrap((req, res) => {
        const settings = getSettings();
        const today = todayStr();
        const lang = req.query.lang === 'en' ? 'en' : 'zh';
        const active = findActiveSession(lang, today);
        const total = db.prepare('SELECT COUNT(*) AS n FROM words WHERE archived = 0').get().n;
        const dueToday = db
            .prepare(
                "SELECT COUNT(*) AS n FROM words WHERE archived = 0 AND lang = ? AND status NOT IN ('new','suspended') AND due_date <= ?",
            )
            .get(lang, today).n;
        const newWords = db
            .prepare("SELECT COUNT(*) AS n FROM words WHERE archived = 0 AND lang = ? AND status = 'new'")
            .get(lang).n;
        const mastered = db
            .prepare("SELECT COUNT(*) AS n FROM words WHERE archived = 0 AND lang = ? AND status = 'mastered'")
            .get(lang).n;
        res.json({
            settings,
            stats: { total, dueToday, newWords, mastered, activeSessionId: active ? active.id : null },
            books: listBooks(),
            englishPacks: listEnglishPacks(),
            bookMeta,
        });
    }),
);

api.get(
    '/settings',
    wrap((req, res) => res.json(getSettings())),
);

api.patch(
    '/settings',
    wrap((req, res) => {
        const body = req.body || {};
        const patch = {};
        if (body.dailyTotal !== undefined) patch.dailyTotal = clamp(body.dailyTotal, 1, 100);
        if (body.newPerDay !== undefined) patch.newPerDay = clamp(body.newPerDay, 0, 50);
        if (body.maxNew !== undefined) patch.maxNew = clamp(body.maxNew, 0, 50);
        if (body.order !== undefined) {
            patch.order = ['mixed', 'reviews-first', 'new-first'].includes(body.order) ? body.order : 'mixed';
        }
        if (body.showPinyin !== undefined) patch.showPinyin = !!body.showPinyin;
        if (body.autoSpeak !== undefined) patch.autoSpeak = !!body.autoSpeak;
        if (body.speechRate !== undefined) patch.speechRate = Math.min(1.5, Math.max(0.5, Number(body.speechRate) || 0.85));
        if (body.voiceURI !== undefined) patch.voiceURI = String(body.voiceURI || '');
        if (body.enVoiceURI !== undefined) patch.enVoiceURI = String(body.enVoiceURI || '');
        if (body.theme !== undefined) patch.theme = ['paper', 'night', 'mint'].includes(body.theme) ? body.theme : 'paper';
        if (body.lang !== undefined) patch.lang = body.lang === 'en' ? 'en' : 'zh';
        if (body.showMeaning !== undefined) patch.showMeaning = !!body.showMeaning;
        const settings = saveSettings(patch);
        // 改小每日总词量后，今天的进行中会话立即收紧，不用等下次打开页面
        if (patch.dailyTotal !== undefined) {
            const today = todayStr();
            for (const lang of ['zh', 'en']) {
                const active = findActiveSession(lang, today);
                if (active) trimSessionToDailyTotal(active, settings);
            }
        }
        res.json(settings);
    }),
);

/* --------------------------------- 词库 --------------------------------- */

api.get(
    '/words',
    wrap((req, res) => {
        const today = todayStr();
        const lang = ['zh', 'en'].includes(req.query.lang) ? req.query.lang : null;
        const q = normalizeText(req.query.q || '');
        const status = String(req.query.status || 'all');
        const category = normalizeText(req.query.category || '');
        const book = normalizeText(req.query.book || '');
        const sort = String(req.query.sort || 'due');
        const page = clamp(req.query.page || 1, 1, 100000);
        const limit = clamp(req.query.limit || 30, 1, 100);
        // 暂停的词 archived = 1，查看“已暂停”时要一起带出来
        const includeArchived = req.query.includeArchived === '1' || status === 'suspended';

        const where = [];
        const params = [];
        if (!includeArchived) where.push('archived = 0');
        if (lang) {
            where.push('lang = ?');
            params.push(lang);
        }
        if (q) {
            where.push('(text LIKE ? OR pinyin LIKE ? OR meaning LIKE ?)');
            params.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }
        if (status === 'due') {
            where.push("status NOT IN ('new','suspended') AND due_date <= ?");
            params.push(today);
        } else if (status === 'wrong') {
            where.push('wrong_count > 0');
        } else if (status && status !== 'all') {
            where.push('status = ?');
            params.push(status);
        }
        if (category) {
            where.push('category = ?');
            params.push(category);
        }
        if (book) {
            where.push('source LIKE ?');
            params.push(`%"book":"${book}"%`);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        let orderSql = 'due_date IS NULL, due_date ASC, id ASC';
        if (sort === 'recent') orderSql = 'created_at DESC, id DESC';
        if (sort === 'wrong') orderSql = 'wrong_count DESC, lapses DESC, id ASC';
        if (sort === 'accuracy') orderSql = 'CASE WHEN correct_count + wrong_count = 0 THEN 999 ELSE correct_count * 1.0 / (correct_count + wrong_count) END ASC, id ASC';
        if (sort === 'text') orderSql = 'text COLLATE NOCASE ASC';
        if (sort === 'reviews') orderSql = '(correct_count + wrong_count) DESC, id ASC';

        // 批量管理用：只返回当前筛选结果的 id 和状态，不分页
        if (req.query.idsOnly === '1') {
            const rows = db
                .prepare(`SELECT id, status, archived FROM words ${whereSql} ORDER BY ${orderSql}`)
                .all(...params);
            return res.json({ items: rows, ids: rows.map((row) => row.id), total: rows.length });
        }

        const total = db.prepare(`SELECT COUNT(*) AS n FROM words ${whereSql}`).get(...params).n;
        const rows = db
            .prepare(`SELECT * FROM words ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`)
            .all(...params, limit, (page - 1) * limit);
        const items = rows.map(wordFromRow).map(withMeta);

        if (items.length) {
            const ids = items.map((w) => w.id);
            const since = addDays(today, -20);
            const marks = db
                .prepare(
                    `SELECT word_id, date, result FROM reviews WHERE word_id IN (${ids.map(() => '?').join(',')}) AND date >= ? ORDER BY date`,
                )
                .all(...ids, since);
            const map = new Map();
            for (const mark of marks) {
                if (!map.has(mark.word_id)) map.set(mark.word_id, {});
                const day = map.get(mark.word_id);
                day[mark.date] = day[mark.date] === 'wrong' || mark.result === 'wrong' ? 'wrong' : 'correct';
            }
            for (const item of items) item.recent = map.get(item.id) || {};
        }

        res.json({
            items,
            total,
            page,
            pages: Math.max(1, Math.ceil(total / limit)),
            categories: db
                .prepare('SELECT category, COUNT(*) AS n FROM words WHERE archived = 0 GROUP BY category ORDER BY n DESC')
                .all(),
        });
    }),
);

api.get(
    '/words/:id',
    wrap((req, res) => {
        const word = getWord(req.params.id);
        if (!word) return fail(res, 404, '没有找到这个词');
        const today = todayStr();
        const events = db
            .prepare('SELECT * FROM reviews WHERE word_id = ? ORDER BY date DESC, id DESC LIMIT 80')
            .all(word.id);
        const grouped = db
            .prepare(
                "SELECT date, COUNT(*) AS n, SUM(result = 'correct') AS correct, SUM(result = 'wrong') AS wrong FROM reviews WHERE word_id = ? GROUP BY date ORDER BY date",
            )
            .all(word.id);
        const byDate = new Map(grouped.map((row) => [row.date, row]));

        const start = addDays(word.firstSeen || word.createdAt.slice(0, 10), -3);
        const end = addDays(today, 30);
        const days = [];
        let cursor = start;
        let guard = 0;
        while (cursor <= end && guard < 220) {
            const stat = byDate.get(cursor);
            days.push({
                date: cursor,
                correct: stat ? stat.correct : 0,
                wrong: stat ? stat.wrong : 0,
                due: word.dueDate === cursor,
                added: (word.firstSeen || '') === cursor,
            });
            cursor = addDays(cursor, 1);
            guard += 1;
        }

        const charWrong = new Map();
        for (const event of events) {
            for (const index of safeJson(event.chars_wrong, [])) {
                charWrong.set(index, (charWrong.get(index) || 0) + 1);
            }
        }
        const chars = Array.from(word.text).map((char, index) => ({
            char,
            index,
            wrong: charWrong.get(index) || 0,
        }));

        res.json({
            ...withMeta(word),
            timeline: { start, end, days },
            events: events.map((event) => ({
                id: event.id,
                date: event.date,
                result: event.result,
                charsWrong: safeJson(event.chars_wrong, []),
                intervalBefore: event.interval_before,
                intervalAfter: event.interval_after,
            })),
            chars,
            stats: {
                reviews: word.correctCount + word.wrongCount,
                accuracy: word.accuracy,
                nextDue: word.dueDate,
                dueInDays: word.dueDate ? diffDays(today, word.dueDate) : null,
            },
        });
    }),
);

/**
 * 汇总全库标红字。只统计 chars_wrong 里有明确字序号的记录；
 * 整词标红在提交时会展开成所有字，所以也会统计进来。
 */
function collectWrongChars(filter = {}) {
    const rows = db
        .prepare(
            `SELECT r.word_id, r.date, r.chars_wrong, w.text, w.pinyin
             FROM reviews r JOIN words w ON w.id = r.word_id
             WHERE w.lang = 'zh'
             ORDER BY r.date DESC`,
        )
        .all();
    const map = new Map();
    for (const row of rows) {
        const textChars = Array.from(row.text);
        const syllables = row.pinyin ? splitPinyin(row.pinyin) : null;
        for (const index of safeJson(row.chars_wrong, [])) {
            const char = textChars[index];
            if (!char) continue;
            if (filter.char && char !== filter.char) continue;
            let entry = map.get(char);
            if (!entry) {
                entry = { char, pinyin: '', count: 0, lastDate: row.date, words: new Map() };
                map.set(char, entry);
            }
            entry.count += 1;
            if (row.date > entry.lastDate) entry.lastDate = row.date;
            let word = entry.words.get(row.word_id);
            if (!word) {
                word = { id: row.word_id, text: row.text, pinyin: row.pinyin || '', count: 0 };
                entry.words.set(row.word_id, word);
            }
            word.count += 1;
            if (!entry.pinyin && syllables && syllables.length === textChars.length) {
                entry.pinyin = syllables[index] || '';
            }
        }
    }
    for (const entry of map.values()) {
        if (!entry.pinyin) entry.pinyin = autoPinyin(entry.char);
        entry.words = [...entry.words.values()].sort(
            (a, b) => b.count - a.count || a.text.localeCompare(b.text, 'zh'),
        );
    }
    return map;
}

api.get(
    '/chars/wrong',
    wrap((req, res) => {
        const q = normalizeText(req.query.q || '').toLowerCase();
        const sort = ['count', 'recent', 'char'].includes(String(req.query.sort)) ? String(req.query.sort) : 'count';
        const limit = clamp(req.query.limit || 200, 1, 500);
        let list = [...collectWrongChars().values()];
        if (q) {
            list = list.filter(
                (entry) =>
                    entry.char.includes(q) ||
                    entry.pinyin.toLowerCase().includes(q) ||
                    entry.words.some((word) => word.text.includes(q)),
            );
        }
        if (sort === 'recent') {
            list.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.count - a.count);
        } else if (sort === 'char') {
            list.sort((a, b) => a.pinyin.localeCompare(b.pinyin, 'en') || a.char.localeCompare(b.char, 'zh'));
        } else {
            list.sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate));
        }
        const totalCount = list.reduce((sum, entry) => sum + entry.count, 0);
        res.json({
            total: list.length,
            totalCount,
            chars: list.slice(0, limit).map((entry) => ({
                ...entry,
                words: entry.words.slice(0, 12),
            })),
        });
    }),
);

api.get(
    '/chars/:char',
    wrap((req, res) => {
        const char = normalizeText(req.params.char);
        if (Array.from(char).length !== 1) return fail(res, 400, '一次只能查一个字');
        const entry = collectWrongChars({ char }).get(char);
        const rows = db
            .prepare(
                "SELECT id, text, pinyin, status FROM words WHERE lang = 'zh' AND text LIKE ? ORDER BY id LIMIT 100",
            )
            .all(`%${char}%`);
        const wrongByWord = new Map((entry?.words || []).map((word) => [word.id, word.count]));
        const words = rows
            .filter((row) => Array.from(row.text).includes(char))
            .map((row) => ({
                id: row.id,
                text: row.text,
                pinyin: row.pinyin || '',
                status: row.status,
                wrongCount: wrongByWord.get(row.id) || 0,
            }))
            .sort((a, b) => b.wrongCount - a.wrongCount || a.id - b.id)
            .slice(0, 30);
        res.json({
            char,
            pinyin: entry?.pinyin || autoPinyin(char),
            count: entry?.count || 0,
            lastDate: entry?.lastDate || null,
            words,
        });
    }),
);

api.post(
    '/words',
    wrap((req, res) => {
        const body = req.body || {};
        const lang = body.lang === 'en' ? 'en' : 'zh';
        const text = normalizeText(body.text);
        if (!text) return fail(res, 400, '请输入词语');
        if (lang === 'zh' && !/[\u4e00-\u9fff]/.test(text)) return fail(res, 400, '中文词需要包含汉字');
        if (lang === 'en' && !/^[A-Za-z][A-Za-z' -]*$/.test(text)) return fail(res, 400, '英文单词格式不正确');
        const pinyin = lang === 'zh' ? normalizeText(body.pinyin) || autoPinyin(text, lang) : '';
        const outcome = insertWord({
            text,
            pinyin,
            lang,
            meaning: normalizeText(body.meaning),
            note: normalizeText(body.note),
            category: normalizeText(body.category) || '自定义',
            tags: body.tags,
            source: body.source || '',
        });
        if (!outcome.inserted) return fail(res, 409, '词库里已经有这个词了');
        res.status(201).json(withMeta(outcome.word));
    }),
);

api.patch(
    '/words/:id',
    wrap((req, res) => {
        const word = getWord(req.params.id);
        if (!word) return fail(res, 404, '没有找到这个词');
        const body = req.body || {};
        const fields = [];
        const params = [];
        const set = (column, value) => {
            fields.push(`${column} = ?`);
            params.push(value);
        };
        if (body.text !== undefined) {
            const text = normalizeText(body.text);
            if (!text) return fail(res, 400, '词语不能为空');
            set('text', text);
            set('norm', normKey(text, word.lang));
        }
        if (body.pinyin !== undefined) set('pinyin', normalizeText(body.pinyin));
        if (body.meaning !== undefined) set('meaning', normalizeText(body.meaning));
        if (body.note !== undefined) set('note', normalizeText(body.note));
        if (body.category !== undefined) set('category', normalizeText(body.category) || '自定义');
        if (body.tags !== undefined) set('tags', Array.isArray(body.tags) ? body.tags.join(',') : normalizeText(body.tags));
        if (body.status !== undefined && ['new', 'learning', 'review', 'mastered', 'suspended'].includes(body.status)) {
            set('status', body.status);
            if (body.status === 'suspended') {
                set('archived', 1);
                // 暂停后不再占用“提前复习”的位置
                set('advance_rank', 0);
            }
            if (body.status !== 'suspended') set('archived', 0);
        }
        if (body.dueDate !== undefined) set('due_date', body.dueDate || null);
        if (!fields.length) return res.json(withMeta(word));
        try {
            db.prepare(`UPDATE words SET ${fields.join(', ')} WHERE id = ?`).run(...params, word.id);
        } catch (error) {
            if (String(error.message).includes('UNIQUE')) return fail(res, 409, '词库里已经有这个词了');
            throw error;
        }
        res.json(withMeta(getWord(word.id)));
    }),
);

api.delete(
    '/words/:id',
    wrap((req, res) => {
        const ok = deleteWord(req.params.id);
        if (!ok) return fail(res, 404, '没有找到这个词');
        repairActiveSessions();
        res.json({ ok: true });
    }),
);

api.post(
    '/words/batch',
    wrap((req, res) => {
        const raw = Array.isArray(req.body?.ids) ? req.body.ids : [];
        const ids = [...new Set(raw.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
        const action = req.body?.action;
        if (!ids.length) return fail(res, 400, '先选择词语');
        if (ids.length > 10000) return fail(res, 400, '一次最多处理 10000 个词');
        if (!['reset', 'suspend', 'resume', 'delete'].includes(action)) {
            return fail(res, 400, '不支持的批量操作');
        }

        const placeholders = ids.map(() => '?').join(',');
        let affected = 0;
        db.exec('BEGIN');
        try {
            if (action === 'delete') {
                affected = db.prepare(`DELETE FROM words WHERE id IN (${placeholders})`).run(...ids).changes;
            } else if (action === 'reset') {
                affected = db
                    .prepare(
                        `UPDATE words SET status = 'new', stage = 0, interval_days = 0, ease = 2.5, due_date = NULL,
                         last_review = NULL, correct_count = 0, wrong_count = 0, streak = 0, lapses = 0, archived = 0,
                         advance_rank = 0
                         WHERE id IN (${placeholders})`,
                    )
                    .run(...ids).changes;
                db.prepare(`DELETE FROM reviews WHERE word_id IN (${placeholders})`).run(...ids);
            } else if (action === 'suspend') {
                affected = db
                    .prepare(
                        `UPDATE words SET status = 'suspended', archived = 1, advance_rank = 0 WHERE id IN (${placeholders})`,
                    )
                    .run(...ids).changes;
            } else {
                affected = db
                    .prepare(`UPDATE words SET status = 'learning', archived = 0, due_date = ? WHERE id IN (${placeholders})`)
                    .run(todayStr(), ...ids).changes;
            }
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
        if (action === 'delete') repairActiveSessions();
        res.json({ ok: true, action, affected });
    }),
);

api.post(
    '/words/match',
    wrap((req, res) => {
        const raw = Array.isArray(req.body?.texts) ? req.body.texts : [];
        const texts = [...new Set(raw.map((item) => normalizeText(item)).filter(Boolean))];
        if (!texts.length) return fail(res, 400, '先输入要选的词语');
        if (texts.length > 5000) return fail(res, 400, '一次最多匹配 5000 个词');

        // 英文按小写匹配，中文保持原样；两种写法都查一遍
        const norms = [...new Set(texts.flatMap((text) => [text, text.toLowerCase()]))];
        const placeholders = norms.map(() => '?').join(',');
        const rows = db
            .prepare(
                `SELECT id, text, norm, lang, status, archived FROM words
                 WHERE norm IN (${placeholders}) ORDER BY id`,
            )
            .all(...norms);
        const found = new Set(rows.map((row) => row.norm));
        const unmatched = texts.filter((text) => !found.has(text) && !found.has(text.toLowerCase()));
        res.json({
            items: rows.map((row) => ({
                id: row.id,
                text: row.text,
                lang: row.lang,
                status: row.status,
                archived: !!row.archived,
            })),
            matched: rows.length,
            unmatched,
            total: texts.length,
        });
    }),
);

api.post(
    '/words/batch/advance',
    wrap((req, res) => {
        const raw = Array.isArray(req.body?.ids) ? req.body.ids : [];
        const ids = [...new Set(raw.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
        if (!ids.length) return fail(res, 400, '先选择词语');
        if (ids.length > 10000) return fail(res, 400, '一次最多处理 10000 个词');

        const today = todayStr();
        const placeholders = ids.map(() => '?').join(',');
        const rows = db.prepare(`SELECT * FROM words WHERE id IN (${placeholders})`).all(...ids);
        const byId = new Map(rows.map((row) => [row.id, wordFromRow(row)]));

        // 按传入顺序分组，保持“越靠前越先复习”
        const groups = new Map();
        let skipped = 0;
        for (const id of ids) {
            const word = byId.get(id);
            if (!word || word.archived || word.status === 'suspended') {
                skipped += 1;
                continue;
            }
            if (!groups.has(word.lang)) groups.set(word.lang, []);
            groups.get(word.lang).push(word);
        }
        if (!groups.size) return fail(res, 400, '选中的词都在暂停中，先恢复学习再提前');

        /**
         * 把这些词标成今天到期，并放到该语言“提前队列”的最前面。
         * 已经在队列里的词整体后移，保证新选的词按顺序排在最前。
         */
        function queueWords(lang, words) {
            if (!words.length) return;
            const wordIds = words.map((word) => word.id);
            const marks = wordIds.map(() => '?').join(',');
            db.exec('BEGIN');
            try {
                db.prepare(
                    `UPDATE words SET advance_rank = advance_rank + ?
                     WHERE lang = ? AND advance_rank > 0 AND id NOT IN (${marks})`,
                ).run(words.length, lang, ...wordIds);
                const stmt = db.prepare(
                    `UPDATE words SET advance_rank = ?, due_date = ?,
                     status = CASE WHEN status = 'new' THEN 'learning' ELSE status END
                     WHERE id = ?`,
                );
                words.forEach((word, index) => stmt.run(index + 1, today, word.id));
                db.exec('COMMIT');
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        }

        let advanced = 0;
        const sessions = [];
        for (const [lang, words] of groups) {
            const active = findActiveSession(lang, today);
            if (!active) {
                // 没有进行中的练习时只排队，等下次点“听写”再出现
                queueWords(lang, words);
                advanced += words.length;
                continue;
            }

            // 今天已经答过的词不再重复安排，也不改它的到期时间
            const answered = new Set(
                db
                    .prepare('SELECT word_id FROM session_items WHERE session_id = ? AND result IS NOT NULL')
                    .all(active.id)
                    .map((item) => item.word_id),
            );
            const fresh = words.filter((word) => !answered.has(word.id));
            const added = mergeIntoSession(active.id, fresh);
            if (added) queueWords(lang, fresh);
            // 提前复习也要受“每天总词量”限制，超出部分留到下次
            const trimmed = trimSessionToDailyTotal(sessionRow(active.id), getSettings());
            const total = db.prepare('SELECT COUNT(*) AS n FROM session_items WHERE session_id = ?').get(trimmed.id).n;
            sessions.push({ id: trimmed.id, lang, added, total });
        }

        repairActiveSessions();
        res.json({ ok: true, skipped, advanced, sessions });
    }),
);

api.post(
    '/words/:id/snooze',
    wrap((req, res) => {
        const word = getWord(req.params.id);
        if (!word) return fail(res, 404, '没有找到这个词');
        const days = clamp(req.body?.days ?? 1, 1, 365);
        const due = addDays(todayStr(), days);
        db.prepare("UPDATE words SET due_date = ?, status = CASE WHEN status = 'new' THEN 'learning' ELSE status END WHERE id = ?").run(
            due,
            word.id,
        );
        res.json(withMeta(getWord(word.id)));
    }),
);

api.post(
    '/words/:id/review-now',
    wrap((req, res) => {
        const word = getWord(req.params.id);
        if (!word) return fail(res, 404, '没有找到这个词');
        const today = todayStr();
        db.prepare("UPDATE words SET due_date = ?, status = CASE WHEN status = 'new' THEN 'learning' ELSE status END WHERE id = ?").run(
            today,
            word.id,
        );
        res.json(withMeta(getWord(word.id)));
    }),
);

api.post(
    '/words/:id/reset',
    wrap((req, res) => {
        const word = getWord(req.params.id);
        if (!word) return fail(res, 404, '没有找到这个词');
        db.prepare(
            `UPDATE words SET status = 'new', stage = 0, interval_days = 0, ease = 2.5, due_date = NULL,
             last_review = NULL, correct_count = 0, wrong_count = 0, streak = 0, lapses = 0, archived = 0,
             advance_rank = 0 WHERE id = ?`,
        ).run(word.id);
        db.prepare('DELETE FROM reviews WHERE word_id = ?').run(word.id);
        res.json(withMeta(getWord(word.id)));
    }),
);

/* -------------------------------- 导入 --------------------------------- */

api.post(
    '/import/preview',
    wrap((req, res) => {
        const { text, lang, category, tags } = req.body || {};
        const parsed = parseImport(text, { lang, category, tags });
        if (parsed.error) return fail(res, 400, parsed.error);
        let existing = 0;
        for (const item of parsed.items) {
            if (findWord(item.text, item.lang)) existing += 1;
        }
        res.json({
            ...parsed,
            stats: { ...parsed.stats, existing, newCount: parsed.items.length - existing },
        });
    }),
);

api.post(
    '/import/commit',
    wrap((req, res) => {
        const body = req.body || {};
        const items = Array.isArray(body.items) ? body.items : [];
        if (!items.length) return fail(res, 400, '没有可导入的词');
        const source = body.source ? JSON.stringify(body.source) : '';
        const result = { inserted: 0, duplicates: 0, invalid: 0 };
        db.exec('BEGIN');
        try {
            for (const item of items) {
                const outcome = insertWord({
                    text: item.text,
                    pinyin: item.pinyin,
                    lang: item.lang === 'en' ? 'en' : 'zh',
                    meaning: item.meaning,
                    note: item.note,
                    category: item.category,
                    tags: item.tags,
                    source,
                });
                if (outcome.inserted) result.inserted += 1;
                else if (outcome.reason === 'duplicate') result.duplicates += 1;
                else result.invalid += 1;
            }
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
        res.json(result);
    }),
);

/* ------------------------------- 教材词库 ------------------------------- */

api.get(
    '/textbooks',
    wrap((req, res) => res.json({ meta: bookMeta, books: listBooks() })),
);

api.get(
    '/textbooks/:id',
    wrap((req, res) => {
        const book = getBook(req.params.id);
        if (!book) return fail(res, 404, '没有找到这本教材');
        res.json(book);
    }),
);

api.post(
    '/textbooks/:id/import',
    wrap((req, res) => {
        const result = importBook(req.params.id, req.body || {});
        if (!result) return fail(res, 404, '没有找到这本教材');
        res.json(result);
    }),
);

api.get(
    '/english',
    wrap((req, res) => res.json(listEnglishPacks())),
);

api.post(
    '/english/:id/import',
    wrap((req, res) => {
        const result = importEnglishPack(req.params.id);
        if (!result) return fail(res, 404, '没有找到这个词包');
        res.json(result);
    }),
);

/* -------------------------------- 听写会话 ------------------------------- */

function sessionRow(id) {
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

function sessionItems(sessionId) {
    const rows = db
        .prepare(
            `SELECT si.position, si.kind, si.result AS item_result, si.chars_wrong AS item_chars_wrong,
                    si.answered_at, w.*
             FROM session_items si JOIN words w ON w.id = si.word_id
             WHERE si.session_id = ? ORDER BY si.position`,
        )
        .all(sessionId);
    return rows.map((row) => ({
        position: row.position,
        kind: row.kind,
        kindLabel: KIND_LABEL[row.kind] || row.kind,
        result: row.item_result,
        charsWrong: safeJson(row.item_chars_wrong, []),
        answeredAt: row.answered_at,
        word: withMeta(wordFromRow(row)),
    }));
}

function sessionPayload(row) {
    if (!row) return null;
    return {
        id: row.id,
        date: row.date,
        lang: row.lang,
        status: row.status,
        createdAt: row.created_at,
        finishedAt: row.finished_at,
        total: row.total,
        correct: row.correct,
        wrong: row.wrong,
        newCount: row.new_count,
        reviewCount: row.review_count,
        errorCount: row.error_count,
        config: safeJson(row.config, {}),
        items: sessionItems(row.id),
    };
}

/**
 * 词被删除后，session_items 会级联删除，可能留下没有词的 active 会话。
 * 这里把空会话标记为 abandoned，并按实际词数修正剩余会话的数量。
 */
function repairActiveSessions() {
    const rows = db.prepare("SELECT id FROM sessions WHERE status = 'active'").all();
    if (!rows.length) return;
    const now = new Date().toISOString();
    for (const row of rows) {
        const counts = db
            .prepare('SELECT kind, COUNT(*) AS n FROM session_items WHERE session_id = ? GROUP BY kind')
            .all(row.id);
        const total = counts.reduce((sum, item) => sum + item.n, 0);
        if (!total) {
            db.prepare(
                "UPDATE sessions SET status = 'abandoned', finished_at = COALESCE(finished_at, ?) WHERE id = ?",
            ).run(now, row.id);
            continue;
        }
        const byKind = Object.fromEntries(counts.map((item) => [item.kind, item.n]));
        db.prepare(
            'UPDATE sessions SET total = ?, new_count = ?, review_count = ?, error_count = ? WHERE id = ?',
        ).run(total, byKind.new || 0, byKind.review || 0, byKind.error || 0, row.id);
    }
}

function findActiveSession(lang, date) {
    repairActiveSessions();
    return db
        .prepare(
            "SELECT * FROM sessions WHERE date = ? AND lang = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
        )
        .get(date, lang);
}

/**
 * 设置里的“每天总词量”包含新词和复习词。
 * 如果今天的进行中会话是在旧设置下生成的（例如提前复习一次排了 33 个），
 * 这里把超出总词量、还没批改的词从末尾去掉；已批改的词永远保留。
 * 额外听写（extra）不受每日总词量限制。
 */
function trimSessionToDailyTotal(session, settings) {
    if (!session || session.status !== 'active') return session;
    if (session.date !== todayStr()) return session;
    const config = safeJson(session.config, {});
    if (config.extra) return session;

    const target = clamp(settings.dailyTotal ?? 20, 1, 100);
    const rows = db
        .prepare('SELECT * FROM session_items WHERE session_id = ? ORDER BY position')
        .all(session.id);
    if (rows.length <= target) return session;

    // 已批改的词一定保留；剩下的名额按原顺序留给前面的未批改词
    const graded = rows.filter((row) => row.result);
    if (graded.length >= target) return session;
    const keep = new Set(graded.map((row) => row.position));
    let slots = target - graded.length;
    for (const row of rows) {
        if (keep.has(row.position)) continue;
        if (slots <= 0) break;
        keep.add(row.position);
        slots -= 1;
    }

    const kept = rows.filter((row) => keep.has(row.position));
    db.exec('BEGIN');
    try {
        db.prepare('DELETE FROM session_items WHERE session_id = ?').run(session.id);
        const stmt = db.prepare(
            `INSERT INTO session_items (session_id, word_id, position, kind, result, chars_wrong, answered_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        kept.forEach((row, index) => {
            stmt.run(session.id, row.word_id, index, row.kind, row.result, row.chars_wrong, row.answered_at);
        });
        const counts = { new: 0, review: 0, error: 0 };
        for (const row of kept) counts[row.kind] = (counts[row.kind] || 0) + 1;
        db.prepare(
            'UPDATE sessions SET total = ?, new_count = ?, review_count = ?, error_count = ? WHERE id = ?',
        ).run(kept.length, counts.new || 0, counts.review || 0, counts.error || 0, session.id);
        db.exec('COMMIT');
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
    return sessionRow(session.id);
}

/**
 * 把一批词挪到会话里“还没答”的最前面，保持传入顺序。
 * 已答过的词今天不再重复安排；position 是主键的一部分，
 * 所以先整表读出来、再按新顺序写回，避免边改边冲突。
 */
function mergeIntoSession(sessionId, words) {
    const rows = db
        .prepare('SELECT * FROM session_items WHERE session_id = ? ORDER BY position')
        .all(sessionId);
    const byWord = new Map(rows.map((row) => [row.word_id, row]));

    const movable = [];
    for (const word of words) {
        const row = byWord.get(word.id);
        if (row && row.result) continue; // 今天已经答过，不重复安排
        movable.push(word);
    }
    if (!movable.length) return 0;

    const movableIds = new Set(movable.map((word) => word.id));
    const entries = rows
        .filter((row) => !movableIds.has(row.word_id))
        .map((row) => ({
            wordId: row.word_id,
            kind: row.kind,
            result: row.result,
            charsWrong: row.chars_wrong,
            answeredAt: row.answered_at,
        }));

    let at = entries.findIndex((entry) => !entry.result);
    if (at < 0) at = entries.length;

    entries.splice(
        at,
        0,
        ...movable.map((word) => ({
            wordId: word.id,
            kind: byWord.get(word.id)?.kind || (word.status === 'new' ? 'new' : 'review'),
            result: null,
            charsWrong: '[]',
            answeredAt: null,
        })),
    );

    db.exec('BEGIN');
    try {
        db.prepare('DELETE FROM session_items WHERE session_id = ?').run(sessionId);
        const stmt = db.prepare(
            `INSERT INTO session_items (session_id, word_id, position, kind, result, chars_wrong, answered_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        entries.forEach((entry, index) =>
            stmt.run(sessionId, entry.wordId, index, entry.kind, entry.result, entry.charsWrong, entry.answeredAt),
        );
        db.exec('COMMIT');
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
    return movable.length;
}

function createSession({ lang, date, plan, settings, extra = false }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const newCount = plan.items.filter((item) => item.kind === 'new').length;
    const reviewCount = plan.items.filter((item) => item.kind === 'review').length;
    const errorCount = plan.items.filter((item) => item.kind === 'error').length;
    db.exec('BEGIN');
    try {
        db.prepare(
            `INSERT INTO sessions (id, date, lang, status, created_at, total, new_count, review_count, error_count, config)
             VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
        ).run(
            id,
            date,
            lang,
            now,
            plan.items.length,
            newCount,
            reviewCount,
            errorCount,
            JSON.stringify({ settings, counts: plan.counts, extra }),
        );
        const stmt = db.prepare(
            'INSERT INTO session_items (session_id, word_id, position, kind) VALUES (?, ?, ?, ?)',
        );
        plan.items.forEach((item, index) => stmt.run(id, item.word.id, index, item.kind));
        db.exec('COMMIT');
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
    return sessionRow(id);
}

api.get(
    '/session/today',
    wrap((req, res) => {
        const settings = getSettings();
        const lang = req.query.lang === 'en' ? 'en' : 'zh';
        const today = todayStr();
        let active = findActiveSession(lang, today);
        // 设置改小后，今天的词单也要跟着收紧
        if (active) active = trimSessionToDailyTotal(active, settings);
        const last = db
            .prepare(
                `SELECT * FROM sessions s
                 WHERE s.date = ? AND s.lang = ? AND s.status = 'done'
                   AND EXISTS (SELECT 1 FROM session_items si WHERE si.session_id = s.id)
                 ORDER BY s.finished_at DESC LIMIT 1`,
            )
            .get(today, lang);
        const plan = buildPlan(allWords(lang), settings, today);
        const totalWords = db.prepare('SELECT COUNT(*) AS n FROM words WHERE archived = 0 AND lang = ?').get(lang).n;
        res.json({
            lang,
            today,
            totalWords,
            active: active ? sessionPayload(active) : null,
            lastDone: last ? sessionPayload(last) : null,
            preview: summarizePlan(plan.counts),
            message: plan.message,
        });
    }),
);

api.post(
    '/session/start',
    wrap((req, res) => {
        const settings = getSettings();
        const lang = req.body?.lang === 'en' ? 'en' : 'zh';
        const today = todayStr();
        const existing = findActiveSession(lang, today);
        if (existing) return res.json(sessionPayload(trimSessionToDailyTotal(existing, settings)));

        const plan = buildPlan(allWords(lang), settings, today);
        if (!plan.items.length) return fail(res, 400, plan.message || '今天没有可听写的词');

        const row = createSession({ lang, date: today, plan, settings });
        res.status(201).json(sessionPayload(row));
    }),
);

api.post(
    '/session/extra',
    wrap((req, res) => {
        const settings = getSettings();
        const lang = req.body?.lang === 'en' ? 'en' : 'zh';
        const count = clamp(req.body?.count ?? 10, 1, 100);
        const today = todayStr();
        const existing = findActiveSession(lang, today);
        if (existing) return res.json(sessionPayload(existing));

        const plan = buildExtraPlan(allWords(lang), count, today);
        if (!plan.items.length) return fail(res, 400, plan.message || '词库里还没有可听写的词');

        const row = createSession({ lang, date: today, plan, settings, extra: true });
        res.status(201).json(sessionPayload(row));
    }),
);

api.get(
    '/sessions/:id',
    wrap((req, res) => {
        repairActiveSessions();
        let row = sessionRow(req.params.id);
        if (!row) return fail(res, 404, '没有找到这次听写');
        // 直接打开今天的进行中会话时，也按当前“每天总词量”收紧
        if (row.status === 'active') row = trimSessionToDailyTotal(row, getSettings());
        res.json(sessionPayload(row));
    }),
);

/**
 * 记录一个词的作答结果：更新记忆曲线、写复习记录、回填会话条目。
 * 语文听写整组提交、英语认词逐词提交都走这里。
 */
function applyItemResult(row, item, result, charsWrong = []) {
    const today = row.date || todayStr();
    const scheduled = scheduleWord(item.word, result, today);
    db.prepare(
        `UPDATE words SET status = ?, stage = ?, interval_days = ?, ease = ?, due_date = ?, last_review = ?,
         correct_count = ?, wrong_count = ?, streak = ?, lapses = ?, advance_rank = 0 WHERE id = ?`,
    ).run(
        scheduled.status,
        scheduled.stage,
        scheduled.intervalDays,
        scheduled.ease,
        scheduled.dueDate,
        scheduled.lastReview,
        scheduled.correctCount,
        scheduled.wrongCount,
        scheduled.streak,
        scheduled.lapses,
        item.word.id,
    );
    insertReview({
        wordId: item.word.id,
        sessionId: row.id,
        date: today,
        result,
        charsWrong,
        intervalBefore: scheduled.intervalBefore,
        intervalAfter: scheduled.intervalDays,
    });
    db.prepare('UPDATE session_items SET result = ?, chars_wrong = ?, answered_at = ? WHERE session_id = ? AND position = ?').run(
        result,
        JSON.stringify(charsWrong),
        new Date().toISOString(),
        row.id,
        item.position,
    );
    return {
        wordId: item.word.id,
        text: item.word.text,
        pinyin: item.word.pinyin,
        result,
        charsWrong,
        intervalDays: scheduled.intervalDays,
        dueDate: scheduled.dueDate,
        status: scheduled.status,
    };
}

/** 统计一组会话里已答 / 未答的数量 */
function sessionProgress(sessionId) {
    const row = db
        .prepare(
            `SELECT COUNT(*) AS total,
                    COALESCE(SUM(result IS NULL), 0) AS pending,
                    COALESCE(SUM(result = 'correct'), 0) AS correct,
                    COALESCE(SUM(result = 'wrong'), 0) AS wrong
             FROM session_items WHERE session_id = ?`,
        )
        .get(sessionId);
    return { total: row.total, pending: row.pending, correct: row.correct, wrong: row.wrong };
}

api.post(
    '/sessions/:id/submit',
    wrap((req, res) => {
        const row = sessionRow(req.params.id);
        if (!row) return fail(res, 404, '没有找到这次听写');
        if (row.status === 'done') return res.json({ ...sessionPayload(row), remaining: 0 });
        if (row.status !== 'active') return fail(res, 400, '这次听写已经结束');

        const submitted = Array.isArray(req.body?.items) ? req.body.items : [];
        const byWord = new Map(submitted.map((item) => [Number(item.wordId), item]));
        const items = sessionItems(row.id);
        if (!items.length) return fail(res, 400, '这次听写没有词');

        // 只批改这次提交里、还没批改过的词；没听过的词保持原样
        const targetItems = items.filter((item) => byWord.has(item.word.id) && !item.result);
        if (!targetItems.length) return fail(res, 400, '这次没有可以批改的词');

        const results = [];

        db.exec('BEGIN');
        try {
            for (const item of targetItems) {
                const answer = byWord.get(item.word.id);
                const charsWrong = Array.isArray(answer?.charsWrong)
                    ? [...new Set(answer.charsWrong.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < item.word.text.length))]
                    : [];
                let result = answer?.result === 'wrong' ? 'wrong' : 'correct';
                if (charsWrong.length) result = 'wrong';

                results.push(applyItemResult(row, item, result, charsWrong));
            }

            // 还有没批改的词时保持进行中，下次可以接着听、接着批
            const progress = sessionProgress(row.id);
            const done = progress.pending === 0;
            db.prepare('UPDATE sessions SET status = ?, finished_at = ?, correct = ?, wrong = ? WHERE id = ?').run(
                done ? 'done' : 'active',
                done ? new Date().toISOString() : null,
                progress.correct,
                progress.wrong,
                row.id,
            );
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }

        const progress = sessionProgress(row.id);
        res.json({
            ...sessionPayload(sessionRow(row.id)),
            results,
            graded: targetItems.length,
            remaining: progress.pending,
        });
    }),
);

/**
 * 逐词作答：英语认词用，点一个词就立刻记一个词。
 * 全部答完后会话自动结束，刷新或中途退出也不会丢进度。
 */
api.post(
    '/sessions/:id/answer',
    wrap((req, res) => {
        const row = sessionRow(req.params.id);
        if (!row) return fail(res, 404, '没有找到这次练习');
        if (row.status === 'done') return res.json({ ...sessionPayload(row), remaining: 0 });
        if (row.status !== 'active') return fail(res, 400, '这次练习已经结束');

        const wordId = Number(req.body?.wordId);
        const item = sessionItems(row.id).find((entry) => entry.word.id === wordId);
        if (!item) return fail(res, 404, '这次练习里没有这个词');
        if (item.result) {
            return res.json({ ...sessionPayload(row), remaining: sessionProgress(row.id).pending });
        }

        const result = req.body?.result === 'wrong' ? 'wrong' : 'correct';
        let progress = sessionProgress(row.id);
        db.exec('BEGIN');
        try {
            applyItemResult(row, item, result, []);
            progress = sessionProgress(row.id);
            const done = progress.pending === 0;
            db.prepare('UPDATE sessions SET correct = ?, wrong = ?, status = ?, finished_at = ? WHERE id = ?').run(
                progress.correct,
                progress.wrong,
                done ? 'done' : 'active',
                done ? new Date().toISOString() : null,
                row.id,
            );
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }

        res.json({ ...sessionPayload(sessionRow(row.id)), remaining: sessionProgress(row.id).pending });
    }),
);

api.post(
    '/sessions/:id/abandon',
    wrap((req, res) => {
        const row = sessionRow(req.params.id);
        if (!row) return fail(res, 404, '没有找到这次听写');
        if (row.status === 'active') {
            db.prepare("UPDATE sessions SET status = 'abandoned', finished_at = ? WHERE id = ?").run(
                new Date().toISOString(),
                row.id,
            );
        }
        res.json({ ok: true });
    }),
);

api.get(
    '/sessions',
    wrap((req, res) => {
        const limit = clamp(req.query.limit || 20, 1, 100);
        const rows = db
            .prepare(
                `SELECT * FROM sessions s
                 WHERE s.status = 'done'
                   AND EXISTS (SELECT 1 FROM session_items si WHERE si.session_id = s.id)
                 ORDER BY s.date DESC, s.finished_at DESC LIMIT ?`,
            )
            .all(limit);
        res.json(
            rows.map((row) => ({
                id: row.id,
                date: row.date,
                lang: row.lang,
                total: row.total,
                correct: row.correct,
                wrong: row.wrong,
                newCount: row.new_count,
                reviewCount: row.review_count,
                errorCount: row.error_count,
                finishedAt: row.finished_at,
            })),
        );
    }),
);

/* --------------------------------- 统计 -------------------------------- */

function streakDays() {
    const dates = db
        .prepare('SELECT DISTINCT date FROM reviews ORDER BY date DESC')
        .all()
        .map((row) => row.date);
    if (!dates.length) return { current: 0, longest: 0, lastDate: null };
    const set = new Set(dates);
    let current = 0;
    let cursor = todayStr();
    if (!set.has(cursor)) cursor = addDays(cursor, -1);
    while (set.has(cursor)) {
        current += 1;
        cursor = addDays(cursor, -1);
    }
    let longest = 0;
    let run = 0;
    let prev = null;
    for (const date of [...dates].sort()) {
        if (prev && diffDays(prev, date) === 1) run += 1;
        else run = 1;
        longest = Math.max(longest, run);
        prev = date;
    }
    return { current, longest, lastDate: dates[0] };
}

api.get(
    '/stats/overview',
    wrap((req, res) => {
        const lang = ['zh', 'en'].includes(req.query.lang) ? req.query.lang : null;
        const today = todayStr();
        const langWhere = lang ? ' AND lang = ?' : '';
        const langParams = lang ? [lang] : [];
        const base = db
            .prepare(`SELECT status, COUNT(*) AS n FROM words WHERE archived = 0${langWhere} GROUP BY status`)
            .all(...langParams);
        const byStatus = Object.fromEntries(base.map((row) => [row.status, row.n]));
        const total = base.reduce((sum, row) => sum + row.n, 0);
        const dueToday = db
            .prepare(
                `SELECT COUNT(*) AS n FROM words WHERE archived = 0 AND status NOT IN ('new','suspended') AND due_date <= ?${langWhere}`,
            )
            .get(today, ...langParams).n;
        const dueTomorrow = db
            .prepare(
                `SELECT COUNT(*) AS n FROM words WHERE archived = 0 AND status NOT IN ('new','suspended') AND due_date = ?${langWhere}`,
            )
            .get(addDays(today, 1), ...langParams).n;
        const reviewRow = db
            .prepare(
                `SELECT COUNT(*) AS total, SUM(result = 'correct') AS correct FROM reviews WHERE 1 = 1${
                    lang ? ' AND word_id IN (SELECT id FROM words WHERE lang = ?)' : ''
                }`,
            )
            .get(...langParams);
        const todayRow = db
            .prepare(
                `SELECT COUNT(*) AS total, SUM(result = 'correct') AS correct FROM reviews WHERE date = ?${
                    lang ? ' AND word_id IN (SELECT id FROM words WHERE lang = ?)' : ''
                }`,
            )
            .get(today, ...langParams);
        const activeDays = db
            .prepare(
                `SELECT COUNT(DISTINCT date) AS n FROM reviews WHERE 1 = 1${
                    lang ? ' AND word_id IN (SELECT id FROM words WHERE lang = ?)' : ''
                }`,
            )
            .get(...langParams).n;
        const weekAgo = addDays(today, -6);
        const addedThisWeek = db
            .prepare(`SELECT COUNT(*) AS n FROM words WHERE archived = 0 AND created_at >= ?${langWhere}`)
            .get(`${weekAgo}T00:00:00`, ...langParams).n;
        const streak = streakDays();
        res.json({
            total,
            byStatus,
            dueToday,
            dueTomorrow,
            newWords: byStatus.new || 0,
            learning: byStatus.learning || 0,
            review: byStatus.review || 0,
            mastered: byStatus.mastered || 0,
            suspended: byStatus.suspended || 0,
            totalReviews: reviewRow.total || 0,
            accuracy: reviewRow.total ? Math.round(((reviewRow.correct || 0) / reviewRow.total) * 100) : null,
            todayReviews: todayRow.total || 0,
            todayAccuracy: todayRow.total ? Math.round(((todayRow.correct || 0) / todayRow.total) * 100) : null,
            activeDays,
            addedThisWeek,
            streak,
        });
    }),
);

api.get(
    '/stats/heatmap',
    wrap((req, res) => {
        const days = clamp(req.query.days || 365, 30, 730);
        const lang = ['zh', 'en'].includes(req.query.lang) ? req.query.lang : null;
        const start = addDays(todayStr(), -days + 1);
        const rows = db
            .prepare(
                `SELECT date, COUNT(*) AS count, SUM(result = 'correct') AS correct, SUM(result = 'wrong') AS wrong
                 FROM reviews WHERE date >= ?${
                     lang ? ' AND word_id IN (SELECT id FROM words WHERE lang = ?)' : ''
                 } GROUP BY date ORDER BY date`,
            )
            .all(start, ...(lang ? [lang] : []));
        res.json({ start, end: todayStr(), days: rows });
    }),
);

api.get(
    '/stats/timeline',
    wrap((req, res) => {
        const days = clamp(req.query.days || 30, 7, 180);
        const start = addDays(todayStr(), -days + 1);
        const rows = db
            .prepare(
                `SELECT date, COUNT(*) AS count, SUM(result = 'correct') AS correct, SUM(result = 'wrong') AS wrong
                 FROM reviews WHERE date >= ? GROUP BY date ORDER BY date`,
            )
            .all(start);
        const map = new Map(rows.map((row) => [row.date, row]));
        const out = [];
        for (let i = 0; i < days; i += 1) {
            const date = addDays(start, i);
            const row = map.get(date);
            out.push({
                date,
                count: row ? row.count : 0,
                correct: row ? row.correct : 0,
                wrong: row ? row.wrong : 0,
            });
        }
        res.json(out);
    }),
);

api.get(
    '/stats/difficult',
    wrap((req, res) => {
        const limit = clamp(req.query.limit || 10, 1, 50);
        const rows = db
            .prepare(
                `SELECT * FROM words WHERE archived = 0 AND wrong_count > 0
                 ORDER BY wrong_count DESC, lapses DESC, correct_count ASC LIMIT ?`,
            )
            .all(limit);
        res.json(rows.map(wordFromRow).map(withMeta));
    }),
);

api.get(
    '/stats/upcoming',
    wrap((req, res) => {
        const days = clamp(req.query.days || 14, 7, 60);
        const start = todayStr();
        const rows = db
            .prepare(
                `SELECT due_date AS date, COUNT(*) AS count FROM words
                 WHERE archived = 0 AND status NOT IN ('new','suspended') AND due_date >= ?
                 GROUP BY due_date ORDER BY due_date`,
            )
            .all(start);
        const map = new Map(rows.map((row) => [row.date, row.count]));
        const out = [];
        for (let i = 0; i < days; i += 1) {
            const date = addDays(start, i);
            out.push({ date, count: map.get(date) || 0 });
        }
        res.json(out);
    }),
);

/* -------------------------------- 备份/重置 ------------------------------ */

api.get(
    '/export',
    wrap((req, res) => {
        const payload = {
            app: 'MemoryToMe',
            version: 1,
            exportedAt: new Date().toISOString(),
            settings: getSettings(),
            words: db.prepare('SELECT * FROM words ORDER BY id').all(),
            reviews: db.prepare('SELECT * FROM reviews ORDER BY id').all(),
            sessions: db.prepare('SELECT * FROM sessions ORDER BY created_at').all(),
            sessionItems: db.prepare('SELECT * FROM session_items ORDER BY session_id, position').all(),
        };
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="memorytome-backup-${todayStr()}.json"`);
        res.send(JSON.stringify(payload, null, 2));
    }),
);

api.post(
    '/import/backup',
    wrap((req, res) => {
        const data = req.body || {};
        if (!Array.isArray(data.words)) return fail(res, 400, '备份文件格式不正确');
        const result = { inserted: 0, duplicates: 0 };
        db.exec('BEGIN');
        try {
            for (const row of data.words) {
                const outcome = insertWord({
                    text: row.text,
                    pinyin: row.pinyin,
                    lang: row.lang,
                    meaning: row.meaning,
                    note: row.note,
                    category: row.category,
                    tags: row.tags,
                    source: row.source,
                });
                if (outcome.inserted) result.inserted += 1;
                else result.duplicates += 1;
            }
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
        res.json(result);
    }),
);

api.post(
    '/reset-progress',
    wrap((req, res) => {
        const keepWords = req.body?.keepWords !== false;
        db.exec('BEGIN');
        try {
            db.prepare('DELETE FROM reviews').run();
            db.prepare('DELETE FROM session_items').run();
            db.prepare('DELETE FROM sessions').run();
            if (keepWords) {
                db.prepare(
                    `UPDATE words SET status = 'new', stage = 0, interval_days = 0, ease = 2.5, due_date = NULL,
                     last_review = NULL, correct_count = 0, wrong_count = 0, streak = 0, lapses = 0, archived = 0`,
                ).run();
            } else {
                db.prepare('DELETE FROM words').run();
            }
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
        res.json({ ok: true, keepWords });
    }),
);

export { DEFAULT_SETTINGS };
