/**
 * E2E spec — T-20260615-foot-CALLLIST-SUBWAY-BADGE-INLINE
 *
 * ⚠ SUPERSEDED-BY T-20260616-foot-CALLCARD-COMPACT-MEMO-TOGGLE (2026-06-16)
 *   이 티켓(SUBWAY-BADGE-INLINE)은 "지하철 표시"(진료 단계 노선도 stepper)를 카드 세로 높이 축소 목적으로
 *   환자명/배지와 같은 가로 줄(인라인)로 합류시켰다. 그러나 인라인은 이름 길이에 따라 짧은 이름=인라인 /
 *   긴 이름=wrap 으로 카드마다 stepper 위치가 흔들렸고, 현장(김주연 총괄)이 "카드마다 위치가 달라 지저분"이라
 *   지적 → CALLCARD-COMPACT-MEMO-TOGGLE 이 stepper 를 **성함 바로 아래 전용 줄(doctor-call-stepper-line)**로
 *   정정(모든 카드 동일 위치). 따라서 본 spec 의 "인라인" 단언은 신규 canonical(전용 줄)로 역전한다.
 *   compact 렌더(점+현단계 라벨, data-compact)와 회귀 진입점은 그대로 유지 검증.
 *
 * 정정 후 AC(canonical):
 *   AC-1' "지하철 표시" stepper 가 환자명 인라인 그룹이 아니라 성함 바로 아래 전용 줄(doctor-call-stepper-line)에 표시.
 *   AC-2' 모든 카드에서 stepper 위치가 동일(인라인 흔들림 해소).
 *   AC-3 (회귀) 세로풀네임·위치배지(방번호 포함)·힐러배지·진료완료배지·행숨김·메모·드래그/숨기기/접기 유지.
 *   AC-4 stepper 가 없거나 다수 행이어도 레이아웃 무파손.
 *
 * 컨벤션(형제 spec 따름): 소스 정적 단언(fs) + 대시보드 DOM 스모크(graceful skip).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAndWaitForDashboard } from '../helpers';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');

test.describe('T-20260615 CALLLIST-SUBWAY-BADGE-INLINE — (정정) stepper 성함 아래 전용 줄', () => {
  // ── S1 (소스 정적): stepper 가 인라인 그룹이 아닌 전용 줄(doctor-call-stepper-line)에 있다 ──────────
  test('AC-1: stepper(지하철 표시)가 성함 아래 전용 줄(doctor-call-stepper-line) — 인라인 그룹 밖', () => {
    const src = SRC('components/DoctorCallListBar.tsx');

    // (a) 전용 줄 래퍼 존재 — stepper 가 doctor-call-stepper-line div 안에 렌더.
    expect(src).toContain('data-testid="doctor-call-stepper-line"');
    expect(/data-testid="doctor-call-stepper-line"[\s\S]{0,160}<DoctorStageStepper/.test(src)).toBe(true);

    // (b) {visitBadge} 직후(인라인 그룹) 에는 stepper 가 더 이상 붙어있지 않음 — 그룹 닫힘(</div>)이 먼저 온다.
    const afterVisit = src.slice(src.indexOf('{visitBadge}'), src.indexOf('data-testid="doctor-call-stepper-line"'));
    expect(afterVisit.indexOf('<DoctorStageStepper')).toBe(-1);

    // (c) stepper 인스턴스는 정확히 1곳(행당 1개) — 중복 렌더 없음.
    expect((src.match(/<DoctorStageStepper/g) ?? []).length).toBe(1);

    // (d) import 유지.
    expect(/import\s+DoctorStageStepper\s+from/.test(src)).toBe(true);
  });

  // ── S1·AC-3 (소스 정적): 회귀 가드 — 기존 산출/배지 진입점 무손실 ────────────────────────────────
  test('AC-3: 세로풀네임·위치배지·힐러·완료배지·행숨김·메모·드래그/숨기기/접기 진입점 유지', () => {
    const src = SRC('components/DoctorCallListBar.tsx');
    expect(src).toContain('data-testid="doctor-call-location"');
    expect(src).toContain('data-testid="doctor-call-healer-badge"');
    expect(src).toContain('data-testid="doctor-call-done-badge"');
    expect(src).toContain('data-testid="doctor-call-row-hide"');
    expect(src).toContain('data-testid="doctor-call-memo-display"');
    // CALLCARD-COMPACT-MEMO-TOGGLE 신규 진입점: 연필 토글.
    expect(src).toContain('data-testid="doctor-call-memo-toggle"');
    // DOCCALL-3FIX 산출: standalone 방 배지/전화기/전체콜 제거 유지(재출현 금지).
    expect(src).not.toContain('data-testid="doctor-call-room"');
    expect(src).not.toContain('data-testid="doctor-call-select"');
    expect(src).not.toContain('data-testid="doctor-call-all"');
    expect(src).toContain('whitespace-normal break-words');
    expect(src).toContain('data-testid="doctor-call-header"');   // 드래그 핸들
    expect(src).toContain('data-testid="doctor-call-hide"');     // 숨기기
    expect(src).toContain('data-testid="doctor-call-toggle"');   // 접기/펼치기
    expect(src).toContain('data-empty="true"');
  });

  // ── S1 (DOM 스모크): stepper 와 이름버튼이 *다른 부모*(전용 줄) — 인라인 아님 ─────────────────────
  test('AC-1·AC-2 DOM: stepper 가 doctor-call-name 과 다른 부모(전용 줄) — 모든 카드 동일 위치', async ({ page }) => {
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
    const n = await rows.count();
    if (n === 0) {
      test.skip(true, '콜 행 0 — 스킵');
      return;
    }
    const firstRow = rows.first();
    const stepper = firstRow.locator('[data-testid="doctor-stage-stepper"]');
    await expect(stepper).toHaveCount(1);
    await expect(stepper.locator('[data-testid="doctor-stage-node"]')).toHaveCount(4);

    // 핵심(정정): stepper 부모는 doctor-call-stepper-line 줄 → 이름버튼 부모와 다름(전용 줄).
    const onOwnLine = await firstRow.evaluate((rowEl) => {
      const stepperEl = rowEl.querySelector('[data-testid="doctor-stage-stepper"]');
      const nameEl = rowEl.querySelector('[data-testid="doctor-call-name"]');
      const lineEl = rowEl.querySelector('[data-testid="doctor-call-stepper-line"]');
      if (!stepperEl || !nameEl || !lineEl) return false;
      // stepper 는 전용 줄 안 + 이름과 다른 부모 + 이름 줄 아래(세로 위치 더 큼).
      const inLine = lineEl.contains(stepperEl);
      const diffParent = stepperEl.parentElement !== nameEl.parentElement;
      const below = lineEl.getBoundingClientRect().top >= nameEl.getBoundingClientRect().top;
      return inLine && diffParent && below;
    });
    expect(onOwnLine).toBe(true);

    // AC-3 회귀: 같은 행에 이름/위치 진입점 + 메모 토글 유지.
    await expect(firstRow.locator('[data-testid="doctor-call-name"]')).toBeVisible();
    await expect(firstRow.locator('[data-testid="doctor-call-location"]')).toHaveCount(1);
    await expect(firstRow.locator('[data-testid="doctor-call-memo-toggle"]')).toBeVisible();
  });

  // ── S2 (DOM 스모크): 다수 행이어도 각 행 stepper 1개·전용 줄 일관 + 레이아웃 무파손 ──────────────
  test('AC-4 DOM: 다수 행 — 각 행 stepper 1개, 전용 줄 일관(무파손)', async ({ page }) => {
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
    }
    await expect(widget.first()).toBeVisible();
  });
});
