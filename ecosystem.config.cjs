module.exports = {
  apps: [
    {
      name: "workdeck-api",
      script: "dist-server/index.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "400M",
      exp_backoff_restart_delay: 100,
    },
  ],
};
