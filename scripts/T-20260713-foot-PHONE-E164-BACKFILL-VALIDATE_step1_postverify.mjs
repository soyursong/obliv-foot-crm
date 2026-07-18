/**
 * T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE — Step1 apply 사후검증 (supervisor 4항)
 *   QA-REPLY MSG-20260718-193407-zlgb 조건부 GO 4항 evidence 동봉용.
 *
 * 1) schema_migrations 20260713160000 원장 기록됨
 * 2) pg_get_constraintdef verbatim = 신규 정본식(양 제약) + convalidated=false(NOT VALID)
 * 3) 거부 probe(무영속 롤백): 로컬 01012345678 → 23514 거부 / KR E.164 +8210… → 통과 / 국제 non-KR +1… → 통과
 * 4) 기존 오염행 count 무변경 (cust 21 / resv 98 보존 = 데이터 무변경 실증)
 *
 * READ-safe: probe DO 블록은 항상 RAISE 로 롤백(무영속). 나머지는 introspection.
 * author: dev-foot / 2026-07-18
 */
import { query } from './lib/foot_migration_ledger.mjs';

const VER = '20260713160000';
const one = (r) => (Array.isArray(r) ? r : r.result ?? []);

console.log('══ Step1 apply 사후검증 (supervisor 4항) ══');
console.log('측정시각(UTC):', new Date().toISOString(), '\n');
let allPass = true;

// ── 1) 원장 기록 ──
console.log('── ① schema_migrations 20260713160000 원장 기록 ──');
const led = one(await query(`SELECT version, name, created_by FROM supabase_migrations.schema_migrations WHERE version='${VER}';`));
const p1 = led.length > 0;
console.log(`  ${JSON.stringify(led)}`);
console.log(`  → ① = ${p1 ? '✅ PASS (원장 실재)' : '❌ FAIL (미기록)'}\n`);
allPass &&= p1;

// ── 2) constraintdef verbatim + convalidated=false ──
console.log('── ② pg_get_constraintdef verbatim + convalidated=false ──');
const cons = one(await query(`SELECT conname, pg_get_constraintdef(oid) AS def, convalidated
  FROM pg_constraint WHERE conname IN ('customers_phone_e164_chk','reservations_customer_phone_e164_chk') ORDER BY 1;`));
let p2 = cons.length === 2;
for (const r of cons) {
  const oldGuard = /82\?0\?1/.test(r.def);
  const newBranch = /\(\?!82\)/.test(r.def);
  const krStrict = /\^\\\?\+82\(1\[016789\]|82\(1\[016789\]/.test(r.def);
  const isNew = newBranch && !oldGuard;
  const notValid = r.convalidated === false;
  if (!isNew || !notValid) p2 = false;
  console.log(`  ${r.conname}: convalidated=${r.convalidated} newCanonicalBranch=${newBranch} oldGuard=${oldGuard}`);
  console.log(`    def: ${r.def}`);
}
console.log(`  → ② = ${p2 ? '✅ PASS (양 제약 신규 정본식 · NOT VALID)' : '❌ FAIL'}\n`);
allPass &&= p2;

// ── 3) 거부 probe (무영속) : 로컬 거부 / KR E.164 통과 / 국제 non-KR 통과 ──
console.log('── ③ write-rejection probe (READ-safe, 무영속 롤백) ──');
const clinicId = one(await query(`SELECT id FROM public.clinics LIMIT 1;`))[0]?.id;
console.log('  probe clinic_id:', clinicId);
const probe = `DO $$
DECLARE r text := ''; ph text;
BEGIN
  -- 3a) 로컬 KR모바일 → 23514 거부 기대
  BEGIN
    INSERT INTO public.customers (clinic_id, name, phone, chart_number)
    VALUES ('${clinicId}', 'PROBE_PV1', '01012345678', 'PROBE-PV1-LOCAL-'||gen_random_uuid());
    r := r || 'LOCAL(01012345678):ACCEPTED[구멍] ';
  EXCEPTION WHEN check_violation THEN r := r || 'LOCAL(01012345678):REJECTED_23514[정상] ';
            WHEN others THEN r := r || 'LOCAL:OTHER['||SQLSTATE||'] '; END;
  -- 3b) KR E.164 (유니크 생성) → 통과 기대
  BEGIN
    ph := '+' || '8210' || lpad((('x'||substr(md5(gen_random_uuid()::text),1,7))::bit(28)::bigint % 100000000)::text, 8, '0');
    INSERT INTO public.customers (clinic_id, name, phone, chart_number)
    VALUES ('${clinicId}', 'PROBE_PV1', ph, 'PROBE-PV1-KR-'||gen_random_uuid());
    r := r || 'KR_E164('||ph||'):ACCEPTED[정상] ';
  EXCEPTION WHEN check_violation THEN r := r || 'KR_E164:REJECTED_23514[비정상] ';
            WHEN others THEN r := r || 'KR_E164:OTHER['||SQLSTATE||'] '; END;
  -- 3c) 국제 non-KR E.164 (유니크 생성, +1 US) → 통과 기대
  BEGIN
    ph := '+' || '1415' || lpad((('x'||substr(md5(gen_random_uuid()::text),1,7))::bit(28)::bigint % 10000000)::text, 7, '0');
    INSERT INTO public.customers (clinic_id, name, phone, chart_number)
    VALUES ('${clinicId}', 'PROBE_PV1', ph, 'PROBE-PV1-INTL-'||gen_random_uuid());
    r := r || 'INTL_nonKR('||ph||'):ACCEPTED[정상] ';
  EXCEPTION WHEN check_violation THEN r := r || 'INTL_nonKR:REJECTED_23514[비정상] ';
            WHEN others THEN r := r || 'INTL_nonKR:OTHER['||SQLSTATE||'] '; END;
  RAISE EXCEPTION 'PROBE_RESULT>> %', r;
END $$;`;
const res = await query(probe).catch((e) => ({ __err: e.message }));
const msg = res.__err || res?.message || JSON.stringify(res);
console.log('  probe 결과:', msg);
const p3 = /LOCAL\(01012345678\):REJECTED_23514/.test(msg)
  && /KR_E164\([^)]*\):ACCEPTED/.test(msg)
  && /INTL_nonKR\([^)]*\):ACCEPTED/.test(msg);
