import { DurableObject } from 'cloudflare:workers';

/** Persistent approval registry on the free-tier SQLite-backed Durable Objects storage. */
export class ApprovalRegistry extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS approvals (
        key TEXT PRIMARY KEY, state TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        result TEXT NOT NULL DEFAULT '{}'
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS instructors (
        email TEXT PRIMARY KEY,
        active INTEGER NOT NULL DEFAULT 1,
        enrolled_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS instructor_attempts (
        email TEXT PRIMARY KEY,
        failed_count INTEGER NOT NULL,
        window_started INTEGER NOT NULL,
        locked_until INTEGER NOT NULL DEFAULT 0
      )
    `);
  }
  async getInstructor(email) {
    const row=this.ctx.storage.sql.exec('SELECT active, enrolled_at FROM instructors WHERE email=?',email).toArray()[0];
    return row ? {exists:true,active:row.active===1,enrolledAt:row.enrolled_at} : {exists:false,active:false};
  }
  async enrollInstructor(email, validCode) {
    const existing=await this.getInstructor(email);
    if(existing.exists) {
      return existing.active ? {ok:true,alreadyEnrolled:true} :
        {ok:false,error:'이 계정은 관리자에 의해 차단되었습니다. 운영 담당자에게 문의해 주세요.'};
    }
    const now=Date.now();
    const attempt=this.ctx.storage.sql.exec('SELECT failed_count,window_started,locked_until FROM instructor_attempts WHERE email=?',email).toArray()[0];
    if(attempt && attempt.locked_until>now) return {ok:false,locked:true,error:'등록 시도 횟수를 초과했습니다. 24시간 뒤 다시 시도하거나 관리자에게 문의해 주세요.'};
    if(!validCode) {
      const withinWindow=attempt && now-attempt.window_started<24*3600*1000;
      const count=withinWindow ? attempt.failed_count+1 : 1;
      const lockedUntil=count>=5 ? now+24*3600*1000 : 0;
      this.ctx.storage.sql.exec(`INSERT INTO instructor_attempts(email,failed_count,window_started,locked_until)
        VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET
        failed_count=excluded.failed_count,window_started=excluded.window_started,locked_until=excluded.locked_until`,
        email,count,withinWindow?attempt.window_started:now,lockedUntil);
      return {ok:false,locked:lockedUntil>0,error:lockedUntil ?
        '등록 시도 횟수를 초과했습니다. 24시간 뒤 다시 시도해 주세요.' : '강사용 초대코드가 올바르지 않습니다.'};
    }
    const timestamp=new Date().toISOString();
    this.ctx.storage.sql.exec('INSERT INTO instructors(email,active,enrolled_at,updated_at) VALUES(?,?,?,?)',
      email,1,timestamp,timestamp);
    this.ctx.storage.sql.exec('DELETE FROM instructor_attempts WHERE email=?',email);
    return {ok:true};
  }
  async listInstructors() {
    return this.ctx.storage.sql.exec('SELECT email,active,enrolled_at,updated_at FROM instructors ORDER BY enrolled_at DESC LIMIT 500')
      .toArray().map(row=>({email:row.email,active:row.active===1,enrolledAt:row.enrolled_at,updatedAt:row.updated_at}));
  }
  async setInstructorStatus(email,active) {
    const existing=await this.getInstructor(email);
    if(!existing.exists) return {ok:false,error:'해당 이메일로 등록된 강사가 없습니다.'};
    this.ctx.storage.sql.exec('UPDATE instructors SET active=?,updated_at=? WHERE email=?',
      active?1:0,new Date().toISOString(),email);
    return {ok:true,email,active};
  }
  async reserve(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid approval fingerprint');
    const existing = this.ctx.storage.sql.exec('SELECT state, result FROM approvals WHERE key=?',key).toArray()[0];
    if (existing) return {accepted:false, state:existing.state, ...JSON.parse(existing.result)};
    const now = new Date().toISOString();
    this.ctx.storage.sql.exec('INSERT INTO approvals(key, state, created_at, updated_at, result) VALUES (?, ?, ?, ?, ?)',
      key,'pending',now,now,'{}');
    return {accepted:true};
  }
  async finish(key, state, result) {
    if (!['complete','review'].includes(state)) throw new Error('Invalid registry state');
    this.ctx.storage.sql.exec('UPDATE approvals SET state=?, result=?, updated_at=? WHERE key=?',
      state,JSON.stringify(result),new Date().toISOString(),key);
  }
  async release(key) {
    this.ctx.storage.sql.exec('DELETE FROM approvals WHERE key=? AND state=?',key,'pending');
  }
}
