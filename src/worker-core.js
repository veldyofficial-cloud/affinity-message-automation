import {authenticate} from './access.js';
import {approve,lookup} from './routes.js';
import {json} from './monday.js';

const secureHeaders = {
  'Cache-Control':'private, no-store, max-age=0',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY',
};
function locked(error,status) {
  return new Response(error,{status,headers:{'Content-Type':'text/plain; charset=utf-8',...secureHeaders}});
}
export default {
  async fetch(request,env,ctx) {
    const auth=await authenticate(request,env);
    if (!auth.ok) return locked(auth.error,auth.status);
    const path=new URL(request.url).pathname;
    if (path.startsWith('/api/')) {
      if (path==='/api/health' && request.method==='GET')
        return json({ok:true,access:true,registry:Boolean(env.REGISTRY),monday:Boolean(env.MONDAY_API_TOKEN)});
      if (request.method!=='POST') return json({ok:false,error:'POST 요청만 지원합니다.'},405);
      if(path==='/api/lookup') return lookup(request,env);
      if(path==='/api/approve') return approve(request,env,auth.email);
      return json({ok:false,error:'해당 API를 찾을 수 없습니다.'},404);
    }
    if(!env.ASSETS) return locked('정적 HTML 파일 설정이 없습니다.',503);
    if(request.method!=='GET' && request.method!=='HEAD') return locked('잘못된 요청입니다.',405);
    const res=await env.ASSETS.fetch(request);
    const h=new Headers(res.headers);
    Object.entries(secureHeaders).forEach(([k,v])=>h.set(k,v));
    return new Response(res.body,{status:res.status,statusText:res.statusText,headers:h});
  },
};
