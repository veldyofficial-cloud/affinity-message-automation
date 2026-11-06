import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
function section(start, end) {
  const first = html.indexOf(start);
  const last = html.indexOf(end, first);
  assert.ok(first >= 0 && last > first, 'Expected script section is present: ' + start);
  return html.slice(first, last);
}
const countrySource = section('  const COUNTRY_DB = [', '  const US_STATES = [');
const guideSource = section('  function buildDrawingDeviceLine(', '  function formatFullDateLine(');

test('Worldwide country options include Malaysia and American Samoa with correct time zones', () => {
  const {db, options} = vm.runInNewContext(countrySource + '\n({db:COUNTRY_DB,options:COUNTRY_OPTIONS})', {Intl});
  assert.ok(options.length >= 230, 'Country list should cover ISO 3166-1 countries and territories');
  assert.equal(new Set(options.map(x => x.ko)).size, options.length, 'No duplicated country labels');
  for (const [name, flag, tz] of [
    ['말레이시아', '🇲🇾', 'Asia/Kuala_Lumpur'],
    ['아메리칸사모아', '🇦🇸', 'Pacific/Pago_Pago']
  ]) {
    const match = options.find(x => x.ko === name);
    assert.ok(match, name + ' appears in the country datalist');
    assert.equal(match.flag, flag);
    assert.equal(db.find(x => x.ko === name).tz[0], tz);
    new Intl.DateTimeFormat('ko-KR', {timeZone:tz});
  }
  assert.match(html, /COUNTRY_OPTIONS\.forEach\(c=>/);
});

test('Unknown country can pick an explicit time zone instead of being blocked', () => {
  const selected = {options:[],value:'',disabled:false};
  const code = countrySource + '\n' +
    section('  function applyCountryToTzOptions(', '  function applyUSStateToTzOptions(') +
    '\n({applyCountryToTzOptions})';
  const {applyCountryToTzOptions} = vm.runInNewContext(code, {
    Intl,
    ALL_TZ:['Asia/Kuala_Lumpur','Pacific/Pago_Pago'],
    $:() => selected,
    setSelectOptions:(el,choices,placeholder) => {
      el.options=[{value:'',label:placeholder},...choices.map(value=>({value}))];
      el.value='';
      el.disabled=choices.length === 0;
    }
  });
  applyCountryToTzOptions('말레이시아');
  assert.equal(selected.value, 'Asia/Kuala_Lumpur');
  applyCountryToTzOptions('아메리칸사모아');
  assert.equal(selected.value, 'Pacific/Pago_Pago');
  applyCountryToTzOptions('남극');
  assert.equal(selected.disabled, false);
  assert.equal(selected.value, '', 'Never auto-select arbitrary time zone');
  assert.ok(selected.options.some(x => x.value === 'Pacific/Pago_Pago'));
});

test('Later tablet courses share a single charging reminder across class, makeup, and trial guides', () => {
  const funcs = vm.runInNewContext(guideSource +
    '\n({buildDrawingDeviceLine,buildParticipationGuide,buildSimpleParticipationGuide,buildTrialParticipationGuide})', {
      DRAWING_DEVICE_COURSES:['[DRAWING] BASIC','[DRAWING] PRO','[DRAWING] BOOK']
    });
  for (const device of ['IPAD','GALAXY']) {
    assert.equal(funcs.buildDrawingDeviceLine('[DRAWING] PRO',device),'사전 펜슬/패드 충전 필수');
    assert.match(funcs.buildParticipationGuide('[DRAWING] PRO','해당없음',device),/• 사전 펜슬\/패드 충전 필수/);
    assert.match(funcs.buildSimpleParticipationGuide(device,'[DRAWING] PRO','해당없음',device),/• 사전 펜슬\/패드 충전 필수/);
    assert.match(funcs.buildTrialParticipationGuide(device,'[DRAWING] BOOK','해당없음',device),/• 사전 펜슬\/패드 충전 필수/);
  }
  assert.equal(funcs.buildDrawingDeviceLine('[DRAWING] BASIC','IPAD'),'앱 다운로드 및 아이패드와 애플 펜슬 충전 필수');
  assert.equal(funcs.buildDrawingDeviceLine('[DRAWING] BASIC','GALAXY'),'앱 다운로드 및 갤럭시 탭과 S펜 충전 필수');
});

test('Picture book editor notice shows editor only while retaining Monday curriculum code', () => {
  assert.match(html, /"\[PICTURE BOOK\] EDITOR"\s*:\s*"에디터"/);
  assert.match(html, /"\[PICTURE BOOK\] EDITOR":"Editor"/);
  assert.doesNotMatch(html, /"\[PICTURE BOOK\] EDITOR": "픽처북 에디터"/);
});

test('US states are displayed in Korean alphabetical order without changing IANA mapping',()=>{
 const usSource=section('  const US_STATES = [','  const AU_REGIONS = [');
 const states=vm.runInNewContext(usSource+'\nUS_STATES',{Intl});
 const options=[];
 const sel={innerHTML:'',appendChild(opt){options.push(opt);}};
 const nodeFactory=()=>({value:'',textContent:''});
 const initSource=section('  function initUsStateSelect(){','  function initAuStateSelect(){');
 const fn=vm.runInNewContext(initSource+'\ninitUsStateSelect',{
  US_STATES:states,$:()=>sel,Intl,document:{createElement:nodeFactory}
 });
 fn();
 const labels=options.slice(1).map(x=>x.textContent);
 const sorted=[...labels].sort((a,b)=>a.localeCompare(b,'ko'));
 assert.deepEqual(labels,sorted);
 const california=options.find(x=>x.value==='California');
 assert.match(california.textContent,/캘리포니아주/);
 assert.equal(states.find(x=>x.name==='California').tzOptions[0],'America/Los_Angeles');
});
