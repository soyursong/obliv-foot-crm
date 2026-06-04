/**
 * E2E (실브라우저 렌더) — T-20260604-foot-RX-CHART-PERSIST-BUG
 * 진료차트(MedicalChartPanel) 진입 자체 에러·접근불가 회귀 방지.
 * 현장: 문지은 대표원장 (C0ATE5P6JTH, 2026-06-04) — "그냥 진료차트가 에러야 접근안됨".
 *
 * 근본 원인: MedicalChartPanel 의 `const [pinningId] = useState()` 가
 *   `if (!open) return null` 조기반환 '이후'에 선언되어 Rules of Hooks 위반.
 *   FOLLOWUP3 C-1(DoctorCallDashboard 가 패널을 상시 마운트 + open 토글)로
 *   open false→true 전환 시 "Rendered more hooks than during the previous render"
 *   런타임 throw → 진료차트 진입 크래시.
 * 수정: pinningId useState 를 조기반환 이전 상단 hook 블록으로 상향 이동.
 *
 * ⚠ 테스트 갭 메모: 기존 차트 관련 spec 은 순수 로직 단위테스트라
 *   컴포넌트를 실제로 마운트/토글하지 않아 본 크래시를 잡지 못했음.
 *   본 spec 은 실브라우저에서 open 토글 진입을 직접 검증(필수 회귀 게이트).
 *
 * AC:
 *   AC1 — 진료알림판 차팅 버튼(open false→true 토글) 클릭 시 진료차트가
 *         에러 없이 정상 렌더(진단명 필드 노출).
 *   AC2 — open 토글 진입 중 "Rendered more hooks" / hook 순서 변경 pageerror 0건.
 */
import { test, expect } from '@playwright/test';

test.use({ storageState: '.auth/user.json' });

test('AC1+AC2: 진료알림판 차팅 → 진료차트 open 토글 진입, hook-order 크래시 없이 정상 렌더', async ({ page }) => {
  const fatal: string[] = [];
  page.on('pageerror', (e) => fatal.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /Rendered more hooks|order of Hooks|Rules of Hooks/i.test(m.text())) {
      fatal.push(m.text());
    }
  });

  await page.goto('/admin/doctor-tools');
  await page.waitForLoadState('networkidle');

  // 진료 알림판 탭으로 전환 → MedicalChartPanel 이 open=false 로 상시 마운트(C-1 패턴)
  await page.getByTestId('tab-call-dashboard').click();
  await page.waitForTimeout(800);

  const chartBtns = page.getByTestId('doctor-call-chart-btn');
  const count = await chartBtns.count();
  // 알림판에 당일 진료 환자가 있어야 차팅 진입 검증 가능. 없으면 환경 한계로 skip.
  test.skip(count === 0, '진료 알림판에 당일 환자 없음 — open 토글 진입 검증 불가 환경');

  // open false→true 토글 (크래시 트리거 경로)
  await chartBtns.first().click();

  // AC1: 진료차트 진단명 필드가 에러 없이 렌더
  await expect(page.getByTestId('medical-chart-diagnosis')).toBeVisible({ timeout: 5000 });

  // AC2: hook-order 관련 치명적 에러 0건
  expect(fatal, 'hook-order / pageerror 발생: ' + fatal.join(' | ')).toHaveLength(0);
});
