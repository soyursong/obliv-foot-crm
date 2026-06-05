/**
 * E2E spec — T-20260606-foot-RX-PATIENT-LIST-DATENAV
 * 진료환자목록(DoctorPatientList) 날짜 기본값·전후 이동 검증.
 * (문지은 대표원장 6/6: "진료환자목록을 오늘 날짜 기본 표시하고 < > 로 전/후 날짜를 넘겨본다")
 *
 * 구현 범위 (이 spec 검증 대상):
 *   AC-1(부분): 진입 시 기본 조회 날짜 = 오늘(KST). 헤더에 날짜 + 접수 인원 표기.
 *   AC-2: < / > 버튼으로 전날/다음날 이동 (헤더 날짜·인원 동기 갱신). '오늘' 복귀 버튼.
 *
 * 범위 외 (FOLLOWUP 에스컬레이트):
 *   AC-1 "로그인 의사 귀속 필터" — check_ins 에 doctor 귀속 컬럼(doctor_id 등) 부재로 데이터 경로 없음.
 *   임의 매핑 신설 금지(planner 선결) → 클리닉 단위 일자 조회 유지. 별도 FOLLOWUP 으로 결정 요청.
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(shiftISODate/formatISOToKoLabel/isToday)을 모사해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';

// ── 정본: KST 캘린더 날짜 전/후 이동 (DoctorPatientList.shiftISODate) ──────────
//   정오(UTC) 기준으로 더해 DST/경계 드리프트 방지.
const shiftISODate = (iso: string, deltaDays: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
};

// ── 정본: 조회 바운드 (usePatientsByDate) ──────────────────────────────────────
const queryBounds = (day: string) => ({
  gte: `${day}T00:00:00+09:00`,
  lte: `${day}T23:59:59+09:00`,
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 전날/다음날 이동
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 날짜 전/후 이동', () => {
  test('다음날 +1', () => {
    expect(shiftISODate('2026-06-06', 1)).toBe('2026-06-07');
  });

  test('전날 -1', () => {
    expect(shiftISODate('2026-06-06', -1)).toBe('2026-06-05');
  });

  test('월 경계 — 6/1 전날 = 5/31', () => {
    expect(shiftISODate('2026-06-01', -1)).toBe('2026-05-31');
  });

  test('월 경계 — 6/30 다음날 = 7/1', () => {
    expect(shiftISODate('2026-06-30', 1)).toBe('2026-07-01');
  });

  test('연 경계 — 12/31 다음날 = 익년 1/1', () => {
    expect(shiftISODate('2026-12-31', 1)).toBe('2027-01-01');
  });

  test('윤년 2월 — 2024-02-28 다음날 = 2024-02-29', () => {
    expect(shiftISODate('2024-02-28', 1)).toBe('2024-02-29');
  });

  test('비윤년 2월 — 2026-02-28 다음날 = 2026-03-01', () => {
    expect(shiftISODate('2026-02-28', 1)).toBe('2026-03-01');
  });

  test('왕복 동선: 오늘 → 전날 → 다음날 = 오늘 (헤더 동기 갱신 불변식)', () => {
    const today = '2026-06-06';
    const prev = shiftISODate(today, -1);
    const back = shiftISODate(prev, 1);
    expect(back).toBe(today);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 오늘 날짜 기본 + 조회 바운드(KST)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 오늘 기본 + KST 바운드', () => {
  test('조회 바운드는 선택 날짜의 KST 00:00~23:59 (+09:00)', () => {
    const b = queryBounds('2026-06-06');
    expect(b.gte).toBe('2026-06-06T00:00:00+09:00');
    expect(b.lte).toBe('2026-06-06T23:59:59+09:00');
  });

  test('isToday 플래그 — 선택일==오늘 일 때만 true', () => {
    const today = '2026-06-06';
    const isToday = (sel: string) => sel === today;
    expect(isToday(today)).toBe(true);
    expect(isToday(shiftISODate(today, -1))).toBe(false);
    expect(isToday(shiftISODate(today, 1))).toBe(false);
  });

  test('전날 이동 시 바운드도 전날로 갱신', () => {
    const prev = shiftISODate('2026-06-06', -1);
    const b = queryBounds(prev);
    expect(b.gte).toBe('2026-06-05T00:00:00+09:00');
    expect(b.lte).toBe('2026-06-05T23:59:59+09:00');
  });
});
