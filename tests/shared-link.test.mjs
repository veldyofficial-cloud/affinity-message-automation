import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-core.js';
import {isSharedLinkMode} from '../src/shared-link.js';

const site='https://infohub-approval-cloudflare.veldy-official.workers.dev';
const key='b'.repeat(64);
const reg={consumeSharedRate:async()=>({allowed:true})};
const env={
  ACCESS_MODE:'shared_link',SHARED_LINK_KEY:key,
  REGISTRY:{idFromName:()=> 'same',get:()=>reg},
  ASSETS:{fetch:async r=>new Response('asset:'+new URL(r.url).pathname)},
};
function req(path,{token,method='GET',origin=site,body}={}){
  const headers={Origin:origin};
  if(token)headers['X-Affinity-Link-Key']=token;
  if(body)headers['Content-Type']='application/json';
  return new Request(site+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
}

test('shared-link is opt-in and serves only the public form',async()=>{
  assert.equal(isSharedLinkMode({}),false);
  assert.equal(isSharedLinkMode(env),true);
  const response=await worker.fetch(req('/'),env,{});
  assert.equal(response.status,200);
  assert.equal(await response.text(),'asset:/');
  for(const path of ['/admin','/admin.html','/onboarding','/api/admin/instructors','/api/auth/status']) {
    assert.equal((await worker.fetch(req(path,{token:key}),env,{})).status,404);
  }
});
test('API is fail-closed and checks shared key',async()=>{
  assert.equal((await worker.fetch(req('/api/health'),env,{})).status,401);
  assert.equal((await worker.fetch(req('/api/health',{token:'a'.repeat(64)}),env,{})).status,401);
  let r=await worker.fetch(req('/api/health',{token:key}),env,{});
  assert.equal(r.status,200);
  assert.equal((await r.json()).mode,'shared_link');
  assert.equal((await worker.fetch(req('/api/health',{token:key}),{...env,SHARED_LINK_KEY:''},{})).status,503);
  assert.equal((await worker.fetch(req('/api/health',{token:key}),{...env,REGISTRY:null},{})).status,503);
});
test('link does not permit cross-origin POST; registry enforces request caps',async()=>{
  const path='/api/lookup';
  let r=await worker.fetch(req(path,{token:key,method:'POST',origin:'https://attacker.invalid',body:{query:'abc'}}),{...env,MONDAY_API_TOKEN:'mock'},{});
  assert.equal(r.status,403);
  r=await worker.fetch(req(path,{token:key,method:'POST',body:{query:'abc'}}),{...env,REGISTRY:{idFromName:()=>1,get:()=>({consumeSharedRate:async()=>({allowed:false})})}},{});
  assert.equal(r.status,429);
  r=await worker.fetch(req('/api/approve',{token:key,method:'POST',body:{}}),{...env,MONDAY_API_TOKEN:'mock'},{});
  assert.equal(r.status,400); // Invalid payload; nothing written to Monday.
});
