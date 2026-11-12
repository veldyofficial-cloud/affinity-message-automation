import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'Main inline script must exist');
const code=script.replace(/^\s*init\(\);\s*$/m,
  'globalThis.__memoTest={buildRegistrationPlan,refreshRegistrationPreview,parseSubMemos,approvalFingerprint,registrationFingerprint,dateMemoDrafts,dateMemoEnabled,setDateMemoEnabled};');

function element(tag='div'){
  return {
    tagName:tag.toUpperCase(),value:'',textContent:'',className:'',rows:0,maxLength:0,checked:false,
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

test('Each scheduled date starts with a checkbox and no memo input',()=>{
  const h=harness();
  const plan=h.buildRegistrationPlan();
  assert.equal(plan.ok,true,plan.error);
  assert.equal(plan.items.length,4);
  h.refreshRegistrationPreview();
  const rows=h.get('registrationPreview').children[2].children;
  assert.equal(rows.length,4);
  assert.deepEqual(Array.from(rows,row=>row.children[1].children[0].dataset.date),
    ['2026-11-02','2026-11-09','2026-11-16','2026-11-23']);
  assert.ok(rows.every(row=>row.children.length===2),'unchecked sessions have no memo fields');
  assert.ok(rows.every(row=>row.children[1].children[0].checked===false));
  assert.match(rows[0].children[0].textContent,/LESSON 01/);
});

test('Only checked date memos reach approval and drafts return when rechecked',()=>{
  const h=harness();
  let plan=h.buildRegistrationPlan();
  h.refreshRegistrationPreview();
  h.dateMemoDrafts.set('2026-11-02','첫 수업 메모');
  h.dateMemoDrafts.set('2026-11-16','세 번째 수업 메모');
  assert.equal(h.parseSubMemos(plan).length,0,'unchecked memo drafts never send');
  h.setDateMemoEnabled('2026-11-02',true);
  h.setDateMemoEnabled('2026-11-16',true);
  assert.equal(h.parseSubMemos(plan).length,2);
  h.get('endDay').value='2026-11-09';
  h.get('lessonCount').value='2';
  plan=h.buildRegistrationPlan();
  assert.equal(plan.ok,true,plan.error);
  h.refreshRegistrationPreview();
  assert.deepEqual(Array.from(h.parseSubMemos(plan),x=>x.date),['2026-11-02']);
  h.get('endDay').value='2026-11-23';
  h.get('lessonCount').value='4';
  plan=h.buildRegistrationPlan();
  h.refreshRegistrationPreview();
  assert.equal(h.parseSubMemos(plan).length,2,'original memo restores when date returns');
  const row=h.get('registrationPreview').children[2].children[2];
  assert.equal(row.children[2].value,'세 번째 수업 메모');
  h.setDateMemoEnabled('2026-11-16',false);
  assert.equal(h.parseSubMemos(plan).length,1,'unchecking prevents transmission');
  h.setDateMemoEnabled('2026-11-16',true);
  assert.equal(h.parseSubMemos(plan).length,2,'rechecking restores draft text');
});

test('Memo checkbox or text does not invalidate announcement but changes approval fingerprint',()=>{
  const h=harness();
  const beforeNotice=h.registrationFingerprint();
  const beforeApproval=h.approvalFingerprint();
  h.setDateMemoEnabled('2026-11-09',true);
  h.dateMemoDrafts.set('2026-11-09','확인 필요');
  assert.equal(h.registrationFingerprint(),beforeNotice);
  assert.notEqual(h.approvalFingerprint(),beforeApproval);
  const rows=h.parseSubMemos(h.buildRegistrationPlan());
  assert.equal(rows.length,1);
  assert.equal(rows[0].memo,'확인 필요');
});

test('Single makeup lesson renders a checkbox without an always-visible memo',()=>{
  const h=harness({messageType:'MAKEUP_40',endDay:'',lessonCount:'',makeupLessonNumber:'7'});
  const plan=h.buildRegistrationPlan();
  assert.equal(plan.ok,true,plan.error);
  h.refreshRegistrationPreview();
  const row=h.get('registrationPreview').children[2].children[0];
  assert.equal(row.children.length,2);
  assert.match(row.children[0].textContent,/보강/);
  h.setDateMemoEnabled(plan.items[0].date,true);
  h.dateMemoDrafts.set(plan.items[0].date,'보강 요청');
  assert.equal(h.parseSubMemos(plan)[0].memo,'보강 요청');
});

test('Memo length guard follows server column limit',()=>{
  const h=harness();
  const plan=h.buildRegistrationPlan();
  h.setDateMemoEnabled('2026-11-02',true);
  h.dateMemoDrafts.set('2026-11-02','x'.repeat(1501));
  assert.throws(()=>h.parseSubMemos(plan),/1500자/);
});

test('Desktop has nonedge gutters and main blue remains blue rather than navy',()=>{
  assert.match(html,/--blue:\s*#0b66f2;/);
  assert.match(html,/padding:12px clamp\(46px,3\.6vw,70px\) 0/);
  assert.match(html,/padding:14px clamp\(46px,3\.6vw,70px\) 16px/);
  assert.match(html,/className="registration-memo-check"/);
  assert.match(html,/main\.grid > \.output-card \{ display:flex; flex-direction:column; \}/);
  assert.doesNotMatch(html,/id="subMemo"/);
  assert.doesNotMatch(html,/id="dateMemoRows"/);
  assert.doesNotMatch(html,/id="subMemos"/);
});