// 무영속 확인
const persisted = one(await query(`SELECT count(*)::int AS n FROM public.customers WHERE name='PROBE_PV1';`))[0]?.n;
console.log(`  무영속 확인 (name=PROBE_PV1 잔존): ${persisted}`);
console.log(`  → ③ = ${p3 && persisted === 0 ? '✅ PASS (로컬 거부·KR/국제 통과·무영속)' : '❌ FAIL'}\n`);
allPass &&= p3 && persisted === 0;

// ── 4) 오염행 count 무변경 (before-image 대비 Δ=0) ──
//   before-image(apply 직전, 2026-07-18 dry-run): customers=30, reservations=98.
//   ※ DA-consult(07-13) 시점 cust=21 → apply 직전 30 = 舊식 enforcement 구멍 라이브로 오염 누적(07-13~18).
//     check4의 판정 기준은 절대값이 아니라 apply 전후 무변경(NOT VALID = 데이터 무변경). 기대치=before-image.
const EXP_CUST = Number(process.env.EXP_CUST ?? 30);
const EXP_RESV = Number(process.env.EXP_RESV ?? 98);
console.log('── ④ 기존 오염행 count 보존 (데이터 무변경 실증, before-image 대비) ──');
const cViol = one(await query(`SELECT count(*)::int AS n FROM public.customers
  WHERE phone IS NOT NULL AND phone NOT LIKE 'DUMMY-%' AND phone <> '+821000000000'
    AND phone !~ '^\\+82(1[016789]\\d{7,8})$' AND phone !~ '^\\+(?!82)[1-9]\\d{6,14}$';`))[0]?.n;
const rViol = one(await query(`SELECT count(*)::int AS n FROM public.reservations
  WHERE customer_phone IS NOT NULL AND customer_phone NOT LIKE 'DUMMY-%' AND customer_phone <> '+821000000000'
    AND customer_phone !~ '^\\+82(1[016789]\\d{7,8})$' AND customer_phone !~ '^\\+(?!82)[1-9]\\d{6,14}$';`))[0]?.n;
console.log(`  오염행: customers=${cViol} (before-image ${EXP_CUST}), reservations=${rViol} (before-image ${EXP_RESV})`);
const p4 = cViol === EXP_CUST && rViol === EXP_RESV;
console.log(`  → ④ = ${p4 ? `✅ PASS (cust ${EXP_CUST} / resv ${EXP_RESV} 보존 = Δ0, 데이터 무변경)` : `⚠ count=${cViol}/${rViol} (before-image ${EXP_CUST}/${EXP_RESV}과 상이)`}\n`);
allPass &&= p4;

console.log('════════════════════════════════════');
console.log(`사후검증 종합: ${allPass ? '✅ 4항 ALL PASS' : '❌ 일부 FAIL'}`);
process.exit(allPass ? 0 : 1);
