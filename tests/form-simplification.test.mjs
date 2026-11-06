import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const inline=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inline,'Inline app code exists');
new vm.Script(inline);

test('Student DB first; grouped notices move below message and are group-only',()=>{
 const search=html.indexOf('id="studentSearchQuery"');
 const category=html.indexOf('id="messageType"');
 const name=html.indexOf('id="studentName"');
 const output=html.indexOf('id="output"');
 const group=html.indexOf('id="groupNoticeBox"');
 assert.ok(search<category && category<name,'Student search should be first');
 assert.ok(group>output,'Group recipient belongs below generated message');
 assert.match(html,/id="groupNoticeBox" hidden/);
 assert.match(inline,/\$\("groupNoticeBox"\)\.hidden=\$\("classType"\)\.value!=="GROUP"/);
 assert.match(inline,/\$\("studentName"\)\.value=name;/);
});

test('Only iPad/Galaxy show Discord, and makeup/supplement hide unused fields',()=>{
 assert.match(html,/id="discordField" hidden/);
 assert.match(inline,/device==="IPAD" \|\| device==="GALAXY"/);
 assert.match(inline,/\$\("discordField"\)\.hidden=!visible/);
 for(const id of ['endDayField','lessonCountField','expectedEndField'])
  assert.ok(html.includes('id="'+id+'"'));
 for(const id of ['endDayField','lessonCountField','expectedEndField'])
  assert.ok(inline.includes('$("'+id+'").hidden=isSingle'));
 assert.match(inline,/\$\("endDay"\)\.disabled=isSingle/);
});

test('Help content is opt-in, holidays are collapsed and generated notices are unchanged',()=>{
 for(const title of ['메시지 종류 안내','클래스 구분 안내','서머타임 옵션 설명',
   '한국 기준 휴강 날짜 안내','공휴일 자동 적용 안내','날짜별 메모 안내'])
  assert.ok(html.includes('aria-label="'+title+'"'),title);
 assert.match(html,/<details class="folded-section" id="holidaySection">/);
 assert.doesNotMatch(html,/<details class="folded-section" id="holidaySection" open/);
 assert.ok(html.indexOf('id="closedPreview"') < html.indexOf('id="curriculumSelect"'));
 assert.doesNotMatch(html,/id="registrationPreview"[^>]*hidden/);
 assert.match(inline,/const incomplete=.*선택해 주세요/);
 assert.match(inline,/preview\.classList\.toggle\("pending",incomplete\)/);
});

test('Holidays auto-load from complete schedule; exceptions apply only on Update',()=>{
 assert.match(html,/id="holidayAutoStatus"/);
 assert.match(html,/id="addSelectedHolidays"[^>]*>휴강일 업데이트/);
 assert.match(inline,/function queueAutoHolidayLookup\(\)/);
 assert.match(inline,/function autoLoadHolidays\(\)/);
 assert.match(inline,/queueAutoHolidayLookup\(\);/);
 assert.match(inline,/selectedFetchedHolidayDates=new Set\(available/);
 assert.match(inline,/selectedFetchedHolidayDates=new Set\(pendingFetchedHolidayDates\)/);
 assert.match(inline,/excludedFetchedHolidayDates\.add\(holiday\.date\)/);
 assert.match(inline,/getVisibleFetchedHolidayEntries\(\)/);
 assert.match(inline,/generation!==holidayFetchGeneration/);
 assert.match(inline,/if\(currentKey!==key\)return/);
 assert.match(inline,/checkbox\.checked=pendingFetchedHolidayDates\.has\(holiday\.date\)/);
 assert.ok(inline.includes('$(id).addEventListener("input",queueAutoHolidayLookup)'));
});

test('DB-unlinked Monday creation requires explicit real user confirmation',()=>{
 assert.match(inline,/const allowUnlinkedStudent=studentIds\.length===0/);
 assert.match(inline,/window\.confirm\(/);
 assert.match(inline,/if\(!approved\)/);
 assert.match(inline,/allowUnlinkedStudent,/);
 assert.match(inline,/studentNotices:isBatch/);
 assert.match(inline,/message:isBatch\?combinedStudentNoticeText\(\):\$\("output"\)\.value/);
});
