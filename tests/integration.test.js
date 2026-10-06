import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime,{createMessage,createUserMessage} from '@deepseek-ai/dsh-llm';
import SessionStore from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime,{defineContentToolFixture,RUN_CODE_NAME} from '@deepseek-ai/dsh-tools';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import PermissionPresets,{AUTO_PRESET} from '@deepseek-ai/dsh-permission-presets';
import * as realCodex from '../src/codex.js';
let reviews=[],answer='{"risk":"low","decision":"allow"}';
mock.module('../src/codex.js',{namedExports:{...realCodex,reviewWithCodex:async options=>{reviews.push(options);return typeof answer==='function'?answer(options):answer;}}});
const plugin=await import('../src/index.js');
const parameters={type:'object',properties:{path:{type:'string'}},required:['path']};
const schema={name:'probe',description:'logged probe description',parameters};
const presets={
  'read-only':{sandbox:'read-only',approval:'ask',name:'Read only'},
  'workspace-write':{sandbox:'workspace-write',approval:'ask',name:'Workspace write'},
  'danger-full-access':{sandbox:'danger-full-access',approval:'never',name:'Full access'},
};
async function harness(t){
  reviews=[];answer='{"risk":"low","decision":"allow"}';
  const ctx=new Context();t.after(()=>ctx.fiber.dispose());
  for(const service of [LlmRuntime,SessionStore,SessionProjectionRegistry,SystemPrompt,ToolRuntime])await ctx.plugin(service,{});
  ctx.provide('shell',{sandboxMode:'workspace-write',resolve(){throw Error('no shell in tests');},run(){throw Error('no shell in tests');},start(){throw Error('no shell in tests');}});
  await ctx.plugin(ApprovalService,{policy:'ask'});await ctx.plugin(PermissionPresets,{presets,defaultPreset:'workspace-write'});
  const auto=await ctx.plugin(plugin);
  let runs=0;ctx.tools.register(defineContentToolFixture({name:'probe',description:'live description must not replace logged description',parameters:{path:{type:'string'}},async execute(){runs++;return[{type:'text',text:'ran'}];}}));
  const session=ctx.sessions.create('synthetic-test',{meta:{cwd:'/synthetic/project'}});ctx.permissionPresets.set(session,AUTO_PRESET);
  const agent={id:session.id,session,options:{provider:'main-agent-unavailable',model:'not-the-reviewer'}};
  session.append('request/header',{header:{config:agent.options,tools:[schema]},reason:'initial'});
  const user=(text,source={kind:'user'})=>session.append('user/message',createUserMessage({content:[{type:'text',text}],source}),{surfaceOp:'append'});
  user('Inspect the project-local text file.');
  user('PROJECT_CONSTRAINT',{kind:'agent-instructions',form:'instructions',changes:[]});
  user('TOOL_OUTPUT_SECRET',{kind:'tool',callId:'old'});
  const start=(name='probe',callId='current',raw='{"path":"target"}')=>{
    session.append('step/start',{turn:1,step:1});
    session.append('assistant/message',{turn:1,step:1,stream:[],message:createMessage({role:'assistant',content:[{type:'text',text:'ASSISTANT_SECRET'},{type:'reasoning',text:'REASONING_SECRET'},{type:'tool-call',id:callId,name,arguments:raw}],source:{kind:'model',provider:'main-agent-unavailable',model:'not-the-reviewer'}})},{surfaceOp:'append'});
    session.append('tool/call',{turn:1,step:1,callId,name,arguments:raw});
  };
  const execute=(options={})=>ctx.tools.execute({signal:new AbortController().signal,callId:'current',name:'probe',arguments:{path:'target'},agent,...options});
  return{ctx,auto,session,agent,start,execute,runs:()=>runs};
}
test('real ToolRuntime allows exactly one reviewed native body without main-agent LLM',async t=>{
  const h=await harness(t);h.start();const result=await h.execute();assert(!result.isError);assert.equal(h.runs(),1);assert.equal(reviews.length,1);
  const request=reviews[0];assert.equal(request.policy,plugin.REVIEW_POLICY);assert(!('provider'in request));assert(!('model'in request));
  assert(request.prompt.includes('PROJECT_CONSTRAINT'));assert(!request.prompt.includes('ASSISTANT_SECRET'));assert(!request.prompt.includes('REASONING_SECRET'));assert(!request.prompt.includes('TOOL_OUTPUT_SECRET'));
  assert(request.prompt.includes('logged probe description'));assert(!request.prompt.includes('live description'));
});
for(const decision of ['{"risk":"medium","decision":"deny"}','{"risk":"high","decision":"deny"}','{"risk":"critical","decision":"deny"}','not JSON']){
  test('real executor never runs denied or malformed decision '+decision,async t=>{
    const h=await harness(t);answer=decision;h.start();const result=await h.execute();assert(result.isError);assert.equal(h.runs(),0);assert.equal(reviews.length,1);
  });
}
test('downstream authorization deny remains final after reviewer allow',async t=>{
  const h=await harness(t);h.ctx.on('tools/pre-execute',async()=>({kind:'deny',reason:'downstream deny'}));
  h.start();assert((await h.execute()).isError);assert.equal(h.runs(),0);
});
test('rejects mismatch with logged action before asking reviewer',async t=>{
  const h=await harness(t);h.start();assert((await h.execute({arguments:{path:'different'}})).isError);assert.equal(h.runs(),0);assert.equal(reviews.length,0);
});
test('reviews PTC inner dispatch using logged schema and parent identity',async t=>{
  const h=await harness(t);answer='{"risk":"high","decision":"deny"}';h.start(RUN_CODE_NAME,'outer','{"code":"probe()"}');
  h.session.append('tool/ptc-dispatch-start',{rootCallId:'outer',parentCallId:'outer',subCallId:'inner',name:'probe',arguments:{path:'inside'}});
  const result=await h.execute({rootCallId:'outer',parent:Symbol('outer execution'),callId:'inner',schema,arguments:{path:'inside'}});
  assert(result.isError);assert.equal(h.runs(),0);assert.equal(reviews.length,1);assert(reviews[0].prompt.includes('ptc-inner'));
});
test('outer run_code wrapper delegates authorization without review',async t=>{
  const h=await harness(t);
  const decision=await h.ctx.waterfall('tools/pre-execute',{signal:new AbortController().signal,callId:'outer',name:RUN_CODE_NAME,arguments:{},agent:h.agent},()=>Promise.resolve({kind:'allow'}));
  assert.equal(decision.kind,'allow');assert.equal(reviews.length,0);
});
test('sessions outside Auto retain their existing authorization chain',async t=>{
  const h=await harness(t);h.ctx.permissionPresets.set(h.session,'workspace-write');assert(!(await h.execute()).isError);assert.equal(h.runs(),1);assert.equal(reviews.length,0);
});
test('disposal cancels active review and replaces Auto with read-only',async t=>{
  const h=await harness(t);const started=Promise.withResolvers();
  answer=options=>new Promise((_,reject)=>{started.resolve();options.signal.addEventListener('abort',()=>reject(Error('codex review: cancelled')),{once:true});});
  h.start();const pending=h.execute();await started.promise;await h.auto.dispose();await pending;
  assert.equal(h.runs(),0);assert.equal(h.ctx.permissionPresets.current(h.session),'read-only');assert(!h.ctx.permissionPresets.catalog().options.some(x=>x.value===AUTO_PRESET));
});
