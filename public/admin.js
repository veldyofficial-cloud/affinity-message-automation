'use strict';
const status=document.getElementById('status');
const tbody=document.getElementById('users');
async function load(){
  status.textContent='목록을 불러오고 있습니다.';
  tbody.replaceChildren();
  try{
    const res=await fetch('/api/admin/instructors',{credentials:'same-origin',cache:'no-store'});
    const data=await res.json();
    if(!res.ok||!data.ok)throw new Error(data.error||'강사 목록을 불러오지 못했습니다.');
    status.textContent=`등록된 강사 ${data.users.length}명`;
    for(const user of data.users){
      const tr=document.createElement('tr');
      const email=document.createElement('td');email.textContent=user.email;
      const current=document.createElement('td');current.textContent=user.active?'이용 가능':'차단됨';
      const created=document.createElement('td');created.textContent=user.enrolledAt?.slice(0,10)||'-';
      const actions=document.createElement('td');
      const btn=document.createElement('button');
      btn.textContent=user.active?'이용 차단':'이용 복구';
      if(user.active)btn.className='danger';
      btn.addEventListener('click',async()=>{
        if(!confirm(`${user.email} 계정을 ${user.active?'차단':'복구'}할까요?`))return;
        btn.disabled=true;
        try {
          const res=await fetch('/api/admin/instructors',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.email,active:!user.active})});
          const result=await res.json();
          if(!res.ok||!result.ok)throw new Error(result.error||'변경 실패');
          await load();
        } catch(err){status.textContent=err.message;btn.disabled=false;}
      });
      actions.append(btn);tr.append(email,current,created,actions);tbody.append(tr);
    }
  }catch(err){status.textContent=err.message;}
}
document.getElementById('refresh').addEventListener('click',load);
load();
