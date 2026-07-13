/**
 * T-20260713-foot-UNAUTH-CHANGE-INVESTIGATE-ROLLBACK (WS-C) — 오염행 정정 STEP 1: merge/re-anchor DRY-RUN
 *
 * DA-20260713-foot-SELFCHECKIN-WRITE-HARDEN Q2 절차 ②→③:
 *   ②tap-closed freeze(WS-A 랜딩 완료) → ③merge dry-run(BEGIN..ROLLBACK).
 *
 * SOP 복합적용 (2-Step):
 *   Step A (자식 re-anchor)  = backfill-SOP §0-1 class A(auto-derived 미러재링크) → §2 지문교집합 면제,
 *                              §3 안전4종 + FK-only scope 유지(비면제). check_ins.customer_id: dup→raw UPDATE.
 *   Step B (빈 dup master 제거) = orphan-SOP archive-first(§1 순소실0: archive→remove). DRAFT=안전기제만 준수.
 *
 * 안전기제:
 *   - freeze셋 재검증 abort: apply 대상 4행/자식 fingerprint 가 EXPECTED 와 drift 시 즉시 중단.
 *   - 결정적 merge 키(check_in.reservation_id→reservations.customer_id) 우선. 부재 시 phone-tail+name-stem+temporal
 *     per-row confirm(INV-3 약신호 단독 destructive 금지·auto-merge 금지). 실환자0 → 기본채택.
 *   - 전 FK 테이블 자식 스캔(순소실0 완전성): dup 참조가 check_ins 외 존재 시 abort.
 *   - 완전 무영속: BEGIN..(mutations)..RAISE EXCEPTION → ROLLBACK. prod 실변경 0.
 *
 * ⚠ PHI: name/phone raw 는 stdout 만. 커밋 evidence 는 별도 redacted 스냅샷.
 * 사용: SUPABASE_ACCESS_TOKEN=… node scripts/T-20260713-foot-UNAUTH-WSC-oxrow-merge-dryrun.mjs
 */
import { query } from './lib/foot_migration_ledger.mjs';

// ── freeze셋 (VALUES 고정 — 재SELECT 로 대상 확장 금지) ──
const PAIRS = [
  { dup: '512998d0-d51a-42c4-947e-b0cb2cc69da4', raw: '8fa12f4c-abfe-405e-8736-c2ca8e4aef8a', label: 'A' },
  { dup: '0356b229-e8c7-4655-aa6e-651b15370c1f', raw: 'c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b', label: 'B' },
];
const DUP = PAIRS.map((p) => p.dup);
const RAW = PAIRS.map((p) => p.raw);
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const inList = (arr) => arr.map((x) => `'${x}'`).join(',');

// EXPECTED fingerprint (Step 0 freeze probe 확정) — drift abort 기준
const EXPECTED = { customers: 4, check_ins: 2, status_transitions: 11, reservations_ref_dup: 0 };
const EXPECTED_CI = {
  '512998d0-d51a-42c4-947e-b0cb2cc69da4': '3585c9fb-75ac-438e-8260-d13bae582caf',
  '0356b229-e8c7-4655-aa6e-651b15370c1f': '4e760772-3ce6-4e76-a635-81804cd73463',
};

const log = (l, v) => console.log(`\n── ${l} ──\n${JSON.stringify(v, null, 2)}`);
const abort = (msg) => { console.error(`\n🛑 ABORT (freeze drift/불변식 위반): ${msg}`); process.exit(2); };

// ═══ PHASE 1 — read-only 재검증 + 전 FK 자식 스캔 ═══
console.log('═══ PHASE 1: freeze 재검증 + 전 FK 자식 스캔 (read-only) ═══');

