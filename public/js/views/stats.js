import { api } from '../api.js';
import { bigHeatmap, monthMarkers } from '../heatmap.js';
import { escapeHtml, fmtDateCN, fmtDateShort, pct, todayStr } from '../utils.js';

function statCard(label, value, foot) {
    return `
        <div class="stat-card">
            <div class="stat-label">${label}</div>
            <div class="stat-value">${value}</div>
            <div class="stat-foot">${foot}</div>
        </div>`;
}

function heatmapMonths(rows) {
    const marks = monthMarkers(rows, 365);
    return marks
        .map((mark) => `<span style="left:${mark.index * 17}px">${mark.label}</span>`)
        .join('');
}

function barChart(rows) {
    const max = Math.max(1, ...rows.map((row) => row.count));
    const bars = rows
        .map((row) => {
            const height = row.count ? Math.max(4, Math.round((row.count / max) * 100)) : 2;
            const low = row.count && row.wrong > row.correct ? 'low' : '';
            const zero = row.count ? '' : 'zero';
            return `<div class="bar-col ${low} ${zero}" title="${escapeHtml(fmtDateCN(row.date))}：复习 ${row.count} 次，对 ${row.correct}，错 ${row.wrong}">
                <i style="height:${height}%"></i>
            </div>`;
        })
        .join('');
    const labels = rows
        .map((row, index) => {
            const isLast = index === rows.length - 1;
            return `<span class="${isLast ? 'last' : ''}">${index % 5 === 0 || isLast ? escapeHtml(fmtDateShort(row.date)) : ''}</span>`;
        })
        .join('');
    return `<div class="bar-chart">${bars}</div><div class="bar-labels">${labels}</div>`;
}

