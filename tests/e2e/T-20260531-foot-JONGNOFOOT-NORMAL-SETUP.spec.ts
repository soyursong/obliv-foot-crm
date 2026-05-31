/**
 * T-20260531-foot-JONGNOFOOT-NORMAL-SETUP
 * 종로 풋센터 풋 CRM 정상 등록 + 셀프접수 신설 (L2 — JONGNOFOOT-PURGE 후속)
 *
 * 배경: 5/26~5/31 종로 풋센터가 롱레(happy-flow-queue)에 오등록 → PURGE(soft-delete).
 *   obliv-foot-crm /checkin/jongno-foot 는 HFQ로 리다이렉트(JongnoFootCheckinRedirect)되어
 *   풋 도메인 셀프접수가 cross-domain으로 빠져나가던 구조 → 본 티켓에서 리다이렉트 제거.
 *   풋 도메인 자기 자리(obliv-foot-crm + 풋 DB rxlomoozakkjesdqjtvd)로 정상 복귀.
 *
 * AC 커버:
 *   AC-1 풋 DB clinics 에 종로 풋센터 정상 등록 — 신규/고유 clinic_id (롱레 PURGE id e49b687f-… 재사용 금지)
 *   AC-2 /checkin/jongno-foot 접근 시 obliv-foot-crm 네이티브 SelfCheckIn 정상 렌더 (리다이렉트 없음)
 *   AC-6 HFQ(happy-flow-queue) 코드/DB 참조 0 — 도메인 이탈 리다이렉트 제거 확인
 *
 * 비고: AC-3(체크인→풋 DB 기록)·AC-4(대시보드 반영)·AC-5(CF Pages 라이브)는
 *   기존 셀프체크인 flow(REVAMP/CHECKIN-DASHBOARD-SYNC) spec 으로 회귀 커버되며,
 *   여기서는 본 티켓의 핵심 변경(HFQ 리다이렉트 제거 + 풋 DB clinic 정합)을 검증한다.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!;
// 풋 운영 DB 종로 풋센터 clinic_id (롱레 PURGE id e49b687f-… 와 다른 풋 도메인 자기 id)
const FOOT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const PURGED_HFQ_CLINIC_ID = 'e49b687f';

// ── AC-2/AC-6: 셀프접수 네이티브 렌더 (HFQ 리다이렉트 없음) ──────────────────
test.describe('T-20260531 셀프접수 풋 도메인 네이티브 렌더', () => {
  test('AC-2/AC-6: /checkin/jongno-foot 접근 → obliv-foot-crm 네이티브 화면 렌더 (HFQ 이탈 없음)', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    // 핵심: happy-flow-queue.pages.dev 로 빠져나가지 않아야 함 (AC-6)
    expect(page.url()).not.toContain('happy-flow-queue');

    // 네이티브 SelfCheckIn 렌더 — 성함/연락처 입력 필드 존재 (AC-2)
    await expect(page.locator('#sc-name')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#sc-phone')).toBeVisible({ timeout: 8000 });
  });

  test('AC-1: anon 클라이언트로 slug 조회 → 풋 도메인 자기 clinic_id 정합 (PURGE id 재사용 아님)', async () => {
    const sb = createClient(SUPA_URL, ANON_KEY, { auth: { persistSession: false } });
    const { data, error } = await sb
      .from('clinics')
      .select('id, name')
      .eq('slug', 'jongno-foot')
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    // 풋 도메인 자기 clinic_id
    expect((data as { id: string }).id).toBe(FOOT_CLINIC_ID);
    // 롱레 PURGE clinic_id 재사용 금지 확인
    expect((data as { id: string }).id).not.toContain(PURGED_HFQ_CLINIC_ID);
    // 종로 풋센터 표기
    expect((data as { name: string }).name).toMatch(/오블리브|종로|오리진/);
  });
});

// ── AC-6 정적 검증: 소스에 HFQ 리다이렉트 잔존 없음 ──────────────────────────
test.describe('T-20260531 HFQ 리다이렉트 제거 정적 검증', () => {
  test('AC-6: App.tsx 라우팅에 happy-flow-queue 외부 리다이렉트가 없다', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const appPath = path.resolve(__dirname, '../../src/App.tsx');
    const src = fs.readFileSync(appPath, 'utf-8');

    // window.location.replace 로의 HFQ 이탈 코드가 제거됐는지 확인
    expect(src).not.toContain('happy-flow-queue.pages.dev/jongno-foot');
    expect(src).not.toContain('JongnoFootCheckinRedirect');
    // /checkin/:clinicSlug 일반 라우트는 유지
    expect(src).toContain('/checkin/:clinicSlug');
  });
});