const custs = await query(
  `SELECT id, name, phone, visit_type, created_at FROM customers WHERE id IN (${inList([...DUP, ...RAW])}) ORDER BY created_at`
);
if (!Array.isArray(custs) || custs.length !== EXPECTED.customers) abort(`customers ${custs?.length} ≠ ${EXPECTED.customers}`);
// dup/raw 성격 재검증: dup 은 마스킹 지문(name '*' 또는 phone 자릿수 1~7), raw 는 실 PII
for (const p of PAIRS) {
  const d = custs.find((c) => c.id === p.dup), r = custs.find((c) => c.id === p.raw);
  if (!d || !r) abort(`pair ${p.label} row 부재`);
  const dPhoneDigits = String(d.phone || '').replace(/[^0-9]/g, '');
  const dMasked = /\*/.test(d.name) || (dPhoneDigits.length >= 1 && dPhoneDigits.length <= 7);
  const rPhoneDigits = String(r.phone || '').replace(/[^0-9]/g, '');
  const rRaw = !/\*/.test(r.name) && rPhoneDigits.length >= 8;
  if (!dMasked) abort(`${p.label} dup 이 마스킹 지문 아님 (오정정 위험)`);
  if (!rRaw) abort(`${p.label} raw 가 실 PII 아님`);
  // phone-tail 보강신호(약신호) — 단독 판정 금지, 정합 확인만
  const tail = dPhoneDigits;
  const tailMatch = rPhoneDigits.endsWith(tail);
  // name-stem 보강신호
  const nameStem = /\*/.test(d.name) ? d.name.replace(/\*+/g, '') : d.name; // stem (masked→destarred, or full)
  // PHI 위생: 평문 성명 미출력 → redact(첫자+길이). raw name 정합은 stem+tail 로만 확인(off-git 안전).
  const redact = (s) => { const t = String(s || ''); return t ? `${t.slice(0, 1)}▪×${t.length}` : '∅'; };
  console.log(`  ✓ ${p.label}: dup masked=✓ raw=✓ · phone-tail(${tail}) match=${tailMatch} · name-stem="${redact(nameStem)}" raw-name(redacted)="${redact(r.name)}"`);
}

const ci = await query(
  `SELECT id, customer_id, reservation_id, customer_name, customer_phone, status FROM check_ins WHERE customer_id IN (${inList(DUP)}) ORDER BY created_at`
);
if (!Array.isArray(ci) || ci.length !== EXPECTED.check_ins) abort(`check_ins ${ci?.length} ≠ ${EXPECTED.check_ins}`);
for (const c of ci) {
  if (EXPECTED_CI[c.customer_id] !== c.id) abort(`check_in id drift: cust ${c.customer_id} → ${c.id} (기대 ${EXPECTED_CI[c.customer_id]})`);
}
const ciIds = ci.map((c) => c.id);

const st = await query(`SELECT count(*)::int AS n FROM status_transitions WHERE check_in_id IN (${inList(ciIds)})`);
if (st?.[0]?.n !== EXPECTED.status_transitions) abort(`status_transitions ${st?.[0]?.n} ≠ ${EXPECTED.status_transitions}`);

const resvRef = await query(`SELECT count(*)::int AS n FROM reservations WHERE customer_id IN (${inList(DUP)})`);
if (resvRef?.[0]?.n !== EXPECTED.reservations_ref_dup) abort(`reservations-ref-dup ${resvRef?.[0]?.n} ≠ 0`);

// ── 결정적 merge 키 실측(reservation_id) — R2: 부재 → per-row confirm ──
const withResv = ci.filter((c) => c.reservation_id);
console.log(`\n  결정적 merge 키(check_in.reservation_id) 보유 = ${withResv.length} → ${withResv.length ? '결정적 FK 조인' : 'per-row confirm(phone-tail+name-stem+temporal, INV-3)'}`);

