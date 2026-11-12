import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {derivePlan} from '../src/monday.js';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const match=html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match);
const code=match[1].replace(/^\s*init\(\);\s*$/m,
  '\n globalThis.__slotTests={additionalScheduleState,configuredWeekdays,buildMessage,buildRegistrationPlan,syncTeacherFromDiscord,parseKorTimeTo24h};\n');

function harness(overrides={}){
  const base={
    messageType:'CLASS',templateType:'PC',studentName:'수강생',
    classType:'ONE_ON_ONE',siblingType:'BROTHER',discord:'해당없음',
    startDay:'2026-11-02',endDay:'2026-11-12',lessonCount:'4',
    weekday:'월',amPm:'오후',korTime:'7',
    weekday2:'목',amPm2:'오전',korTime2:'10:30',classType2:'',dstMode2:'',
    weekday3:'',amPm3:'',korTime3:'',classType3:'',dstMode3:'',
    curriculumSelect:'[ART BOOK DESIGN] LV.4',
    curriculumUrl:'Upper-intermediate',studentLocation:'DOMESTIC',
    dstMode:'AUTO',tzSelect:'Asia/Seoul',countryInput:'한국',
    customFlag:'',customCourseName:'',mondayTeacher:'',
  };
  const fields={...base,...overrides};
  const elements=new Map();
  const teacherChoices=[
    ['ZOEY','62107542'],['AYEONG','62032527'],
    ['SHU','62107579'],['SYEON','62107617'],
    ['SEONYE','62270353'],['JIMIN','66891148'],['RARA','79016580']
  ];
  const document={
    getElementById(id){
      if(!elements.has(id)){
        elements.set(id,{
          value:fields[id]??'',textContent:'',
          options:id==='mondayTeacher'?teacherChoices.map(([name,value])=>({text:name,value})):[],
          querySelectorAll:()=>[],
          classList:{add(){},remove(){},toggle(){}}
        });
      }
      return elements.get(id);
    }
  };
  const ctx={document,Intl,Date,console,URLSearchParams};
  vm.runInNewContext(code,ctx,{timeout:4000});
  return {...ctx.__slotTests,get(id){return document.getElementById(id)}};
}

test('Second recurring time can differ from the first and appears in notice',()=>{
  const h=harness();
  assert.equal(h.additionalScheduleState().frequency,2);
  assert.equal(h.additionalScheduleState().second.hh,10);
  const notice=h.buildMessage();
  assert.equal(notice.ok,true,notice.error);
  assert.match(notice.text,/주 2회/);
  assert.match(notice.text,/🇰🇷 \(월\) 7 PM/);
  assert.match(notice.text,/\/ \(목\) 10:30 AM/);
  const plan=h.buildRegistrationPlan();
  assert.equal(plan.ok,true,plan.error);
  assert.equal(plan.kst.hh,19);
  assert.equal(plan.kstSecond.hh,10);
  assert.equal(plan.kstSecond.mm,30);
  const server=derivePlan({
    messageType:'CLASS',classType:'ONE_ON_ONE',templateType:'PC',
    studentLocation:'DOMESTIC',startDay:plan.startDay,endDay:plan.endDay,
    weekday:'월',weekday2:'목',weeklyFrequency:2,
    kstTime24:plan.kst,kstTime24Second:plan.kstSecond,
    lessonCount:4,explicitLessonCount:4,closures:[],studentIds:[1001],
    schedule:plan.items
  });
  assert.equal(server.lessonCount,4);
});

test('An empty optional slot means once weekly, and partially entered slot fails',()=>{
  const empty=harness({weekday2:'',amPm2:'',korTime2:'',endDay:'2026-11-23'});
  assert.equal(empty.additionalScheduleState().frequency,1);
  assert.equal(empty.buildRegistrationPlan().ok,true);
  const partial=harness({weekday2:'목',amPm2:'',korTime2:''});
  assert.equal(partial.additionalScheduleState().frequency,2);
  assert.equal(partial.additionalScheduleState().ready,false);
  assert.match(partial.buildRegistrationPlan().error,/모두 입력/);
  const invalid=harness({weekday2:'월'});
  assert.equal(invalid.additionalScheduleState().ready,false);
  const badTime=harness({korTime2:'25:00'});
  assert.equal(badTime.additionalScheduleState().ready,false);
});

