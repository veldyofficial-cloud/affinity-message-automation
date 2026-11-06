import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-core.js';
import {derivePlan, infohubDstLabel, infohubItemName, BOARD_ID, COL} from '../src/monday.js';
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
const env={MONDAY_API_TOKEN:'MOCK_TOKEN',DEVICE_CLEAR_GRACE_MS:0,TEAM_DOMAIN,POLICY_AUD:AUD,ACCESS_ALLOWED_EMAILS:'veldy.official@gmail.com',
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
    const call=JSON.parse(options.body);currentRequests.push({...call,authToken:options.headers.Authorization});
    const q=call.query;let data;
    if(q.includes('me {id name email}')){
      const flow=options.headers.Authorization==='MOCK_FLOW_TOKEN';
      data={me:{id:flow?'777':'62032468',name:flow?'AFFINITY FLOW':'OLIVIA',email:flow?'affinityuniverse.flow@gmail.com':'veldy.official@gmail.com'},boards:[{id:String(BOARD_ID)}]};
    }
    else if(q.includes('change_multiple_column_values(')) {
      data={change_multiple_column_values:{id:call.variables.itemId}};
    }
    else if(q.includes('column_values(ids:["color_mm2zrwb9"]')) {
      data={items:[{id:'999900000',column_values:[{id:COL.device,text:'PC'}]}]};
      const lastDevice=[...currentRequests].reverse().find(x=>x.query.includes('change_multiple_column_values('));
      if(lastDevice) data.items[0].column_values[0].text=JSON.parse(lastDevice.variables.values)[COL.device].label;
    }
    else if(q.includes('items(ids:')) data={items:(call.variables.ids||[]).map(id=>({id,name:`Demo Student ${id}`,board:{id:'1879266175'},column_values:[{id:'text_mksvtgc8',text:`student${id}@example.com`}] }))};
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
      data={create_update:{id:'999900002',creator:{id:'777',name:options.headers.Authorization==='MOCK_FLOW_TOKEN'?'AFFINITY FLOW':'OLIVIA'}}};
    }else throw new Error(`Unexpected monday query: ${q}`);
    return Response.json({data});
  }
  throw new Error(`Unmocked external request: ${url}`);
 };
}
function input(){return {approvalId:'example-approval-12345',studentName:'Demo Student',itemName:'[BRANDING] PERSONAL COURSE',
 studentIds:[14500123],teacherId:62032468,messageType:'CLASS',classType:'ONE_ON_ONE',templateType:'PC',studentLocation:'DOMESTIC',weekday:'월',startDay:'2026-11-02',endDay:'2026-11-30',lessonCount:4,explicitLessonCount:4,kstTime24:{hh:19,mm:0},closures:[{date:'2026-11-09',name:'수강생 요청 휴강'}],schedule:[
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
 resp=await worker.fetch(request('/api/approve',token,{...inputs,
   approvalId:'new-message-version',message:inputs.message+'edited message',
   subMemo:'edited memo'}),env,{});
 assert.equal(resp.status,409,'Edited notes cannot create a duplicate cohort');
 assert.equal(currentRequests.filter(x=>x.query.includes('create_item(')).length,1);
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
 studentNotices:[14500123,14500124,14500125].map(id=>({
   studentId:id,name:`Demo Student ${id}`,message:'Affinity Universe: TEST '+id+'\n[학습 과정]\n[BRANDING] PERSONAL COURSE'
 })),
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

test('records the actual iPad, Galaxy and PC status labels on Infohub parent items',async()=>{
 await mockServices();
 currentRequests=[];
 const token=await jwt();
 for(const selected of ['PC','IPAD','GALAXY']){
   // Even stale deviceType values must not change the upper selection.
   const p={...input(),itemName:'[DRAWING] BASIC '+selected+' mock device test',
      templateType:selected,deviceType:selected==='GALAXY'?'아이패드':'갤탭'};
   const resp=await worker.fetch(request('/api/approve',token,p),env,{});
   assert.equal(resp.status,200,await resp.clone().text());
   const writes=currentRequests.filter(x=>x.query.includes('create_item('));
   assert.deepEqual(JSON.parse(writes.at(-1).variables.values)[COL.device],{label:selected});
 }
 const beforeWrites=currentRequests.filter(x=>x.query.includes('create_item(')).length;
 for(const bad of ['','DIGITAL_DRAWING','GALAXY_IPAD','ipad']){
   const rejected=await worker.fetch(request('/api/approve',token,
     {...input(),itemName:'[DRAWING] INVALID '+bad,templateType:bad}),env,{});
   assert.equal(rejected.status,400);
 }
 assert.equal(currentRequests.filter(x=>x.query.includes('create_item(')).length,beforeWrites);
 globalThis.fetch=realFetch;
});


test('Makeup/supplement are single subitems; trial has exactly four lessons',async()=>{
  const original=input();
  for(const [type,suffix] of [['MAKEUP_40','보강'],['MAKEUP_30','보충']]){
    const p={...original,messageType:type,startDay:'2026-11-02',endDay:'2026-11-02',
      makeupLessonNumber:7,lessonCount:1,explicitLessonCount:null,closures:[],absences:[],
      schedule:[{date:'2026-11-02',kind:'LESSON',name:'LESSON 07 '+suffix,absentStudentIds:[]}]};
    const plan=derivePlan(p);
    assert.equal(plan.lessonCount,1);
    assert.equal(plan.schedule[0].name,'LESSON 07 '+suffix);
    assert.equal(plan.schedule.length,1);
    assert.throws(()=>derivePlan({...p,endDay:'2026-11-09'}));
    assert.throws(()=>derivePlan({...p,makeupLessonNumber:25}));
  }
  const trial={...original,messageType:'TRIAL',lessonCount:4,explicitLessonCount:4};
  const plan=derivePlan(trial);
  assert.equal(plan.lessonCount,4);
  assert.equal(plan.schedule.filter(x=>x.kind==='LESSON').length,4);
  assert.throws(()=>derivePlan({...trial,lessonCount:3}));
});

test('PC emails and subitem notes appear in mocked Monday create_item/create_subitem',async()=>{
 await mockServices();
 currentRequests=[];
 const token=await jwt();
 const p={...input(),itemName:'[PICTURE BOOK] DIPLOMA 보강 | LESSON 07',
   messageType:'MAKEUP_40',closures:[],absences:[],
   lessonCount:1,explicitLessonCount:null,makeupLessonNumber:7,endDay:'2026-11-02',
   language:'ENG',subMemo:'공통 메모',subMemos:[{date:'2026-11-02',memo:'보강 요청 사유'}],
   schedule:[{date:'2026-11-02',kind:'LESSON',name:'LESSON 07 보강',absentStudentIds:[]}]};
 const response=await worker.fetch(request('/api/approve',token,p),env,{});
 assert.equal(response.status,200,await response.clone().text());
 const parent=JSON.parse(currentRequests.filter(x=>x.query.includes('create_item(')).at(-1).variables.values);
 assert.deepEqual(parent[COL.state],{label:'보강'});
 assert.deepEqual(parent[COL.language],{label:'ENG'});
 assert.equal(parent[COL.email],'student14500123@example.com');
 const lesson=JSON.parse(currentRequests.filter(x=>x.query.includes('create_subitem(')).at(-1).variables.values);
 assert.equal(lesson[COL.subMemo],'보강 요청 사유');
 assert.equal(lesson[COL.subAttendance],'1');
 globalThis.fetch=realFetch;
});


test('DST reflects KST-fixed choice and not student geographic location',async()=>{
 assert.equal(infohubDstLabel({studentLocation:'DOMESTIC',dstMode:'AUTO'}),'🇰🇷');
 assert.equal(infohubDstLabel({studentLocation:'OVERSEAS',dstMode:'STUDENT_CHANGE'}),'🇰🇷');
 assert.equal(infohubDstLabel({studentLocation:'OVERSEAS',dstMode:'AUTO'}),'🌐');
 assert.equal(infohubDstLabel({studentLocation:'OVERSEAS',dstMode:'TEACHER_CHANGE'}),'🌐');
 assert.throws(()=>infohubDstLabel({studentLocation:'OVERSEAS',dstMode:'unsupported'}));
 await mockServices();
 currentRequests=[];
 const token=await jwt();
 for(const [mode,label] of [['STUDENT_CHANGE','🇰🇷'],['AUTO','🌐']]){
  const resp=await worker.fetch(request('/api/approve',token,{...input(),itemName:'DST TEST '+mode,
     studentLocation:'OVERSEAS',dstMode:mode,templateType:'IPAD'}),env,{});
  assert.equal(resp.status,200,await resp.clone().text());
  const cols=JSON.parse(currentRequests.filter(x=>x.query.includes('create_item(')).at(-1).variables.values);
  assert.deepEqual(cols[COL.domesticOrOverseas],{label});
 }
 globalThis.fetch=realFetch;
});

test('Flow token only posts the update and wrong account blocks before DB writes',async()=>{
 await mockServices();
 currentRequests=[];
 const token=await jwt();
 const flowEnv={...env,MONDAY_UPDATE_API_TOKEN:'MOCK_FLOW_TOKEN'};
 const msg={...input(),itemName:'FLOW COMMENT TEST'};
 const resp=await worker.fetch(request('/api/approve',token,msg),flowEnv,{});
 assert.equal(resp.status,200,await resp.clone().text());
 const rows=currentRequests;
 assert.equal(rows.find(x=>x.query.includes('me {id name email}')).authToken,'MOCK_FLOW_TOKEN');
 assert.equal(rows.find(x=>x.query.includes('create_update(')).authToken,'MOCK_FLOW_TOKEN');
 assert.equal(rows.find(x=>x.query.includes('create_item(')).authToken,'MOCK_TOKEN');
 assert.equal((await resp.json()).updateAuthor,'AFFINITY FLOW');
 currentRequests=[];
 const bad=await worker.fetch(request('/api/approve',token,{...msg,itemName:'FLOW BAD TOKEN TEST'}),
 {...env,MONDAY_UPDATE_API_TOKEN:'MOCK_TOKEN'},{});
 assert.equal(bad.status,400);
 assert.equal(currentRequests.filter(x=>x.query.includes('create_item(')).length,0);
 globalThis.fetch=realFetch;
});


test('Canonical KST start-date prefix on every Infohub title without duplication',async()=>{
 assert.equal(infohubItemName('[PICTURE BOOK] EDITOR','2026-11-23'),
  '(⌛️11/23) [PICTURE BOOK] EDITOR');
 assert.equal(infohubItemName('(⌛️11/16) [PICTURE BOOK] EDITOR','2026-11-23'),
  '(⌛️11/23) [PICTURE BOOK] EDITOR');
 assert.equal(infohubItemName('[ART BOOK DESIGN] TRIAL 🚀','2026-11-02'),
  '(⌛️11/2) [ART BOOK DESIGN] TRIAL 🚀');
 assert.equal(infohubItemName('[PICTURE BOOK] DIPLOMA | LESSON 07 보강','2026-11-23'),
  '(⌛️11/23) [PICTURE BOOK] DIPLOMA | LESSON 07 보강');
 assert.throws(()=>infohubItemName('[VIDEO] BASIC','2026-11-31'));
 await mockServices();
 currentRequests=[];
 const token=await jwt();
 const p={...input(),itemName:'[PICTURE BOOK] EDITOR',dstMode:'STUDENT_CHANGE',
   studentLocation:'OVERSEAS'};
 const resp=await worker.fetch(request('/api/approve',token,p),env,{});
 assert.equal(resp.status,200,await resp.clone().text());
 const stored=currentRequests.filter(x=>x.query.includes('create_item(')).at(-1);
 assert.equal(stored.variables.name,'(⌛️11/2) [PICTURE BOOK] EDITOR');
 assert.deepEqual(JSON.parse(stored.variables.values)[COL.domesticOrOverseas],{label:'🇰🇷'});
 const payload=await resp.json();
 assert.equal(payload.parentName,stored.variables.name);
 assert.equal(payload.dstLabel,'🇰🇷');
 globalThis.fetch=realFetch;
});

test('Overseas DST selection must reach server; missing value fails before any board write',async()=>{
 await mockServices();
 currentRequests=[];
 const token=await jwt();
 const inputMissing={...input(),studentLocation:'OVERSEAS'};
 delete inputMissing.dstMode;
 const r=await worker.fetch(request('/api/approve',token,inputMissing),env,{});
 assert.equal(r.status,400,await r.clone().text());
 assert.equal(currentRequests.filter(x=>x.query.includes('create_item(')).length,0);
 assert.match((await r.json()).error,/썸머타임/);
 globalThis.fetch=realFetch;
});

test('One attending GROUP student automatically converts to 40m, except explicitly keeping 60m',async()=>{
  const base={
    ...input(),itemName:'GROUP SINGLE ATTENDEE TEST',
    messageType:'CLASS',classType:'GROUP',studentIds:[14500123,14500124],
    closures:[],startDay:'2026-11-02',endDay:'2026-11-23',
    absences:[{date:'2026-11-09',studentIds:[14500124]}],
    schedule:[
      {date:'2026-11-02',kind:'LESSON',name:'LESSON 01'},
      {date:'2026-11-09',kind:'LESSON',name:'LESSON 02',absentStudentIds:[14500124]},
      {date:'2026-11-16',kind:'LESSON',name:'LESSON 03'},
      {date:'2026-11-23',kind:'LESSON',name:'LESSON 04'}
    ],studentNotices:[14500123,14500124].map(id=>({
      studentId:id,name:'Demo Student '+id,
      message:'Affinity Universe: TEST '+id+'\n[학습 과정]\n[BRANDING] PERSONAL COURSE'
    }))
  };
  const a=derivePlan(base);
  assert.equal(a.schedule[1].durationMinutes,40);
  assert.equal(a.schedule[0].durationMinutes,60);
  const b=derivePlan({...base,absences:[{date:'2026-11-09',studentIds:[14500124],keepGroupDuration:true}]});
  assert.equal(b.schedule[1].durationMinutes,60);
  assert.equal(b.schedule[1].keepGroupDuration,true);
  const three=derivePlan({...base,studentIds:[14500123,14500124,14500125],
    absences:[{date:'2026-11-09',studentIds:[14500124,14500125]}],
    schedule:base.schedule.map(row=>row.date==='2026-11-09'?{...row,absentStudentIds:[14500124,14500125]}:row)});
  assert.equal(three.schedule[1].durationMinutes,40);
  const twoOfThree=derivePlan({...base,studentIds:[14500123,14500124,14500125]});
  assert.equal(twoOfThree.schedule[1].durationMinutes,60);
  assert.throws(()=>derivePlan({...base,absences:[{date:'2026-11-09',studentIds:[14500124],keepGroupDuration:'yes'}]}),/옵션/);

  await mockServices();
  const token=await jwt();
  currentRequests=[];
  const response=await worker.fetch(request('/api/approve',token,base),env,{});
  assert.equal(response.status,200,await response.clone().text());
  const sub=currentRequests.filter(x=>x.query.includes('create_subitem('));
  const second=JSON.parse(sub.find(x=>x.variables.name==='LESSON 02').variables.values);
  assert.equal(second[COL.subMinutes].label,'40m');
  assert.equal(second[COL.subAttendance],'1');
  assert.match(second[COL.subMemo],/1:1 40분 자동 전환/);
  const updates=currentRequests.filter(x=>x.query.includes('create_update('));
  assert.equal(updates.length,1,'exactly one combined Monday bubble');
  assert.match(updates[0].variables.body,/학생별 안내 1/);
  assert.match(updates[0].variables.body,/학생별 안내 2/);
  assert.match(updates[0].variables.body,/Demo Student 14500123/);
  assert.match(updates[0].variables.body,/Demo Student 14500124/);

  currentRequests=[];
  const incomplete={...base,itemName:'GROUP INCOMPLETE NOTICES TEST',
    studentNotices:[base.studentNotices[0]]};
  const failed=await worker.fetch(request('/api/approve',token,incomplete),env,{});
  assert.equal(failed.status,400);
  assert.equal(currentRequests.some(x=>x.query.includes('create_item(')),false,
    'incomplete group notices must fail before any Monday item is created');
});

test('Public-holiday CLOSED subitem uses canonical name and keeps original reason in memo',async()=>{
 await mockServices();
 currentRequests=[];
 const token=await jwt();
 const original=input();
 const payload={...original,itemName:'[BRANDING] PERSONAL COURSE HOLIDAY LABEL TEST',
   closures:[{date:'2026-11-09',name:'설날'}],
   schedule:original.schedule.map(item=>item.kind==='CLOSED'
     ? {...item,name:'공휴일 휴강'} : item)};
 const response=await worker.fetch(request('/api/approve',token,payload),env,{});
 assert.equal(response.status,200,await response.clone().text());
 const subitems=currentRequests.filter(req=>req.query.includes('create_subitem('));
 assert.equal(subitems.filter(req=>req.variables.name==='공휴일 휴강').length,1);
 const publicHoliday=subitems.find(req=>req.variables.name==='공휴일 휴강');
 const columns=JSON.parse(publicHoliday.variables.values);
 assert.equal(columns[COL.subMinutes].label,'휴강');
 assert.match(columns[COL.subMemo],/공휴일 사유: 설날/);
 const oneRequest=derivePlan({...payload,closures:[{date:'2026-11-09',name:'수강생 요청 휴강'}],
   schedule:original.schedule});
 assert.equal(oneRequest.schedule.find(x=>x.kind==='CLOSED').name,'수강생 요청 휴강');
 globalThis.fetch=realFetch;
});

test('Overseas fixed-local DST is accepted and writes varying Korean clock times per lesson',async()=>{
 await mockServices();
 currentRequests=[];
 const token=await jwt();
 const dates=['2026-10-19','2026-10-26','2026-11-02','2026-11-09'];
 const payload={
  ...input(),itemName:'DST LOCAL TIME FIXED LESSON TEST',
  studentLocation:'OVERSEAS',dstMode:'TEACHER_CHANGE',
  timeZone:'America/Los_Angeles',templateType:'IPAD',
  startDay:dates[0],endDay:dates.at(-1),closures:[],
  lessonCount:4,explicitLessonCount:4,kstTime24:{hh:10,mm:0},
  schedule:dates.map((date,i)=>({date,kind:'LESSON',name:'LESSON '+String(i+1).padStart(2,'0')}))
 };
 const server=derivePlan(payload);
 assert.deepEqual(server.schedule.map(x=>x.kstTime24.hh),[10,10,11,11]);
 const res=await worker.fetch(request('/api/approve',token,payload),env,{});
 assert.equal(res.status,200,await res.clone().text());
 const parent=JSON.parse(currentRequests.find(x=>x.query.includes('create_item(')).variables.values);
 assert.deepEqual(parent[COL.domesticOrOverseas],{label:'🌐'});
 assert.deepEqual(parent[COL.time],{hour:10,minute:0});
 const children=currentRequests.filter(x=>x.query.includes('create_subitem('));
 assert.equal(children.length,4);
 assert.equal(JSON.parse(children[0].variables.values)[COL.subMemo],undefined,'No repeated note before DST switch');
 assert.equal(JSON.parse(children[1].variables.values)[COL.subMemo],undefined,'Unchanged KST should leave MEMO empty');
 assert.match(JSON.parse(children[2].variables.values)[COL.subMemo],/11:00 \(한국시간\)/);
 assert.match(JSON.parse(children[3].variables.values)[COL.subMemo],/11:00 \(한국시간\)/);
 assert.doesNotMatch(JSON.parse(children[2].variables.values)[COL.subMemo],/학생 현지시간 고정/);
 globalThis.fetch=realFetch;
});
test('Overseas fixed-local DST rejects invalid timezone before creating an item',async()=>{
 await mockServices();
 currentRequests=[];
 const token=await jwt();
 const inputBad={...input(),itemName:'DST BAD TIMEZONE TEST',
  dstMode:'TEACHER_CHANGE',studentLocation:'OVERSEAS',timeZone:'America/Invalid'};
 const resp=await worker.fetch(request('/api/approve',token,inputBad),env,{});
 assert.equal(resp.status,400);
 assert.equal(currentRequests.filter(x=>x.query.includes('create_item(')).length,0);
 globalThis.fetch=realFetch;
});

test('One-day weekly DST mode with identical 01:00 KST creates blank MEMO for all 12 lessons',async()=>{
 await mockServices();
 currentRequests=[];
 const token=await jwt();
 const dates=Array.from({length:12},(_,i)=>new Date(Date.UTC(2026,10,2+i*7)).toISOString().slice(0,10));
 const payload={
  ...input(),itemName:'DST UNCHANGED SAME KST EMPTY MEMO TEST',
  startDay:dates[0],endDay:dates.at(-1),closures:[],
  studentLocation:'OVERSEAS',dstMode:'STUDENT_CHANGE',
  timeZone:'Asia/Manila',kstTime24:{hh:1,mm:0},
  lessonCount:12,explicitLessonCount:12,
  subMemo:'',subMemos:'',
  schedule:dates.map((date,i)=>({date,kind:'LESSON',name:'LESSON '+String(i+1).padStart(2,'0')}))
 };
 const response=await worker.fetch(request('/api/approve',token,payload),env,{});
 assert.equal(response.status,200,await response.clone().text());
 const children=currentRequests.filter(x=>x.query.includes('create_subitem('));
 assert.equal(children.length,12);
 for(const child of children){
  const columns=JSON.parse(child.variables.values);
  assert.equal(columns[COL.subMemo],undefined,child.variables.name+' should have no generated MEMO');
 }
 globalThis.fetch=realFetch;
});

test('Different second weekly time stores only the genuinely different time in memo',async()=>{
 await mockServices();
 currentRequests=[];
 const token=await jwt();
 const dates=['2026-11-02','2026-11-05','2026-11-09','2026-11-12'];
 const payload={
  ...input(),itemName:'MULTI WEEKLY TIME DIFFERENCE MEMO TEST',
  studentLocation:'DOMESTIC',dstMode:'AUTO',
  closures:[],weeklyFrequency:2,weekday:'월',weekday2:'목',
  kstTime24:{hh:13,mm:0},kstTime24Second:{hh:14,mm:30},
  startDay:dates[0],endDay:dates.at(-1),
  lessonCount:4,explicitLessonCount:4,
  schedule:dates.map((date,i)=>({date,kind:'LESSON',name:'LESSON '+String(i+1).padStart(2,'0')}))
 };
 const response=await worker.fetch(request('/api/approve',token,payload),env,{});
 assert.equal(response.status,200,await response.clone().text());
 const children=currentRequests.filter(x=>x.query.includes('create_subitem('));
 assert.equal(children.length,4);
 for(let i=0;i<4;i++){
  const memo=JSON.parse(children[i].variables.values)[COL.subMemo];
  if(i%2===0)assert.equal(memo,undefined);
  else assert.equal(memo,'수업 시간: 14:30 (한국시간)');
 }
 globalThis.fetch=realFetch;
});

test('GROUP joining student: one linked Student DB record writes a GROUP 60m course and one notice',async()=>{
 await mockServices();
 currentRequests=[];
 const token=await jwt();
 const initial=input();
 const payload={...initial,itemName:'[PICTURE BOOK] FOUNDATION SINGLE JOINING GROUP TEST',
   studentName:'Demo Student 14500123',classType:'GROUP',studentIds:[14500123],
   closures:[],startDay:'2026-11-02',endDay:'2026-11-23',
   lessonCount:4,explicitLessonCount:4,
   studentNotices:[{studentId:14500123,name:'Demo Student 14500123',
     message:'Affinity Universe: Group joining course notice\n[학습 과정]\n[BRANDING] PERSONAL COURSE'}],
   schedule:['2026-11-02','2026-11-09','2026-11-16','2026-11-23']
    .map((date,index)=>({date,kind:'LESSON',name:'LESSON '+String(index+1).padStart(2,'0')}))
 };
 const derived=derivePlan(payload);
 assert.equal(derived.lessonCount,4);
 assert.deepEqual(derived.schedule.map(x=>x.durationMinutes),[60,60,60,60]);
 const response=await worker.fetch(request('/api/approve',token,payload),env,{});
 assert.equal(response.status,200,await response.clone().text());
 const parent=JSON.parse(currentRequests.find(x=>x.query.includes('create_item(')).variables.values);
 assert.equal(parent[COL.type].label,'G');
 assert.equal(parent[COL.duration].label,'60m');
 assert.deepEqual(parent[COL.studentRelation],{item_ids:[14500123]});
 const children=currentRequests.filter(x=>x.query.includes('create_subitem('));
 assert.equal(children.length,4);
 for(const child of children){
   const cols=JSON.parse(child.variables.values);
   assert.equal(cols[COL.subMinutes].label,'60m');
   assert.equal(cols[COL.subAttendance],'1');
   assert.equal(cols[COL.subMemo],undefined);
 }
 const bubble=currentRequests.filter(x=>x.query.includes('create_update('));
 assert.equal(bubble.length,1);
 assert.match(bubble[0].variables.body,/Group joining course notice/);
 globalThis.fetch=realFetch;
});
test('Single linked GROUP with recorded individual absence is invalid',()=>{
 const base=input();
 const payload={...base,classType:'GROUP',studentIds:[14500123],closures:[],
  absences:[{date:'2026-11-16',studentIds:[14500123]}]};
 assert.throws(()=>derivePlan(payload),/그룹 인원/);
});
test('MAKEUP and supplement titles require course + type + separator + lesson order',async()=>{
 await mockServices();
 currentRequests=[];
 const token=await jwt();
 for(const [type,suffix] of [['MAKEUP_40','보강'],['MAKEUP_30','보충']]){
   const base=input();
   const payload={...base,messageType:type,itemName:'[DRAWING] BOOK 02 '+suffix+' | LESSON 12',
     lessonCount:1,explicitLessonCount:null,makeupLessonNumber:12,
     startDay:'2026-11-02',endDay:'2026-11-02',closures:[],absences:[],
     schedule:[{date:'2026-11-02',kind:'LESSON',name:'LESSON 12 '+suffix,absentStudentIds:[]}]};
   const response=await worker.fetch(request('/api/approve',token,payload),env,{});
   assert.equal(response.status,200,await response.clone().text());
   const latest=currentRequests.filter(x=>x.query.includes('create_item(')).at(-1);
   assert.match(latest.variables.name,new RegExp('\\[DRAWING\\] BOOK 02 '+suffix+' \\| LESSON 12$'));
   const rejected=await worker.fetch(request('/api/approve',token,{
     ...payload,itemName:'[DRAWING] BOOK 02 | LESSON 12 '+suffix
   }),env,{});
   assert.equal(rejected.status,400,'old format must be rejected before creating duplicate');
 }
 globalThis.fetch=realFetch;
});
