/**
 * T-20260630-foot-RRN-GENDER-DIGIT-UNMASK (B안 — CEO 2026-07-18: A안 반려)
 * RRN(주민등록번호) 7번째 자리(뒷자리 첫 1자리) → 성별 파생 유틸 (표시전용)
 *
 * 배경: 현장(김주연 총괄) 요청 = 2번차트에서 성별 더블체크. A안(성별코드 1자리 노출
 *       `1••••••`)은 data-architect NO-GO(개보법 §3 최소처리·§24-2, 파괴적 PII 확대) →
 *       CEO 반려. B안 = RRN 자릿수는 전체 마스킹 그대로 두고, 성별(남/여) 라벨만 파생 표시.
 *       body센터 검증 패턴(T-20260611-body-RRN-GENDER-DERIVE-DISPLAY, 0038b61) FE 이식.
 *
 * 매핑(현장 명시 / body 정합):
 *   1·3 → '남' | 2·4 → '여' | 5·6·7·8 → '외국인' | 그외(0·9·미입력·자릿수부족) → null
 *
 * PURGE 안전 준수 (RRN 오거부 사고 재발 방지):
 *   - 입력값 검증·경고·차단·throw 없음. 파생 실패 시 조용히 null 반환.
 *   - 자릿수 부족·미입력·0·9·NaN → null.
 *
 * PHI: 입력 rrn 은 호출부가 이미 rrn_decrypt 로 복호해 마스킹 렌더에 쓰는 인메모리 값.
 *      본 함수는 성별 라벨(남/여/외국인)만 반환 — RRN 자릿수를 어디에도 노출하지 않는다.
 */
export function deriveGenderFromRRN(
  rrn: string | null | undefined,
): '남' | '여' | '외국인' | null {
  if (!rrn) return null;
  const digits = rrn.replace(/\D/g, '');
  if (digits.length < 7) return null;
  const code = parseInt(digits[6], 10);
  if (code === 1 || code === 3) return '남';
  if (code === 2 || code === 4) return '여';
  if (code >= 5 && code <= 8) return '외국인';
  return null; // 0, 9, NaN → null (조용히 처리)
}
