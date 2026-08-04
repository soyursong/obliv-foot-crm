// send-notification/schedsend-prestrip-guard.regress.test.ts
//   scheduled_send(예약발송) 수신번호 digit pre-strip → validateRecipient 우회 회귀 가드
//
// T-20260805-xcrm-SMS-EF-SCHEDSEND-PRESTRIP-GUARD-BYPASS-SWEEP  (sibling: ADMINMANUAL, parent: RECIPIENT-GUARD-FORKINHERIT)
//   [배경] admin-manual sweep(de423892)이 test_sms·manual_send 의 pre-strip 을 봉합했으나,
//     scheduled_send 디스패처(L843 부근)가 scheduled_messages 저장행의 recipient_phone 을
//     .replace(/[^0-9]/g,"") 로 **가드(sendSolapi→validateRecipient) 이전에** digit pre-strip →
//     DUMMY-<epoch> sentinel·영문마커 선파괴 → 남은 epoch 이 toDomesticKR 로 leading-0 복원 →
//     가짜 01x 조립 → isPlausibleKRNumber 통과 → 무음 실발신(admin-manual 과 정확히 동일 클래스).
//   [왜 부모 sweep 이 못 막았나] 부모는 finalizeSched 에 blocked-param 로깅만 배선하고 L843 pre-strip
//     자체는 미제거 = admin-manual 과 동일 누락. 저장행은 (a) 가드 도입 이전 레거시이거나
//     (b) 다른 삽입경로가 미검증 저장했을 수 있으므로 dispatch-time pre-strip 자체가 우회 벡터.
//   [조치] L843 pre-strip 제거 → 원본(.trim())을 그대로 가드/발신 경로에 투입해 chokepoint 가 raw 마커를
//     보게 한다. digit 정규화(sDigits)는 opt_out 매칭·로깅 전용으로 분리(가드/발신 경로 미투입).
//   [불변식] 가드가 보는 값 = raw(마커 보존). 아래 매트릭스가 깨지면(예: DUMMY 저장행이 다시 통과) 회귀 표면화.
//
//   실행: deno test --node-modules-dir=none supabase/functions/send-notification/schedsend-prestrip-guard.regress.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// ── index.ts 정규화/가드 결정부 미러 (원문과 동일 로직) ──
function toDomesticKR(raw: string): string {
  let d = (raw ?? "").replace(/[^0-9]/g, "");
  if (d.startsWith("0082")) d = d.slice(4);
  if (d.startsWith("82")) d = d.slice(2);
  if (d && !d.startsWith("0")) d = "0" + d;
  return d;
}
const KR_NUMBER_PATTERNS: RegExp[] = [
  /^01[016789]\d{7,8}$/,
  /^02\d{7,8}$/,
  /^0[3-6][0-9]\d{6,8}$/,
  /^070\d{7,8}$/,
];
const isPlausibleKRNumber = (d: string) => KR_NUMBER_PATTERNS.some((re) => re.test(d));

function validateRecipient(raw: string): { ok: boolean; reason: string | null } {
  const original = (raw ?? "").trim();
  if (!original) return { ok: false, reason: "empty_recipient" };
  if (/^DUMMY-/i.test(original)) return { ok: false, reason: "dummy_sentinel" };
  if (/[A-Za-z]/.test(original)) return { ok: false, reason: "non_numeric_marker" };
  const digitsOnly = original.replace(/[^0-9]/g, "");
  if (original === "+821000000000" || digitsOnly === "821000000000" || digitsOnly === "01000000000" || digitsOnly === "1000000000") {
    return { ok: false, reason: "placeholder" };
  }
  if (!isPlausibleKRNumber(toDomesticKR(original))) {
    return { ok: false, reason: `implausible_kr_number` };
  }
  return { ok: true, reason: null };
}

// ── scheduled_send 저장행 수신번호 추출 미러 ──
// 입력원 = scheduled_messages.recipient_phone (저장행). 디스패처가 이 값을 가드/발신 경로에 투입한다.
// OLD(취약): 가드에 digit-pre-stripped 값을 투입(L843 sPhone = .replace(/[^0-9]/g,"")) → 마커 선파괴.
const guardInput_OLD = (storedPhone: string) => String(storedPhone ?? "").replace(/[^0-9]/g, "");
// NEW(봉합): 가드/발신 경로엔 raw(.trim())를 투입 → 마커 보존. digit 정규화는 로깅/opt_out 전용(sDigits).
const guardInput_NEW = (storedPhone: string) => String(storedPhone ?? "").trim();
const loggingDigits  = (storedPhone: string) => String(storedPhone ?? "").trim().replace(/[^0-9]/g, "");

