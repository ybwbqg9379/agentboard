import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = {
  port: parseInt(process.env.PORT || '3001', 10),

  // Anthropic-to-OpenAI proxy -- Claude Code SDK 通过它将 Anthropic 格式转为 OpenAI 格式
  proxy: {
    url: process.env.PROXY_URL || 'http://localhost:4000',
  },

  // GitHub 集成（可选，无 token 时仅支持公开仓库）
  github: {
    token: process.env.GITHUB_TOKEN || '',
  },

  // OpenAI Compatible LLM 配置 -- 支持任何兼容 OpenAI Chat Completions API 的服务
  llm: {
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    apiKey: process.env.LLM_API_KEY || '',
  },

  // Agent 工作目录（隔离）
  workspaceDir: resolve(process.env.WORKSPACE_DIR || resolve(__dirname, '..', 'workspace')),

  // 插件目录
  pluginsDir: resolve(process.env.PLUGINS_DIR || resolve(__dirname, '..', 'plugins')),

  // SQLite 数据库路径
  dbPath: resolve(process.env.DB_PATH || resolve(__dirname, '..', 'data', 'agentboard.db')),

  // Agent 进程超时（ms）-- 默认 10 分钟
  agentTimeout: parseInt(process.env.AGENT_TIMEOUT || '600000', 10),
};

export default config;
