/**
 * Anthropic Messages API → OpenAI Chat Completions API 翻译代理
 *
 * Claude Code SDK 发送 Anthropic 格式请求，本代理翻译为 OpenAI 格式
 * 转发到任何 OpenAI Compatible API，再将响应翻译回 Anthropic 格式。
 *
 * 配置方式（.env.local）：
 *   LLM_BASE_URL=https://api.openai.com/v1   # 任何 OpenAI 兼容端点
 *   LLM_API_KEY=sk-xxx                        # API 密钥
 *   LLM_MODEL=gpt-4o-mini                     # 模型名
 */

import { createServer } from 'node:http';
import config from './config.js';

const PROXY_PORT = parseInt(process.env.PROXY_PORT || '4000', 10);
const TARGET_BASE = config.llm.baseUrl;
const TARGET_MODEL = config.llm.model;
const API_KEY = config.llm.apiKey;
const COMPRESS_PROMPT = config.llm.compressSystemPrompt;

// Max characters for tool descriptions (P3: Tool Schema Compression)
const MAX_TOOL_DESC_LENGTH = 300;

// --- Anthropic → OpenAI message 转换 ---

export function convertMessages(anthropicMessages) {
  const openaiMessages = [];

  for (const msg of anthropicMessages) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        openaiMessages.push({ role: msg.role, content: msg.content });
        continue;
      }

      // content 是数组 (Anthropic content blocks)
      if (Array.isArray(msg.content)) {
        const parts = [];
        const toolCalls = [];

        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push(block.text);
          } else if (block.type === 'thinking') {
            // P0: Don't forward thinking blocks to third-party — saves context tokens
            // The third-party API doesn't support thinking; forwarding wastes tokens
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            });
          } else if (block.type === 'tool_result') {
            // tool_result 在 Anthropic 中是 user 消息的一部分
            openaiMessages.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content:
                typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
            });
            continue;
          }
        }

        if (parts.length > 0 || toolCalls.length > 0) {
          const entry = { role: msg.role, content: parts.join('\n') || '' };
          if (toolCalls.length > 0) {
            entry.tool_calls = toolCalls;
          }
          openaiMessages.push(entry);
        }
      }
    }
  }

  return openaiMessages;
}

// --- Anthropic tools → OpenAI tools ---

export function convertTools(anthropicTools) {
  if (!anthropicTools?.length) return undefined;

  return anthropicTools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || { type: 'object', properties: {} },
    },
  }));
}

// --- P2: System Prompt 动态压缩 ---

/**
 * Extract AgentBoard-specific instructions from the SDK's system prompt.
 * The SDK appends our custom instructions via `systemPrompt.append`.
 * We preserve those and replace the SDK's ~60KB boilerplate with a compact version.
 */
function compressSystemPrompt(fullPrompt) {
  // Markers added by AgentBoard's getSystemPromptAppend()
  const markers = ['[SECURITY]', '[WEB ACCESS]', '[EFFICIENCY]'];

  // Extract the AgentBoard-appended section
  let agentBoardSection = '';
  for (const marker of markers) {
    const idx = fullPrompt.indexOf(marker);
    if (idx !== -1) {
      agentBoardSection = fullPrompt.slice(idx);
      break;
    }
  }

  const compactBase = [
    'You are a highly capable AI coding assistant. You help users with programming tasks, debugging, research, and general questions.',
    '',
    'Key behaviors:',
    '- Write clean, well-structured code with proper error handling',
    '- Use tools to read, write, and edit files when working on code',
    '- Use Bash to run commands, tests, and explore the filesystem',
    '- Use WebSearch/WebFetch for information not in your training data',
    '- Be concise and direct in responses',
    '- When editing files, make targeted changes rather than rewriting entire files',
    '- Always verify your changes compile/work by running relevant commands',
    '',
    'Tool usage guidelines:',
    '- Read files before editing to understand context',
    '- Use Grep/Glob to find relevant files before making changes',
    '- Run tests after making code changes to verify correctness',
    '- Use AgentTool to delegate complex sub-tasks',
    '',
  ].join('\n');

  const result = agentBoardSection ? `${compactBase}\n${agentBoardSection}` : compactBase;

  const saved = fullPrompt.length - result.length;
  if (saved > 1000) {
    console.log(
      `[proxy] system prompt compressed: ${(fullPrompt.length / 1024).toFixed(1)}KB → ${(result.length / 1024).toFixed(1)}KB (-${(saved / 1024).toFixed(1)}KB)`,
    );
  }

  return result;
}

// --- P3: Tool Schema 压缩 ---

/**
 * Truncate oversized tool descriptions to reduce payload.
 * Models work well with concise descriptions; the full schema parameters
 * already provide the structural information needed for tool selection.
 */
function compressToolSchemas(tools) {
  for (const tool of tools) {
    const desc = tool.function?.description;
    if (desc && desc.length > MAX_TOOL_DESC_LENGTH) {
      tool.function.description = desc.slice(0, MAX_TOOL_DESC_LENGTH) + '…';
    }
  }
}

