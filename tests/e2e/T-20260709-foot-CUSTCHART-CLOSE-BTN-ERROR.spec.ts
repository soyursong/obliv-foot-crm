/**
 * T-20260709-foot-CUSTCHART-CLOSE-BTN-ERROR (HOTFIX P1)
 * 고객차트 '닫기' 클릭 시 "페이지를 불러오는 중 오류가 발생했습니다." + 검은화면 재발 방지.
 *
 * RC (런타임 규명, 이 spec 의 존재 이유):
 *   DocumentPrintPanel.tsx L500 `const effectiveDoctorName = selectedDoctorName.trim()`.
 *   진료 원장 드롭다운 옵션(doctorOptions)이 staff/duty_roster 의 name=NULL 원장 행을 포함하면
 *   selectedDoctorName 이 doctorOptions[0].name=null 로 세팅됨 → `null.trim()` TypeError →
 *   DocumentPrintPanel 렌더 crash → 고객차트(CustomerChartSheet, in-page 서랍) 닫힘 시 하위
 *   Outlet(당일현황/예약목록)이 re-render 되며 AdminLayout ChunkErrorBoundary 로 트립.
 *   도입: T-20260708-foot-DOCPRINT-DOCTOR-SELECT-DROPDOWN(70d5f332, '진료 원장' 상시 드롭다운).
 *
 * FIX:
 *   (1) doctorOptions 를 name (?? '').trim() 강제 + 빈이름 필터 — 이름 없는 원장은 서명 주체 불가.
 *   (2) L500 (selectedDoctorName ?? '').trim() belt&suspenders.
 *   (3) 복수원장 기본선택 setSelectedDoctorName(dutyDoctors[0].name ?? '').
 *
 * 검증:
 *   G1(behavioral) — 칸반 카드 → 차트 오픈 → 닫기 → 에러바운더리 미노출 + pageerror 0 (라이브 스모크).
 *   G2(static lock) — naked `selectedDoctorName.trim()` 재도입 차단 + 방어 코드 존재.
 *
 * 시드: service_role + [QA-FIXTURE] 마커, try/finally 자기 row 정리. db_change=false.
 */
import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard, dismissCustomerChartSheet } from '../helpers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PANEL = path.resolve(__dirname, '../../src/components/DocumentPrintPanel.tsx');

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = '[QA-FIXTURE]';
let _sb: SupabaseClient | null = null;
const svc = () => (_sb ??= createClient(SUPA_URL, SERVICE_KEY));

async function seedActiveCheckIn(name: string) {
  const ts = Date.now();
  const phone = `010${String(ts).slice(-8)}`;
  const { data: cust, error: ce } = await svc()
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: 'new', memo: MARKER })
    .select('id').single();
  if (ce || !cust) throw new Error(`seed customer: ${ce?.message}`);
  const { data: ci, error: ie } = await svc()
    .from('check_ins')
    .insert({
      clinic_id: CLINIC_ID, customer_id: cust.id, customer_name: name,
      customer_phone: phone, visit_type: 'new', status: 'exam_waiting',
      queue_number: 940 + (ts % 20), checked_in_at: new Date().toISOString(), notes: MARKER,
    })
    .select('id').single();
  if (ie || !ci) { await svc().from('customers').delete().eq('id', cust.id); throw new Error(`seed checkin: ${ie?.message}`); }
  return { checkInId: ci.id as string, customerId: cust.id as string };
}
async function cleanup(customerId: string) {
  await svc().from('check_ins').delete().eq('customer_id', customerId);
  await svc().from('customers').delete().eq('id', customerId);
}

test.describe('CUSTCHART-CLOSE-BTN-ERROR · G1 behavioral 차트 닫기 → 에러바운더리 미노출', () => {
  test('G1: 칸반 카드 → 차트 오픈 → 닫기 → ChunkErrorBoundary 미노출 + pageerror 0', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`));

    const name = `close-err-${Date.now()}`;
    const { checkInId, customerId } = await seedActiveCheckIn(name);
    try {
      const ok = await loginAndWaitForDashboard(page);
      expect(ok, '대시보드 진입 실패').toBe(true);
      await expect(page.getByTestId('dashboard-root')).toBeVisible({ timeout: 15000 });

      const card = page.locator(`[data-testid="checkin-card"][data-checkin-id="${checkInId}"]`);
      await card.waitFor({ state: 'visible', timeout: 12000 });
      await card.click();

      const sheet = page.locator('[data-testid="customer-chart-sheet"]');
      await sheet.waitFor({ state: 'visible', timeout: 12000 });

      await dismissCustomerChartSheet(page);
      await page.waitForTimeout(1200);

      const boundaryVisible = await page
        .getByText('페이지를 불러오는 중 오류가 발생했습니다.')
        .isVisible().catch(() => false);

      const trimCrash = pageErrors.filter((e) => /trim/.test(e) || /Cannot read properties of null/.test(e));
      expect(trimCrash, `null.trim crash 재발: ${trimCrash.join('; ')}`).toHaveLength(0);
      expect(boundaryVisible, `닫기 후 에러바운더리 노출(회귀). pageerror: ${pageErrors.join('; ')}`).toBe(false);
    } finally {
      await cleanup(customerId);
    }
  });
});

test.describe('CUSTCHART-CLOSE-BTN-ERROR · G2 정적 회귀 라인 락', () => {
  function readPanel(): string { return fs.readFileSync(PANEL, 'utf-8'); }

  test('G2-1: naked selectedDoctorName.trim() 부재 + 방어(?? \'\') 존재', () => {
    const src = readPanel();
    // 회귀 라인(무방어 .trim) 재도입 차단
    expect(src).not.toMatch(/=\s*selectedDoctorName\.trim\(\)/);
    // belt&suspenders 방어 존재
    expect(src).toContain("(selectedDoctorName ?? '').trim()");
  });

  test('G2-2: doctorOptions name 강제/빈이름 필터(null 유입 원천 차단)', () => {
    const src = readPanel();
    expect(src).toMatch(/\(d\.name \?\? ''\)\.trim\(\)/);
    expect(src).toMatch(/\.filter\(\(o\) => o\.name\.length > 0\)/);
  });
});
