import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const match=html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match);
const script=match[1].replace(/^\s*init\(\);\s*$/m,`
  globalThis.__holidayTest={
    getKoreanClassWindow,getVisibleFetchedHolidayEntries,getEffectiveClosedList,
    getHolidayFetchEndDate,renderHolidayList,holidayDisplayLabel,
    formatHolidayDateLine,calculateExpectedEndDate,upsertClosed,
    setHolidays:items=>{fetchedHolidays=items;},
    selectDate:date=>selectedFetchedHolidayDates.add(date),
    clearSelections:()=>selectedFetchedHolidayDates.clear()
  };
`);

function harness(overrides={}){
  const values={
    messageType:'CLASS',templateType:'PC',classType:'ONE_ON_ONE',
    startDay:'2026-11-04',endDay:'',lessonCount:'20',
    weekday:'월',amPm:'오후',korTime:'2',
    weekday2:'목',amPm2:'오후',korTime2:'2',
    weekday3:'',amPm3:'',korTime3:'',
    studentLocation:'DOMESTIC',tzSelect:'Asia/Seoul',
    ...overrides
  };
  const fields=new Map();
  function fakeElement(tag='div'){
    return {
      tagName:tag.toUpperCase(),value:'',textContent:'',className:'',
      children:[],style:{},dataset:{},hidden:undefined,
      replaceChildren(...children){this.children=children},
      appendChild(child){this.children.push(child)},
      append(...children){this.children.push(...children)},
      querySelectorAll(){return []}
    };
  }
  const document={
    getElementById(id){
      if(!fields.has(id)){
        const node=fakeElement();
        node.value=values[id]??'';
        fields.set(id,node);
      }
      return fields.get(id);
    },
    createElement:fakeElement
  };
  const ctx={document,Intl,Date,console,URLSearchParams};
  vm.runInNewContext(script,ctx,{timeout:6000});
  return {...ctx.__holidayTest,
    input:id=>document.getElementById(id),
    rendered:()=>document.getElementById('holidayList').children};
}
const holidays=[
  {date:'2026-11-02',localName:'기간 전'},
  {date:'2026-11-05',localName:'첫 수업일'},
  {date:'2027-01-11',localName:'종강일'},
  {date:'2027-01-12',localName:'요일이 다른 공휴일'},
  {date:'2027-01-18',localName:'종강일 이후'},
  {date:'2027-02-09',localName:'설날'}
];

test('Fetch buffer never exposes out-of-range or non-class-day Korean holidays',()=>{
  const h=harness();
  assert.equal(h.getKoreanClassWindow().end,'2027-01-11');
  assert.ok(h.getHolidayFetchEndDate('2026-11-04','월',20)>'2027-02-09',
    'The raw API fetch buffer may be longer than the real class window');
  h.setHolidays(holidays);
  assert.deepEqual(Array.from(h.getVisibleFetchedHolidayEntries(),x=>x.holiday.date),
    ['2026-11-05','2027-01-11']);
  h.renderHolidayList();
  assert.equal(h.rendered().length,2);
  assert.doesNotMatch(h.rendered().map(x=>x.children[1].textContent).join('\n'),/2\/9|설날/);
});

test('Selected holiday on a real KST class date pushes end date and reveals only newly eligible dates',()=>{
  const h=harness();
  h.setHolidays([...holidays,{date:'2027-01-14',localName:'연장 기간 공휴일'}]);
  h.selectDate('2027-01-11');
  const range=h.getKoreanClassWindow();
  assert.equal(range.end,'2027-01-14');
  assert.deepEqual(Array.from(h.getVisibleFetchedHolidayEntries(),x=>x.holiday.date),
    ['2026-11-05','2027-01-11','2027-01-14']);
  assert.deepEqual(Array.from(h.getEffectiveClosedList(),x=>x.date),['2027-01-11']);
});

test('Future out-of-range holiday remains excluded even when stale selection exists',()=>{
  const h=harness();
  h.setHolidays(holidays);
  h.selectDate('2027-02-09');
  assert.equal(h.getKoreanClassWindow().end,'2027-01-11');
  assert.equal(h.getEffectiveClosedList().length,0);
});

test('Overseas local Tuesday class matches the Korean Wednesday holiday date',()=>{
  const h=harness({
    weekday:'수',weekday2:'',amPm2:'',korTime2:'',
    startDay:'2026-11-04',endDay:'2026-11-25',
    amPm:'오전',korTime:'10:30',
    studentLocation:'OVERSEAS',tzSelect:'America/Los_Angeles'
  });
  h.setHolidays([{date:'2026-11-04',localName:'테스트 공휴일'}]);
  assert.deepEqual(Array.from(h.getVisibleFetchedHolidayEntries(),x=>x.holiday.date),
    ['2026-11-04']);
  const label=h.holidayDisplayLabel({date:'2026-11-04',localName:'테스트 공휴일'});
  assert.match(label,/한국 11\/4\(수\) → 현지 11\/3\(화\)/);
  assert.match(h.formatHolidayDateLine('2026-11-04','한국 공휴일',
    'OVERSEAS','America/Los_Angeles',{hh:10,mm:30}),/11\. 03 \(화, 한국 공휴일\)/);
});

test('All 20 recurring lessons and unrelated months retain correct KST boundaries',()=>{
  const h=harness({weekday:'월',weekday2:'목',amPm2:'오후',korTime2:'2'});
  assert.equal(h.getKoreanClassWindow().start,'2026-11-04');
  assert.equal(h.getKoreanClassWindow().end,'2027-01-11');
  h.setHolidays([{date:'2027-02-09',localName:'설날'}]);
  assert.equal(h.getVisibleFetchedHolidayEntries().length,0);
  h.input('endDay').value='2027-02-15';
  assert.equal(h.getKoreanClassWindow().end,'2027-02-15');
  assert.equal(h.getVisibleFetchedHolidayEntries().length,0,'Tuesday is not a Monday/Thursday class date');
});

test('Holiday markup is constructed using textContent, not unescaped API names',()=>{
  const h=harness({startDay:'2026-11-04',endDay:'2026-11-25',weekday:'수',
    weekday2:'',amPm2:'',korTime2:''});
  h.setHolidays([{date:'2026-11-04',localName:'<img src=x onerror=alert(1)>'}]);
  h.renderHolidayList();
  assert.equal(h.rendered().length,1);
  assert.match(h.rendered()[0].children[1].textContent,/<img src=x/);
  assert.equal(h.rendered()[0].children.length,2);
});
