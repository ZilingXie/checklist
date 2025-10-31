const config = {
  apps: [
    
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
