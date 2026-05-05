module.exports = {
  apps: [
    {
      name: "salonboost-worker",
      script: "dist/server.js",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "1200M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
