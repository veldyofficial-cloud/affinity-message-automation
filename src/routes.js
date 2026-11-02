import { allowedOrigin, allStudentItems, BOARD_ID, STUDENT_DB_ID, COL, derivePlan, htmlEscape, json, monday } from './monday.js';
import {TEACHERS, isAllowedTeacher, teacherById} from './teachers.js';
const validId = value => Number.isSafeInteger(value) && value > 0;

export async function lookup(request, env) {
  if (!allowedOrigin(request)) return json({ok:false,error:'허용되지 않은 웹사이트입니다.'},403);
  if (!env.MONDAY_API_TOKEN) return json({ok:false,error:'먼데이 API 서버 인증이 설정되지 않았습니다.'},503);
  try {
    const input = await request.json();
    const q = String(input.query||'').trim().toLowerCase();
    if (q.length < 2 || q.length > 100) return json({ok:false,error:'학생 이름은 2~100자로 입력하세요.'},400);
    const students = await allStudentItems(env);
    const found = students.filter(x=>x.name.toLocaleLowerCase().includes(q)).slice(0,30);
    return json({ok:true,students:found.map(x=>({id:x.id,name:x.name})),teachers:TEACHERS});
  }catch(err) {return json({ok:false,error:`학생/강사 조회 실패: ${err.message}`},502);}
}
async function fingerprint(value) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

