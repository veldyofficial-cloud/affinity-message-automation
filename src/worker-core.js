import {authenticate} from './access.js';
import {isSharedLinkMode, authorizeSharedLink, sharedLinkRateLimit} from './shared-link.js';
import {approve,lookup} from './routes.js';
import {json} from './monday.js';
import {enabled, enrollInstructor, instructorRole, listInstructors, updateInstructor} from './instructor-access.js';

const secureHeaders = {
  'Cache-Control':'private, no-store, max-age=0',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY',
  'X-Robots-Tag':'noindex, nofollow, noarchive',
};
function locked(error,status) {
  return new Response(error,{status,headers:{'Content-Type':'text/plain; charset=utf-8',...secureHeaders}});
}
async function asset(request,env,overridePath) {
  if (!env.ASSETS) return locked('정적 HTML 파일 설정이 없습니다.',503);
  const url=new URL(request.url);
  if (overridePath) url.pathname=overridePath;
  const res=await env.ASSETS.fetch(new Request(url, request));
  const h=new Headers(res.headers);
  Object.entries(secureHeaders).forEach(([k,v])=>h.set(k,v));
  return new Response(res.body,{status:res.status,statusText:res.statusText,headers:h});
}
export default {
  async fetch(request,env,ctx) {
    // Public form; every student lookup and approval still requires 256-bit link key.
    // Existing Cloudflare Access flow remains the default until opt-in.
    if (isSharedLinkMode(env)) {
      const path=new URL(request.url).pathname;
      if (path==='/admin' || path==='/admin.html' || path==='/admin.js' ||
          path==='/onboarding' || path==='/onboarding.html' || path==='/onboarding.js' ||
          path.startsWith('/api/auth/') || path.startsWith('/api/admin/')) {
        return locked('This route is unavailable in shared-link mode.',404);
      }
      if (path.startsWith('/api/')) {
        const access=await authorizeSharedLink(request,env);
        if(!access.ok) return json({ok:false,error:access.error},access.status);
        if(path==='/api/health' && request.method==='GET') {
          return json({ok:true,mode:'shared_link',registry:Boolean(env.REGISTRY),monday:Boolean(env.MONDAY_API_TOKEN)});
        }
        if(request.method!=='POST') return json({ok:false,error:'POST only'},405);
        const limit=await sharedLinkRateLimit(request,env,path);
        if(!limit.allowed) return json({ok:false,error:limit.error},limit.status||429);
        if(path==='/api/lookup') return lookup(request,env);
        if(path==='/api/approve') return approve(request,env,'shared-link');
        return json({ok:false,error:'API route not found'},404);
      }
      if(request.method!=='GET' && request.method!=='HEAD') return locked('Method not allowed.',405);
      return asset(request,env);
    }
    const identity=await authenticate(request,env);
    if (!identity.ok) return locked(identity.error,identity.status);
    const path=new URL(request.url).pathname;
    let role;
    try { role=await instructorRole(identity,env); }
    catch { return locked('강사 권한 저장소에 연결할 수 없습니다. 담당자에게 문의해 주세요.',503); }
    if (path==='/api/auth/status' && request.method==='GET') {
      return json({ok:true,email:identity.email,role:role||'pending',enrollmentEnabled:enabled(env)});
    }
    if (path==='/api/auth/enroll' && request.method==='POST') {
      if(identity.isAdmin) return json({ok:false,error:'관리자는 별도 등록이 필요하지 않습니다.'},400);
      return enrollInstructor(identity,request,env);
    }
    if (path.startsWith('/api/admin/')) {
      if(role!=='admin') return json({ok:false,error:'관리자 전용 기능입니다.'},403);
      if(path==='/api/admin/instructors' && request.method==='GET') return listInstructors(env);
      if(path==='/api/admin/instructors' && request.method==='POST') return updateInstructor(request,env);
      return json({ok:false,error:'지원하지 않는 관리자 요청입니다.'},404);
    }
    if (path==='/admin' || path==='/admin.html' || path==='/admin.js') {
      if(role!=='admin') return locked('관리자만 접근할 수 있습니다.',403);
      if(request.method!=='GET' && request.method!=='HEAD') return locked('잘못된 요청입니다.',405);
      return asset(request,env,path==='/admin'?'/admin.html':undefined);
    }
    if (!role) {
      if (path.startsWith('/api/')) return json({ok:false,error:'등록된 강사만 학생 데이터 및 등록 기능을 이용할 수 있습니다.'},403);
      if (request.method!=='GET' && request.method!=='HEAD') return locked('잘못된 요청입니다.',405);
      if (!enabled(env)) return locked('강사 초대 등록이 준비되지 않았습니다. 운영 담당자에게 문의해 주세요.',403);
      return asset(request,env,path==='/onboarding.js'?'/onboarding.js':'/onboarding.html');
    }
    if (path.startsWith('/api/')) {
      if (path==='/api/health' && request.method==='GET')
        return json({ok:true,access:true,registry:Boolean(env.REGISTRY),monday:Boolean(env.MONDAY_API_TOKEN)});
      if (request.method!=='POST') return json({ok:false,error:'POST 요청만 지원합니다.'},405);
      if(path==='/api/lookup') return lookup(request,env);
      if(path==='/api/approve') return approve(request,env,identity.email);
      return json({ok:false,error:'해당 API를 찾을 수 없습니다.'},404);
    }
    if (request.method!=='GET' && request.method!=='HEAD') return locked('잘못된 요청입니다.',405);
    return asset(request,env);
  },
};
