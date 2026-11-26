import { addDays, clamp, diffDays, todayStr } from './util.js';

/**
 * 间隔序列参考艾宾浩斯遗忘曲线的复习节点，并叠加 SM-2 的难度系数。
 * 第 1 次成功：1 天；第 2 次：2 天；第 3 次：4 天；第 4 次：7 天；
 * 第 5 次：15 天；第 6 次：30 天；之后 60 / 120 / 180 天。
 */
export const BASE_INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60, 120, 180];

export const KIND_LABEL = {
    new: '新词',
    review: '复习',
    error: '易错',
};

export function scheduleWord(word, result, date = todayStr()) {
    let stage = Number(word.stage) || 0;
    let ease = Number(word.ease) || 2.5;
    let streak = Number(word.streak) || 0;
    let lapses = Number(word.lapses) || 0;
    let correctCount = Number(word.correctCount) || 0;
    let wrongCount = Number(word.wrongCount) || 0;
    let intervalDays = Number(word.intervalDays) || 0;

    const success = result === 'correct';
    if (success) {
        stage = Math.min(stage + 1, BASE_INTERVALS.length - 1);
        streak += 1;
        ease = Math.min(2.9, Number((ease + 0.05).toFixed(2)));
        intervalDays = Math.max(1, Math.round(BASE_INTERVALS[stage] * (ease / 2.5)));
        correctCount += 1;
    } else {
        stage = Math.max(0, stage - 2);
        streak = 0;
        ease = Math.max(1.3, Number((ease - 0.2).toFixed(2)));
        intervalDays = 1;
        lapses += 1;
        wrongCount += 1;
    }

    const status = stage >= 6 && streak >= 3 ? 'mastered' : stage <= 1 ? 'learning' : 'review';

    return {
        stage,
        ease,
        streak,
        lapses,
        correctCount,
        wrongCount,
        intervalDays,
        status,
        dueDate: addDays(date, intervalDays),
        lastReview: date,
        intervalBefore: Number(word.intervalDays) || 0,
    };
}

function shuffle(list) {
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/** 混合排列：新词均匀插入复习词之间，避免连续出现太多新词。 */
function interleave(reviews, news, order) {
    if (order === 'reviews-first') return [...reviews, ...news];
    if (order === 'new-first') return [...news, ...reviews];

    const r = shuffle(reviews);
    const n = shuffle(news);
    const out = [];
    let ri = 0;
    let ni = 0;
    let newRun = 0;
    const total = r.length + n.length;
    while (ri < r.length || ni < n.length) {
        const remaining = total - out.length;
        const newRatio = remaining > 0 ? (n.length - ni) / remaining : 0;
        const canNew = ni < n.length && newRun < 2;
        const shouldNew = canNew && (ri >= r.length || Math.random() < newRatio + 0.08);
        if (shouldNew) {
            out.push(n[ni++]);
            newRun += 1;
        } else if (ri < r.length) {
            out.push(r[ri++]);
            newRun = 0;
        } else {
            out.push(n[ni++]);
            newRun += 1;
        }
    }
    return out;
}

/**
 * 生成今日听写计划。
 * words 为数据库中的词对象数组（已转为 camelCase）。
 */
export function buildPlan(words, settings, date = todayStr()) {
    const target = clamp(settings.dailyTotal ?? 20, 1, 100);
    const maxNew = Math.min(clamp(settings.maxNew ?? 10, 0, target), target);
    const newPerDay = Math.min(clamp(settings.newPerDay ?? 5, 0, maxNew), maxNew);
    const order = settings.order || 'mixed';

    const active = words.filter((w) => !w.archived && w.status !== 'suspended');
    const due = active
        .filter((w) => w.status !== 'new' && w.dueDate && w.dueDate <= date)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.lapses - a.lapses || a.id - b.id);
    const weak = active
        .filter(
            (w) =>
                w.status !== 'new' &&
                w.lapses > 0 &&
                w.dueDate &&
                w.dueDate > date &&
                diffDays(date, w.dueDate) <= 3,
        )
        .sort((a, b) => b.lapses - a.lapses || b.wrongCount - a.wrongCount || a.id - b.id);
    const fresh = active.filter((w) => w.status === 'new').sort((a, b) => a.id - b.id);
    const future = active
        .filter((w) => w.status !== 'new' && w.dueDate && diffDays(date, w.dueDate) > 3)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id - b.id);

    const picked = [];
    const seen = new Set();
    const take = (list, count, kind) => {
        let left = count;
        for (const word of list) {
            if (left <= 0) break;
            if (seen.has(word.id)) continue;
            seen.add(word.id);
            picked.push({ word, kind });
            left -= 1;
        }
    };

    const reviewTarget = Math.max(0, target - newPerDay);
    take(due, reviewTarget, 'review');
    if (picked.length < reviewTarget) take(weak, reviewTarget - picked.length, 'error');
    if (picked.length < reviewTarget) take(future, reviewTarget - picked.length, 'review');

    const newQuota = Math.min(maxNew, target - picked.length);
    take(fresh, newQuota, 'new');

    if (picked.length < target) take(future, target - picked.length, 'review');

    const reviewItems = picked.filter((p) => p.kind !== 'new');
    const newItems = picked.filter((p) => p.kind === 'new');
    const ordered = interleave(reviewItems, newItems, order);

    const counts = {
        due: due.length,
        weak: weak.length,
        fresh: fresh.length,
        future: future.length,
        target,
        planned: ordered.length,
        newCount: newItems.length,
        reviewCount: reviewItems.filter((p) => p.kind === 'review').length,
        errorCount: reviewItems.filter((p) => p.kind === 'error').length,
    };

    let message = '';
    if (!active.length) {
        message = '词库还是空的，先去导入一些词吧。';
    } else if (!ordered.length) {
        message = '今天的词都复习完了，明天再来吧。';
    } else if (counts.planned < target) {
        message = `今天可安排的词只有 ${counts.planned} 个，可以再导入一些新词。`;
    } else {
        message = `今天共 ${counts.planned} 个：复习 ${counts.reviewCount} 个、易错 ${counts.errorCount} 个、新词 ${counts.newCount} 个。`;
    }

    return { items: ordered, counts, message };
}

