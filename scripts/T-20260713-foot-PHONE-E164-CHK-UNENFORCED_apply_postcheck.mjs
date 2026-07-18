/**
 * T-20260713-foot-PHONE-E164-CHK-UNENFORCED — Step1 prod 실적용(idempotent re-apply) + applied_at POSTCHECK
 *
 * FIX-REQUEST(MSG-20260718-193954-6j50) 처리:
 *   1) up.sql(mig 20260713160000, commit fa68512b) prod 실적용 — 멱등 DROP IF EXISTS + re-ADD NOT VALID.
 *   2) schema_migrations 원장 20260713160000 기록 확인.
 *   3) applied_at POSTCHECK evidence: BEFORE/AFTER def diff + 로컬폰 REJECT + E.164 ACCEPT 실증.
 *
 * enforcement 테스트는 DO-block forced-rollback 패턴:
 *   - 항상 RAISE 로 종료 → 트랜잭션 전량 롤백 → prod 데이터 0 persistence.
 *   - REJECT 기대: SQLSTATE 23514(check_violation, phone_e164_chk) 이면 PASS.
 *   - ACCEPT 기대: SQLSTATE P0001 'ROLLBACK_OK' 이면 PASS(=INSERT 통과 후 강제 롤백).
 *   - clinic_id 는 실재 값 사용(FK 23503 오검출 회피) → 오직 CHECK 만 실패 원인이 되게 고정.
 *
 * 사용:
 *   node scripts/..._apply_postcheck.mjs           # dry-run (기본, DDL·테스트 write 없음)
 *   node scripts/..._apply_postcheck.mjs --apply   # PROD 실적용 + POSTCHECK
 *
 * author: dev-foot / 2026-07-18
 */
import { query, applyMigration } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260713160000';
const FILE = '20260713160000_foot_phone_e164_chk_expr_fix.sql';
const now = () => new Date().toISOString();

const out = { ticket: 'T-20260713-foot-PHONE-E164-CHK-UNENFORCED', mode: APPLY ? 'APPLY' : 'DRY-RUN' };

async function constraintDefs() {
  return query(`SELECT conname, pg_get_constraintdef(oid) AS def, convalidated
    FROM pg_constraint
    WHERE conname IN ('customers_phone_e164_chk','reservations_customer_phone_e164_chk')
    ORDER BY conname;`);
}
async function ledgerRow() {
  return query(`SELECT version, name, created_by FROM supabase_migrations.schema_migrations
    WHERE version = '${VERSION}';`);
}

// ── BEFORE snapshot ──
out.before = { at: now(), defs: await constraintDefs(), ledger: await ledgerRow() };
console.log('=== BEFORE ===');
console.log(JSON.stringify(out.before, null, 2));

if (!APPLY) {
  console.log('\n[dry-run] --apply 미지정 → 실적용·enforcement write 없음. 계획만 출력.');
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

// ── 1) prod 실적용 (idempotent re-apply) ──
out.applied_at = now();
const r = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'T-20260713-CHK-UNENFORCED-fixreq' });
console.log(`\n✓ 실적용 완료 @ ${out.applied_at} — ${r.name} (원장 idempotent 기록)`);
out.apply_result = r;

// ── 2) AFTER snapshot ──
out.after = { at: now(), defs: await constraintDefs(), ledger: await ledgerRow() };
console.log('=== AFTER ===');
console.log(JSON.stringify(out.after, null, 2));

// ── 3) enforcement POSTCHECK ──
const clinicRows = await query(`SELECT id FROM public.clinics ORDER BY created_at NULLS LAST LIMIT 1;`);
const CLINIC = clinicRows?.[0]?.id;
if (!CLINIC) throw new Error('실재 clinic_id 조회 실패 — enforcement 테스트 중단');
out.test_clinic_id = CLINIC;

async function runCase({ label, sql, expect }) {
  let sqlstate = null, message = null, ok = false;
  try {
    await query(sql);
    // 예외 없이 통과하면 DO-block RAISE 가 안 걸린 것 = 설계상 불가(항상 RAISE). 방어적 처리.
    sqlstate = 'NO_ERROR';
    message = '(no exception raised — unexpected)';
  } catch (e) {
    const m = String(e.message);
    // Management API 오류 포맷: `ERROR:  23514: ...` / `ERROR:  P0001: ROLLBACK_OK`
    sqlstate = (m.match(/ERROR:\s+([0-9A-Z]{5}):/) || m.match(/"code":"([A-Z0-9]+)"/) || m.match(/SQLSTATE (\w+)/) || [])[1] || 'UNKNOWN';
    message = m;
  }
  if (expect === 'REJECT') ok = sqlstate === '23514' && /phone_e164_chk/.test(message);
  if (expect === 'ACCEPT') ok = sqlstate === 'P0001' && /ROLLBACK_OK/.test(message);
  const verdict = ok ? 'PASS' : 'FAIL';
  console.log(`  [${verdict}] ${label} → sqlstate=${sqlstate} (expect ${expect})`);
  return { label, expect, sqlstate, ok, verdict, message };
}

