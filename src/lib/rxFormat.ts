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

// ─────────────────────────────────────────────────────────────────────────────
// T-20260616-foot-RX-COLUMN-INPUT-UNIFY-ALLSCREENS (문지은 대표원장):
//   "약을 다루는 전 화면에서 칼럼명·입력박스를 통일. 박스 안엔 숫자만. 절대 달라지지 않게."
//   → 칼럼 라벨을 한 곳(SSOT)에 고정해 화면별 임의 변형(약품명/1일횟수/회수/투약일 등)이
//     다시 갈라지지 않게 한다. 정본 출처 = RXTABLE-PRESCRIPTION-ALIGN AC1(약이름(용량)/용법/횟수/일수).
//   토큰 매핑(RX-TOKEN-FORMAT, deployed): 1=dosage(1회량)/3=count(1일횟수)/2=days(총일수). 필드매핑·순서 불변.
// ─────────────────────────────────────────────────────────────────────────────
export const RX_COL = {
  /** 약 이름 (입력폼 단독 박스 라벨) */
  name: '약이름',
  /** 1회량(dosage) — 토큰 1 */
  dosage: '용량',
  /** 용법(frequency) */
  freq: '용법',
  /** 1일 투여횟수(count) — 토큰 3 */
  count: '횟수',
  /** 총 투약일수(days) — 토큰 2 */
  days: '일수',
  /** 읽기전용 테이블 합본 헤더 (약이름+용량을 한 셀에 표기) */
  nameWithDosage: '약이름(용량)',
} as const;

/** 숫자전용 입력 필터 — 한글·영문·기호 전부 제거, 숫자만 남긴다. (횟수·일수·수치형 용량) */
export function rxDigits(raw?: string | null): string {
  return (raw ?? '').replace(/[^0-9]/g, '');
}

/** 숫자+범위(~) 허용 필터 — 용법 등 '2~3' 범위표기 박스용. 한글·영문 차단, 숫자와 ~ 만 보존. */
export function rxDigitsRange(raw?: string | null): string {
  return (raw ?? '').replace(/[^0-9~]/g, '');
}
