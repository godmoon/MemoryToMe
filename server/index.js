import express from 'express';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './routes.js';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '../public');
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: false, limit: '8mb' }));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
});

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

app.use(
    express.static(publicDir, {
        extensions: ['html'],
        setHeaders(res, filePath) {
            if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
    }),
);

// 前端使用 hash 路由，所有非 API 的 GET 都回落到 index.html
app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((err, req, res, next) => {
    console.error('[MemoryToMe]', err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: err.message || '服务器出错了' });
});

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

function lanAddresses() {
    const list = [];
    for (const entries of Object.values(os.networkInterfaces())) {
        for (const entry of entries || []) {
            if (entry.family === 'IPv4' && !entry.internal) list.push(entry.address);
        }
    }
    return list;
}

const server = app.listen(PORT, HOST, () => {
    console.log('');
    console.log('  MemoryToMe · 记忆小站');
    console.log('  ----------------------');
    console.log(`  本机访问   http://localhost:${PORT}`);
    for (const ip of lanAddresses()) console.log(`  局域网访问 http://${ip}:${PORT}`);
    console.log('');
    console.log('  按 Ctrl+C 停止服务');
    console.log('');
});

function shutdown() {
    server.close(() => {
        try {
            db.close();
        } catch {
            /* ignore */
        }
        process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
