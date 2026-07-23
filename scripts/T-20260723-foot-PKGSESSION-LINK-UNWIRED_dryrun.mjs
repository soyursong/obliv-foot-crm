/**
 * T-20260723-foot-PKGSESSION-LINK-UNWIRED — 마이그레이션 무영속 문법 검증(dry-run).
 * 목적: CREATE OR REPLACE FUNCTION(5-arg widened) 을 BEGIN…ROLLBACK 트랜잭션 안에서 실행해
 *   문법/plpgsql 컴파일 오류만 검증하고 절대 영속시키지 않는다.
 *   ⚠ 실제 prod apply + pg_proc PREFLIGHT C10 + 함수-diff 는 supervisor 배포-前 게이트(codex 명시).
 *   본 스크립트는 dev-foot self-QA(문법 실증)용 — 무COMMIT(무영속).
 * 사후 무영속 증명: 트랜잭션 밖에서 pg_proc 시그니처를 재조회해 구 4-arg 만 남아있음을 확인.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

const sigSql = `
  SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.proname = 'consume_package_sessions_for_checkin'
   ORDER BY 1;`;

console.log('=== BEFORE 시그니처 (현행 prod) ===');
console.log(JSON.stringify(await q(sigSql), null, 2));

// 마이그 본문에서 DROP/CREATE/GRANT 블록만 추출(NOTIFY 는 txn 밖 무의미하므로 제외)
const mig = readFileSync('supabase/migrations/20260723190000_foot_pkgsession_link_unwired_widened.sql', 'utf8');
const body = mig
  .split('\n')
  .filter((l) => !l.trim().startsWith('NOTIFY'))
  .join('\n');

console.log('\n=== DRY-RUN: BEGIN … ROLLBACK (무영속 문법 검증) ===');
try {
  await q(`BEGIN;\n${body}\nROLLBACK;`);
  console.log('OK — 문법/plpgsql 컴파일 통과, 롤백 완료(무영속).');
} catch (e) {
  console.error('FAIL — 마이그 문법 오류:', e.message);
  process.exit(1);
}

console.log('\n=== AFTER 시그니처 (무영속 증명: 여전히 구 4-arg 만) ===');
const after = await q(sigSql);
console.log(JSON.stringify(after, null, 2));
const persisted = after.some((r) => r.sig.includes('jsonb, jsonb)'));
if (persisted) { console.error('ABORT: 5-arg 가 영속됨 — dry-run 무영속 위반!'); process.exit(1); }
console.log('\n무영속 확인 OK. supervisor 배포-前 게이트(pg_proc PREFLIGHT C10 + 함수-diff)로 실제 apply.');
