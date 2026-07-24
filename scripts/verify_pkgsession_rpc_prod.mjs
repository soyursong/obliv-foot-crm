/**
 * T-20260724-foot-PKGSESSION-BACKFILL-AND-EFFICACY — J2 / FM1
 * prod RPC 본문 실측 (READ-ONLY introspection, no write).
 *
 * 검증 대상(consume_package_sessions_for_checkin, prod=rxlomoozakkjesdqjtvd):
 *   G1  단일 5-arg widened 시그니처 (UUID,UUID,UUID,JSONB,JSONB) live
 *   G2  구 4-arg 오버로드 잔존 없음 (오버로드 0)
 *   G3  본문 UPDATE check_in_services ... package_session_id = v_session_id 실존
 *   G4  본문 is_package_session = true 동시 SET 실존
 *   G5  SECURITY DEFINER + proconfig(search_path pin) 상태 리포트 (참고)
 *
 * 실행: node scripts/verify_pkgsession_rpc_prod.mjs
 *   .env.local 의 SUPABASE_ACCESS_TOKEN(PAT) + prod project ref 사용.
 *   Management API /database/query 는 read-only SELECT 만 발행(pg_proc introspection).
 *
 * GO 판정: G1..G4 전부 PASS → exit 0 (FM1 GREEN). 하나라도 실패 → exit 1.
 */
import { readFileSync } from 'node:fs';

const envLocal = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const g = (k) => (envLocal.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();

const PAT = g('SUPABASE_ACCESS_TOKEN');
const URL_ = g('VITE_SUPABASE_URL') || '';
// prod ref = VITE_SUPABASE_URL 의 서브도메인 (https://<ref>.supabase.co)
const REF = g('SUPABASE_PROJECT_REF') || (URL_.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];

if (!PAT) { console.error('FATAL: SUPABASE_ACCESS_TOKEN(PAT) 없음 (.env.local)'); process.exit(2); }
if (!REF) { console.error('FATAL: prod project ref 판별 실패'); process.exit(2); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

let fail = 0;
const check = (name, cond, detail) => {
  console.log(`  ${cond ? '✓ PASS' : '✗ FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!cond) fail++;
};

(async () => {
  console.log(`=== prod RPC introspection (ref=${REF}) — READ-ONLY ===\n`);

  // 함수 시그니처 + 본문 + SECDEF + proconfig 전수
  const rows = await q(`
    SELECT p.oid::regprocedure::text AS sig,
           pg_get_function_identity_arguments(p.oid) AS args,
           p.prosecdef AS secdef,
           p.proconfig AS proconfig,
           p.prosrc AS src
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = 'consume_package_sessions_for_checkin'
     ORDER BY 1;
  `);

  console.log(`발견 오버로드 수: ${rows.length}`);
  rows.forEach((r) => console.log(`  · ${r.sig}`));
  console.log('');

  // G1 단일 5-arg widened
  const argc = (r) => (r.args || '').split(',').filter((s) => s.trim()).length;
  const fiveArg = rows.filter((r) => argc(r) === 5);
  const target = fiveArg[0];
  check('G1 단일 5-arg widened 시그니처 live', fiveArg.length >= 1,
        target ? target.sig : '5-arg 없음');

  // G2 구 4-arg 오버로드 잔존 없음
  const fourArg = rows.filter((r) => (r.args || '').split(',').filter((s) => s.trim()).length === 4);
  check('G2 구 4-arg 오버로드 잔존 없음', fourArg.length === 0,
        fourArg.length ? `잔존 ${fourArg.length}건: ${fourArg.map((r) => r.sig).join(' / ')}` : '오버로드 0');

  const src = target?.src || '';
  const norm = src.replace(/\s+/g, ' ');

  // G3 본문 UPDATE check_in_services ... package_session_id = v_session_id
  const hasUpdate = /UPDATE\s+check_in_services/i.test(norm);
  const hasFkSet = /package_session_id\s*=\s*v_session_id/i.test(norm);
  check('G3 본문 UPDATE check_in_services + package_session_id=v_session_id',
        hasUpdate && hasFkSet,
        `UPDATE=${hasUpdate} FK_SET=${hasFkSet}`);

  // G4 is_package_session = true 동시 SET
  const hasFlagSet = /is_package_session\s*=\s*true/i.test(norm);
  check('G4 is_package_session=true 동시 SET', hasFlagSet, `flag_set=${hasFlagSet}`);

  // 추가 정합: idempotent WHERE package_session_id IS NULL + p_service_sessions 게이트
  const hasIdem = /package_session_id\s+IS\s+NULL/i.test(norm);
  const hasSSGate = /p_service_sessions\s+IS\s+NOT\s+NULL/i.test(norm);
  const hasFifo = /ORDER\s+BY\s+c\.created_at\s+ASC,\s*c\.id\s+ASC/i.test(norm);
  console.log('\n  (참고 정합)');
  console.log(`    · idempotent (package_session_id IS NULL) : ${hasIdem}`);
  console.log(`    · p_service_sessions NULL-gate            : ${hasSSGate}`);
  console.log(`    · FIFO ORDER BY created_at,id             : ${hasFifo}`);

  // G5 SECDEF + proconfig
  console.log('\n  (SECURITY DEFINER / search_path pin)');
  console.log(`    · prosecdef  : ${target?.secdef}`);
  console.log(`    · proconfig  : ${JSON.stringify(target?.proconfig)}`);
  if (target?.secdef && !(target?.proconfig || []).some((c) => /search_path/i.test(c))) {
    console.log('    ⚠ SECURITY DEFINER 인데 proconfig search_path pin 없음 (별건 하드닝 후보, FM1 GO에는 미포함).');
  }

  console.log(`\n=== 결과: ${fail === 0 ? 'GO (FM1 GREEN)' : `NO-GO (${fail}건 실패)`} ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(3); });
