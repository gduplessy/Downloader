import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { installResolverTrace } from './resolver-trace.mjs';

test('observer preserves one original promise call and redacts authorization', async () => {
  const result = Promise.resolve({ authorization: 'secret-token', click: true });
  let calls = 0;
  const events = [];
  const runtime = { sendMessage() { calls++; return result; } };
  const context = { chrome: { runtime }, __navWaitEmit: value => events.push(JSON.parse(value)) };
  assert.equal(runInNewContext(installResolverTrace, context), true);
  assert.equal(runtime.sendMessage({ type: 'resolver_step', decision: { kind: 'click' } }), result);
  await result;
  assert.equal(calls, 1);
  assert.equal(events.at(-1).response.authorization_present, true);
  assert.equal(JSON.stringify(events).includes('secret-token'), false);
});

test('observer preserves callback this, value and lastError without another original call', () => {
  let calls = 0, received;
  const callbackThis = {};
  const runtime = { lastError: { message: 'refused' }, sendMessage(message, callback) {
    calls++; callback.call(callbackThis, { click: false }); return undefined;
  } };
  const context = { chrome: { runtime }, __navWaitEmit() {} };
  runInNewContext(installResolverTrace, context);
  assert.equal(runtime.sendMessage({type:'resolver_commit'},function(value){ received={value,receiver:this}; }),undefined);
  assert.equal(calls,1);
  assert.equal(received.receiver,callbackThis);
  assert.equal(received.value.click,false);
  assert.equal(context.__navWaitTrace[0].lastError,'refused');
});
