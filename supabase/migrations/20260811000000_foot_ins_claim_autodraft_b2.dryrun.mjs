/**
 * T-20260810-foot-INS-CLAIM-AUTODRAFT (B-2) — DRY-RUN (No-Persistence Protocol)
 * 자동생성 마이그를 트랜잭션 안에서 적용 → 실제 급여 check_in 으로 빌더/트리거 검증 → 강제 ROLLBACK (영속 0).
 * 실제 prod 적용은 supervisor DB-GATE GO-token 이후에만 (apply_before_go — GO-token 前 prod 선집행 금지).
 *
 * 실행: SUPABASE_DB_PASSWORD 필요 (supervisor DB-GATE 보유).
 *   SUPABASE_DB_PASSWORD=... node supabase/migrations/20260811000000_foot_ins_claim_autodraft_b2.dryrun.mjs
 *
 * 검증 불변식:
 *   V1  마이그 적용 후 fn/trigger 3종 존재
 *   V2  실제 급여 service_charges 를 가진 check_in 에 fn_build_insurance_claim_draft 호출 → draft claim 1건 생성
 *   V3  claim 합계(total_base/copayment/covered) == service_charges (service_id 별 latest) VERBATIM 합계
 *   V4  claim_items 수 == 그 방문의 distinct 급여 service_id 수 (hira_code NULL 도 미탈락 = silent drop 없음)
 *   V5  재호출 멱등 — claim 수 증가 0, 합계 불변
 *   V6  트리거 경로 — 신규 급여 service_charges INSERT 시 draft claim 자동 생성
 *   전 과정 ROLLBACK → prod 영속 0
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 없음 (supervisor DB-GATE 에서 실행).'); process.exit(2); }

const client = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`✅ DB 연결  ${new Date().toISOString()}  (DRY-RUN — 끝에서 ROLLBACK)\n`);

// txn-control(BEGIN/COMMIT) 문 제거 → sentinel-bypass 차단(No-Persistence Protocol)
const migPath = 'supabase/migrations/20260811000000_foot_ins_claim_autodraft_b2.sql';
const sql = fs.readFileSync(migPath, 'utf8').split('\n')
  .filter(l => !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/i.test(l)).join('\n');

let ok = true;
const chk = (pass, label) => { console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${label}`); if (!pass) ok = false; };

try {
  await client.query('BEGIN');
  await client.query(sql);
  console.log('── 마이그 적용됨(txn 내부) ──\n');

  // V1: 객체 존재
  const objs = await client.query(`
    SELECT proname FROM pg_proc
    WHERE proname IN ('fn_build_insurance_claim_draft','trg_service_charges_autodraft','fn_rollup_insurance_claim_drafts')`);
  chk(objs.rows.length === 3, `V1 fn/trigger-fn 3종 생성 (found ${objs.rows.length}/3)`);
  const trg = await client.query(`SELECT 1 FROM pg_trigger WHERE tgname='trg_service_charges_autodraft' AND NOT tgisinternal`);
  chk(trg.rows.length === 1, 'V1 트리거 trg_service_charges_autodraft 부착');

  // 검증 대상 check_in: 급여 service_charges 를 가진 실제 방문 1건
  const pick = await client.query(`
    SELECT sc.check_in_id AS cid, count(DISTINCT sc.service_id) AS n
    FROM public.service_charges sc
    WHERE sc.is_insurance_covered = TRUE AND sc.check_in_id IS NOT NULL
    GROUP BY sc.check_in_id
    ORDER BY count(*) DESC
    LIMIT 1`);
  if (pick.rows.length === 0) {
    console.log('  ⚠ 급여 service_charges 를 가진 check_in 이 없음 — V2~V5 스킵(합성 데이터 미생성).');
  } else {
    const cid = pick.rows[0].cid;
    const distinctSvc = Number(pick.rows[0].n);
    console.log(`  대상 check_in=${cid}  distinct 급여 service=${distinctSvc}`);

    // 기대 합계(빌더와 동일 dedup 로직으로 독립 재계산 → verbatim 대조)
    const exp = await client.query(`
      SELECT COALESCE(SUM(base_amount),0) b, COALESCE(SUM(copayment_amount),0) c, COALESCE(SUM(insurance_covered_amount),0) v
      FROM (
        SELECT DISTINCT ON (sc.service_id) sc.base_amount, sc.copayment_amount, sc.insurance_covered_amount
        FROM public.service_charges sc
        WHERE sc.check_in_id=$1 AND sc.is_insurance_covered=TRUE
        ORDER BY sc.service_id, sc.calculated_at DESC NULLS LAST
      ) d`, [cid]);
    const E = exp.rows[0];

    // V2: 빌더 호출 → claim 생성
    const before = await client.query(`SELECT count(*) n FROM public.insurance_claims WHERE check_in_id=$1 AND claim_status='draft'`, [cid]);
    const built = await client.query(`SELECT public.fn_build_insurance_claim_draft($1::uuid) AS claim_id`, [cid]);
    const claimId = built.rows[0].claim_id;
    chk(!!claimId, 'V2 fn_build_insurance_claim_draft → claim_id 반환');

    const claim = await client.query(`SELECT total_base, total_copayment, total_covered, claim_status, calculation_engine_version FROM public.insurance_claims WHERE id=$1`, [claimId]);
    const C = claim.rows[0];
    chk(C.claim_status === 'draft', 'V2 claim_status=draft');

    // V3: 합계 verbatim
    chk(Number(C.total_base) === Number(E.b), `V3 total_base ${C.total_base} == service_charges ${E.b}`);
    chk(Number(C.total_copayment) === Number(E.c), `V3 total_copayment ${C.total_copayment} == ${E.c}`);
    chk(Number(C.total_covered) === Number(E.v), `V3 total_covered ${C.total_covered} == ${E.v}`);

    // V4: 항목 수 == distinct 급여 service (silent drop 없음)
    const items = await client.query(`SELECT count(*) n, count(*) FILTER (WHERE hira_code IS NULL) nnull FROM public.claim_items WHERE claim_id=$1`, [claimId]);
    chk(Number(items.rows[0].n) === distinctSvc, `V4 claim_items ${items.rows[0].n} == distinct 급여 service ${distinctSvc} (missing_code 미탈락, NULL 항목 ${items.rows[0].nnull}건 보존)`);

    // V5: 멱등 재호출
    await client.query(`SELECT public.fn_build_insurance_claim_draft($1::uuid)`, [cid]);
    const after = await client.query(`SELECT count(*) n FROM public.insurance_claims WHERE check_in_id=$1 AND claim_status='draft'`, [cid]);
    const beforeN = Number(before.rows[0].n);
    chk(Number(after.rows[0].n) === Math.max(beforeN, 1), `V5 멱등 — draft claim 수 불변 (${after.rows[0].n})`);
  }

  // V6: 트리거 경로 — 급여 service_charges INSERT 시 자동 생성
  const trgPick = await client.query(`
    SELECT ci.id cid, ci.clinic_id, ci.customer_id, s.id sid
    FROM public.check_ins ci
    JOIN public.services s ON s.clinic_id = ci.clinic_id AND s.is_insurance_covered = TRUE
    WHERE NOT EXISTS (SELECT 1 FROM public.service_charges sc WHERE sc.check_in_id=ci.id AND sc.is_insurance_covered=TRUE)
    LIMIT 1`);
  if (trgPick.rows.length === 0) {
    console.log('  ⚠ 트리거 검증용 (급여 charge 없는) check_in+급여service 조합 없음 — V6 스킵.');
  } else {
    const T = trgPick.rows[0];
    await client.query(`
      INSERT INTO public.service_charges
        (clinic_id, check_in_id, customer_id, service_id, is_insurance_covered, base_amount, insurance_covered_amount, copayment_amount, customer_grade_at_charge)
      VALUES ($1,$2,$3,$4,TRUE,10000,7000,3000,'general')`, [T.clinic_id, T.cid, T.customer_id, T.sid]);
    const auto = await client.query(`SELECT total_copayment, total_covered FROM public.insurance_claims WHERE check_in_id=$1 AND claim_status='draft'`, [T.cid]);
    chk(auto.rows.length === 1, 'V6 트리거 — 급여 charge INSERT 시 draft claim 자동 생성');
    if (auto.rows.length === 1) {
      chk(Number(auto.rows[0].total_copayment) === 3000 && Number(auto.rows[0].total_covered) === 7000,
        `V6 트리거 파생 합계 verbatim (copay=${auto.rows[0].total_copayment}, covered=${auto.rows[0].total_covered})`);
    }
  }
} catch (e) {
  ok = false;
  console.error('❌ 예외:', e.message);
} finally {
  await client.query('ROLLBACK');
  console.log('\n── ROLLBACK 완료 (prod 영속 변경 0) ──');
  // 사후 무영속 확인
  const post = await client.query(`SELECT count(*) n FROM pg_proc WHERE proname='fn_build_insurance_claim_draft'`);
  console.log(`   post-probe: fn_build_insurance_claim_draft 존재수 = ${post.rows[0].n} (0 이어야 무영속 정상)`);
  await client.end();
  console.log(ok ? '\n✅ DRY-RUN PASS' : '\n❌ DRY-RUN FAIL');
  process.exit(ok ? 0 : 1);
}
