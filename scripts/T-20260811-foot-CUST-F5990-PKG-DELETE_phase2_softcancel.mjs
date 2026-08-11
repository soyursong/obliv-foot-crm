/**
 * T-20260811-foot-CUST-F5990-PKG-DELETE — Phase 2 soft-cancel 실행
 *
 * 게이트 통과: 김주연 총괄(U0ATDB587PV) (A) 무효화 확정 (MSG-20260811-171451-kgs5).
 *
 * 유일 mutation: packages.id = ba6771ef-d66e-495d-ae51-8a48f1f62ec8 (무좀체험권)
 *   status: active → cancelled
 * freeze셋(변경 없음, 이력 보존):
 *   package_sessions.id = 1bee6ad4-a0be-4784-a7fc-5407ea3531a7
 *   check_ins.id        = ec84b828-c304-4771-a41a-88f693b54191
 *
 * 하드가드: hard-DELETE/물리삭제 금지. UPDATE 1행만. rows-affected=1 검증(silent write-failure 금지).
 * Cross-CRM Data-Correction Backfill SOP 경량 적용: 대상셋 freeze + before/after 스냅샷 + rows-affected 검증.
 */
import fs from 'fs';
const REF = 'rxlomoozakkjesdqjtvd';
const PKG_ID = 'ba6771ef-d66e-495d-ae51-8a48f1f62ec8';
const PS_ID = '1bee6ad4-a0be-4784-a7fc-5407ea3531a7';
const CI_ID = 'ec84b828-c304-4771-a41a-88f693b54191';

let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);
    if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, '');
  }
}
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }

async function qj(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}
const j = (o) => JSON.stringify(o, null, 2);

(async () => {
  const snap = { ticket: 'T-20260811-foot-CUST-F5990-PKG-DELETE', phase: 'phase2_softcancel' };

  // ── BEFORE 스냅샷 ─────────────────────────────────────────────
  console.log('=== [BEFORE] packages 대상 ===');
  const before = await qj(`
    SELECT id, package_name, status, total_sessions, total_amount, paid_amount, updated_at
    FROM packages WHERE id = '${PKG_ID}'`);
  console.log(j(before));
  snap.before_packages = before;

  if (before.length !== 1) throw new Error(`❌ 대상 packages 행 ${before.length}건 (기대 1). abort.`);
  if (before[0].status !== 'active') {
    throw new Error(`❌ before status='${before[0].status}' (기대 'active'). 이미 변경됐거나 상태 불일치 → abort.`);
  }

  console.log('\n=== [BEFORE] freeze셋 (package_sessions / check_ins) ===');
  const psBefore = await qj(`SELECT id, package_id, check_in_id, session_number, session_type, status, deleted_at, created_at FROM package_sessions WHERE id = '${PS_ID}'`);
  const ciBefore = await qj(`SELECT id, package_id, status, checked_in_at, completed_at, deleted_at, created_at FROM check_ins WHERE id = '${CI_ID}'`);
  console.log('package_sessions:', j(psBefore));
  console.log('check_ins:', j(ciBefore));
  snap.before_package_sessions = psBefore;
  snap.before_check_ins = ciBefore;

  // ── MUTATION: soft-cancel (UPDATE 1행, RETURNING 으로 rows-affected 검증) ──
  console.log('\n=== [MUTATION] packages.status active→cancelled (UPDATE, RETURNING) ===');
  const upd = await qj(`
    UPDATE packages
    SET status = 'cancelled', updated_at = now()
    WHERE id = '${PKG_ID}' AND status = 'active'
    RETURNING id, status, updated_at`);
  console.log('RETURNING:', j(upd));
  snap.update_returning = upd;

  // rows-affected=1 검증 (silent write-failure 금지)
  if (upd.length !== 1) {
    throw new Error(`❌ rows-affected=${upd.length} (기대 1). silent write-failure/스코프 불일치 → abort.`);
  }
  if (upd[0].status !== 'cancelled') {
    throw new Error(`❌ after status='${upd[0].status}' (기대 'cancelled') → abort.`);
  }
  console.log('✅ rows-affected = 1, status = cancelled');

  // ── AFTER 스냅샷 + freeze셋 무변경 재확인 ─────────────────────
  console.log('\n=== [AFTER] packages 대상 ===');
  const after = await qj(`
    SELECT id, package_name, status, total_sessions, total_amount, paid_amount, updated_at
    FROM packages WHERE id = '${PKG_ID}'`);
  console.log(j(after));
  snap.after_packages = after;

  console.log('\n=== [AFTER] freeze셋 무변경 재확인 ===');
  const psAfter = await qj(`SELECT id, package_id, check_in_id, session_number, session_type, status, deleted_at, created_at FROM package_sessions WHERE id = '${PS_ID}'`);
  const ciAfter = await qj(`SELECT id, package_id, status, checked_in_at, completed_at, deleted_at, created_at FROM check_ins WHERE id = '${CI_ID}'`);
  console.log('package_sessions:', j(psAfter));
  console.log('check_ins:', j(ciAfter));
  snap.after_package_sessions = psAfter;
  snap.after_check_ins = ciAfter;

  const psUnchanged = JSON.stringify(psBefore) === JSON.stringify(psAfter);
  const ciUnchanged = JSON.stringify(ciBefore) === JSON.stringify(ciAfter);
  console.log(`\npackage_sessions 무변경 = ${psUnchanged ? '✅' : '❌'}`);
  console.log(`check_ins 무변경        = ${ciUnchanged ? '✅' : '❌'}`);
  if (!psUnchanged || !ciUnchanged) throw new Error('❌ freeze셋이 변경됨 → 이력보존 위배. 조사 필요.');

  snap.result = {
    rows_affected: 1,
    packages_status: `${before[0].status} → ${after[0].status}`,
    package_sessions_unchanged: psUnchanged,
    check_ins_unchanged: ciUnchanged,
  };
  fs.writeFileSync('scripts/T-20260811-foot-CUST-F5990-PKG-DELETE_phase2_snapshot.json', j(snap));
  console.log('\n✅ Phase 2 soft-cancel 완료. 스냅샷 저장: scripts/..._phase2_snapshot.json');
})().catch((e) => { console.error('\n💥', e.message); process.exit(1); });
