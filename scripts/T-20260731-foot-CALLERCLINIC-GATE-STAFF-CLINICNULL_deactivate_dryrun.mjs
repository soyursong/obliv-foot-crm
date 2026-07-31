/**
 * DRY-RUN (No-Persistence, DATA-DIFF): T-20260731-foot-CALLERCLINIC-GATE-STAFF-CLINICNULL
 *   미사용 코디 계정(이승준, 68c50c25...) 비활성화 apply.sql 의 data-diff 를 무영속으로 검증.
 *
 * 구조 (migration_dryrun_no_persistence_standard 정신 계승, data-UPDATE 판):
 *   ① 단일 plpgsql DO 블록 안에서 before(to_jsonb 전-컬럼) → UPDATE → GET DIAGNOSTICS → after(to_jsonb)
 *   ② diff 검증을 SQL 안에서 수행: (before - 'active') = (after - 'active') 로 **active 외 전 컬럼 무변경**을
 *      prod 카탈로그 전수(to_jsonb) 기준으로 판정 (§2-S-3 컬럼완전성 — 손열거 아님)
 *   ③ RAISE EXCEPTION 으로 블록 전체 롤백 → prod 무영속 (persistence 0). 메시지에 compact verdict 만 실어
 *      파싱 안정화 (rows / before_active / after_active / only_active_changed)
 *   ④ post-probe: dry-run 후 prod 실측 active 가 여전히 true (무영속 재확인)
 *
 * 실행: node scripts/T-20260731-foot-CALLERCLINIC-GATE-STAFF-CLINICNULL_deactivate_dryrun.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT)
 */
import { q } from './dryrun_lib.mjs';

const ID = '68c50c25-8725-4e96-8a52-c47dde03a786';
const EMAIL = 'sj.lee0719@medibuilder.com';

const DRY = `
DO $dry$
DECLARE
  v_before jsonb;
  v_after  jsonb;
  v_rows   int;
  v_only_active_changed boolean;
BEGIN
  SELECT to_jsonb(up) INTO v_before FROM public.user_profiles up
   WHERE up.id = '${ID}' AND lower(up.email) = lower('${EMAIL}');

  UPDATE public.user_profiles
     SET active = false
   WHERE id = '${ID}' AND lower(email) = lower('${EMAIL}') AND active = true;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  SELECT to_jsonb(up) INTO v_after FROM public.user_profiles up
   WHERE up.id = '${ID}';

  -- 전-컬럼(to_jsonb)에서 'active' + 'updated_at'(트리거 자동 audit 타임스탬프) 을 제외하고
  -- 나머지 비즈니스 컬럼이 완전히 동일한지 = active 외 무변경.
  v_only_active_changed := (v_before - 'active' - 'updated_at') = (v_after - 'active' - 'updated_at');

  RAISE EXCEPTION 'DRYRUN_VERDICT rows=% before_active=% after_active=% only_active_changed=% changed_keys=%',
    v_rows, v_before->>'active', v_after->>'active', v_only_active_changed,
    (SELECT string_agg(k, ',') FROM jsonb_object_keys(v_before) k
      WHERE (v_before->k) IS DISTINCT FROM (v_after->k));
END $dry$;
`;

function fail(msg) { console.error('❌ DRY-RUN FAIL:', msg); process.exit(1); }

let payload;
try {
  await q(DRY);
  fail('expected DRYRUN_VERDICT RAISE but query returned without error (no rollback sentinel).');
} catch (e) {
  const m = String(e.message);
  const idx = m.indexOf('DRYRUN_VERDICT ');
  if (idx < 0) fail('sentinel not found in error: ' + m);
  payload = m.slice(idx);
}

// parse compact verdict: DRYRUN_VERDICT rows=1 before_active=true after_active=false only_active_changed=t
const rowsM = payload.match(/rows=(\d+)/);
const beforeM = payload.match(/before_active=(\w+)/);
const afterM = payload.match(/after_active=(\w+)/);
const onlyM = payload.match(/only_active_changed=(\w+)/);
const changedM = payload.match(/changed_keys=([\w,]*)/);
if (!rowsM || !beforeM || !afterM || !onlyM) fail('could not parse verdict: ' + payload);

const rows = Number(rowsM[1]);
const beforeActive = beforeM[1];
const afterActive = afterM[1];
const onlyActiveChanged = onlyM[1] === 't' || onlyM[1] === 'true';
const changedKeys = (changedM ? changedM[1].trim() : '').split(',').filter(Boolean).sort();

console.log('=== DATA-DIFF (no-persistence) ===');
console.log('rows_affected      :', rows);
console.log('before.active      :', beforeActive);
console.log('after.active       :', afterActive);
console.log('changed_keys       :', changedKeys.join(', ') || '(none)');
console.log('only_active_changed:', onlyActiveChanged, '(active + updated_at 자동타임스탬프 제외 비교)');

// ── invariants ──────────────────────────────────────────────────────────────
if (rows !== 1) fail(`rows_affected=${rows} (expected exactly 1 — id+email anchored single row)`);
if (beforeActive !== 'true') fail(`before.active=${beforeActive} (expected true)`);
if (afterActive !== 'false') fail(`after.active=${afterActive} (expected false)`);
if (!onlyActiveChanged) fail('business columns changed — only \'active\' (+auto updated_at) may diff (full-column to_jsonb compare)');
// changed_keys 는 {active} 또는 {active,updated_at} 만 허용 (updated_at = 트리거 audit)
const unexpected = changedKeys.filter((k) => k !== 'active' && k !== 'updated_at');
if (unexpected.length) fail('unexpected changed columns: ' + unexpected.join(', '));

// ── post-probe: 무영속 재확인 (prod 실측 active 여전히 true) ──────────────────
const live = await q(`SELECT active FROM public.user_profiles WHERE id='${ID}';`);
if (live[0]?.active !== true) {
  fail(`PERSISTENCE LEAK: prod active=${live[0]?.active} after dry-run (expected true — nothing should persist)`);
}

console.log('\n✅ DRY-RUN PASS — rows=1, active true→false, 타 컬럼 무변경, 무영속 확인.');
console.log('   supervisor data-diff 게이트 통과 후 apply.sql 을 prod 집행하십시오.');
