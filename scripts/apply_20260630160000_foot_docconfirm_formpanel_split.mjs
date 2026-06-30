/**
 * T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT — 진료확인서 발급폼 2개 분리 (방식 β) apply
 *
 * 게이트: planner MSG-20260630-124723-qn24 (게이트 A reporter + 게이트 B DA β, 양 GO).
 *   · DDL 0(service_id 컬럼 Migration A 기존재) → DML 슬라이스. service_charges 무변경.
 *   · forward-only: 레거시 active=false 토글(DELETE 금지) + 신규 2행 ADDITIVE INSERT.
 *
 * Supabase Management API 경유 직접 실행 (대시보드 수동 실행 금지 정책).
 * usage:
 *   node scripts/apply_20260630160000_foot_docconfirm_formpanel_split.mjs            # preflight→apply→postverify
 *   node scripts/apply_20260630160000_foot_docconfirm_formpanel_split.mjs --rollback # active-토글 복원
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const rollback = process.argv.includes('--rollback');

const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { throw new Error('SUPABASE_ACCESS_TOKEN env required'); })();

const MIG = join(__dir, '..', 'supabase', 'migrations',
  rollback
    ? '20260630160000_foot_docconfirm_formpanel_split.rollback.sql'
    : '20260630160000_foot_docconfirm_formpanel_split.sql');

async function q(sql) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: sql }),
  });
  const body = await resp.json();
  if (!resp.ok) {
    console.error('❌ query 실패:', resp.status, JSON.stringify(body, null, 2));
    process.exit(1);
  }
  return body;
}

const PROBE_FT = `
  SELECT form_key, active, service_id
    FROM form_templates
   WHERE clinic_id = '${CLINIC_ID}' AND form_key LIKE 'treat_confirm%'
   ORDER BY form_key;`;
const PROBE_SVC = `
  SELECT id, service_code, price, category_label
    FROM services
   WHERE id IN ('b590d457-0834-44d6-805a-6c8f7c0e8672','67ce0da3-3d85-42cf-9589-4176efdc0536')
   ORDER BY service_code;`;
const PROBE_SC_GUARD = `
  SELECT count(*) AS sc_rows FROM service_charges WHERE clinic_id = '${CLINIC_ID}';`;

console.log(`🚀 진료확인서 발급폼 분리 ${rollback ? 'ROLLBACK(active 복원)' : 'APPLY(β: 2폼 INSERT + 레거시 deactivate)'}`);

// ── PREFLIGHT ────────────────────────────────────────────────────────────────
console.log('\n[BEFORE — form_templates]');
console.table(await q(PROBE_FT));

if (!rollback) {
  // self-check #2: bridge SKU 2행 실측 (id 불변 확인)
  const svc = await q(PROBE_SVC);
  console.log('[bridge SKU 실측]');
  console.table(svc);
  if (svc.length !== 2) {
    console.error(`❌ STOP: bridge SKU 2행 기대, 실측 ${svc.length}행. b590d457/67ce0da3 부재 → 적용 중단.`);
    process.exit(1);
  }
  // service_charges 무변경 가드: before count 기록(post와 대조)
  const scBefore = (await q(PROBE_SC_GUARD))[0].sc_rows;
  console.log(`[service_charges 행수 BEFORE] = ${scBefore} (post 와 동일해야 함 — 무변경 가드)`);
  globalThis.__scBefore = scBefore;
}

// ── APPLY ────────────────────────────────────────────────────────────────────
const sql = readFileSync(MIG, 'utf8');
console.log(`\n📄 적용: ${MIG.split('/').slice(-1)[0]}`);
await q(sql);
console.log('✅ 적용 완료');

// ── POSTVERIFY ───────────────────────────────────────────────────────────────
console.log('\n[AFTER — form_templates]');
const after = await q(PROBE_FT);
console.table(after);

if (!rollback) {
  const byKey = Object.fromEntries(after.map(r => [r.form_key, r]));
  const ok =
    byKey['treat_confirm']?.active === false && byKey['treat_confirm']?.service_id === null &&
    byKey['treat_confirm_code']?.active === true &&
    byKey['treat_confirm_code']?.service_id === 'b590d457-0834-44d6-805a-6c8f7c0e8672' &&
    byKey['treat_confirm_nocode']?.active === true &&
    byKey['treat_confirm_nocode']?.service_id === '67ce0da3-3d85-42cf-9589-4176efdc0536';
  // service_charges 무변경 가드 검증
  const scAfter = (await q(PROBE_SC_GUARD))[0].sc_rows;
  const scIntact = String(scAfter) === String(globalThis.__scBefore);
  console.log(`[service_charges 행수 AFTER] = ${scAfter} → ${scIntact ? '✅ 무변경' : '❌ 변동!'}`);
  if (ok && scIntact) console.log('\n✅✅ POSTVERIFY PASS — 레거시 비활성·2폼 활성·bridge 정합·service_charges 무변경.');
  else { console.error('\n❌ POSTVERIFY FAIL'); process.exit(1); }
} else {
  console.log('\nℹ️ ROLLBACK 완료 — 레거시 재활성 + 신규 2폼 비활성(행 보존).');
}
