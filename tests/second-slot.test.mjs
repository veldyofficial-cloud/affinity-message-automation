import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {derivePlan} from '../src/monday.js';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const match=html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match);
const code=match[1].replace(/^\s*init\(\);\s*$/m,
  '\n globalThis.__slotTests={additionalScheduleState,configuredWeekdays,buildMessage,buildRegistrationPlan,syncTeacherFromDiscord};\n');

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
    ['🥕DRAWING SHEAN 션쌤','62107617'],
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
  assert.match(html,/showAlert\("문구가 생성되었습니다\. 승인 전에 먼데이 등록 정보를 확인해 주세요\.", "ok"\)/);
  assert.doesNotMatch(html,/id="weeklyFrequency"/);
});
