/**
 * E2E spec — T-20260615-foot-CALLLIST-STEPPER-INLINE-COMPACT
 *
 * 진료콜 명단(DoctorCallListBar) — 현장(김주연 총괄) 요청:
 *   "진료콜 명단 한 명이 칸을 너무 크게 차지. '지하철 표시'(= 진료 단계 노선도 stepper)를 배지 옆으로 이동해
 *    공간 낭비 줄여줘. 진료대기 다수일 때 가독성 고려."
 *
 *   직전 T-20260615-SUBWAY-BADGE-INLINE 이 stepper 를 이름·배지 줄로 인라인 이동했으나, 노드 라벨 4개
 *   (대기/원장확인/진료중/진료완료)가 동시 노출돼 폭이 넓고 세로(▼+점+라벨 ~38px)가 커 다수 행에서 여전히
 *   칸을 크게 점유. → compact 변형: 노드 라벨 4개 미렌더(점만) + "현 단계만 텍스트"(현재 단계 1개 라벨)로
 *   이름·배지와 한 묶음 축소. ▼ 현위치 마커·4노드 클릭전환·realtime 동기는 불변(렌더 레이아웃만).
 *
 * ▶ REDEFINITION(policy_superseded): T-20260614 DOCCALL-PURPLE-STEPPER 이슈2의 "stepper 가로폭 필요→전용줄
 *    (라벨 4개 노출)" 결정을 동일 reporter 명시 요청으로 갱신. 그 기술근거(라벨 wrap 가독성)는 실재 →
 *    "단순 인라인(라벨 4개 그대로)" 금지, compact(현단계 텍스트)로 식별성 가드(AC-2).
 *
 * AC:
 *   AC-1 행 세로높이 명확 감소 — 노드 하단 라벨 4개 전용 표기 소멸(점+▼ 한 줄로 축소).
 *   AC-2 다수 시 이름·현재단계 식별 가능 — ▼ 현위치 유지 + 현단계 1개 텍스트 라벨 노출.
 *   AC-3 4단계 클릭전환 + DB write + realtime 불변 — setDoctorStage/deriveDoctorStage 미변경.
 *   AC-4 이름→차트·메모·행숨김·드래그·배지·testid 불변.
 *
 * 컨벤션(형제 spec 따름): 소스 정적 단언(fs) + 대시보드 DOM 스모크(graceful skip).
 *
 * 시나리오(티켓 §6 현장 클릭 시나리오 3종) → 검증 매핑:
 *   S1 1명(정상)   → DOM: 행 stepper compact(라벨 4개 미렌더, 현단계 텍스트 1개, ▼ 1개).
 *   S2 4명+(다수)  → DOM: 각 행 stepper compact 일관 + name-row 인라인 + 레이아웃 무파손.
 *   S3 단계 클릭전환 → 소스: setDoctorStage/deriveDoctorStage 박제 불변(전환 로직 미접촉).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAndWaitForDashboard } from '../helpers';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');

test.describe('T-20260615 CALLLIST-STEPPER-INLINE-COMPACT — "지하철 표시" 콤팩트화', () => {
  // ── S3·AC-3 (소스 정적): 전환 로직 박제 — compact 는 렌더 레이아웃만, 비즈로직 미접촉 ──────────────
  test('AC-3: setDoctorStage / deriveDoctorStage 전환·파생 로직 불변(레이아웃만 변경)', () => {
    const step = SRC('components/doctor/DoctorStageStepper.tsx');
    // 4단계 라벨 배열·파생 우선순위·전환 patch 컬럼 — DOCCALL-PURPLE-STEPPER 산출 그대로 유지.
    expect(step).toContain("['대기', '원장확인', '진료중', '진료완료']");
    expect(step).toContain('export function deriveDoctorStage');
    expect(step).toContain('export async function setDoctorStage');
    expect(step).toContain("doctor_status === 'done'");
    expect(step).toContain("doctor_status: 'in_treatment'");
    // ▼ 현위치 마커 + here testid 유지(AC-2).
    expect(step).toContain('▼');
    expect(step).toContain('doctor-stage-here');
    // 권한 무게이트(원장·직원 공용) 유지 — compact 도입이 게이트 추가하지 않음.
    expect(/doctorMode|isDoctor|DOCTOR_ROLES/.test(step)).toBe(false);
  });

  // ── S1·AC-1 (소스 정적): compact 변형 — 노드 라벨 미렌더 + 현단계 1개 텍스트 라벨 ─────────────────
  test('AC-1: compact 모드 — 노드 하단 라벨 4개 미렌더(점만) + 현단계 텍스트 1개', () => {
    const step = SRC('components/doctor/DoctorStageStepper.tsx');
    // compact prop 도입.
    expect(/compact\?:\s*boolean/.test(step)).toBe(true);
    expect(/compact\s*=\s*false/.test(step)).toBe(true);
    // 노드 하단 라벨은 compact 일 때 미렌더(가드: `{!compact && (` 로 감쌈).
    expect(/\{!compact\s*&&\s*\(/.test(step)).toBe(true);
    // "현 단계만 텍스트" — 현재 단계 1개 라벨(현단계 텍스트) 렌더.
    expect(step).toContain('doctor-stage-current-label');
    expect(/\{compact\s*&&\s*\(/.test(step)).toBe(true);
    expect(step).toContain('DOCTOR_STAGES[current]');

    // 호출부: DoctorCallListBar 가 compact 로 stepper 렌더(인라인 묶음).
    const bar = SRC('components/DoctorCallListBar.tsx');
    expect(/<DoctorStageStepper[^>]*\bcompact\b/.test(bar)).toBe(true);
    // 여전히 단일 인스턴스(행당 1개).
    expect((bar.match(/<DoctorStageStepper/g) ?? []).length).toBe(1);
  });

  // ── AC-4 (소스 정적): 회귀 가드 — 이름/배지/메모/행숨김/드래그 진입점·testid 무손실 ────────────────
  test('AC-4: 이름→차트·위치/힐러/완료 배지·메모·행숨김·드래그/숨기기/접기 testid 유지', () => {
    const src = SRC('components/DoctorCallListBar.tsx');
    expect(src).toContain('data-testid="doctor-call-name"');
    expect(src).toContain('data-testid="doctor-call-location"');
    expect(src).toContain('data-testid="doctor-call-healer-badge"');
    expect(src).toContain('data-testid="doctor-call-done-badge"');
    expect(src).toContain('data-testid="doctor-call-row-hide"');
    expect(src).toContain('data-testid="doctor-call-memo-display"');
    expect(src).toContain('data-testid="doctor-call-header"');   // 드래그 핸들
    expect(src).toContain('data-testid="doctor-call-hide"');     // 숨기기
    expect(src).toContain('data-testid="doctor-call-toggle"');   // 접기/펼치기
    // 세로 풀네임(truncate 부재) 유지.
    expect(src).toContain('whitespace-normal break-words');
    // DOCCALL-3FIX 제거 산출 재출현 금지.
    expect(src).not.toContain('data-testid="doctor-call-room"');
    expect(src).not.toContain('data-testid="doctor-call-select"');
  });

  // ── S1 (DOM 스모크): 1명 — compact stepper(라벨 4개 미렌더·현단계 텍스트 1개·▼ 1개·4노드) ─────────
  test('S1 DOM(1명): 행 stepper compact — 4노드 + ▼ 1개 + 현단계 라벨 1개, 노드 텍스트라벨 부재', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();

    const widget = page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])');
    if ((await widget.count()) === 0) {
      test.skip(true, '진료콜 명단 데이터 없음(당일 콜대상 0) — DOM compact 단언 스킵');
      return;
    }
    const rows = page.locator('[data-testid="doctor-call-row"]');
    if ((await rows.count()) === 0) {
      test.skip(true, '콜 행 0 — 스킵');
      return;
    }
    const firstRow = rows.first();
    const stepper = firstRow.locator('[data-testid="doctor-stage-stepper"]');
    await expect(stepper).toHaveCount(1);
    // compact 마커 + 4노드 + ▼ 1개 유지(AC-2·AC-3).
    await expect(stepper).toHaveAttribute('data-compact', 'true');
    await expect(stepper.locator('[data-testid="doctor-stage-node"]')).toHaveCount(4);
    await expect(stepper.locator('[data-testid="doctor-stage-here"]')).toHaveCount(1);
    // 현단계 텍스트 라벨 1개 노출(AC-2 식별성).
    await expect(stepper.locator('[data-testid="doctor-stage-current-label"]')).toHaveCount(1);
    await expect(stepper.locator('[data-testid="doctor-stage-current-label"]')).toBeVisible();
    // (정정) SUPERSEDED-BY CALLCARD-COMPACT-MEMO-TOGGLE: stepper 는 성함 아래 전용 줄(doctor-call-stepper-line).
    //   compact 렌더(점+현단계 라벨)는 유지, 위치만 인라인 → 전용 줄. ∴ 이름버튼과 다른 부모.
    const onOwnLine = await firstRow.evaluate((rowEl) => {
      const s = rowEl.querySelector('[data-testid="doctor-stage-stepper"]');
      const nm = rowEl.querySelector('[data-testid="doctor-call-name"]');
      const line = rowEl.querySelector('[data-testid="doctor-call-stepper-line"]');
      return !!s && !!nm && !!line && line.contains(s) && s.parentElement !== nm.parentElement;
    });
    expect(onOwnLine).toBe(true);
    // AC-4 회귀: 이름·메모 토글 진입점 유지(메모 박스는 기본 숨김, 토글이 진입점).
    await expect(firstRow.locator('[data-testid="doctor-call-name"]')).toBeVisible();
    await expect(firstRow.locator('[data-testid="doctor-call-memo-toggle"]')).toBeVisible();
  });

  // ── S2 (DOM 스모크): 4명+ — 각 행 compact stepper 일관 + 인라인 + 레이아웃 무파손 ────────────────
  test('S2 DOM(다수): 각 행 stepper compact 일관(현단계 라벨 1개·인라인), 레이아웃 무파손', async ({ page }) => {
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
        const stepper = row.locator('[data-testid="doctor-stage-stepper"]');
        await expect(stepper).toHaveAttribute('data-compact', 'true');
        // 각 행: 현단계 텍스트 라벨 정확히 1개(현재 단계만) + ▼ 1개.
        await expect(stepper.locator('[data-testid="doctor-stage-current-label"]')).toHaveCount(1);
        await expect(stepper.locator('[data-testid="doctor-stage-here"]')).toHaveCount(1);
        await expect(stepper.locator('[data-testid="doctor-stage-node"]')).toHaveCount(4);
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
