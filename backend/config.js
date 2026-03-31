import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = {
  port: parseInt(process.env.PORT || '3001', 10),

  // LiteLLM proxy -- Claude Code 通过它将 Anthropic 格式转为 OpenAI 格式调用 Minimax
  litellm: {
    url: process.env.LITELLM_URL || 'http://localhost:4000',
  },

  // Minimax 模型配置（供 LiteLLM config 引用）
  minimax: {
    baseUrl: 'https://mydamoxing.cn/v1',
    model: 'MiniMax-M2.7-highspeed',
  },

  // Agent 工作目录（隔离）
  workspaceDir: resolve(process.env.WORKSPACE_DIR || resolve(__dirname, '..', 'workspace')),

  // SQLite 数据库路径
  dbPath: resolve(process.env.DB_PATH || resolve(__dirname, '..', 'data', 'agentboard.db')),

  // Agent 进程超时（ms）-- 默认 10 分钟
  agentTimeout: parseInt(process.env.AGENT_TIMEOUT || '600000', 10),
};

export default config;
