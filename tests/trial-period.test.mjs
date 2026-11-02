import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const inline=html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(inline,'Program inline script must exist');
// Run the real browser code and expose its functions, without initializing the DOM.
const lastInit=/^\s*init\(\);\s*$/m;
assert.match(inline[1],lastInit);
const code=inline[1].replace(lastInit,
  '\n  globalThis.__trialTest={buildMessage,updateLocalPreview,updateExpectedEndPreview,setClosures(items){closedList=items;},ko:CURRICULUM_KO_LABELS,english:CURRICULUM_MAP};\n');

function harness({type='TRIAL',endDay='',timeZone='America/Vancouver',closures=[]}={}){
 const fields={
   messageType:type, templateType:'PC',studentName:'테스트 수강생',
   classType:'GROUP',siblingType:'BROTHER',discord:'해당없음',
   startDay:'2026-11-02',endDay,weekday:'월',lessonCount:'4',
   amPm:'오전',korTime:'9',curriculumSelect:'[ART BOOK DESIGN] LV.4',
   curriculumUrl:'Upper-intermediate',
   studentLocation:timeZone==='Asia/Seoul'?'DOMESTIC':'OVERSEAS',
   dstMode:'AUTO',tzSelect:timeZone,
   countryInput:timeZone==='Asia/Seoul'?'한국':'캐나다',
   customFlag:'',customCourseName:'',
 };
 const elements=new Map();
 const document={
   getElementById(id){
     if(!elements.has(id))elements.set(id,{
       value:fields[id]??'',textContent:'',querySelectorAll:()=>[],
     });
     return elements.get(id);
   },
 };
 const ctx={document,Intl,Date,console,URLSearchParams};
 vm.runInNewContext(code,ctx,{timeout:3000,filename:'public/index.html'});
 ctx.__trialTest.setClosures(closures);
 return {...ctx.__trialTest,get(id){return document.getElementById(id);}};
}

test('Trial fourth class, closure and overseas time shift appear in final notice',()=>{
 const app=harness({closures:[{date:'2026-11-09',name:'수강생 요청 휴강'}]});
 app.updateExpectedEndPreview();
 assert.equal(app.get('expectedEndPreview').value,'2026-11-30 (월)');
 assert.doesNotThrow(()=>app.updateLocalPreview());
 assert.match(app.get('localPreviewPill').textContent,/\(일\).*5 PM/);
 const result=app.buildMessage();
 assert.equal(result.ok,true,result.error);
 assert.match(result.text,/수업 기간 : 2026\. 11\. 01 - 11\. 29/);
 assert.match(result.text,/11\. 08 \(일, 수강생 요청 휴강\)/);
 assert.match(result.text,/🇨🇦 \(일\) 5 PM/);
 assert.match(result.text,/🇰🇷 \(월\) 9 AM/);
 assert.doesNotMatch(result.text,/수업 기간 : 2026\. 11\. 01 - 11\. 01/);
});

test('Entered trial end date is reflected in message',()=>{
 const app=harness({endDay:'2026-11-30',closures:[{date:'2026-11-09',name:'수강생 요청 휴강'}]});
 const result=app.buildMessage();
 assert.equal(result.ok,true,result.error);
 assert.match(result.text,/수업 기간 : 2026\. 11\. 01 - 11\. 29/);
});

test('Trial without closure is 4 weeks and regular class stays unchanged',()=>{
 const trial=harness();
 trial.updateExpectedEndPreview();
 assert.equal(trial.get('expectedEndPreview').value,'2026-11-23 (월)');
 assert.match(trial.buildMessage().text,/수업 기간 : 2026\. 11\. 01 - 11\. 22/);
 const standard=harness({type:'CLASS',closures:[{date:'2026-11-09',name:'수강생 요청 휴강'}]});
 assert.equal(standard.buildMessage().ok,true);
 assert.match(standard.buildMessage().text,/수업 기간 : 2026\. 11\. 01 - 11\. 29/);
});

test('Domestic trial has Korean dates while makeup remains a single session',()=>{
 const trial=harness({timeZone:'Asia/Seoul',closures:[{date:'2026-11-09',name:'수강생 요청 휴강'}]});
 const result=trial.buildMessage();
 assert.equal(result.ok,true,result.error);
 assert.match(result.text,/수업 기간 : 2026\. 11\. 02 - 11\. 30/);
 const makeup=harness({type:'MAKEUP_40'});
 const single=makeup.buildMessage();
 assert.equal(single.ok,true,single.error);
 assert.match(single.text,/2026\. 11\. 01 \(일\) 5 PM/);
 assert.doesNotMatch(single.text,/수업 기간 :/);
});


test('Regular and trial bubbles show Korean learning-course name without changing URL',()=>{
 for(const type of ['CLASS','TRIAL']){
  const app=harness({type});
  const m=app.buildMessage();
  assert.equal(m.ok,true,m.error);
  assert.match(m.text,/\[학습 과정\]\n아트북 디자인 LV\.4\nhttps:\/\/affinityuniverse\.com\/Upper-intermediate/);
  assert.doesNotMatch(m.text,/\[학습 과정\]\n\[ART BOOK DESIGN\] LV\.4/);
  assert.deepEqual(Object.keys(app.english).filter(k=>!app.ko[k]),[]);
 }
});
