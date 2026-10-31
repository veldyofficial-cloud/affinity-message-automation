// Actual board/column/group IDs confirmed read-only on 2026-10-31.
// Edit only after inspecting the current board schema in monday.com.
export const BOARD_ID = 1888467610;
export const STUDENT_DB_ID = 1879266175;
export const GROUP_IDS = Object.freeze({
  '월': 'new_group29179',
  '화': 'new_group43041',
  '수': '______1',
  '목': '____68__1',
  '금': '____52115__1',
  '토': '____28887__1',
});
export const COL = Object.freeze({
  type: 'color_mm2zqs4',
  time: 'hour',
  duration: 'color_mm07m65v',
  device: 'color_mm2zrwb9',
  domesticOrOverseas: 'color_mm08w8s9',
  teacher: 'project_owner',
  studentRelation: 'board_relation_mkss72aq',
  subDate: 'date65',
  subMinutes: 'color_mm00mmcy',
  subAttendance: 'numeric_mm01zfhb',
  subAbsentees: 'board_relation_mm4cpb0k',
});

export function json(body, status=200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function allowedOrigin(request) {
  // Same-origin UI and API on a GitHub-connected Vercel deployment.
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return true; // CLI/non-browser requests still need auth.
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function monday(query, variables={}, env={}) {
  const token = env.MONDAY_API_TOKEN;
  if (!token) throw new Error('MONDAY_API_TOKEN 서버 환경 변수가 설정되지 않았습니다.');
  const response = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json', 'API-Version': '2026-07' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(25000),
  });
  let body;
  try { body = await response.json(); } catch { throw new Error(`먼데이 API 응답 오류 (HTTP ${response.status})`); }
  if (!response.ok || body.errors?.length || body.error_message) {
    const msg = body.errors?.map(e=>e.message).join('; ') || body.error_message || `HTTP ${response.status}`;
    throw new Error(`먼데이 API 오류: ${msg}`);
  }
  return body.data;
}

export async function allStudentItems(env, limitPages=6) {
  const first = await monday(`query ($boardId: [ID!]) {
    boards(ids: $boardId) { items_page(limit: 500) { cursor items { id name } } }
  }`, {boardId:[String(STUDENT_DB_ID)]}, env);
  let page = first.boards?.[0]?.items_page;
  if (!page) throw new Error('STUDENT DB를 읽을 수 없습니다.');
  const items = [...(page.items || [])];
  let pageCount = 1;
  while(page.cursor && pageCount < limitPages) {
    const next = await monday(`query ($cursor: String!) {
      next_items_page(cursor: $cursor, limit: 500) { cursor items { id name } }
    }`, {cursor: page.cursor}, env);
    page = next.next_items_page;
    if (!page) break;
    items.push(...(page.items || []));
    pageCount += 1;
  }
  if(page?.cursor) throw new Error('STUDENT DB가 조회 한도를 초과했습니다. 검색 구현을 확장해 주세요.');
  return items;
}

const DAY = {'일':0,'월':1,'화':2,'수':3,'목':4,'금':5,'토':6};
export function dateFromISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(s)) throw new Error('잘못된 날짜 형식입니다.');
  const d = new Date(`${s}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== s) throw new Error('유효하지 않은 날짜입니다.');
  return d;
}
export function addDays(d, count) {const x=new Date(d.getTime());x.setUTCDate(x.getUTCDate()+count);return x;}
export function iso(d) {return d.toISOString().slice(0,10);}

export function derivePlan(input) {
  if (input.messageType !== 'CLASS') throw new Error('정규 클래스만 자동 등록할 수 있습니다.');
  const groupId = GROUP_IDS[input.weekday];
  if (!groupId) throw new Error('선택한 요일에 해당하는 Infohub 그룹이 없습니다.');
  const start = dateFromISO(input.startDay);
  const end = dateFromISO(input.endDay);
  if (start > end) throw new Error('종료일은 시작일보다 이전일 수 없습니다.');
  if ((end-start)/(24*60*60*1000) > 366) throw new Error('1년을 초과하는 일정은 자동 등록하지 않습니다.');
  if (!input.kstTime24 || !Number.isInteger(input.kstTime24.hh) || !Number.isInteger(input.kstTime24.mm)
      || input.kstTime24.hh < 0 || input.kstTime24.hh > 23
      || input.kstTime24.mm < 0 || input.kstTime24.mm > 59) {
    throw new Error('한국시간 값이 올바르지 않습니다.');
  }
  if (!['ONE_ON_ONE','GROUP'].includes(input.classType)) throw new Error('수업 유형이 올바르지 않습니다.');
  if (!['PC','DIGITAL_DRAWING'].includes(input.templateType)) throw new Error('기기 유형이 올바르지 않습니다.');
  if (!['DOMESTIC','OVERSEAS'].includes(input.studentLocation)) throw new Error('국내/해외 설정 오류입니다.');
  if (input.studentLocation==='OVERSEAS' && input.dstMode==='TEACHER_CHANGE') {
    throw new Error('강사 한국시간이 바뀌는 DST 모드는 Infohub TIME 한 칸으로 정확히 표현할 수 없어 자동 등록을 막습니다.');
  }
  const closures = new Map();
  for (const x of input.closures || []) {
    const d = dateFromISO(x.date);
    if (d<start || d>end || d.getUTCDay()!==DAY[input.weekday]) {
      throw new Error(`휴강일 ${x.date}이 클래스 일정 밖에 있습니다.`);
    }
    if (closures.has(x.date)) throw new Error(`중복 휴강일: ${x.date}`);
    const reason = String(x.name||'휴강').trim().slice(0,100);
    closures.set(x.date,reason||'휴강');
  }
  let cursor = new Date(start.getTime());
  while(cursor.getUTCDay()!==DAY[input.weekday]) cursor = addDays(cursor,1);
  const schedule = [];
  let lessonNo=0;
  while(cursor <= end){
    const date=iso(cursor);
    if(closures.has(date)) {
      const reason = closures.get(date);
      const name=reason==='수강생 요청 휴강' ? '수강생 요청 휴강' :
        reason.endsWith('휴강') ? reason : `${reason} 휴강`;
      schedule.push({date,kind:'CLOSED',name,reason});
    }else {
      lessonNo+=1;
      schedule.push({date,kind:'LESSON',name:`LESSON ${String(lessonNo).padStart(2,'0')}`});
    }
    cursor=addDays(cursor,7);
  }
  if (!schedule.length) throw new Error('수업 기간에 해당 요일이 없습니다.');
  if (schedule.length > 32) throw new Error('하위아이템 32건을 초과하는 일정은 무료 서버에서 자동 등록하지 않습니다.');
  if (input.explicitLessonCount && Number(input.explicitLessonCount)!==lessonNo) {
    throw new Error(`입력 회차(${input.explicitLessonCount})와 실제 회차(${lessonNo})가 다릅니다.`);
  }
  if (Number(input.lessonCount)!==lessonNo) throw new Error('프론트엔드의 수업 회차 계산과 서버 결과가 다릅니다.');
  const client = Array.isArray(input.schedule) ? input.schedule.map(({date,kind,name})=>({date,kind,name})) : [];
  const server = schedule.map(({date,kind,name})=>({date,kind,name}));
  if(JSON.stringify(client)!==JSON.stringify(server)) throw new Error('승인 일정이 서버 검증 결과와 다릅니다. 문구를 다시 생성해 주세요.');
  return {groupId,schedule,lessonCount:lessonNo,holidayCount:schedule.length-lessonNo};
}

export function htmlEscape(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
