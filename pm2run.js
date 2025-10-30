const config = {
  apps: [
    {
      name: 'checklist-client',
      script: 'npm',
      args: 'run dev -- --host 0.0.0.0 --port 5173',
      interpreter: 'none',
      env: {
        NODE_ENV: 'development'
      }
    },
    {
      name: 'agent-controller',
      script: 'server.js',
      interpreter: 'node'
    },
    {
      name: 'custom-llm',
      script: 'customllm.js',
      interpreter: 'node'
    }
  ]
};