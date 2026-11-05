import { allowedOrigin, allStudentItems, BOARD_ID, STUDENT_DB_ID, COL, derivePlan, infohubDstLabel, infohubItemName, htmlEscape, json, monday } from './monday.js';
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
  let parentCreatedAt=0;
  try {
    const p=await request.json();
    if (!p || typeof p!=='object') throw new Error('승인 요청이 올바르지 않습니다.');
    if (!p.itemName || typeof p.itemName!=='string' || p.itemName.length>255 || !p.itemName.trim()) throw new Error('상위아이템명이 올바르지 않습니다.');
    const studentIds=Array.isArray(p.studentIds) ? Array.from(new Set(p.studentIds.map(Number))) : [];
    if (!studentIds.length || studentIds.length>20 || !studentIds.every(validId)) throw new Error('학생을 검색 결과에서 선택해 주세요.');
    if (p.classType==='ONE_ON_ONE' && studentIds.length!==1) throw new Error('1:1 클래스는 학생 한 명만 연결해야 합니다.');
    if (p.classType==='GROUP' && studentIds.length<2) throw new Error('그룹 클래스는 학생 두 명 이상이 필요합니다.');
    // A group is one parent and one combined update containing the completed
    // private notice for every linked pupil. Reject incomplete or stale batches
    // before the very first Monday write.
    let noticeText='';
    const groupBatch=p.classType==='GROUP' && (p.messageType==='CLASS'||p.messageType==='TRIAL');
    if(groupBatch){
      if(!Array.isArray(p.studentNotices) || p.studentNotices.length!==studentIds.length)
        throw new Error('그룹 수강생 전원의 학생별 안내문을 먼저 저장해 주세요.');
      const noticeIds=new Set();
      const notices=[];
      for(const row of p.studentNotices){
        if(!row || !validId(Number(row.studentId)) || !studentIds.includes(Number(row.studentId))
            || noticeIds.has(Number(row.studentId)) || typeof row.name!=='string' ||
            !row.name.trim() || typeof row.message!=='string' || row.message.length<20 || row.message.length>15000)
          throw new Error('학생별 안내문에 누락·중복 또는 형식 오류가 있습니다.');
        noticeIds.add(Number(row.studentId));
        notices.push({studentId:Number(row.studentId),name:row.name.trim(),message:row.message});
      }
      if(notices.some(row=>!studentIds.includes(row.studentId)))throw new Error('연결되지 않은 학생의 안내문이 포함되었습니다.');
      noticeText=notices.map((row,i)=>'[학생별 안내 '+(i+1)+' | '+row.name+']\n'+row.message.trim()).join('\n\n------------------------------\n\n');
      if(noticeText.length>50000)throw new Error('학생별 안내문 전체가 50,000자를 초과합니다.');
    }else{
      if (!p.message || typeof p.message!=='string' || p.message.length>50000 || p.message.length<20)
        throw new Error('안내문을 먼저 생성해 주세요.');
      noticeText=p.message;
    }
    if (!validId(Number(p.teacherId)) || !isAllowedTeacher(p.teacherId)) throw new Error('승인된 강사 13명 중에서 담당 강사를 선택해 주세요.');
    const plan=derivePlan(p);
    // Use the Korean (KST) start date regardless of the student's timezone.
    // Canonicalize before reserve/create so the same course cannot be saved
    // twice under differently-prefixed names.
    const parentName=infohubItemName(p.itemName,p.startDay);
    const dstLabel=infohubDstLabel(p);
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
    // Ensure time annotation does not overflow the Monday MEMO column after a
    // parent has been created. Validate this before the first write.
    if(Number(p.weeklyFrequency)>1){
      const maxMemo=1470;
      if(p.subMemo.length>maxMemo || detailMemos.some(row=>row.memo.length>maxMemo)){
        throw new Error('주 2~3회 수업은 하위 메모를 1470자 이내로 입력해 주세요.');
      }
    }
    const kind=p.messageType==='MAKEUP_40'?'보강':p.messageType==='MAKEUP_30'?'보충':p.messageType==='TRIAL'?'TRIAL':'CLASS';
    const expectedName=(kind==='CLASS'||kind==='TRIAL') ? '' :
      ' | LESSON '+String(Number(p.makeupLessonNumber)).padStart(2,'0')+' '+kind;
    if(kind==='TRIAL' && !/\bTRIAL\s*🚀\s*$/.test(p.itemName)) throw new Error('트라이얼 제목에는 TRIAL 🚀 표시가 필요합니다.');
    if(expectedName && !p.itemName.endsWith(expectedName)) throw new Error('보강/보충 상위아이템 제목의 LESSON 회차를 확인해 주세요.');
    const records=await monday(`query ($ids:[ID!]) {items(ids:$ids) { id name board { id } column_values(ids:["text_mksvtgc8"]) { id text } }}`,
      {ids:studentIds.map(String)},env);
    if ((records.items||[]).length!==studentIds.length || records.items.some(x=>String(x.board?.id)!==String(STUDENT_DB_ID)))
      throw new Error('STUDENT DB에 속하지 않는 학생이 포함되었습니다.');
    if(groupBatch && p.studentNotices.some(row=>{
      const item=records.items.find(x=>Number(x.id)===Number(row.studentId));
      return !item || item.name.trim()!==row.name.trim();
    }))throw new Error('학생별 안내문의 이름이 STUDENT DB 이름과 다릅니다.');
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
    // Single source of truth: upper PC/IPAD/GALAXY choice -> Monday device label.
    const device=p.templateType;
    if (!['PC','IPAD','GALAXY'].includes(device)) {
      throw new Error('상단 클래스 구분에서 PC / IPAD / GALAXY 중 하나를 선택해 주세요.');
    }

    // Verify the optional dedicated comment writer before changing any live board data.
    const updateToken=String(env.MONDAY_UPDATE_API_TOKEN||'').trim();
    let updateAuthor=null;
    if(updateToken){
      const author=await monday('query ($ids:[ID!]) { me {id name email} boards(ids:$ids){id} }',
        {ids:[String(BOARD_ID)]},env,updateToken);
      if(String(author.me?.email||'').trim().toLowerCase()!=='affinityuniverse.flow@gmail.com')
        throw new Error('말풍선 작성 계정은 affinityuniverse.flow@gmail.com 이어야 합니다.');
      if(!(author.boards||[]).some(b=>String(b.id)===String(BOARD_ID)))
        throw new Error('어피니티 플로우 계정에 Infohub 접근 권한이 없습니다.');
      updateAuthor=String(author.me.name||'AFFINITY FLOW');
    }
    // Use canonical server-checked fields for duplicate detection, not the browser's random approvalId.
    registryKey=await fingerprint({board:BOARD_ID,group:plan.groupId,
      itemName:parentName,studentIds:studentIds.slice().sort((a,b)=>a-b),
      teacherId:Number(p.teacherId),device,duration, language:p.language,kind,emailText,subMemo:p.subMemo,subMemos:detailMemos,
      time:p.kstTime24,secondTime:p.kstTime24Second||null,thirdTime:p.kstTime24Third||null,
      weekday2:p.weekday2||'',weekday3:p.weekday3||'',weeklyFrequency:Number(p.weeklyFrequency||1),
      classType2:p.classType2||null,classType3:p.classType3||null,
      dstMode2:p.dstMode2||null,dstMode3:p.dstMode3||null,
      schedule:plan.schedule.map(x=>({date:x.date,kind:x.kind,name:x.name,absentStudentIds:x.absentStudentIds||[],
        durationMinutes:x.durationMinutes||null,keepGroupDuration:Boolean(x.keepGroupDuration)})),
      noticeText});
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
      [COL.domesticOrOverseas]:{label:dstLabel},
      [COL.teacher]:{personsAndTeams:[{id:Number(p.teacherId),kind:'person'}]},
      [COL.studentRelation]:{item_ids:studentIds},
    };
    attemptedWrite=true;
    const created=await monday(`mutation ($boardId:ID!, $groupId:String!, $name:String!, $values:JSON!) {
      create_item(board_id:$boardId,group_id:$groupId,item_name:$name,column_values:$values) {id url}
    }`,{boardId:String(BOARD_ID),groupId:plan.groupId,name:parentName,values:JSON.stringify(parentColumns)},env);
    parentId=created.create_item?.id||'';
    parentCreatedAt=Date.now();
    itemUrl=created.create_item?.url||`https://veldyofficials-team.monday.com/boards/${BOARD_ID}/pulses/${parentId}`;
    if (!parentId) throw new Error('상위아이템 ID를 확인할 수 없습니다.');

    for (const row of plan.schedule) {
      const targetDay=row.date && new Date(row.date+'T00:00:00Z').getUTCDay();
      const weekDayNumbers={일:0,월:1,화:2,수:3,목:4,금:5,토:6};
      const isSecondDay=Number(p.weeklyFrequency)>=2 && targetDay===weekDayNumbers[p.weekday2];
      const isThirdDay=Number(p.weeklyFrequency)===3 && targetDay===weekDayNumbers[p.weekday3];
      // Parent TIME is the first-day time; append each lesson's exact KST
      // to the subitem memo so no second-day time is lost in Infohub.
      const sessionTime=isThirdDay?p.kstTime24Third:isSecondDay?p.kstTime24Second:p.kstTime24;
      const sessionType=plan.classTypeByDay?.[targetDay]||p.classType;
      const sessionDuration=row.durationMinutes ? row.durationMinutes+'m' : sessionType==='GROUP'?'60m':'40m';
      const hasMixedTypes=Object.values(plan.classTypeByDay||{}).some(type=>type!==p.classType);
      const sessionTypeNote=hasMixedTypes
        ? '수업 구분: '+(sessionType==='GROUP'?'그룹 (1h)':'1:1 (40m)') : '';
      const attendanceNote=row.kind==='LESSON' && sessionType==='GROUP'
        && (row.absentStudentIds||[]).length && studentIds.length-row.absentStudentIds.length===1
        ? row.keepGroupDuration?'별도 요청: 그룹 60분 유지':'출석 1명: 1:1 40분 자동 전환' : '';
      const kstNote=Number(p.weeklyFrequency)>1
        ? '수업 시간: '+String(sessionTime.hh).padStart(2,'0')+':'+String(sessionTime.mm).padStart(2,'0')+' (한국시간)'
        : '';
      const writtenMemo=memoByDate.get(row.date)||p.subMemo.trim();
      const mergedMemo=[writtenMemo,kstNote,sessionTypeNote,attendanceNote].filter(Boolean).join('\n');
      if(mergedMemo.length>1500) throw new Error('수업 시간 포함 하위아이템 메모가 1500자를 초과합니다.');
      const columns={
        [COL.subDate]:{date:row.date},
        [COL.subMinutes]:{label:row.kind==='CLOSED'?'휴강':sessionDuration},
        // Individual absence is attached to its LESSON, not an extra holiday.
        [COL.subAttendance]:String(row.kind==='CLOSED'?0:studentIds.length-(row.absentStudentIds||[]).length),
        ...(mergedMemo?{[COL.subMemo]:mergedMemo}:{}),
        ...(row.kind==='LESSON' && row.absentStudentIds?.length
          ? {[COL.subAbsentees]:{item_ids:row.absentStudentIds}} : {}),
      };
      await monday(`mutation ($parentId:ID!, $name:String!, $values:JSON!) {
        create_subitem(parent_item_id:$parentId,item_name:$name,column_values:$values) {id}
      }`,{parentId:String(parentId),name:row.name,values:JSON.stringify(columns)},env);
      completed+=1;
    }
    const body=`<div>${htmlEscape(noticeText).replace(/\r?\n/g,'<br>')}</div>`;
    const posted=await monday(`mutation ($itemId:ID!, $body:String!) {
      create_update(item_id:$itemId,body:$body){id creator{id name}}
    }`,{itemId:String(parentId),body},env,updateToken||undefined);
    if(!posted.create_update?.id) throw new Error('말풍선 등록 결과를 확인할 수 없습니다.');
    if(updateToken)updateAuthor=String(posted.create_update.creator?.name||updateAuthor);

    // Live Infohub workflow 1939876933 currently clears the '기기' column
    // after create_item, even when the API created the parent with IPAD/GALAXY.
    // Only reassert the exact validated device after that automation's usual
    // completion window. This does NOT alter any other parent columns, student
    // links, subitems, comments or workflow configuration.
    //
    // Remove the 'Clear column value: 기기' step from the Monday workflow to
    // eliminate this wait and the underlying race. Until then, fail closed
    // if the final persisted device does not match the instructor's choice.
    const configuredGrace = Number(env.DEVICE_CLEAR_GRACE_MS);
    const deviceGraceMs = Number.isFinite(configuredGrace) && configuredGrace >= 0
      ? Math.min(30000,configuredGrace) : 20000;
    const remainingGraceMs = Math.max(0,deviceGraceMs-(Date.now()-parentCreatedAt));
    if (remainingGraceMs) await new Promise(resolve=>setTimeout(resolve,remainingGraceMs));

    const restored=await monday(`mutation ($boardId:ID!, $itemId:ID!, $values:JSON!) {
      change_multiple_column_values(board_id:$boardId,item_id:$itemId,column_values:$values) {id}
    }`,{
      boardId:String(BOARD_ID),itemId:String(parentId),
      values:JSON.stringify({[COL.device]:{label:device}}),
    },env);
    if(String(restored.change_multiple_column_values?.id||'')!==String(parentId)) {
      throw new Error('기기 라벨 재적용 결과의 아이템 ID가 일치하지 않습니다.');
    }
    let persistedDevice='';
    for(let check=0;check<3;check++){
      const state=await monday(`query ($ids:[ID!]) {
        items(ids:$ids) {id column_values(ids:["color_mm2zrwb9"]){id text}}
      }`,{ids:[String(parentId)]},env);
      persistedDevice=String(state.items?.[0]?.column_values?.find(v=>v.id===COL.device)?.text||'').trim();
      if(persistedDevice===device)break;
      if(check<2) await new Promise(resolve=>setTimeout(resolve,1000));
    }
    if(persistedDevice!==device) {
      throw new Error(`먼데이 기기 라벨 검증 실패: 선택값 ${device}, 저장값 ${persistedDevice||'미설정'}. 신규 아이템 생성 시 기기 컬럼을 초기화하는 먼데이 자동화를 확인해 주세요.`);
    }

    await storage.finish(registryKey,'complete',{itemUrl,parentId,lessons:plan.lessonCount,holidays:plan.holidayCount,absenceLessons:plan.absenceLessons,device,by:email});
    return json({ok:true,parentId,itemUrl,lessons:plan.lessonCount,holidays:plan.holidayCount,absenceLessons:plan.absenceLessons,device,dstLabel,updateAuthor,parentName});
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
