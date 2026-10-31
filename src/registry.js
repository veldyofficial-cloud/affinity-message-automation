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