test('Discord channel auto-selects the correct Monday instructor for all provided channel aliases',()=>{
  const mapping=[
    ['🐰DRAWING ZOEY 조이쌤','62107542'],
    ['💙DRAWING ELLIE 아룡쌤','62032527'],
    ['😎DRAWING SELLY 새우쌤','62107579'],
    ['🥕DRAWING SARAH 션쌤','62107617'],
    ['🎨DRAWING SEONYE 콩써니쌤','62270353'],
    ['🍒DRAWING CHAERI 채리쌤','62270353'],
    ['💖DRAWING JIMIN 지민쌤','66891148'],
    ['🐶DRAWING LARA 라라쌤','79016580']
  ];
  for(const [channel,id] of mapping){
    const h=harness({discord:channel});
    h.syncTeacherFromDiscord();
    assert.equal(h.get('mondayTeacher').value,id,channel);
  }
});

test('Three weekly slots show three independent hours and three chronological lesson dates',()=>{
  const h=harness({weekday3:'화',amPm3:'오후',korTime3:'2:45',
    endDay:'2026-11-09'});
  const state=h.additionalScheduleState();
  assert.equal(state.frequency,3);
  assert.equal(state.third.hh,14);
  const message=h.buildMessage();
  assert.equal(message.ok,true,message.error);
  assert.match(message.text,/주 3회/);
  assert.match(message.text,/🇰🇷 \(월\) 7 PM/);
  assert.match(message.text,/\/ \(화\) 2:45 PM/);
  assert.match(message.text,/\/ \(목\) 10:30 AM/);
  const plan=h.buildRegistrationPlan();
  assert.equal(plan.ok,true,plan.error);
  assert.equal(plan.weeklyFrequency,3);
  assert.deepEqual([...plan.items.map(x=>x.date)],['2026-11-02','2026-11-03','2026-11-05','2026-11-09']);
  const server=derivePlan({
    messageType:'CLASS',classType:'ONE_ON_ONE',templateType:'PC',
    studentLocation:'DOMESTIC',startDay:plan.startDay,endDay:plan.endDay,
    weekday:'월',weekday2:'목',weekday3:'화',weeklyFrequency:3,
    kstTime24:plan.kst,kstTime24Second:plan.kstSecond,kstTime24Third:plan.kstThird,
    lessonCount:4,explicitLessonCount:4,closures:[],studentIds:[1001],schedule:plan.items
  });
  assert.equal(server.lessonCount,4);
});
test('Success notice uses normal status, not orange warning',()=>{
  assert.match(html,/문구가 생성되었습니다\. 먼데이 등록 전에 내용을 확인해 주세요\./);
  assert.doesNotMatch(html,/id="weeklyFrequency"/);
});

