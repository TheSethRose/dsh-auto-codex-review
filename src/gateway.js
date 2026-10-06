import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

export const REVIEW_MODEL = 'codex-auto-review';
const UPSTREAM = 'https://chatgpt.com/backend-api/codex/responses';
export const DECISION_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['risk', 'decision'],
  properties: { risk: { type: 'string', enum: ['low', 'medium', 'high'] }, decision: { type: 'string', enum: ['allow', 'deny'] } },
});
const EVENTS = new Set(['response.created', 'response.in_progress', 'response.completed',
  'response.output_item.added', 'response.output_item.done', 'response.content_part.added', 'response.content_part.done',
  'response.output_text.delta', 'response.output_text.done', 'response.reasoning_summary_text.delta',
  'response.reasoning_summary_text.done', 'response.reasoning_summary_part.added', 'response.reasoning_summary_part.done',
  'response.reasoning_text.delta', 'response.reasoning_text.done']);

/** Reject all tool-bearing events BEFORE Codex can dispatch their contents. */
export function validateEvent(value) {
  if (!value || !EVENTS.has(value.type)) throw new Error('codex review: unsupported upstream event');
  const item = (v) => {
    if (!v || typeof v.id !== 'string' || !['message', 'reasoning'].includes(v.type)) throw new Error('codex review: upstream attempted a tool or unsupported item');
    if (v.type === 'message' && v.role !== 'assistant') throw new Error('codex review: non-assistant output');
    if (v.type === 'message' && !Array.isArray(v.content)) throw new Error('codex review: invalid message content');
    for (const part of v.content ?? []) {
      if (!part || part.type !== 'output_text' || typeof part.text !== 'string') throw new Error('codex review: unsupported message content');
    }
  };
  if (value.type.startsWith('response.output_item.')) item(value.item);
  if (value.type.includes('content_part.') || value.type.includes('summary_part.')) {
    if (!value.part || !['output_text', 'summary_text', 'reasoning_text'].includes(value.part.type) || typeof value.part.text !== 'string') throw new Error('codex review: unsupported content part');
  }
  if (value.type.endsWith('.delta') && typeof value.delta !== 'string') throw new Error('codex review: invalid text delta');
  if (value.type.endsWith('_text.done') && typeof value.text !== 'string') throw new Error('codex review: invalid completed text');
  if (['response.created','response.in_progress','response.completed'].includes(value.type) &&
      (!value.response || typeof value.response.id !== 'string' || !Array.isArray(value.response.output))) throw new Error('codex review: invalid response fields');
  for (const v of value.response?.output ?? []) item(v);
  if (value.type === 'response.completed' && value.response?.status !== 'completed') throw new Error('codex review: incomplete upstream response');
}

/** Replace CLI prompt/tool inputs rather than trusting configuration or AGENTS suppression. */
export function reviewRequest(original, policy, prompt) {
  if (!original || typeof original !== 'object' || Array.isArray(original)) throw new Error('codex review: invalid request');
  // Explicit construction excludes previous_response_id, tool outputs, cache keys and injected context.
  return {
    model: REVIEW_MODEL, instructions: policy,
    input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
    tools: [], tool_choice: 'none', parallel_tool_calls: false,
    store: false, stream: true,
    reasoning: { effort: 'low' },
    text: { format: { type: 'json_schema', name: 'auto_review_decision', strict: true, schema: DECISION_SCHEMA } },
  };
}

/** Start a one-request loopback relay with a private random path and fixed ChatGPT destination.
 * Auth is forwarded transiently from CLI headers, never read from credential storage or logged.
 */
export async function startGateway({ policy, prompt, maxBytes, signal, fetchImpl = fetch }) {
  const secret = randomBytes(32).toString('hex');
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  let used = false;
  let failure;
  let completed = false;
  let terminal;
  const active = new Set();
  const server = createServer(async (req, res) => {
    const done = Promise.withResolvers();
    active.add(done.promise);
    const requestController = new AbortController();
    const requestSignal = AbortSignal.any([combined, requestController.signal]);
    const disconnect = () => { if (!res.writableEnded) requestController.abort(); };
    res.once('close', disconnect);
    req.once('aborted', disconnect);
    try {
      if (req.method !== 'POST' || req.url !== '/' + secret + '/responses') {
        res.writeHead(403).end(); return;
      }
      if (used) { failure ??= new Error('codex review: repeated CLI request'); res.writeHead(403).end(); return; }
      used = true;
      if (req.headers['content-encoding']) throw new Error('codex review: compressed requests are unsupported');
      let bytes = 0;
      const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > maxBytes) throw new Error('codex review: request exceeds configured byte limit');
        chunks.push(chunk);
      }
      const payload = reviewRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')), policy, prompt);
      const auth = req.headers.authorization;
      if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) throw new Error('codex review: CLI supplied no ChatGPT authorization');
      const headers = { authorization: auth, 'content-type': 'application/json', accept: 'text/event-stream' };
      // Account routing belongs to CLI auth; do not retain it or copy arbitrary CLI headers.
      if (typeof req.headers['chatgpt-account-id'] === 'string') headers['chatgpt-account-id'] = req.headers['chatgpt-account-id'];
      const upstream = await fetchImpl(UPSTREAM, { method: 'POST', headers, body: JSON.stringify(payload), signal: requestSignal, redirect: 'error' });
      // This ChatGPT endpoint can omit Content-Type; validate every SSE record instead.
      if (!upstream.ok || !upstream.body) throw new Error('codex review: upstream rejected review (HTTP ' + upstream.status + ')');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let pending = '';
      let received = 0;
      const accept = (block) => {
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) return;
        if (terminal) throw new Error('codex review: data after terminal response');
        const value = JSON.parse(data);
        validateEvent(value);
        if (value.type === 'response.completed') terminal = value;
        else res.write('data: ' + JSON.stringify(value) + '\n\n');
      };
      for await (const chunk of upstream.body) {
        received += chunk.byteLength;
        if (received > maxBytes) throw new Error('codex review: upstream output exceeds configured byte limit');
        pending += decoder.decode(chunk, { stream: true });
        pending = pending.replace(/\r\n/g, '\n');
        let index;
        while ((index = pending.indexOf('\n\n')) !== -1) {
          const block = pending.slice(0, index); pending = pending.slice(index + 2); accept(block);
        }
      }
      pending += decoder.decode();
      if (pending.trim()) accept(pending);
      if (!terminal) throw new Error('codex review: upstream emitted no terminal response');
      completed = true;
      res.end('data: ' + JSON.stringify(terminal) + '\n\n');
    } catch (error) {
      // Never surface request headers, upstream body, or raw network diagnostics.
      failure ??= new Error(error instanceof Error && error.message.startsWith('codex review:') ? error.message : 'codex review: gateway failed');
      controller.abort(failure);
      res.destroy();
    } finally {
      res.removeListener("close", disconnect); req.removeListener("aborted", disconnect);
      active.delete(done.promise); done.resolve();
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  return {
    url: 'http://127.0.0.1:' + port + '/' + secret,
    assertCompleted() { if (failure) throw failure; if (!used || !completed) throw new Error('codex review: no completed gateway review'); },
    async close() { controller.abort(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await Promise.allSettled([...active]); },
  };
}
