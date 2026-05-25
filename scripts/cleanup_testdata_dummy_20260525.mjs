/**
 * 운영 DB 테스트 더미 데이터 전건 삭제 (V1+V2 통합 클린업)
 * T-20260525-foot-DUMMY-DATA-CLEANUP
 *
 * 대상: name LIKE '테스트초진%' OR name LIKE '테스트재진%' AND is_simulation=true
 *   - V1 (5/22): 테스트초진01~48 + 테스트재진01~48 (phone: +821000000201~296)
 *   - V2 (5/25): 테스트초진01~68 + 테스트재진01~68 (phone: +821099060001~136)
 *
 * 삭제 순서 (FK 의존성 완전 체인):
 *   check_in 자식 테이블들 → check_ins → customer 자식 테이블들 → customers
 *
 * AC-2 준수: 삭제 전 INSERT 백업 SQL 자동 생성
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const ROLLBACK_FILE = path.join(__dirname, 'rollback_dummy_all_20260525.sql');

/** SQL 문자열 이스케이프 */
function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** 테이블 백업 helper */
async function backupTable(lines, tableName, filterCol, filterIds) {
  if (!filterIds || filterIds.length === 0) return 0;
  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .in(filterCol, filterIds);
  if (error) {
    // 테이블 없거나 컬럼 없는 경우 무시
    console.warn(`  ⚠️  backup ${tableName} skip: ${error.message}`);
    return 0;
  }
  if (data && data.length > 0) {
    lines.push(`-- ========== ${tableName} ==========`);
    for (const r of data) {
      const cols = Object.keys(r).join(', ');
      const vals = Object.values(r).map(esc).join(', ');
      lines.push(`INSERT INTO ${tableName} (${cols}) VALUES (${vals}) ON CONFLICT (id) DO NOTHING;`);
    }
    lines.push('');
  }
  return data?.length || 0;
}

/**
 * 테이블 삭제 helper
 * @param {boolean} [optional=false] 테이블/컬럼 없으면 warn 후 continue
 */
async function deleteFrom(tableName, filterCol, filterIds, optional = false) {
  if (!filterIds || filterIds.length === 0) return 0;
  const { data, error } = await supabase
    .from(tableName)
    .delete()
    .in(filterCol, filterIds)
    .select('id');
  if (error) {
    const msg = error.message || '';
    const isStructuralIssue =
      msg.includes('column') ||
      msg.includes('relation') ||
      msg.includes('does not exist') ||
      msg.includes('schema cache') ||
      msg.includes('table') ||
      msg.includes('not found');
    if (optional || isStructuralIssue) {
      console.log(`  ⏭  ${tableName} (${filterCol}): skip — ${msg.slice(0, 80)}`);
      return 0;
    }
    throw new Error(`${tableName} 삭제 실패: ${error.message}`);
  }
  const n = data?.length || 0;
  if (n > 0) console.log(`  ✅ ${tableName} 삭제: ${n}건`);
  return n;
}

