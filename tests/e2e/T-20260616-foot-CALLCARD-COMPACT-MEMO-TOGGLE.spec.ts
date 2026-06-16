/**
 * E2E spec — T-20260616-foot-CALLCARD-COMPACT-MEMO-TOGGLE
 *
 * 진료콜 명단(DoctorCallListBar) 카드 컴팩트 개선 — 현장(김주연 총괄, 풋센터) 요청.
 *   1) 지하철 표시(stepper)를 성함 바로 아래 고정 줄로 통일(카드별 위치 흔들림 해소).
 *   2) 진료 전달사항 박스 기본 숨김.
 *   3) 연필 아이콘 클릭 시에만 토글 표시(다시 클릭 시 닫힘).
 *   4) 연필 + 숨김(EyeOff) 아이콘 가로 나란히.
 *   5/6) 폰트·여백 축소(컴팩트). stepper·긴 이름 가독성 회귀 없음.
 *
 * REDEFINITION 정합화: 같은 surface 의 SUBWAY-BADGE-INLINE(인라인 stepper)·DOCDASH-MEMO(상시 메모박스)는
 *   본 티켓으로 supersede. 필드(check_ins.doctor_call_memo)·저장로직·compact 렌더는 불변(위치/노출방식만 변경).
 *
 * 컨벤션(형제 spec 따름): 소스 정적 단언(fs) + 대시보드 DOM 스모크(graceful skip).
 *
 * 시나리오(티켓 §현장 클릭 시나리오) → 검증 매핑:
 *   S1 정상 동선(컴팩트+토글) → 소스/DOM: stepper 전용 줄(AC-1), 메모 박스 기본 숨김(AC-2),
 *                              연필 클릭→박스 노출→재클릭→닫힘(AC-3), 연필·숨김 가로 나란히(AC-4).
 *   S2 위치 일관성(멀티 카드) → DOM: 모든 카드 stepper 가 doctor-call-stepper-line 전용 줄(AC-1).
 *   S3 회귀 미발생            → DOM/소스: stepper 노드/현단계 유지(AC-6), 긴 이름 wrap(AC-5).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAndWaitForDashboard } from '../helpers';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');

test.describe('T-20260616 CALLCARD-COMPACT-MEMO-TOGGLE — 진료콜 카드 컴팩트·메모 토글', () => {
  // ── 소스 정적: 구조 단언 (#1~#6) ──────────────────────────────────────────────────────────────
  test('AC-1: stepper 성함 아래 전용 줄(doctor-call-stepper-line) — 인라인 그룹 밖', () => {
    const src = SRC('components/DoctorCallListBar.tsx');
    // 전용 줄 래퍼 안에 stepper 렌더.
    expect(src).toContain('data-testid="doctor-call-stepper-line"');
    expect(/data-testid="doctor-call-stepper-line"[\s\S]{0,160}<DoctorStageStepper/.test(src)).toBe(true);
    // {visitBadge} 인라인 그룹 직후에는 stepper 가 붙어있지 않음(전용 줄로 분리됨).
    const afterVisit = src.slice(src.indexOf('{visitBadge}'), src.indexOf('data-testid="doctor-call-stepper-line"'));
    expect(afterVisit.indexOf('<DoctorStageStepper')).toBe(-1);
    // 행당 stepper 1개(중복 없음) + compact 유지.
    expect((src.match(/<DoctorStageStepper/g) ?? []).length).toBe(1);
    expect(/<DoctorStageStepper[^>]*\bcompact\b/.test(src)).toBe(true);
  });

  test('AC-2·AC-3: 메모 박스 기본 숨김(showMemo 게이트) + 연필 토글', () => {
    const src = SRC('components/DoctorCallListBar.tsx');
    // showMemo state(기본 false) + 조건부 렌더 게이트.
    expect(/const \[showMemo, setShowMemo\] = useState\(false\)/.test(src)).toBe(true);
    expect(/\{showMemo && \(/.test(src)).toBe(true);
    // 메모 박스 testid + 토글 버튼 testid.
    expect(src).toContain('data-testid="doctor-call-memo-box"');
    expect(src).toContain('data-testid="doctor-call-memo-toggle"');
    // 토글 핸들러 — 펼침/접힘 + 접을 때 편집 종료.
    expect(/onClick=\{toggleMemo\}/.test(src)).toBe(true);
    // 메모 display/input 진입점 유지(필드 불변).
    expect(src).toContain('data-testid="doctor-call-memo-display"');
    expect(src).toContain('data-testid="doctor-call-memo-input"');
    expect(src).toContain('doctor_call_memo');
  });

  test('AC-4: 연필 토글 + 숨김(row-hide) 아이콘이 같은 가로 그룹(flex-row gap-1)', () => {
    const src = SRC('components/DoctorCallListBar.tsx');
    // 우측 아이콘 그룹: flex items-center gap-1 안에 memo-toggle 와 row-hide 가 함께.
    const grpStart = src.indexOf('flex items-center gap-1 shrink-0');
    expect(grpStart).toBeGreaterThan(-1);
    const grp = src.slice(grpStart, src.indexOf('data-testid="doctor-call-stepper-line"'));
    expect(grp.indexOf('data-testid="doctor-call-memo-toggle"')).toBeGreaterThan(-1);
    expect(grp.indexOf('data-testid="doctor-call-row-hide"')).toBeGreaterThan(-1);
  });

  test('AC-5: 컴팩트(패딩/gap 축소) + 긴 이름 wrap 가독성 유지', () => {
    const src = SRC('components/DoctorCallListBar.tsx');
    // 카드 패딩 p-1.5(구 p-2 축소).
    expect(/'w-full rounded-lg border p-1\.5 transition-all'/.test(src)).toBe(true);
    // 긴 이름 wrap(회귀 금지).
    expect(src).toContain('whitespace-normal break-words');
  });

  // ── S1 (DOM): 정상 동선 — 전용 줄 stepper / 메모 기본 숨김 / 연필 토글 / 가로 나란히 ─────────────
  test('S1 DOM: stepper 전용 줄 + 메모 기본 숨김 + 연필 토글 열림/닫힘 + 연필·숨김 가로', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();

    const widget = page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])');
    if ((await widget.count()) === 0) {
      test.skip(true, '진료콜 명단 데이터 없음(당일 콜대상 0) — DOM 단언 스킵');
      return;
    }
    const rows = page.locator('[data-testid="doctor-call-row"]');
    if ((await rows.count()) === 0) {
      test.skip(true, '콜 행 0 — 스킵');
      return;
    }
    const firstRow = rows.first();

    // AC-1: stepper 가 전용 줄(이름과 다른 부모) + 이름 아래.
    const stepper = firstRow.locator('[data-testid="doctor-stage-stepper"]');
    await expect(stepper).toHaveCount(1);
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

    // AC-4: 연필 토글 + 숨김 아이콘이 가로(같은 수평선상 — top 근접).
    const toggle = firstRow.locator('[data-testid="doctor-call-memo-toggle"]');
    await expect(toggle).toBeVisible();
    const rowHide = firstRow.locator('[data-testid="doctor-call-row-hide"]');
    if ((await rowHide.count()) > 0) {
      const horizontal = await firstRow.evaluate((rowEl) => {
        const t = rowEl.querySelector('[data-testid="doctor-call-memo-toggle"]');
        const h = rowEl.querySelector('[data-testid="doctor-call-row-hide"]');
        if (!t || !h) return false;
        const tr = t.getBoundingClientRect();
        const hr = h.getBoundingClientRect();
        // 세로 위치(top) 차이가 작고(같은 줄) 가로(left)로 떨어져 있음.
        return Math.abs(tr.top - hr.top) <= 8 && Math.abs(tr.left - hr.left) >= 8;
      });
      expect(horizontal).toBe(true);
    }

    // AC-3: 연필 클릭 → 메모 박스 노출.
    await toggle.click();
    await expect(firstRow.locator('[data-testid="doctor-call-memo-box"]')).toBeVisible();

    // AC-3: 다시 연필 클릭 → 메모 박스 닫힘.
    await toggle.click();
    await expect(firstRow.locator('[data-testid="doctor-call-memo-box"]')).toHaveCount(0);
  });

  // ── S2 (DOM): 위치 일관성 — 모든 카드 stepper 전용 줄 ─────────────────────────────────────────
  test('S2 DOM: 멀티 카드 — 모든 카드 stepper 가 전용 줄(동일 위치)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    const widget = page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])');
    if ((await widget.count()) === 0) {
      test.skip(true, '진료콜 명단 데이터 없음 — 스킵');
      return;
    }
    const rows = page.locator('[data-testid="doctor-call-row"]');
    const n = await rows.count();
    if (n === 0) {
      test.skip(true, '콜 행 0 — 스킵');
      return;
    }
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      const cnt = await row.locator('[data-testid="doctor-stage-stepper"]').count();
      expect(cnt).toBeLessThanOrEqual(1);
      if (cnt === 1) {
        const onOwnLine = await row.evaluate((rowEl) => {
          const s = rowEl.querySelector('[data-testid="doctor-stage-stepper"]');
          const nm = rowEl.querySelector('[data-testid="doctor-call-name"]');
          const line = rowEl.querySelector('[data-testid="doctor-call-stepper-line"]');
          return !!s && !!nm && !!line && line.contains(s) && s.parentElement !== nm.parentElement;
        });
        expect(onOwnLine).toBe(true);
      }
      // AC-2 일관: 각 카드 메모 박스 기본 숨김.
      await expect(row.locator('[data-testid="doctor-call-memo-box"]')).toHaveCount(0);
    }
    await expect(widget.first()).toBeVisible();
  });

  // ── S3 (DOM): 회귀 미발생 — stepper compact 노드/현단계 유지 ────────────────────────────────────
  test('S3 DOM: stepper compact(4노드·현단계·▼) 무회귀', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    const widget = page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])');
    if ((await widget.count()) === 0) {
      test.skip(true, '진료콜 명단 데이터 없음 — 스킵');
      return;
    }
    const rows = page.locator('[data-testid="doctor-call-row"]');
    if ((await rows.count()) === 0) {
      test.skip(true, '콜 행 0 — 스킵');
      return;
    }
    const stepper = rows.first().locator('[data-testid="doctor-stage-stepper"]');
    if ((await stepper.count()) === 0) {
      test.skip(true, 'stepper 없는 행 — 스킵');
      return;
    }
    await expect(stepper).toHaveAttribute('data-compact', 'true');
    await expect(stepper.locator('[data-testid="doctor-stage-node"]')).toHaveCount(4);
    await expect(stepper.locator('[data-testid="doctor-stage-here"]')).toHaveCount(1);
    await expect(stepper.locator('[data-testid="doctor-stage-current-label"]')).toHaveCount(1);
  });
});
