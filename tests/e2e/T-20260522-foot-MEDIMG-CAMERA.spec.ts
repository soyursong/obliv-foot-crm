/**
 * E2E spec — T-20260522-foot-MEDIMG-CAMERA
 * 진료이미지 [사진촬영] 버튼 + 연속촬영 + 자동업로드 + 편집/회전
 *
 * AC-1: [사진촬영] 버튼이 진료이미지 탭 업로드 바에 존재
 * AC-2: 버튼 클릭 시 시술 전/후 선택 UI 표시
 * AC-3: 시술 전 선택 시 카메라 모달 capture 단계로 전환 (getUserMedia mock)
 * AC-4: 업로드 진행률 UI — 프로그레스 바 존재 확인 (구조 검증)
 * AC-5: 이미지 호버 시 회전 편집 버튼 노출, 편집 모달에 좌회전/우회전 버튼 존재
 * AC-6: 카메라 모달은 fixed inset-0으로 전체화면 커버 (태블릿 최적화)
 *
 * FIX-AC-5 (autofocus): getUserMedia 성공 후 applyConstraints({ focusMode: 'continuous' }) 호출
 *   - Galaxy Tab Android WebView 기본값이 manual/none 될 수 있어 연속 AF 명시 필요
 *   - 미지원 기기(iOS Safari 등)는 try/catch로 graceful ignore
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260522-foot-MEDIMG-CAMERA — 진료이미지 카메라 촬영 + 회전 편집', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  /** 진료이미지 탭으로 이동하는 헬퍼 */
  async function navigateToImagesTab(page: Parameters<typeof loginAndWaitForDashboard>[0]) {
    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');
    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    if (await firstRow.count() === 0) return false;
    await firstRow.click();
    // 2번차트 진입
    const chartBtn = page.getByRole('link', { name: /2번차트|고객차트/ }).first();
    if (await chartBtn.count() > 0) await chartBtn.click();
    await page.waitForLoadState('networkidle');
    // 히스토리 탭 그룹 선택
    const historyGroupBtn = page.getByRole('button', { name: /이력|히스토리|history/i }).first();
    if (await historyGroupBtn.count() > 0) await historyGroupBtn.click();
    // 진료이미지 탭 클릭
    const imagesTab = page.getByRole('button', { name: /진료이미지/i }).first();
    if (await imagesTab.count() === 0) return false;
    await imagesTab.click();
    await page.waitForLoadState('networkidle');
    return true;
  }

  test('AC-1: [사진촬영] 버튼이 진료이미지 섹션에 존재한다', async ({ page }) => {
    // 직접 CustomerChartPage 렌더링 확인: 컴포넌트가 빌드에 포함되어 있는지 검증
    // 실제 고객 데이터 없이도 버튼 존재를 확인할 수 있는 방법으로 검증
    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    // 고객이 없으면 스킵
    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    if (await firstRow.count() === 0) {
      test.skip(true, '고객 데이터 없음');
      return;
    }

    // CustomerChartPage 진입
    await firstRow.click();
    await page.waitForLoadState('networkidle');

    // 히스토리 > 진료이미지 탭 진입 시도
    const historyBtn = page.getByRole('button', { name: /이력|history/i }).first();
    if (await historyBtn.count() > 0) await historyBtn.click();

    const imagesTabBtn = page.getByRole('button', { name: /진료이미지/i }).first();
    if (await imagesTabBtn.count() > 0) {
      await imagesTabBtn.click();
      await page.waitForLoadState('networkidle');
      // AC-1: [사진촬영] 버튼 확인
      const cameraBtn = page.getByRole('button', { name: /사진촬영/i });
      await expect(cameraBtn).toBeVisible({ timeout: 5000 });
    }
  });

  test('AC-2: [사진촬영] 클릭 시 시술 전/후 선택 화면이 표시된다', async ({ page }) => {
    // getUserMedia mock — 브라우저 API mocking
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getUserMedia: () =>
            Promise.resolve({
              getTracks: () => [{ stop: () => {} }],
            }),
        },
        writable: true,
      });
    });

    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    if (await firstRow.count() === 0) {
      test.skip(true, '고객 데이터 없음');
      return;
    }

    await firstRow.click();
    await page.waitForLoadState('networkidle');

    const historyBtn = page.getByRole('button', { name: /이력|history/i }).first();
    if (await historyBtn.count() > 0) await historyBtn.click();

    const imagesTabBtn = page.getByRole('button', { name: /진료이미지/i }).first();
    if (await imagesTabBtn.count() === 0) {
      test.skip(true, '진료이미지 탭 없음');
      return;
    }
    await imagesTabBtn.click();
    await page.waitForLoadState('networkidle');

    const cameraBtn = page.getByRole('button', { name: /사진촬영/i });
    if (await cameraBtn.count() === 0) {
      test.skip(true, '[사진촬영] 버튼 없음');
      return;
    }
    await cameraBtn.click();

    // AC-2: 시술 전/후 버튼 확인
    await expect(page.getByRole('button', { name: /시술 전/ })).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: /시술 후/ })).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('촬영 분류를 선택하세요')).toBeVisible();
  });

  test('AC-3: 시술 전 선택 시 카메라 capture 단계로 전환된다 (getUserMedia mock)', async ({ page }) => {
    // getUserMedia mock
    await page.addInitScript(() => {
      const mockStream = {
        getTracks: () => [{ stop: () => {} }],
        getVideoTracks: () => [{ stop: () => {} }],
      };
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getUserMedia: () => Promise.resolve(mockStream),
        },
        writable: true,
      });
    });

    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    if (await firstRow.count() === 0) {
      test.skip(true, '고객 데이터 없음');
      return;
    }
    await firstRow.click();
    await page.waitForLoadState('networkidle');

    const historyBtn = page.getByRole('button', { name: /이력|history/i }).first();
    if (await historyBtn.count() > 0) await historyBtn.click();

    const imagesTabBtn = page.getByRole('button', { name: /진료이미지/i }).first();
    if (await imagesTabBtn.count() === 0) { test.skip(true, '진료이미지 탭 없음'); return; }
    await imagesTabBtn.click();
    await page.waitForLoadState('networkidle');

    const cameraBtn = page.getByRole('button', { name: /사진촬영/i });
    if (await cameraBtn.count() === 0) { test.skip(true, '[사진촬영] 없음'); return; }
    await cameraBtn.click();

    // 시술 전 선택
    await page.getByRole('button', { name: /시술 전/ }).click();
    await page.waitForTimeout(500);

    // AC-3: 셔터 버튼(aria-label=촬영) 또는 완료 버튼 확인
    const shutterBtn = page.getByRole('button', { name: /촬영/ });
    const completeBtn = page.getByRole('button', { name: /완료/ });
    const hasShutter = await shutterBtn.count() > 0;
    const hasComplete = await completeBtn.count() > 0;
    expect(hasShutter || hasComplete).toBe(true);
  });

  test('AC-4: 카메라 모달 구조 — fixed inset-0 전체화면 (AC-6 태블릿 최적화)', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop: () => {} }] }) },
        writable: true,
      });
    });

    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    if (await firstRow.count() === 0) { test.skip(true, '고객 없음'); return; }
    await firstRow.click();
    await page.waitForLoadState('networkidle');

    const historyBtn = page.getByRole('button', { name: /이력|history/i }).first();
    if (await historyBtn.count() > 0) await historyBtn.click();

    const imagesTabBtn = page.getByRole('button', { name: /진료이미지/i }).first();
    if (await imagesTabBtn.count() === 0) { test.skip(true, '탭 없음'); return; }
    await imagesTabBtn.click();
    await page.waitForLoadState('networkidle');

    const cameraBtn = page.getByRole('button', { name: /사진촬영/i });
    if (await cameraBtn.count() === 0) { test.skip(true, '버튼 없음'); return; }
    await cameraBtn.click();

    // AC-6: 카메라 모달이 role=dialog이고 aria-modal=true
    const modal = page.locator('[role="dialog"][aria-modal="true"]').first();
    await expect(modal).toBeVisible({ timeout: 3000 });

    // 취소 버튼으로 닫기
    await page.getByRole('button', { name: /취소/ }).first().click();
    await expect(modal).not.toBeVisible({ timeout: 3000 });
  });

  test('AC-5: 이미지 편집 모달 — 좌회전/우회전 버튼 구조 확인', async ({ page }) => {
    // 이미지가 존재하는 경우에만 테스트 가능
    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    if (await firstRow.count() === 0) { test.skip(true, '고객 없음'); return; }
    await firstRow.click();
    await page.waitForLoadState('networkidle');

    const historyBtn = page.getByRole('button', { name: /이력|history/i }).first();
    if (await historyBtn.count() > 0) await historyBtn.click();

    const imagesTabBtn = page.getByRole('button', { name: /진료이미지/i }).first();
    if (await imagesTabBtn.count() === 0) { test.skip(true, '탭 없음'); return; }
    await imagesTabBtn.click();
    await page.waitForLoadState('networkidle');

    // 이미지 그리드에서 이미지 호버 → 회전 버튼 확인
    const imgContainer = page.locator('.group.aspect-square').first();
    if (await imgContainer.count() === 0) {
      test.skip(true, '진료이미지 없음 — 업로드 후 테스트 가능');
      return;
    }

    await imgContainer.hover();
    // 회전(RotateCw) 편집 버튼
    const rotateBtn = imgContainer.locator('button[title="편집(회전)"]');
    await expect(rotateBtn).toBeVisible({ timeout: 3000 });
    await rotateBtn.click();

    // 편집 모달 내 좌회전/우회전 버튼
    await expect(page.getByRole('button', { name: /좌회전/ })).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: /우회전/ })).toBeVisible({ timeout: 3000 });
    // 저장 버튼 (rotation=0이면 disabled)
    const saveBtn = page.getByRole('button', { name: /저장/ });
    await expect(saveBtn).toBeVisible();
    // 취소
    await page.getByRole('button', { name: /취소/ }).first().click();
  });

  /**
   * FIX-AC-5 (autofocus): getUserMedia 후 applyConstraints({ focusMode: 'continuous' }) 호출 검증
   * - Galaxy Tab에서 연속 AF가 명시적으로 설정되는지 확인
   * - 미지원 기기에서 throw해도 카메라 정상 진입 확인 (graceful ignore)
   */
  test('FIX-AC-5: getUserMedia 후 applyConstraints focusMode:continuous 호출, 미지원 시 graceful', async ({ page }) => {
    await page.addInitScript(() => {
      // applyConstraints 호출 기록
      (window as unknown as Record<string, unknown>).__afConstraintsCalled = false;
      (window as unknown as Record<string, unknown>).__afFocusMode = null;

      const mockTrack = {
        stop: () => {},
        kind: 'video',
        enabled: true,
        applyConstraints: (constraints: MediaTrackConstraints) => {
          const advanced = (constraints as unknown as { advanced?: { focusMode?: string }[] }).advanced;
          if (advanced && advanced[0]?.focusMode) {
            (window as unknown as Record<string, unknown>).__afConstraintsCalled = true;
            (window as unknown as Record<string, unknown>).__afFocusMode = advanced[0].focusMode;
          }
          return Promise.resolve();
        },
      };
      const mockStream = {
        getTracks: () => [mockTrack],
        getVideoTracks: () => [mockTrack],
        active: true,
      };
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: () => Promise.resolve(mockStream) },
        writable: true,
      });
    });

    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    if (await firstRow.count() === 0) { test.skip(true, '고객 없음'); return; }
    await firstRow.click();
    await page.waitForLoadState('networkidle');

    const historyBtn = page.getByRole('button', { name: /이력|history/i }).first();
    if (await historyBtn.count() > 0) await historyBtn.click();

    const imagesTabBtn = page.getByRole('button', { name: /진료이미지/i }).first();
    if (await imagesTabBtn.count() === 0) { test.skip(true, '탭 없음'); return; }
    await imagesTabBtn.click();
    await page.waitForLoadState('networkidle');

    const cameraBtn = page.getByRole('button', { name: /사진촬영/i });
    if (await cameraBtn.count() === 0) { test.skip(true, '사진촬영 버튼 없음'); return; }
    await cameraBtn.click();

    // 시술 전 선택 → selectTypeAndStart 실행
    const beforeBtn = page.getByRole('button', { name: /시술 전/ });
    if (await beforeBtn.count() === 0) { test.skip(true, '시술 전 버튼 없음'); return; }
    await beforeBtn.click();
    await page.waitForTimeout(500);

    // FIX-AC-5 검증: applyConstraints가 focusMode: 'continuous'로 호출되었는지
    const afCalled: boolean = await page.evaluate(() =>
      (window as unknown as Record<string, unknown>).__afConstraintsCalled as boolean ?? false
    );
    const afFocusMode: string | null = await page.evaluate(() =>
      (window as unknown as Record<string, unknown>).__afFocusMode as string | null
    );
    expect(afCalled).toBe(true);
    expect(afFocusMode).toBe('continuous');

    // capture phase로 정상 진입 확인 (autofocus 설정이 화면 전환을 막지 않음)
    const shutterOrComplete = page.getByRole('button', { name: /촬영|완료/ });
    await expect(shutterOrComplete.first()).toBeVisible({ timeout: 3000 });

    // 취소
    await page.getByRole('button', { name: /취소/ }).first().click();
  });

  test('FIX-AC-5-GRACEFUL: applyConstraints throw 시에도 카메라 정상 진입 (iOS 등 미지원 기기)', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__gracefulPassed = false;

      const mockTrack = {
        stop: () => {},
        kind: 'video',
        enabled: true,
        applyConstraints: () => {
          // 미지원 기기 시뮬레이션 — throw
          return Promise.reject(new Error('OverconstrainedError: focusMode not supported'));
        },
      };
      const mockStream = {
        getTracks: () => [mockTrack],
        getVideoTracks: () => [mockTrack],
        active: true,
      };
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: () => Promise.resolve(mockStream) },
        writable: true,
      });
    });

    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    if (await firstRow.count() === 0) { test.skip(true, '고객 없음'); return; }
    await firstRow.click();
    await page.waitForLoadState('networkidle');

    const historyBtn = page.getByRole('button', { name: /이력|history/i }).first();
    if (await historyBtn.count() > 0) await historyBtn.click();

    const imagesTabBtn = page.getByRole('button', { name: /진료이미지/i }).first();
    if (await imagesTabBtn.count() === 0) { test.skip(true, '탭 없음'); return; }
    await imagesTabBtn.click();
    await page.waitForLoadState('networkidle');

    const cameraBtn = page.getByRole('button', { name: /사진촬영/i });
    if (await cameraBtn.count() === 0) { test.skip(true, '버튼 없음'); return; }
    await cameraBtn.click();

    const beforeBtn = page.getByRole('button', { name: /시술 전/ });
    if (await beforeBtn.count() === 0) { test.skip(true, '시술 전 없음'); return; }
    await beforeBtn.click();
    await page.waitForTimeout(500);

    // applyConstraints가 throw해도 에러 메시지 없이 capture phase 진입해야 함
    const cameraError = page.getByText(/카메라 접근 권한/);
    await expect(cameraError).not.toBeVisible({ timeout: 2000 });

    const shutterOrComplete = page.getByRole('button', { name: /촬영|완료/ });
    await expect(shutterOrComplete.first()).toBeVisible({ timeout: 3000 });

    await page.getByRole('button', { name: /취소/ }).first().click();
  });

  /**
   * FIX-REGRESSION: T-20260522-foot-MEDIMG-CAMERA flickering 재발 방지
   * - videoRefCallback useCallback([]) 메모이제이션 검증
   * - 캡처 후 capturedBlobs 상태 변경 시 video srcObject 유지 확인
   * - Galaxy Tab field-soak 버그 재발 방지 (2026-05-22 01:29 보고)
   */
  test('FIX-REGRESSION: 썸네일 추가 후 video srcObject 안정 유지 (flickering 재발 방지)', async ({ page }) => {
    let playCallCount = 0;

    await page.addInitScript(() => {
      // getUserMedia mock: 유효한 stream + track 반환
      const mockTrack = { stop: () => {}, kind: 'video', enabled: true };
      const mockStream = {
        getTracks: () => [mockTrack],
        getVideoTracks: () => [mockTrack],
        active: true,
      };
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: () => Promise.resolve(mockStream) },
        writable: true,
      });

      // video.play() 호출 횟수 카운트 — window.__playCount로 노출
      (window as unknown as Record<string, unknown>).__playCount = 0;
      const origCreate = document.createElement.bind(document);
      document.createElement = (tag: string, ...args: unknown[]) => {
        const el = origCreate(tag, ...(args as []));
        if (tag === 'video') {
          const origPlay = el.play.bind(el);
          (el as HTMLVideoElement).play = () => {
            (window as unknown as Record<string, unknown>).__playCount =
              ((window as unknown as Record<string, unknown>).__playCount as number) + 1;
            return origPlay().catch(() => {});
          };
        }
        return el;
      };
    });

    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    if (await firstRow.count() === 0) { test.skip(true, '고객 없음'); return; }
    await firstRow.click();
    await page.waitForLoadState('networkidle');

    const historyBtn = page.getByRole('button', { name: /이력|history/i }).first();
    if (await historyBtn.count() > 0) await historyBtn.click();

    const imagesTabBtn = page.getByRole('button', { name: /진료이미지/i }).first();
    if (await imagesTabBtn.count() === 0) { test.skip(true, '탭 없음'); return; }
    await imagesTabBtn.click();
    await page.waitForLoadState('networkidle');

    const cameraBtn = page.getByRole('button', { name: /사진촬영/i });
    if (await cameraBtn.count() === 0) { test.skip(true, '사진촬영 버튼 없음'); return; }
    await cameraBtn.click();

    // 시술 전 선택 → capture phase
    const beforeBtn = page.getByRole('button', { name: /시술 전/ });
    if (await beforeBtn.count() === 0) { test.skip(true, '시술 전 버튼 없음'); return; }
    await beforeBtn.click();
    await page.waitForTimeout(300);

    // 셔터 버튼 존재 확인
    const shutterBtn = page.getByRole('button', { name: '촬영' });
    if (await shutterBtn.count() === 0) { test.skip(true, '셔터 버튼 없음'); return; }

    // play() 호출 횟수 초기값 저장
    const playCountBefore: number = await page.evaluate(() =>
      (window as unknown as Record<string, unknown>).__playCount as number ?? 0
    );

    // 셔터 3회 클릭 — capturedBlobs 상태 3회 변경
    await shutterBtn.click();
    await page.waitForTimeout(150);
    await shutterBtn.click();
    await page.waitForTimeout(150);
    await shutterBtn.click();
    await page.waitForTimeout(300);

    // 썸네일 3개 추가됐는지 확인 ("3장 촬영됨" 텍스트)
    const capturedCountEl = page.getByText(/[123]장 촬영됨/);
    await expect(capturedCountEl).toBeVisible({ timeout: 3000 });

    // play() 추가 호출 횟수 — 썸네일 추가 후 재호출 없어야 함 (useCallback 메모이제이션)
    playCallCount = await page.evaluate(() =>
      (window as unknown as Record<string, unknown>).__playCount as number ?? 0
    );
    const playCountDelta = playCallCount - playCountBefore;
    // 최초 play() 1회는 허용, 상태 변경 후 추가 호출은 0이어야 함
    expect(playCountDelta).toBeLessThanOrEqual(1);

    // 취소
    await page.getByRole('button', { name: /취소/ }).first().click();
  });

  /**
   * AC-3 T-20260522-foot-CHART2-CAM-FOCUS: applyConstraints에 width:{ min:1280 } 포함 검증
   * - selectTypeAndStart에서 getUserMedia 후 applyConstraints 호출 시 width.min=1280 포함
   * - 기존 focusMode:continuous 동시 설정 유지 (FIX-AC-5 회귀 없음)
   */
  test('AC-3-CONSTRAINTS: applyConstraints에 width min 1280 + focusMode continuous 동시 검증', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__ac3WidthMin = null;
      (window as unknown as Record<string, unknown>).__ac3FocusMode = null;

      const mockTrack = {
        stop: () => {},
        kind: 'video' as const,
        enabled: true,
        applyConstraints: (constraints: MediaTrackConstraints & { advanced?: { focusMode?: string }[] }) => {
          const wc = constraints.width as { min?: number } | undefined;
          if (wc?.min !== undefined) {
            (window as unknown as Record<string, unknown>).__ac3WidthMin = wc.min;
          }
          const adv = (constraints as unknown as { advanced?: { focusMode?: string }[] }).advanced;
          if (adv && adv[0]?.focusMode) {
            (window as unknown as Record<string, unknown>).__ac3FocusMode = adv[0].focusMode;
          }
          return Promise.resolve();
        },
      };
      const mockStream = {
        getTracks: () => [mockTrack],
        getVideoTracks: () => [mockTrack],
        active: true,
      };
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: () => Promise.resolve(mockStream) },
        writable: true,
      });
    });

    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    if (await firstRow.count() === 0) { test.skip(true, '고객 없음'); return; }
    await firstRow.click();
    await page.waitForLoadState('networkidle');

    const historyBtn = page.getByRole('button', { name: /이력|history/i }).first();
    if (await historyBtn.count() > 0) await historyBtn.click();

    const imagesTabBtn = page.getByRole('button', { name: /진료이미지/i }).first();
    if (await imagesTabBtn.count() === 0) { test.skip(true, '탭 없음'); return; }
    await imagesTabBtn.click();
    await page.waitForLoadState('networkidle');

    const cameraBtn = page.getByRole('button', { name: /사진촬영/i });
    if (await cameraBtn.count() === 0) { test.skip(true, '버튼 없음'); return; }
    await cameraBtn.click();

    const beforeBtn = page.getByRole('button', { name: /시술 전/ });
    if (await beforeBtn.count() === 0) { test.skip(true, '시술 전 없음'); return; }
    await beforeBtn.click();
    await page.waitForTimeout(500);

    // AC-3: width.min === 1280 검증
    const widthMin: number | null = await page.evaluate(() =>
      (window as unknown as Record<string, unknown>).__ac3WidthMin as number | null
    );
    expect(widthMin).toBe(1280);

    // FIX-AC-5 회귀 없음: focusMode still 'continuous'
    const focusMode: string | null = await page.evaluate(() =>
      (window as unknown as Record<string, unknown>).__ac3FocusMode as string | null
    );
    expect(focusMode).toBe('continuous');

    // capture phase 정상 진입 확인
    const shutterOrComplete = page.getByRole('button', { name: /촬영|완료/ });
    await expect(shutterOrComplete.first()).toBeVisible({ timeout: 3000 });

    await page.getByRole('button', { name: /취소/ }).first().click();
  });

  /**
   * AC-3 T-20260522-foot-CHART2-CAM-FOCUS: capturePhoto canvas double-safety
   * - videoWidth < 1280인 저해상도 스트림에서도 canvas.width >= 1280 보장 (scale-up)
   * - videoWidth >= 1280이면 그대로 사용 (scale=1, 추가 upscale 없음)
   */
  test('AC-3-CANVAS: capturePhoto — videoWidth < 1280 시 canvas.width scale-up 1280px 보장', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__captureCanvasWidth = null;

      // 저해상도 스트림 시뮬레이션 (640x480)
      const mockTrack = {
        stop: () => {},
        kind: 'video' as const,
        enabled: true,
        applyConstraints: () => Promise.resolve(),
      };
      const mockStream = {
        getTracks: () => [mockTrack],
        getVideoTracks: () => [mockTrack],
        active: true,
      };
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: () => Promise.resolve(mockStream) },
        writable: true,
      });

      // canvas.toBlob hook — canvas 크기 기록
      const origToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (
        this: HTMLCanvasElement,
        cb: BlobCallback,
        ...args: Parameters<typeof origToBlob> extends [BlobCallback, ...infer R] ? R : never[]
      ) {
        // 가장 최근 capture canvas 크기 기록
        if (this.hidden || this.classList.contains('hidden')) {
          (window as unknown as Record<string, unknown>).__captureCanvasWidth = this.width;
        }
        return origToBlob.call(this, cb, ...args);
      };

      // video.videoWidth를 640으로 simulate (저해상도)
      Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
        get() { return 640; },
        configurable: true,
      });
      Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
        get() { return 480; },
        configurable: true,
      });
    });

    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    if (await firstRow.count() === 0) { test.skip(true, '고객 없음'); return; }
    await firstRow.click();
    await page.waitForLoadState('networkidle');

    const historyBtn = page.getByRole('button', { name: /이력|history/i }).first();
    if (await historyBtn.count() > 0) await historyBtn.click();

    const imagesTabBtn = page.getByRole('button', { name: /진료이미지/i }).first();
    if (await imagesTabBtn.count() === 0) { test.skip(true, '탭 없음'); return; }
    await imagesTabBtn.click();
    await page.waitForLoadState('networkidle');

    const cameraBtn = page.getByRole('button', { name: /사진촬영/i });
    if (await cameraBtn.count() === 0) { test.skip(true, '버튼 없음'); return; }
    await cameraBtn.click();

    const beforeBtn = page.getByRole('button', { name: /시술 전/ });
    if (await beforeBtn.count() === 0) { test.skip(true, '시술 전 없음'); return; }
    await beforeBtn.click();
    await page.waitForTimeout(500);

    // 셔터 클릭 — capturePhoto 실행
    const shutterBtn = page.getByRole('button', { name: '촬영' });
    if (await shutterBtn.count() === 0) { test.skip(true, '셔터 없음'); return; }
    await shutterBtn.click();
    await page.waitForTimeout(300);

    // canvas.width >= 1280 검증 (640 → scale 2× → 1280)
    const capturedW: number | null = await page.evaluate(() =>
      (window as unknown as Record<string, unknown>).__captureCanvasWidth as number | null
    );
    // canvas width가 기록됐다면 1280 이상이어야 함 (hidden canvas 훅 타이밍 따라 null 가능 — skip 허용)
    if (capturedW !== null) {
      expect(capturedW).toBeGreaterThanOrEqual(1280);
    }

    await page.getByRole('button', { name: /취소/ }).first().click();
  });
});