async function main() {
  console.log('🗑️  테스트 더미 데이터 전건 삭제 (V1+V2 통합)');
  console.log('   T-20260525-foot-DUMMY-DATA-CLEANUP');
  console.log('   대상: name LIKE 테스트초진% OR 테스트재진% AND is_simulation=true\n');

  // ─── Step 1: 대상 고객 ID 수집 ───────────────────────────────────
  const { data: custs, error: custErr } = await supabase
    .from('customers')
    .select('id, name, phone, is_simulation')
    .or('name.ilike.테스트초진%,name.ilike.테스트재진%')
    .eq('is_simulation', true);

  if (custErr) throw new Error(`고객 조회 실패: ${custErr.message}`);

  const custIds = (custs || []).map(c => c.id);
  console.log(`📊 삭제 대상 고객: ${custIds.length}명`);

  // 이상 전화번호 경고
  const anomalies = (custs || []).filter(
    c => !c.phone?.startsWith('+821000000') && !c.phone?.startsWith('+82109906')
  );
  if (anomalies.length > 0) {
    console.log(`\n⚠️  비표준 전화번호 ${anomalies.length}건 (is_simulation=true 확인됨, 삭제 포함):`);
    anomalies.forEach(c => console.log(`   ${c.name} / ${c.phone}`));
  }

  if (custIds.length === 0) {
    console.log('ℹ️  삭제할 테스트 데이터가 없습니다.');
    return;
  }

  // ─── Step 2: check_in IDs 수집 ───────────────────────────────────
  const { data: cis, error: ciErr2 } = await supabase
    .from('check_ins')
    .select('id')
    .in('customer_id', custIds);
  if (ciErr2) throw new Error(`check_ins 조회 실패: ${ciErr2.message}`);
  const ciIds = (cis || []).map(ci => ci.id);
  console.log(`   관련 check_ins: ${ciIds.length}건\n`);

  // ─── Step 3: 롤백 SQL 백업 생성 (AC-2) ──────────────────────────
  console.log('📝 롤백 SQL 백업 생성 중...');
  const lines = [
    '-- 롤백 SQL: 테스트 더미 데이터 복원 (T-20260525-foot-DUMMY-DATA-CLEANUP)',
    `-- 생성: ${new Date().toISOString()}`,
    '-- 복원 순서: customers → reservations → check_ins → (check_in 자식들) → (customer 자식들)',
    '',
    'BEGIN;',
    '',
  ];
  await backupTable(lines, 'customers', 'id', custIds);
  await backupTable(lines, 'reservations', 'customer_id', custIds);
  await backupTable(lines, 'check_ins', 'customer_id', custIds);
  await backupTable(lines, 'payments', 'check_in_id', ciIds);
  await backupTable(lines, 'service_charges', 'check_in_id', ciIds);
  await backupTable(lines, 'form_submissions', 'customer_id', custIds);
  await backupTable(lines, 'check_in_services', 'check_in_id', ciIds);
  await backupTable(lines, 'status_transitions', 'check_in_id', ciIds);
  await backupTable(lines, 'check_in_room_logs', 'check_in_id', ciIds);
  await backupTable(lines, 'room_assignments', 'check_in_id', ciIds);
  await backupTable(lines, 'medical_charts', 'customer_id', custIds);
  await backupTable(lines, 'customer_treatment_memos', 'customer_id', custIds);
  await backupTable(lines, 'consent_forms', 'check_in_id', ciIds);
  await backupTable(lines, 'checklists', 'check_in_id', ciIds);
  await backupTable(lines, 'insurance_documents', 'check_in_id', ciIds);
  await backupTable(lines, 'insurance_claims', 'check_in_id', ciIds);
  await backupTable(lines, 'notifications', 'check_in_id', ciIds);
  await backupTable(lines, 'timer_records', 'check_in_id', ciIds);
  await backupTable(lines, 'closing_manual_payments', 'check_in_id', ciIds);
  await backupTable(lines, 'packages', 'customer_id', custIds);

  // package_sessions (via packages)
  const { data: pkgs } = await supabase.from('packages').select('id').in('customer_id', custIds);
  const pkgIds = (pkgs || []).map(p => p.id);
  if (pkgIds.length > 0) await backupTable(lines, 'package_sessions', 'package_id', pkgIds);

  lines.push('COMMIT;');
  fs.writeFileSync(ROLLBACK_FILE, lines.join('\n'), 'utf-8');
  console.log(`✅ 롤백 SQL 저장: ${ROLLBACK_FILE}\n`);

  // ─── Step 4: 삭제 실행 ───────────────────────────────────────────
  console.log('🚀 삭제 시작...');
  console.log('  [check_in 자식 테이블들]');

  // check_in_id FK 자식들 (모두 먼저)
  await deleteFrom('payment_audit_logs',     'check_in_id', ciIds, true);
  await deleteFrom('service_charges',        'check_in_id', ciIds);
  await deleteFrom('payments',               'check_in_id', ciIds);
  await deleteFrom('form_submissions',       'customer_id', custIds);
  await deleteFrom('check_in_services',      'check_in_id', ciIds);
  await deleteFrom('status_transitions',     'check_in_id', ciIds);
  await deleteFrom('check_in_room_logs',     'check_in_id', ciIds, true);
  await deleteFrom('room_assignments',       'check_in_id', ciIds, true);
  await deleteFrom('consent_forms',          'check_in_id', ciIds);
  await deleteFrom('checklists',             'check_in_id', ciIds);
  await deleteFrom('insurance_documents',    'check_in_id', ciIds);
  await deleteFrom('insurance_claims',       'check_in_id', ciIds, true);
  await deleteFrom('insurance_receipts',     'check_in_id', ciIds, true);
  await deleteFrom('claim_items',            'check_in_id', ciIds, true);
  await deleteFrom('claim_diagnoses',        'check_in_id', ciIds, true);
  await deleteFrom('notifications',          'check_in_id', ciIds);
  await deleteFrom('timer_records',          'check_in_id', ciIds, true);
  await deleteFrom('closing_manual_payments','check_in_id', ciIds, true);
  await deleteFrom('receipt_ocr_results',    'check_in_id', ciIds, true);
  await deleteFrom('patient_room_daily_log', 'check_in_id', ciIds, true);
  await deleteFrom('reservation_logs',       'check_in_id', ciIds, true);

  console.log('  [check_ins]');
  await deleteFrom('check_ins', 'customer_id', custIds);

  console.log('  [customer 자식 테이블들]');

  // package_sessions 먼저 (packages 삭제 전)
  if (pkgIds.length > 0) await deleteFrom('package_sessions', 'package_id', pkgIds);
  await deleteFrom('packages',                'customer_id', custIds);
  // payments: check_in_id로 이미 삭제했지만 customer_id FK도 있음 (잔존 가능)
  await deleteFrom('payments',                'customer_id', custIds);
  await deleteFrom('service_charges',         'customer_id', custIds, true);
  await deleteFrom('reservations',            'customer_id', custIds);
  await deleteFrom('medical_charts',          'customer_id', custIds);
  await deleteFrom('chart_doctor_memos',      'customer_id', custIds, true);
  await deleteFrom('clinical_images',         'customer_id', custIds, true);
  await deleteFrom('customer_treatment_memos','customer_id', custIds);
  await deleteFrom('prescriptions',           'customer_id', custIds);
  await deleteFrom('consent_forms',           'customer_id', custIds);
  await deleteFrom('insurance_documents',     'customer_id', custIds);
  await deleteFrom('form_submissions',        'customer_id', custIds);
  await deleteFrom('notification_opt_outs',   'customer_id', custIds, true);
  await deleteFrom('message_logs',            'customer_id', custIds, true);
  await deleteFrom('receipt_ocr_results',     'customer_id', custIds, true);
  await deleteFrom('closing_manual_payments', 'customer_id', custIds, true);
  await deleteFrom('package_payments',        'customer_id', custIds, true);
  await deleteFrom('reservation_logs',        'customer_id', custIds, true);
  await deleteFrom('edi_submissions',         'customer_id', custIds, true);
  await deleteFrom('dopamine_outbound_log',   'customer_id', custIds, true);

  console.log('  [customers]');
  const { data: delCust, error: delErr } = await supabase
    .from('customers')
    .delete()
    .in('id', custIds)
    .select('id');
  if (delErr) throw new Error(`customers 삭제 실패: ${delErr.message}`);
  console.log(`  ✅ customers 삭제: ${(delCust||[]).length}명`);

  console.log('\n✅ 전건 삭제 완료');
  console.log(`   롤백 필요 시: psql $DATABASE_URL < ${ROLLBACK_FILE}`);
}

main().catch(e => {
  console.error('\n❌ 클린업 실패:', e.message);
  process.exit(1);
});
