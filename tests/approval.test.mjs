import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-core.js';
import {derivePlan, BOARD_ID, COL} from '../src/monday.js';
import {TEACHERS,isAllowedTeacher} from '../src/teachers.js';

const origin='https://affinity-infohub-approval.account.workers.dev';
const TEAM_DOMAIN='https://testteam.cloudflareaccess.com';
const AUD='demo-app-id';
const realFetch=globalThis.fetch;
let signingKey;
let jwk;
let currentRequests=[];
const saved=new Map();
const registry={
  async reserve(key){if(saved.has(key))return {accepted:false,...saved.get(key)};saved.set(key,{state:'pending'});return{accepted:true};},
  async finish(key,state,data){saved.set(key,{state,...data});},
  async release(key){saved.delete(key);},
};
const env={MONDAY_API_TOKEN:'MOCK_TOKEN',TEAM_DOMAIN,POLICY_AUD:AUD,ACCESS_ALLOWED_EMAILS:'veldy.official@gmail.com',
 REGISTRY:{idFromName:()=> 'stable',get:()=>registry},
 ASSETS:{fetch:async()=>new Response('<!doctype html><html>TEST</html>',{headers:{'Content-Type':'text/html'}})}};

async function jwt({email='veldy.official@gmail.com',aud=[AUD],tamper=false}={}) {
 const base64url = bytes=>Buffer.from(bytes).toString('base64url');
 const head=base64url(JSON.stringify({alg:'RS256',kid:'test-kid',typ:'JWT'}));
 const payload=base64url(JSON.stringify({email,aud,iss:TEAM_DOMAIN,exp:Math.floor(Date.now()/1000)+3600}));
 const input=`${head}.${payload}`;
 const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',signingKey,new TextEncoder().encode(input));
 return `${head}.${payload}.${base64url(tamper?new Uint8Array(255):new Uint8Array(signature))}`;
}

async function mockServices() {
 if (!signingKey){
  const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  signingKey=keys.privateKey;
  jwk={...(await crypto.subtle.exportKey('jwk',keys.publicKey)),kid:'test-kid',use:'sig',alg:'RS256'};
 }
 globalThis.fetch=async(url,options={})=>{
  if(String(url)===TEAM_DOMAIN+'/cdn-cgi/access/certs') return Response.json({keys:[jwk]});
  if(String(url)==='https://api.monday.com/v2'){
    const call=JSON.parse(options.body);currentRequests.push(call);
    const q=call.query;let data;
    if(q.includes('items(ids:')) data={items:(call.variables.ids||[]).map(id=>({id,name:`Demo Student ${id}`,board:{id:'1879266175'}}))};
    else if(q.includes('users(ids:')) data={users:(call.variables.ids||[]).map(id=>{const t=TEACHERS.find(t=>t.id===Number(id));return t?{id,name:t.name}:null;}).filter(Boolean)};
    else if(q.includes('items_page(')) data={boards:[{items_page:{cursor:null,items:[{id:'14500123',name:'Demo Student'}]}}]};
    else if(q.includes('create_item(')){
      assert.equal(call.variables.boardId,String(BOARD_ID));
      const cols=JSON.parse(call.variables.values);
      assert.ok(cols[COL.studentRelation].item_ids.includes(14500123));
      assert.ok(isAllowedTeacher(cols[COL.teacher].personsAndTeams[0].id));
      data={create_item:{id:'999900000',url:'https://veldyofficials-team.monday.com/boards/1888467610/pulses/999900000'}};
    }else if(q.includes('create_subitem(')){
      const cols=JSON.parse(call.variables.values);
      assert.ok(cols[COL.subDate].date);
      assert.ok(Number.isSafeInteger(Number(cols[COL.subAttendance])));
      assert.ok(['40m','60m','휴강'].includes(cols[COL.subMinutes].label));
      data={create_subitem:{id:'999900001'}};
    }else if(q.includes('create_update(')){
      assert.match(call.variables.body,/\[BRANDING\] PERSONAL COURSE/);
      data={create_update:{id:'999900002'}};
    }else throw new Error(`Unexpected monday query: ${q}`);
    return Response.json({data});
  }
  throw new Error(`Unmocked external request: ${url}`);
 };
}
function input(){return {approvalId:'example-approval-12345',studentName:'Demo Student',itemName:'[BRANDING] PERSONAL COURSE',
 studentIds:[14500123],teacherId:62032468,messageType:'CLASS',classType:'ONE_ON_ONE',templateType:'PC',deviceType:'아이패드',studentLocation:'DOMESTIC',weekday:'월',startDay:'2026-11-02',endDay:'2026-11-30',lessonCount:4,explicitLessonCount:4,kstTime24:{hh:19,mm:0},closures:[{date:'2026-11-09',name:'수강생 요청 휴강'}],schedule:[
 {date:'2026-11-02',kind:'LESSON',name:'LESSON 01'},
 {date:'2026-11-09',kind:'CLOSED',name:'수강생 요청 휴강'},
 {date:'2026-11-16',kind:'LESSON',name:'LESSON 02'},
 {date:'2026-11-23',kind:'LESSON',name:'LESSON 03'},
 {date:'2026-11-30',kind:'LESSON',name:'LESSON 04'}],
 message:'Affinity Universe: TEST\n\n[학습 과정]\n[BRANDING] PERSONAL COURSE\n'};}
function request(path,token,body,method='POST'){return new Request(origin+path,{method,headers:{'Origin':origin,'Content-Type':'application/json',...(token?{'Cf-Access-Jwt-Assertion':token}:{})},...(body?{body:JSON.stringify(body)}:{})});}

