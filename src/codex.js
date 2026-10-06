import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGateway, REVIEW_MODEL } from './gateway.js';

export const DEFAULT_CONFIG = Object.freeze({ codexPath: 'codex', timeoutMs: 120000, maxBytes: 2097152 });
/** Validate deployment options; model/provider and arbitrary CLI args are deliberately not configurable. */
export function resolveConfig(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('codex review: invalid config');
  for (const key of Object.keys(value)) if (!Object.hasOwn(DEFAULT_CONFIG, key)) throw new Error('codex review: unknown config field ' + key);
  const config = { ...DEFAULT_CONFIG, ...value };
  if (typeof config.codexPath !== 'string' || !config.codexPath.trim()) throw new Error('codex review: codexPath must be nonempty');
  for (const key of ['timeoutMs', 'maxBytes']) if (!Number.isSafeInteger(config[key]) || config[key] <= 0 || config[key] > 2147483647) throw new Error('codex review: ' + key + ' must be a bounded positive integer');
  return Object.freeze(config);
}

/** Keep login discovery but exclude API credentials, proxy/provider overrides and Node/shell injection. */
export function childEnvironment(env = process.env) {
  const result = {};
  for (const key of ['HOME', 'USERPROFILE', 'PATH', 'CODEX_HOME', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'WINDIR']) {
    if (typeof env[key] === 'string') result[key] = env[key];
  }
  result.NO_COLOR = '1';
  return result;
}

export function codexArguments(gatewayUrl, policyPath) {
  const args = ['--no-daemon', 'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', 'read-only', '--model', REVIEW_MODEL, '--json', '--color', 'never'];
  const config = {
    model_provider: 'dsh_codex_review',
    'model_providers.dsh_codex_review.name': 'DSH Codex review',
    'model_providers.dsh_codex_review.base_url': gatewayUrl,
    'model_providers.dsh_codex_review.wire_api': 'responses',
    'model_providers.dsh_codex_review.requires_openai_auth': true,
    'model_providers.dsh_codex_review.request_max_retries': 0,
    'model_providers.dsh_codex_review.stream_max_retries': 0,
    model_instructions_file: policyPath, forced_login_method: 'chatgpt', approval_policy: 'never',
    web_search: 'disabled', project_doc_max_bytes: 0, 'skills.include_instructions': false,
    'features.shell_tool': false, 'features.shell_snapshot': false,
    'features.plugins': false, 'features.apps': false, 'features.hooks': false,
    'features.multi_agent': false, 'features.view_image': false,
    'features.image_generation': false, 'features.browser_use': false,
    'features.computer_use': false, 'features.enable_request_compression': false,
    'features.responses_websockets': false, 'features.responses_websockets_v2': false,
  };
  for (const [key, value] of Object.entries(config)) args.push('-c', key + '=' + JSON.stringify(value));
  args.push('-c', 'mcp_servers={}', '-');
  return args;
}

/** Accept one text-only terminal CLI turn. Unknown events and tool activity fail closed. */
export function readCliEvents(text) {
  let phase = 0;
  let output;
  for (const line of text.split('\n').filter(line => line.trim())) {
    let event;
    try { event = JSON.parse(line); } catch { throw new Error('codex review: malformed CLI event'); }
    if (!event || typeof event !== 'object') throw new Error('codex review: malformed CLI event');
    if (event.type === 'thread.started' && phase === 0) { phase = 1; continue; }
    if (event.type === 'turn.started' && phase === 1) { phase = 2; continue; }
    if (event.type === 'item.completed' && phase === 2 && event.item?.type === 'agent_message' && typeof event.item.text === 'string' && output === undefined) {
      output = event.item.text; continue;
    }
    if (event.type === 'item.completed' && phase === 2 && event.item?.type === 'reasoning' && output === undefined) continue;
    if (event.type === 'turn.completed' && phase === 2 && output !== undefined) { phase = 3; continue; }
    throw new Error('codex review: invalid CLI event sequence or tool activity');
  }
  if (phase !== 3) throw new Error('codex review: CLI emitted no completed text-only turn');
  return output;
}

/** Collect/terminate one process group. Never include stderr or prompt text in errors. */
export function execute(executable, args, cwd, prompt, signal, maxBytes) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(executable, args, { cwd, env: childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, shell: false }); }
    catch { reject(new Error('codex review: failed to spawn CLI')); return; }
    let output = '';
    let bytes = 0;
    let failure;
    let killTimer;
    const kill = (force = false) => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') child.kill(force ? 'SIGKILL' : 'SIGTERM');
        else process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
      } catch (error) { if (error.code !== 'ESRCH') failure ??= new Error('codex review: child termination failed'); }
    };
    const stop = (error) => {
      if (failure) return;
      failure = error; kill(); killTimer = setTimeout(() => kill(true), 250);
    };
    const abort = () => stop(new Error('codex review: cancelled or timed out'));
    signal.addEventListener('abort', abort, { once: true });
    child.once('error', () => stop(new Error('codex review: CLI unavailable')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes > maxBytes) stop(new Error('codex review: CLI output exceeds configured byte limit')); else output += chunk; });
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) stop(new Error('codex review: CLI output exceeds configured byte limit')); });
    child.stdin.on('error', () => stop(new Error('codex review: CLI input failed')));
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort); clearTimeout(killTimer);
      // Close can arrive while a forked descendant survives: kill the entire dedicated process group.
      kill(true);
      if (signal.aborted) failure ??= new Error('codex review: cancelled or timed out');
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error('codex review: CLI exited unsuccessfully'));
      else { try { resolve(readCliEvents(output)); } catch (error) { reject(error); } }
    });
    if (signal.aborted) abort();
    else child.stdin.end(prompt);
  });
}

/** Review only the frozen DSH policy/data via installed Codex ChatGPT login; no model fallback. */
export async function reviewWithCodex({ policy, prompt, signal, config = DEFAULT_CONFIG }) {
  config = resolveConfig(config);
  if (typeof policy !== 'string' || !policy.trim() || typeof prompt !== 'string') throw new Error('codex review: invalid prompt');
  if (Buffer.byteLength(policy) + Buffer.byteLength(prompt) > config.maxBytes) throw new Error('codex review: prompt exceeds configured byte limit');
  signal ??= new AbortController().signal;
  signal.throwIfAborted();
  if (process.platform === 'win32') throw new Error('codex review: Windows process-tree isolation is not supported');
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);
  const directory = await mkdtemp(join(tmpdir(), 'dsh-auto-codex-review-'));
  let gateway;
  try {
    const policyPath = join(directory, 'policy.txt');
    await writeFile(policyPath, policy, { mode: 0o600 });
    gateway = await startGateway({ policy, prompt, maxBytes: config.maxBytes, signal: combined });
    let text;
    try { text = await execute(config.codexPath, codexArguments(gateway.url, policyPath), directory, prompt, combined, config.maxBytes); }
    catch (error) { gateway.assertCompleted(); throw error; }
    combined.throwIfAborted();
    gateway.assertCompleted();
    return text;
  } finally {
    await gateway?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
