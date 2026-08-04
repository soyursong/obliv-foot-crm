/**
 * T-20260804-foot-COSMETIC-CORRECTION-CRM — STEP 5: Track A seller 재귀속(reattribution) APPLY
 *   현장 confirm 2게이트 동시 해소(MSG-20260805-080921-4e35 / responder ywdd) 후 착지.
 *   해소① 박민지 per-row comp-gate = **불필요 확정**(표=참고용/정산 별도, B선택) → Track A 잔여 게이트 = supervisor dry-run 만.
 *
 * ★ 이 스크립트는 정확히 2 PK 만 seller_staff_id 를 재귀속한다 (blanket/name/amount UPDATE 금지 — 명시 PK + 현재 seller 값 가드).
 * ★ default = No-Persistence dry-run (DO..RAISE sentinel..ROLLBACK + post-probe 무영속 재확인).
 *   실 apply(`--apply`) = supervisor dry-run 검토 통과 후에만.
 *
 * 재귀속 2건 (zero-sum, 원장 무접점 — seller_staff_id 축만 이동, payments/service_charges 금액 불변):
 *   #2a 김현수 F-4789  line 76199926  : seller NULL(=7/25 이전, 최다혜 therapist 귀속) → 김규리 3a0c6774
 *       근거 = 총괄 명시지시 소급귀속(7/23 seller NULL)
 *   #5  김영웅 F-4959  line 3a8ed9f3  : seller 최민지 03642b85 → 김규리 3a0c6774
 *       근거 = 7/25 seller 직접기록, 단순 seller 정정
 *
 * ★ POSTCHECK 기준 = 중간 기대값 **711,000 / 22건 UNCHANGED** (재귀속 zero-sum — 총합·건수 불변).
 *   seller 귀속 델타: 김규리 +30,000 / 최다혜 −15,000 / 최민지 −15,000.
 *   최종값 367,000/19건(5건 전량 정정 END-state)과 대조 = **거짓 FAIL** (Track A 단독=부분정정).
 *   근거 문서: _handoff/T-20260804-foot-COSMETIC-CORRECTION-CRM_trackA-intermediate-expected.md
 *
 * SOP 준수: Cross-CRM Data-Correction Backfill SOP — per-row PK freeze / dry-run diff / 판정근거 스냅샷 /
 *           rows-affected 검증(DID-IT-PERSIST) / 롤백대칭(rollback.sql §A) / 원장 무접점 확인.
 *
 * 실행: node scripts/..._05_trackA_reattr_apply.mjs            (dry-run·무영속)
 *       node scripts/..._05_trackA_reattr_apply.mjs --apply    (실 apply — supervisor dry-run 통과 후에만)
 */
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const REF = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN;
if (!ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN 필요');
const APPLY = process.argv.includes('--apply');
async function runSQL(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${await res.text()}`);
  return res.json();
}
const J = (x) => JSON.stringify(x, null, 2);

// ── FREEZE SET — 정확히 2 PK (STEP0/1 실측 확정, disambiguation 완료) ──
const KR_THERAPIST = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b'; // gitleaks:allow  (staff UUID, not a secret) — 김규리(therapist, active) HARD-PIN. d26717cb(admin,판매0) 아님.
const MJ_SELLER    = '03642b85-4b30-48e4-b762-c2d04e6af7f3'; // gitleaks:allow  — 최민지(#5 현재 seller) 원값
const REATTR = [
  { tag: '#2a', line_id: '76199926-9be6-44a5-a5dd-fa77bc6c2e33', cust: '김현수 F-4789', from: null,       from_label: 'NULL(최다혜 therapist 귀속)', amt: 15000, date: '2026-07-23', basis: '총괄 명시지시 소급귀속(7/23 seller NULL=7/25이전)' },
  { tag: '#5',  line_id: '3a8ed9f3-f55f-4afd-a110-72c24eeab5e3', cust: '김영웅 F-4959', from: MJ_SELLER, from_label: '최민지 03642b85',            amt: 15000, date: '2026-07-25', basis: '단순 seller 정정(7/25 seller 직접기록)' },
];
const IDS = REATTR.map((r) => `'${r.line_id}'`).join(',');

async function main() {
  console.log(`════════ STEP5 ${APPLY ? '★APPLY (실 영속)' : 'DRY-RUN (무영속)'} — Track A 재귀속 2-PK ════════`);
  console.log('  현장 confirm(ywdd): 박민지 comp-gate 불필요(표=참고용/정산 별도). Track A 잔여 게이트 = supervisor dry-run.\n');

  // 1) FREEZE 지문 재검증 (apply 직전 baseline 대조) — 2행·현재 seller 값이 원값과 일치 확인
  const baseline = await runSQL(`
    select cis.id line_id, cis.price, cis.seller_staff_id, cis.service_name,
           ci.customer_id, ci.therapist_id, cu.chart_number, cu.name cust_name
    from check_in_services cis join check_ins ci on ci.id=cis.check_in_id join customers cu on cu.id=ci.customer_id
    where cis.id in (${IDS}) order by cu.chart_number;`);
  console.log('baseline:', J(baseline));
  if (baseline.length !== 2) {
    console.log(`⚠ ABORT: freeze 지문 불일치(기대 2행, 실측 ${baseline.length}행).`);
    return;
  }
  // 지문 검증: 현재 seller 가 원값(#2a NULL / #5 최민지) 또는 이미 target(김규리, 멱등 재실행) 인지
  const byId = Object.fromEntries(baseline.map((b) => [b.line_id, b]));
  let drift = false;
  for (const r of REATTR) {
    const cur = byId[r.line_id]?.seller_staff_id ?? null;
    const ok = cur === r.from || cur === KR_THERAPIST; // 원값 또는 이미 재귀속됨(멱등)
    if (!ok) { drift = true; console.log(`⚠ DRIFT ${r.tag}: 현재 seller=${cur ?? 'NULL'} ≠ 원값(${r.from_label}) 이고 target(김규리)도 아님 → ABORT 조건`); }
  }
  if (drift) { console.log('⚠ ABORT: freeze 지문 drift 감지. supervisor 확인 요망.'); return; }

  // 2) 원장 무접점 확인 (zero-sum) — 재귀속 대상 check_in 의 payments/service_charges 금액 baseline
  const ciIds = [...new Set(baseline.map((b) => `'${b.customer_id}'`))]; // note: ledger 는 check_in_id 로 조회
  const checkins = await runSQL(`select id, check_in_id from check_in_services where id in (${IDS});`);
  const ciKeys = [...new Set(checkins.map((c) => `'${c.check_in_id}'`))].join(',');
  const ledgerBefore = await runSQL(`
    select 'payments' src, count(*) n, coalesce(sum(amount),0) amt from payments where check_in_id in (${ciKeys})
    union all
    select 'service_charges' src, count(*) n, coalesce(sum(base_amount),0) amt from service_charges where check_in_id in (${ciKeys});`);
  console.log('\n원장(payments/service_charges) baseline — 재귀속 전후 UNCHANGED 여야 함:', J(ledgerBefore));

  // ── per-row UPDATE 문 (명시 PK + 현재 seller 값 가드 = idempotent·안전) ──
  const stmts = REATTR.map((r) => {
    const guard = r.from === null ? `seller_staff_id is null` : `seller_staff_id = '${r.from}'`;
    return `update check_in_services set seller_staff_id = '${KR_THERAPIST}' where id = '${r.line_id}' and ${guard};`;
  });

  if (!APPLY) {
    // No-Persistence: DO 블록 안에서 UPDATE 후 rows-affected 확인, SENTINEL RAISE 로 강제 ROLLBACK.
    const dry = await runSQL(`
      do $$
      declare n int; total int := 0;
      begin
        ${stmts.map((s) => `${s.replace(/;$/, '')};\n        get diagnostics n = row_count; total := total + n;`).join('\n        ')}
        raise notice 'DRYRUN rows_affected_total=%', total;
        raise exception 'SENTINEL_ROLLBACK (no-persistence dry-run, rows=%)', total;
      end $$;`).catch((e) => ({ sentinel: String(e.message || e) }));
    console.log('\ndry-run(무영속):', J(dry));
    // post-probe: 무영속 재확인 (seller 가 원값 그대로여야 함)
    const post = await runSQL(`select id, seller_staff_id from check_in_services where id in (${IDS}) order by id;`);
    console.log('post-probe(무영속 기대: seller 원값 유지):', J(post));
    console.log('\n→ dry-run 완료. 실 apply 는 --apply + supervisor dry-run 검토 통과 후.');
    console.log('  POSTCHECK 기준 = 중간기대값 711,000/22건 UNCHANGED (seller 델타 김규리 +30,000 / 최다혜 −15,000 / 최민지 −15,000). 367,000/19건 대조 금지(거짓 FAIL).');
    return;
  }

  // ── APPLY 경로 ──
  let totalRows = 0;
  for (const [i, s] of stmts.entries()) {
    const res = await runSQL(s);
    console.log(`UPDATE ${REATTR[i].tag}:`, J(res));
  }
  // rows-affected 검증(DID-IT-PERSIST) — 2건 모두 김규리로 이동됐는지
  const after = await runSQL(`select id, seller_staff_id from check_in_services where id in (${IDS}) order by id;`);
  console.log('\npost-apply seller (기대 전건 김규리 3a0c6774):', J(after));
  const okCount = after.filter((a) => a.seller_staff_id === KR_THERAPIST).length;
  if (okCount !== 2) console.log(`⚠ 검증실패: 김규리 귀속=${okCount} ≠ 2. supervisor 확인 요망.`);
  else console.log('✓ 2-PK seller 재귀속 영속 확인 (전건 김규리).');

  // 원장 무접점 재확인 (zero-sum) — apply 후 payments/service_charges 금액이 baseline 과 동일해야 함
  const ledgerAfter = await runSQL(`
    select 'payments' src, count(*) n, coalesce(sum(amount),0) amt from payments where check_in_id in (${ciKeys})
    union all
    select 'service_charges' src, count(*) n, coalesce(sum(base_amount),0) amt from service_charges where check_in_id in (${ciKeys});`);
  console.log('원장 apply 후 (baseline 과 동일 = zero-sum 증명):', J(ledgerAfter));
  console.log('\n→ POSTCHECK: 담당치료사별 화장품 자동집계 재조회 = 총합 711,000/22건 UNCHANGED + 김규리 +30,000/최다혜 −15,000/최민지 −15,000.');
}
main().catch((e) => { console.error(e); process.exit(1); });
