// PM2 进程配置：在项目根目录执行 `pm2 start ecosystem.config.cjs`
module.exports = {
    apps: [
        {
            name: 'memorytome',
            cwd: __dirname,
            script: 'server/index.js',
            interpreter: 'node',
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            watch: false,
            max_restarts: 10,
            restart_delay: 3000,
            max_memory_restart: '300M',
            time: true,
            env: {
                NODE_ENV: 'production',
                HOST: '0.0.0.0',
                PORT: 3001,
            },
        },
    ],
};
