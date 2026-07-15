/**
 * T-20260715-foot-F4571-CHART2-PKG12-MISMAP-CLEANUP — Phase 2 archive-first APPLY (gate3-ready).
 *
 * ⚠ 파괴적 원장 정정 (package_payments 원장행 삭제). dev 단독 apply 금지.
 *   실행 권한 = supervisor DB-GATE (gate3) 전용. 아래 3게이트 전량 GO 전에는 절대 --apply 금지.
 *     gate1 = data-architect 조건부 GO ✅ (2026-07-15 CONSULT-REPLY MSG-20260715-202146-52kn)
 *     gate2 = 김주연 총괄 freeze셋 눈확인 + Q2 실환불 여부 명시 확인 (BLOCKING) — [ ] PENDING
 *     gate3 = 대표 인지 + supervisor DB-GATE 무영속 dry-run 실측 후 execute GO — [ ] PENDING
 *
 * 기본 모드 = DRYRUN(무영속). 실 apply 는 `--apply --gate3-confirmed` 두 플래그 동시 필요.
 *   Migration Dry-Run No-Persistence Protocol 준수:
 *     - txn-control strip (본 스크립트에 COMMIT 없음)
 *     - DRYRUN 은 단일 DO $$ 블록 + 종단 RAISE EXCEPTION 으로 전량 rollback
 *     - post-probe: DO 롤백 후 archive 부재 + freeze 잔존 재확인(무영속 실증)
 *
 * DA 조건: C1 순소실0 · C2 pg_constraint 기계열거+confdeltype census · C3 census 분류+DELETE순서
 *          · C4 freeze 5건 동결+apply직전 재검증 abort+KEEP∩freeze=0 · C5 ADDITIVE→verify→DESTRUCTIVE(rowcount=5)→잔존0 멱등+rollback.
 * 판정근거: memory/1_Projects/201_메디빌더_AI도입/da_decision_foot_f4571_chart2_pkg12_mismap_cleanup_20260715.md
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return t.trim()?JSON.parse(t):[];}

const APPLY = process.argv.includes('--apply');
const GATE3 = process.argv.includes('--gate3-confirmed');
const DO_APPLY = APPLY && GATE3;

// ── freeze셋 (동결·불변 리터럴). apply 직전 재검증 후에만 사용. ────────────────
const CUST  = '99784454-1ee5-4c38-b677-7c085b3b19db';
const PKG_A = '3bde69cb-0dfb-4517-a53d-e9889a7f29b3';              // 오등록 12회권 (refunded)
const PP_REFUND  = ['e064d498-d35a-492c-9d68-18e3c888bff0','6f1a5f98-d335-439b-8d92-a378e1c24650']; // 먼저 삭제
const PP_PAYMENT = ['1d865046-d740-468f-9025-7f66b7de62ea','c6fcbb7b-240a-4a85-97e4-18c84e113c86']; // 그다음
const PP_ALL = [...PP_REFUND, ...PP_PAYMENT];
// KEEP셋 (절대 무접점 — 이중가드 id <> ALL(keep))
const KEEP_PKG = ['9a553cbd-621b-435e-ae20-aabc035e363e'];
const KEEP_PP  = ['bc58d34e-0ac8-422c-8a83-c8b6000e0a6d'];
const KEEP_PM  = ['01299d6c-d7e1-45bb-894b-ead27c80ac36'];

const lit = a => a.map(x=>`'${x}'`).join(',');
const results = []; let abort = false;
const chk = (name, pass, detail) => { results.push({name, pass, detail}); if(!pass) abort=true; console.log(`  [${pass?'PASS':'FAIL'}] ${name} — ${detail}`); };

console.log(`\n===== F4571 PKG12 MISMAP CLEANUP — Phase 2 (${DO_APPLY?'*** APPLY ***':'DRYRUN 무영속'}) =====`);

// ── C4-a: apply 직전 freeze 재검증 (지문 교집합 = freeze셋과 정확히 일치) ────────
const fp = await q(`
  SELECT id FROM packages
  WHERE customer_id='${CUST}' AND status='refunded' AND package_type='12회권'
    AND paid_amount = total_amount + 10000
    AND id NOT IN (SELECT DISTINCT package_id FROM package_sessions)
    AND id NOT IN (SELECT DISTINCT package_id FROM check_ins WHERE package_id IS NOT NULL);`);
chk('C4a_freeze_revalidate', fp.length===1 && fp[0].id===PKG_A,
    `지문 교집합 = [${fp.map(r=>r.id).join(',')}] (기대 ${PKG_A}). drift 1건도 abort`);
const ppNow = await q(`SELECT id FROM package_payments WHERE package_id='${PKG_A}' ORDER BY created_at;`);
chk('C4b_pp_set_frozen', ppNow.length===4 && ppNow.every(r=>PP_ALL.includes(r.id)),
    `pkg A package_payments 현재=[${ppNow.map(r=>r.id.slice(0,8)).join(',')}] (기대 동결 4건과 정확 일치)`);

// ── C4-c: KEEP∩freeze = 0 (이중 재확인) ──────────────────────────────────────
const ovl = await q(`
  SELECT (SELECT count(*) FROM (VALUES ${lit(KEEP_PKG).split(',').map(v=>`(${v}::uuid)`).join(',')}) k(id) WHERE k.id IN ('${PKG_A}')) pkg,
         (SELECT count(*) FROM (VALUES ${lit(KEEP_PP).split(',').map(v=>`(${v}::uuid)`).join(',')}) k(id) WHERE k.id IN (${lit(PP_ALL)})) pp;`);
chk('C4c_keep_freeze_disjoint', Number(ovl[0].pkg)+Number(ovl[0].pp)===0,
    `KEEP∩freeze = pkg${ovl[0].pkg}/pp${ovl[0].pp} (기대 0)`);

// ── C2: pg_constraint 기계열거 (contype=f, confrelid IN packages,package_payments) + confdeltype census ──
const cat = await q(`
  SELECT c.conname, cr.relname AS child_table, tr.relname AS parent_table, c.confdeltype
  FROM pg_constraint c
  JOIN pg_class cr ON cr.oid=c.conrelid
  JOIN pg_class tr ON tr.oid=c.confrelid
  WHERE c.contype='f' AND tr.relname IN ('packages','package_payments')
  ORDER BY tr.relname, cr.relname;`);
console.log(`\n  [C2] FK 카탈로그 기계열거 (parent ∈ packages,package_payments):`);
const census = {};
for(const r of cat){ census[r.confdeltype]=(census[r.confdeltype]||0)+1;
  console.log(`      ${r.parent_table} ← ${r.child_table}.${r.conname}  confdeltype=${r.confdeltype} (${{a:'NO ACTION',r:'RESTRICT',c:'CASCADE',n:'SET NULL',d:'SET DEFAULT'}[r.confdeltype]||r.confdeltype})`);
}
console.log(`  [C3] confdeltype census: ${JSON.stringify(census)} — a/r=차단자(자식0이어야 순소실0) · c=freeze내부 · n/d=silent 순소실 위험(자식0 확인)`);

// ── C3/C1: 자식 접점 census (a/r 차단자 & n/c silent 전부 0 확인) ─────────────
const fk = await q(`
  SELECT (SELECT count(*) FROM check_ins WHERE package_id='${PKG_A}') ci,
         (SELECT count(*) FROM package_sessions WHERE package_id='${PKG_A}') sess,
         (SELECT count(*) FROM packages WHERE transferred_from='${PKG_A}' OR transferred_to='${PKG_A}') xfer,
         (SELECT count(*) FROM claim_diagnoses WHERE package_payment_id IN (${lit(PP_ALL)})) cdx,
         (SELECT count(*) FROM package_payments WHERE parent_payment_id IN (${lit(PP_ALL)}) AND id NOT IN (${lit(PP_ALL)})) ext;`);
const f=fk[0];
chk('C1_children_zero', [f.ci,f.sess,f.xfer,f.cdx,f.ext].every(v=>Number(v)===0),
    `check_ins=${f.ci} sessions=${f.sess} transfer=${f.xfer} claim_dx=${f.cdx} ext_refund_child=${f.ext} (전부 0 → 순소실0·blocker0)`);

if(abort){ console.log(`\n  *** ABORT-GUARD FIRED — 한 건이라도 FAIL. 아무 것도 실행 안 함. ***`); process.exit(1); }

// ── C5: ADDITIVE(archive) → verify(순소실0) → DESTRUCTIVE(rowcount=5) → 잔존0. 멱등. ──
// 무영속 DRYRUN = 단일 DO 블록 종단 RAISE 로 전량 rollback (txn-control strip).
const SUF = '_archive_f4571_pkg12_mismap';
const mutation = `
  -- ADDITIVE: archive 테이블 (멱등, LIKE INCLUDING DEFAULTS + 스냅샷 provenance)
  CREATE TABLE IF NOT EXISTS packages${SUF}_20260715 (LIKE packages INCLUDING DEFAULTS);
  CREATE TABLE IF NOT EXISTS package_payments${SUF}_20260715 (LIKE package_payments INCLUDING DEFAULTS);
  -- populate (freeze셋 전 컬럼 무손실 복사; 멱등 = 이미 있으면 skip)
  INSERT INTO packages${SUF}_20260715 SELECT * FROM packages
    WHERE id='${PKG_A}' AND id <> ALL(ARRAY[${lit(KEEP_PKG)}]::uuid[])
    AND id NOT IN (SELECT id FROM packages${SUF}_20260715);
  INSERT INTO package_payments${SUF}_20260715 SELECT * FROM package_payments
    WHERE id IN (${lit(PP_ALL)}) AND id <> ALL(ARRAY[${lit(KEEP_PP)}]::uuid[])
    AND id NOT IN (SELECT id FROM package_payments${SUF}_20260715);
  -- verify 순소실0: archive 행수 = freeze셋(pkg1+pp4=5)
  DO $verify$ DECLARE a int; b int; BEGIN
    SELECT count(*) INTO a FROM packages${SUF}_20260715 WHERE id='${PKG_A}';
    SELECT count(*) INTO b FROM package_payments${SUF}_20260715 WHERE id IN (${lit(PP_ALL)});
    IF a<>1 OR b<>4 THEN RAISE EXCEPTION 'ARCHIVE_INCOMPLETE pkg=% pp=% (기대 1/4)', a,b; END IF;
  END $verify$;
  -- DESTRUCTIVE: 순서 refund → payment → pkg. 이중가드 id <> ALL(keep). rowcount assert=5.
  DO $del$ DECLARE n int; tot int:=0; BEGIN
    DELETE FROM package_payments WHERE id IN (${lit(PP_REFUND)}) AND id <> ALL(ARRAY[${lit(KEEP_PP)}]::uuid[]); GET DIAGNOSTICS n=ROW_COUNT; tot:=tot+n;
    IF n<>2 THEN RAISE EXCEPTION 'refund delete rowcount=% (기대 2)', n; END IF;
    DELETE FROM package_payments WHERE id IN (${lit(PP_PAYMENT)}) AND id <> ALL(ARRAY[${lit(KEEP_PP)}]::uuid[]); GET DIAGNOSTICS n=ROW_COUNT; tot:=tot+n;
    IF n<>2 THEN RAISE EXCEPTION 'payment delete rowcount=% (기대 2)', n; END IF;
    DELETE FROM packages WHERE id='${PKG_A}' AND id <> ALL(ARRAY[${lit(KEEP_PKG)}]::uuid[]); GET DIAGNOSTICS n=ROW_COUNT; tot:=tot+n;
    IF n<>1 THEN RAISE EXCEPTION 'pkg delete rowcount=% (기대 1)', n; END IF;
    IF tot<>5 THEN RAISE EXCEPTION 'total delete rowcount=% (기대 5)', tot; END IF;
  END $del$;
  -- final 잔존0 assert
  DO $final$ DECLARE r int; BEGIN
    SELECT (SELECT count(*) FROM packages WHERE id='${PKG_A}')+(SELECT count(*) FROM package_payments WHERE id IN (${lit(PP_ALL)})) INTO r;
    IF r<>0 THEN RAISE EXCEPTION 'FREEZE_REMNANT=% (기대 0)', r; END IF;
  END $final$;
  -- KEEP 불변 assert (삭제 후에도 pkgB/ppB/stray 현존)
  DO $keep$ DECLARE k int; BEGIN
    SELECT (SELECT count(*) FROM packages WHERE id=ANY(ARRAY[${lit(KEEP_PKG)}]::uuid[]))
         + (SELECT count(*) FROM package_payments WHERE id=ANY(ARRAY[${lit(KEEP_PP)}]::uuid[]))
         + (SELECT count(*) FROM payments WHERE id=ANY(ARRAY[${lit(KEEP_PM)}]::uuid[])) INTO k;
    IF k<>3 THEN RAISE EXCEPTION 'KEEP_LOSS: 현존=% (기대 3)', k; END IF;
  END $keep$;`;

if (!DO_APPLY) {
  // 기본 = PREFLIGHT(read-only, 위 C4/C2/C1 SELECT 로 이미 완료). 무영속 dry-run 실행은 gate3 supervisor DB-GATE 소관.
  console.log(`\n  [PREFLIGHT] read-only 검증 완료 = ${abort?'FAIL':'PASS'} (파괴/영속 없음).`);
  if (process.argv.includes('--emit-sql')) {
    // supervisor 의 sanctioned 무영속 harness(txn-strip+plpgsql exception+post-probe)에 넣을 mutation SQL 출력.
    // 본 블록에는 COMMIT/BEGIN 없음(txn-control strip) — harness 가 wrap.
    console.log(`\n===== MUTATION SQL (txn-control-free — supervisor 무영속 harness 용) =====\n${mutation}\n===== END MUTATION SQL =====`);
  } else {
    console.log(`  (mutation SQL 필요 시 --emit-sql. 무영속 dry-run/apply 는 supervisor DB-GATE 전용.)`);
  }
  console.log(`\n  다음 게이트: gate2(김주연 총괄 freeze눈확인+Q2 실환불여부 BLOCKING) → gate3(대표 인지+supervisor 무영속 dry-run 실측 후 --apply --gate3-confirmed).`);
  process.exit(abort?1:0);
}

// ── 실 APPLY (gate3 confirmed) — supervisor DB-GATE 전용 ────────────────────────
console.log(`\n  *** APPLY: 실제 archive+DELETE 영속 실행 (gate3 confirmed) ***`);
await q(mutation);
const post = await q(`SELECT
    (SELECT count(*) FROM packages${SUF}_20260715) archived_pkg,
    (SELECT count(*) FROM package_payments${SUF}_20260715) archived_pp,
    (SELECT count(*) FROM packages WHERE id='${PKG_A}') rem_pkg,
    (SELECT count(*) FROM package_payments WHERE id IN (${lit(PP_ALL)})) rem_pp;`);
const P=post[0];
console.log(`  APPLY 결과: archived=${Number(P.archived_pkg)+Number(P.archived_pp)}(기대5) · remaining=${Number(P.rem_pkg)+Number(P.rem_pp)}(기대0)`);
if(Number(P.archived_pkg)+Number(P.archived_pp)!==5 || Number(P.rem_pkg)+Number(P.rem_pp)!==0){ console.log('  *** POST-APPLY ASSERT FAIL ***'); process.exit(1); }
console.log('  ✅ archived=5 / remaining=0 / net-loss=0. 완료.');