// --- OpenAI response → Anthropic response ---

export function convertResponse(openaiResp, requestModel) {
  const choice = openaiResp.choices?.[0];
  if (!choice) {
    return {
      id: `msg_${openaiResp.id || Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: requestModel,
      content: [{ type: 'text', text: '' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  const content = [];

  // 文本内容
  if (choice.message?.content) {
    content.push({ type: 'text', text: choice.message.content });
  }

  // 工具调用
  if (choice.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let input;
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        input = { raw: tc.function.arguments };
      }
      content.push({
        type: 'tool_use',
        id: tc.id || `toolu_${Date.now()}`,
        name: tc.function.name,
        input,
      });
    }
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: '' });
  }

  // stop_reason 映射
  let stopReason = 'end_turn';
  if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call') {
    stopReason = 'tool_use';
  } else if (choice.finish_reason === 'length') {
    stopReason = 'max_tokens';
  }

  return {
    id: `msg_${openaiResp.id || Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: requestModel,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: openaiResp.usage?.prompt_tokens || 0,
      output_tokens: openaiResp.usage?.completion_tokens || 0,
    },
  };
}

// --- Streaming: OpenAI SSE → Anthropic SSE ---

export function createStreamTransformer(requestModel) {
  let messageId = `msg_${Date.now()}`;
  let inputTokens = 0;
  let outputTokens = 0;
  let contentIndex = 0;
  let sentStart = false;
  let pendingStopReason = null;

  return {
    header() {
      return [
        `event: message_start`,
        `data: ${JSON.stringify({
          type: 'message_start',
          message: {
            id: messageId,
            type: 'message',
            role: 'assistant',
            model: requestModel,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        })}`,
        '',
      ].join('\n');
    },

    transform(openaiChunk) {
      const events = [];

      // 优先提取 usage -- OpenAI 可能在独立 chunk 中发送 (choices: [])
      if (openaiChunk.usage) {
        inputTokens = openaiChunk.usage.prompt_tokens || 0;
        outputTokens = openaiChunk.usage.completion_tokens || 0;
      }

      const delta = openaiChunk.choices?.[0]?.delta;
      const finishReason = openaiChunk.choices?.[0]?.finish_reason;

      if (!delta && !finishReason) return '';

      // 文本内容
      if (delta?.content) {
        if (!sentStart) {
          events.push(
            `event: content_block_start`,
            `data: ${JSON.stringify({ type: 'content_block_start', index: contentIndex, content_block: { type: 'text', text: '' } })}`,
            '',
          );
          sentStart = true;
        }
        events.push(
          `event: content_block_delta`,
          `data: ${JSON.stringify({ type: 'content_block_delta', index: contentIndex, delta: { type: 'text_delta', text: delta.content } })}`,
          '',
        );
      }

      // 工具调用
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.id) {
            // 新工具调用开始
            if (sentStart) {
              events.push(
                `event: content_block_stop`,
                `data: ${JSON.stringify({ type: 'content_block_stop', index: contentIndex })}`,
                '',
              );
              contentIndex++;
            }
            events.push(
              `event: content_block_start`,
              `data: ${JSON.stringify({
                type: 'content_block_start',
                index: contentIndex,
                content_block: {
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.function?.name || '',
                  input: {},
                },
              })}`,
              '',
            );
            sentStart = true;
          }
          if (tc.function?.arguments) {
            events.push(
              `event: content_block_delta`,
              `data: ${JSON.stringify({
                type: 'content_block_delta',
                index: contentIndex,
                delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
              })}`,
              '',
            );
          }
        }
      }

      // 结束 -- 关闭 content block 但延迟发送 message_delta/stop（等 usage 到达）
      if (finishReason) {
        if (sentStart) {
          events.push(
            `event: content_block_stop`,
            `data: ${JSON.stringify({ type: 'content_block_stop', index: contentIndex })}`,
            '',
          );
        }

        let stopReason = 'end_turn';
        if (finishReason === 'tool_calls') stopReason = 'tool_use';
        if (finishReason === 'length') stopReason = 'max_tokens';

        pendingStopReason = stopReason;
      }

      return events.length ? events.join('\n') + '\n' : '';
    },

    /** 流结束后调用 -- 发送延迟的 message_delta（含 usage）和 message_stop */
    flush() {
      if (!pendingStopReason) return '';
      const events = [
        `event: message_delta`,
        `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: pendingStopReason, stop_sequence: null }, usage: { input_tokens: inputTokens, output_tokens: outputTokens } })}`,
        '',
        `event: message_stop`,
        `data: ${JSON.stringify({ type: 'message_stop' })}`,
        '',
      ];
      pendingStopReason = null;
      return events.join('\n') + '\n';
    },
  };
}

// --- HTTP Server ---

// Max request body size: 10MB (prevents memory exhaustion from oversized payloads)
const MAX_BODY_BYTES = 10 * 1024 * 1024;

