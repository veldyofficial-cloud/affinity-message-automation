/*
 * Validate Cloudflare Access JWTs, not merely the presence of a header.
 * An unconfigured deployment is inaccessible (fail closed).
 * Zero Trust Access must separately be enabled for ALL traffic to this Worker.
 */
let cachedCerts = null;
let certsExpireAt = 0;
let cachedCertsUrl = '';

function fromBase64Url(value) {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
  const decoded = atob(padded);
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(value)));
}
async function getCerts(domain, refresh = false) {
  const url = `${domain}/cdn-cgi/access/certs`;
  if (!refresh && cachedCerts && cachedCertsUrl === url && Date.now() < certsExpireAt) return cachedCerts;
  const res = await fetch(url, {headers:{Accept:'application/json'}, signal:AbortSignal.timeout(8000)});
  if (!res.ok) throw new Error('Cloudflare 인증 공개키 조회 실패');
  const body = await res.json();
  if (!Array.isArray(body.keys)) throw new Error('Cloudflare 공개키 목록이 올바르지 않습니다.');
  cachedCerts = body.keys;
  cachedCertsUrl = url;
  certsExpireAt = Date.now() + 5 * 60 * 1000;
  return cachedCerts;
}

export async function authenticate(request, env) {
  const domain = String(env.TEAM_DOMAIN || '').replace(/\/$/, '');
  const audience = String(env.POLICY_AUD || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(domain) || !audience) {
    return {ok:false, status:503, error:'Cloudflare Access 인증 설정이 완료되지 않았습니다.'};
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  if (!token) return {ok:false, status:403, error:'Cloudflare Access 직원 로그인이 필요합니다.'};
  try {
    const segments = token.split('.');
    if (segments.length !== 3 || token.length > 16000) throw new Error('JWT 형식 오류');
    const [encodedHeader, encodedBody, encodedSignature] = segments;
    const header = decodeJson(encodedHeader);
    const payload = decodeJson(encodedBody);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw new Error('서명 알고리즘 오류');
    const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const now = Math.floor(Date.now()/1000);
    if (payload.iss !== domain || !audList.includes(audience) ||
        typeof payload.exp !== 'number' || payload.exp <= now ||
        (typeof payload.nbf === 'number' && payload.nbf > now + 60) ||
        (typeof payload.iat === 'number' && payload.iat > now + 60)) {
      throw new Error('토큰 발급처, 대상 또는 만료 시간 오류');
    }
    if (typeof payload.email !== 'string' || !payload.email.includes('@')) throw new Error('직원 이메일 확인 실패');
    const emails = String(env.ACCESS_ALLOWED_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    if (!emails.length) return {ok:false,status:503,error:'승인 직원 이메일 목록을 먼저 설정해 주세요.'};
    if (!emails.includes(payload.email.toLowerCase())) return {ok:false,status:403,error:'승인 권한이 없는 직원 계정입니다.'};
    let keys = await getCerts(domain);
    let jwk = keys.find(k=>k.kid===header.kid && k.kty==='RSA');
    if (!jwk) {
      keys = await getCerts(domain,true); // key rotation
      jwk = keys.find(k=>k.kid===header.kid && k.kty==='RSA');
    }
    if (!jwk) throw new Error('서명 키가 존재하지 않습니다.');
    const key = await crypto.subtle.importKey('jwk', {kty:'RSA',n:jwk.n,e:jwk.e,ext:true},
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key,
      fromBase64Url(encodedSignature), new TextEncoder().encode(`${encodedHeader}.${encodedBody}`));
    if (!valid) throw new Error('JWT 서명 검증 실패');
    return {ok:true, email:payload.email.toLowerCase()};
  } catch {
    return {ok:false,status:403,error:'Cloudflare Access 인증이 유효하지 않습니다. 다시 로그인해 주세요.'};
  }
}
