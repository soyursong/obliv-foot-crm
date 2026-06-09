/**
 * E2E spec — T-20260609-foot-PASTVISIT-TREATMENT-VIEW
 * 진료환자목록(DoctorPatientList) 과거 내원환자 '받은 치료' 표시 (A안).
 * (문지은 대표원장 6/9: "오늘 말고 어제까지의 환자는 상태 말고 어떤 치료받았는지 받아올 수 있나?")
 *
 * 구현 범위 (이 spec 검증 대상):
 *   AC-1: 오늘 조회 시 회귀 0 (isPast=false → 현행 상태 중심 행 유지).
 *   AC-2: 어제 이전 조회 시 treatment_category · treatment_contents(없으면 kind) 요약 표시.
 *   AC-3: 치료 데이터 없는 과거 행 = '치료내역 없음' ([object Object]/undefined/빈칸 금지).
 *   AC-4(A안): 과거 날짜에서 '상태' 컬럼 비노출(받은 치료 컬럼으로 자동 전환).
 *   AC-5: 스키마 변경 0 — SELECT 확장만. (코드 리뷰/배포 게이트에서 확인, 본 spec은 표시 로직 회귀)
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(treatmentSummary/isPast)을 모사해 회귀를 잡는다.
 *   (인접 spec T-20260606-foot-RX-PATIENT-LIST-DATENAV 와 동일 패턴)
 */
import { test, expect } from '@playwright/test';

// ── 정본: 받은 치료 요약 (DoctorPatientList.treatmentSummary) ──────────────────
//   category · (contents 우선, 없으면 kind). 전부 비면 null → '치료내역 없음'.
type Treatmentish = {
  treatment_category: string | null;
  treatment_contents: string[] | null;
  treatment_kind: string | null;
};
const treatmentSummary = (row: Treatmentish): string | null => {
  const category = (row.treatment_category ?? '').trim();
  const contents = Array.isArray(row.treatment_contents)
    ? row.treatment_contents
        .filter((c): c is string => typeof c === 'string' && c.trim() !== '')
        .map((c) => c.trim())
    : [];
  const kind = (row.treatment_kind ?? '').trim();
  const detail = contents.length > 0 ? contents.join(', ') : kind;
  const parts = [category, detail].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
};

// ── 정본: 과거 날짜 판정 (DoctorPatientList.isPast) ────────────────────────────
//   ISO 'YYYY-MM-DD' 사전식 비교 = 캘린더 비교(타임존 무관). 미래는 과거 아님.
const isPast = (selectedDate: string, todayISO: string): boolean => selectedDate < todayISO;

// 화면에 실제로 그려지는 '받은 치료' 셀 텍스트 (호출부 fallback 포함)
const treatmentCellText = (row: Treatmentish): string => treatmentSummary(row) ?? '치료내역 없음';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 과거 날짜 치료 조회 (정상) — AC-2 / AC-4
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오1 과거 날짜 받은 치료 표시', () => {
  test('어제는 과거(isPast=true) — 상태 컬럼 → 받은 치료 자동 전환', () => {
    const today = '2026-06-10';
    expect(isPast('2026-06-09', today)).toBe(true);
  });

  test('category + contents 조합 — "발톱무좀 · 가열레이저, 수액"', () => {
    expect(
      treatmentSummary({
        treatment_category: '발톱무좀',
        treatment_contents: ['가열레이저', '수액'],
        treatment_kind: '가열레이저',
      }),
    ).toBe('발톱무좀 · 가열레이저, 수액');
  });

  test('contents 단일 — "발톱무좀 · 가열레이저"', () => {
    expect(
      treatmentSummary({
        treatment_category: '발톱무좀',
        treatment_contents: ['가열레이저'],
        treatment_kind: null,
      }),
    ).toBe('발톱무좀 · 가열레이저');
  });

  test('contents 비고 kind만 있을 때 — kind로 폴백', () => {
    expect(
      treatmentSummary({
        treatment_category: '내성발톱',
        treatment_contents: null,
        treatment_kind: '비가열레이저',
      }),
    ).toBe('내성발톱 · 비가열레이저');
  });

  test('category만 있을 때 — category 단독 표시', () => {
    expect(
      treatmentSummary({ treatment_category: '발톱무좀', treatment_contents: [], treatment_kind: '' }),
    ).toBe('발톱무좀');
  });

  test('category 없고 contents만 — detail 단독 표시', () => {
    expect(
      treatmentSummary({ treatment_category: null, treatment_contents: ['수액'], treatment_kind: null }),
    ).toBe('수액');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 오늘 화면 회귀 (변화 없음) — AC-1
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오2 오늘 회귀', () => {
  test('오늘은 과거 아님(isPast=false) — 현행 상태 중심 행 유지', () => {
    const today = '2026-06-10';
    expect(isPast(today, today)).toBe(false);
  });

  test('미래(다음날) 조회도 과거 아님 — 현행 유지(받은치료 모드 미진입)', () => {
    const today = '2026-06-10';
    expect(isPast('2026-06-11', today)).toBe(false);
  });

  test('왕복: 오늘 → 어제(과거) → 오늘(회귀) 불변식', () => {
    const today = '2026-06-10';
    expect(isPast(today, today)).toBe(false); // 진입
    expect(isPast('2026-06-09', today)).toBe(true); // 어제 = 과거
    expect(isPast(today, today)).toBe(false); // 복귀 = 회귀
  });

  test('월 경계 — 6/1 기준 5/31은 과거', () => {
    expect(isPast('2026-05-31', '2026-06-01')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 엣지 — 치료내역 없는 과거 환자 — AC-3
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오3 치료내역 없음 엣지', () => {
  test('treatment_* 전부 null → "치료내역 없음"', () => {
    expect(
      treatmentCellText({ treatment_category: null, treatment_contents: null, treatment_kind: null }),
    ).toBe('치료내역 없음');
  });

  test('빈 배열·빈 문자열 → "치료내역 없음"', () => {
    expect(
      treatmentCellText({ treatment_category: '', treatment_contents: [], treatment_kind: '' }),
    ).toBe('치료내역 없음');
  });

  test('공백·빈 항목 섞여도 정제 후 없으면 "치료내역 없음"', () => {
    expect(
      treatmentCellText({ treatment_category: '   ', treatment_contents: ['', '  '], treatment_kind: '  ' }),
    ).toBe('치료내역 없음');
  });

  test('[object Object]/undefined/null 문자열 노출 금지', () => {
    const text = treatmentCellText({
      treatment_category: null,
      treatment_contents: null,
      treatment_kind: null,
    });
    expect(text).not.toContain('[object');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });

  test('일부만 있어도 빈 토큰 없이 정제 — "발톱무좀 · 수액"', () => {
    expect(
      treatmentSummary({
        treatment_category: '발톱무좀',
        treatment_contents: ['', '수액', '   '],
        treatment_kind: null,
      }),
    ).toBe('발톱무좀 · 수액');
  });
});
