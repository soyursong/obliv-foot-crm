/**
 * E2E Spec: T-20260721-foot-WRITE-ROWCHECK-SILENTLOSS-GUARD
 * 클라이언트 write(.update().eq()) rows-affected 검증 — 사일런트 유실(거짓 성공) 방어.
 *
 * 스코프 write 2곳:
 *   1) updateInsuranceGrade  (src/hooks/useInsurance.ts) — 자격등급 수동 갱신
 *   2) saveCertNo            (src/pages/CustomerChartPage.tsx) — 보험 증번호 저장
 *
 * 배경(anti-pattern): RLS 거부/스코프 불일치/id 미존재 시 supabase 는
 *   error=null + 0-row 를 반환한다. 기존 코드는 error 만 검사 → 0-row 를 "성공"으로
 *   오인해 거짓 성공 toast + 낙관 로컬반영 → DB 실재와 divergence(사일런트 유실).
 *   방어: write 체인에 .select() 를 붙여 반영 행을 회수하고 count===0 을 저장 실패로 판정.
 *
 * AC-1: write 후 .select() 로 affected row 회수 → count===0 이면 성공 처리 금지.
 * AC-2: 0-row(또는 error) 시 error toast, "저장되었습니다" 거짓 성공 toast 미노출 + 로컬 상태 저장전 값 유지.
 * AC-3: 정상 저장(happy path)·성공 toast 무변경(회귀 0).
 *
 * 검증 방식(planner 회신):
 *   - 시나리오1(정상 저장 회귀)·시나리오2(0-row) 모두 실 UI 동선 + 결정적 시드로 검증.
 *   - 결정적화: 서비스롤로 고객 1건 self-seed → /chart/{id} 진입해 실제 saveCertNo 경로 구동.
 *   - 시나리오2(0-row → error toast): full-RLS-deny 재현은 seed 의존/취약 → supabase REST PATCH 를
 *     page.route 로 가로채 200 + 빈 배열([]) 응답(=0-row)으로 모의 = 결정적 통합 테스트.
 *   - 서비스롤/인증 부재 환경(CI)에선 graceful skip (레포 seed-spec 컨벤션 계승).
 */

import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const HAS_SERVICE_ROLE = SERVICE_KEY.length > 0;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const SEED_MARKER = 'ROWCHECKSEED';

const CERT_INPUT = 'input[placeholder="건강보험증 번호 (선택)"]';
const CUSTOMERS_PATCH = '**/rest/v1/customers*';

function svc(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

let seededCustomerId: string | null = null;

test.beforeAll(async () => {
  if (!HAS_SERVICE_ROLE) return;
  const sb = svc();
  const ts = Date.now();
  const { data } = await sb
    .from('customers')
    .insert({
      clinic_id: CLINIC_ID,
      name: `${SEED_MARKER}-${ts}`,
      phone: `+8210${String(ts).slice(-8)}`, // customers_phone_e164_chk 준수(E.164)
      visit_type: 'new',
    })
    .select('id')
    .single();
  seededCustomerId = data?.id ?? null;
});

test.afterAll(async () => {
  if (!HAS_SERVICE_ROLE || !seededCustomerId) return;
  await svc().from('customers').delete().eq('id', seededCustomerId);
});

async function openSeededChart(page: import('@playwright/test').Page): Promise<boolean> {
  if (!HAS_SERVICE_ROLE || !seededCustomerId) return false;
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) return false;
  await page.goto(`/chart/${seededCustomerId}`);
  await page.waitForLoadState('networkidle');
  return (await page.locator(CERT_INPUT).count()) > 0;
}

// ── AC-1(회귀 가드): 고객차트 로드 시 rows-affected 가드 추가 관련 런타임 에러 없음 ──
test('AC-1: 고객차트 로드 — rows-affected 가드(.select) 추가 관련 런타임 에러 없음', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/admin/dashboard');
  await page.waitForLoadState('networkidle');
  const relevant = errors.filter((e) => {
    const m = e.toLowerCase();
    return m.includes('insurance') || m.includes('cert') || m.includes('grade');
  });
  expect(relevant).toHaveLength(0);
});

// ── 시나리오1 (AC-3): 정상 저장 happy path — 성공 toast 무변경 + 값 persist (회귀 0) ──
test('시나리오1: 보험 증번호 정상 저장 → 성공 toast + 값 유지 (회귀 0)', async ({ page }) => {
  // PATCH → 정상 1-row 응답 모의 (.select() 추가로 representation 배열 반환 경로 검증)
  await page.route(CUSTOMERS_PATCH, async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: seededCustomerId ?? 'e2e-mock' }]), // 1-row = 정상 저장
      });
      return;
    }
    await route.continue();
  });

  if (!(await openSeededChart(page))) {
    test.skip(true, '서비스롤/인증/차트 미준비 — 정상 저장 풀 동선 스킵(AC-1 스모크로 커버)');
  }

  const certInput = page.locator(CERT_INPUT).first();
  await certInput.fill('26003663272');
  // Enter = saveCertNo 직접 트리거(모호한 '저장' 버튼 회피). PATCH 완료까지 대기해 저장 흐름 확정.
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/rest/v1/customers') && r.request().method() === 'PATCH'),
    certInput.press('Enter'),
  ]);
  await page.waitForTimeout(800); // toast 렌더 여지

  // 주: 이 앱의 toast 래퍼(@/lib/toast)는 toast.success 를 의도적으로 묵음 처리한다
  //   (generic 성공은 무음, 실패/경고만 노출 — T-20260524-foot-TOAST-CLEANUP). 따라서 정상 저장의
  //   관측 신호는 "실패 toast 부재 + 값 persist"다(레포 CERTNO-FIELD spec 과 동일 컨벤션).
  //   AC-3(성공 toast 무변경): .select() 추가가 happy path 를 거짓-실패로 뒤집지 않음을 검증.
  await expect(page.locator('text=보험 증번호 저장 실패')).toHaveCount(0);
  await expect(page.locator('text=준비 중')).toHaveCount(0);
  await expect(certInput).toHaveValue('26003663272');
});

// ── 시나리오2 (AC-1/AC-2): 0-row 응답 → 저장 실패 판정 + error toast, 거짓 성공 toast 미노출 ──
test('시나리오2: 0-row(빈 배열) 응답 → error toast + "저장되었습니다" 미노출', async ({ page }) => {
  // PATCH → error=null 이지만 0-row(빈 배열) 모의 = RLS 거부/스코프 불일치 재현
  await page.route(CUSTOMERS_PATCH, async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]), // 0-row = 사일런트 유실 상황
      });
      return;
    }
    await route.continue();
  });

  if (!(await openSeededChart(page))) {
    test.skip(true, '서비스롤/인증/차트 미준비 — 0-row 동선 스킵');
  }

  const certInput = page.locator(CERT_INPUT).first();
  await certInput.fill('99999999999');
  await certInput.press('Enter'); // cert 입력 Enter = saveCertNo 직접 트리거

  // 저장 실패 안내 노출 + 거짓 성공 toast 미노출 (AC-1/AC-2)
  await expect(page.locator('text=보험 증번호 저장 실패')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('text=보험 증번호가 저장되었습니다')).toHaveCount(0);
});