const custIns = (phone) => `DO $$ BEGIN
  INSERT INTO public.customers(clinic_id, name, phone, chart_number)
    VALUES ('${CLINIC}', 'E164_POSTCHECK', '${phone}', 'E164TEST-'||gen_random_uuid());
  RAISE EXCEPTION 'ROLLBACK_OK';
END $$;`;
const custUpd = (phone) => `DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.customers LIMIT 1;
  UPDATE public.customers SET phone='${phone}' WHERE id=v_id;
  RAISE EXCEPTION 'ROLLBACK_OK';
END $$;`;
const resvIns = (phone) => `DO $$ BEGIN
  INSERT INTO public.reservations(clinic_id, reservation_date, reservation_time, customer_phone)
    VALUES ('${CLINIC}', CURRENT_DATE, '10:00', '${phone}');
  RAISE EXCEPTION 'ROLLBACK_OK';
END $$;`;
const resvUpd = (phone) => `DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.reservations LIMIT 1;
  UPDATE public.reservations SET customer_phone='${phone}' WHERE id=v_id;
  RAISE EXCEPTION 'ROLLBACK_OK';
END $$;`;

const cases = [
  // customers — REJECT 로컬표기 (INSERT + UPDATE)
  { label: "customers INSERT phone='01012345678' (KR local)", sql: custIns('01012345678'), expect: 'REJECT' },
  { label: "customers INSERT phone='010-1234-5678' (KR hyphen)", sql: custIns('010-1234-5678'), expect: 'REJECT' },
  { label: "customers UPDATE phone='010-1234-5678' (KR hyphen)", sql: custUpd('010-1234-5678'), expect: 'REJECT' },
  // customers — ACCEPT E.164 (KR/JP/CN)
  { label: "customers INSERT phone='+821012345678' (KR E.164)", sql: custIns('+821012345678'), expect: 'ACCEPT' },
  { label: "customers INSERT phone='+819012345678' (JP E.164)", sql: custIns('+819012345678'), expect: 'ACCEPT' },
  { label: "customers INSERT phone='+8613800138000' (CN E.164)", sql: custIns('+8613800138000'), expect: 'ACCEPT' },
  // reservations — REJECT 로컬표기 (INSERT + UPDATE)
  { label: "reservations INSERT customer_phone='01012345678' (KR local)", sql: resvIns('01012345678'), expect: 'REJECT' },
  { label: "reservations INSERT customer_phone='010-1234-5678' (KR hyphen)", sql: resvIns('010-1234-5678'), expect: 'REJECT' },
  { label: "reservations UPDATE customer_phone='010-1234-5678' (KR hyphen)", sql: resvUpd('010-1234-5678'), expect: 'REJECT' },
  // reservations — ACCEPT E.164 (KR/JP/CN)
  { label: "reservations INSERT customer_phone='+821012345678' (KR E.164)", sql: resvIns('+821012345678'), expect: 'ACCEPT' },
  { label: "reservations INSERT customer_phone='+819012345678' (JP E.164)", sql: resvIns('+819012345678'), expect: 'ACCEPT' },
  { label: "reservations INSERT customer_phone='+8613800138000' (CN E.164)", sql: resvIns('+8613800138000'), expect: 'ACCEPT' },
];

console.log('\n=== enforcement POSTCHECK (DO-block forced-rollback, 0 persistence) ===');
out.postcheck = [];
for (const c of cases) out.postcheck.push(await runCase(c));

// ── 오염 잔존행 무변경 확인 (NOT VALID 유지 실증) ──
const contam = await query(`SELECT
  (SELECT count(*) FROM public.customers WHERE phone IS NOT NULL AND phone NOT LIKE 'DUMMY-%'
     AND phone <> '+821000000000' AND phone !~ '^\\+82(1[016789]\\d{7,8})$' AND phone !~ '^\\+(?!82)[1-9]\\d{6,14}$') AS customers_contam,
  (SELECT count(*) FROM public.reservations WHERE customer_phone IS NOT NULL AND customer_phone NOT LIKE 'DUMMY-%'
     AND customer_phone <> '+821000000000' AND customer_phone !~ '^\\+82(1[016789]\\d{7,8})$' AND customer_phone !~ '^\\+(?!82)[1-9]\\d{6,14}$') AS reservations_contam;`);
out.contam_rows = contam?.[0];
console.log('\n=== 오염 잔존행(NOT VALID 유지 — Step2 백필 대상, 본 티켓 무접점) ===');
console.log(JSON.stringify(out.contam_rows));

const pass = out.postcheck.filter((p) => p.ok).length;
const fail = out.postcheck.length - pass;
out.summary = { total: out.postcheck.length, pass, fail };
console.log(`\n=== SUMMARY: ${pass}/${out.postcheck.length} PASS, ${fail} FAIL ===`);

out.finished_at = now();
console.log('\n<<<EVIDENCE_JSON>>>');
console.log(JSON.stringify(out, null, 2));
process.exit(fail ? 1 : 0);
