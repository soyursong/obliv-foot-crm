/**
 * T-20260715-foot-MASKPII-CONTAM-BACKFILL — MUTATION DRY-RUN (no-persist)
 *
 * DA CONDITIONAL GO(MSG-20260723-055448-9j4x) 하 sentinel disposition 8행의
 * apply-reality 를 영속 없이 실증한다. migration_dryrun_no_persistence_standard 정합:
 *   · txn 내부 UPDATE(양축) → GET DIAGNOSTICS row_count 포착 → RAISE 로 강제 rollback → 무영속
 *   · 사후 post-probe(masked count 불변) 로 영속 0 확인
 *
 * ★ 실제 prod 영속(apply)은 하지 않는다. apply = supervisor DB-GATE. ★
 *
 * 게이트 순서:
 *   G0. 하드의존 재확인: has_trigger=true (실행시점)
 *   G1. freeze 재검증: PK8 지문 교집합 재실행 → 집합 drift 시 ABORT (SOP §3-1/§0-2-a)
 *   G2. §2-S 파생 동기필드 완전열거: reservations/closing_manual_payments masked copy = 0 확인
 *   G3. §3-5 제약 프리플라이트: sentinel post-value 가 트리거 fn + phone CHECK(verbatim) 통과
 *   G4. no-persist mutation: DO 블록 UPDATE 양축 → 카운트 포착 → RAISE rollback
 *   G5. post-probe: masked 8/11 불변(영속 0)
 *
 * author: dev-foot / 2026-07-23 (READ-ONLY: 실 영속 UPDATE 0)
 */
import { readFileSync } from 'node:fs';

const REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || (() => { throw new Error('SUPABASE_ACCESS_TOKEN required'); })();
const SENTINEL = '[재수집필요]';
const PK8 = [
  '2dc21d1c-6e9f-4643-a733-dca92252d830','44a6a076-ca66-458a-bdc5-e0a3a12c2e67',
  '512998d0-d51a-42c4-947e-b0cb2cc69da4','67ea1793-05e5-4d4a-b5c1-1ec73486e317',
  '9f2bfc0f-66a3-43c0-9e02-7055b37a4cc5','b1b5f6f7-a3c3-4c94-b9de-c744a8695e41',
  'bd307dfe-79f0-4fea-86a6-0957cea492cd','e3216e83-3037-4921-9e26-76cd14b92b1e',
];
const inList = PK8.map(x => `'${x}'`).join(',');

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const body = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, body };
}
let FAIL = false;
const line = (s) => console.log(s);