const server = createServer(async (req, res) => {
  // CORS -- restrict to localhost only (proxy is internal, not browser-facing)
  const origin = req.headers.origin || '';
  const allowedOrigin =
    origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:') ? origin : '';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', target: TARGET_BASE, model: TARGET_MODEL }));
    return;
  }

  // 只处理 POST /v1/messages
  if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  // 读取请求体（带大小限制）
  let body = '';
  let bodyBytes = 0;
  for await (const chunk of req) {
    bodyBytes += chunk.length;
    if (bodyBytes > MAX_BODY_BYTES) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'error',
          error: {
            type: 'request_too_large',
            message: `Request body exceeds ${MAX_BODY_BYTES / 1024 / 1024}MB limit`,
          },
        }),
      );
      return;
    }
    body += chunk;
  }

  let anthropicReq;
  try {
    anthropicReq = JSON.parse(body);
  } catch {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'invalid JSON' }));
    return;
  }

  const isStream = anthropicReq.stream === true;
  const requestModel = anthropicReq.model || 'claude-sonnet-4-20250514';

  // 构建 OpenAI 请求
  const openaiReq = {
    model: TARGET_MODEL,
    messages: [],
    stream: isStream,
  };

  // system prompt — P2: 动态压缩 SDK 巨型 system prompt
  if (anthropicReq.system) {
    const rawText =
      typeof anthropicReq.system === 'string'
        ? anthropicReq.system
        : anthropicReq.system.map((s) => s.text || '').join('\n');
    const systemText = COMPRESS_PROMPT ? compressSystemPrompt(rawText) : rawText;
    openaiReq.messages.push({ role: 'system', content: systemText });
  }

  // messages
  openaiReq.messages.push(...convertMessages(anthropicReq.messages || []));

  // parameters
  if (anthropicReq.max_tokens) openaiReq.max_tokens = anthropicReq.max_tokens;
  if (anthropicReq.temperature != null) openaiReq.temperature = anthropicReq.temperature;
  if (anthropicReq.top_p != null) openaiReq.top_p = anthropicReq.top_p;

  // tools — P3: 压缩过长的 tool descriptions
  const tools = convertTools(anthropicReq.tools);
  if (tools) {
    compressToolSchemas(tools);
    openaiReq.tools = tools;
  }

  // stream_options for token usage in streaming
  if (isStream) {
    openaiReq.stream_options = { include_usage: true };
  }

  // 转发到目标 LLM
  const requestBody = JSON.stringify(openaiReq);
  console.log(
    `[proxy] → ${TARGET_BASE}/chat/completions | model=${openaiReq.model} stream=${isStream} msgs=${openaiReq.messages.length} tools=${openaiReq.tools?.length || 0} size=${(requestBody.length / 1024).toFixed(1)}KB`,
  );
  try {
    const targetResp = await fetch(`${TARGET_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: requestBody,
    });

    if (!targetResp.ok) {
      const errText = await targetResp.text();
      console.error(`[proxy] target error ${targetResp.status}: ${errText}`);
      res.writeHead(targetResp.status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message: errText },
        }),
      );
      return;
    }

    if (!isStream) {
      // 非流式：直接翻译响应
      const openaiResp = await targetResp.json();
      const anthropicResp = convertResponse(openaiResp, requestModel);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(anthropicResp));
      return;
    }

    // 流式：逐块翻译 SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const transformer = createStreamTransformer(requestModel);
    res.write(transformer.header() + '\n');

    const reader = targetResp.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const chunk = JSON.parse(data);
          const transformed = transformer.transform(chunk);
          if (transformed) res.write(transformed);
        } catch {
          // skip malformed chunks
        }
      }
    }

    // Process any remaining data in the SSE buffer
    if (sseBuffer.trim()) {
      const remaining = sseBuffer.trim();
      if (remaining.startsWith('data: ')) {
        const data = remaining.slice(6).trim();
        if (data !== '[DONE]') {
          try {
            const chunk = JSON.parse(data);
            const transformed = transformer.transform(chunk);
            if (transformed) res.write(transformed);
          } catch {
            // skip malformed tail chunk
          }
        }
      }
    }

    // 流结束 -- flush 延迟的 message_delta/stop（含最终 usage）
    const flushed = transformer.flush();
    if (flushed) res.write(flushed);

    res.end();
  } catch (err) {
    console.error(`[proxy] fetch error: ${err.message}`);
    if (res.headersSent) {
      // Headers already written (mid-stream failure) -- send SSE error event and close
      try {
        res.write(
          `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'stream_error', message: err.message } })}\n\n`,
        );
      } catch {
        /* ignore write failure */
      }
      res.end();
    } else {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message: err.message },
        }),
      );
    }
  }
});

server.listen(PROXY_PORT, () => {
  console.log(`Anthropic→OpenAI proxy listening on http://localhost:${PROXY_PORT}`);
  console.log(`Target: ${TARGET_BASE} / ${TARGET_MODEL}`);
});

export default server;
