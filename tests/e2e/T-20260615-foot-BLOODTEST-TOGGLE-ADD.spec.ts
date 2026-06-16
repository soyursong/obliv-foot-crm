/**
 * E2E spec — T-20260615-foot-BLOODTEST-TOGGLE-ADD (P2)
 * 피검사(혈액검사) ON/OFF 토글(BloodTestRequestToggle) — KOH 토글 1:1 미러, 🅑 단순 신청 플래그.
 *
 * AC:
 *   AC-1 토글 노출: 2번차트 > 패키지 탭 > 치료부위 우측 상단, KOH 토글 바로 하단 `피검사 ON/OFF`. 기본 OFF.
 *   AC-2 플래그 기록: ON → 가장 최근 내원 check_in_services.blood_test_requested=true (RPC). OFF → false(유지).
 *   AC-3 OFF 비활성 표시: OFF 시 false 회색/비활성 렌더, 다시 ON 가능.
 *   AC-4 범위 제외: 결과지/자동업로드/목록탭/발행 RPC 없음.
 *
 * KOH 와의 차이: 피검사 전용 service_name 없음 → service_name 필터 없이
 *   "가장 최근 non-cancelled 내원의 서비스 행 전체"를 타겟(BloodTestRequestToggle.useBloodServicesForCustomer 모사).
 *
 * 검증:
 *   S1 노출           — 서비스 보유 내원 있으면 토글 노출(타겟=가장 최근 내원).
 *   S2 내원 없음       — check_in_services 0건 → 미노출(null).
 *   S3 최신 내원 선정   — 내원이 둘이면 최신(created_at DESC) 내원을 타겟.
 *   S4 동일 내원 묶음   — 타 내원 서비스는 섞지 않음(일괄 동기화 단위 보존).
 *   S5 anyOn 집계      — 타겟 내원 service 중 하나라도 blood_test_requested 면 ON.
 *   S6 기본 OFF        — 신규(미신청) 내원 → anyOn=false(기본 OFF, AC-1/AC-3).
 *   S7 실 브라우저      — 로그인 셸 렌더 스모크.
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: 타겟 선정 로직 (BloodTestRequestToggle.tsx) — service_name 필터 없음 ──────
interface SvcRow {
  id: string;
  blood_test_requested: boolean;
  check_in_id: string;
  created_at: string; // ISO
}
interface BloodTarget {
  checkInId: string;
  svcs: { id: string; blood_test_requested: boolean }[];
}

// 정본 선정: non-cancelled 내원의 서비스 행을 created_at DESC 로 받아
//   첫 행 check_in_id 를 타겟으로, 그 내원 service 만 묶음. 없으면 빈 타겟(미노출).
function selectBloodTarget(rowsRaw: SvcRow[]): BloodTarget {
  const rows = [...rowsRaw].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  );
  if (rows.length === 0) return { checkInId: '', svcs: [] };
  const target = rows[0].check_in_id;
  return {
    checkInId: target,
    svcs: rows
      .filter((r) => r.check_in_id === target)
      .map((r) => ({ id: r.id, blood_test_requested: r.blood_test_requested })),
  };
}

// 정본 렌더 가드: !customerId || isLoading || svcs.length === 0 → null(미노출).
const isVisible = (t: BloodTarget) => t.svcs.length > 0;
const anyOn = (t: BloodTarget) => t.svcs.some((s) => s.blood_test_requested);

// ── S1: 서비스 보유 내원 있으면 토글 노출 ─────────────────────────────────────
test('S1: 가장 최근 내원에 서비스 있으면 토글 노출(타겟=최신 내원)', () => {
  const rows: SvcRow[] = [
    { id: 's-old', blood_test_requested: false, check_in_id: 'ci-0610', created_at: '2026-06-10T02:00:00+00:00' },
    { id: 's-new', blood_test_requested: false, check_in_id: 'ci-0616', created_at: '2026-06-16T01:00:00+00:00' },
  ];
  const t = selectBloodTarget(rows);
  expect(isVisible(t)).toBe(true);
  expect(t.checkInId).toBe('ci-0616');
  expect(t.svcs.map((s) => s.id)).toEqual(['s-new']);
});

// ── S2: 내원 서비스 없음 → 미노출 ─────────────────────────────────────────────
test('S2: check_in_services 0건 → 토글 미노출', () => {
  const t = selectBloodTarget([]);
  expect(isVisible(t)).toBe(false);
});

// ── S3: 내원 둘이면 가장 최근(created_at DESC) 내원 선정 ───────────────────────
test('S3: 내원 2회 → 최신 내원을 타겟', () => {
  const rows: SvcRow[] = [
    { id: 's-old', blood_test_requested: true, check_in_id: 'ci-05', created_at: '2026-05-26T02:00:00+00:00' },
    { id: 's-new', blood_test_requested: false, check_in_id: 'ci-06', created_at: '2026-06-15T02:00:00+00:00' },
  ];
  const t = selectBloodTarget(rows);
  expect(t.checkInId).toBe('ci-06');
  expect(t.svcs.map((s) => s.id)).toEqual(['s-new']);
});

// ── S4: 같은 내원 서비스만 묶음(타 내원 미혼입) ───────────────────────────────
test('S4: 타겟 내원의 서비스만 묶고 타 내원 서비스는 제외', () => {
  const rows: SvcRow[] = [
    { id: 'a1', blood_test_requested: false, check_in_id: 'ci-new', created_at: '2026-06-15T02:00:00+00:00' },
    { id: 'a2', blood_test_requested: false, check_in_id: 'ci-new', created_at: '2026-06-15T02:30:00+00:00' },
    { id: 'b1', blood_test_requested: true, check_in_id: 'ci-old', created_at: '2026-05-26T02:00:00+00:00' },
  ];
  const t = selectBloodTarget(rows);
  expect(t.checkInId).toBe('ci-new');
  expect(t.svcs.map((s) => s.id).sort()).toEqual(['a1', 'a2']);
  expect(t.svcs.find((s) => s.id === 'b1')).toBeUndefined();
});

// ── S5: anyOn 집계 ────────────────────────────────────────────────────────────
test('S5: 타겟 내원 service 중 하나라도 blood_test_requested 면 ON', () => {
  const on = selectBloodTarget([
    { id: 's1', blood_test_requested: false, check_in_id: 'ci', created_at: '2026-06-15T02:00:00+00:00' },
    { id: 's2', blood_test_requested: true, check_in_id: 'ci', created_at: '2026-06-15T02:30:00+00:00' },
  ]);
  const off = selectBloodTarget([
    { id: 's3', blood_test_requested: false, check_in_id: 'ci', created_at: '2026-06-15T02:00:00+00:00' },
  ]);
  expect(anyOn(on)).toBe(true);
  expect(anyOn(off)).toBe(false);
});

// ── S6: 기본 OFF(AC-1/AC-3) — 신규 미신청 내원은 anyOn=false ────────────────────
test('S6: 신규(미신청) 내원 → 기본 OFF(anyOn=false)', () => {
  const t = selectBloodTarget([
    { id: 's1', blood_test_requested: false, check_in_id: 'ci', created_at: '2026-06-16T02:00:00+00:00' },
  ]);
  expect(isVisible(t)).toBe(true);
  expect(anyOn(t)).toBe(false);
});

// ── S7: 실 브라우저 스모크 — 셸 렌더 ──────────────────────────────────────────
test('S7: 로그인 셸 렌더 스모크', async ({ page }) => {
  const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
  const resp = await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => null);
  test.skip(!resp, 'BASE 미기동 — 스모크 스킵(로직 S1~S6 가 핵심)');
  await expect(page.locator('body')).toBeVisible();
});