test('Same-type USA class shows grouped US/KR times without repeating flags',()=>{
  const h=harness({
    studentLocation:'OVERSEAS',countryInput:'미국',customFlag:'🇺🇸',
    tzSelect:'America/Los_Angeles',startDay:'2026-10-05',endDay:'2026-10-17',
    weekday:'목',amPm:'오전',korTime:'10:30',
    weekday2:'토',amPm2:'오전',korTime2:'9'
  });
  const notice=h.buildMessage();
  assert.equal(notice.ok,true,notice.error);
  assert.match(notice.text,/• 수업 시간 : 주 2회 \(40m\)/);
  assert.match(notice.text,/🇺🇸 \(수\) 6:30 PM \/ \(금\) 5 PM/);
  assert.match(notice.text,/🇰🇷 \(목\) 10:30 AM \/ \(토\) 9 AM/);
  assert.doesNotMatch(notice.text,/※ 주 2회: 각 요일/);
});
test('Mixed 1:1 and group classes show separate rows and per-day server types',()=>{
  const h=harness({
    studentLocation:'OVERSEAS',countryInput:'미국',customFlag:'🇺🇸',
    tzSelect:'America/Los_Angeles',startDay:'2026-10-05',endDay:'2026-10-17',
    weekday:'화',amPm:'오후',korTime:'1',
    weekday2:'토',amPm2:'오후',korTime2:'1',classType2:'GROUP'
  });
  const notice=h.buildMessage();
  assert.equal(notice.ok,true,notice.error);
  assert.match(notice.text,/• 수업 시간 : 주 2회\n/);
  assert.match(notice.text,/🇺🇸 \(월\) 9 PM \/ 🇰🇷 \(화\) 1 PM \(1:1 40m\)/);
  assert.match(notice.text,/🇺🇸 \(금\) 9 PM \/ 🇰🇷 \(토\) 1 PM \(그룹 1h\)/);
  const plan=h.buildRegistrationPlan();
  assert.equal(plan.ok,true,plan.error);
  const validated=derivePlan({
    messageType:'CLASS',classType:'ONE_ON_ONE',templateType:'PC',
    studentLocation:'OVERSEAS',dstMode:'AUTO',
    startDay:plan.startDay,endDay:plan.endDay,
    weekday:'화',weekday2:'토',weeklyFrequency:2,
    kstTime24:plan.kst,kstTime24Second:plan.kstSecond,
    classType2:'GROUP',dstMode2:'AUTO',
    lessonCount:4,explicitLessonCount:4,closures:[],studentIds:[1001,1002],
    schedule:plan.items
  });
  assert.equal(validated.classTypeByDay[6],'GROUP');
  assert.equal(validated.classTypeByDay[2],'ONE_ON_ONE');
});
test('Korean twice-weekly identical times collapse to one country row',()=>{
  const h=harness({
    startDay:'2026-10-05',endDay:'2026-10-17',
    weekday:'화',amPm:'오후',korTime:'7',
    weekday2:'토',amPm2:'오후',korTime2:'7'
  });
  const notice=h.buildMessage();
  assert.equal(notice.ok,true,notice.error);
  assert.match(notice.text,/🇰🇷 \(화\) 7 PM \/ \(토\) 7 PM/);
});
test('Mixed DST modes show slot-specific arrows, effective date, and time-change note',()=>{
  const h=harness({
    studentLocation:'OVERSEAS',countryInput:'미국',customFlag:'🇺🇸',
    tzSelect:'America/Los_Angeles',startDay:'2026-10-20',endDay:'2026-11-14',
    weekday:'화',amPm:'오후',korTime:'1',dstMode:'TEACHER_CHANGE',
    weekday2:'토',amPm2:'오후',korTime2:'1',classType2:'GROUP',dstMode2:'STUDENT_CHANGE',
    lessonCount:'8'
  });
  const notice=h.buildMessage();
  assert.equal(notice.ok,true,notice.error);
  assert.match(notice.text,/• 수업 시간 : 주 2회\n/);
  assert.match(notice.text,/🇺🇸 \(월\) 9 PM \/ 🇰🇷 \(화\) 1 PM \(1:1 40m\)/);
  assert.match(notice.text,/※ 서머타임 전환 시, 한국 시간 2 PM으로 변경/);
  assert.match(notice.text,/🇺🇸 \(금\) 9 PM ➜ 8 PM \*11\. 06부터 적용 \/ 🇰🇷 \(토\) 1 PM \(그룹 1h\)/);
  assert.match(notice.text,/※ 서머타임 전환 시, 한국 시간 고정/);
  const plan=h.buildRegistrationPlan();
  assert.equal(plan.ok,true,plan.error);
  assert.equal(plan.items.find(row=>row.date==='2026-11-03').kstTime24.hh,14,
    'Teacher adjusts KST after the US DST transition');
});

test('Overseas student time fixed option generates actual DST-shifted KST preview',()=>{
 const h=harness({
   weekday:'월',amPm:'오전',korTime:'10',
   weekday2:'',amPm2:'',korTime2:'',
   startDay:'2026-10-19',endDay:'2026-11-09',lessonCount:'4',
   studentLocation:'OVERSEAS',tzSelect:'America/Los_Angeles',
   countryInput:'미국',customFlag:'🇺🇸',dstMode:'TEACHER_CHANGE'
 });
 const plan=h.buildRegistrationPlan();
 assert.equal(plan.ok,true,plan.error);
 assert.deepEqual(Array.from(plan.items,entry=>entry.kstTime24.hh),[10,10,11,11]);
 assert.equal(plan.items[2].kstTime24.mm,0);
});

