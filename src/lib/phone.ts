// E.164 (+8210XXXXXXXX) ↔ 한국식 (010-XXXX-XXXX) 변환 유틸
// PHONE_E164 통일 (T-PHONE-E164 MSG-20260426-0400, 2026-04-26 09:00 KST)
// DB 저장 = E.164. UI 표시는 src/lib/format.ts formatPhone 사용 (이 모듈은 정규화/검색 보조).

export function normalizeToE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, "");
  if (/^01[016789]\d{7,8}$/.test(digits)) return "+82" + digits.slice(1);
  if (/^821[016789]\d{7,8}$/.test(digits)) return "+82" + digits.slice(2);
  if (/^0821[016789]\d{7,8}$/.test(digits)) return "+82" + digits.slice(3);
  return null;
}

// T-20260713-foot-CUSTINFO-PHONE-EDIT-ERROR: 전화번호 저장 실패를 스태프 친화 안내로 매핑.
//   RC(재현 확인): 고객정보(2번차트) 휴대폰 수정 시 다른 고객이 이미 쓰는 번호로 저장하면
//   UNIQUE(clinic_id, phone) = idx_customers_clinic_phone 충돌(Postgres 23505)이 발생하고,
//   기존엔 raw DB 메시지("duplicate key value violates unique constraint …")가 그대로 토스트로 노출됐다.
//   → 원인(중복 번호)을 알 수 없는 "오류". 이 헬퍼가 해당 오류만 골라 명확한 한국어 안내로 치환한다.
//   중복 외 오류(null 반환)는 호출부가 기존 메시지를 유지하도록 위임 → 실제 실패를 숨기지 않음.
export function phoneSaveErrorMessage(
  err: { code?: string; message?: string } | null | undefined,
): string | null {
  if (!err) return null;
  const msg = err.message ?? "";
  if (err.code === "23505" || /idx_customers_clinic_phone|duplicate key value|unique constraint/i.test(msg)) {
    return "이미 다른 고객이 사용 중인 번호입니다. 번호를 다시 확인해 주세요.";
  }
  return null;
}

// T-20260617-foot-CHECKIN-CHART-LINK-3KEY: 포맷 무관 비교용 canonical national digits.
//   E.164(+8210…)/숫자(0210…)/하이픈(010-…)이 DB·입력에 혼재 → 동일 번호를 한 표준으로 환원해 비교.
//   010… → 8210…, 8210… 유지, 그 외 8자리+ 는 그대로. RPC self_checkin_with_reservation_link 의
//   v_phone_canon 와 동일 규칙(서버/클라 매칭 키 정합). 유효 자리수 미만이면 null(비교 근거로 안 씀).
export function phoneCanonDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  if (digits.startsWith("0")) return "82" + digits.slice(1);
  if (digits.startsWith("82")) return digits;
  return digits;
}

