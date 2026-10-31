/**
 * Link-only access: client-supplied high-entropy bearer secret in an API header.
 * The UI reads #key= from the URL fragment, which is never sent in HTTP URLs.
 * The secret is configured ONLY as Cloudflare Worker Secret, not in this repo.
 */
const KEY_RE = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
export function isSharedLinkMode(env) {
  return String(env.ACCESS_MODE || '').trim() === 'shared_link';
}
export async function authorizeSharedLink(request, env) {
  const secret = String(env.SHARED_LINK_KEY || '');
  if (!KEY_RE.test(secret) || !env.REGISTRY) {
    return {ok:false,status:503,error:'Shared-link access is not configured on the server.'};
  }
  const candidate = String(request.headers.get('X-Affinity-Link-Key') || '');
  if (!KEY_RE.test(candidate)) {
    return {ok:false,status:401,error:'A valid internal shared link is required. Please open the full link provided by VELDY.'};
  }
  const [a,b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(candidate)),
    crypto.subtle.digest('SHA-256', encoder.encode(secret)),
  ]);
  const left=new Uint8Array(a),right=new Uint8Array(b);
  let mismatch=0;
  for(let i=0;i<left.length;i++) mismatch|=left[i]^right[i];
  if(mismatch) return {ok:false,status:401,error:'This shared link is not valid or has been replaced.'};
  return {ok:true, email:'shared-link', isAdmin:false};
}

// Rate-limit lookups/writes even with the correct key. Hash IP with secret so
// no plaintext IP addresses are persisted in Durable Object storage.
export async function sharedLinkRateLimit(request, env, path) {
  if (path !== '/api/lookup' && path !== '/api/approve') return {allowed:true};
  if (!env.REGISTRY) return {allowed:false,error:'Approval registry is unavailable.',status:503};
  const scope=path === '/api/approve' ? 'write' : 'lookup';
  const ip=request.headers.get('CF-Connecting-IP') || 'unknown';
  const material=encoder.encode(scope+'|'+ip+'|'+env.SHARED_LINK_KEY);
  const digest=await crypto.subtle.digest('SHA-256',material);
  const fingerprint=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  const registry=env.REGISTRY.get(env.REGISTRY.idFromName('affinity-infohub-approvals-v1'));
  if(typeof registry.consumeSharedRate !== 'function') return {allowed:false,error:'Shared-link rate limiter is unavailable.',status:503};
  const limit=scope==='write'?30:120;
  const windowMs=scope==='write'?86400000:3600000;
  try {
    const result=await registry.consumeSharedRate(fingerprint,scope,limit,windowMs);
    return result.allowed ? {allowed:true} : {allowed:false,error:'Too many requests from this network. Contact the operator.',status:429};
  } catch {
    return {allowed:false,error:'Shared-link request protection is unavailable.',status:503};
  }
}
