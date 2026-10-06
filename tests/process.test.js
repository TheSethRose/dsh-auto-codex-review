import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execute,reviewWithCodex } from '../src/codex.js';
const fixture=fileURLToPath(new URL('./fixtures/cli.mjs',import.meta.url));
const run=(scenario,signal=new AbortController().signal,maxBytes=16384)=>execute(process.execPath,[fixture,scenario],process.cwd(),'synthetic prompt',signal,maxBytes);
test('collects one isolated CLI text turn',async()=>assert.equal(await run('valid'),'{"risk":"low","decision":"allow"}'));
test('kills TERM-resistant child on timeout and awaits close',async()=>{
  const started=Date.now();await assert.rejects(run('hang',AbortSignal.timeout(150)),/cancelled or timed out/);assert(Date.now()-started<3000);
});
test('rejects caller cancellation before dispatch',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(reviewWithCodex({policy:'policy',prompt:'prompt',signal:controller.signal}));
});
test('stops bounded output including multibyte bytes',async()=>await assert.rejects(run('flood',undefined,128),/byte limit/));
test('does not expose CLI stderr',async()=>await assert.rejects(run('stderr'),error=>!error.message.includes('synthetic-private')&&/unsuccessfully/.test(error.message)));
test('rejects malformed JSONL without callback exception or text leak',async()=>await assert.rejects(run('malformed'),error=>!error.message.includes('PRIVATE')&&/malformed CLI/.test(error.message)));
test('rejects unavailable executable without hanging',async()=>await assert.rejects(execute('/nonexistent/dsh-synthetic-codex',[],process.cwd(),'prompt',new AbortController().signal,128),/unavailable/));
