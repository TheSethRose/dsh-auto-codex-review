import test from 'node:test';
import assert from 'node:assert/strict';
import { startGateway,reviewRequest,validateEvent } from '../src/gateway.js';
const message={id:'message-1',type:'message',role:'assistant',content:[{type:'output_text',text:'{"risk":"low","decision":"allow"}'}]};
const events=[{type:'response.created',response:{id:'synthetic',output:[]}},
  {type:'response.output_item.added',item:message},
  {type:'response.completed',response:{id:'synthetic',status:'completed',output:[message]}}];
const sse=values=>values.map(v=>'data: '+JSON.stringify(v)+'\n\n').join('');
const gateway=(fetchImpl,maxBytes=16384)=>startGateway({policy:'fixed policy',prompt:'frozen snapshot',maxBytes,signal:new AbortController().signal,fetchImpl});
const send=(g,body={model:'wrong',tools:[{type:'function'}],instructions:'untrusted',input:['private CLI context']})=>fetch(g.url+'/responses',{method:'POST',headers:{authorization:'Bearer synthetic-token','content-type':'application/json','chatgpt-account-id':'synthetic-account'},body:JSON.stringify(body)});
test('reconstructs fixed model, policy and snapshot with no tools or continuation',()=>{
  const request=reviewRequest({model:'wrong',tools:[{}],input:['private'],previous_response_id:'private',instructions:'untrusted'},'policy','prompt');
  assert.equal(request.model,'codex-auto-review');assert.equal(request.instructions,'policy');
  assert.deepEqual(request.tools,[]);assert.equal(request.tool_choice,'none');
  assert.deepEqual(request.input,[{role:'user',content:[{type:'input_text',text:'prompt'}]}]);
  assert(!('previous_response_id' in request));assert.equal(request.text.format.strict,true);
});
for(const [i,value] of [
  {type:'response.output_item.added',item:{id:'1',type:'function_call',name:'shell'}},
  {type:'response.output_item.done',item:{id:'1',type:'custom_tool_call'}},
  {type:'response.function_call_arguments.delta',delta:'{}'},
  {type:'response.completed',response:{id:'1',status:'completed',output:[{id:'2',type:'function_call'}]}},
  {type:'response.completed',response:{id:'1',status:'incomplete',output:[]}},
  {type:'response.content_part.added',part:{type:'refusal'}},
  {type:'response.output_item.added'},
  {type:'response.output_text.delta',delta:{type:'function_call'}},
  {type:'response.completed',response:{status:'completed'}},{type:'unknown'}].entries()){
  test('rejects tool or malformed upstream event '+i,()=>assert.throws(()=>validateEvent(value)));
}
test('relays safe response and only transient authentication',async()=>{
  let request;const g=await gateway(async(url,init)=>{request={url,init};return new Response(sse(events));});
  try{
    assert.equal((await fetch(g.url+'/models')).status,403);
    const text=await(await send(g)).text();assert(text.includes('response.completed'));g.assertCompleted();
    assert.equal((await fetch(new URL('/',g.url))).status,403);g.assertCompleted(); // Unauthenticated probe cannot poison completed review.
    assert.equal(request.url,'https://chatgpt.com/backend-api/codex/responses');assert.equal(request.init.redirect,'error');
    assert.equal(request.init.headers.authorization,'Bearer synthetic-token');
    assert.deepEqual(JSON.parse(request.init.body).tools,[]);
    assert(!request.init.body.includes('private CLI context'));assert(!request.init.body.includes('untrusted'));
  }finally{await g.close();}
});
test('blocks tool events before downstream CLI receives them',async()=>{
  const g=await gateway(async()=>new Response(sse([{type:'response.output_item.added',item:{id:'1',type:'function_call',name:'shell'}}])));
  try{await assert.rejects(async()=>{await(await send(g)).text();});assert.throws(()=>g.assertCompleted(),/tool/);}finally{await g.close();}
});
test('withholds terminal response when invalid data follows it',async()=>{
  const g=await gateway(async()=>new Response(sse([...events,{type:'response.output_text.delta',delta:'late'}])));
  try{let received='';try{const res=await send(g);for await(const chunk of res.body)received+=new TextDecoder().decode(chunk);}catch{}
    assert(!received.includes('response.completed'));assert.throws(()=>g.assertCompleted(),/after terminal/);
  }finally{await g.close();}
});
test('permits exactly one upstream inference',async()=>{
  let calls=0;const g=await gateway(async()=>{calls++;return new Response(sse(events));});
  try{await(await send(g)).text();assert.equal((await send(g)).status,403);assert.equal(calls,1);assert.throws(()=>g.assertCompleted(),/repeated/);}finally{await g.close();}
});
test('rejects oversized upstream bytes',async()=>{
  const g=await gateway(async()=>new Response('data: '+'é'.repeat(200)+'\n\n'),256);
  try{await assert.rejects(async()=>{await(await send(g,{})).text();});assert.throws(()=>g.assertCompleted(),/byte limit/);}finally{await g.close();}
});
test('rejects upstream HTTP failures without exposing private response body',async()=>{
  const g=await gateway(async()=>new Response('synthetic private backend body',{status:401}));
  try{await assert.rejects(async()=>{await(await send(g)).text();});assert.throws(()=>g.assertCompleted(),e=>/HTTP 401/.test(e.message)&&!e.message.includes('private'));}finally{await g.close();}
});
test('requires completed response, not EOF alone',async()=>{
  const g=await gateway(async()=>new Response(sse(events.slice(0,2))));
  try{await assert.rejects(async()=>{await(await send(g)).text();});assert.throws(()=>g.assertCompleted(),/terminal/);}finally{await g.close();}
});
test('handles CRLF and UTF-8 split across arbitrary byte chunks',async()=>{
  const bytes=new TextEncoder().encode(sse(events).replace(/\n/g,'\r\n'));
  const g=await gateway(async()=>new Response(new ReadableStream({start(controller){for(const b of bytes)controller.enqueue(Uint8Array.of(b));controller.close();}})));
  try{assert((await(await send(g)).text()).includes('response.completed'));g.assertCompleted();}finally{await g.close();}
});
test('downstream disconnect aborts in-flight upstream request', {timeout:3000},async()=>{
  const started=Promise.withResolvers();const cancelled=Promise.withResolvers();
  const g=await gateway(async(_,init)=>{started.resolve();return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>{cancelled.resolve();reject(new Error('cancelled'));},{once:true}));});
  try{const controller=new AbortController();const request=fetch(g.url+'/responses',{method:'POST',headers:{authorization:'Bearer synthetic'},body:'{}',signal:controller.signal});
    await started.promise;controller.abort();await assert.rejects(request);await cancelled.promise;
  }finally{await g.close();}
});
