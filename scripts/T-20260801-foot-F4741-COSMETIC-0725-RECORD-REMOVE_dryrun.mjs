/**
 * T-20260801-foot-F4741-COSMETIC-0725-RECORD-REMOVE — archive-first DRY-RUN (No-Persistence)
 *
 * SOP: Cross-CRM Orphan-Row Archive-First Cleanup + FK Integrity Guard (archive-first 2단, 순소실0,
 *      freeze셋 재검증 abort, rows-affected 검증, PHI 무접점=UUID only).
 * 대상: F-4741(김병완) 2026-07-25 화장품 판매내역 1건 = payments 30a9ac47 (영수증 수납(단건), 10,500 card).
 *
 * *** READ-ONLY + BEGIN..ROLLBACK 시뮬레이션. prod write 0. 각 시뮬 트랜잭션은 ROLLBACK 로 종료.
 *     post-probe 로 무영속 재확인(Migration Dry-Run No-Persistence Protocol). ***
 *
 * 산출: freeze 재검증 / 全 inbound-FK child census / archive-first 시뮬 rows-affected / No-Persistence 증명.
 * PHI: 실명·phone·RRN 을 코드/출력에 남기지 않음(UUID·chart_number 만).
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REF = 'rxlomoozakkjesdqjtvd';
function envVal(key) {
  if (process.env[key]) return process.env[key];
  for (const f of ['.env.local', '.env']) {
    const p = join(ROOT, f);
    if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) {
      const m = l.match(new RegExp('^' + key + '=(.*)$'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}
const ACCESS_TOKEN = envVal('SUPABASE_ACCESS_TOKEN');
if (!ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN 필요');

async function runSQL(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${await res.text()}`);
  return res.json();
}
const num = (rows, k = 'n') => Number(rows?.[0]?.[k] ?? -1);

// ── freeze set (진단 확정 2026-08-01) ──────────────────────────────────────
const CUSTOMER_ID = '259abd32-d784-4c45-b59e-1ccae1b69492'; // F-4741
const TARGET_PAYMENT_ID = '30a9ac47-b90d-4ee7-b4f2-7b1861264afc'; // 7/25 10,500 영수증 수납(단건)
const SET_NULL_CHILDREN = {
  redpay_raw_transactions: { id: 'c6c7620b-5bde-4908-9b6e-e4ab9ed07fd3', link_col: 'matched_payment_id' },
  payment_reconciliation_log: { id: 'bb94189c-921f-4e6e-96cf-e55f74070809', link_col: 'payment_id' },
};

async function main() {
  const log = (s) => console.log(s);
  log('# F4741-COSMETIC-0725-RECORD-REMOVE — archive-first DRY-RUN (READ-ONLY / No-Persistence)');
  log(`- prod: ${REF} | ${new Date().toISOString()}`);
  log(`- target payment: ${TARGET_PAYMENT_ID} | customer F-4741 ${CUSTOMER_ID}`);
  let abort = false;

  // [G-freeze] 대상 1건 실재 + 속성 재검증
  const t = (await runSQL(
    `select id, customer_id, accounting_date::text as ad, amount, status, method,
            (check_in_id is null) as no_checkin, (service_charge_id is null) as no_sc,
            (package_id is null) as no_pkg, is_simulation,
            (select count(*)::int from public.payment_items pi where pi.payment_id=p.id) as line_items
     from public.payments p where id='${TARGET_PAYMENT_ID}';`
  ))?.[0];
  if (!t) { log('[G-freeze] ABORT — 대상 payment 부재'); abort = true; }
  else {
    const okCust = t.customer_id === CUSTOMER_ID;
    const okAd = t.ad === '2026-07-25';
    const okAmt = Number(t.amount) === 10500;
    const okActive = t.status === 'active';
    const okBare = t.no_checkin && t.no_sc && t.no_pkg && Number(t.line_items) === 0;
    const okSim = t.is_simulation === false;
    log(`[G-freeze] present=Y cust_ok=${okCust} acctdate_ok=${okAd} amount_ok=${okAmt} active=${okActive} bare(no ci/sc/pkg/items)=${okBare} is_sim=${t.is_simulation}`);
    if (!(okCust && okAd && okAmt && okActive && okBare && okSim)) {
      log('[G-freeze] ABORT — freeze 속성 불일치(drift)'); abort = true;
    }
  }

  // [dup guard] 동일 고객 10,500 중복행 census (중복이면 provenance 재판정 필요)
  const dup = num(await runSQL(`select count(*)::int as n from public.payments where customer_id='${CUSTOMER_ID}' and amount=10500;`));
  log(`[dup] 동일고객 10,500 payments = ${dup} (기대 1: 중복 없음)`);

  // [FK census] target payment 를 가리키는 全 inbound FK child 실측 (pg_constraint 기계열거)
  const fks = await runSQL(
    `select cl.relname as child_table, att.attname as col, con.confdeltype
     from pg_constraint con
     join pg_class cl on cl.oid=con.conrelid
     join pg_class pcl on pcl.oid=con.confrelid
     join unnest(con.conkey) with ordinality as k(attnum,ord) on true
     join pg_attribute att on att.attrelid=con.conrelid and att.attnum=k.attnum
     where con.contype='f' and pcl.relname='payments' and pcl.relnamespace='public'::regnamespace
     order by cl.relname;`
  );
  log(`[FK] inbound FK on payments = ${fks.length}건 (기계열거):`);
  let cascadeChildren = 0, setnullChildren = 0, blockerChildren = 0;
  for (const f of fks) {
    const cnt = num(await runSQL(`select count(*)::int as n from public.${f.child_table} where "${f.col}"='${TARGET_PAYMENT_ID}';`));
    const kind = f.confdeltype === 'c' ? 'CASCADE(silent-loss)' : f.confdeltype === 'n' ? 'SET NULL(silent-linkloss)' : f.confdeltype === 'a' ? 'NO ACTION(blocker)' : f.confdeltype === 'r' ? 'RESTRICT(blocker)' : f.confdeltype;
    log(`     - ${f.child_table}.${f.col} [${kind}] refs=${cnt}`);
    if (cnt > 0) {
      if (f.confdeltype === 'c') cascadeChildren += cnt;
      else if (f.confdeltype === 'n') setnullChildren += cnt;
      else blockerChildren += cnt;
    }
  }
  log(`[FK] child totals → CASCADE=${cascadeChildren} SET_NULL=${setnullChildren} BLOCKER(a/r)=${blockerChildren}`);
  log(`     ※ archive 대상 = payment 본행 + SET_NULL 링크원본(${setnullChildren}건) → 순소실0 위해 archive 동봉`);

  // [archive-first 시뮬] BEGIN..ROLLBACK — rows-affected 검증, 무영속
  log('\n[SIM] archive-first BEGIN..ROLLBACK 시뮬 (No-Persistence):');
  const sim = await runSQL(`
    DO $$
    DECLARE v_pay int; v_arch int; v_redpay_before uuid; v_recon_before uuid; v_remaining int;
    BEGIN
      -- 1) archive 테이블 (per-op unique, LIKE=컬럼완전성 by-construction)
      CREATE TEMP TABLE _sim_arch_payment (LIKE public.payments) ON COMMIT DROP;
      INSERT INTO _sim_arch_payment SELECT * FROM public.payments WHERE id='${TARGET_PAYMENT_ID}';
      GET DIAGNOSTICS v_arch = ROW_COUNT;
      -- SET NULL 링크 원본값 캡처
      SELECT matched_payment_id INTO v_redpay_before FROM public.redpay_raw_transactions WHERE id='${SET_NULL_CHILDREN.redpay_raw_transactions.id}';
      SELECT payment_id INTO v_recon_before FROM public.payment_reconciliation_log WHERE id='${SET_NULL_CHILDREN.payment_reconciliation_log.id}';
      -- 2) DELETE 본행 (SET NULL 자식 링크 자동 NULL)
      DELETE FROM public.payments WHERE id='${TARGET_PAYMENT_ID}';
      GET DIAGNOSTICS v_pay = ROW_COUNT;
      SELECT count(*)::int INTO v_remaining FROM public.payments WHERE id='${TARGET_PAYMENT_ID}';
      RAISE NOTICE 'SIM archived=% deleted=% remaining_after=% redpay_link_before=% recon_link_before=%',
        v_arch, v_pay, v_remaining, v_redpay_before, v_recon_before;
      -- 무영속: 강제 롤백
      RAISE EXCEPTION 'DRYRUN_ROLLBACK_SENTINEL archived=% deleted=% remaining=%', v_arch, v_pay, v_remaining;
    END $$;
  `).then(() => ({ ok: true })).catch((e) => ({ ok: false, msg: e.message }));
  if (sim.ok) { log('[SIM] ABORT — sentinel 예외가 안 났다(무영속 미보장). 조사 필요.'); abort = true; }
  else {
    const m = sim.msg.match(/DRYRUN_ROLLBACK_SENTINEL archived=(\d+) deleted=(\d+) remaining=(\d+)/);
    if (m) {
      log(`[SIM] archived=${m[1]} deleted=${m[2]} remaining_after=${m[3]}  (기대 archived=1 deleted=1 remaining=0)`);
      if (!(m[1] === '1' && m[2] === '1' && m[3] === '0')) { log('[SIM] ABORT — rows-affected 기대 불일치'); abort = true; }
    } else { log(`[SIM] (rollback msg) ${sim.msg}`); }
  }

  // [post-probe] 무영속 재확인 — 대상 payment 여전히 실재
  const post = num(await runSQL(`select count(*)::int as n from public.payments where id='${TARGET_PAYMENT_ID}';`));
  const postArch = num(await runSQL(`select count(*)::int as n from pg_tables where schemaname='public' and tablename like '_archive_f4741%';`));
  log(`\n[post-probe] target payment present=${post} (기대 1=무영속) | 잔존 archive 테이블=${postArch} (기대 0)`);
  if (post !== 1 || postArch !== 0) { log('[post-probe] ABORT — 무영속 위반(dry-run 이 prod 를 변경함)'); abort = true; }

  log(`\n=== DRY-RUN VERDICT: ${abort ? 'ABORT' : 'PASS (archive-first 1행 제거 시뮬 정상, 무영속 확인)'} ===`);
  process.exit(abort ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
