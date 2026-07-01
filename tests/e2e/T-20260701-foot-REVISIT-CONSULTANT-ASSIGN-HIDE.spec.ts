/**
 * E2E — T-20260701-foot-REVISIT-CONSULTANT-ASSIGN-HIDE
 * 재진(returning) 고객 접수·배정 화면에서 상담 실장 배정 칸 숨김 → 치료사 배정만.
 * 초진(신규)은 상담+치료 양쪽 유지(회귀0).
 *
 * 배경(김주연 총괄, #풋 C0ATE5P6JTH, 2026-07-01):
 *   "재진 고객 접수 시 상담 실장 배정 칸 숨김/비활성 / 치료사 배정만 / 초진은 상담+치료 양쪽 유지."
 *
 * 설계(무스키마 UI/로직):
 *   - 재진/초진 판정 SSOT = deriveConsultAxis(visit_type==='returning') → isReturningAxis.
 *     이미 배포된 T-20260630-foot-REVISIT-CHECKIN-AUTOASSIGN-SKIP·autoAssign 과 동일 소스로 통일(AC-4).
 *   - AC-1: /admin/assignments [상담] 탭 '오늘 배정 현황' 행에서 재진 고객은 상담 실장 select 미노출
 *     (대신 '재진 — 상담 배정 없음' 마커). 초진은 select 정상 노출(AC-2).
 *   - AC-3: 재진 상담 자동배정 skip — (a) NewCheckInDialog: 재진 consultantId=null(오토필 폐지),
 *     (b) maybeAutoAssign: role==='consult' && returning → skip. 숨긴 슬롯에 백그라운드 배정 0.
 *
 * 검증:
 *   S1 (AC-1/AC-3): 재진 consult_waiting 시드 → 상담 select 숨김 + hidden 마커 노출.
 *   S2 (AC-2): 초진 consult_waiting 시드 → 상담 select 정상 노출(회귀0).
 *   [정적] AC-3/AC-4: maybeAutoAssign consult+returning skip 게이트 + NewCheckInDialog 재진 오토필 폐지 +
 *          판정 SSOT 통일(deriveConsultAxis/isReturningAxis) 소스 단언.
 *
 * 비파괴: 시드(customers + check_ins)는 종료 후 전량 회수.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginAndWaitForDashboard } from '../helpers';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MARKER = 'RC-REVHIDE-SEED';

interface Seed {
  checkInId: string;
  customerId: string;
}

async function seedConsultWaiting(
  clinicId: string,
  visitType: 'new' | 'returning',
): Promise<Seed> {
  const ts = Date.now() + Math.floor(performance.now());
  const name = `${MARKER}-${visitType}-${ts}`;
  const phone = `010${String(ts).slice(-8)}`;

  const { data: cust, error: ce } = await service
    .from('customers')
    .insert({ clinic_id: clinicId, name, phone, visit_type: visitType })
    .select('id')
    .single();
  expect(ce).toBeNull();

  const { data: ci, error: ie } = await service
    .from('check_ins')
    .insert({
      clinic_id: clinicId,
      customer_id: cust!.id,
      customer_name: name,
      customer_phone: phone,
      visit_type: visitType,
      status: 'consult_waiting', // 상담 flow → [상담] 탭 '오늘 배정 현황' 에 렌더
      checked_in_at: new Date().toISOString(),
      queue_number: 910000 + (ts % 80000),
    })
    .select('id')
    .single();
  expect(ie).toBeNull();

  return { checkInId: ci!.id, customerId: cust!.id };
}

async function gotoAssignments(page: Page): Promise<void> {
  const ok = await loginAndWaitForDashboard(page);
  expect(ok).toBeTruthy();
  await page.goto('/admin/assignments');
  await expect(page.getByTestId('assignments-role-tabs')).toBeVisible({ timeout: 20_000 });
  // 기본 active 탭 = 상담(consult). 시드 행이 로드될 때까지 대기.
  await page.waitForTimeout(1_000);
}

test.describe('T-20260701-foot-REVISIT-CONSULTANT-ASSIGN-HIDE — 재진 상담 배정 칸 숨김', () => {
  let clinicId: string;
  const seeds: Seed[] = [];

  test.beforeAll(async () => {
    const { data: clinic } = await service
      .from('clinics').select('id').eq('slug', 'jongno-foot').single();
    expect(clinic?.id).toBeTruthy();
    clinicId = clinic!.id;
  });

  test.afterAll(async () => {
    for (const s of seeds) {
      await service.from('check_ins').delete().eq('id', s.checkInId);
      await service.from('customers').delete().eq('id', s.customerId);
    }
  });

  // ── S1 (AC-1/AC-3): 재진 → 상담 실장 배정 칸 숨김 ──────────────────────────────
  test('S1: 재진 고객은 [상담] 탭 오늘 배정 현황에서 상담 실장 select 가 숨겨지고 "재진 — 상담 배정 없음" 마커가 뜬다', async ({ page }) => {
    const seed = await seedConsultWaiting(clinicId, 'returning');
    seeds.push(seed);

    await gotoAssignments(page);

    // 재진 행: 상담 실장 배정 select 미존재 + hidden 마커 노출.
    await expect(page.getByTestId(`assign-consult-hidden-${seed.checkInId}`)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId(`assign-consult-hidden-${seed.checkInId}`)).toContainText('상담 배정 없음');
    await expect(page.getByTestId(`assign-consult-select-${seed.checkInId}`)).toHaveCount(0);
  });

  // ── S2 (AC-2): 초진 → 상담 실장 배정 select 정상 노출(회귀0) ─────────────────────
  test('S2: 초진(신규) 고객은 [상담] 탭에서 상담 실장 배정 select 가 정상 노출된다(회귀0)', async ({ page }) => {
    const seed = await seedConsultWaiting(clinicId, 'new');
    seeds.push(seed);

    await gotoAssignments(page);

    await expect(page.getByTestId(`assign-consult-select-${seed.checkInId}`)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId(`assign-consult-hidden-${seed.checkInId}`)).toHaveCount(0);
  });

  // ── 정적: AC-3 자동배정 skip 게이트 ──────────────────────────────────────────
  test('AC-3: maybeAutoAssign 이 consult + returning 이면 배정을 skip 한다(백그라운드 배정 방지)', () => {
    const src = read('src/lib/autoAssign.ts');
    expect(src).toMatch(/role === 'consult' && isReturningAxis\(axis\)\)\s*return \{ assigned: false \}/);
  });

  test('AC-3: NewCheckInDialog 재진 오토필(assigned_staff_id → consultant_id) 폐지 — 재진 consultantId=null 유지', () => {
    const src = read('src/components/NewCheckInDialog.tsx');
    // 재진 분기에서 assigned_staff_id 를 consultant_id 로 세팅하던 오토필 제거.
    expect(src).not.toMatch(/consultantId = \(cust\?\.assigned_staff_id/);
    // 상담 배정은 초진(new)만 autoAssignConsultant 로 세팅.
    expect(src).toMatch(/if \(visitType === 'new'\) \{\s*consultantId = await autoAssignConsultant/);
  });

  // ── 정적: AC-4 판정 SSOT 통일 ─────────────────────────────────────────────────
  test('AC-4: 재진 판정 SSOT = deriveConsultAxis/isReturningAxis (REVISIT-CHECKIN-AUTOASSIGN-SKIP 동일 소스)', () => {
    const page = read('src/pages/Assignments.tsx');
    // UI 숨김 조건이 isReturningAxis(axis) 사용 — autoAssign 과 동일 판정 함수.
    expect(page).toMatch(/role === 'consult' && isReturningAxis\(axis\)/);
    expect(page).toMatch(/import \{[\s\S]*?isReturningAxis[\s\S]*?\} from '@\/lib\/autoAssign'/);
    // autoAssign SSOT: visit_type==='returning' → 'returning' 축.
    const lib = read('src/lib/autoAssign.ts');
    expect(lib).toMatch(/c\.visit_type === 'returning'\) return 'returning'/);
    expect(lib).toMatch(/export function isReturningAxis/);
  });
});