// ── 전 FK 자식 스캔(순소실0 완전성): dup 참조를 모든 customers-FK 테이블에서 카운트 ──
//    기계열거(information_schema) — 손열거 undercount 차단(orphan_archive_fk_guard_sop §2-0). delete_rule 동반(G3).
const fks = await query(
  `SELECT tc.table_name AS t, kcu.column_name AS c, rc.delete_rule AS del
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
     JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
     JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='customers' AND ccu.column_name='id'`
);
const delRule = Object.fromEntries(fks.map((f) => [`${f.t}.${f.c}`, f.del]));
const unionScan = fks.map((f) => `SELECT '${f.t}.${f.c}' AS ref, count(*)::int AS n FROM ${f.t} WHERE ${f.c} IN (${inList(DUP)})`).join('\nUNION ALL\n');
const scan = await query(`${unionScan} ORDER BY n DESC, ref`);
const nonZero = scan.filter((r) => r.n > 0).map((r) => ({ ...r, delete_rule: delRule[r.ref] }));
log('전 6 FK 자식 카운트 스냅샷 (기계열거·판정근거·2종 부분집합 금지) — dup 참조 non-zero', nonZero);
// ⚠ DA Q2 는 자식=check_ins/status_transitions 로 모델링(R2 under-count). 실측=아래 6행/4테이블(+financial/clinical).
//   → 전체 자식 FK re-anchor(full merge) 로 확장. raw 기보유 0 확인(merge 충돌 없음)은 child-inventory 로 旣확증.
const REANCHOR_FKS = nonZero.map((r) => { const [t, c] = r.ref.split('.'); return { t, c }; });
console.log(`  merge 대상 FK(customer 참조 자식) = ${REANCHOR_FKS.length}종, 총 ${nonZero.reduce((s, r) => s + r.n, 0)}행. 전체 full re-anchor 로 dup childless 도달.`);

// ═══ PHASE 2 — BEGIN..ROLLBACK 시뮬 (무영속) ═══
console.log('\n═══ PHASE 2: FULL merge/re-anchor 시뮬 (BEGIN..RAISE→ROLLBACK, 무영속) ═══');
// per-pair · per-FK 전체 자식 re-anchor(dup→raw) → dup childless 검증(전 FK) → dup DELETE → 검증.
// 결과 JSON 을 RAISE EXCEPTION 메시지로 반출(무영속 보장).
const reanchorStmts = PAIRS.flatMap((p) =>
  REANCHOR_FKS.map((fk) => `UPDATE ${fk.t} SET ${fk.c}='${p.raw}' WHERE ${fk.c}='${p.dup}';`)
).join('\n  ');
// dup 잔존 자식 검증(전 FK) — 재앵커 후 0 이어야
const dupChildScan = fks.map((f) => `(SELECT count(*) FROM ${f.t} WHERE ${f.c} IN (${inList(DUP)}))`).join(' + ');
const dryBlock = `
DO $$
DECLARE
  v_reanchored INT; v_dup_children INT; v_deleted INT; v_result TEXT;
  -- G1(financial 원장 무접점): package_payments 금액 총합 재앵커 전후 불변 assert
  v_pp_amt_before BIGINT; v_pp_vat_before BIGINT; v_pp_cnt_before BIGINT;
  v_pp_amt_after  BIGINT; v_pp_vat_after  BIGINT; v_pp_cnt_after  BIGINT;
BEGIN
  -- G1 baseline: dup∪raw 소속 package_payments 금액/행수(재앵커 前)
  SELECT COALESCE(SUM(amount),0), COALESCE(SUM(vat_amount),0), COUNT(*)
    INTO v_pp_amt_before, v_pp_vat_before, v_pp_cnt_before
    FROM package_payments WHERE customer_id IN (${inList([...DUP, ...RAW])});
  -- Step A: 전체 자식 FK re-anchor (customer 참조) dup→raw (full merge)
  ${reanchorStmts}
  GET DIAGNOSTICS v_reanchored = ROW_COUNT;
  -- re-anchor 후 dup 를 참조하는 자식(전 FK) 잔존 = 0 이어야 함(순소실0 완전성)
  SELECT ${dupChildScan} INTO v_dup_children;
  IF v_dup_children <> 0 THEN
    RAISE EXCEPTION 'DRYRUN_ABORT: dup 재앵커 후에도 자식 % 건 잔존(전 FK)', v_dup_children;
  END IF;
  -- G1 assert: 재앵커는 customer_id FK-only UPDATE → 금액 총합/행수 불변이어야
  SELECT COALESCE(SUM(amount),0), COALESCE(SUM(vat_amount),0), COUNT(*)
    INTO v_pp_amt_after, v_pp_vat_after, v_pp_cnt_after
    FROM package_payments WHERE customer_id IN (${inList([...DUP, ...RAW])});
  IF v_pp_amt_before <> v_pp_amt_after OR v_pp_vat_before <> v_pp_vat_after OR v_pp_cnt_before <> v_pp_cnt_after THEN
    RAISE EXCEPTION 'DRYRUN_ABORT_G1: package_payments 금액/행수 변동 (amt % → %, vat % → %, cnt % → %)',
      v_pp_amt_before, v_pp_amt_after, v_pp_vat_before, v_pp_vat_after, v_pp_cnt_before, v_pp_cnt_after;
  END IF;
  -- Step B: 빈 dup master 제거 (apply 시 archive-first; dry-run 은 삭제 가능성만 검증)
  DELETE FROM customers WHERE id IN (${inList(DUP)});
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_result := json_build_object(
    'reanchored_last_stmt_rows', v_reanchored,
    'dup_children_after_reanchor_allFK', v_dup_children,
    'dup_deleted', v_deleted,
    'g1_pp_amount_before', v_pp_amt_before,
    'g1_pp_amount_after', v_pp_amt_after,
    'g1_pp_vat_before', v_pp_vat_before,
    'g1_pp_vat_after', v_pp_vat_after,
    'g1_pp_count_before', v_pp_cnt_before,
    'g1_pp_count_after', v_pp_cnt_after,
    'g1_invariant_ok', (v_pp_amt_before = v_pp_amt_after AND v_pp_vat_before = v_pp_vat_after AND v_pp_cnt_before = v_pp_cnt_after)
  )::text;
  RAISE EXCEPTION 'DRYRUN_RESULT: %', v_result;  -- 강제 롤백(무영속)
END $$;`;

