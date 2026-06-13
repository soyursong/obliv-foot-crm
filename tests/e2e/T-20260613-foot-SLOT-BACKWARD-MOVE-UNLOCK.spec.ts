/**
 * E2E spec — T-20260613-foot-SLOT-BACKWARD-MOVE-UNLOCK
 * 대시보드 슬롯 전(前)단계 이동 차단 해제 — **라이브 검증**.
 * 현장(김주연 총괄): 임상상 역행 필수(예: 수납대기 고객 후상담 요청 → 상담 단계 복귀).
 *
 * ── FIX (MSG-20260613-175433 / supervisor QA REOPEN) ──────────────────────────
 *  이전 스펙은 칸반 카드 부재 시 전 테스트가 test.skip → AC-R1/AC-R2 가 한 번도 라이브 실행되지 않음.
 *  또한 우클릭(right-click)은 StatusContextMenu(⋮ 상태변경) 가 아니라 CustomerQuickMenu(고객차트) 를 연다.
 *  → 본 스펙은 (a) service-role 로 '수납대기'(payment_waiting) 카드를 결정적으로 시딩하고,
 *           (b) 실제 ⋮(상태 변경) 버튼을 눌러 메뉴를 열고,
 *           (c) '상담'(consultation = 역방향) 을 클릭해 수납대기→상담 역이동을 라이브로 수행한 뒤,
 *           (d) DB status 전이(payment_waiting→consultation) 를 service-role 로 확정하고 스크린샷 증거를 남긴다.
 *  시딩 카드 기준이므로 더 이상 스킵되지 않음(서비스키 부재 환경만 예외 skip).
 *
 * 수정 대상: StatusContextMenu.tsx 의 isBackward 봉쇄 제거 + opacity-50 disabled-look 제거 + 되돌리기 어포던스.
 *
 * AC-R1: ⋮ 메뉴에서 수납대기→상담 역이동 실제 발생 + DB 전이 확정 (라이브)
 * AC-R2: 역방향 이동이 차단되지 않고 끝까지 영속(서버 반영) — backward unlock end-to-end 증명
 * AC-R3: 역방향(이전 단계) 항목이 disabled-look(opacity-50) 아님 + "되돌리기" 어포던스 노출
 * AC-5:  정방향/메뉴 구조 무회귀 (현 진행단계 + 체크인 취소 정상, disabled 단계 1개 이하)
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const TEST_EMAIL = process.env.TEST_EMAIL ?? process.env.TEST_USER_EMAIL ?? 'test@medibuilder.com';
// 시뮬레이션/테스트 클리닉 (simulationFilter.ts·foot-qa-r1 참조) — user_profiles 조회 실패 시 폴백
const FALLBACK_CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const SEED_NAME = `E2E역행${Date.now().toString().slice(-6)}`;

const hasServiceKey = Boolean(SUPA_URL && SERVICE_KEY);

let sb: SupabaseClient;
let seededId: string | null = null;
let clinicId = FALLBACK_CLINIC;

/** 서비스 롤로 '수납대기'(payment_waiting) 초진 카드를 오늘자로 시딩 → 상담(index2) 이 역방향 단계가 됨 */
async function seedPaymentWaitingCard(): Promise<string | null> {
  // 로그인 유저의 clinic 으로 시딩해야 대시보드에 렌더됨
  const { data: prof } = await sb
    .from('user_profiles')
    .select('clinic_id')
    .eq('email', TEST_EMAIL)
    .maybeSingle();
  clinicId = (prof?.clinic_id as string | null) ?? FALLBACK_CLINIC;

  const { data, error } = await sb
    .from('check_ins')
    .insert({
      clinic_id: clinicId,
      customer_id: null, // 실고객 미연결 → stripSimulationRows 대상 아님(항상 렌더)
      customer_name: SEED_NAME,
      visit_type: 'new', // NEW_PATIENT_STAGES 사용 → consultation 포함
      status: 'payment_waiting', // 수납대기 (현재) — 상담은 isPast(역방향)
      queue_number: 9000 + Math.floor(Math.random() * 900),
      checked_in_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) {
    console.error('seed 실패:', error.message);
    return null;
  }
  return data.id as string;
}

async function readStatus(id: string): Promise<string | null> {
  const { data } = await sb.from('check_ins').select('status').eq('id', id).maybeSingle();
  return (data?.status as string | undefined) ?? null;
}

/** 시딩 카드 로케이터 (수납대기 컬럼에 렌더) */
function seededCard(page: Page) {
  return page.locator('[data-testid="checkin-card"]').filter({ hasText: SEED_NAME }).first();
}

/**
 * 진행단계 버튼을 라벨로 결정적 타게팅 + 클릭.
 * 버튼 텍스트 = 단계라벨 + (현재|되돌리기 배지) → 배지 토큰을 제거해 정확 매칭.
 * (status-flag/체크인취소 버튼도 dot span 을 가지지만 라벨이 달라 자연 제외)
 * @returns 클릭 직전 disabled 여부
 */
async function clickStageButton(menuBody: ReturnType<Page['locator']>, label: string): Promise<boolean> {
  const btns = menuBody.locator('button:has(span.rounded-full)');
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const raw = (await btns.nth(i).innerText()).replace(/되돌리기|현재/g, '').trim();
    if (raw === label) {
      const disabled = await btns.nth(i).isDisabled();
      await btns.nth(i).click();
      return disabled;
    }
  }
  throw new Error(`진행단계 버튼 '${label}' 미발견`);
}

