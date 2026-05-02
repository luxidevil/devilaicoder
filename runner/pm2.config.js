module.exports = {
  apps: [
    {
      name: 'luxi-runner',
      script: './server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: '3210',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/luxi-runner-error.log',
      out_file: '/var/log/luxi-runner-out.log',
    },
  ],
};
