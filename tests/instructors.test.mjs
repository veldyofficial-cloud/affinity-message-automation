import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-core.js';

const TEAM_DOMAIN='https://stafftest.cloudflareaccess.com';
const AUD='test-instructor-aud';
const origin='https://infohub-approval-cloudflare.veldy-official.workers.dev';
const INVITE='EXAMPLE-INVITE-SECRET-NOT-FOR-PRODUCTION-49nQ0';
const accounts=new Map();
const attempts=new Map();
const teachers={
  async getInstructor(email){const a=accounts.get(email);return a?{exists:true,active:a.active}:{exists:false,active:false};},
  async enrollInstructor(email,valid){
    if(accounts.has(email)) return accounts.get(email).active?{ok:true,alreadyEnrolled:true}:{ok:false,error:'차단'};
    const failed=attempts.get(email)||0;
    if(failed>=5)return{ok:false,locked:true,error:'잠김'};
    if(!valid){attempts.set(email,failed+1);return{ok:false,error:'코드 불일치'};}
    accounts.set(email,{active:true,enrolledAt:new Date().toISOString()});return{ok:true};
  },
  async listInstructors(){return [...accounts].map(([email,state])=>({email,active:state.active,enrolledAt:state.enrolledAt}));},
  async setInstructorStatus(email,active){if(!accounts.has(email))return {ok:false,error:'없음'};accounts.get(email).active=active;return{ok:true};},
};
const env={TEAM_DOMAIN,POLICY_AUD:AUD,ACCESS_ALLOWED_EMAILS:'veldy.official@gmail.com',
 INSTRUCTOR_INVITE_CODE:INVITE,MONDAY_API_TOKEN:'mock',REGISTRY:{idFromName:()=> 'same',get:()=>teachers},
 ASSETS:{fetch:async(request)=>new Response(`asset:${new URL(request.url).pathname}`,{headers:{'content-type':'text/html'}})}};
let key,publicJwk,realFetch=globalThis.fetch;
async function createSignedJwt(email){
 const b64=x=>Buffer.from(x).toString('base64url');
 const head=b64(JSON.stringify({alg:'RS256',typ:'JWT',kid:'instructor-key'}));
 const payload=b64(JSON.stringify({email,aud:[AUD],iss:TEAM_DOMAIN,iat:Math.floor(Date.now()/1000)-10,exp:Math.floor(Date.now()/1000)+3600}));
 const unsigned=`${head}.${payload}`;
 const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(unsigned));
 return `${unsigned}.${b64(new Uint8Array(sig))}`;
}
function req(path,token,method='GET',body){
 return new Request(origin+path, {method,headers:{'Cf-Access-Jwt-Assertion':token,'Origin':origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
}
test('teachers use own verified email plus invite code, with administrator revocation', async()=>{
 const k=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 key=k.privateKey;publicJwk={...(await crypto.subtle.exportKey('jwk',k.publicKey)),kid:'instructor-key'};
 globalThis.fetch=async url=> {
  if(String(url)===TEAM_DOMAIN+'/cdn-cgi/access/certs')return Response.json({keys:[publicJwk]});
  throw new Error(`Mock unexpected: ${url}`);
 };
 try {
  const instructor=await createSignedJwt('normal.tutor@gmail.com');
  const admin=await createSignedJwt('veldy.official@gmail.com');
  let r=await worker.fetch(req('/api/lookup',instructor,'POST',{query:'abc'}),env,{});
  assert.equal(r.status,403,'student data is forbidden before enrollment');
  r=await worker.fetch(req('/',instructor),env,{});
  assert.equal(await r.text(),'asset:/onboarding.html','only onboarding is served before enrollment');
  r=await worker.fetch(req('/admin',instructor),env,{});
  assert.equal(r.status,403,'teachers cannot view admin dashboard');
  r=await worker.fetch(req('/api/auth/enroll',instructor,'POST',{code:'wrong'}),env,{});
  assert.equal(r.status,403,'bad code rejected');
  r=await worker.fetch(req('/api/auth/enroll',instructor,'POST',{code:INVITE}),env,{});
  assert.equal(r.status,200,'valid invite enrolled');
  assert.equal((await r.json()).ok,true);
  r=await worker.fetch(req('/',instructor),env,{});
  assert.equal(await r.text(),'asset:/','instructor now can use normal app');
  r=await worker.fetch(req('/api/auth/status',instructor),env,{});
  assert.equal((await r.json()).role,'instructor');
  r=await worker.fetch(req('/api/admin/instructors',instructor),env,{});
  assert.equal(r.status,403,'teacher cannot list all enrolled emails');
  r=await worker.fetch(req('/api/admin/instructors',admin),env,{});
  assert.equal((await r.json()).users[0].email,'normal.tutor@gmail.com');
  r=await worker.fetch(req('/admin',admin),env,{});
  assert.equal(await r.text(),'asset:/admin.html');
  r=await worker.fetch(req('/api/admin/instructors',admin,'POST',{email:'normal.tutor@gmail.com',active:false}),env,{});
  assert.equal(r.status,200,'admin revocation succeeds');
  r=await worker.fetch(req('/api/approve',instructor,'POST',{}),env,{});
  assert.equal(r.status,403,'revoked tutor cannot approve');
  r=await worker.fetch(req('/api/auth/enroll',instructor,'POST',{code:INVITE}),env,{});
  assert.equal(r.status,403,'revoked tutor cannot re-enroll');
  r=await worker.fetch(req('/api/auth/status',instructor),{...env,INSTRUCTOR_INVITE_CODE:''},{});
  assert.equal((await r.json()).role,'pending','removing invite secret prevents instructor access');
  r=await worker.fetch(req('/',admin),{...env,INSTRUCTOR_INVITE_CODE:''},{});
  assert.equal(r.status,200,'admin still can access after disabling invites');
  r=await worker.fetch(req('/api/auth/enroll',instructor,'POST',{code:INVITE}),{...env,REGISTRY:null},{});
  assert.equal(r.status,503,'missing durable object fails closed');
 } finally { globalThis.fetch=realFetch; }
});
