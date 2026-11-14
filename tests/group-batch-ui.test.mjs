import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const original=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(original);
const instrumented="globalThis.__test={"+
  "select(id){$('noticeRecipient').value=id;$('studentName').value=selectedStudentRecords.get(id);},"+
  "setStudents(rows){selectedStudentRecords.clear();for(const [id,name] of rows)selectedStudentRecords.set(String(id),name);},"+
  "setAbsences(rows){individualAbsences=rows;},"+
  "generateAndSave(){const r=buildMessage();if(!r.ok)return r;$('output').value=r.text;lastGeneratedFingerprint=registrationFingerprint();saveStudentNotice();return r;},"+
  "staged:()=>[...stagedStudentNotices],combined:()=>combinedStudentNoticeText(),shared:()=>commonNoticeFingerprint(),"+
  "renderStagedNotices,displaySelectedStudents,fillLookupResults,chooseNoticeRecipient,plan:buildRegistrationPlan,setValue:(id,value)=>{$(id).value=value;},getValue:id=>$(id).value,status:()=>$('savedStudentNotices').textContent};";
const script=original.replace(/^\s*init\(\);\s*$/m,instrumented);
function harness(){
 const fields={
    messageType:'CLASS',templateType:'PC',studentName:'A',
    classType:'GROUP',siblingType:'SISTER',discord:'해당없음',
    startDay:'2026-11-07',endDay:'2026-11-28',weekday:'토',
    amPm:'오전',korTime:'9',lessonCount:'4',
    curriculumSelect:'[PICTURE BOOK] FOUNDATION',curriculumUrl:'Foundation',
    countryInput:'한국',customFlag:'',studentLocation:'DOMESTIC',
    dstMode:'AUTO',tzSelect:'Asia/Seoul',noticeRecipient:'101',
    weekday2:'',amPm2:'',korTime2:'',weekday3:'',amPm3:'',korTime3:'',
    usStateSelect:'',auStateSelect:'',tzSearch:''
 };
 const nodes=new Map();
 const document={
   getElementById(id){
     if(!nodes.has(id))nodes.set(id,{
       value:fields[id]??'',options:[],style:{},disabled:false,
       textContent:'',classList:{add(){},remove(){},toggle(){}},
       innerHTML:'',children:[],dataset:{},
       replaceChildren(...items){this.options=items;this.children=items.flatMap(x=>x.tagName==='FRAGMENT'?x.children:[x]);},
       appendChild(o){this.options.push(o);this.children.push(o)},
       append(...items){this.options.push(...items);this.children.push(...items)},
       querySelectorAll(){return []}
     });
     return nodes.get(id);
   },
   createDocumentFragment(){return {tagName:'FRAGMENT',children:[],appendChild(x){this.children.push(x)}};},
   createElement(tag){return {value:'',textContent:'',style:{},children:[],dataset:{},checked:false,
      listeners:{},appendChild(x){this.children.push(x)},append(...items){this.children.push(...items)},
      addEventListener(name,cb){this.listeners[name]=cb},setAttribute(){},
      classList:{add(){},remove(){},toggle(){}}}}
 };
 const ctx={document,Intl,Date,console,URLSearchParams,
   Option:class {constructor(text,value){this.textContent=text;this.value=value}}};
 vm.runInNewContext(script,ctx,{timeout:5000});
 ctx.__test.setStudents([['101','A'],['102','B'],['103','C']]);
 ctx.__test.setAbsences([{date:'2026-11-14',studentIds:[102,103]}]);
 return {...ctx.__test,__getNode:id=>nodes.get(id)};
}
test('Three student notices are staged separately and joined into one bubble',()=>{
 const h=harness();
 h.select('101');
 const a=h.generateAndSave();
 assert.equal(a.ok,true,a.error);
 assert.match(a.text,/수업 시간 변경/);
 assert.match(a.text,/1:1 40m/);
 h.select('102');
 h.setValue('studentLocation','OVERSEAS');
 h.setValue('tzSelect','America/New_York');
 h.setValue('countryInput','미국');
 h.setValue('customFlag','🇺🇸');
 const b=h.generateAndSave();
 assert.equal(b.ok,true,b.error);
 assert.match(b.text,/개별 결석/);
 assert.match(b.text,/11\. 13 \(금, 개별 결석\)/);
 h.select('103');
 h.setValue('tzSelect','America/Los_Angeles');
 const c=h.generateAndSave();
 assert.equal(c.ok,true,c.error);
 assert.match(c.text,/개별 결석/);
 assert.equal(h.staged().length,3);
 assert.match(h.status(),/3\/3명/);
 const joined=h.combined();
 assert.match(joined,/\[학생별 안내 1 \| A\]/);
 assert.match(joined,/\[학생별 안내 2 \| B\]/);
 assert.match(joined,/\[학생별 안내 3 \| C\]/);
 assert.match(joined,/🇺🇸/);
 assert.ok(joined.indexOf('[학생별 안내 1')<joined.indexOf('[학생별 안내 2'));
 h.setValue('korTime','10');
 h.renderStagedNotices();
 assert.match(h.status(),/0\/3명/,'shared schedule change invalidates all staged messages');
});
test('Three-person group with one absence remains 60m; two absences yield 40m',()=>{
 const h=harness();
 h.setAbsences([{date:'2026-11-14',studentIds:[102]}]);
 let p=h.plan();
 assert.equal(p.ok,true,p.error);
 assert.equal(p.items.find(row=>row.date==='2026-11-14').durationMinutes,60);
 h.setAbsences([{date:'2026-11-14',studentIds:[102,103]}]);
 p=h.plan();
 assert.equal(p.ok,true,p.error);
 assert.equal(p.items.find(row=>row.date==='2026-11-14').durationMinutes,40);
 h.setAbsences([{date:'2026-11-14',studentIds:[102,103],keepGroupDuration:true}]);
 p=h.plan();
 assert.equal(p.ok,true,p.error);
 assert.equal(p.items.find(row=>row.date==='2026-11-14').durationMinutes,60);
});

