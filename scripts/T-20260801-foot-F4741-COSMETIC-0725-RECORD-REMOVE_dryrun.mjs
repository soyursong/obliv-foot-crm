/**
 * T-20260801-foot-F4741-COSMETIC-0725-RECORD-REMOVE — archive-first DRY-RUN (READ-ONLY / No-Persistence)
 *
 * ★ REGRAIN 2026-08-01 (DA-20260801-foot-F4741-RECORD-REMOVE-REGRAIN, Branch A GO 조건부).
 *   前 payments 30a9ac47(10,500) 그레인 = RETRACT-AS-MOOT(별개 bare payment·화장품 아님).
 *   정정 삭제대상 = check_in_services 풋화장품 7/25 3라인(73,000), 부모 check_in fdd5c165.
 *
 * SOP: Cross-CRM Orphan-Row Archive-First Cleanup + FK Integrity Guard  ⊕  Data-Correction Backfill SOP.
 *      (archive-first 2단, 순소실0, freeze셋 재검증 abort, rows-affected 검증, PHI 무접점=UUID only,
 *       Migration Dry-Run No-Persistence Protocol: DO..RAISE sentinel..ROLLBACK + post-probe.)
 *
 * *** READ-ONLY. prod write 0. archive-first 시뮬은 DO 블록 내 TEMP + RAISE 강제 롤백.
 *     post-probe 로 무영속 재확인. prod --apply 는 3중 게이트(DA GO + 총괄 confirm + supervisor MIG-GATE)
 *     통과 전까지 HOLD. 본 스크립트는 apply 하지 않는다. ***
 *
 * HARD 게이트 (DA Q2):
 *   #1 FK census 선행 — cis 3행 참조 자식(FK 선언 + 데이터-값) 실측. 0=clean / 존재=cascade archive 또는 ABORT.
 *   #2 soft-void 우선 — check_in_services 에 deleted_at/is_voided 등 존재 시 물리삭제보다 flag 경로.
 *      (실측: check_in_services 소프트삭제 컬럼 0 → 물리 archive-first 경로.)
 *   #3 rows-affected=3 freeze HARD — touched≠3 → ABORT.
 * Branch C 격상(→HARD NO-GO·CEO 복귀) apply-time 재검증 조건도 dry-run 에서 미리 관측:
 *   (a) 3라인 中 payment/allocation 링크 취득  (b) 8/1 twin셋 부재/미결제  (c) b7ab6496(73,000) 부재.
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

// ── freeze set (REGRAIN 확정 2026-08-01) ──────────────────────────────────
const CUSTOMER_ID = '259abd32-d784-4c45-b59e-1ccae1b69492'; // F-4741 김병완
const PARENT_CHECKIN = 'fdd5c165-8375-470e-9b9d-cad851de93a6'; // 7/25 experience(초진 의료방문) — 미접촉 불변식
// 삭제대상 = 7/25 풋화장품 3라인 (총 73,000). freeze HARD: 정확히 이 3개.
const CIS = [
  { id: 'eeb760b3-6931-4b57-b05f-979f7cc1287e', name: '풋샴푸 (200ml)',       price: 42000, svc: '89095450-223f-4863-89a9-c7f32f62809d' },
  { id: '08162a7a-aa4e-411f-9824-0f2044c9f8ff', name: 'Care Toe Band (CTB)',  price: 15000, svc: 'e17ba3a3-4842-4097-87bc-0778a64d2755' },
  { id: 'a2dbbbfa-c890-4397-bbaf-4ddf205d383f', name: '리페어 핸드크림 (30ml)', price: 16000, svc: 'cb6443a3-fe53-40e7-bd51-a4444d8a8966' },
];
const CIS_IDS = CIS.map((c) => c.id);
const SVC_IDS = CIS.map((c) => c.svc);
const EXPECT_TOTAL = 73000;
// Branch C 가드 참조
const TWIN_CIS = ['5104417a-4520-4e3b-8666-1e79f987e8e8', '37e32d58-91bd-4762-81ab-a2484f2a3bfd', '54d94955-7934-420b-bc02-6dd3904a3991'];
const GUARD_PAYMENT = 'b7ab6496-9efc-429c-9d5c-60a248eabc15'; // 8/1 73,000 card active
const inList = (arr) => arr.map((x) => `'${x}'`).join(',');

async function main() {
  const log = (s) => console.log(s);
  log('# F4741-COSMETIC-0725-RECORD-REMOVE — archive-first DRY-RUN (REGRAIN: check_in_services 3라인 / READ-ONLY)');
  log(`- prod: ${REF} | ${new Date().toISOString()}`);
  log(`- 삭제대상: 7/25 풋화장품 cis 3라인(73,000) | 부모 check_in ${PARENT_CHECKIN}(미접촉) | F-4741 ${CUSTOMER_ID}`);
  let abort = false;

  // ── [G-freeze] 대상 3행 실재 + 속성 재검증 (rows=3 HARD) ─────────────────
  const rows = await runSQL(
    `select id, check_in_id, service_name, price, original_price, is_package_session, package_session_id, seller_staff_id
     from public.check_in_services where id in (${inList(CIS_IDS)}) order by price desc;`
  );
  log(`\n[G-freeze] 대상 실재 rows = ${rows.length} (기대 3)`);
  if (rows.length !== 3) { log('[G-freeze] ABORT — 대상 3행 불일치'); abort = true; }
  let sum = 0;
  for (const c of CIS) {
    const r = rows.find((x) => x.id === c.id);
    if (!r) { log(`     - MISSING ${c.id} (${c.name})`); abort = true; continue; }
    sum += Number(r.price);
    const okName = r.service_name === c.name;
    const okPrice = Number(r.price) === c.price;
    const okParent = r.check_in_id === PARENT_CHECKIN;
    const okNoPkg = r.is_package_session === false && r.package_session_id === null;
    log(`     - ${c.id.slice(0,8)} name_ok=${okName} price_ok=${okPrice}(${r.price}) parent_ok=${okParent} no_pkg=${okNoPkg} seller=${r.seller_staff_id?.slice(0,8)}`);
    if (!(okName && okPrice && okParent && okNoPkg)) { log('       └ ABORT — freeze 속성 drift'); abort = true; }
  }
  log(`[G-freeze] 합계 = ${sum} (기대 ${EXPECT_TOTAL})`);
  if (sum !== EXPECT_TOTAL) { log('[G-freeze] ABORT — 금액합 불일치'); abort = true; }

  // ── [G-parent] 부모 check_in 상태 + 7/25 payments=0(미결제) ──────────────
  const parent = (await runSQL(
    `select id, visit_type, status, deleted_at,
            (select count(*)::int from public.payments pm where pm.check_in_id=ci.id) as pay_n
     from public.check_ins ci where ci.id='${PARENT_CHECKIN}';`
  ))?.[0];
  if (!parent) { log('\n[G-parent] ABORT — 부모 check_in 부재'); abort = true; }
  else {
    log(`\n[G-parent] check_in ${PARENT_CHECKIN.slice(0,8)} visit=${parent.visit_type} status=${parent.status} deleted_at=${parent.deleted_at} payments_on_checkin=${parent.pay_n} (기대 0=미결제)`);
    if (Number(parent.pay_n) !== 0) { log('[G-parent] WARN(Branch-C후보) — 부모 check_in 에 payment 존재. apply-time 정밀 재검증 필수'); }
  }

  // ── [HARD#1] FK census — cis 3행 참조 자식 (선언 FK + 데이터-값) ──────────
  const fks = await runSQL(
    `select cl.relname as child_table, att.attname as col, con.confdeltype
     from pg_constraint con
     join pg_class cl on cl.oid=con.conrelid
     join pg_class pcl on pcl.oid=con.confrelid
     join unnest(con.conkey) with ordinality as k(attnum,ord) on true
     join pg_attribute att on att.attrelid=con.conrelid and att.attnum=k.attnum
     where con.contype='f' and pcl.relname='check_in_services' and pcl.relnamespace='public'::regnamespace
     order by cl.relname;`
  );
  log(`\n[HARD#1 FK census] 선언된 inbound FK(→check_in_services) = ${fks.length}건`);
  let fkChildRefs = 0;
  for (const f of fks) {
    const cnt = num(await runSQL(`select count(*)::int as n from public.${f.child_table} where "${f.col}" in (${inList(CIS_IDS)});`));
    log(`     - ${f.child_table}.${f.col} [del=${f.confdeltype}] refs=${cnt}`);
    fkChildRefs += cnt;
  }
  // 데이터-값 링크(선언 FK 부재 대비): 같은 check_in+service 로 settlement 파생행 존재?
  const piN = num(await runSQL(`select count(*)::int as n from public.payment_items where check_in_id='${PARENT_CHECKIN}' and service_id in (${inList(SVC_IDS)});`));
  const scN = num(await runSQL(`select count(*)::int as n from public.service_charges where check_in_id='${PARENT_CHECKIN}' and service_id in (${inList(SVC_IDS)});`));
  log(`     - (데이터-값) payment_items[check_in+svc]=${piN}  service_charges[check_in+svc]=${scN}`);
  const childTotal = fkChildRefs + piN + scN;
  log(`[HARD#1] child refs total = ${childTotal} (0=clean → cascade 불필요 / >0 → cascade archive-first 또는 ABORT)`);
  if (childTotal > 0) { log('[HARD#1] ★ 자식 참조 존재 — cascade archive-first 설계 또는 ABORT+FOLLOWUP 필요. dry-run VERDICT=ABORT.'); abort = true; }

  // ── [HARD#2] soft-void 컬럼 조사 ────────────────────────────────────────
  const sv = await runSQL(
    `select column_name from information_schema.columns
     where table_schema='public' and table_name='check_in_services'
       and (column_name ilike '%deleted%' or column_name ilike '%void%' or column_name ilike '%cancel%'
            or column_name ilike '%archiv%' or column_name ilike '%hidden%');`
  );
  log(`\n[HARD#2 soft-void] check_in_services 소프트삭제 후보 컬럼 = ${sv.length}건 ${JSON.stringify(sv.map((r)=>r.column_name))}`);
  if (sv.length > 0) log('[HARD#2] ★ soft-void 컬럼 존재 → 물리 archive+DELETE 대신 flag 경로 채택 (더 reversible). apply 설계 전환 필요.');
  else log('[HARD#2] soft-void 컬럼 부재 → 물리 archive-first 경로(archive 테이블 복제 후 DELETE). ※부모 check_ins.deleted_at 는 존재하나 부모=미접촉 불변식.');

  // ── [Branch C 가드] apply-time 격상조건 사전 관측 ────────────────────────
  const linkA = num(await runSQL(
    `select count(*)::int as n from public.payment_items where check_in_id='${PARENT_CHECKIN}' and service_id in (${inList(SVC_IDS)});`));
  const twinN = num(await runSQL(`select count(*)::int as n from public.check_in_services where id in (${inList(TWIN_CIS)});`));
  const guard = (await runSQL(`select amount, status from public.payments where id='${GUARD_PAYMENT}';`))?.[0];
  const twinPaid = guard && Number(guard.amount) === 73000 && guard.status === 'active';
  log(`\n[Branch C 가드] (a)3라인 payment/allocation 링크=${linkA}(기대0)  (b)8/1 twin cis=${twinN}(기대3)  (c)b7ab6496 amount=${guard?.amount}/status=${guard?.status}(기대 73000/active)`);
  const branchC = linkA > 0 || twinN !== 3 || !twinPaid;
  if (branchC) { log('[Branch C] ★ 격상조건 성립 → HARD NO-GO(삭제=실매출 파괴 가능) → apply-time ABORT + planner FOLLOWUP(CEO 게이트 복귀). dry-run VERDICT=ABORT.'); abort = true; }
  else log('[Branch C] 미발동 — Branch A(line-only·미결제·중복확증) 성립 유지. 7/25 = 유일 아님(8/1 twin 실결제 존재).');

  // ── [SIM] archive-first DO..RAISE..ROLLBACK (rows==3, No-Persistence) ────
  log('\n[SIM] archive-first DO 블록 시뮬 (TEMP archive + RAISE 강제 롤백):');
  const sim = await runSQL(`
    DO $$
    DECLARE v_arch int; v_del int; v_remaining int;
    BEGIN
      CREATE TEMP TABLE _sim_arch_cis (LIKE public.check_in_services) ON COMMIT DROP;
      INSERT INTO _sim_arch_cis SELECT * FROM public.check_in_services WHERE id IN (${inList(CIS_IDS)});
      GET DIAGNOSTICS v_arch = ROW_COUNT;
      IF v_arch <> 3 THEN RAISE EXCEPTION 'DRYRUN_ARCHIVE_MISCOUNT archived=%', v_arch; END IF;
      DELETE FROM public.check_in_services WHERE id IN (${inList(CIS_IDS)});
      GET DIAGNOSTICS v_del = ROW_COUNT;
      SELECT count(*)::int INTO v_remaining FROM public.check_in_services WHERE id IN (${inList(CIS_IDS)});
      RAISE EXCEPTION 'DRYRUN_ROLLBACK_SENTINEL archived=% deleted=% remaining=%', v_arch, v_del, v_remaining;
    END $$;
  `).then(() => ({ ok: true })).catch((e) => ({ ok: false, msg: e.message }));
  if (sim.ok) { log('[SIM] ABORT — sentinel 예외 미발생(무영속 미보장).'); abort = true; }
  else {
    const m = sim.msg.match(/DRYRUN_ROLLBACK_SENTINEL archived=(\d+) deleted=(\d+) remaining=(\d+)/);
    if (m) {
      log(`[SIM] archived=${m[1]} deleted=${m[2]} remaining_after=${m[3]}  (기대 archived=3 deleted=3 remaining=0, net-loss 0)`);
      if (!(m[1] === '3' && m[2] === '3' && m[3] === '0')) { log('[SIM] ABORT — rows-affected≠3'); abort = true; }
    } else { log(`[SIM] (rollback msg) ${sim.msg}`); abort = true; }
  }

  // ── [post-probe] 무영속 재확인 ──────────────────────────────────────────
  const post = num(await runSQL(`select count(*)::int as n from public.check_in_services where id in (${inList(CIS_IDS)});`));
  const postArch = num(await runSQL(`select count(*)::int as n from pg_tables where schemaname='public' and (tablename like '_sim_arch%' or tablename like '_archive_f4741%');`));
  log(`\n[post-probe] 대상 cis 여전히 실재=${post} (기대 3=무영속) | 잔존 archive 테이블=${postArch} (기대 0)`);
  if (post !== 3 || postArch !== 0) { log('[post-probe] ABORT — 무영속 위반(dry-run 이 prod 를 변경함)'); abort = true; }

  log(`\n=== DRY-RUN VERDICT: ${abort ? 'ABORT' : 'PASS (archive-first 3라인 제거 시뮬 정상 · rows==3 · 무영속 확인 · FK clean · soft-void 부재 · Branch C 미발동)'} ===`);
  log('※ prod --apply 는 3중 게이트(DA GO✅ + 총괄 재confirm + supervisor MIG-GATE) 통과 전까지 HOLD. 본 스크립트 apply 없음.');
  process.exit(abort ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
