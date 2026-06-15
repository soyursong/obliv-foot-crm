/**
 * E2E spec — T-20260615-foot-CALLLIST-SUBWAY-BADGE-INLINE
 *
 * 진료콜 명단(DoctorCallListBar) — 현장(김주연 총괄) 요청: 카드 한 명이 칸을 너무 크게 차지한다.
 *   "지하철 표시"(= 진료 단계 노선도 stepper, 코드 주석 "진료 단계 노선도(지하철형)" — 같은 현장이
 *    T-20260614에서 "지하철 노선도처럼"이라 명명)가 각 행에서 *별도 줄*(mt-1.5 flex justify-start)에 렌더돼
 *    세로 공간을 점유. → 환자명/상태배지와 같은 가로 줄(인라인)로 이동해 카드 세로 높이 축소.
 *
 * AC:
 *   AC-1 "지하철 표시" stepper가 별도 줄이 아니라 환자명/상태배지와 같은 가로 줄(인라인)에 표시.
 *   AC-2 인라인 이동으로 카드 세로 높이 축소(별도 줄 제거분).
 *   AC-3 (회귀) 세로풀네임·위치배지(방번호 포함)·힐러배지·진료완료배지·행숨김·메모·드래그/숨기기/접기 유지.
 *   AC-4 stepper(지하철 표시)가 없거나 wrap돼도 빈 인라인 공간이 레이아웃을 깨지 않음.
 *
 * 컨벤션(형제 spec 따름): 소스 정적 단언(fs) + 대시보드 DOM 스모크(graceful skip).
 *
 * 시나리오(티켓 §현장 클릭 시나리오) → 검증 매핑:
 *   S1 정상 동선(인라인 표시)  → 소스: stepper가 name-row flex-wrap 그룹의 자식 + 별도 줄(mt-1.5 flex justify-start) 소멸.
 *                              → DOM: stepper와 이름버튼이 *동일 부모*(같은 가로 줄) 공유.
 *   S2 엣지(다수/무stepper)    → DOM: 행이 여럿이어도 stepper 1행 1개·name-row 내부, 회귀 진입점 유지.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAndWaitForDashboard } from '../helpers';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');

test.describe('T-20260615 CALLLIST-SUBWAY-BADGE-INLINE — "지하철 표시"(단계 노선도) 인라인 이동', () => {
  // ── S1 (소스 정적): stepper가 name-row 좌측 flex-wrap 그룹의 자식 + 별도 전용 줄 소멸 ──────────
  test('AC-1: stepper(지하철 표시)가 환자명/배지 그룹 내부 인라인 — 별도 줄(mt-1.5 flex justify-start) 제거', () => {
    const src = SRC('components/DoctorCallListBar.tsx');

    // (a) name-row 좌측 그룹: 이름버튼(doctor-call-name) … visitBadge … <DoctorStageStepper> 가 같은
    //     flex-wrap 그룹(`flex items-start flex-wrap`) 안에 순서대로 존재 = 인라인 합류.
    //     "{visitBadge}" 직후에 <DoctorStageStepper ...> 가 나오고, 그 사이에 새 줄 래퍼(div mt-) 없음.
    const visitToStepper = src.slice(
      src.indexOf('{visitBadge}'),
      src.indexOf('<DoctorStageStepper'),
    );
    expect(src.indexOf('{visitBadge}')).toBeGreaterThan(-1);
    expect(src.indexOf('<DoctorStageStepper')).toBeGreaterThan(-1);
    // {visitBadge} 와 stepper 사이에 새 줄을 만드는 컨테이너(mt-* div / justify-start 전용 줄)가 없음.
    expect(/mt-1\.5\s+flex\s+justify-start/.test(visitToStepper)).toBe(false);
    expect(/<div[^>]*className="mt-/.test(visitToStepper)).toBe(false);

    // (b) 과거 별도 전용 줄 패턴(`mt-1.5 flex justify-start` 로 stepper 감싸기)이 파일에서 완전 소멸.
    //     = stepper 가 이제 어떤 mt-1.5 justify-start 줄에도 들어있지 않음.
    expect(/className="mt-1\.5 flex justify-start">\s*<DoctorStageStepper/.test(src)).toBe(false);

    // (c) stepper 인스턴스는 정확히 1곳(행당 1개) — 중복 렌더 없음.
    expect((src.match(/<DoctorStageStepper/g) ?? []).length).toBe(1);

    // (d) import 유지(인라인 이동이 import 누락 유발 안 함).
    expect(/import\s+DoctorStageStepper\s+from/.test(src)).toBe(true);
  });

  // ── S1·AC-3 (소스 정적): 회귀 가드 — 인라인화로 기존 산출/배지 진입점 무손실 ────────────────────
  test('AC-3: 세로풀네임·위치배지·힐러·완료배지·행숨김·메모·드래그/숨기기/접기 진입점 유지', () => {
    const src = SRC('components/DoctorCallListBar.tsx');
    // 위치배지(방번호 포함, DOCCALL-3FIX) + 힐러 + 진료완료 + 행숨김 + 메모.
    expect(src).toContain('data-testid="doctor-call-location"');
    expect(src).toContain('data-testid="doctor-call-healer-badge"');
    expect(src).toContain('data-testid="doctor-call-done-badge"');
    expect(src).toContain('data-testid="doctor-call-row-hide"');
    expect(src).toContain('data-testid="doctor-call-memo-display"');
    // DOCCALL-3FIX 산출: standalone 방 배지/전화기/전체콜 제거 유지(재출현 금지).
    expect(src).not.toContain('data-testid="doctor-call-room"');
    expect(src).not.toContain('data-testid="doctor-call-select"');
    expect(src).not.toContain('data-testid="doctor-call-all"');
    // 세로 풀네임(truncate 부재·break-words) + 드래그/숨기기/접기 토글.
    expect(src).toContain('whitespace-normal break-words');
    expect(src).toContain('data-testid="doctor-call-header"');   // 드래그 핸들
    expect(src).toContain('data-testid="doctor-call-hide"');     // 숨기기
    expect(src).toContain('data-testid="doctor-call-toggle"');   // 접기/펼치기
    // ROOM-LABEL 빈상태 회귀 마커(data-empty) 보존 — 동일 파일 in-flight COORDINATE.
    expect(src).toContain('data-empty="true"');
  });

  // ── S1 (DOM 스모크): stepper 와 이름버튼이 *동일 부모*(같은 가로 줄) 공유 = 인라인 ─────────────
  test('AC-1·AC-2 DOM: stepper 와 doctor-call-name 이 같은 부모(가로 줄) 안 — 별도 줄 아님', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();

    const widget = page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])');
    if ((await widget.count()) === 0) {
      test.skip(true, '진료콜 명단 데이터 없음(당일 콜대상 0) — DOM 인라인 단언 스킵');
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

    // 핵심: stepper 의 부모 요소가 doctor-call-name 도 함께 포함 = 같은 가로 줄(인라인).
    //   별도 줄(과거 mt-1.5 div)이면 stepper 부모는 이름버튼을 포함하지 않는다.
    const sharesParentWithName = await firstRow.evaluate((rowEl) => {
      const stepperEl = rowEl.querySelector('[data-testid="doctor-stage-stepper"]');
      const nameEl = rowEl.querySelector('[data-testid="doctor-call-name"]');
      if (!stepperEl || !nameEl) return false;
      return stepperEl.parentElement === nameEl.parentElement;
    });
    expect(sharesParentWithName).toBe(true);

    // AC-2: 인라인 그룹(이름~stepper 공유 부모)의 높이 ≤ 행 전체 높이(별도 줄이 사라져 한 줄에 흡수).
    //   (절대 px 단언은 환경 의존 → '인라인 그룹이 stepper 를 포함'하는 구조로 세로 축소를 보증.)
    const groupContainsStepper = await firstRow.evaluate((rowEl) => {
      const nameEl = rowEl.querySelector('[data-testid="doctor-call-name"]');
      const grp = nameEl?.parentElement;
      return !!grp?.querySelector('[data-testid="doctor-stage-stepper"]');
    });
    expect(groupContainsStepper).toBe(true);

    // AC-3 회귀: 같은 행에 이름/위치/메모 진입점 유지.
    await expect(firstRow.locator('[data-testid="doctor-call-name"]')).toBeVisible();
    await expect(firstRow.locator('[data-testid="doctor-call-location"]')).toHaveCount(1);
    await expect(firstRow.locator('[data-testid="doctor-call-memo-display"]')).toBeVisible();
  });

  // ── S2 (DOM 스모크): 다수 행이어도 각 행 stepper 1개·name-row 인라인 일관 + 레이아웃 무파손 ──────
  test('AC-4 DOM: 다수 행 — 각 행 stepper 1개, name-row 인라인 일관(빈 공간 무파손)', async ({ page }) => {
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
    // 모든 행: stepper 0 또는 1개(중복 없음) + 존재 시 이름버튼과 부모 공유.
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      const cnt = await row.locator('[data-testid="doctor-stage-stepper"]').count();
      expect(cnt).toBeLessThanOrEqual(1);
      if (cnt === 1) {
        const inline = await row.evaluate((rowEl) => {
          const s = rowEl.querySelector('[data-testid="doctor-stage-stepper"]');
          const nm = rowEl.querySelector('[data-testid="doctor-call-name"]');
          return !!s && !!nm && s.parentElement === nm.parentElement;
        });
        expect(inline).toBe(true);
      }
    }
    // 위젯이 화면에 보이고(레이아웃 무파손) testid 안정.
    await expect(widget.first()).toBeVisible();
  });
});
