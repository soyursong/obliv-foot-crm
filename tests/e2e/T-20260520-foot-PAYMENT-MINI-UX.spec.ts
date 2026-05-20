/**
 * E2E spec — T-20260520-foot-PAYMENT-MINI-UX
 * 결제미니창 UX 개선 4건 검증
 *
 * AC-1: 상병코드/처방약 탭 소형 그리드 전환 (grid-cols-2/3)
 * AC-2: Zone2 폭 확장 (sm:w-52→w-60, lg:w-60→w-72) + 코드열 축소 (w-14→w-9)
 * AC-3: 저장 후 금일 시술내역(Zone3) 즉시 리프레시 + 현재 체크인 ID 강제 포함
 * AC-4: 수납대기 이동 시 PaymentDialog → PaymentMiniWindow 직결 (2개 진입점)
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

test.describe('T-20260520-PAYMENT-MINI-UX — 결제미니창 UX 개선 4건', () => {

  test('AC-1: 상병코드/처방약 탭 소형 그리드 — DOM에 grid-cols-2 클래스 존재', async ({ page }) => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    // PaymentMiniWindow 컴포넌트에 grid-cols-2 클래스가 렌더링되는지 소스 레벨 확인
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      'src/components/PaymentMiniWindow.tsx',
      'utf-8'
    );
    expect(src).toContain('grid-cols-2');
    expect(src).toContain('lg:grid-cols-3');
  });

  test('AC-2: Zone2 폭 확장 — sm:w-60 및 코드열 w-9 포함', async ({ page }) => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      'src/components/PaymentMiniWindow.tsx',
      'utf-8'
    );
    expect(src).toContain('sm:w-60');
    expect(src).toContain('lg:w-72');
    // 코드열 축소: w-14 → w-9
    expect(src).toContain('w-9');
    expect(src).not.toContain('w-14 shrink-0 text-[9px]');
  });

  test('AC-3: 저장 후 Zone3 리프레시 — loadZone3Data 호출 코드 존재', async ({ page }) => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      'src/components/PaymentMiniWindow.tsx',
      'utf-8'
    );
    // handleSaveFull / handleSaveDeduct 후 loadZone3Data 호출
    const saveFullIdx = src.indexOf('handleSaveFull');
    const saveDeductIdx = src.indexOf('handleSaveDeduct');
    expect(saveFullIdx).toBeGreaterThan(-1);
    expect(saveDeductIdx).toBeGreaterThan(-1);
    // 전체 소스에 최소 2회 loadZone3Data 콜 존재 (저장 성공 핸들러 각각)
    const callCount = (src.match(/loadZone3Data\(/g) ?? []).length;
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  test('AC-4: 수납대기 직결 — Dashboard에서 setMiniPayTarget 사용 (2곳)', async ({ page }) => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      'src/pages/Dashboard.tsx',
      'utf-8'
    );
    // handleContextStatusChange + handleContextLaserStatusChange 모두 setMiniPayTarget 사용
    const occurrences = (src.match(/setMiniPayTarget\(/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(3); // 오픈 + 2개 status 전환 진입점
  });

  test('AC-4 regression: PaymentDialog(setPaymentTarget) 직접 오픈 코드 — 수납대기 분기에 없음', async ({ page }) => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      'src/pages/Dashboard.tsx',
      'utf-8'
    );
    // payment_waiting status 변경 맥락에서 setPaymentTarget( 은 제거됨
    // 단순 존재 여부보다 handleContextStatusChange 함수 내부에서만 체크
    const ctxBlock = src.slice(
      src.indexOf('handleContextStatusChange'),
      src.indexOf('handleContextStatusChange') + 600
    );
    expect(ctxBlock).not.toContain("setPaymentTarget({ ...row");
  });

});