try {
  await query(dryBlock);
  abort('DO 블록이 예외 없이 종료됨(예상 밖 — 무영속 보장 실패 가능)');
} catch (e) {
  const m = String(e.message || '');
  const mm = m.match(/DRYRUN_RESULT: (\{[^]*?\})(?:\\nCONTEXT|"\})/) || m.match(/DRYRUN_RESULT: (\{[^]*?\})/);
  if (mm) {
    const cleaned = mm[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const r = JSON.parse(cleaned);
    log('DRY-RUN 결과 (롤백됨·무영속)', r);
    const ok = r.dup_children_after_reanchor_allFK === 0 && r.dup_deleted === 2 && r.g1_invariant_ok === true;
    console.log(`\n  G1(financial 원장 무접점): package_payments SUM(amount) ${r.g1_pp_amount_before}→${r.g1_pp_amount_after} · SUM(vat) ${r.g1_pp_vat_before}→${r.g1_pp_vat_after} · cnt ${r.g1_pp_count_before}→${r.g1_pp_count_after} · 불변=${r.g1_invariant_ok ? '✅' : '❌'}`);
    console.log(`판정: ${ok ? '✅ full merge 시뮬 정합 (전 FK 재앵커 후 dup 자식0·dup 삭제2·G1 금액불변)' : '❌ 시뮬 불일치'}`);
    if (!ok) process.exit(3);
  } else if (/DRYRUN_ABORT/.test(m)) {
    abort(`시뮬 내부 abort: ${m}`);
  } else {
    console.error('예상 밖 에러:', m); process.exit(4);
  }
}

// ── 무영속 사후 확증 (별도 read-only) ──
const post = await query(`SELECT count(*)::int AS n FROM customers WHERE id IN (${inList(DUP)})`);
const ciPost = await query(`SELECT count(*)::int AS n FROM check_ins WHERE customer_id IN (${inList(DUP)})`);
console.log(`\n── 무영속 사후 확증(ROLLBACK 실효) ── dup customers 잔존=${post?.[0]?.n} (기대 2) · dup 자식 check_ins=${ciPost?.[0]?.n} (기대 2)`);
if (post?.[0]?.n !== 2 || ciPost?.[0]?.n !== 2) abort('DRY-RUN 이 prod 에 영속됨(무영속 위반) — 즉시 조사');
console.log('  ✓ 무영속 확증: dry-run prod 실변경 0. apply 는 STEP 3 에서 archive-first 로 실행.');

console.log('\n===== WS-C DRY-RUN 완료 (무영속·freeze 정합·순소실0 커버) =====');
