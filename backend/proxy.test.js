import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock node:http and config.js before importing proxy.js (module-level side effects)
vi.mock('node:http', () => ({
  createServer: vi.fn(() => ({ listen: vi.fn() })),
}));
vi.mock('./config.js', () => ({
  default: {
    llm: {
      baseUrl: 'http://test',
      model: 'test-model',
      apiKey: 'key',
      compressSystemPrompt: false,
    },
  },
}));

let convertMessages, convertTools, convertResponse, createStreamTransformer;

beforeAll(async () => {
  const mod = await import('./proxy.js');
  convertMessages = mod.convertMessages;
  convertTools = mod.convertTools;
  convertResponse = mod.convertResponse;
  createStreamTransformer = mod.createStreamTransformer;
});

// ---------------------------------------------------------------------------
// convertMessages
// ---------------------------------------------------------------------------
describe('convertMessages', () => {
  it('passes through string content as-is', () => {
    const result = convertMessages([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
    expect(result).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
  });

  it('joins text blocks from array content', () => {
    const result = convertMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'line one' },
          { type: 'text', text: 'line two' },
        ],
      },
    ]);
    expect(result).toEqual([{ role: 'user', content: 'line one\nline two' }]);
  });

  it('strips thinking blocks to save context tokens (P0)', () => {
    const result = convertMessages([
      {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'let me think...' }],
      },
    ]);
    // Thinking blocks should be dropped — third-party APIs don't support them
    expect(result).toEqual([]);
  });

  it('converts tool_use blocks to tool_calls array', () => {
    const result = convertMessages([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'get_weather',
            input: { city: 'Tokyo' },
          },
        ],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
    expect(result[0].content).toBe('');
    expect(result[0].tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: JSON.stringify({ city: 'Tokyo' }),
        },
      },
    ]);
  });

  it('converts tool_result blocks to role:tool messages', () => {
    const result = convertMessages([
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'sunny' }],
      },
    ]);
    expect(result).toEqual([{ role: 'tool', tool_call_id: 'call_1', content: 'sunny' }]);
  });

  it('handles mixed content (text + tool_use in one message)', () => {
    const result = convertMessages([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will look that up.' },
          {
            type: 'tool_use',
            id: 'call_2',
            name: 'search',
            input: { q: 'vitest' },
          },
        ],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('I will look that up.');
    expect(result[0].tool_calls).toHaveLength(1);
    expect(result[0].tool_calls[0].function.name).toBe('search');
  });

  it('returns empty array for empty input', () => {
    expect(convertMessages([])).toEqual([]);
  });

  it('stringifies non-string tool_result content', () => {
    const result = convertMessages([
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_3',
            content: [{ type: 'text', text: 'result text' }],
          },
        ],
      },
    ]);
    expect(result).toEqual([
      {
        role: 'tool',
        tool_call_id: 'call_3',
        content: JSON.stringify([{ type: 'text', text: 'result text' }]),
      },
    ]);
  });

  it('skips messages with only tool_result blocks (no leftover entry)', () => {
    // When every block is tool_result, the parts/toolCalls arrays are empty
    // so no extra entry is pushed beyond the tool messages
    const result = convertMessages([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: 'ok' },
          { type: 'tool_result', tool_use_id: 'c2', content: 'ok' },
        ],
      },
    ]);
    // Only tool messages, no extra user message
    expect(result).toEqual([
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
      { role: 'tool', tool_call_id: 'c2', content: 'ok' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// convertTools
// ---------------------------------------------------------------------------
describe('convertTools', () => {
  it('returns undefined for null', () => {
    expect(convertTools(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(convertTools(undefined)).toBeUndefined();
  });

  it('returns undefined for empty array', () => {
    expect(convertTools([])).toBeUndefined();
  });

  it('converts Anthropic tool definitions to OpenAI function format', () => {
    const tools = [
      {
        name: 'get_weather',
        description: 'Get current weather',
        input_schema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ];
    const result = convertTools(tools);
    expect(result).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get current weather',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      },
    ]);
  });

  it('defaults missing description to empty string', () => {
    const result = convertTools([
      { name: 'tool_a', input_schema: { type: 'object', properties: {} } },
    ]);
    expect(result[0].function.description).toBe('');
  });

  it('defaults missing input_schema to { type: "object", properties: {} }', () => {
    const result = convertTools([{ name: 'tool_b', description: 'desc' }]);
    expect(result[0].function.parameters).toEqual({ type: 'object', properties: {} });
  });

  it('converts multiple tools', () => {
    const tools = [
      { name: 'a', description: 'A', input_schema: { type: 'object', properties: {} } },
      { name: 'b', description: 'B', input_schema: { type: 'object', properties: {} } },
    ];
    const result = convertTools(tools);
    expect(result).toHaveLength(2);
    expect(result[0].function.name).toBe('a');
    expect(result[1].function.name).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// convertResponse
// ---------------------------------------------------------------------------
describe('convertResponse', () => {
  it('converts a text-only response', () => {
    const openaiResp = {
      id: 'chatcmpl-1',
      choices: [
        {
          message: { content: 'Hello there' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    const result = convertResponse(openaiResp, 'claude-sonnet-4-20250514');
    expect(result.id).toBe('msg_chatcmpl-1');
    expect(result.type).toBe('message');
    expect(result.role).toBe('assistant');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.content).toEqual([{ type: 'text', text: 'Hello there' }]);
    expect(result.stop_reason).toBe('end_turn');
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it('converts a tool call response with JSON arguments', () => {
    const openaiResp = {
      id: 'chatcmpl-2',
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'tc_1',
                type: 'function',
                function: { name: 'search', arguments: '{"q":"test"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 15 },
    };
    const result = convertResponse(openaiResp, 'test-model');
    expect(result.content).toEqual([
      { type: 'tool_use', id: 'tc_1', name: 'search', input: { q: 'test' } },
    ]);
    expect(result.stop_reason).toBe('tool_use');
  });

  it('wraps invalid JSON arguments in { raw: ... }', () => {
    const openaiResp = {
      id: 'chatcmpl-3',
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: 'tc_2',
                function: { name: 'fn', arguments: 'not-json' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    const result = convertResponse(openaiResp, 'model');
    expect(result.content[0].input).toEqual({ raw: 'not-json' });
  });

  it('returns fallback empty message when no choices', () => {
    const openaiResp = { id: 'chatcmpl-4', choices: [] };
    const result = convertResponse(openaiResp, 'model');
    expect(result.content).toEqual([{ type: 'text', text: '' }]);
    expect(result.stop_reason).toBe('end_turn');
    expect(result.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });

  it('returns fallback when choices is undefined', () => {
    const result = convertResponse({ id: 'x' }, 'model');
    expect(result.content).toEqual([{ type: 'text', text: '' }]);
  });

  it('maps stop_reason: stop -> end_turn', () => {
    const resp = { id: 'r', choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] };
    expect(convertResponse(resp, 'm').stop_reason).toBe('end_turn');
  });

  it('maps stop_reason: tool_calls -> tool_use', () => {
    const resp = { id: 'r', choices: [{ message: { content: 'x' }, finish_reason: 'tool_calls' }] };
    expect(convertResponse(resp, 'm').stop_reason).toBe('tool_use');
  });

  it('maps stop_reason: function_call -> tool_use', () => {
    const resp = {
      id: 'r',
      choices: [{ message: { content: 'x' }, finish_reason: 'function_call' }],
    };
    expect(convertResponse(resp, 'm').stop_reason).toBe('tool_use');
  });

  it('maps stop_reason: length -> max_tokens', () => {
    const resp = { id: 'r', choices: [{ message: { content: 'x' }, finish_reason: 'length' }] };
    expect(convertResponse(resp, 'm').stop_reason).toBe('max_tokens');
  });

  it('maps usage fields correctly', () => {
    const resp = {
      id: 'r',
      choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 42, completion_tokens: 17 },
    };
    expect(convertResponse(resp, 'm').usage).toEqual({ input_tokens: 42, output_tokens: 17 });
  });

  it('defaults usage to zeros when absent', () => {
    const resp = { id: 'r', choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] };
    expect(convertResponse(resp, 'm').usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });

  it('adds fallback text block when message has no content and no tool_calls', () => {
    const resp = { id: 'r', choices: [{ message: {}, finish_reason: 'stop' }] };
    expect(convertResponse(resp, 'm').content).toEqual([{ type: 'text', text: '' }]);
  });
});

// ---------------------------------------------------------------------------
// createStreamTransformer
// ---------------------------------------------------------------------------
describe('createStreamTransformer', () => {
  /** Helper: parse SSE text into array of { event, data } */
  function parseSSE(text) {
    const events = [];
    const blocks = text.split('\n\n').filter(Boolean);
    for (const block of blocks) {
      const lines = block.split('\n');
      let event = '';
      let data = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7);
        if (line.startsWith('data: ')) data = line.slice(6);
      }
      if (event || data) events.push({ event, data: data ? JSON.parse(data) : null });
    }
    return events;
  }

  it('header() returns a message_start SSE event', () => {
    const t = createStreamTransformer('test-model');
    const events = parseSSE(t.header());
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('message_start');
    expect(events[0].data.type).toBe('message_start');
    expect(events[0].data.message.role).toBe('assistant');
    expect(events[0].data.message.model).toBe('test-model');
    expect(events[0].data.message.content).toEqual([]);
  });

  it('transform() with text delta emits content_block_start + content_block_delta', () => {
    const t = createStreamTransformer('m');
    const output = t.transform({
      choices: [{ delta: { content: 'hello' }, finish_reason: null }],
    });
    const events = parseSSE(output);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('content_block_start');
    expect(events[0].data.content_block.type).toBe('text');
    expect(events[1].event).toBe('content_block_delta');
    expect(events[1].data.delta.type).toBe('text_delta');
    expect(events[1].data.delta.text).toBe('hello');
  });

  it('transform() subsequent text delta does not re-emit content_block_start', () => {
    const t = createStreamTransformer('m');
    t.transform({ choices: [{ delta: { content: 'a' }, finish_reason: null }] });
    const output = t.transform({
      choices: [{ delta: { content: 'b' }, finish_reason: null }],
    });
    const events = parseSSE(output);
    // Only delta, no new start
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('content_block_delta');
    expect(events[0].data.delta.text).toBe('b');
  });

  it('transform() tool_call with id emits content_block_start (tool_use)', () => {
    const t = createStreamTransformer('m');
    const output = t.transform({
      choices: [
        {
          delta: {
            tool_calls: [{ id: 'tc_1', function: { name: 'search', arguments: '' } }],
          },
          finish_reason: null,
        },
      ],
    });
    const events = parseSSE(output);
    // content_block_start for tool_use
    const start = events.find((e) => e.event === 'content_block_start');
    expect(start).toBeTruthy();
    expect(start.data.content_block.type).toBe('tool_use');
    expect(start.data.content_block.id).toBe('tc_1');
    expect(start.data.content_block.name).toBe('search');
  });

  it('transform() tool_call arguments emits input_json_delta', () => {
    const t = createStreamTransformer('m');
    // First chunk: start the tool call
    t.transform({
      choices: [
        {
          delta: { tool_calls: [{ id: 'tc_1', function: { name: 'fn', arguments: '' } }] },
          finish_reason: null,
        },
      ],
    });
    // Second chunk: argument fragment
    const output = t.transform({
      choices: [
        {
          delta: { tool_calls: [{ function: { arguments: '{"a":1}' } }] },
          finish_reason: null,
        },
      ],
    });
    const events = parseSSE(output);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('content_block_delta');
    expect(events[0].data.delta.type).toBe('input_json_delta');
    expect(events[0].data.delta.partial_json).toBe('{"a":1}');
  });

  it('transform() with finishReason closes block and sets pendingStopReason', () => {
    const t = createStreamTransformer('m');
    t.transform({ choices: [{ delta: { content: 'x' }, finish_reason: null }] });
    const output = t.transform({ choices: [{ delta: {}, finish_reason: 'stop' }] });
    const events = parseSSE(output);
    const stop = events.find((e) => e.event === 'content_block_stop');
    expect(stop).toBeTruthy();
    // flush should now produce message_delta
    const flushed = t.flush();
    expect(flushed).toContain('message_delta');
  });

  it('transform() maps finishReason tool_calls to tool_use stop_reason', () => {
    const t = createStreamTransformer('m');
    t.transform({
      choices: [
        {
          delta: { tool_calls: [{ id: 'x', function: { name: 'f', arguments: '' } }] },
          finish_reason: null,
        },
      ],
    });
    t.transform({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    const flushed = parseSSE(t.flush());
    const msgDelta = flushed.find((e) => e.event === 'message_delta');
    expect(msgDelta.data.delta.stop_reason).toBe('tool_use');
  });

  it('transform() maps finishReason length to max_tokens stop_reason', () => {
    const t = createStreamTransformer('m');
    t.transform({ choices: [{ delta: { content: 'a' }, finish_reason: null }] });
    t.transform({ choices: [{ delta: {}, finish_reason: 'length' }] });
    const flushed = parseSSE(t.flush());
    const msgDelta = flushed.find((e) => e.event === 'message_delta');
    expect(msgDelta.data.delta.stop_reason).toBe('max_tokens');
  });

  it('transform() standalone usage chunk (no delta, no finishReason) updates counters silently', () => {
    const t = createStreamTransformer('m');
    // Usage-only chunk -- choices is empty array
    const output = t.transform({
      choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
    // Should return empty string (no SSE events)
    expect(output).toBe('');
  });

  it('flush() emits message_delta with usage and message_stop', () => {
    const t = createStreamTransformer('m');
    // Feed usage
    t.transform({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 20 } });
    // Feed text + finish
    t.transform({ choices: [{ delta: { content: 'x' }, finish_reason: null }] });
    t.transform({ choices: [{ delta: {}, finish_reason: 'stop' }] });

    const events = parseSSE(t.flush());
    expect(events).toHaveLength(2);

    const msgDelta = events[0];
    expect(msgDelta.event).toBe('message_delta');
    expect(msgDelta.data.delta.stop_reason).toBe('end_turn');
    expect(msgDelta.data.usage).toEqual({ input_tokens: 10, output_tokens: 20 });

    const msgStop = events[1];
    expect(msgStop.event).toBe('message_stop');
  });

  it('flush() returns empty string when no finish was received', () => {
    const t = createStreamTransformer('m');
    expect(t.flush()).toBe('');
  });

  it('full pipeline: header + multiple transforms + flush produces valid SSE sequence', () => {
    const t = createStreamTransformer('gpt-4o');
    const parts = [];

    // The server writes header() + '\n' to add the SSE block separator
    parts.push(t.header() + '\n');
    parts.push(t.transform({ choices: [{ delta: { content: 'He' }, finish_reason: null }] }));
    parts.push(t.transform({ choices: [{ delta: { content: 'llo' }, finish_reason: null }] }));
    parts.push(
      t.transform({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }),
    );
    parts.push(t.flush());

    const fullSSE = parts.join('');
    const events = parseSSE(fullSSE);

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes[0]).toBe('message_start');
    expect(eventTypes).toContain('content_block_start');
    expect(eventTypes).toContain('content_block_delta');
    expect(eventTypes).toContain('content_block_stop');
    expect(eventTypes).toContain('message_delta');
    expect(eventTypes[eventTypes.length - 1]).toBe('message_stop');

    // Verify text content was accumulated across deltas
    const textDeltas = events.filter((e) => e.data?.delta?.type === 'text_delta');
    const fullText = textDeltas.map((e) => e.data.delta.text).join('');
    expect(fullText).toBe('Hello');
  });

  it('tool call pipeline: text then tool then finish', () => {
    const t = createStreamTransformer('model');
    const parts = [];

    parts.push(t.header() + '\n');
    // Text
    parts.push(
      t.transform({ choices: [{ delta: { content: 'Let me search.' }, finish_reason: null }] }),
    );
    // Tool start
    parts.push(
      t.transform({
        choices: [
          {
            delta: { tool_calls: [{ id: 'tc1', function: { name: 'web_search', arguments: '' } }] },
            finish_reason: null,
          },
        ],
      }),
    );
    // Tool args
    parts.push(
      t.transform({
        choices: [
          {
            delta: { tool_calls: [{ function: { arguments: '{"q":"vitest"}' } }] },
            finish_reason: null,
          },
        ],
      }),
    );
    // Finish
    parts.push(t.transform({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }));
    parts.push(t.flush());

    const events = parseSSE(parts.join(''));
    const types = events.map((e) => e.event);

    // Should have two content_block_start events (text + tool_use)
    const starts = events.filter((e) => e.event === 'content_block_start');
    expect(starts).toHaveLength(2);
    expect(starts[0].data.content_block.type).toBe('text');
    expect(starts[1].data.content_block.type).toBe('tool_use');

    // Should end with message_delta (tool_use) + message_stop
    const msgDelta = events.find((e) => e.event === 'message_delta');
    expect(msgDelta.data.delta.stop_reason).toBe('tool_use');
    expect(types[types.length - 1]).toBe('message_stop');
  });
});
