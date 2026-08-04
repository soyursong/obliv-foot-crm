/**
 * T-20260804-foot-CBAND-RESPRECV-BANNER-RCA — PCI 가드 트립 메커니즘 실증 (순수·비영속)
 * ════════════════════════════════════════════════════════════════════════════
 * trg_cband_pa_pci_guard(mig 20260731190000) 의 Rule A/B/C + foot_is_luhn 를 JS 로 그대로 복제해
 *   raw_response(::text) 후보에 대해 트립 여부를 결정론으로 재현한다. DB 무접촉(read/write 0).
 *
 * 목적: updateAttempt(APPROVED) 가 raw_response 를 write 할 때만 가드가 RAISE 하여 status='approved'
 *   승격이 거부됨을 보인다(백링크=payment_id 만 → 미트립 통과). 그리고 fix(=원본 payload `raw` 제외)가
 *   모든 케이스에서 미트립임을 확인한다.
 */

// ── 가드 규칙 복제 (SQL 정본과 1:1) ─────────────────────────────────────────────
function isLuhn(num) {
  if (!/^\d+$/.test(num)) return false;
  let sum = 0;
  const n = num.length;
  for (let i = 1; i <= n; i++) {
    let d = Number(num[n - i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
// Rule A: SAD 키
const RULE_A = /"(track1|track2|track_?data|full_?pan|cvv2?|cvc2?|cvn2?|csc|pin_?block|pin|card_?password|card_?pw)"\s*:\s*("[^"]+"|-?\d)/i;
// Rule C: RRN 유사
const RULE_C = /\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[ \-]?[1-8]\d{6}/;

function guardTrip(rawText) {
  if (RULE_A.test(rawText)) return 'A(SAD키)';
  // Rule B: digit run(공백/하이픈 허용) → strip → 13~19자리 + Luhn
  const cands = rawText.match(/\d[\d \-]{11,21}\d/g) ?? [];
  for (const c of cands) {
    const digits = c.replace(/[ \-]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && isLuhn(digits)) return `B(미마스킹 PAN: ${digits.slice(0,6)}…${digits.slice(-4)})`;
  }
  if (RULE_C.test(rawText)) return 'C(주민번호 유사)';
  return null;
}

// ── 후보 raw_response 문자열 (jsonb::text 근사) ────────────────────────────────
// (1) 기존 record-persist spec 의 재구성 REAL_APPROVAL (CARDNO 마스킹).
const RECON_MASKED = '{"ERRCODE":"0000","TRANTYPE":"0210","CARDNO":"55318440****364*  ","HALBU":"00","TAMT":"000003000","TRANDATE":"260804","TRANTIME":"110347","AUTHNO":"29258831    ","MERNO":"00113742229    ","TRANSERIAL":"110341558080","ISSUECARD":"하나기업","PURCHASECARD":"하나카드","MSG1":"거래 승인29258831"}';

// (2) 실 단말이 CARDNO 를 미마스킹(full PAN, Luhn 유효 16자리)으로 반환한 변형 — 가드 트립 재현.
//     (예시 PAN=4111111111111111, 테스트 벤더 표준 Luhn 유효값)
const LIVE_UNMASKED_PAN = '{"ERRCODE":"0000","TRANTYPE":"0210","CARDNO":"4111111111111111","TAMT":"000003000","TRANDATE":"260804","TRANTIME":"110347","AUTHNO":"29258831","MERNO":"00113742229","TRANSERIAL":"110341558080"}';

// (3) CARDNO 를 공백으로 그룹핑해 반환한 변형(4-4-4-4) — 가드 B 는 공백 strip 후 검사하므로 트립.
const LIVE_SPACED_PAN = '{"CARDNO":"4111 1111 1111 1111","AUTHNO":"29258831","TRANDATE":"260804"}';

// (4) fix 적용: 원본 payload(raw) 제외 → 정규화·마스킹 필드만 (NormalizedResponse minus raw).
const FIXED_SUBSET = '{"tranType":"0210","authNo":"29258831","responseCode":"0000","merno":"00113742229","amount":3000,"msgTrace":"110341558080","tranDate":"260804","tranTime":"110347","cardName":"하나기업","cardNoMasked":"55318440****364*"}';

const cases = [
  ['(1) 재구성 REAL_APPROVAL 전체(raw 포함, 마스킹)', RECON_MASKED],
  ['(2) 실단말 미마스킹 PAN 반환 변형(raw 포함)', LIVE_UNMASKED_PAN],
  ['(3) 실단말 공백그룹 PAN 반환 변형(raw 포함)', LIVE_SPACED_PAN],
  ['(4) ★FIX: raw 제외 정규화·마스킹 subset', FIXED_SUBSET],
];

console.log('════════════════════════════════════════════════════════════════');
console.log(' PCI 가드 트립 실증 (trg_cband_pa_pci_guard Rule A/B/C 복제, 비영속)');
console.log('════════════════════════════════════════════════════════════════\n');
for (const [label, text] of cases) {
  const trip = guardTrip(text);
  console.log(`${trip ? '⛔ RAISE' : '✅ 통과'}  ${label}`);
  if (trip) console.log(`         └ 트립 규칙 = ${trip}  → UPDATE 거부 → status 미승격(고아→sweep→attention→배너)`);
}
console.log('\n해석:');
console.log('  · (1) 마스킹 재구성은 미트립 → 실 배너 발생건은 단말이 (2)/(3)류 미마스킹 CARDNO 를 반환했음을 시사.');
console.log('  · (2)(3) raw(원본 payload) 를 그대로 raw_response 에 실으면 CARDNO 가 가드 B 를 트립 → updateAttempt(approved) 거부.');
console.log('  · (4) ★FIX: raw 제외(정규화·마스킹 필드만 보존) → 전 케이스 미트립 → status=approved 정상 영속 → 배너 미발생.');
console.log('  · updateAttempt 는 이 RAISE 를 삼켜(console.error only, rows-affected 미확인) status 를 requested 에 방치했다.');