test('secure Monday approval flow and deduplication',async()=>{
 await mockServices();
 const token=await jwt();
 let resp=await worker.fetch(request('/api/lookup','',{query:'Demo'}),env,{});
 assert.equal(resp.status,403,'Access authentication is mandatory');
 resp=await worker.fetch(request('/api/lookup',await jwt({tamper:true}),{query:'Demo'}),env,{});
 assert.equal(resp.status,403,'Forged JWT not accepted');
 resp=await worker.fetch(request('/api/lookup',await jwt({aud:['wrong-audience']}),{query:'Demo'}),env,{});
 assert.equal(resp.status,403,'Wrong JWT aud rejected');
 resp=await worker.fetch(request('/api/lookup',await jwt({email:'other@example.com'}),{query:'Demo'}),env,{});
 assert.equal(resp.status,403,'Non-whitelisted email rejected');
 resp=await worker.fetch(request('/api/lookup',token,{query:'Demo'}),env,{});
 assert.equal(resp.status,200,await resp.clone().text());
 const students=await resp.json();
 assert.equal(students.students.length,1);
 assert.equal(students.teachers.length,13);
 assert.deepEqual(students.teachers.map(t=>t.name),TEACHERS.map(t=>t.name));
 const inputs=input();
 const plan=derivePlan(inputs);
 assert.equal(plan.lessonCount,4);
 assert.equal(plan.holidayCount,1);
 resp=await worker.fetch(request('/api/approve',token,inputs),env,{});
 assert.equal(resp.status,200,await resp.clone().text());
 const payload=await resp.json();
 assert.equal(payload.ok,true);
 assert.equal(payload.parentId,'999900000');
 assert.equal(currentRequests.filter(x=>x.query.includes('create_item(')).length,1);
 assert.equal(currentRequests.filter(x=>x.query.includes('create_subitem(')).length,5);
 assert.equal(currentRequests.filter(x=>x.query.includes('create_update(')).length,1);
 resp=await worker.fetch(request('/api/approve',token,{...inputs,approvalId:'different-click-id'}),env,{});
 assert.equal(resp.status,409,'Duplicate must be rejected even with fresh client approvalId');
 assert.equal(currentRequests.filter(x=>x.query.includes('create_item(')).length,1,'No second parent created');
 resp=await worker.fetch(request('/api/approve',token,{...inputs,teacherId:14500999}),env,{});
 assert.equal(resp.status,400,'Non-roster instructor cannot write to Infohub');
 resp=await worker.fetch(request('/api/approve',token,{...inputs,weekday:'일'}),env,{});
 assert.equal(resp.status,400,'Sunday group unsupported');
 resp=await worker.fetch(request('/',token,undefined,'GET'),env,{});
 assert.equal(resp.status,200);
 assert.equal(resp.headers.get('X-Frame-Options'),'DENY');
 assert.equal(resp.headers.get('Cache-Control'),'private, no-store, max-age=0');
 resp=await worker.fetch(request('/',token,undefined,'GET'),{...env,POLICY_AUD:''},{});
 assert.equal(resp.status,503,'Missing security config fails closed');
 globalThis.fetch=realFetch;
});

test('GROUP full closure and individual absence write into distinct subitem fields',async()=>{
 await mockServices();
 const token=await jwt();
 currentRequests=[];
 const group={...input(),itemName:'[PICTURE BOOK] DIPLOMA — GROUP TEST',classType:'GROUP',
 studentIds:[14500123,14500124,14500125],teacherId:62107534,
 closures:[{date:'2026-11-09',name:'수강생 요청 휴강'}],
 absences:[{date:'2026-11-16',studentIds:[14500124]}],
 schedule:[
 {date:'2026-11-02',kind:'LESSON',name:'LESSON 01',absentStudentIds:[]},
 {date:'2026-11-09',kind:'CLOSED',name:'수강생 요청 휴강'},
 {date:'2026-11-16',kind:'LESSON',name:'LESSON 02',absentStudentIds:[14500124]},
 {date:'2026-11-23',kind:'LESSON',name:'LESSON 03',absentStudentIds:[]},
 {date:'2026-11-30',kind:'LESSON',name:'LESSON 04',absentStudentIds:[]},
 ]};
 assert.equal(derivePlan(group).lessonCount,4);
 assert.equal(derivePlan(group).absenceLessons,1);
 const resp=await worker.fetch(request('/api/approve',token,group),env,{});
 assert.equal(resp.status,200,await resp.clone().text());
 const result=await resp.json();
 assert.equal(result.absenceLessons,1);
 const subitems=currentRequests.filter(x=>x.query.includes('create_subitem('));
 assert.equal(subitems.length,5);
 const closed=JSON.parse(subitems.find(x=>x.variables.name==='수강생 요청 휴강').variables.values);
 assert.equal(closed[COL.subDate].date,'2026-11-09');
 assert.equal(closed[COL.subMinutes].label,'휴강');
 assert.equal(closed[COL.subAttendance],'0');
 assert.equal(closed[COL.subAbsentees],undefined);
 const lesson=JSON.parse(subitems.find(x=>x.variables.name==='LESSON 02').variables.values);
 assert.equal(lesson[COL.subMinutes].label,'60m');
 assert.equal(lesson[COL.subAttendance],'2');
 assert.deepEqual(lesson[COL.subAbsentees],{item_ids:[14500124]});
 for(const invalid of [
  {...group,absences:[{date:'2026-11-09',studentIds:[14500124]}]},
  {...group,absences:[{date:'2026-11-16',studentIds:[14500123,14500124,14500125]}]},
  {...group,absences:[{date:'2026-11-16',studentIds:[14500129]}]},
  {...group,absences:[{date:'2026-11-17',studentIds:[14500124]}]},
 ]) assert.throws(()=>derivePlan(invalid));
 globalThis.fetch=realFetch;
});
