'use strict';
const feedback=document.getElementById('feedback');
const email=document.getElementById('email');
const button=document.getElementById('enrollBtn');
(async()=>{
  try {
    const res=await fetch('/api/auth/status',{credentials:'same-origin',cache:'no-store'});
    const data=await res.json();
    if(!res.ok || !data.ok) throw new Error('로그인 정보를 확인하지 못했습니다.');
    if(data.role==='admin'||data.role==='instructor') {location.replace('/');return;}
    email.textContent=data.email;
    if(!data.enrollmentEnabled) throw new Error('운영팀이 강사용 초대 등록을 아직 활성화하지 않았습니다.');
  }catch(err){feedback.textContent=err.message;button.disabled=true;}
})();
document.getElementById('enrollForm').addEventListener('submit',async(ev)=>{
  ev.preventDefault();
  button.disabled=true;
  feedback.textContent='등록을 확인하고 있습니다.';
  try {
    const code=document.getElementById('inviteCode').value.trim();
    const res=await fetch('/api/auth/enroll',{
      method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})
    });
    const data=await res.json();
    document.getElementById('inviteCode').value='';
    if(!res.ok||!data.ok) throw new Error(data.error||'등록할 수 없습니다.');
    feedback.style.color='#156b40';
    feedback.textContent='등록 완료! 프로그램으로 이동합니다.';
    location.replace('/');
  }catch(err){feedback.style.color='#b91c1c';feedback.textContent=err.message;button.disabled=false;}
});
