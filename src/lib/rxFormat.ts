// 처방내역 표시(presentation) 포맷 헬퍼 — 순수 함수(React/DOM 비의존).
// T-20260615-foot-RXTABLE-PRESCRIPTION-ALIGN AC6 (문지은 대표원장):
//   진료차트 처방내역 테이블 "셀 숫자전용" 요청. frequency 자유텍스트에서 한글 단위어(일/회)를
//   벗기고 '1회 투여 횟수' 숫자/범위 코어만 표시한다. 원본 필드 값·저장·필드매핑은 무변경(표시 전용).
//
//   예) '1일 3회'→'3', '2~3회'→'2~3', '1~2회'→'1~2', '1회'→'1', '3'→'3'.
//   규칙: 문자열 내 숫자/범위 토큰들 중 마지막 토큰(=투여횟수)을 코어로 채택, 범위 '~'는 손실 없이 유지.
export function rxFreqCore(raw?: string | null): string {
  if (!raw) return '';
  const tokens = raw.match(/\d+(?:\s*~\s*\d+)?/g);
  if (!tokens || tokens.length === 0) return '';
  return tokens[tokens.length - 1].replace(/\s*~\s*/g, '~');
}
