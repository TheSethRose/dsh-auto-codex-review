import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDecision, REVIEW_POLICY } from '../src/index.js';
import { readCliEvents, resolveConfig, childEnvironment, codexArguments } from '../src/codex.js';
test('retains upstream risk policy verbatim', async () => {
  const baseline = await readFile(new URL('../upstream/index.ts', import.meta.url), 'utf8');
  assert.equal(REVIEW_POLICY, baseline.match(/const REVIEW_POLICY = \x60([\s\S]*?)\x60/)[1]);
});
for (const text of ['{"risk":"low","decision":"allow"}', '{"risk":"medium","decision":"allow"}',
  '{"risk":"medium","decision":"deny"}', '{"risk":"high","decision":"deny"}',
  '{"risk":"medium","decision":"deny","reason":"No exact authorization"}', '{"risk":"high","decision":"deny","reason":"Sensitive exfiltration"}']) {
  test('accepts decision '+text, () => assert.deepEqual(parseDecision(text), JSON.parse(text)));
}
for (const text of ['null','[]','{}','{"risk":"low","decision":"deny"}','{"risk":"high","decision":"allow"}',
  '{"risk":"critical","decision":"deny"}', '{"risk":"low","decision":"allow","reason":"OK"}',
  '{"risk":"low","risk":"medium","decision":"allow"}', '{"risk":"low","decision":"allow","extra":0}',
  'markdown wrapped JSON','{"risk":"low","decision":"allow"}\n{}',
  '{"risk":"medium","decision":"deny","reason":42}']) {
  test('rejects incompatible decision '+text, () => assert.throws(() => parseDecision(text)));
}
const valid=[{type:'thread.started'}, {type:'turn.started'},
  {type:'item.completed',item:{type:'agent_message',text:'{"risk":"low","decision":"allow"}'}}, {type:'turn.completed'}];
const lines=values=>values.map(v=>JSON.stringify(v)).join('\n');
test('requires a complete text-only CLI turn', () => assert.equal(readCliEvents(lines(valid)), valid[2].item.text));
for(const [i,events] of [valid.slice(0,3),valid.slice(1),[...valid,valid[2]],
  [...valid.slice(0,2),{type:'item.completed',item:{type:'command_execution'}},...valid.slice(2)],
  [...valid.slice(0,2),{type:'turn.failed'}], [...valid.slice(0,3),valid[2],valid[3]]].entries()) {
  test('rejects invalid CLI event sequence '+i, () => assert.throws(() => readCliEvents(lines(events))));
}
test('redacts child/model text from JSON errors',()=>{
  for(const parser of [readCliEvents,parseDecision]) assert.throws(()=>parser('PRIVATE_PROMPT_FRAGMENT malformed'),error=>!error.message.includes('PRIVATE'));
});
test('deployment options cannot select another model or provider',()=>{
  assert.equal(resolveConfig().codexPath,'codex');
  for(const options of [{model:'other'},{provider:'other'},{args:[]},{timeoutMs:0},{maxBytes:1.5},{codexPath:''},{timeoutMs:Infinity}]) assert.throws(()=>resolveConfig(options));
  const args=codexArguments('http://127.0.0.1:1/random','/temporary/policy.txt');
  assert.equal(args[args.indexOf('--model')+1],'codex-auto-review');
  assert(args.includes('mcp_servers={}'));assert(args.includes('forced_login_method="chatgpt"'));
  assert(args.includes('features.shell_tool=false'));assert(args.includes('features.hooks=false'));
});
test('child env excludes keys, proxies and executable injection',()=>{
  assert.deepEqual(childEnvironment({HOME:'/home/test',PATH:'/bin',CODEX_HOME:'/home/test/.codex',OPENAI_API_KEY:'synthetic-secret',HTTPS_PROXY:'http://bad',NODE_OPTIONS:'--require bad',BASH_ENV:'bad'}),
    {HOME:'/home/test',PATH:'/bin',CODEX_HOME:'/home/test/.codex',NO_COLOR:'1'});
});
