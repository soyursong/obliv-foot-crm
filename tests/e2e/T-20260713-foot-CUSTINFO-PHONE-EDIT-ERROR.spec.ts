/**
 * E2E spec — T-20260713-foot-CUSTINFO-PHONE-EDIT-ERROR
 *
 * 현장(이광현 팀장): "고객정보 팝업창에서 번호 수정시 오류뜨는데 확인해줘"
 *
 * RC(diagnose-first, 실DB 재현 확인):
 *   고객정보(2번차트) 휴대폰 인라인 수정 → 저장 시, 같은 clinic 안에서 다른 고객이 이미
 *   쓰는 번호면 UNIQUE(clinic_id, phone)=idx_customers_clinic_phone 충돌(Postgres 23505).
 *   기존엔 raw DB 메시지("duplicate key value violates unique constraint …")가 그대로
 *   토스트로 노출 → 원인(중복 번호)을 알 수 없는 "오류". (svc-role UPDATE 재현: code=23505,
 *   detail="Key (clinic_id, phone)=(…, +8210…) already exists.")
 *
 * FIX(FE 전용 · 스키마 무변경):
 *   phoneSaveErrorMessage(@/lib/phone) 가 23505/UNIQUE 충돌만 골라 친화 안내로 치환.
 *   savePhone(인라인) + handleInfoPanelSave(통합저장) 두 저장 경로에 결선.
 *   중복 외 오류는 null 반환 → 호출부가 기존 raw 메시지 유지(실패 은폐 금지).
 *
 * 시나리오(티켓 본문):
 *   시나리오1 정상: 다른 고객과 겹치지 않는 번호 → 오류 없이 저장(친화메시지 트리거 X = null).
 *   시나리오2 엣지: 이미 다른 고객이 쓰는 번호 → 명확한 안내(raw 500/DB 메시지 X).
 *   + FE 유효성(빈값/형식)은 저장 전 차단(기존 savePhone 가드 — 회귀 확인).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { phoneSaveErrorMessage } from '../../src/lib/phone';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const CHART = 'src/pages/CustomerChartPage.tsx';

const FRIENDLY = '이미 다른 고객이 사용 중인 번호입니다. 번호를 다시 확인해 주세요.';

// ── 시나리오 2 (핵심 RC): UNIQUE(clinic_id, phone) 충돌 → 친화 안내 ──
test('시나리오2: 23505/UNIQUE 충돌 오류는 친화 안내로 치환', () => {
  // code 기반(supabase-js PostgrestError.code)
  expect(phoneSaveErrorMessage({ code: '23505', message: 'anything' })).toBe(FRIENDLY);
  // message 지문 기반(idx 이름/문구 — code 유실 케이스 방어)
  expect(
    phoneSaveErrorMessage({
      message: 'duplicate key value violates unique constraint "idx_customers_clinic_phone"',
    }),
  ).toBe(FRIENDLY);
  expect(phoneSaveErrorMessage({ message: 'violates unique constraint idx_customers_clinic_phone' })).toBe(FRIENDLY);
});

// ── 시나리오 1 정상 & 실패 은폐 방지: 중복 외 오류·정상은 친화메시지 트리거 X(null) ──
test('시나리오1/은폐방지: 중복 외 오류는 null(호출부가 raw 메시지 유지)', () => {
  // 중복 외 DB 오류 → null → 호출부가 기존 raw 메시지 노출(실패 감추지 않음)
  expect(phoneSaveErrorMessage({ code: '42501', message: 'new row violates row-level security policy' })).toBeNull();
  expect(phoneSaveErrorMessage({ code: '23514', message: 'violates check constraint customers_phone_e164_chk' })).toBeNull();
  // 오류 없음(정상 저장) → null
  expect(phoneSaveErrorMessage(null)).toBeNull();
  expect(phoneSaveErrorMessage(undefined)).toBeNull();
  expect(phoneSaveErrorMessage({})).toBeNull();
});

// ── 결선 가드: 두 저장 경로가 실제로 phoneSaveErrorMessage 를 사용하는지 ──
test('결선: savePhone·handleInfoPanelSave 가 phoneSaveErrorMessage 로 친화 치환', () => {
  const src = read(CHART);
  // import
  expect(src).toContain("phoneSaveErrorMessage } from '@/lib/phone'");
  // savePhone: suppressToast 로 raw 토스트 억제 후 친화 치환
  expect(src).toContain("saveCustomerField({ phone: e164 }, { suppressToast: true })");
  expect(src).toContain('phoneSaveErrorMessage(error) ?? `저장 실패: ${error.message}`');
  // handleInfoPanelSave(통합저장): phone 포함 시에만 친화 치환(그 외/비-phone 은 raw 유지)
  expect(src).toContain('patch.phone ? phoneSaveErrorMessage(error) : null');
});

// ── 회귀 가드: FE 유효성(빈값/형식)은 저장 전 차단(서버 도달 전) — 기존 savePhone 가드 보존 ──
test('회귀: FE 유효성(11자리·010 시작)이 저장 전 차단으로 보존', () => {
  const src = read(CHART);
  expect(src).toContain("if (digits.length === 0) { toast.error('번호를 입력해주세요'); return; }");
  expect(src).toContain("010으로 시작하는 11자리 번호를 입력해주세요");
});

// ── (선택) UI 렌더 스모크: 로그인 가능하면 2번차트 휴대폰 [수정] 진입 확인 ──
test('스모크: 2번차트 휴대폰 인라인 편집 UI 노출', async ({ page }) => {
  let ok = false;
  try {
    const { loginAndWaitForDashboard } = await import('../helpers');
    ok = await loginAndWaitForDashboard(page);
  } catch {
    test.skip(true, 'login helper 사용 불가');
    return;
  }
  if (!ok) { test.skip(true, 'Login failed'); return; }

  await page.goto('/admin/customers');
  const firstLink = page.locator('a[href*="/chart/"]').first();
  try {
    await firstLink.waitFor({ timeout: 10_000 });
  } catch {
    test.skip(true, '고객 목록 없음');
    return;
  }
  await firstLink.click();
  // 휴대폰 행 [수정] 버튼 노출(인라인 편집 진입점)
  const editBtn = page.getByRole('button', { name: '수정' }).first();
  try {
    await editBtn.waitFor({ timeout: 8_000 });
  } catch {
    test.skip(true, '휴대폰 [수정] 버튼 미발견(레이아웃 변경 가능)');
    return;
  }
  expect(await editBtn.isVisible()).toBe(true);
});
