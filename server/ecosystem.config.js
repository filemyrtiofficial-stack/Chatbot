/**
 * PM2 Ecosystem Configuration
 * Usage: pm2 start ecosystem.config.js
 */

module.exports = {
  apps: [
    {
      name: 'chatbot-api',
      script: 'src/index.js',
      instances: 1, // Single instance (increase for load balancing)
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      // Logging
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
      // Auto restart
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      // Advanced settings
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: false,
      listen_timeout: 10000,
    },
  ],
};

