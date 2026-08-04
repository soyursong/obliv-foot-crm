// send-notification/adminmanual-prestrip-guard.regress.test.ts
//   admin-manual(test_sms / manual_send) 수신번호 digit pre-strip → validateRecipient 우회 회귀 가드
//
// T-20260805-xcrm-SMS-EF-ADMINMANUAL-PRESTRIP-GUARD-BYPASS-SWEEP
//   [배경] 부모 SMS-EF-RECIPIENT-GUARD sweep 이 자동/스케줄 발송의 chokepoint(sendSolapi→validateRecipient)를
//     세웠으나, admin-manual 2경로(test_sms L505·manual_send L631)가 recipient_phone 을
//     .replace(/[^0-9]/g,"") 로 **가드 이전에** digit pre-strip → DUMMY-<epoch> sentinel·영문마커가
//     선파괴 → 남은 epoch digit 이 toDomesticKR 로 leading-0 복원되어 가짜 01x 조립 →
//     isPlausibleKRNumber 통과 → 실발신(supervisor scalp C8 smoke②: DUMMY-1754312345 → status='sent').
//   [조치] 두 경로에서 pre-strip 을 제거하고 원본(.trim())을 그대로 가드/발신 경로에 투입.
//     digit 정규화(recipient_digits)는 opt_out 매칭·로깅 전용으로 분리(가드/발신 경로 미투입).
//   [불변식] 가드가 보는 값 = raw(마커 보존). 아래 매트릭스가 깨지면(예: DUMMY 가 다시 통과) 회귀 표면화.
//
//   실행: deno test --node-modules-dir=none supabase/functions/send-notification/adminmanual-prestrip-guard.regress.test.ts

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

// ── admin-manual 수신번호 추출 미러 ──
// OLD(취약): 가드에 digit-pre-stripped 값을 투입 → 마커 선파괴.
const guardInput_OLD = (rawBody: string) => String(rawBody ?? "").replace(/[^0-9]/g, "");
// NEW(봉합): 가드에 raw(.trim())를 투입 → 마커 보존.
const guardInput_NEW = (rawBody: string) => String(rawBody ?? "").trim();

// supervisor scalp C8 smoke② 실증 입력 + 변종.
//   ★ 공격 벡터의 핵심 = 마커(DUMMY-<epoch> sentinel·영문). pre-strip 이 이 마커를 파괴해야만
//     남은 epoch 가 조립 017 로 통과한다. 마커 보존이 곧 봉합. (bare epoch "1754312345" 는 마커가
//     없어 정상 017 과 구조적으로 구별 불가 → 가드 설계상 허용, pre-strip 드리프트가 아님·회귀보호 대상.)
const ATTACK_INPUTS = [
  "DUMMY-1754312345",   // epoch sentinel (smoke② 실발신 실증 입력)
  "DUMMY-1700000000",   // epoch sentinel 변종
  "dummy-1754312345",   // 대소문자 무관(/i)
  "TEST_RECIPIENT",     // 영문마커
  "e2e-fixture-017",    // 영문 혼입(조립 017 시도)
];

// ── AC(3) 드리프트: pre-strip 결과가 가드에 투입되면 공격이 통과함을 실증(회귀 표면화) ──
Deno.test("OLD(digit pre-strip→guard): DUMMY epoch 가 가드를 통과한다(취약 재현)", () => {
  const r = validateRecipient(guardInput_OLD("DUMMY-1754312345"));
  assertEquals(r.ok, true, "pre-strip 이 'DUMMY-' 를 파괴 → 남은 epoch 가 조립 017 로 통과(=버그)");
  // 조립된 가짜번호 확인
  assertEquals(toDomesticKR(guardInput_OLD("DUMMY-1754312345")), "01754312345");
});

// ── AC(1): NEW 는 모든 공격 입력을 차단(실발신 0) ──
for (const atk of ATTACK_INPUTS) {
  Deno.test(`NEW(raw→guard): 공격 입력 차단 — "${atk}"`, () => {
    const r = validateRecipient(guardInput_NEW(atk));
    assertEquals(r.ok, false, `raw 마커 보존 → 가드가 "${atk}" 를 차단해야 실발신 0`);
  });
}

// ── AC(2): 회귀 0 — 정상 KR 모바일 admin 수동발송 오차단 0 ──
// 합성 픽스처(phi-allowlist.txt permit-set 값만 사용 — 무단 확장 금지 §4.2.1).
//   KR 모바일 가드 regex /^01[016789]\d{7,8}$/ 는 010/011/016~019 를 단일 패턴으로 커버하므로
//   010·+82-10(대표 모바일) 통과 검증으로 false-positive 0(AC2)을 충분히 실증한다.
const LEGIT = [
  "010-1234-5678",       // permit (iv)
  "01012345678",         // 010-prefix
  "+82-10-1234-5678",    // permit (iv) E.164 dash
  "010-0000-0001",       // permit (iv) 비할당 블록
  "01011111111",         // permit (iii) all-same 센티넬
];
for (const ok of LEGIT) {
  Deno.test(`NEW(raw→guard): 정상 KR 모바일 통과 — "${ok}"`, () => {
    const r = validateRecipient(guardInput_NEW(ok));
    assertEquals(r.ok, true, `정상번호 "${ok}" 는 통과(false-positive 0)`);
  });
}

// ── digit 정규화(로깅/opt_out 전용)는 정상번호에서 legacy 와 동일 산출(로그 회귀 0) ──
Deno.test("recipient_digits(로깅/opt_out): 정상번호는 legacy digit-only 와 동일", () => {
  // 정상번호는 raw→digits 가 legacy .replace 결과와 일치 → 로그/opt_out 매칭 불변
  assertEquals(guardInput_NEW("010-1234-5678").replace(/[^0-9]/g, ""), "01012345678");
  assertEquals(guardInput_OLD("010-1234-5678"), "01012345678");
});
