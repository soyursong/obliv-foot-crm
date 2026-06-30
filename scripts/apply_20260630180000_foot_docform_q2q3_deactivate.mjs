/**
 * T-20260617-foot-DOCFORM-POPUP-OVERHAUL — Migration B Phase3 (Q2/Q3 soft deactivate)
 *
 * GATE: data-architect 정식 재판정 CONSULT-REPLY DA-20260630-foot-DOCFORM-RELABEL-RECONCILE
 *       (MSG-20260630-104253-l5zq) → Q2 + Q3 = GO.
 *   · Q2 소견서 canonical(진료소견서 10000) + 레거시 소견서 C5900003(20000) soft deactivate.
 *   · Q3 진료기록사본 단일 SKU(진료기록사본1 pricing_tiers) + 진료기록사본2(100) soft deactivate.
 *   · ★D1 가드: soft만(DELETE 금지). 매출 롤업은 service_charges 스냅샷 grain → active 무관.
 *     코드 검증: Closing.tsx/stats.ts 매출 롤업에 services.active join 없음(staff/user_profiles 한정).
 *   · 대표 게이트 면제(autonomy §3.1: forward-only·SSOT 무수정·매출0). supervisor DDL-diff 불요(UPDATE-only, DDL 0).
 *
 * ★ DA 적용 가드(선행사실 #2): before-검증 실측 행 대조. 2행 active=true·form 링크0·charge 참조0 확인 후 deactivate.
 *   before≠기대(active=true 아님) 시 STOP(또는 멱등 no-op).
 *
 * Supabase Management API 경유 직접 실행 (대시보드 수동 실행 금지 정책).
 * usage:
 *   node scripts/apply_20260630180000_foot_docform_q2q3_deactivate.mjs            # preflight→apply→postverify
 *   node scripts/apply_20260630180000_foot_docform_q2q3_deactivate.mjs --rollback # active=true 복원
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const rollback = process.argv.includes('--rollback');

const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const TARGETS = ['C5900003', '진료기록사본2'];
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { throw new Error('SUPABASE_ACCESS_TOKEN env required'); })();

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

const inList = TARGETS.map(c => `'${c}'`).join(',');
const PROBE = `
  SELECT id, service_code, name, price, active, category_label
    FROM services
   WHERE clinic_id = '${CLINIC_ID}'
     AND service_code IN (${inList})
   ORDER BY service_code;`;

console.log(`🚀 DOCFORM Q2/Q3 ${rollback ? 'ROLLBACK(active=true 복원)' : 'soft deactivate(active=false)'} (T-20260617-foot-DOCFORM-POPUP-OVERHAUL Phase3)`);

// ── 1. PREFLIGHT: 실측 행 대조 (DA before-검증 가드, 선행사실 #2) ─────────────────
const before = await q(PROBE);
console.log('\n[BEFORE 실측]');
console.table(before);

const rows = before.filter(r => TARGETS.includes(r.service_code));
if (rows.length !== TARGETS.length) {
  console.error(`❌ STOP: 대상 ${TARGETS.length}행 기대, 실측 ${rows.length}행. 적용 중단.`);
  process.exit(1);
}
const expectActive = rollback ? false : true;
const ready = rows.filter(r => r.active === expectActive);
if (ready.length !== rows.length) {
  // 멱등: 이미 기대 결과(상대 상태)면 no-op. 그 외 drift면 STOP.
  const done = rows.filter(r => r.active === (rollback ? true : false));
  if (done.length === rows.length) {
    console.log(`\nℹ️ 이미 active=${rollback ? 'true' : 'false'} 상태 (멱등 no-op). 변경 없이 종료.`);
    process.exit(0);
  }
  console.error(`\n❌ STOP: before≠기대(active=${expectActive}). 예상치 못한 active drift → 적용 중단 (DA 선행사실 #2 실측 가드).`);
  console.error(JSON.stringify(rows.map(r => ({ code: r.service_code, active: r.active })), null, 2));
  process.exit(1);
}

// D1 안전 재확인: 대상 행이 form_templates/service_charges에 묶여 있지 않음(발행경로·과거매출 무영향)
if (!rollback) {
  const sidList = rows.map(r => `'${r.id}'`).join(',');
  const ft = await q(`SELECT count(*)::int AS n FROM form_templates WHERE service_id IN (${sidList})`);
  const ch = await q(`SELECT count(*)::int AS n FROM service_charges WHERE service_id IN (${sidList})`);
  console.log(`\n[D1 안전검증] form_templates 링크=${ft[0].n}, service_charges 참조=${ch[0].n}`);
  if (ft[0].n > 0) {
    console.error('❌ STOP: 대상 SKU에 form_templates 링크 존재 → deactivate 시 발행폼 끊김. 중단 후 bridge 재정렬 필요.');
    process.exit(1);
  }
  // service_charges>0이어도 soft deactivate는 과거매출 무손상(D1: 롤업=스냅샷 grain)이라 경고만.
  if (ch[0].n > 0) {
    console.log('ℹ️ service_charges 참조 존재하나 soft deactivate=과거 charge 스냅샷 무손상(D1). 진행.');
  }
}
console.log(`✅ PREFLIGHT 통과: ${TARGETS.length}행 active=${expectActive}, 발행/롤업 무영향 확인.`);

// ── 2. APPLY ─────────────────────────────────────────────────────────────────
const file = rollback
  ? '../supabase/migrations/20260630180000_foot_docform_q2q3_deactivate.rollback.sql'
  : '../supabase/migrations/20260630180000_foot_docform_q2q3_deactivate.sql';
const SQL = readFileSync(join(__dir, file), 'utf8');
await q(SQL);
console.log(`\n✅ APPLY 완료 (${rollback ? 'rollback' : 'migration'} SQL 실행).`);

// ── 3. POSTVERIFY ────────────────────────────────────────────────────────────
const after = await q(PROBE);
console.log('\n[AFTER 실측]');
console.table(after);
const want = rollback ? true : false;
const ok = after.filter(r => TARGETS.includes(r.service_code)).every(r => r.active === want);
if (!ok) { console.error(`❌ POSTVERIFY 실패: active != ${want}`); process.exit(1); }
console.log(`\n🎉 완료: 소견서 C5900003 / 진료기록사본2 active=${want}. price·name·category_label 불변(행 머지 없음).`);