test('November 19 Thursday 9 AM is valid for a single makeup or supplement class',()=>{
 for(const type of ['MAKEUP_40','MAKEUP_30']){
  const h=harness({
   messageType:type,startDay:'2026-11-19',endDay:'',
   weekday:'목',amPm:'오전',korTime:'9',weekday2:'',amPm2:'',korTime2:'',
   lessonCount:'12',makeupLessonNumber:'12'
  });
  const p=h.buildRegistrationPlan();
  assert.equal(p.ok,true,JSON.stringify({type,error:p.error}));
  assert.equal(p.kst.hh,9);
  assert.equal(p.kst.mm,0);
  assert.equal(p.items[0].date,'2026-11-19');
 }
});
test('Single makeup and supplement have a complete approval plan without optional slots',()=>{
 for(const messageType of ['MAKEUP_40','MAKEUP_30']){
  const h=harness({
   messageType,startDay:'2026-11-19',endDay:'',weekday:'목',
   amPm:'오전',korTime:'9',weekday2:'',amPm2:'',korTime2:'',
   makeupLessonNumber:'7',lessonCount:''
  });
  const plan=h.buildRegistrationPlan();
  assert.equal(plan.ok,true,plan.error);
  assert.equal(plan.weeklyFrequency,1);
  assert.deepEqual(Array.from(plan.extraSlots),[]);
  assert.equal(plan.kstSecond,null);
  assert.equal(plan.kstThird,null);
  assert.equal(plan.typeByDay['목'],'ONE_ON_ONE');
  assert.equal(plan.items.length,1);
  assert.doesNotThrow(()=>plan.extraSlots?.[0]?.classType);
  const notice=h.buildMessage();
  assert.equal(notice.ok,true,notice.error);
  const server=derivePlan({
   messageType,classType:'ONE_ON_ONE',templateType:'PC',
   studentLocation:'DOMESTIC',weekday:'목',weeklyFrequency:plan.weeklyFrequency,
   startDay:plan.startDay,endDay:plan.endDay,kstTime24:plan.kst,
   lessonCount:plan.lessonCount,makeupLessonNumber:7,
   closures:[],studentIds:[1001],schedule:plan.items
  });
  assert.equal(server.lessonCount,1);
 }
});

test('Single makeup and supplement reject active additional schedules before registration',()=>{
 for(const messageType of ['MAKEUP_40','MAKEUP_30']){
  const h=harness({messageType,startDay:'2026-11-19',weekday:'목',
   weekday2:'토',amPm2:'오전',korTime2:'9'});
  const plan=h.buildRegistrationPlan();
  assert.equal(plan.ok,false);
  assert.match(plan.error,/추가 정기 일정 없이 1회/);
 }
});

test('Korean time entry handles full-width numerals and invisible paste marks safely',()=>{
 const h=harness();
 for(const [value,amPm,hh,mm] of [
  ['9','오전',9,0],
  ['９','오전',9,0],
  ['９：００','오전',9,0],
  ['9\u200b','오전',9,0],
  [' 9 : 00 ','오전',9,0],
  ['12:00','오전',0,0],
  ['12:00','오후',12,0],
  ['7:30','오후',19,30]
 ]){
  const result=h.parseKorTimeTo24h(amPm,value);
  assert.equal(result?.hh,hh,value);
  assert.equal(result?.mm,mm,value);
 }
 for(const value of ['13','0','9:99','9am','9:00:00'])
  assert.equal(h.parseKorTimeTo24h('오전',value),null,value);
 assert.equal(h.parseKorTimeTo24h('', '9'),null);
});

test('Every Korean-time edit immediately revalidates registration before other previews',()=>{
  const bindStart=html.indexOf('  function bind(){');
  assert.ok(bindStart>0);
  const directStart=html.indexOf('    for(const inputId of ["korTime", "korTime2", "korTime3"]){',bindStart);
  const genericStart=html.indexOf('    ["startDay","endDay","weekday"',bindStart);
  assert.ok(directStart>bindStart && directStart<genericStart,
    'direct revalidation must run before optional local/holiday preview processing');
  const chunk=html.slice(directStart,html.indexOf('\n\n',directStart));
  const events=new Map();
  let refreshed=0;
  const controls=Object.fromEntries(['korTime','korTime2','korTime3'].map(id=>[
    id,{addEventListener(event,fn){events.set(id+':'+event,fn)}}
  ]));
  new Function('$','refreshRegistrationPreview',chunk)(
    id=>controls[id],()=>{refreshed++}
  );
  for(const id of Object.keys(controls)){
    for(const type of ['input','change']){
      assert.equal(typeof events.get(id+':'+type),'function',id+' '+type);
      events.get(id+':'+type)();
    }
  }
  assert.equal(refreshed,6);
});
