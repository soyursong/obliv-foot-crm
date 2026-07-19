/**
 * DIAG probe — T-20260719-foot-SELFCHECKIN-BIRTHDATE-FE-LOSS-DIAG
 * READ-ONLY. PostgREST count-only (Prefer: count=exact, HEAD). NO PII values pulled/printed.
 *
 * 목적: birth_date NULL 인 NEW 방문행을 (a) 비키오스크(desk/booking) (b) 외국인 키오스크(RRN 면제)
 *       (c) 국내 키오스크(=FE 유실 후보) 로 분해해, 국내 키오스크 완주분이 실제로 birth 를 잃는지 확정.
 *
 * 판정 논리:
 *  - 키오스크 personal_info 게이트 통과 = consent_sensitive=TRUE (게이트 필수 조건).
 *  - 국내 초진 게이트는 extractBirthDate(rrn)!==null 을 강제 → birth 6자리 존재해야 정상.
 *  - 외국인은 isForeign 로 RRN 게이트 면제 → birth NULL 이 정상(설계).
 *  - ∴ "consent_sensitive=TRUE & birth_date NULL & 외국인아님(phone 있음 & email 없음)" 이 >0 이면 국내 FE 유실 확정.
 */
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const URL = (env.match(/VITE_SUPABASE_URL=(.*)/) || [])[1].trim();
const KEY = (env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/) || [])[1].trim();
const REST = `${URL}/rest/v1`;

async function count(table, filters) {
  const qs = new URLSearchParams(filters).toString();
  const res = await fetch(`${REST}/${table}?${qs}`, {
    method: 'HEAD',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' },
  });
  const cr = res.headers.get('content-range') || '*/0';
  return Number(cr.split('/')[1] || 0);
}

const D14 = { created_at: 'gte.' + new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10) };
const NEWNULL = { created_by: 'is.null', visit_type: 'eq.new', ...D14 };

const R = {};
R['(0) NEW rows (created_by null, 14d)']              = await count('customers', { ...NEWNULL });
R['(1) └ consent_sensitive=TRUE (게이트 통과)']        = await count('customers', { ...NEWNULL, consent_sensitive: 'is.true' });
R['(2)   ├ & birth_date NULL']                        = await count('customers', { ...NEWNULL, consent_sensitive: 'is.true', birth_date: 'is.null' });
R['(3)   └ & birth_date NOT NULL (정상 국내)']         = await count('customers', { ...NEWNULL, consent_sensitive: 'is.true', birth_date: 'not.is.null' });
R['(4) consentTRUE & birthNULL & email NOT NULL (외국인 proxy)']   = await count('customers', { ...NEWNULL, consent_sensitive: 'is.true', birth_date: 'is.null', customer_email: 'not.is.null' });
R['(5) consentTRUE & birthNULL & phone NULL (외국인워크인 proxy)'] = await count('customers', { ...NEWNULL, consent_sensitive: 'is.true', birth_date: 'is.null', phone: 'is.null' });
R['(6) ★ consentTRUE & birthNULL & phone NOT NULL & email NULL (국내 FE유실 후보)'] = await count('customers', { ...NEWNULL, consent_sensitive: 'is.true', birth_date: 'is.null', phone: 'not.is.null', customer_email: 'is.null' });
R['(7)   └ ★ 위 + rrn_enc NOT NULL (국내 초진 강한 유실증거)'] = await count('customers', { ...NEWNULL, consent_sensitive: 'is.true', birth_date: 'is.null', phone: 'not.is.null', customer_email: 'is.null', rrn_enc: 'not.is.null' });
R['(8) 대조: consentFALSE/NULL & birthNULL (비키오스크 desk/booking)'] = await count('customers', { ...NEWNULL, consent_sensitive: 'not.is.true', birth_date: 'is.null' });

console.log('\n=== T-20260719 BIRTHDATE-FE-LOSS 분해 (read-only count) ===');
for (const [k, v] of Object.entries(R)) console.log(String(v).padStart(5), k);
console.log('\n판정: (6)/(7) > 0 → 국내 키오스크 FE 유실 실재.  (6)=0 → birthNULL 은 (외국인+비키오스크)로 완전 설명 = planner 전제(국내 FE유실) 반증.');
