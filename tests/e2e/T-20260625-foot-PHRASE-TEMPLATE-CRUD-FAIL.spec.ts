/**
 * E2E spec — T-20260625-foot-PHRASE-TEMPLATE-CRUD-FAIL
 * 진료관리 슈퍼상용구 / 상용구(진료차트) / 서류템플릿 3탭 CRUD 복구.
 *
 * RC(AC-0 트리아지, PROD 실측): 문지은 대표원장 admin→director swap 후
 *   ① FE canEdit = (admin-only) → director 버튼 미노출
 *   ② RLS admin_write_* = role IN {admin,manager} → director write 0행 거부(INSERT 에러 / UPDATE·DELETE silent no-op)
 *   양쪽 director 누락이 단일 공통 RC. 수정 = FE(canEditClinicMgmt) + RLS(director 추가) ★combined-deploy★.
 *
 * 본 spec 의 한계: 테스트 세션(test@medibuilder.com)=admin 이라 director 전용 경로는 직접 검증 불가
 *   → director write 복구는 TX-rollback probe(scripts/..._txprobe.mjs, 7 assert PASS) + 문지은 대표원장 실기기 confirm 으로 검증.
 * 본 spec 의 역할 = AC-3(회귀 0) 가드: ADDITIVE 변경(FE 술어 전환 + RLS superset)이
 *   기존 admin write·목록 로드·탭 렌더를 깨지 않음을 보장.
 *
 * AC-1/AC-2: super_phrases 추가→수정 없는 round-trip(추가→삭제) write-path 무에러.
 * AC-3: 3탭 목록 로드·탭 렌더·추가 버튼 노출 회귀 0.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const TAB_URL = (tab: string) => `/admin/clinic-management?tab=${tab}`;

test.describe('T-20260625 PHRASE-TEMPLATE-CRUD-FAIL 진료관리 3탭 CRUD', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-1+AC-2: 슈퍼상용구 추가→삭제 round-trip — write-path 무에러', async ({ page }) => {
    // 삭제 confirm() 자동 수락
    page.on('dialog', (d) => d.accept());

    await page.goto(TAB_URL('super_phrases'));

    // AC-3: 탭 렌더 + 추가 버튼(canEdit=true, admin) 노출
    const addBtn = page.getByTestId('super-phrase-add-btn');
    await expect(addBtn).toBeVisible({ timeout: 10_000 });

    // 추가 다이얼로그 오픈
    await addBtn.click();
    await expect(page.getByText('슈퍼상용구 추가', { exact: true })).toBeVisible({ timeout: 5_000 });

    const name = `[E2E] 슈퍼상용구 ${Date.now()}`;
    await page.getByTestId('super-phrase-name-input').fill(name);

    // 저장 (AC-1: INSERT write-path)
    await page.getByTestId('super-phrase-save-btn').click();

    // 저장 실패 toast 부재 = RLS/제약 위반 없이 write 성공 (durable gate)
    await expect(page.getByText(/저장 실패/)).toHaveCount(0);
    // 다이얼로그 닫힘 + 목록에 새 행 반영
    await expect(page.getByText('슈퍼상용구 추가', { exact: true })).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 8_000 });

    // 정리: 방금 만든 행 삭제 (DELETE write-path + 데이터 비오염). 행=name 포함 super-phrase-item, 삭제=행 내 마지막 버튼(Trash2).
    const row = page.getByTestId('super-phrase-item').filter({ hasText: name });
    await expect(row).toBeVisible({ timeout: 5_000 });
    await row.getByRole('button').last().click(); // confirm() 은 dialog 핸들러가 accept
    await expect(page.getByText(/삭제 실패/)).toHaveCount(0);
    // 삭제 반영 확인 (데이터 비오염 보장)
    await expect(row).toHaveCount(0, { timeout: 8_000 });

    console.log('[AC-1+2] 슈퍼상용구 add round-trip write-path 무에러 OK');
  });

  test('AC-3: 상용구(진료차트) 탭 렌더 + 목록 로드 회귀 0', async ({ page }) => {
    await page.goto(TAB_URL('medchart_phrases'));
    // 탭 트리거 활성 + 추가 버튼 노출(admin canEdit)
    await expect(page.getByTestId('phrase-add-btn')).toBeVisible({ timeout: 10_000 });
    // 목록 로드 중 write-error toast 없음
    await expect(page.getByText(/저장 실패|삭제 실패/)).toHaveCount(0);
    console.log('[AC-3] 진료차트 상용구 탭 렌더·로드 OK');
  });

  test('AC-3: 서류템플릿 탭 렌더 + 목록 로드 회귀 0', async ({ page }) => {
    await page.goto(TAB_URL('documents'));
    await expect(page.getByTestId('doc-template-add-btn')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/저장 실패|삭제 실패/)).toHaveCount(0);
    console.log('[AC-3] 서류템플릿 탭 렌더·로드 OK');
  });
});