test('Single joining learner stays in GROUP 60m on browser registration preview and can save own notice',()=>{
 const h=harness();
 h.setStudents([['101','A']]);
 h.setAbsences([]);
 h.select('101');
 const plan=h.plan();
 assert.equal(plan.ok,true,plan.error);
 assert.deepEqual(Array.from(plan.items,x=>x.durationMinutes),[60,60,60,60]);
 const message=h.generateAndSave();
 assert.equal(message.ok,true,message.error);
 assert.match(message.text,/주 1회 \(1h\)/);
 assert.equal(h.staged().length,1);
 assert.match(h.status(),/1\/1명/);
 assert.match(h.combined(),/\[학생별 안내 1 \| A\]/);
});

test('GROUP student addition automatically selects newcomer and preserves saved former notice',()=>{
 const h=harness();
 h.setStudents([['101','A']]);h.setAbsences([]);h.select('101');
 assert.equal(h.generateAndSave().ok,true);
 assert.match(h.status(),/1\/1명/);
 const before=h.shared(),first=h.staged()[0][1].message;
 h.fillLookupResults([{id:102,name:'B'}]);
 const checkbox=h.__getNode('studentResults').children[0].children[0];
 checkbox.checked=true;
 checkbox.listeners.change();
 assert.equal(h.shared(),before);
 assert.equal(h.getValue('noticeRecipient'),'102');
 assert.equal(h.getValue('studentName'),'B');
 assert.equal(h.getValue('output'),'');
 assert.match(h.status(),/1\/2명/);
 assert.doesNotMatch(h.status(),/공통 일정 변경/);
 assert.equal(h.staged()[0][1].message,first);
 assert.equal(h.generateAndSave().ok,true);
 assert.match(h.status(),/2\/2명/);
 assert.match(h.combined(),/\[학생별 안내 1 \| A\]/);
 assert.match(h.combined(),/\[학생별 안내 2 \| B\]/);
});

test('Actual shared schedule changes still invalidate previously saved group notices',()=>{
 const h=harness();
 h.setStudents([['101','A']]);h.setAbsences([]);h.select('101');
 assert.equal(h.generateAndSave().ok,true);
 h.setValue('korTime','10');h.renderStagedNotices();
 assert.match(h.status(),/0\/1명/);
});

test('Roster change with individual absences still invalidates notices due to attendance',()=>{
 const h=harness();
 h.setStudents([['101','A'],['102','B']]);
 h.setAbsences([{date:'2026-11-14',studentIds:[102]}]);
 h.select('101');assert.equal(h.generateAndSave().ok,true);
 const before=h.shared();
 h.setStudents([['101','A'],['102','B'],['103','C']]);
 h.renderStagedNotices();
 assert.notEqual(h.shared(),before);
 assert.match(h.status(),/0\/3명/);
});
