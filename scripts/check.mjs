import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const roots = ['server', 'public/js', 'scripts'];
const extraFiles = ['ecosystem.config.cjs'];
const files = [];

function walk(dir) {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = statSync(full);
        if (stat.isDirectory()) walk(full);
        else if (/\.(js|mjs|cjs)$/.test(name)) files.push(full);
    }
}

for (const root of roots) walk(root);
for (const file of extraFiles) {
    try {
        if (statSync(file).isFile()) files.push(file);
    } catch {
        // 文件不存在时跳过
    }
}

for (const file of files) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log(`语法检查通过：${files.length} 个文件`);
