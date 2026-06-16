/**
 * E2E spec — T-20260616-foot-DOCCALL-CARD-COMPACT-6FIX
 *
 * ⚠ DEDUP 트윈: 본 티켓은 T-20260616-foot-CALLCARD-COMPACT-MEMO-TOGGLE (commit a178f532, deployed)와
 *   동일 ~11:02 6/16 슬랙 버스트(김주연 총괄 U0ATDB587PV·ch C0ATE5P6JTH·첨부 F0BAX9VH0G4·동일 6항목)의
 *   무발번 트윈이다. 6항목 컴팩트 개선은 a178f532 에서 이미 구현·배포 완료.
 *   본 spec 은 6FIX 티켓 ID 하에 6개 AC 의 회귀 박제(regression guard)를 둔다 — 컴포넌트는 미접촉
 *   (DoctorCallListBar.tsx 는 1주 10회+ 재정의된 고빈도 surface, 무회귀 가드 부과: 되돌리기 금지).
 *   무거운 DOM 시나리오의 권위 spec 은 트윈(CALLCARD-COMPACT-MEMO-TOGGLE.spec.ts)이 소유 — 본 spec 은
 *   ID 추적용 소스-정적 박제 + 라이트 DOM 스모크(graceful skip)로 중복을 최소화한다.
 *
 * 6항목(현장 김주연 총괄 요청):
 *   #1 지하철(stepper) 성함 아래 고정 위치 통일 → doctor-call-stepper-line 전용 줄(AC-1)
 *   #2 진료 전달사항 박스 기본 숨김 → showMemo 게이트 default false (AC-2)
 *   #3 연필 클릭 시에만 박스 표시(토글) → toggleMemo (AC-3)
 *   #4 연필 + 숨김 아이콘 가로 나란히 → flex items-center gap-1 그룹 (AC-4)
 *   #5/#6 폰트·여백 컴팩트 → 카드 p-1.5, 긴 이름 wrap 유지 (AC-5)
 *   무회귀 → stepper compact 4노드·▼현위치·현단계 라벨 보존 (AC-6)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAndWaitForDashboard } from '../helpers';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');

test.describe('T-20260616 DOCCALL-CARD-COMPACT-6FIX — 진료콜 카드 6항목 컴팩트(dedup 박제)', () => {
  // ── 소스 정적: 6개 AC 회귀 박제 ──────────────────────────────────────────────────────────────
  test('AC-1 (#1): stepper 가 성함 아래 전용 줄(doctor-call-stepper-line) — 인라인 그룹 밖, 모든 카드 동일 위치', () => {
    const src = SRC('components/DoctorCallListBar.tsx');
    expect(src).toContain('data-testid="doctor-call-stepper-line"');
    // 전용 줄 래퍼 안에서 stepper 렌더(성함 아래 고정).
    expect(/data-testid="doctor-call-stepper-line"[\s\S]{0,160}<DoctorStageStepper/.test(src)).toBe(true);
    // 이름·배지 인라인 그룹({visitBadge}) 직후에는 stepper 가 붙지 않음(전용 줄로 분리 = 카드별 위치 흔들림 해소).
    const afterVisit = src.slice(src.indexOf('{visitBadge}'), src.indexOf('data-testid="doctor-call-stepper-line"'));
    expect(afterVisit.indexOf('<DoctorStageStepper')).toBe(-1);
    // 행당 stepper 1개 + compact 유지(STEPPER-INLINE-COMPACT 콤팩트화 무회귀).
    expect((src.match(/<DoctorStageStepper/g) ?? []).length).toBe(1);
    expect(/<DoctorStageStepper[^>]*\bcompact\b/.test(src)).toBe(true);
  });

  test('AC-2·AC-3 (#2·#3): 메모 박스 기본 숨김(showMemo) + 연필 토글 노출', () => {
    const src = SRC('components/DoctorCallListBar.tsx');
    expect(/const \[showMemo, setShowMemo\] = useState\(false\)/.test(src)).toBe(true);
    expect(/\{showMemo && \(/.test(src)).toBe(true);
    expect(src).toContain('data-testid="doctor-call-memo-box"');
    expect(src).toContain('data-testid="doctor-call-memo-toggle"');
    expect(/onClick=\{toggleMemo\}/.test(src)).toBe(true);
    // 메모 입력·저장 진입점 + 필드 영속(저장로직 불변 — AC-3).
    expect(src).toContain('data-testid="doctor-call-memo-input"');
    expect(src).toContain('data-testid="doctor-call-memo-save"');
    expect(src).toContain('doctor_call_memo');
  });

  test('AC-4 (#4): 연필 토글 + 숨김(row-hide) 아이콘이 같은 가로 그룹(flex items-center gap-1)', () => {
    const src = SRC('components/DoctorCallListBar.tsx');
    const grpStart = src.indexOf('flex items-center gap-1 shrink-0');
    expect(grpStart).toBeGreaterThan(-1);
    const grp = src.slice(grpStart, src.indexOf('data-testid="doctor-call-stepper-line"'));
    expect(grp.indexOf('data-testid="doctor-call-memo-toggle"')).toBeGreaterThan(-1);
    expect(grp.indexOf('data-testid="doctor-call-row-hide"')).toBeGreaterThan(-1);
  });

  test('AC-5 (#5·#6): 컴팩트 패딩(p-1.5) + 긴 이름 wrap 무회귀(VERTICAL-FULLNAME)', () => {
    const src = SRC('components/DoctorCallListBar.tsx');
    expect(/'w-full rounded-lg border p-1\.5 transition-all'/.test(src)).toBe(true);
    expect(src).toContain('whitespace-normal break-words');
  });

  test('AC-6 (무회귀): stepper 단계전환/현위치 로직·핵심 testid 보존', () => {
    const stepperSrc = SRC('components/doctor/DoctorStageStepper.tsx');
    // 4단계 클릭 전환 + idempotent write + 현위치 파생(불변).
    expect(stepperSrc).toContain('export async function setDoctorStage');
    expect(stepperSrc).toContain('export function deriveDoctorStage');
    expect(stepperSrc).toContain("data-testid={isCurrent ? 'doctor-stage-here' : undefined}");
    const rowSrc = SRC('components/DoctorCallListBar.tsx');
    // 핵심 testid·진입점 보존(DOCCALL-3FIX/PURPLE-STEPPER/SUBWAY-BADGE-INLINE 산출 무회귀).
    for (const tid of [
      'doctor-call-row',
      'doctor-call-name',
      'doctor-call-location',
      'doctor-call-row-hide',
      'doctor-call-healer-badge',
    ]) {
      expect(rowSrc).toContain(`data-testid="${tid}"`);
    }
    // 이름 클릭 → 차트 진입점 보존.
    expect(rowSrc).toContain('onOpenChart');
  });

  // ── 라이트 DOM 스모크 (graceful skip) — 권위 DOM 시나리오는 트윈 spec 이 소유 ─────────────────
  test('DOM 스모크: 전용 줄 stepper + 메모 기본 숨김 + 연필 토글 열림/닫힘', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    const widget = page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])');
    if ((await widget.count()) === 0) {
      test.skip(true, '진료콜 명단 데이터 없음(당일 콜대상 0) — DOM 스킵');
      return;
    }
    const rows = page.locator('[data-testid="doctor-call-row"]');
    if ((await rows.count()) === 0) {
      test.skip(true, '콜 행 0 — 스킵');
      return;
    }
    const firstRow = rows.first();

    // AC-1: stepper 가 전용 줄(이름과 다른 부모) + 이름 아래.
    const onOwnLine = await firstRow.evaluate((rowEl) => {
      const s = rowEl.querySelector('[data-testid="doctor-stage-stepper"]');
      const nm = rowEl.querySelector('[data-testid="doctor-call-name"]');
      const line = rowEl.querySelector('[data-testid="doctor-call-stepper-line"]');
      if (!s || !nm || !line) return false;
      return line.contains(s) && s.parentElement !== nm.parentElement
        && line.getBoundingClientRect().top >= nm.getBoundingClientRect().top;
    });
    expect(onOwnLine).toBe(true);

    // AC-2: 메모 박스 기본 숨김.
    await expect(firstRow.locator('[data-testid="doctor-call-memo-box"]')).toHaveCount(0);

    // AC-3: 연필 클릭 → 노출 → 재클릭 → 닫힘.
    const toggle = firstRow.locator('[data-testid="doctor-call-memo-toggle"]');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(firstRow.locator('[data-testid="doctor-call-memo-box"]')).toBeVisible();
    await toggle.click();
    await expect(firstRow.locator('[data-testid="doctor-call-memo-box"]')).toHaveCount(0);
  });
});