export function summarizePlan(counts) {
    return {
        ...counts,
        total: counts.planned,
        breakdown: [
            { key: 'review', label: '到期复习', value: counts.reviewCount, color: 'jade' },
            { key: 'error', label: '易错巩固', value: counts.errorCount, color: 'coral' },
            { key: 'new', label: '今日新词', value: counts.newCount, color: 'amber' },
        ],
    };
}

/**
 * 额外练习计划：不受每日计划限制，从当前词库里挑 N 个词。
 * 优先今天还没练过的词，其次到期/易错/新词，最后才是今天已经练过的。
 */
export function buildExtraPlan(words, count, date = todayStr()) {
    const target = clamp(count ?? 10, 1, 100);
    const active = words.filter((w) => !w.archived && w.status !== 'suspended');

    if (!active.length) {
        return {
            items: [],
            counts: {
                due: 0,
                weak: 0,
                fresh: 0,
                future: 0,
                target,
                planned: 0,
                newCount: 0,
                reviewCount: 0,
                errorCount: 0,
            },
            message: '词库还是空的，先去导入一些词吧。',
        };
    }

    const score = (word) => {
        let value = 0;
        if (word.lastReview !== date) value += 100;
        if (word.status !== 'new' && word.dueDate && word.dueDate <= date) value += 40;
        value += Math.min(Number(word.lapses) || 0, 5) * 6;
        if (word.status === 'new') value += 12;
        return value;
    };

    // 先打乱，再按优先级稳定排序，让同优先级的词每次都有变化
    const picked = shuffle(active)
        .sort((a, b) => score(b) - score(a) || a.id - b.id)
        .slice(0, target)
        .map((word) => ({ word, kind: word.status === 'new' ? 'new' : 'review' }));

    const ordered = interleave(
        picked.filter((item) => item.kind !== 'new'),
        picked.filter((item) => item.kind === 'new'),
        'mixed',
    );

    const newCount = ordered.filter((item) => item.kind === 'new').length;
    const counts = {
        due: 0,
        weak: 0,
        fresh: newCount,
        future: 0,
        target,
        planned: ordered.length,
        newCount,
        reviewCount: ordered.length - newCount,
        errorCount: 0,
    };

    return {
        items: ordered,
        counts,
        message:
            ordered.length < target
                ? `词库里只有 ${ordered.length} 个词可以额外练习。`
                : `额外练习 ${ordered.length} 个词。`,
    };
}
