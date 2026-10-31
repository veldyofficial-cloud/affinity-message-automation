/** Authorize instructors independently of Cloudflare account membership.
 * Cloudflare Access must first authenticate their individual email via signed JWT.
 * Enrollment is explicitly opt-in behind a strong server-side secret, and revocable.
 */
export function instructorRegistry(env) {
  if (!env.REGISTRY) return null;
  return env.REGISTRY.get(env.REGISTRY.idFromName('affinity-infohub-approvals-v1'));
}

export function enabled(env) {
  return Boolean(env.INSTRUCTOR_INVITE_CODE && String(env.INSTRUCTOR_INVITE_CODE).length >= 24 && env.REGISTRY);
}

export async function instructorRole(identity, env) {
  if (identity.isAdmin) return 'admin';
  if (!enabled(env)) return null;
  const state = await instructorRegistry(env).getInstructor(identity.email);
  return state?.active === true ? 'instructor' : null;
}

async function constantTimeCodeCheck(code, secret) {
  const encoder = new TextEncoder();
  const [given, target] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(code)),
    crypto.subtle.digest('SHA-256', encoder.encode(secret)),
  ]);
  const a = new Uint8Array(given);
  const b = new Uint8Array(target);
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
  return different === 0;
}

export async function enrollInstructor(identity, request, env) {
  if (!enabled(env)) return Response.json({ok:false,error:'강사 초대 등록 기능이 아직 설정되지 않았습니다.'},{status:503});
  const origin = request.headers.get('origin');
  if (!origin || new URL(origin).origin !== new URL(request.url).origin) {
    return Response.json({ok:false,error:'허용되지 않은 요청입니다.'},{status:403});
  }
  if (Number(request.headers.get('content-length') || 0) > 2048) {
    return Response.json({ok:false,error:'요청이 너무 큽니다.'},{status:413});
  }
  let code;
  try {
    const input = await request.json();
    code = input && typeof input.code === 'string' ? input.code.trim() : '';
  } catch {return Response.json({ok:false,error:'잘못된 등록 요청입니다.'},{status:400});}
  if (code.length > 256) return Response.json({ok:false,error:'초대코드 형식이 올바르지 않습니다.'},{status:400});
  const valid = await constantTimeCodeCheck(code, String(env.INSTRUCTOR_INVITE_CODE));
  const result = await instructorRegistry(env).enrollInstructor(identity.email, valid);
  return Response.json(result,{status:result.ok?200:result.locked?429:403,headers:{'Cache-Control':'no-store'}});
}

export async function listInstructors(env) {
  const users = await instructorRegistry(env).listInstructors();
  return Response.json({ok:true,users}, {headers:{'Cache-Control':'no-store'}});
}

export async function updateInstructor(request, env) {
  const origin = request.headers.get('origin');
  if (!origin || new URL(origin).origin !== new URL(request.url).origin) {
    return Response.json({ok:false,error:'허용되지 않은 요청입니다.'},{status:403});
  }
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ok:false,error:'잘못된 요청입니다.'},{status:400});
  }
  const email = String(body?.email||'').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof body.active !== 'boolean') {
    return Response.json({ok:false,error:'이메일 또는 상태를 확인해 주세요.'},{status:400});
  }
  // Admin cannot create an instructor account using this endpoint; instructors enroll with an invite.
  const result = await instructorRegistry(env).setInstructorStatus(email,body.active);
  return Response.json(result,{status:result.ok?200:404,headers:{'Cache-Control':'no-store'}});
}
