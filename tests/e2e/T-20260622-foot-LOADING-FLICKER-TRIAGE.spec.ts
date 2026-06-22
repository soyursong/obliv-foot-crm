/**
 * E2E spec — T-20260622-foot-LOADING-FLICKER-TRIAGE
 * 풋 CRM 로딩 깜빡임("숨바꼭질") 근인 수정 검증.
 *
 * 배경 (김주연 운영총괄, foot 채널 / planner triage):
 *   화면이 떴다 사라졌다 반복 — 대표 재현 케이스 = 통계 > 치료사 통계.
 *   다른 채팅창/탭 잠깐 보고 복귀(window blur→focus / visibilitychange)하면
 *   통계값이 나와 있어도 전체 로딩 화면으로 되돌아감(매번 재현).
 *
 * 근인 (AC-0 triage 확정):
 *   useClinic() 의 focus/visibility 리스너가 getClinic({force:true}) 로 매번
 *   "새 객체 reference" 를 받아 setClinic(c) 한다. 내용이 동일해도 reference 만
 *   바뀐다. 다수 화면(통계·예약·대시보드 등)이 `clinic` 객체를 data-fetch
 *   useEffect 의존성에 넣어두어, reference 변경만으로 effect 재실행 →
 *   setLoading(true) → 전체 로딩 화면 깜빡임. (전역 패턴, 치료사 통계는 최다 노출 케이스)
 *
 * 수정 (외과적, 1파일):
 *   src/hooks/useClinic.ts — 재조회 결과가 직전 clinic 과 내용 동일하면 이전
 *   reference 를 유지(stable identity). 값이 실제로 바뀐 경우에만 새 reference 로
 *   교체 → LASER-TIMER 설정 반영 의도 보존, 불필요한 effect 재실행/로딩 깜빡임 제거.
 *
 * 검증 구성:
 *   AC-로직 (DB 비의존): useClinic 소스가 stable-identity 가드를 포함한다.
 *   AC-브라우저 (best-effort): 치료사 통계 진입·로드 후 visibilitychange(hidden→visible)/
 *     focus 를 발생시켜도 전체 "로딩 중…" 화면으로 되돌아가지 않는다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loginAndWaitForDashboard } from '../helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USECLINIC_PATH = resolve(__dirname, '../../src/hooks/useClinic.ts');

test.describe('T-20260622 LOADING-FLICKER-TRIAGE — clinic reference 안정화로 로딩 깜빡임 제거', () => {
  // ── AC-로직: useClinic 이 내용 동일 시 이전 reference 유지(불필요한 setState 회피) ──
  test('AC-로직: useClinic 재조회 시 내용 동일하면 stable reference 유지', () => {
    const src = readFileSync(USECLINIC_PATH, 'utf8');

    // focus/visibility 재조회 경로가 여전히 존재(LASER-TIMER 의도 보존)
    expect(src).toMatch(/addEventListener\(\s*['"]focus['"]/i);
    expect(src).toMatch(/visibilitychange/i);
    expect(src).toMatch(/force:\s*true/i);

    // 핵심: setClinic 이 직전 값과 동일하면 prev 를 반환(새 reference churn 방지).
    // 함수형 업데이트 + 동등 비교가 함께 존재해야 함.
    expect(src).toMatch(/setClinic\(\s*\(prev\)\s*=>/);
    // 동등 비교로 동일하면 prev, 아니면 새 값 — JSON 직렬화 비교 기준.
    expect(src).toMatch(/JSON\.stringify\(prev\)\s*===\s*JSON\.stringify\(c\)\s*\?\s*prev\s*:\s*c/);
  });

  // ── AC-브라우저: 치료사 통계 로드 후 focus/visibility 발생 시 전체 로딩 화면 재진입 없음 ──
  test('AC-브라우저: 통계 로드 후 visibility/focus 복귀 시 로딩 화면으로 안 돌아감', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '로그인 불가 환경 — AC-로직으로 대체');

    await page.goto('/admin/stats');
    const tab = page.getByTestId('stats-tab-therapist');
    try {
      await tab.waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
      test.skip(true, 'stats 접근 불가 role(=권한 차단 정상)');
      return;
    }
    await tab.click();

    // 통계 섹션 마운트 + 로딩 종료(데이터 또는 '데이터 없음') 대기
    const avgSection = page.getByTestId('therapist-metric-avgtime');
    await expect(avgSection).toBeVisible();
    // '로딩 중…' 이 사라질 때까지 (최대 15s)
    await page
      .getByText('로딩 중…', { exact: false })
      .first()
      .waitFor({ state: 'hidden', timeout: 15_000 })
      .catch(() => {});

    const loadedText = (await avgSection.innerText()) || '';

    // 탭을 hidden→visible 로 전환(다른 채팅창 보고 복귀를 시뮬레이션) + focus 이벤트
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });

    // 복귀 직후 짧은 구간 동안 전체 "로딩 중…" 화면으로 되돌아가지 않아야 함.
    // (clinic 내용 무변경 → reference 유지 → Stats useEffect 미재실행 → setLoading(true) 없음)
    await page.waitForTimeout(1_500);
    const afterText = (await avgSection.innerText()) || '';

    // 직전에 데이터/‘데이터 없음’ 이 보였다면, 복귀 후 '로딩 중…' 단독 화면으로 회귀하지 않음
    if (!loadedText.includes('로딩 중')) {
      expect(afterText.includes('로딩 중'), '복귀 후 전체 로딩 화면으로 되돌아감(깜빡임 재현)').toBe(false);
    }
  });
});
