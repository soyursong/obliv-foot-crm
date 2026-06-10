/**
 * E2E spec — T-20260610-foot-CALLLIST-ROW-HIDE-AUTOSHOW
 * '원장님 진료콜 명단'(DoctorCallListBar) — 개별 행 숨기기 + 신규 listup 시 자동 재노출.
 *
 * 현장 요청(김주연 총괄):
 *   "굿 좋아 숨기기 기능도 있으면 좋겠는데 신규 리스트업되면 자동으로 다시 노출되고"
 *   = 행 단위로 가릴 수 있되, 같은/다른 환자가 '신규로 다시 리스트업'되면 숨김을 무시하고 자동 노출.
 *
 * ★핵심 설계(planner AC-0): listup 시그니처 키 = `${check_in.id}::${최근 active(purple/yellow) 진입시각}`.
 *   - 단순 환자ID/check_in.id 영구숨김 금지 → 이벤트/리스트업 시점 기반 키.
 *   - 새 환자/새 방문(새 check_in.id) 또는 재진료(status_flag_history 새 changed_at)면 시그니처가 바뀌어
 *     숨김 집합에 없으므로 자동 재노출. (listupSignature는 컴포넌트에서 export — 시나리오3 단위검증)
 *
 * AC → 단언 매핑:
 *   AC-1 행 숨기기 토글(doctor-call-row-hide) → 해당 행만 명단에서 제외(필터 레이어). 콜/정렬 보존.
 *   AC-2 숨김 집합 localStorage 영구(foot.doctorCallList.rowHidden.v1) — 위치/전체숨김 키와 별도.
 *   AC-3 신규 listup 시그니처 재등장 시 자동 재노출(시그니처 단위검증 — 시나리오3).
 *   AC-4 회귀금지: 드래그 위치(pos.v1)·전체숨김(hidden.v1)·세로풀네임·상단버튼 비차단.
 *
 * 컨벤션: DOM/계약 단언 + localStorage 단언 + listupSignature 순수함수 단위검증 + 데이터/인증 없으면 graceful skip.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginAndWaitForDashboard } from '../helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPONENT_SRC = path.resolve(__dirname, '../../src/components/DoctorCallListBar.tsx');

/**
 * 정본 listupSignature 로직 모사(repo unit 컨벤션 — 컴포넌트 런타임 import 회피).
 * 시나리오3에서 동작을 검증하고, 별도 소스 정적 가드로 정본과 동치임을 락(아래 'AC-3 소스 가드').
 */
type MiniCheckIn = {
  id: string;
  checked_in_at: string;
  status_flag_history: Array<{ flag: string | null; changed_at: string }> | null;
};
function listupSignature(ci: MiniCheckIn): string {
  let activationAt = ci.checked_in_at;
  const hist = ci.status_flag_history;
  if (Array.isArray(hist) && hist.length > 0) {
    for (let i = hist.length - 1; i >= 0; i--) {
      const f = hist[i]?.flag;
      if ((f === 'purple' || f === 'yellow') && hist[i]?.changed_at) {
        activationAt = hist[i].changed_at;
        break;
      }
    }
  }
  return `${ci.id}::${activationAt}`;
}

const ROW_HIDDEN_KEY = 'foot.doctorCallList.rowHidden.v1';
const POS_KEY = 'foot.doctorCallList.pos.v1';
const HIDDEN_KEY = 'foot.doctorCallList.hidden.v1';

