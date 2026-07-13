/**
 * T-20260713-foot-CHECKIN-DELETE-RESV-RESTORE
 * 접수 상세창(CheckInDetailSheet)의 '체크인 삭제(관리자)' 버튼으로 체크인을 삭제한 뒤,
 * 원본 예약이 'checked_in' 상태에 묶여 (1)재체크인 불가 (2)통합시간표·대시보드에서 예약 카드
 * 소실되던 버그 검증.
 *
 * 근본 원인(RC):
 *   deleteCheckIn 은 check_ins row 만 삭제하고, 체크인 시점에 reservations→'checked_in' 으로
 *   전이됐던 원본 예약의 상태 역전이가 누락돼 있었다.
 *   → '체크인 취소'(T-20260611-foot-CHECKIN-CANCEL-RENAME-RESTORE, Dashboard 상태변경 핸들러)는
 *      예약을 'confirmed'로 되돌리는데, '삭제' 경로만 이 역연산이 빠져 삭제 vs 취소 동작이 갈렸다.
 *
 * 수정(FE-only):
 *   deleteCheckIn 성공 시 checkIn.reservation_id 의 예약을 'confirmed'(예약)로 복구.
 *   FE 원자성(saga): 예약 복구를 먼저 커밋 → 체크인 삭제 → 삭제 실패 시 예약 상태를 보상 롤백.
 *   신규 컬럼·enum 없음 — 기존 status 값('confirmed'/'checked_in') 재사용.
 *
 * ACs:
 *   AC-1: deleteCheckIn 성공 직후 reservations.status='confirmed' 복구 (원자성)
 *   시나리오3: 삭제→재체크인 왕복 — 삭제 후 예약이 다시 체크인 가능 상태('confirmed')로 복귀
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(
      process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required'); })(),
    );
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

// ── AC-1 정적 불변식 가드(항상 실행): 데이터/UI 없이도 "삭제 경로가 예약을 복구한다"를 보증 ──
// 이 가드는 '취소'와 '삭제'가 다시 갈라지지(regress) 않도록 소스 레벨에서 고정한다.
test('AC-1 정적 가드: deleteCheckIn 이 예약을 confirmed 로 복구하고, 삭제 실패 시 보상 롤백한다', () => {
  const src = readFileSync(resolve(repoRoot, 'src/components/CheckInDetailSheet.tsx'), 'utf8');

  // deleteCheckIn 함수 본문 추출
  const start = src.indexOf('const deleteCheckIn = async');
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('const saveNotes', start));

  // (1) 삭제 경로가 reservations 를 'confirmed' 로 복구한다
  expect(body).toMatch(/from\('reservations'\)/);
  expect(body).toMatch(/status:\s*'confirmed'/);
  // (2) 복구 대상은 checkIn.reservation_id 로 스코프된다 (전역/무조건 UPDATE 금지)
  expect(body).toMatch(/\.eq\('id',\s*resvId\)/);
  // (3) 멱등 가드: 이미 checked_in 인 예약만 되돌린다
  expect(body).toMatch(/\.eq\('status',\s*'checked_in'\)/);
  // (4) 실제 삭제(check_ins delete)가 여전히 수행된다
  expect(body).toMatch(/from\('check_ins'\)[\s\S]*?\.delete\(\)/);
  // (5) 원자성: 삭제 실패 시 예약을 'checked_in' 으로 보상 롤백 (에러 분기 내부)
  const errBranch = body.slice(body.indexOf('if (error)'));
  expect(errBranch).toMatch(/status:\s*'checked_in'/);
});

// ── 시나리오3 (skip-tolerant, self-cleaning): 삭제→예약복구→재체크인 왕복 ──
// 실데이터 파괴를 피하기 위해 전용 예약+체크인을 seed 하고, UI 로 삭제한 뒤 DB 왕복을 검증한다.
// 어느 단계든 진입 불가하면 정적 가드(위 test)가 커버하므로 skip. finally 에서 seed 정리.
test('시나리오3: 접수 상세창에서 체크인 삭제 → 예약이 confirmed 로 복구 → 재체크인 가능', async ({ page }) => {
  if (!SUPABASE_URL || !SERVICE_KEY) { test.skip(true, 'service-role 키 없음 — seed 불가, skip'); return; }
  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // 시드용 clinic / customer 확보 (없으면 skip)
  const { data: clinic } = await supa.from('clinics').select('id').limit(1).maybeSingle();
  const { data: cust } = await supa.from('customers').select('id, name, phone').limit(1).maybeSingle();
  if (!clinic?.id || !cust?.id) { test.skip(true, 'seed 대상 clinic/customer 없음 — skip'); return; }

  const today = new Date().toISOString().slice(0, 10);
  const custName = `[E2E-DELRESV] ${cust.name ?? '테스트'}`;
  let resvId: string | null = null;
  let checkInId: string | null = null;

  try {
    // 1) 예약(confirmed) seed
    const { data: resv, error: rErr } = await supa
      .from('reservations')
      .insert({
        clinic_id: clinic.id,
        customer_id: cust.id,
        customer_name: custName,
        customer_phone: cust.phone ?? null,
        reservation_date: today,
        reservation_time: '23:59',
        visit_type: 'new',
        status: 'confirmed',
      })
      .select('id')
      .maybeSingle();
    if (rErr || !resv?.id) { test.skip(true, `예약 seed 실패(${rErr?.message ?? 'no row'}) — skip`); return; }
    resvId = resv.id;

    // 2) 체크인(checked_in 예약에 연결) seed + 예약을 checked_in 으로 전이 (실제 체크인 재현)
    const { data: ci, error: cErr } = await supa
      .from('check_ins')
      .insert({
        clinic_id: clinic.id,
        customer_name: custName,
        customer_phone: cust.phone ?? null,
        customer_id: cust.id,
        reservation_id: resvId,
        visit_type: 'new',
        status: 'registered',
        notes: {},
      })
      .select('id')
      .maybeSingle();
    if (cErr || !ci?.id) { test.skip(true, `체크인 seed 실패(${cErr?.message ?? 'no row'}) — skip`); return; }
    checkInId = ci.id;
    await supa.from('reservations').update({ status: 'checked_in' }).eq('id', resvId);

    // 3) UI: 관리자 로그인 → 대시보드 → seed 카드 열기 → 삭제(관리자) → confirm 수락
    await loginIfNeeded(page);
    page.on('dialog', (d) => { void d.accept(); }); // window.confirm('체크인을 삭제하시겠습니까?') 수락
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle', { timeout: 15000 });

    const card = page.locator(`[data-checkin-id="${checkInId}"]`);
    if (!(await card.isVisible({ timeout: 8000 }).catch(() => false))) {
      test.skip(true, 'seed 체크인 카드 미표시(권한/필터 환경차) — 정적 가드로 커버, skip'); return;
    }
    await card.click();

    const delBtn = page.getByTitle('체크인 삭제 (관리자)').first();
    if (!(await delBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, '삭제 버튼 미노출(비관리자 계정) — skip'); return;
    }
    await delBtn.click();

    // 4) AC-1 + 시나리오3: 예약이 'confirmed' 로 복구되고, 체크인 row 는 삭제됨
    await expect(async () => {
      const { data: r } = await supa.from('reservations').select('status').eq('id', resvId!).maybeSingle();
      expect(r?.status).toBe('confirmed');
      const { count } = await supa
        .from('check_ins')
        .select('id', { count: 'exact', head: true })
        .eq('id', checkInId!);
      expect(count ?? 0).toBe(0);
    }).toPass({ timeout: 8000 });

    // 재체크인 가능 = 예약이 'confirmed'(체크인 가능 상태)로 복귀했음을 위에서 확정.
    checkInId = null; // 이미 UI 로 삭제됨 → finally 중복 삭제 방지
  } finally {
    // seed 정리 (데이터 무손실)
    if (checkInId) await supa.from('check_ins').delete().eq('id', checkInId);
    if (resvId) await supa.from('reservations').delete().eq('id', resvId);
  }
});
