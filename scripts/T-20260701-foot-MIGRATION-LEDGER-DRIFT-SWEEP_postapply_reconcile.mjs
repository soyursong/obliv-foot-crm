/**
 * T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP — apply 후 3-way 원장 대조 + casualty 해소 검증
 *
 * supervisor DDL-diff GO "apply 전 필수 #4": 3-way 원장 대조
 *   (schema_migrations 원장 ↔ PROD 실재 ↔ 파일선언) 후 결과 보고.
 *
 * 검증:
 *   ① 7 target version 전건 원장(schema_migrations) 존재
 *   ② casualty 실물 해소: rx_audit_log 테이블 존재 / daily_room_status_staff_unlock_6menu 정책 존재
 *   ③ revoke-only 실효: anon 파괴/불요 verb 회수 확인(phi 4테이블 + pii_leak 5테이블)
 *   ④ 원장 6/09 정지 해소: 원장 max version 전진
 *   (모두 단일 배치 쿼리 — throttle 회피)
 *
 * author: dev-foot / 2026-08-05
 */
import { query, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const TARGETS = [
  { v: '20260618200000', stage: 'A#1', file: '20260618200000_staff_attendance_ssot.sql' },
  { v: '20260625140000', stage: 'A#6', file: '20260625140000_foreign_lang_save_customers_language.sql' },
  { v: '20260628200000', stage: 'A#2', file: '20260628200000_waiting_board_projection.sql' },
  { v: '20260611210000', stage: 'B1#4', file: '20260611210000_rx_audit_log.sql' },
  { v: '20260616010000', stage: 'B1#1', file: '20260616010000_phi_anon_grant_revoke_hardening.sql' },
  { v: '20260629140000', stage: 'B1#2', file: '20260629140000_anon_pii_leak_revoke_phase1.sql' },
  { v: '20260630200000', stage: 'B2#3', file: '20260630200000_daily_room_status_staff_unlock_6menu_rls_additive.sql' },
];

(async () => {
  // ── 단일 배치 introspection ──
  const rows = await query(`SELECT jsonb_build_object(
    'ledger_targets', (SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations WHERE version IN (${TARGETS.map((t) => `'${t.v}'`).join(',')})),
    'ledger_count',   (SELECT count(*) FROM supabase_migrations.schema_migrations),
    'ledger_max',     (SELECT max(version) FROM supabase_migrations.schema_migrations),
    -- casualty 실물 해소
    'rx_audit_log_table', (to_regclass('public.rx_audit_log') IS NOT NULL),
    'rx_audit_insert_pol', EXISTS(SELECT 1 FROM pg_policies WHERE tablename='rx_audit_log' AND policyname='rx_audit_log_insert'),
    'rx_audit_select_pol', EXISTS(SELECT 1 FROM pg_policies WHERE tablename='rx_audit_log' AND policyname='rx_audit_log_select'),
    'rx_audit_rls', (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.rx_audit_log')),
    'drs_unlock_pol', EXISTS(SELECT 1 FROM pg_policies WHERE tablename='daily_room_status' AND policyname='daily_room_status_staff_unlock_6menu'),
    'drs_existing3', (SELECT jsonb_agg(policyname ORDER BY policyname) FROM pg_policies WHERE tablename='daily_room_status' AND policyname IN ('daily_room_status_admin_manager_write','daily_room_status_approved_read','daily_room_status_staff_own_write')),
    -- StageA 실물
    'staff_attendance_table', (to_regclass('public.staff_attendance') IS NOT NULL),
    'waiting_board_table', (to_regclass('public.waiting_board') IS NOT NULL),
    'customers_language_col', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name='language'),
    -- revoke-only 실효: anon 이 회수 대상 verb 를 더 이상 보유하지 않아야(false)
    'phi_insurance_claims_select', has_table_privilege('anon','public.insurance_claims','SELECT'),
    'phi_claim_items_select', has_table_privilege('anon','public.claim_items','SELECT'),
    'phi_diag_select', has_table_privilege('anon','public.insurance_claim_diagnoses','SELECT'),
    'phi_edi_select', has_table_privilege('anon','public.edi_submissions','SELECT'),
    'pii_staff_select', has_table_privilege('anon','public.staff','SELECT'),
    'pii_userprofiles_select', has_table_privilege('anon','public.user_profiles','SELECT'),
    'pii_customers_delete', has_table_privilege('anon','public.customers','DELETE'),
    'pii_customers_select', has_table_privilege('anon','public.customers','SELECT'),
    'pii_checkins_delete', has_table_privilege('anon','public.check_ins','DELETE'),
    'pii_checkins_select', has_table_privilege('anon','public.check_ins','SELECT'),
    'pii_reservations_insert', has_table_privilege('anon','public.reservations','INSERT'),
    'pii_reservations_select', has_table_privilege('anon','public.reservations','SELECT'),
    'pii_reservations_update', has_table_privilege('anon','public.reservations','UPDATE')
  ) AS v;`);
  const r = (Array.isArray(rows) && rows.length ? Object.values(rows[0])[0] : {}) || {};

  console.log('══════════════════════════════════════════════════════════════');
  console.log('apply 후 3-way 원장 대조 + casualty 해소 검증');
  console.log('══════════════════════════════════════════════════════════════\n');

  // ① 3-way: 파일선언 ↔ 원장 ↔ PROD 실재
  const ledgerSet = new Set(r.ledger_targets || []);
  console.log('① 3-way 원장 대조 (파일선언 ↔ schema_migrations 원장 ↔ PROD 실재)');
  let allLedger = true;
  for (const t of TARGETS) {
    const inLedger = ledgerSet.has(t.v);
    allLedger = allLedger && inLedger;
    console.log(`   [${t.stage}] ${t.v}  원장:${inLedger ? '✓' : '✗ MISSING'}  ${t.file}`);
  }
  console.log(`   → 7 target 전건 원장 기록: ${allLedger ? '✅ YES' : '❌ NO'}\n`);

  // ② casualty 실물 해소
  console.log('② casualty 실물 해소 (PROD 실재)');
  const chk = (label, cond) => console.log(`   ${cond ? '✓' : '✗'} ${label}: ${cond}`);
  chk('rx_audit_log 테이블 존재(casualty 해소)', r.rx_audit_log_table === true);
  chk('rx_audit_log RLS ENABLE', r.rx_audit_rls === true);
  chk('rx_audit_log_insert 정책', r.rx_audit_insert_pol === true);
  chk('rx_audit_log_select 정책', r.rx_audit_select_pol === true);
  chk('daily_room_status_staff_unlock_6menu 정책 존재(casualty 해소)', r.drs_unlock_pol === true);
  chk('daily_room_status 기존3정책 보존(무접촉 불변식)', (r.drs_existing3 || []).length === 3);
  console.log(`     기존3정책: ${JSON.stringify(r.drs_existing3)}`);
  chk('staff_attendance 테이블', r.staff_attendance_table === true);
  chk('waiting_board 테이블', r.waiting_board_table === true);
  chk('customers.language 컬럼', r.customers_language_col === true);

  // ③ revoke-only 실효 (anon 회수 대상 verb = false 여야 함, 보존 verb = true 유지)
  console.log('\n③ revoke-only 실효 (anon 권한 포스처)');
  console.log('   [phi_anon_grant_revoke] 4 insurance/EDI 테이블 anon SELECT = false 여야:');
  chk('  insurance_claims SELECT(회수)', r.phi_insurance_claims_select === false);
  chk('  claim_items SELECT(회수)', r.phi_claim_items_select === false);
  chk('  insurance_claim_diagnoses SELECT(회수)', r.phi_diag_select === false);
  chk('  edi_submissions SELECT(회수)', r.phi_edi_select === false);
  console.log('   [anon_pii_leak] staff/user_profiles 전권 회수 + PII 파괴verb 회수(본 마이그가 회수하는 verb만 판정):');
  chk('  staff SELECT(회수)', r.pii_staff_select === false);
  chk('  user_profiles SELECT(회수)', r.pii_userprofiles_select === false);
  chk('  customers DELETE(회수)', r.pii_customers_delete === false);
  chk('  check_ins DELETE(회수)', r.pii_checkins_delete === false);
  chk('  reservations INSERT(회수)', r.pii_reservations_insert === false);
  // ── 아래는 본 마이그가 REVOKE 하지 않는 verb(customers/check_ins/reservations SELECT·UPDATE).
  //    현재 posture 는 후속 lockdown 티켓(20260720232000_customers_anon_select_lockdown,
  //    20260703160000_anon_reservation_read_scopedown, kiosk Gate-C 컷오버) 소관이지 본 배치 무관.
  //    본 배치 무영속 dry-run 이 이 verb 들 pre==post(무변경)를 이미 실측 → 정보성 표기만. ──
  console.log('   [정보성] 본 마이그 미접촉 verb — 현재 anon posture(후속 lockdown 티켓 소관, 본 배치 무변경):');
  console.log(`     · customers SELECT=${r.pii_customers_select}  check_ins SELECT=${r.pii_checkins_select}  reservations SELECT=${r.pii_reservations_select} UPDATE=${r.pii_reservations_update}`);
  console.log('     (본 마이그 SQL 에 이 verb REVOKE 없음 + dry-run pre==post = 본 배치가 이 posture 변경 0)');

  // ④ 원장 전진
  console.log('\n④ 원장 6/09 정지 해소');
  console.log(`   원장 총 ${r.ledger_count}행, max version = ${r.ledger_max} (6/09 20260609234500 정지 → 전진 확인)`);

  console.log('\n══════════════════════════════════════════════════════════════');
  // revoke 실효 = 본 마이그가 회수 대상으로 명시한 verb 만 판정(tighten-only, 미접촉 verb 는 제외).
  const revokeEffective = r.phi_insurance_claims_select === false && r.phi_claim_items_select === false
    && r.phi_diag_select === false && r.phi_edi_select === false
    && r.pii_staff_select === false && r.pii_userprofiles_select === false
    && r.pii_customers_delete === false && r.pii_checkins_delete === false && r.pii_reservations_insert === false;
  const casualtyResolved = r.rx_audit_log_table === true && r.rx_audit_rls === true
    && r.rx_audit_insert_pol === true && r.rx_audit_select_pol === true
    && r.drs_unlock_pol === true
    && r.staff_attendance_table === true && r.waiting_board_table === true && r.customers_language_col === true;
  const existing3ok = (r.drs_existing3 || []).length === 3;
  const pass = allLedger && casualtyResolved && revokeEffective && existing3ok;
  console.log(`종합: ${pass ? '✅ 전건 검증 PASS — 원장 정합(7/7) + casualty 해소 + revoke 실효(tighten-only) + 기존3정책 무접촉' : '❌ 일부 FAIL — 상세 확인'}`);
  console.log('══════════════════════════════════════════════════════════════');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('RECONCILE ERROR:', e); process.exit(2); });
