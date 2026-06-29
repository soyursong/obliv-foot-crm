/**
 * 롤백: 5/26 더미 예약 데이터 72건 삭제
 * T-20260525-foot-DUMMY-DATA-GEN
 *
 * 대상: created_by = 'dummy-seed-20260526'
 *   - customers 72건
 *   - reservations 72건
 *   - check_ins (재진 36건 과거체크인)
 *
 * 삭제 순서 (FK 의존성):
 *   check_ins → reservations → customers
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL     = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());
const SEED_TAG         = 'dummy-seed-20260526';
const BACKUP_FILE      = path.join(__dirname, 'rollback_dummy_backup_20260526.sql');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** SQL 문자열 이스케이프 */
function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** 테이블 백업 헬퍼 */
async function backupTable(lines, tableName, filterCol, filterIds) {
  if (!filterIds || filterIds.length === 0) return;
  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .in(filterCol, filterIds);
  if (error) {
    console.warn(`  ⚠️  backup ${tableName} skip: ${error.message}`);
    return;
  }
  if (data && data.length > 0) {
    lines.push(`-- ========== ${tableName} (${data.length}건) ==========`);
    for (const r of data) {
      const cols = Object.keys(r).join(', ');
      const vals = Object.values(r).map(esc).join(', ');
      lines.push(`INSERT INTO ${tableName} (${cols}) VALUES (${vals}) ON CONFLICT (id) DO NOTHING;`);
    }
    lines.push('');
    console.log(`  📝 backup ${tableName}: ${data.length}건`);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log(`🗑️  더미 데이터 롤백 (tag: ${SEED_TAG})`);
  console.log('T-20260525-foot-DUMMY-DATA-GEN');
  console.log('='.repeat(60));

  // ── STEP 1: 대상 고객 ID 수집 ──────────────────────────
  const { data: custs, error: custErr } = await supabase
    .from('customers')
    .select('id, name, phone')
    .eq('created_by', SEED_TAG);
  if (custErr) throw new Error(`고객 조회 실패: ${custErr.message}`);

  const custIds = (custs || []).map(c => c.id);
  console.log(`\n📊 삭제 대상 고객: ${custIds.length}명`);

  if (custIds.length === 0) {
    console.log('  ℹ️  삭제할 데이터가 없습니다. 이미 삭제되었거나 삽입 전입니다.');
    return;
  }

  // ── STEP 2: 롤백 SQL 백업 생성 ─────────────────────────
  console.log('\n📝 롤백 SQL 백업 생성 중...');
  const lines = [
    `-- 롤백 SQL: 5/26 더미 데이터 복원 (T-20260525-foot-DUMMY-DATA-GEN)`,
    `-- 생성: ${new Date().toISOString()}`,
    `-- 복원 순서: customers → reservations → check_ins`,
    '',
    'BEGIN;',
    '',
  ];

  await backupTable(lines, 'customers', 'id', custIds);
  await backupTable(lines, 'reservations', 'customer_id', custIds);
  await backupTable(lines, 'check_ins', 'customer_id', custIds);

  lines.push('COMMIT;');
  fs.writeFileSync(BACKUP_FILE, lines.join('\n'), 'utf-8');
  console.log(`  ✅ 백업 저장: ${BACKUP_FILE}`);

  // ── STEP 3: 삭제 실행 ──────────────────────────────────
  console.log('\n🚀 삭제 시작...');

  // check_ins 먼저 (FK 의존성)
  const { data: delCI, error: ciErr } = await supabase
    .from('check_ins')
    .delete()
    .in('customer_id', custIds)
    .select('id');
  if (ciErr) throw new Error(`check_ins 삭제 실패: ${ciErr.message}`);
  console.log(`  ✅ check_ins 삭제: ${delCI?.length || 0}건`);

  // reservations
  const { data: delRsv, error: rsvErr } = await supabase
    .from('reservations')
    .delete()
    .in('customer_id', custIds)
    .select('id');
  if (rsvErr) throw new Error(`reservations 삭제 실패: ${rsvErr.message}`);
  console.log(`  ✅ reservations 삭제: ${delRsv?.length || 0}건`);

  // customers
  const { data: delCust, error: delErr } = await supabase
    .from('customers')
    .delete()
    .in('id', custIds)
    .select('id');
  if (delErr) throw new Error(`customers 삭제 실패: ${delErr.message}`);
  console.log(`  ✅ customers 삭제: ${delCust?.length || 0}건`);

  console.log('\n' + '='.repeat(60));
  console.log('✅ 롤백 완료');
  console.log(`   check_ins:    ${delCI?.length || 0}건`);
  console.log(`   reservations: ${delRsv?.length || 0}건`);
  console.log(`   customers:    ${delCust?.length || 0}건`);
  console.log(`\n   복원 필요 시: psql $DATABASE_URL < ${BACKUP_FILE}`);
  console.log('='.repeat(60));
}

main().catch(e => {
  console.error('\n❌ 롤백 실패:', e.message);
  process.exit(1);
});
