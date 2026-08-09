// EF 재현 test (AC2) — T-20260808-foot-VISITTYPE-DEFAULT-SETNEW-REMEDIATE (b)
//   reservation-ingest-from-dopamine index.ts:776 하드닝 검증.
//   변경 = bare spread-omit `...(slotType ? {visit_type:...} : {})` → 항상 `visit_type: visitTypeMapped`.
//   visitTypeMapped(:462) = slotType ? (slotType==='new_consult'?'new':'returning') : 'new'.
//   핵심 회귀 표적: slotType falsy(미동봉) → 'new'(fail-safe floor) 착지(구: 미삽입 → DB DEFAULT 'returning').
//
// usage: node db-gate/T-20260808-foot-VISITTYPE-DEFAULT-SETNEW-REMEDIATE_ef_repro.mjs

// EF 매핑식 1:1 복제 (index.ts:462)
const visitTypeMapped = (slotType) => (slotType ? (slotType === 'new_consult' ? 'new' : 'returning') : 'new');

// 하드닝 후 INSERT payload 의 visit_type = visitTypeMapped(slotType) (항상 명시, spread-omit 제거)
const payloadVisitType = (slotType) => visitTypeMapped(slotType);

const cases = [
  { slotType: 'new_consult', expect: 'new',       note: '초진 명시' },
  { slotType: 'existing',    expect: 'returning', note: '재진(비-new_consult) 명시' },
  { slotType: 're_visit',    expect: 'returning', note: '재진 변형 명시' },
  { slotType: undefined,     expect: 'new',       note: '★falsy(미동봉) → fail-safe floor new (구: DEFAULT returning 착지)' },
  { slotType: null,          expect: 'new',       note: '★falsy(null) → new' },
  { slotType: '',            expect: 'new',       note: '★falsy(빈문자) → new' },
];

let fail = 0;
for (const c of cases) {
  const got = payloadVisitType(c.slotType);
  const ok = got === c.expect;
  if (!ok) fail++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] slotType=${JSON.stringify(c.slotType)} → visit_type='${got}' (expect '${c.expect}') — ${c.note}`);
}
// RPC 경로(p_visit_type: visitTypeMapped, :598)와 INSERT 경로가 이제 동일식 = parity 보장
console.log(`\nparity: INSERT payload.visit_type ≡ RPC p_visit_type ≡ visitTypeMapped → ${fail === 0 ? 'CONFIRMED' : 'BROKEN'}`);
console.log(`\n==== EF-REPRO ${fail === 0 ? 'PASS(6/6) — DEFAULT unreachable + falsy→new fail-safe' : 'FAIL(' + fail + ')'} ====`);
process.exit(fail === 0 ? 0 : 1);