export async function approve(request, env, email) {
  if (!allowedOrigin(request)) return json({ok:false,error:'허용되지 않은 웹사이트입니다.'},403);
  if (!env.MONDAY_API_TOKEN) return json({ok:false,error:'먼데이 API 서버 인증이 설정되지 않았습니다.'},503);
  if (!env.REGISTRY) return json({ok:false,error:'중복 승인 방지 저장소가 설정되지 않았습니다.'},503);
  let parentId='';
  let itemUrl='';
  let attemptedWrite=false;
  let registryKey='';
  let reserved=false;
  let completed=0;
  try {
    const p=await request.json();
    if (!p || typeof p!=='object') throw new Error('승인 요청이 올바르지 않습니다.');
    if (!p.itemName || typeof p.itemName!=='string' || p.itemName.length>255 || !p.itemName.trim()) throw new Error('상위아이템명이 올바르지 않습니다.');
    if (!p.message || typeof p.message!=='string' || p.message.length>50000 || p.message.length<20) throw new Error('안내문을 먼저 생성해 주세요.');
    const studentIds=Array.isArray(p.studentIds) ? Array.from(new Set(p.studentIds.map(Number))) : [];
    if (!studentIds.length || studentIds.length>20 || !studentIds.every(validId)) throw new Error('학생을 검색 결과에서 선택해 주세요.');
    if (p.classType==='ONE_ON_ONE' && studentIds.length!==1) throw new Error('1:1 클래스는 학생 한 명만 연결해야 합니다.');
    if (p.classType==='GROUP' && studentIds.length<2) throw new Error('그룹 클래스는 학생 두 명 이상이 필요합니다.');
    if (!validId(Number(p.teacherId)) || !isAllowedTeacher(p.teacherId)) throw new Error('승인된 강사 13명 중에서 담당 강사를 선택해 주세요.');
    const plan=derivePlan(p);
    p.language=p.language||'KR';
    if(!['KR','ENG'].includes(p.language)) throw new Error('상위아이템 언어는 KR 또는 ENG를 선택해 주세요.');
    p.subMemo=p.subMemo||'';
    if(typeof p.subMemo!=='string' || p.subMemo.length>1500) throw new Error('하위아이템 메모는 1500자 이내로 입력해 주세요.');
    const detailMemos=Array.isArray(p.subMemos)?p.subMemos:[];
    if(detailMemos.some(row=>!row || typeof row.date!=='string' || typeof row.memo!=='string' || row.memo.length>1500)) {
      throw new Error('날짜별 메모 형식을 확인해 주세요.');
    }
    if(detailMemos.some(row=>!plan.schedule.some(item=>item.date===row.date)) ||
       new Set(detailMemos.map(row=>row.date)).size!==detailMemos.length)
      throw new Error('메모 날짜가 수업 일정과 일치하지 않거나 중복되었습니다.');
    const memoByDate=new Map(detailMemos.map(row=>[row.date,row.memo.trim()]));
    const kind=p.messageType==='MAKEUP_40'?'보강':p.messageType==='MAKEUP_30'?'보충':p.messageType==='TRIAL'?'TRIAL':'CLASS';
    const expectedName=(kind==='CLASS'||kind==='TRIAL') ? '' :
      ' | LESSON '+String(Number(p.makeupLessonNumber)).padStart(2,'0')+' '+kind;
    if(kind==='TRIAL' && !/\bTRIAL\s*🚀\s*$/.test(p.itemName)) throw new Error('트라이얼 제목에는 TRIAL 🚀 표시가 필요합니다.');
    if(expectedName && !p.itemName.endsWith(expectedName)) throw new Error('보강/보충 상위아이템 제목의 LESSON 회차를 확인해 주세요.');
    const records=await monday(`query ($ids:[ID!]) {items(ids:$ids) { id name board { id } column_values(ids:["text_mksvtgc8"]) { id text } }}`,
      {ids:studentIds.map(String)},env);
    if ((records.items||[]).length!==studentIds.length || records.items.some(x=>String(x.board?.id)!==String(STUDENT_DB_ID)))
      throw new Error('STUDENT DB에 속하지 않는 학생이 포함되었습니다.');
    const users=await monday('query ($ids:[ID!]) { users(ids:$ids) { id name } }',
      {ids:[String(p.teacherId)]},env);
    if ((users.users||[]).length!==1 || String(users.users[0].name||'').trim().toUpperCase()!==teacherById.get(Number(p.teacherId)).name)
      throw new Error('담당 강사 계정 정보가 목록과 일치하지 않습니다. 관리자에게 문의해 주세요.');
    const duration=p.classType==='GROUP'?'60m':'40m';
    const studentEmails=studentIds.map(id=>{
      const student=records.items.find(item=>Number(item.id)===id);
      const email=String(student?.column_values?.find(col=>col.id===COL.studentEmail)?.text||'').trim();
      if(p.templateType==='PC' && (!email || !/^[^\s@;]+@[^\s@;]+\.[^\s@;]+$/.test(email))) {
        throw new Error(`PC 수강생 ${student?.name||id}의 STUDENT DB EMAIL을 확인해 주세요.`);
      }
      return email;
    }).filter(Boolean);
    const emailText=p.templateType==='PC'?[...new Set(studentEmails)].join(';'):'';
    if(emailText.length>3000)throw new Error('연결된 이메일이 너무 깁니다.');
    const device = p.templateType === 'PC' ? 'PC' :
      p.templateType === 'DIGITAL_DRAWING' && p.deviceType === '아이패드' ? 'IPAD' :
      p.templateType === 'DIGITAL_DRAWING' && p.deviceType === '갤탭' ? 'GALAXY' : null;
    if (!device) throw new Error('선택한 클래스 구분과 기기를 확인해 주세요.');

    // Use canonical server-checked fields for duplicate detection, not the browser's random approvalId.
    registryKey=await fingerprint({board:BOARD_ID,group:plan.groupId,
      itemName:p.itemName.trim(),studentIds:studentIds.slice().sort((a,b)=>a-b),
      teacherId:Number(p.teacherId),device,duration, language:p.language,kind,emailText,subMemo:p.subMemo,subMemos:detailMemos, time:p.kstTime24,
      schedule:plan.schedule.map(x=>({date:x.date,kind:x.kind,name:x.name,absentStudentIds:x.absentStudentIds||[]}))});
    const storage=env.REGISTRY.get(env.REGISTRY.idFromName('affinity-infohub-approvals-v1'));
    const state=await storage.reserve(registryKey);
    if (!state.accepted) return json({ok:false,duplicate:true,itemUrl:state.itemUrl||'',
      error:state.state==='complete'?'동일한 클래스가 이미 먼데이에 등록되어 있습니다.':
        state.state==='pending'?'동일한 클래스 등록 요청이 처리 중입니다.':'이전 등록이 일부 진행되었을 수 있습니다. 관리자 확인 후 처리해 주세요.'},409);
    reserved=true;

    const parentColumns={
      [COL.type]:{label:p.classType==='GROUP'?'G':'1:1'},
      [COL.language]:{label:p.language},
      ...(kind==='CLASS'||kind==='TRIAL'?{}:{[COL.state]:{label:kind}}),
      ...(emailText?{[COL.email]:emailText}:{}),
      [COL.time]:{hour:p.kstTime24.hh,minute:p.kstTime24.mm},
      [COL.duration]:{label:duration},
      [COL.device]:{label:device},
      [COL.domesticOrOverseas]:{label:p.studentLocation==='OVERSEAS'?'🌐':'🇰🇷'},
      [COL.teacher]:{personsAndTeams:[{id:Number(p.teacherId),kind:'person'}]},
      [COL.studentRelation]:{item_ids:studentIds},
    };
    attemptedWrite=true;
    const created=await monday(`mutation ($boardId:ID!, $groupId:String!, $name:String!, $values:JSON!) {
      create_item(board_id:$boardId,group_id:$groupId,item_name:$name,column_values:$values) {id url}
    }`,{boardId:String(BOARD_ID),groupId:plan.groupId,name:p.itemName.trim(),values:JSON.stringify(parentColumns)},env);
    parentId=created.create_item?.id||'';
    itemUrl=created.create_item?.url||`https://veldyofficials-team.monday.com/boards/${BOARD_ID}/pulses/${parentId}`;
    if (!parentId) throw new Error('상위아이템 ID를 확인할 수 없습니다.');

    for (const row of plan.schedule) {
      const columns={
        [COL.subDate]:{date:row.date},
        [COL.subMinutes]:{label:row.kind==='CLOSED'?'휴강':duration},
        // Individual absence is attached to its LESSON, not an extra holiday.
        [COL.subAttendance]:String(row.kind==='CLOSED'?0:studentIds.length-(row.absentStudentIds||[]).length),
        ...((memoByDate.get(row.date)||p.subMemo.trim())?{[COL.subMemo]:memoByDate.get(row.date)||p.subMemo.trim()}:{}),
        ...(row.kind==='LESSON' && row.absentStudentIds?.length
          ? {[COL.subAbsentees]:{item_ids:row.absentStudentIds}} : {}),
      };
      await monday(`mutation ($parentId:ID!, $name:String!, $values:JSON!) {
        create_subitem(parent_item_id:$parentId,item_name:$name,column_values:$values) {id}
      }`,{parentId:String(parentId),name:row.name,values:JSON.stringify(columns)},env);
      completed+=1;
    }
    const body=`<div>${htmlEscape(p.message).replace(/\r?\n/g,'<br>')}</div>`;
    await monday(`mutation ($itemId:ID!, $body:String!) { create_update(item_id:$itemId,body:$body){id} }`,
      {itemId:String(parentId),body},env);
    await storage.finish(registryKey,'complete',{itemUrl,parentId,lessons:plan.lessonCount,holidays:plan.holidayCount,absenceLessons:plan.absenceLessons,by:email});
    return json({ok:true,parentId,itemUrl,lessons:plan.lessonCount,holidays:plan.holidayCount,absenceLessons:plan.absenceLessons});
  }catch(err) {
    // Do not retry automatically when a network error occurred after a write was attempted.
    if (reserved && registryKey) {
      const storage=env.REGISTRY.get(env.REGISTRY.idFromName('affinity-infohub-approvals-v1'));
      try {
        if (!attemptedWrite) await storage.release(registryKey);
        else await storage.finish(registryKey,'review',{itemUrl,parentId,completed,error:String(err.message).slice(0,240),by:email});
      } catch { /* Keep the pending reservation; never risk an automatic duplicate. */ }
    }
    const partial=attemptedWrite;
    return json({ok:false,partial,itemUrl,
      error:partial?`일부 등록되었을 수 있습니다. ${err.message} (중복 재전송 금지)`:
        `등록 전 검증 실패: ${err.message}`},partial?207:400);
  }
}