// admin-manual 과 동일 공격 벡터 — scheduled_messages 저장행이 이런 값을 담고 dispatch 되는 상황.
//   ★ 핵심 = 마커(DUMMY-<epoch> sentinel·영문). pre-strip 이 마커를 파괴해야 남은 epoch 가 조립 017 로 통과.
//     마커 보존이 곧 봉합. (bare epoch "1754312345" 는 마커가 없어 정상 017 과 구조적 구별 불가 → 가드 설계상
//     허용, pre-strip 드리프트가 아님·회귀보호 대상 아님.)
const ATTACK_STORED_ROWS = [
  "DUMMY-1754312345",   // epoch sentinel (admin-manual smoke② 실발신 실증 입력)
  "DUMMY-1700000000",   // epoch sentinel 변종
  "dummy-1754312345",   // 대소문자 무관(/i)
  "TEST_RECIPIENT",     // 영문마커
  "e2e-fixture-017",    // 영문 혼입(조립 017 시도)
];

// ── AC(3) 드리프트: OLD pre-strip 결과가 가드에 투입되면 DUMMY 저장행이 통과함을 실증(취약 재현) ──
Deno.test("OLD(digit pre-strip→guard): DUMMY 저장행이 scheduled 디스패치에서 가드를 통과한다(취약 재현)", () => {
  const r = validateRecipient(guardInput_OLD("DUMMY-1754312345"));
  assertEquals(r.ok, true, "pre-strip 이 'DUMMY-' 를 파괴 → 남은 epoch 가 조립 017 로 통과(=버그)");
  assertEquals(toDomesticKR(guardInput_OLD("DUMMY-1754312345")), "01754312345");
});

// ── AC(1): NEW 는 모든 공격 저장행을 차단(실발신 0) ──
for (const atk of ATTACK_STORED_ROWS) {
  Deno.test(`NEW(raw→guard): 공격 저장행 차단 — "${atk}"`, () => {
    const r = validateRecipient(guardInput_NEW(atk));
    assertEquals(r.ok, false, `raw 마커 보존 → 가드가 저장행 "${atk}" 를 차단해야 실발신 0`);
  });
}

// ── AC(2): 회귀 0 — 정상 KR 모바일 예약발송 오차단 0 ──
// 합성 픽스처(phi-allowlist.txt permit-set 값만 사용 — 무단 확장 금지 §4.2.1).
const LEGIT_STORED_ROWS = [
  "010-1234-5678",       // permit (iv)
  "01012345678",         // 010-prefix
  "+82-10-1234-5678",    // permit (iv) E.164 dash
  "010-0000-0001",       // permit (iv) 비할당 블록
  "01011111111",         // permit (iii) all-same 센티넬
];
for (const ok of LEGIT_STORED_ROWS) {
  Deno.test(`NEW(raw→guard): 정상 KR 모바일 예약발송 통과 — "${ok}"`, () => {
    const r = validateRecipient(guardInput_NEW(ok));
    assertEquals(r.ok, true, `정상 저장행 "${ok}" 는 통과(false-positive 0)`);
  });
}

// ── digit 정규화(로깅/opt_out 전용)는 정상번호에서 legacy 와 동일 산출(로그·opt_out 매칭 회귀 0) ──
Deno.test("sDigits(로깅/opt_out): 정상 저장행은 legacy digit-only 와 동일", () => {
  // NEW 의 sDigits = raw.trim().replace 가 OLD(legacy) .replace 결과와 정상번호에서 일치 → 로그/opt_out 불변.
  for (const ok of LEGIT_STORED_ROWS) {
    assertEquals(loggingDigits(ok), guardInput_OLD(ok), `"${ok}" 로깅 digit 은 legacy 와 동일`);
  }
  assertEquals(loggingDigits("010-1234-5678"), "01012345678");
});
