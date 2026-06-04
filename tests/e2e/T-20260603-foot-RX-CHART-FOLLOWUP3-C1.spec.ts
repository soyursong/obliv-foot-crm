/**
 * E2E (실브라우저 렌더) — T-20260603-foot-RX-CHART-FOLLOWUP3 C-1 (REOPEN)
 * 진료알림판 서랍 = '진료차트'(MedicalChartPanel) 오픈, '기본차트(고객차트)' 아님.
 *
 * 현장: 문지은 대표원장 (C0ATE5P6JTH, thread 1780569349.773889, 2026-06-04)
 *   "진료차트 일시적 버그인줄 알았는데 계속 안되네" — 배포본(9a737fd)에서도 진료알림판
 *   서랍이 진료차트 아닌 기본차트로 보임/접근불가.
 *
 * ── field-soak 실패 근본원인 (증거 기반, 추정 금지) ───────────────────────────
 *   C-1 라우팅(9a737fd)은 소스상 정상 — DoctorCallDashboard 차팅 버튼/행 클릭이
 *   MedicalChartPanel(진료차트)을 직접 오픈하도록 전환됨(useChart.openChart 제거).
 *   그러나 C-1이 패널을 '상시 마운트 + open 토글'로 바꾸면서, MedicalChartPanel 의
 *   `const [pinningId] = useState()` 가 `if (!open) return null` 조기반환 '이후'에
 *   선언돼 있던 잠복 Rules-of-Hooks 위반을 발화 → open false→true 전환 시
 *   "Rendered more hooks than during the previous render" 런타임 throw → 진료차트
 *   진입 크래시. 배포본 15fefbb 에는 이 크래시 수정(91adca3)이 미포함이었음.
 *
 * ── 테스트 갭 (본 spec 이 메우는 것) ─────────────────────────────────────────
 *   기존 C-1 검증 spec(DOCTOR-CALL-DEFAULT-MEDTAB)은 라우팅 로직을 테스트 파일 안에
 *   재구현한 '순수 모델(박제)'이라 컴포넌트를 실제로 마운트/토글하지 않음 → 실배포
 *   배선·hook-order 크래시를 원천적으로 못 잡음(QA 통과·현장 실패의 구조적 이유).
 *   본 spec 은 실브라우저에서 진료알림판 차팅 트리거를 직접 클릭해
 *   (a) 열린 서랍이 '진료차트'(aria-label) 이고 '고객차트(기본차트)' 가 아님을 단언,
 *   (b) open 토글 진입 중 hook-order 크래시 0건을 회귀 게이트로 박제한다.
 *
 * AC:
 *   AC-1-1 — 진료알림판 차팅 트리거 클릭 시 '진료차트'(aria-label="진료차트") 서랍이
 *            열리고, '고객차트'(aria-label="고객차트", 기본차트 서랍) 는 보이지 않음.
 *   AC-1-2 — 진료차트 전용 영역(진단명 필드)이 정상 렌더(차트타입=진료차트 식별).
 *   AC-1-3 — open 토글 진입 중 "Rendered more hooks"/hook 순서 pageerror 0건(크래시 회귀).
 */
import { test, expect } from '@playwright/test';

test.use({ storageState: '.auth/user.json' });

test('AC-1: 진료알림판 차팅 → 진료차트(기본차트 아님) 서랍 오픈 + 크래시 0', async ({ page }) => {
  const fatal: string[] = [];
  page.on('pageerror', (e) => fatal.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /Rendered more hooks|order of Hooks|Rules of Hooks/i.test(m.text())) {
      fatal.push(m.text());
    }
  });

  await page.goto('/admin/doctor-tools');
  await page.waitForLoadState('networkidle');

  // 진료알림판(진료콜 통합 대시보드) 탭 — MedicalChartPanel 이 open=false 로 상시 마운트(C-1 패턴)
  await page.getByTestId('tab-call-dashboard').click();
  await page.waitForTimeout(800);

  const chartBtns = page.getByTestId('doctor-call-chart-btn');
  const count = await chartBtns.count();
  // 진료알림판에 당일 진료 환자가 있어야 서랍 진입 검증 가능. 없으면 환경 한계로 skip.
  test.skip(count === 0, '진료알림판에 당일 환자 없음 — 서랍 진입 검증 불가 환경');

  // 차팅 트리거 클릭 = open false→true 토글 (C-1 현장 실경로 + 크래시 트리거 경로)
  await chartBtns.first().click();

  // AC-1-1: 열린 서랍이 '진료차트' 이고 '고객차트(기본차트)' 가 아님
  await expect(
    page.getByRole('dialog', { name: '진료차트' }).or(page.locator('[aria-label="진료차트"]')),
  ).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[aria-label="고객차트"]')).toHaveCount(0);

  // AC-1-2: 진료차트 전용 영역(진단명) 정상 렌더 = 차트타입 진료차트 식별
  await expect(page.getByTestId('medical-chart-diagnosis')).toBeVisible({ timeout: 5000 });

  // AC-1-3: hook-order 크래시 0건 (배포본 15fefbb 의 field-soak 실패 회귀 게이트)
  expect(fatal, 'hook-order / pageerror 발생: ' + fatal.join(' | ')).toHaveLength(0);
});