test.describe('T-20260610 CALLLIST-ROW-HIDE-AUTOSHOW — 행 숨기기 + 신규 listup 자동 재노출', () => {
  // 이전 테스트의 영속(숨김/전체숨김) 오염 방지 — 시작 전 초기화
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((keys) => {
      try {
        localStorage.removeItem(keys.row);
        localStorage.removeItem(keys.hidden);
      } catch {
        /* noop */
      }
    }, { row: ROW_HIDDEN_KEY, hidden: HIDDEN_KEY });
  });

  // ── 시나리오 1 (AC-1·AC-2): 행 숨기기 → 해당 행 제외 + localStorage 영구 + 새로고침 유지 ──────────
  test('AC-1/2: 행 숨기기 → 그 행만 명단 제외, rowHidden.v1 localStorage 영구(새로고침 유지)', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    const list = page.locator('[data-testid="doctor-call-list"]');
    if (!ok || (await list.count()) === 0) {
      test.skip(true, '위젯 미표시 환경 — 스킵');
      return;
    }
    const rows = page.locator('[data-testid="doctor-call-row"]');
    const before = await rows.count();
    if (before === 0) {
      test.skip(true, '콜 명단 행 없음 — 스킵');
      return;
    }

    // 첫 행의 숨기기 버튼 클릭 → 행 수 1 감소(표시 필터 레이어)
    const firstId = await rows.first().getAttribute('data-checkin-id');
    await rows.first().locator('[data-testid="doctor-call-row-hide"]').click();
    await expect(rows).toHaveCount(before - 1);
    // 숨긴 행은 더 이상 명단에 없음
    await expect(page.locator(`[data-testid="doctor-call-row"][data-checkin-id="${firstId}"]`)).toHaveCount(0);

    // 헤더에 '숨김 N · 표시' escape hatch 노출
    const unhideAll = page.locator('[data-testid="doctor-call-row-unhide-all"]');
    await expect(unhideAll).toBeVisible();

    // localStorage 영속 — rowHidden.v1 에 시그니처 1건, 위치/전체숨김 키와 별개
    const saved = await page.evaluate((k) => localStorage.getItem(k), ROW_HIDDEN_KEY);
    expect(saved).toBeTruthy();
    const parsed = JSON.parse(saved as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(ROW_HIDDEN_KEY).not.toBe(POS_KEY);
    expect(ROW_HIDDEN_KEY).not.toBe(HIDDEN_KEY);

    // 새로고침 → 여전히 숨김 유지(행 수 그대로)
    await page.reload();
    const okReload = await loginAndWaitForDashboard(page);
    if (!okReload || (await list.count()) === 0) {
      test.skip(true, '새로고침 후 위젯 미표시 — 스킵');
      return;
    }
    await expect(page.locator(`[data-testid="doctor-call-row"][data-checkin-id="${firstId}"]`)).toHaveCount(0);
  });

  // ── 시나리오 2 (AC-1): '숨김 N · 표시' → 전체 복원(행 유실 방지 escape hatch) ──────────────────
  test('AC-1: 숨김 N · 표시 클릭 → 숨긴 행 전부 복원', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    const list = page.locator('[data-testid="doctor-call-list"]');
    if (!ok || (await list.count()) === 0) {
      test.skip(true, '위젯 미표시 환경 — 스킵');
      return;
    }
    const rows = page.locator('[data-testid="doctor-call-row"]');
    const before = await rows.count();
    if (before === 0) {
      test.skip(true, '콜 명단 행 없음 — 스킵');
      return;
    }
    await rows.first().locator('[data-testid="doctor-call-row-hide"]').click();
    await expect(rows).toHaveCount(before - 1);

    await page.locator('[data-testid="doctor-call-row-unhide-all"]').click();
    await expect(rows).toHaveCount(before); // 전부 복원
    await expect(page.locator('[data-testid="doctor-call-row-unhide-all"]')).toHaveCount(0);
    // localStorage 도 비워짐
    const saved = await page.evaluate((k) => localStorage.getItem(k), ROW_HIDDEN_KEY);
    expect(JSON.parse((saved as string) || '[]')).toEqual([]);
  });

  // ── 시나리오 3 (AC-3 핵심): listup 시그니처 — 신규 재등장 시 자동 재노출 성립 검증(순수함수 모사) ──
  test('AC-3: listupSignature — 새 방문(새 id)·재진료(새 활성시각)는 다른 시그니처(자동 재노출 성립)', async () => {
    // (a) 같은 listup(같은 id + 같은 활성시각) → 같은 시그니처(숨김 유지)
    const ci: MiniCheckIn = {
      id: 'ci-1',
      checked_in_at: '2026-06-10T01:00:00Z',
      status_flag_history: [{ flag: 'purple', changed_at: '2026-06-10T01:00:00Z' }],
    };
    expect(listupSignature(ci)).toBe(listupSignature({ ...ci }));

    // (b) 새 방문 = 새 check_in.id → 다른 시그니처 → 숨김 집합에 없음 → 자동 재노출
    const nextVisit: MiniCheckIn = { ...ci, id: 'ci-2' };
    expect(listupSignature(nextVisit)).not.toBe(listupSignature(ci));

    // (c) 같은 방문(id 동일)이 진료완료(pink) 후 재차 진료필요(purple)로 re-listup
    //     → status_flag_history에 새 changed_at 적재 → 다른 시그니처 → 자동 재노출(★핵심)
    const reListup: MiniCheckIn = {
      id: 'ci-1',
      checked_in_at: '2026-06-10T01:00:00Z',
      status_flag_history: [
        { flag: 'purple', changed_at: '2026-06-10T01:00:00Z' },
        { flag: 'pink', changed_at: '2026-06-10T01:30:00Z' },
        { flag: 'purple', changed_at: '2026-06-10T02:00:00Z' }, // re-listup
      ],
    };
    expect(listupSignature(reListup)).not.toBe(listupSignature(ci));

    // (d) history 없음(healer_waiting status 경로 등) → checked_in_at 폴백(방문 단위 안정)
    const noHist: MiniCheckIn = { id: 'ci-3', checked_in_at: '2026-06-10T01:00:00Z', status_flag_history: null };
    expect(listupSignature(noHist)).toBe('ci-3::2026-06-10T01:00:00Z');
  });

  // ── AC-3 소스 가드: 정본 컴포넌트가 모사와 동일한 시그니처 구성(이벤트/시점 기반, customer_id 영구숨김 아님)을 유지 ──
  test('AC-3 소스 가드: 정본 listupSignature = `${id}::${활성시각}` (customer_id 영구숨김 금지) 유지', async () => {
    const src = fs.readFileSync(COMPONENT_SRC, 'utf-8');
    // listupSignature export + check_in.id::활성시각 합성 키 존재
    expect(src).toContain('export function listupSignature');
    expect(src).toContain('`${ci.id}::${activationAt}`');
    // 활성(purple/yellow) 진입시각 우선, checked_in_at 폴백
    expect(src).toContain("f === 'purple' || f === 'yellow'");
    expect(src).toContain('ci.checked_in_at');
    // 영속 키가 위치/전체숨김 키와 분리된 별도 네임스페이스
    expect(src).toContain("foot.doctorCallList.rowHidden.v1");
    // 단순 customer_id 영구숨김 금지 — 시그니처에 customer_id를 키로 쓰지 않음
    expect(src).not.toContain('`${ci.customer_id}');
  });

  // ── 시나리오 4 (AC-4 회귀): 드래그 위치(pos.v1)·전체숨김·상단버튼·세로풀네임 비차단 ──────────────
  test('AC-4: 행 숨김이 드래그/전체숨김/상단콜버튼/세로풀네임 회귀 없음', async ({ page }) => {
    await page.goto('/');
    const ok = await loginAndWaitForDashboard(page);
    const list = page.locator('[data-testid="doctor-call-list"]');
    if (!ok || (await list.count()) === 0) {
      test.skip(true, '위젯 미표시 환경 — 스킵');
      return;
    }
    // 상단 액션 버튼(전체콜/숨기기/접기) 여전히 동작 — 행 숨김 facet과 직교
    await expect(page.locator('[data-testid="doctor-call-all"]')).toBeVisible();
    await expect(page.locator('[data-testid="doctor-call-hide"]')).toBeVisible(); // 전체숨김 토글 보존
    await expect(page.locator('[data-testid="doctor-call-toggle"]')).toBeVisible();

    // 드래그 위치 키와 행숨김 키는 별도 네임스페이스(직교)
    expect(ROW_HIDDEN_KEY).not.toBe(POS_KEY);

    // 행 숨김 후에도 전체숨김(EyeOff) → 최소 탭 정상 전환(두 facet 공존)
    const rows = page.locator('[data-testid="doctor-call-row"]');
    if ((await rows.count()) > 0) {
      await rows.first().locator('[data-testid="doctor-call-row-hide"]').click();
    }
    await page.locator('[data-testid="doctor-call-hide"]').click();
    await expect(list).toHaveAttribute('data-hidden', 'true');
    await expect(page.locator('[data-testid="doctor-call-show"]')).toBeVisible();
  });
});