function donut(overview) {
    const parts = [
        { key: 'new', label: '未学习', value: overview.newWords, color: 'var(--amber-2)' },
        { key: 'learning', label: '学习中', value: overview.learning, color: 'var(--blue)' },
        { key: 'review', label: '复习中', value: overview.review, color: 'var(--jade-2)' },
        { key: 'mastered', label: '已掌握', value: overview.mastered, color: 'var(--jade-ink)' },
    ];
    const total = parts.reduce((sum, part) => sum + part.value, 0);
    let cursor = 0;
    const stops = [];
    for (const part of parts) {
        if (!part.value) continue;
        const start = (cursor / Math.max(1, total)) * 100;
        cursor += part.value;
        const end = (cursor / Math.max(1, total)) * 100;
        stops.push(`${part.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
    }
    const background = stops.length ? `conic-gradient(${stops.join(', ')})` : 'var(--surface-3)';
    return `
        <div class="donut-wrap">
            <div class="donut" style="background:${background}">
                <div class="donut-center"><div><b>${total}</b><span>个词</span></div></div>
            </div>
            <div class="donut-legend">
                ${parts
                    .map(
                        (part) => `
                    <span class="legend-item">
                        <span class="legend-swatch" style="background:${part.color}"></span>
                        ${part.label}
                        <b>${part.value}</b>
                    </span>`,
                    )
                    .join('')}
            </div>
        </div>`;
}

function upcomingBars(rows) {
    const max = Math.max(1, ...rows.map((row) => row.count));
    return `
        <div class="load-bars">
            ${rows
                .map(
                    (row) => `
                <div class="load-bar" title="${escapeHtml(fmtDateCN(row.date))}：${row.count} 个词">
                    <i style="height:${row.count ? Math.max(6, Math.round((row.count / max) * 100)) : 2}%"></i>
                    <span>${escapeHtml(fmtDateShort(row.date))}</span>
                </div>`,
                )
                .join('')}
        </div>`;
}

function difficultList(rows) {
    if (!rows.length) {
        return '<p class="muted small" style="margin:0">还没有反复写错的词，继续保持。</p>';
    }
    return `
        <ul class="rank-list">
            ${rows
                .map(
                    (word, index) => `
                <li class="rank-item">
                    <span class="rank-index">${index + 1}</span>
                    <a class="rank-word" href="#/words/${word.id}">${escapeHtml(word.text)}</a>
                    <span class="rank-meta">错 ${word.wrongCount} 次 · 正确率 ${word.accuracy == null ? '—' : `${word.accuracy}%`}</span>
                </li>`,
                )
                .join('')}
        </ul>`;
}

function sessionList(rows) {
    if (!rows.length) {
        return '<p class="muted small" style="margin:0">还没有完成的听写。去今日页开始第一组吧。</p>';
    }
    return `
        <div class="result-list">
            ${rows
                .map((session) => {
                    const score = session.total ? Math.round((session.correct / session.total) * 100) : 0;
                    return `
                    <div class="result-item">
                        <div class="row wrap" style="gap:10px">
                            <span class="badge ${score >= 80 ? 'badge-jade' : score >= 60 ? 'badge-amber' : 'badge-coral'}">${score} 分</span>
                            <span>${escapeHtml(fmtDateCN(session.date))}</span>
                            <span class="small muted">${session.lang === 'en' ? '英语' : '语文'} · ${session.total} 个词</span>
                        </div>
                        <a class="btn btn-sm btn-ghost" href="#/review/${session.id}">查看</a>
                    </div>`;
                })
                .join('')}
        </div>`;
}

export async function render(root, ctx) {
    root.innerHTML = `
        <div class="page-loading">
            <div class="loader"></div>
            <p>正在数一数这些天的努力…</p>
        </div>`;

    let overview;
    let heatmap;
    let timeline;
    let difficult;
    let upcoming;
    let sessions;
    try {
        [overview, heatmap, timeline, difficult, upcoming, sessions] = await Promise.all([
            api.get('/api/stats/overview'),
            api.get('/api/stats/heatmap?days=365'),
            api.get('/api/stats/timeline?days=30'),
            api.get('/api/stats/difficult?limit=10'),
            api.get('/api/stats/upcoming?days=14'),
            api.get('/api/sessions?limit=8'),
        ]);
    } catch (error) {
        root.innerHTML = `<div class="empty"><div class="empty-emoji">📊</div><h3>统计没有打开</h3><p>${escapeHtml(error.message)}</p><button class="btn btn-primary" onclick="location.reload()">刷新试试</button></div>`;
        return;
    }

    const heatmapRows = heatmap.days || [];
    const daysWithRecords = heatmapRows.length;
    const totalReviews = overview.totalReviews || 0;
    const todayReviews = overview.todayReviews || 0;
    const todayAccuracy = overview.todayAccuracy;
    const accuracy = overview.accuracy;

    root.innerHTML = `
        <div class="fade-up">
            <div class="section-head">
                <div>
                    <h1 class="page-title">学习统计</h1>
                    <p class="page-sub">看看记忆是怎么一点点长出来的。今天是 ${escapeHtml(fmtDateCN(todayStr()))}。</p>
                </div>
                <span class="badge badge-amber">🔥 连续 ${overview.streak?.current || 0} 天</span>
            </div>

            <div class="stat-grid">
                ${statCard('词库总数', `${overview.total}<small> 个</small>`, `本周新增 ${overview.addedThisWeek} 个`)}
                ${statCard('今天复习', `${todayReviews}<small> 次</small>`, todayReviews ? `正确率 ${pct(todayAccuracy)}` : '今天还没开始')}
                ${statCard('总正确率', accuracy == null ? '—' : `${accuracy}<small>%</small>`, `累计听写 ${totalReviews} 次`)}
                ${statCard('连续打卡', `${overview.streak?.current || 0}<small> 天</small>`, `最长 ${overview.streak?.longest || 0} 天 · 共 ${overview.activeDays} 天`)}
            </div>

            <div class="card card-pad heatmap-card" style="margin-bottom:18px">
                <div class="section-head" style="margin-bottom:12px">
                    <div><h2>一年复习地图</h2><p>每个方块是一天；颜色越深，那天复习得越多。</p></div>
                    <span class="badge badge-jade">${daysWithRecords} 天有记录</span>
                </div>
                <div class="heatmap-scroll">
                    <div class="heatmap-months" style="width:${Math.ceil(365 / 7) * 17 + 40}px">${heatmapMonths(heatmapRows)}</div>
                    <div class="heatmap">${bigHeatmap(heatmapRows, 365)}</div>
                </div>
                <div class="heat-legend">
                    <span>少</span>
                    <span class="heat-cell level-0"></span>
                    <span class="heat-cell level-1"></span>
                    <span class="heat-cell level-2"></span>
                    <span class="heat-cell level-3"></span>
                    <span class="heat-cell level-4"></span>
                    <span>多</span>
                </div>
            </div>

            <div class="grid-2" style="margin-bottom:18px">
                <div class="card chart-card">
                    <div class="section-head" style="margin-bottom:8px">
                        <div><h2>最近 30 天</h2><p>柱子的高低是每天复习的词数，珊瑚色表示错得多。</p></div>
                    </div>
                    ${barChart(timeline)}
                </div>
                <div class="card chart-card">
                    <div class="section-head" style="margin-bottom:12px">
                        <div><h2>词库状态</h2><p>从“未学习”走到“已掌握”，需要几次刚刚好的复习。</p></div>
                    </div>
                    ${donut(overview)}
                </div>
            </div>

            <div class="grid-2" style="margin-bottom:18px">
                <div class="card card-pad">
                    <div class="section-head" style="margin-bottom:10px">
                        <div><h2>易错排行榜</h2><p>错得越多，越值得多看两眼。</p></div>
                        <a class="chip chip-btn" href="#/words?status=wrong">全部 →</a>
                    </div>
                    ${difficultList(difficult)}
                </div>
                <div class="card card-pad">
                    <div class="section-head" style="margin-bottom:10px">
                        <div><h2>未来 14 天复习量</h2><p>提前知道哪天会忙，心里更有底。</p></div>
                        <span class="badge badge-amber">共 ${upcoming.reduce((sum, row) => sum + row.count, 0)} 个</span>
                    </div>
                    ${upcomingBars(upcoming)}
                    <p class="small muted" style="margin:10px 0 0">柱子越高，那天的复习词越多。可以到设置里调整每天的总词量。</p>
                </div>
            </div>

            <div class="card card-pad">
                <div class="section-head" style="margin-bottom:10px">
                    <div><h2>最近的听写</h2><p>每一次完成，都会留下一个小小的成绩。</p></div>
                </div>
                ${sessionList(sessions)}
            </div>
        </div>`;

    root.querySelectorAll('.heatmap .heat-cell').forEach((cell) => {
        if (cell.dataset.date) cell.setAttribute('aria-label', cell.title);
    });
}
