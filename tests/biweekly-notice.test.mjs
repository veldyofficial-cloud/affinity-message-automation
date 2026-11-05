import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {derivePlan} from '../src/monday.js';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
function plan({startDay='2026-11-02',endDay='2026-11-12',count=4,frequency=2,weekday2='목',closures=[],override={}}={}) {
  const schedule=[];let no=0;
  const end=new Date(endDay+'T00:00:00Z');
  for(let cur=new Date(startDay+'T00:00:00Z');cur<=end;cur.setUTCDate(cur.getUTCDate()+1)){
    if(![1,...(frequency===2?[4]:[])].includes(cur.getUTCDay()))continue;
    const date=cur.toISOString().slice(0,10);
    const closed=closures.find(c=>c.date===date);
    if(closed) schedule.push({date,kind:'CLOSED',name:closed.name==='수강생 요청 휴강'?'수강생 요청 휴강':'공휴일 휴강'});
    else {no++;schedule.push({date,kind:'LESSON',name:'LESSON '+String(no).padStart(2,'0'),absentStudentIds:[]});}
  }
  return {messageType:'CLASS',classType:'ONE_ON_ONE',templateType:'IPAD',studentLocation:'DOMESTIC',dstMode:'AUTO',
    startDay,endDay,weekday:'월',weeklyFrequency:frequency,weekday2,kstTime24:{hh:19,mm:0},kstTime24Second:frequency>=2?{hh:10,mm:30}:null,
    lessonCount:count,explicitLessonCount:count,closures,studentIds:[123456],schedule,...override};
}

test('Twice-weekly Monday/Thursday class creates four chronological subitems',()=>{
  const p=derivePlan(plan());
  assert.equal(p.lessonCount,4);
  assert.equal(p.holidayCount,0);
  assert.deepEqual(p.schedule.map(x=>x.date),['2026-11-02','2026-11-05','2026-11-09','2026-11-12']);
  assert.equal(p.groupId,'new_group29179','Parent is assigned to Monday group');
});
test('Twenty lessons twice-weekly and one holiday have consistent counts',()=>{
  const closures=[{date:'2026-11-09',name:'수강생 요청 휴강'}];
  const p=derivePlan(plan({endDay:'2027-01-11',count:20,closures}));
  assert.equal(p.lessonCount,20);
  assert.equal(p.holidayCount,1);
  assert.equal(p.schedule.length,21);
  assert.equal(p.schedule.at(-1).date,'2027-01-11');
});
test('Invalid frequency, same day, or wrong client schedule must be rejected before Monday writes',()=>{
  assert.throws(()=>derivePlan(plan({frequency:4})),/횟수/);
  assert.throws(()=>derivePlan(plan({weekday2:'월'})),/서로 달라야/);
  assert.throws(()=>derivePlan(plan({override:{schedule:[]}})),/서버 검증/);
});
test('Three weekly days generate ordered subitems with independently validated third time',()=>{
  const p=plan({startDay:'2026-11-02',endDay:'2026-11-09',count:4,frequency:3,
    override:{weekday3:'화',kstTime24Third:{hh:14,mm:45},
      schedule:[
        {date:'2026-11-02',kind:'LESSON',name:'LESSON 01',absentStudentIds:[]},
        {date:'2026-11-03',kind:'LESSON',name:'LESSON 02',absentStudentIds:[]},
        {date:'2026-11-05',kind:'LESSON',name:'LESSON 03',absentStudentIds:[]},
        {date:'2026-11-09',kind:'LESSON',name:'LESSON 04',absentStudentIds:[]}
      ]}
  });
  assert.deepEqual(derivePlan(p).schedule.map(x=>x.date),['2026-11-02','2026-11-03','2026-11-05','2026-11-09']);
  assert.throws(()=>derivePlan({...p,weekday3:'월'}),/서로 달라야/);
  assert.throws(()=>derivePlan({...p,kstTime24Third:null}),/세 번째/);
});
test('Single weekly schedule remains compatible when new field is absent',()=>{
  const payload=plan({endDay:'2026-11-23',frequency:1,weekday2:'',count:4});
  delete payload.weeklyFrequency;
  assert.equal(derivePlan(payload).lessonCount,4);
});
test('Two-day course time and reminder UI is included',()=>{
  assert.match(html,/<option value="20">20강<\/option>/);
  assert.doesNotMatch(html,/<select id="weeklyFrequency">/);
  assert.match(html,/id="amPm2"/);
  assert.match(html,/id="amPm3"/);
  assert.match(html,/id="korTime3"/);
  assert.match(html,/id="addWeeklySlot"/);
  assert.match(html,/id="removeWeeklySlot2"/);
  assert.match(html,/id="removeWeeklySlot3"/);
  assert.match(html,/id="korTime2"/);
  assert.match(html,/<select id="weekday2">/);
  assert.match(html,/weeklyFrequency:plan.weeklyFrequency/);
  assert.match(html,/const header="• 수업 시간 : 주 "/);
  assert.match(html,/디지털 드로잉은 디스코드로 진행/);
  assert.match(html,/담당 강사의 디스코드 채널을 선택해 주세요/);
  assert.match(html,/#alert\.warn \{ background: #fff7ed/);
});
test('Inline script parses as JavaScript',()=>{
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length);
  for(const [i,script] of scripts.entries()) new vm.Script(script[1],{filename:'inline-'+i+'.js'});
});

test('Public holiday names use one canonical Monday subitem title without changing original reason',()=>{
 const closures=[{date:'2026-11-09',name:'설날'}];
 const p=derivePlan(plan({endDay:'2026-11-16',count:4,closures}));
 const closed=p.schedule.find(row=>row.kind==='CLOSED');
 assert.equal(closed.name,'공휴일 휴강');
 assert.equal(closed.reason,'설날');
 assert.equal(p.schedule.filter(row=>row.kind==='LESSON').length,4);
});
