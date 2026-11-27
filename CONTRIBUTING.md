# 参与贡献

谢谢你对 MemoryToMe 感兴趣。这个项目主要面向家庭和课堂教学场景，改动时请优先考虑“小学生能不能自己用”和“数据会不会丢”。

## 本地开发

需要 Node.js 22.5 或更高版本（项目使用内置的 `node:sqlite`）。

```bash
git clone https://github.com/godmoon/MemoryToMe.git
cd MemoryToMe
npm install
npm run dev
```

默认地址是 <http://localhost:3001>。开发时可以用临时数据目录，避免污染正式词库：

```bash
PORT=3002 DATA_DIR=/tmp/memorytome-dev npm run dev
```

## 提交前检查

```bash
npm run check
```

该命令会对 `server/`、`public/js/`、`scripts/` 和 PM2 配置做语法检查。

如果改动了数据库结构或接口，请同时在本地验证：

- 新建、编辑、删除词语；
- 开始听写、提交批改；
- 英语认词：看释义、选记住/没记住、刷新后续练；
- 导入教材词库、英语词包和备份恢复；
- 桌面端和手机端的批量管理。

## 代码风格

- 使用 4 个空格缩进。
- 注释和界面文案使用简体中文。
- 保持现有目录结构和命名方式，不引入不必要的新依赖。
- 不要把 `data/`、数据库文件、日志或 `.env` 提交到仓库。

## 提交 PR

1. Fork 仓库并从 `main` 创建分支。
2. 一个 PR 只做一件事，说明改了什么、为什么改。
3. 涉及界面的改动，建议附上桌面端和移动端截图。
4. 提交前运行 `npm run check`。

## 许可证

提交代码即表示同意以 [MIT License](LICENSE) 发布你的贡献。
