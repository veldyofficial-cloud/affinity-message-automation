import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'Main inline script must exist');
const code=script.replace(/^\s*init\(\);\s*$/m,
  'globalThis.__memoTest={buildRegistrationPlan,renderDateMemoRows,parseSubMemos,approvalFingerprint,registrationFingerprint,dateMemoDrafts};');

function element(tag='div'){
  return {
    tagName:tag.toUpperCase(),value:'',textContent:'',className:'',rows:0,maxLength:0,
    placeholder:'',dataset:{},children:[],style:{},
    classList:{add(){},remove(){},toggle(){}},
    append(...nodes){this.children.push(...nodes)},
    appendChild(node){this.children.push(node)},
    replaceChildren(...nodes){this.children=nodes.flatMap(node=>node.tagName==='FRAGMENT'?node.children:[node])},
    setAttribute(name,value){this[name]=value},
    querySelectorAll(){return []}
  };
}
function harness(overrides={}){
  const base={
    messageType:'CLASS',templateType:'PC',studentName:'테스트',
    classType:'ONE_ON_ONE',siblingType:'BROTHER',discord:'해당없음',
    startDay:'2026-11-02',endDay:'2026-11-23',lessonCount:'4',
    weekday:'월',amPm:'오전',korTime:'9',
    weekday2:'',amPm2:'',korTime2:'',classType2:'',dstMode2:'',
    weekday3:'',amPm3:'',korTime3:'',classType3:'',dstMode3:'',
    curriculumSelect:'[ART BOOK DESIGN] LV.4',curriculumUrl:'Upper-intermediate',
    studentLocation:'DOMESTIC',dstMode:'AUTO',tzSelect:'Asia/Seoul',
    countryInput:'한국',customFlag:'',customCourseName:'',mondayLanguage:'KR',
    mondayTeacher:'62107542',mondayItemName:'[ART BOOK DESIGN] LV.4',
    subMemo:''
  };
  const nodes=new Map();
  const document={
    getElementById(id){
      if(!nodes.has(id)){
        const node=element();
        node.value={...base,...overrides}[id]??'';
        nodes.set(id,node);
      }
      return nodes.get(id);
    },
    createElement:element,
    createDocumentFragment:()=>element('fragment')
  };
  const ctx={document,Intl,Date,console,URLSearchParams};
  vm.runInNewContext(code,ctx,{timeout:5000});
  return {...ctx.__memoTest,get:id=>document.getElementById(id)};
}

test('Scheduled child dates render one editable memo field per lesson',()=>{
  const h=harness();
  const plan=h.buildRegistrationPlan();
  assert.equal(plan.ok,true,plan.error);
  assert.equal(plan.items.length,4);
  h.renderDateMemoRows(plan);
  const rows=h.get('dateMemoRows').children;
  assert.equal(rows.length,4);
  assert.deepEqual(Array.from(rows,row=>row.children[1].dataset.date),
    ['2026-11-02','2026-11-09','2026-11-16','2026-11-23']);
  assert.match(rows[0].children[0].children[1].textContent,/LESSON 01/);
  assert.match(h.get('dateMemoStatus').textContent,/4개/);
});

test('Only populated dates are sent, including holiday dates; memos survive temporary schedule edits',()=>{
  const h=harness();
  let plan=h.buildRegistrationPlan();
  h.renderDateMemoRows(plan);
  h.dateMemoDrafts.set('2026-11-02','첫 수업 메모');
  h.dateMemoDrafts.set('2026-11-16','세 번째 수업 메모');
  h.renderDateMemoRows(plan);
  assert.equal(h.parseSubMemos(plan).length,2);
  h.get('endDay').value='2026-11-09';
  h.get('lessonCount').value='2';
  plan=h.buildRegistrationPlan();
  assert.equal(plan.ok,true,plan.error);
  h.renderDateMemoRows(plan);
  assert.deepEqual(Array.from(h.parseSubMemos(plan),x=>x.date),['2026-11-02']);
  h.get('endDay').value='2026-11-23';
  h.get('lessonCount').value='4';
  plan=h.buildRegistrationPlan();
  h.renderDateMemoRows(plan);
  assert.equal(h.parseSubMemos(plan).length,2,'original memo is restored when date returns');
  assert.equal(h.get('dateMemoRows').children[2].children[1].value,'세 번째 수업 메모');
});

test('Editing child memo does not invalidate generated notice but does change approval payload',()=>{
  const h=harness();
  const beforeNotice=h.registrationFingerprint();
  const beforeApproval=h.approvalFingerprint();
  h.dateMemoDrafts.set('2026-11-09','확인 필요');
  assert.equal(h.registrationFingerprint(),beforeNotice);
  assert.notEqual(h.approvalFingerprint(),beforeApproval);
  const rows=h.parseSubMemos(h.buildRegistrationPlan());
  assert.equal(rows.length,1);
  assert.equal(rows[0].memo,'확인 필요');
});

test('A single makeup lesson also renders its own memo field',()=>{
  const h=harness({messageType:'MAKEUP_40',endDay:'',lessonCount:'',
    makeupLessonNumber:'7'});
  const plan=h.buildRegistrationPlan();
  assert.equal(plan.ok,true,plan.error);
  h.renderDateMemoRows(plan);
  assert.equal(h.get('dateMemoRows').children.length,1);
  assert.match(h.get('dateMemoRows').children[0].children[0].children[1].textContent,/보강/);
});

test('Memo length guard follows server column limit',()=>{
  const h=harness();
  const plan=h.buildRegistrationPlan();
  h.dateMemoDrafts.set('2026-11-02','x'.repeat(1501));
  assert.throws(()=>h.parseSubMemos(plan),/1500자/);
});

test('Desktop has nonedge gutters and main blue remains blue rather than navy',()=>{
  assert.match(html,/--blue:\s*#2269e8;/);
  assert.match(html,/padding:12px clamp\(26px,2\.2vw,42px\) 0/);
  assert.match(html,/padding:14px clamp\(26px,2\.2vw,42px\) 16px/);
  assert.match(html,/id="dateMemoRows"/);
  assert.doesNotMatch(html,/id="subMemos"/);
});
