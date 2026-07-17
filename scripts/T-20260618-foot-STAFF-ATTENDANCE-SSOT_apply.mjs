/**
 * T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM — PROD apply (테이블 先 → cron 後, 순서 엄수)
 * DEPLOY-GO MSG-20260718-012818-3rbk (supervisor DDL-diff 5-check GO, commit eb59fe60, ADDITIVE).
 *
 * 순서(엄수): 20260618200000(staff_attendance 테이블) → 20260618201000(attendance-sync cron/worker).
 *   cron worker 가 채우는 테이블 선행 필수(마이그 헤더 §순서).
 *
 * usage: node scripts/..._apply.mjs           (DRY 계획만)
 *        node scripts/..._apply.mjs --apply   (실적용, applyMigration 경유 = 적용+원장기록 단일경로)
 */
import { query, applyMigration } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(실적용)' : 'DRY(계획만)';
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
const scalar = async (sql) => {
  const rows = await query(sql);
  const r = (Array.isArray(rows) ? rows : [])[0] || {};
  return r[Object.keys(r)[0]];
};

const CHAIN = [
  { version: '20260618200000', file: '20260618200000_staff_attendance_ssot.sql', note: 'staff_attendance 테이블 신설(ADDITIVE) + RLS4 + idx + UNIQUE(clinic,date,staff)' },
  { version: '20260618201000', file: '20260618201000_attendance_sync_cron.sql', note: 'trigger_attendance_sync() SECDEF + pg_cron foot-attendance-sync */15' },
];

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] STAFF-ATTENDANCE-SSOT apply — ref rxlomoozakkjesdqjtvd (${nowKst()})`);
console.log('  order(엄수): ' + CHAIN.map((c) => c.version).join(' → '));
console.log('════════════════════════════════════════════════════════════\n');

if (!APPLY) {
  for (const c of CHAIN) console.log(`  ${c.version}  ${c.file}\n    ↳ ${c.note}`);
  console.log('\n실적용: --apply 플래그.\n');
  process.exit(0);
}

const applied = [];
for (const c of CHAIN) {
  // cron 마이그 직전: 선행 테이블 실존 재확인(순서 게이트, fail-closed)
  if (c.version === '20260618201000') {
    const tbl = await scalar("SELECT to_regclass('public.staff_attendance') AS v;");
    console.log(`\n  [gate] staff_attendance = ${tbl ?? 'ABSENT'} (cron 진입 전 선행 테이블 확인)`);
    if (!tbl) {
      console.error('⛔ ABORT — 선행 테이블 부재 상태로 cron 진입 금지(순서 위반). 체인 중단.');
      process.exit(4);
    }
  }
  try {
    console.log(`\n▶ APPLY ${c.version}  ${c.file}`);
    const r = await applyMigration({ version: c.version, file: c.file, dryRun: false, createdBy: 'T-20260618-foot-STAFF-ATTENDANCE-SSOT' });
    console.log(`  ✅ applied + ledger 기록: ${JSON.stringify(r)}`);
    applied.push(c.version);
  } catch (e) {
    console.error(`  ⛔ FAIL ${c.version}: ${e.message}`);
    console.error(`  적용 완료분: ${applied.join(', ') || '(없음)'} — 체인 중단.`);
    process.exit(5);
  }
}

console.log(`\n✅ 전량 apply 완료: ${applied.join(' → ')}`);
console.log(`(${nowKst()})`);