async function main() {
  line('=== T-20260715-foot-MASKPII-CONTAM-BACKFILL — MUTATION DRY-RUN (no-persist) ===\n');

  // ── G0. has_trigger 실행시점 재확인 ──
  {
    const { body } = await sql(`SELECT count(*) n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_proc p ON p.oid=t.tgfoid WHERE c.relname='customers' AND NOT t.tgisinternal
      AND t.tgenabled='O' AND p.proname='_trg_customers_reject_masked_pii'`);
    const n = Number(body?.[0]?.n ?? 0);
    line(`[G0] has_trigger(enabled=O, reject_masked_pii): ${n === 1 ? '✅ true' : '⛔ FAIL (n=' + n + ')'}`);
    if (n !== 1) FAIL = true;
  }

  // ── G1. freeze 재검증 (PK8 지문 교집합 재실행) ──
  {
    const { body } = await sql(`SELECT id::text FROM customers WHERE created_by IS NULL AND name LIKE '%*%' ORDER BY id`);
    const live = (body || []).map(r => r.id);
    const liveSet = new Set(live), frozen = new Set(PK8);
    const added = live.filter(x => !frozen.has(x));
    const removed = PK8.filter(x => !liveSet.has(x));
    const drift = added.length || removed.length;
    line(`[G1] freeze 재검증: live masked=${live.length} / frozen=${PK8.length} | drift added=${added.length} removed=${removed.length} → ${drift ? '⛔ ABORT (drift)' : '✅ 동일 집합'}`);
    if (drift) { FAIL = true; line(`     added=${added.map(x=>x.slice(0,8))} removed=${removed.map(x=>x.slice(0,8))}`); }
  }

  // ── G2. §2-S 파생 동기필드 완전열거 (denorm masked copy = 0) ──
  {
    const { body } = await sql(`SELECT
      (SELECT count(*) FROM reservations WHERE customer_id IN (${inList}) AND customer_name LIKE '%*%') resv_masked,
      (SELECT count(*) FROM closing_manual_payments WHERE customer_name LIKE '%*%') cmp_masked,
      (SELECT count(*) FROM check_ins WHERE customer_id IN (${inList}) AND customer_name LIKE '%*%') ci_masked`);
    const b = body?.[0] || {};
    line(`[G2] §2-S denorm: reservations_masked=${b.resv_masked} closing_manual_payments_masked=${b.cmp_masked} check_ins_masked=${b.ci_masked}`);
    if (Number(b.resv_masked) !== 0 || Number(b.cmp_masked) !== 0) { FAIL = true; line('     ⛔ 미열거 denorm masked copy 존재 → dual-axis 범위 재검토'); }
    else line('     ✅ dual-axis 범위 = customers.name + check_ins.customer_name 전부(외부 denorm 0)');
  }

  // ── G3. §3-5 제약 프리플라이트: sentinel post-value가 트리거 fn + phone CHECK(verbatim) 통과 ──
  {
    // 트리거 fn 을 Postgres 자신이 평가(손 regex 아님)
    const { body: t } = await sql(`SELECT count(*) FILTER (WHERE public._fn_is_masked_pii('${SENTINEL}', phone)) AS sentinel_trips,
      count(*) AS total FROM customers WHERE id IN (${inList})`);
    const trips = Number(t?.[0]?.sentinel_trips ?? -1);
    line(`[G3a] 트리거 fn(_fn_is_masked_pii) sentinel+현phone 평가: trips=${trips}/${t?.[0]?.total} → ${trips === 0 ? '✅ 비트립' : '⛔ FAIL'}`);
    if (trips !== 0) FAIL = true;

    // phone CHECK(customers_phone_e164_chk) verbatim 평가 — pg_get_constraintdef 술어를 Postgres가 평가
    const { body: cdef } = await sql(`SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname='customers_phone_e164_chk'`);
    line(`[G3b] phone CHECK def(verbatim): ${cdef?.[0]?.def?.slice(0,80)}...`);
    // name-only UPDATE → phone 미변경. NOT VALID CHECK 는 UPDATE 시 new-row 재평가 → 현 phone이 술어 통과해야 함.
    const expr = cdef?.[0]?.def?.replace(/^CHECK\s*\(\((.*)\)\)(\s+NOT VALID)?$/s, '$1');
    const { body: ph } = await sql(`SELECT count(*) FILTER (WHERE ${expr}) AS pass, count(*) AS total FROM customers WHERE id IN (${inList})`);
    const pass = Number(ph?.[0]?.pass ?? -1), tot = Number(ph?.[0]?.total ?? 0);
    line(`[G3c] 현 phone이 phone CHECK 통과(name-only UPDATE 재평가 대비): ${pass}/${tot} → ${pass === tot ? '✅ 전건 통과' : '⛔ ' + (tot-pass) + '행 위반(23514 위험)'}`);
    if (pass !== tot) FAIL = true;
  }

  // ── G4. no-persist mutation (DO 블록 UPDATE 양축 → 카운트 → RAISE rollback) ──
  {
    const doBlock = `DO $$
DECLARE nc int; ci_synced int; ci_masked_left int; ci_residual int; rv_synced int;
BEGIN
  UPDATE public.customers SET name='${SENTINEL}', updated_at=now()
    WHERE id IN (${inList}) AND created_by IS NULL AND name LIKE '%*%';
  GET DIAGNOSTICS nc = ROW_COUNT;
  -- customers.name UPDATE → trg_sync_customer_name cascade 로 check_ins/reservations 자동 전파(dual-axis)
  SELECT count(*) INTO ci_synced      FROM public.check_ins   WHERE customer_id IN (${inList}) AND customer_name='${SENTINEL}';
  SELECT count(*) INTO ci_masked_left FROM public.check_ins   WHERE customer_id IN (${inList}) AND customer_name LIKE '%*%';
  SELECT count(*) INTO rv_synced      FROM public.reservations WHERE customer_id IN (${inList}) AND customer_name='${SENTINEL}';
  -- 멱등 잔여 스윕(방어) — 기대 0행(sync 트리거가 이미 처리)
  UPDATE public.check_ins SET customer_name='${SENTINEL}'
    WHERE customer_id IN (${inList}) AND customer_name LIKE '%*%';
  GET DIAGNOSTICS ci_residual = ROW_COUNT;
  RAISE EXCEPTION 'DRYRUN_OK customers=% ci_synced=% ci_masked_left=% ci_residual=% rv_synced=%', nc, ci_synced, ci_masked_left, ci_residual, rv_synced;
END $$;`;
    const { body } = await sql(doBlock);
    const msg = body?.message || body?.error || JSON.stringify(body);
    const m = /DRYRUN_OK customers=(\d+) ci_synced=(\d+) ci_masked_left=(\d+) ci_residual=(\d+) rv_synced=(\d+)/.exec(msg || '');
    if (m) {
      const [_, nc, ciS, ciML, ciR, rvS] = m;
      line(`[G4] no-persist mutation(UPDATE 성공, 모든 트리거/제약 통과 → RAISE rollback 무영속) ✅`);
      line(`     customers=${nc}(기대8) | cascade→ check_ins sentinel=${ciS}(기대11)·masked잔여=${ciML}(기대0)·잔여스윕=${ciR}(기대0) | reservations sentinel=${rvS}(기대0)`);
      if (nc !== '8') { line('     ⛔ customers 기대 8 불일치 (abort 임계)'); FAIL = true; }
      if (ciS !== '11' || ciML !== '0') { line('     ⛔ dual-axis cascade 불완전 (check_ins 동기 실패)'); FAIL = true; }
      if (ciR !== '0') line('     ⚠ 잔여 스윕 >0 (sync 트리거 미작동 정황 — 스윕이 보정하므로 apply 안전, 경위 확인)');
    } else {
      line(`[G4] ⛔ no-persist mutation FAIL — 예상밖 에러(제약/트리거 위반 가능): ${msg}`);
      FAIL = true;
    }
  }

  // ── G5. post-probe: masked count 불변(영속 0) ──
  {
    const { body } = await sql(`SELECT
      (SELECT count(*) FROM customers WHERE created_by IS NULL AND name LIKE '%*%') cust_masked,
      (SELECT count(*) FROM check_ins WHERE customer_id IN (${inList}) AND customer_name LIKE '%*%') ci_masked`);
    const b = body?.[0] || {};
    const ok = Number(b.cust_masked) === 8 && Number(b.ci_masked) === 11;
    line(`[G5] post-probe(무영속 확인): customers_masked=${b.cust_masked}(기대8) check_ins_masked=${b.ci_masked}(기대11) → ${ok ? '✅ 영속 0' : '⛔ 영속 발생?!'}`);
    if (!ok) FAIL = true;
  }

  line(`\n=== DRY-RUN 결과: ${FAIL ? '⛔ FAIL (deploy-ready 금지)' : '✅ PASS (apply=supervisor DB-GATE)'} ===`);
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.error('[FATAL]', e.message); process.exit(2); });
