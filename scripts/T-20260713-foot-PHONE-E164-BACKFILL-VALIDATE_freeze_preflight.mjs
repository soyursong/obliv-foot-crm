/**
 * Step2 FREEZE + §3-5 CHECK-domain PREFLIGHT — T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE
 * READ-ONLY on prod (temp-table eval rolled back). Writes resolved freeze set OFF-GIT.
 *
 * data_correction_backfill_sop 준수:
 *   §3-1 freeze     : 명시 PK VALUES 박제 (dryrun 재조회로 현재 suspect PK 고정)
 *   §3-2 스냅샷      : 판정근거(old·created_at·updated_at·candidate·disposition) off-git
 *   §3-5 preflight  : touched 컬럼(phone/customer_phone)의 verbatim-pull CHECK + UNIQUE(clinic_id,phone) + NOT NULL
 *                     정정-후 값 전수 사전평가. 위반 = exit≠0 + offender 리포트 (강제 UPDATE 금지).
 *
 * 정정후값 결정(per-row triage):
 *   customers  NORMALIZE : KR-mobile → +82 E.164 (dryrun candidate)
 *   customers  RESIDUAL  : junk(4자리/allzero) → DUMMY-<uuid> (시스템 native dummy 규약, UNIQUE-safe, 트리거가 phone_dummy=true 파생)
 *   resv       NORMALIZE : KR-mobile → +82 E.164
 *   resv       RESIDUAL  : junk → NULL (nullable·CHECK-permitted·정직, under-correct≫over-correct)
 *
 * PHI 위생(§4): 실 phone 값은 OFF-GIT freeze json 에만. git-tracked stdout = 카운트/판정만.
 * author: dev-foot / 2026-07-18
 */
import { query } from './lib/foot_migration_ledger.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const one = (r) => (Array.isArray(r) ? r : r.result ?? []);
const OUT = process.env.HOME + '/foot-backfill-artifacts/T-20260713-PHONE-E164';
mkdirSync(OUT, { recursive: true });

const KR_E164 = /^\+82(1[016789]\d{7,8})$/;

// ── 1) FREEZE: 현재 suspect set 재조회 (명시 PK 박제) ──────────────────────
function suspectSQL(table, col) {
  return `
  WITH base AS (
    SELECT id, clinic_id, ${col} AS phone, created_at, updated_at,
           regexp_replace(${col}, '[^0-9]', '', 'g') AS digits
    FROM public.${table}
    WHERE ${col} IS NOT NULL AND ${col} NOT LIKE 'DUMMY-%' AND ${col} <> '+821000000000'
      AND ${col} !~ '^\\+82(1[016789]\\d{7,8})$' AND ${col} !~ '^\\+(?!82)[1-9]\\d{6,14}$'
  )
  SELECT *, CASE
      WHEN digits ~ '^01[016789]\\d{7,8}$'  THEN '+82' || substring(digits from 2)
      WHEN digits ~ '^821[016789]\\d{7,8}$' THEN '+'   || digits
      ELSE NULL END AS candidate
  FROM base ORDER BY created_at`;
}

async function buildFreeze(table, col, residualNewFn) {
  const rows = one(await query(suspectSQL(table, col)));
  return rows.map((r) => {
    const isNorm = r.candidate && KR_E164.test(r.candidate);
    return {
      id: r.id, clinic_id: r.clinic_id, old: r.phone, digits: r.digits,
      created_at: r.created_at, updated_at: r.updated_at,
      disposition: isNorm ? 'NORMALIZE' : 'RESIDUAL',
      new: isNorm ? r.candidate : residualNewFn(r),
    };
  });
}

// residual 정정후값: customers → DUMMY-uuid, reservations → NULL
const custFreeze = await buildFreeze('customers', 'phone', () => 'DUMMY-' + randomUUID());
const resvFreeze = await buildFreeze('reservations', 'customer_phone', () => null);

console.log('══ Step2 FREEZE + §3-5 PREFLIGHT ══');
console.log('측정시각(UTC):', new Date().toISOString());
const summarize = (name, fr) => {
  const n = fr.filter((r) => r.disposition === 'NORMALIZE').length;
  const rz = fr.filter((r) => r.disposition === 'RESIDUAL').length;
  console.log(`  ${name}: total=${fr.length}  NORMALIZE=${n}  RESIDUAL=${rz}`);
};
summarize('customers ', custFreeze);
summarize('reservations', resvFreeze);

// ── 2) §3-5 PREFLIGHT — verbatim CHECK 사전평가 (Postgres self-eval) ────────
// pg_get_constraintdef → 'CHECK (( <expr> ))'. exprbody 를 VALUES 후보에 그대로 태워 Postgres 가 평가.
async function checkPreflight(table, col, conname, freeze) {
  const def = one(await query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname='${conname}';`))[0].d;
  const exprbody = def.replace(/^CHECK\s*/i, '').replace(/\s*NOT\s+VALID\s*$/i, ''); // '(( phone IS NULL OR ... ))' (strip NOT VALID suffix)
  const esc = (s) => (s === null ? 'NULL::text' : `'${String(s).replace(/'/g, "''")}'`);
  const valuesList = freeze.map((r, i) => `(${i}, ${esc(r.new)})`).join(',');
  // 후보 컬럼을 제약이 참조하는 실제 컬럼명(col)으로 alias → verbatim expr 그대로 평가
  const sql = `WITH cand(idx, ${col}) AS (VALUES ${valuesList})
    SELECT idx FROM cand WHERE NOT (${exprbody});`;
  const offenders = one(await query(sql)).map((r) => r.idx);
  return { def, offenders: offenders.map((i) => freeze[i]) };
}

