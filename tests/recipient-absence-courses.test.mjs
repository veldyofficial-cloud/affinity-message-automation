import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(source,'Program must contain inline script');
const instrumented=source.replace(/^\s*init\(\);\s*$/m,
  '\n globalThis.__spec={buildMessage,selectedNoticeRecipient,buildRecipientAbsenceBlock, '+
  'setStudents(entries){selectedStudentRecords.clear();for(const [id,name] of entries)selectedStudentRecords.set(String(id),name);}, '+
  'setAbsences(rows){individualAbsences=rows;},map:CURRICULUM_MAP,labels:CURRICULUM_KO_LABELS,menu:CURRICULUM_MENU_LABELS,groups:CURRICULUM_GROUPS};\n');
function fixture(overrides={}){
  const inputs={
    messageType:'CLASS',studentName:'이지민',templateType:'PC',
    classType:'GROUP',siblingType:'SISTER',discord:'해당없음',
    startDay:'2026-11-07',endDay:'2026-11-28',weekday:'토',
    amPm:'오전',korTime:'9',lessonCount:'4',
    curriculumSelect:'[PICTURE BOOK] FOUNDATION',curriculumUrl:'Foundation',
    countryInput:'한국',customFlag:'',studentLocation:'DOMESTIC',
    dstMode:'AUTO',tzSelect:'Asia/Seoul',noticeRecipient:'102',
    weekday2:'',amPm2:'',korTime2:'',weekday3:'',amPm3:'',korTime3:''
  };
  const fields={...inputs,...overrides};
  const nodes=new Map();
  const document={
    getElementById(id){
      if(!nodes.has(id))nodes.set(id,{value:fields[id]??'',hidden:undefined,querySelectorAll(){return []}});
      return nodes.get(id);
    }
  };
  const ctx={document,Intl,Date,URLSearchParams,console};
  vm.runInNewContext(instrumented,ctx,{timeout:3000});
  ctx.__spec.setStudents([['101','이지윤'],['102','이지민']]);
  ctx.__spec.setAbsences([
    {date:'2026-11-14',studentIds:[101]},
    {date:'2026-11-21',studentIds:[102]}
  ]);
  return {...ctx.__spec,setValue(id,v){document.getElementById(id).value=v;}};
}

test('Personal group notice includes only recipient absence, not another student',()=>{
  const app=fixture();
  const result=app.buildMessage();
  assert.equal(result.ok,true,result.error);
  assert.match(result.text,/• 개별 결석 일정 :/);
  assert.match(result.text,/- 11\. 21 \(토, 개별 결석\)/);
  assert.doesNotMatch(result.text,/11\. 14 \(토, 개별 결석\)/);
  assert.match(result.text,/• 수업 시간 : 주 1회 \(1h\)/);
  assert.doesNotMatch(result.text,/이지윤/);
});

test('US Friday local absence maps to corresponding Korean Saturday lesson',()=>{
  const app=fixture({studentLocation:'OVERSEAS',tzSelect:'America/New_York',countryInput:'미국',customFlag:'🇺🇸'});
  const result=app.buildMessage();
  assert.equal(result.ok,true,result.error);
  assert.match(result.text,/- 11\. 20 \(금, 개별 결석\)/);
  assert.doesNotMatch(result.text,/- 11\. 21 \(토, 개별 결석\)/);
});

test('Missing recipient identification blocks sending a misleading notice',()=>{
  const app=fixture({studentName:'그룹 전체',noticeRecipient:''});
  const result=app.buildMessage();
  assert.equal(result.ok,false);
  assert.match(result.error,/안내문 대상 학생/);
});

test('Student name uniquely resolves recipient when selection is blank',()=>{
  const app=fixture({noticeRecipient:''});
  const result=app.buildMessage();
  assert.equal(result.ok,true,result.error);
  assert.match(result.text,/11\. 21 \(토, 개별 결석\)/);
});

test('Obsolete Video Basic and Pro are removed and Editor/Creator have correct URL slugs',()=>{
  const app=fixture();
  assert.equal(app.map['[VIDEO] BASIC'],undefined);
  assert.equal(app.map['[VIDEO] PRO'],undefined);
  assert.equal(app.map['[VIDEO] EDITOR'],'VideoEditor');
  assert.equal(app.map['[VIDEO] CREATOR'],'VideoCreator');
  assert.equal(app.labels['[VIDEO] EDITOR'],'비디오 EDITOR');
  assert.equal(app.labels['[VIDEO] CREATOR'],'비디오 크리에이터');
  assert.ok(app.groups.some(g=>g.group==='영상/모션'&&g.items.includes('[VIDEO] EDITOR')&&g.items.includes('[VIDEO] CREATOR')));
  for(const code of ['[AFFINITY] DESIGNER','[AFFINITY] PHOTO','[VIBE] BASIC'])
    assert.ok(app.map[code],code+' is retained');
  assert.equal(app.menu['[BRANDING] PERSONAL COURSE'],'1:1 브랜딩 코스');
});

test('Existing Infohub approval posts exactly one initial update, never guesses other timezone bubbles',()=>{
  const route=fs.readFileSync(new URL('../src/routes.js',import.meta.url),'utf8');
  assert.equal([...route.matchAll(/create_update\s*\(/g)].length,1);
  assert.match(html,/모든 학생의 문구가 저장된 후, 먼데이 상위아이템 1개와 말풍선 1개/);
});