/** 카드의 ⋮(상태 변경) 버튼 → StatusContextMenu 오픈. 우클릭은 고객메뉴라 사용 금지. */
async function openStatusMenu(page: Page) {
  const card = seededCard(page);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.scrollIntoViewIfNeeded();
  // ⋮(상태 변경) 버튼 — data-testid 로 결정적 타게팅(아이콘 클래스 의존 제거).
  const moreBtn = card.getByTestId('card-status-menu-btn').last();
  await moreBtn.click();
  const menuBody = page.locator('.fixed.z-50').last();
  await expect(menuBody).toBeVisible({ timeout: 3_000 });
  await expect(menuBody.getByText('현 진행단계')).toBeVisible();
  return menuBody;
}

test.describe('T-20260613-foot-SLOT-BACKWARD-MOVE-UNLOCK — 전단계 이동 차단 해제 (라이브)', () => {
  test.skip(!hasServiceKey, 'SUPABASE_SERVICE_ROLE_KEY 없음 — 시딩 불가(로컬 키 미설정)');

  test.beforeAll(async () => {
    sb = createClient(SUPA_URL, SERVICE_KEY);
    seededId = await seedPaymentWaitingCard();
    expect(seededId, '수납대기 카드 시딩 실패 — DB/키 확인').toBeTruthy();
  });

  test.afterAll(async () => {
    if (seededId) await sb.from('check_ins').delete().eq('id', seededId);
  });

  test.beforeEach(async ({ page }) => {
    // 각 테스트 시작 시 시딩 카드를 payment_waiting 으로 리셋(이전 테스트가 상담으로 바꿨을 수 있음)
    if (seededId) await sb.from('check_ins').update({ status: 'payment_waiting' }).eq('id', seededId);
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC-R1 + AC-R2: ⋮ 메뉴로 수납대기→상담 역이동 실제 수행 + DB 전이 확정 ──────────────
  test('AC-R1/R2: ⋮ 메뉴에서 수납대기→상담 역이동 실수행 + DB 전이 확정', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    await page.reload(); // 시딩 카드 반영
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const menuBody = await openStatusMenu(page);

    // 현재 단계가 수납대기로 표기 (헤더 라인 + 단계 버튼 양쪽에 존재 → first)
    await expect(menuBody.getByText('수납대기').first()).toBeVisible();

    // [증거1] ⋮ 메뉴 오픈 — 수납대기 카드에서 역방향 '상담' 단계가 클릭 가능(차단 해제) 상태
    await page.screenshot({ path: 'test-results/SLOT-BACKWARD-AC-R1-menu-open.png', fullPage: false });

    // '상담'(consultation) = 역방향 단계. 라벨 정규화로 '상담대기' 와 구분.
    // 역방향 단계 버튼은 disabled 가 아니어야 함(차단 해제 확인) → 클릭.
    const wasDisabled = await clickStageButton(menuBody, '상담');
    expect(wasDisabled).toBe(false);

    // 상담실 목록이 있으면 서브메뉴가 열림 → '실 미배정' 으로 상태만 전이
    const unassigned = page.locator('.fixed.z-50').last().getByText('실 미배정');
    if (await unassigned.first().isVisible({ timeout: 800 }).catch(() => false)) {
      await unassigned.first().click();
    }

    // DB 전이 확정 — payment_waiting → consultation (역방향 영속)
    let finalStatus: string | null = null;
    await expect
      .poll(async () => (finalStatus = await readStatus(seededId!)), { timeout: 8_000, intervals: [300, 500, 800] })
      .toBe('consultation');
    expect(finalStatus).toBe('consultation');

    // [증거2] 전이 후 보드 — 시딩 카드가 상담 단계로 이동(역행 영속). 보드 로딩 완료까지 대기 후 캡처.
    await page.reload();
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    // 칸반 카드가 다시 렌더될 때까지 대기(로딩 'spinner' 회피) → 시딩 카드 가시화
    await seededCard(page).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'test-results/SLOT-BACKWARD-AC-R1-evidence.png', fullPage: false });
  });

  // ── AC-R3: 역방향 항목 disabled-look(opacity-50) 아님 + 되돌리기 어포던스 ───────────────
  test('AC-R3: 역방향 단계 disabled-look 없음 + 되돌리기 어포던스 노출', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    await page.reload();
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const menuBody = await openStatusMenu(page);

    // 진행단계 섹션 어떤 버튼에도 opacity-50(disabled-look)이 남으면 안 됨
    const opacityCount = await menuBody.locator('button.opacity-50').count();
    expect(opacityCount).toBe(0);

    // 수납대기 카드 → 상담/진료대기 등 이전 단계가 다수 → "되돌리기" 어포던스가 1개 이상 노출
    const revert = menuBody.getByText('되돌리기');
    await expect(revert.first()).toBeVisible();
    const revertBtn = revert.first().locator('xpath=ancestor::button[1]');
    expect(await revertBtn.isDisabled()).toBe(false);

    await page.keyboard.press('Escape');
  });

  // ── AC-5: 메뉴 구조 무회귀 + disabled 단계 1개(현재) 이하 ─────────────────────────────
  test('AC-5: 진행단계 메뉴 구조 회귀 없음 + disabled 단계 1개 이하', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    await page.reload();
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const menuBody = await openStatusMenu(page);
    await expect(menuBody.getByText('현 진행단계')).toBeVisible();
    await expect(menuBody.getByText('체크인 취소')).toBeVisible();

    // 진행단계 버튼 중 disabled 는 현재 단계(수납대기) 1개 이하 — 역방향 봉쇄 0
    const stageButtons = menuBody.locator('button:has(span.rounded-full)');
    const total = await stageButtons.count();
    let disabledCount = 0;
    for (let i = 0; i < total; i++) {
      if (await stageButtons.nth(i).isDisabled()) disabledCount++;
    }
    expect(disabledCount).toBeLessThanOrEqual(1);

    await page.keyboard.press('Escape');
  });
});