let pass = true;
const custChk = await checkPreflight('customers', 'phone', 'customers_phone_e164_chk', custFreeze);
const resvChk = await checkPreflight('reservations', 'customer_phone', 'reservations_customer_phone_e164_chk', resvFreeze);
console.log('\n── ① CHECK verbatim 사전평가 ──');
console.log(`  customers    CHECK-offenders: ${custChk.offenders.length}`);
console.log(`  reservations CHECK-offenders: ${resvChk.offenders.length}`);
if (custChk.offenders.length || resvChk.offenders.length) {
  pass = false;
  console.log('  ❌ CHECK 위반 후보 존재 → 정정후값 재triage 필요 (id-tail):');
  [...custChk.offenders, ...resvChk.offenders].forEach((o) => console.log(`     ...${String(o.id).slice(-6)} disp=${o.disposition}`));
}

// ── 3) NOT NULL — customers.phone 정정후값 NULL 불가 ──────────────────────
console.log('\n── ② NOT NULL (customers.phone) ──');
const nullOffenders = custFreeze.filter((r) => r.new === null || r.new === undefined || r.new === '');
console.log(`  customers NULL-offenders: ${nullOffenders.length} (기대 0, customers.phone NOT NULL)`);
if (nullOffenders.length) { pass = false; console.log('  ❌'); }

// ── 4) UNIQUE(clinic_id, phone) — customers: 기존셋 + freeze 내부 양방 충돌 ──
console.log('\n── ③ UNIQUE(clinic_id, phone) — customers ──');
// (a) 기존셋 충돌: freeze 정정후 (clinic_id,new) 가 freeze 밖 기존행과 충돌하는가
const freezeIds = custFreeze.map((r) => `'${r.id}'`).join(',');
const tuples = custFreeze.filter((r) => r.new && !String(r.new).startsWith('DUMMY-')) // DUMMY-uuid 는 유일 → 기존충돌 불가
  .map((r) => `('${r.clinic_id}','${String(r.new).replace(/'/g, "''")}')`);
let existColl = [];
if (tuples.length) {
  existColl = one(await query(`SELECT c.clinic_id, c.phone FROM public.customers c
    WHERE (c.clinic_id, c.phone) IN (${tuples.join(',')}) AND c.id NOT IN (${freezeIds});`));
}
console.log(`  (a) 기존행 충돌: ${existColl.length} (기대 0)`);
// (b) freeze 내부 충돌: 같은 clinic 에서 동일 정정후값 2건 이상
const intra = {};
for (const r of custFreeze) { const k = r.clinic_id + '|' + r.new; intra[k] = (intra[k] || 0) + 1; }
const intraColl = Object.entries(intra).filter(([, n]) => n > 1);
console.log(`  (b) freeze 내부 충돌: ${intraColl.length} (기대 0)`);
if (existColl.length || intraColl.length) {
  pass = false;
  console.log('  ❌ UNIQUE 충돌 → 정규화후 중복 (동일 clinic 동일번호). per-row triage 필요.');
  existColl.forEach((c) => console.log(`     기존충돌 clinic ...${String(c.clinic_id).slice(-6)}`));
  intraColl.forEach(([k, n]) => console.log(`     내부충돌 ${k.split('|')[0].slice(-6)} x${n}`));
}

// ── 5) FREEZE 스냅샷 저장 (OFF-GIT, 판정근거 포함) ──────────────────────────
const freezeDoc = {
  note: 'OFF-GIT PHI ARTIFACT — do not commit (SOP §4). before-image + resolved new values.',
  generated_utc: new Date().toISOString(),
  enforcement_live_utc: '2026-07-18T10:39:00Z',
  customers: custFreeze, reservations: resvFreeze,
  preflight: {
    customers_check_def: custChk.def, reservations_check_def: resvChk.def,
    check_offenders: custChk.offenders.length + resvChk.offenders.length,
    notnull_offenders: nullOffenders.length,
    unique_existing_collisions: existColl.length, unique_intra_collisions: intraColl.length,
    pass,
  },
};
writeFileSync(`${OUT}/freeze_resolved.json`, JSON.stringify(freezeDoc, null, 2));
console.log(`\nfreeze 스냅샷(off-git): ${OUT}/freeze_resolved.json`);
console.log('════════════════════════════════════');
console.log(`§3-5 PREFLIGHT 종합: ${pass ? '✅ ALL PASS (apply GO)' : '❌ FAIL (apply BLOCK — triage)'}`);
process.exit(pass ? 0 : 1);
