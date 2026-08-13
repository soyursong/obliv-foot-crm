/**
 * T-20260804-foot-COSMETIC-CORRECTION-CRM — STEP 2: freeze셋 + dry-run diff (per-row, READ-ONLY / No-Persistence)
 *
 * SOP: Cross-CRM Data-Correction Backfill SOP (per-row WHERE freeze / blanket UPDATE 금지 / dry-run diff /
 *      판정근거 스냅샷 / 원장 무접점 / 롤백). Migration Dry-Run No-Persistence Protocol (DO..RAISE sentinel..ROLLBACK).
 *
 * *** 이 스크립트는 apply 하지 않는다. 재귀속 UPDATE 는 DO 블록 내 실행 후 SENTINEL RAISE 로 강제 ROLLBACK,
 *     post-probe 로 무영속 재확인. 실 apply 는 3중 게이트(DA CONSULT + 박민지 comp-gate + supervisor dry-run) 통과 후 별도 _03_apply. ***
 *
 * 6건 분류:
 *  - 재귀속(seller UPDATE, zero-sum) 2건: #2a 김현수, #5 김영웅 → target seller = 3a0c6774 (therapist 김규리, HARD-PIN)
 *  - 제외(라인레벨 test/오귀속) 3건: #1 김OO(2라인), #2b 오렌지족, #4 정가언 — 메커니즘=CONSULT 대기(no-DDL 레버 없음)
 *  - 누락 INSERT 1건: #3 김정숙 F-4872 풋샴푸 42,000 — 원장 접점 판별 → supervisor gate
 */
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const REF = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN;
async function runSQL(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${await res.text()}`);
  return res.json();
}
const J = (x) => JSON.stringify(x, null, 2);

// ── FREEZE SET (STEP0/1 실측 확정) ──────────────────────────────────────────
const KR_THERAPIST = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b'; // gitleaks:allow  (staff UUID, not a secret) — 김규리(therapist, active, 재귀속 target) HARD-PIN
const REATTR = [
  { tag: '#2a', line_id: '76199926-9be6-44a5-a5dd-fa77bc6c2e33', cust: '김현수 F-4789', from: '최다혜(therapist, seller NULL)', amt: 15000, date: '2026-07-23', basis: '총괄 명시지시 소급귀속(7/23 seller NULL=7/25이전)' },
  { tag: '#5',  line_id: '3a8ed9f3-f55f-4afd-a110-72c24eeab5e3', cust: '김영웅 F-4959', from: '최민지(seller 직접기록)', amt: 15000, date: '2026-07-25', basis: '단순 seller 정정(7/25 seller 직접)' },
];
const EXCLUDE = [ // 메커니즘 CONSULT 대기 — 라인레벨 제외 플래그 부재
  { tag: '#1a', line_id: 'b81521e2-3e4f-4d41-8c63-971d78f08482', cust: '김OO F-01XX', svc: '안티펑거스500ml', amt: 287000, bucket: '김규리(therapist)', reason: '총괄:테스트' },
  { tag: '#1b', line_id: 'aaec854c-31e2-4071-b2d8-535cfed6c55d', cust: '김OO F-01XX', svc: '풋샴푸200ml', amt: 42000, bucket: '김규리(therapist)', reason: '총괄:테스트' },
  { tag: '#2b', line_id: '81682cf7-317a-4e55-98c5-eeafdda0d605', cust: '오렌지족 F-4628', svc: '풋샴푸200ml', amt: 42000, bucket: '최다혜(therapist)', reason: '총괄:테스트' },
  { tag: '#4',  line_id: '76... 정가언은 재귀속아님', cust: '정가언 F-4981', svc: 'CTB', amt: 15000, bucket: '윤시하(therapist)', reason: '총괄:명단에없음(오귀속)' },
];
// #4 정가언 CTB line_id 정정
EXCLUDE[3].line_id = '31ea7f5e-fad9-406f-9d50-5bf116b51d23';
// NOTE: 김OO 7/4 42,000 라인(99cdf75b, therapist NULL, seller NULL)=bucket NULL → 이미 집계 제외됨(정정 불요). 참고만.

async function main() {
  console.log('════════ FREEZE SET 재검증 (apply 직전 지문 대조용 baseline) ════════');
  const allIds = [...REATTR.map((r) => r.line_id), ...EXCLUDE.map((e) => e.line_id)].map((i) => `'${i}'`).join(',');
  const baseline = await runSQL(`
    select cis.id line_id, cis.price, cis.seller_staff_id, cis.service_name,
           ci.customer_id, ci.therapist_id, ci.checked_in_at, cu.chart_number, cu.name cust_name
    from check_in_services cis join check_ins ci on ci.id=cis.check_in_id join customers cu on cu.id=ci.customer_id
    where cis.id in (${allIds}) order by cu.chart_number;`);
  console.log(J(baseline));
  if (baseline.length !== 6) console.log(`⚠ freeze 지문 불일치: 기대 6행, 실측 ${baseline.length}행 → apply-time ABORT 조건`);

  console.log('\n════════ A) 재귀속 dry-run (#2a,#5) — DO..RAISE 강제 ROLLBACK (무영속) ════════');
  for (const r of REATTR) {
    const before = await runSQL(`select id, seller_staff_id from check_in_services where id='${r.line_id}';`);
    // 무영속 시뮬: UPDATE 후 RAISE 로 롤백, 변경행 캡처
    const sim = await runSQL(`
      do $$
      declare v_before uuid; v_after uuid; v_rows int;
      begin
        select seller_staff_id into v_before from check_in_services where id='${r.line_id}';
        update check_in_services set seller_staff_id='${KR_THERAPIST}' where id='${r.line_id}';
        get diagnostics v_rows = row_count;
        select seller_staff_id into v_after from check_in_services where id='${r.line_id}';
        raise exception 'DRYRUN_SENTINEL rows=% before=% after=%', v_rows, v_before, v_after;
      end $$;`).catch((e) => e.message);
    const m = String(sim).match(/DRYRUN_SENTINEL rows=(\d+) before=(\S+) after=(\S+)/);
    console.log(`\n${r.tag} ${r.cust} (${r.amt.toLocaleString()}원, ${r.date}) — ${r.basis}`);
    console.log(`  line_id=${r.line_id}`);
    console.log(`  before.seller=${before[0]?.seller_staff_id ?? 'NULL'}  →  after.seller=${KR_THERAPIST} (김규리 therapist)`);
    console.log(`  SENTINEL: ${m ? `rows=${m[1]} before=${m[2]} after=${m[3]} (rows=1 freeze HARD)` : '⚠ sentinel 파싱실패: ' + sim}`);
  }

  console.log('\n════════ A2) post-probe: 무영속 재확인 (재귀속 대상 seller 원복 여부) ════════');
  const post = await runSQL(`select id, seller_staff_id from check_in_services where id in (${REATTR.map((r)=>`'${r.line_id}'`).join(',')}) order by id;`);
  console.log(J(post));
  console.log('  → seller_staff_id 가 dry-run 前 값(#2a NULL / #5 최민지) 그대로면 무영속 OK.');

  console.log('\n════════ B) 원장 무접점 확인 (재귀속 2건 check_in 의 payments/service_charges) ════════');
  const checkins = await runSQL(`select id, check_in_id from check_in_services where id in (${REATTR.map((r)=>`'${r.line_id}'`).join(',')});`);
  const ciIds = [...new Set(checkins.map((c) => `'${c.check_in_id}'`))].join(',');
  const ledger = await runSQL(`
    select 'payments' src, count(*) n, coalesce(sum(amount),0) amt from payments where check_in_id in (${ciIds})
    union all
    select 'service_charges' src, count(*) n, coalesce(sum(base_amount),0) amt from service_charges where check_in_id in (${ciIds});`);
  console.log(J(ledger));
  console.log('  → 재귀속은 check_in_services.seller_staff_id 축만 이동. payments/service_charges 는 seller 로 키잉되지 않음 → 금액 무접점(zero-sum).');

  console.log('\n════════ C) 제외 3건(#1a/#1b/#2b/#4) — 메커니즘 CONSULT 대기 ════════');
  console.log('  라인레벨 제외 플래그 부재(check_in_services 컬럼 census). customers.is_simulation 재사용 = 고객전체 blast:');
  console.log('    · 김OO F-01XX = 실환자(39방문/213라인/₩6,921,690) → is_simulation 시 ~₩7M 실매출 은닉 = 파괴적 오류.');
  console.log('    · 오렌지족(₩626,740)·정가언(₩30,000)도 payment 有 → is_simulation 부적합.');
  console.log('  → 신규 라인레벨 boolean(ADDITIVE) + FE 집계 필터 반영 필요 = data-architect CONSULT 1차게이트 대상.');
  console.table(EXCLUDE.map(({tag,cust,svc,amt,bucket,reason})=>({tag,cust,svc,amt,bucket,reason})));

  console.log('\n════════ D) 누락 INSERT #3 (임별/김정숙 F-4872 풋샴푸 42,000) — 원장 접점 판별 ════════');
  console.log('  김정숙 7월 화장품 라인 0건(원천 미등록). 화장품 판매는 통상 payment 동반(7월 풋샴푸 6라인/7 payment).');
  console.log('  → line-only INSERT 시 담당자별 판매명단엔 뜨나 payment 미동반 → 고객 원장/매출 불일치.');
  console.log('  → 원장 동반(payment INSERT) 여부 = supervisor gate(무단 원장 INSERT 금지). host check_in 후보: 7/18 임별 checkin.');
}
main().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); });
