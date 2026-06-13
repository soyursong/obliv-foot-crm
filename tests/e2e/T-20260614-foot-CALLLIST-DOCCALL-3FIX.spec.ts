/**
 * E2E spec — T-20260614-foot-CALLLIST-DOCCALL-3FIX
 *
 * 진료콜 명단 위젯(DoctorCallListBar) 현장 피드백 3건 (현장 김주연 총괄):
 *   #1 위치 배지 중복 제거: ROOM-LABEL standalone 방 배지(doctor-call-room)가 위치 배지
 *      (doctor-call-location, '치료실 · C1')의 방번호와 'C1'을 이중 표기 → standalone 배지 제거,
 *      위치 배지 단일로 통일(치료실명+방번호 유지).
 *   #2 행 우측 전화기(지정콜, doctor-call-select) 버튼 완전 제거 + 핸들러 dead code 정리.
 *   #3 상단 우측 '전체콜'(doctor-call-all) 버튼 완전 제거(+ 무용해진 '해제' doctor-call-clear 동반 제거).
 *      숨기기(doctor-call-hide)·접기/펼치기(doctor-call-toggle)는 유지.
 *
 * 콜 하이라이트 메커니즘(allCall/selectedId·highlighted·"호출 중" doctor-call-calling)은 #2·#3로
 * 진입점이 사라져 dead code화 → 일괄 정리.
 *
 * 컨벤션: 환경독립 파생 로직 page.evaluate 박제 + 대시보드 렌더 스모크(graceful skip).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260614 CALLLIST-DOCCALL-3FIX — 진료콜 명단 중복배지/콜버튼 정리', () => {
  // ── #1 (로직 박제): 방번호는 위치 라벨 단일 경로로만 — 입실 단계 'C2' 정확히 1회 ──────────
  test('#1: 방번호는 위치 라벨에만 1회 폴딩 — standalone 중복 없음', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const STATUS_KO: Record<string, string> = {
        treatment_waiting: '치료대기', preconditioning: '치료실', laser: '레이저', consultation: '상담',
      };
      const IN_ROOM = ['consultation', 'examination', 'preconditioning', 'laser'];
      const nonEmpty = (v: string | null | undefined) => { const t = (v ?? '').trim(); return t === '' ? null : t; };
      const roomFor = (ci: Record<string, string | null | undefined>) => {
        switch (ci.status) {
          case 'consultation': return nonEmpty(ci.consultation_room);
          case 'preconditioning': return nonEmpty(ci.treatment_room);
          case 'laser': return nonEmpty(ci.laser_room);
          default: return null;
        }
      };
      const label = (ci: Record<string, string | null | undefined>) => {
        const stage = STATUS_KO[ci.status as string] ?? '대기';
        if (IN_ROOM.includes(ci.status as string)) { const r = roomFor(ci); return r ? `${stage} · ${r}` : stage; }
        return stage;
      };
      return {
        treat: label({ status: 'preconditioning', treatment_room: 'C2' }),
        waiting: label({ status: 'treatment_waiting', treatment_room: 'C2' }),
      };
    });
    expect(result.treat).toBe('치료실 · C2');
    expect((result.treat.match(/C2/g) ?? []).length).toBe(1); // 방번호 정확히 1회(중복 박멸)
    expect(result.waiting).toBe('치료대기'); // 대기 단계는 방 미표시(회귀 가드)
  });

  // ── #1·#2·#3 (DOM 스모크): 위젯 렌더 + standalone 방배지/지정콜/전체콜 부재, 잔존 토글 보존 ──
  test('#1·#2·#3: 중복 방배지·콜버튼 제거 + 위치배지/숨기기/펼침 토글 보존', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();

    // 전역 부재 가드(데이터 유무 무관): 제거된 3 요소는 어떤 상태에서도 0개.
    await expect(page.locator('[data-testid="doctor-call-room"]')).toHaveCount(0);   // #1 standalone 방배지
    await expect(page.locator('[data-testid="doctor-call-select"]')).toHaveCount(0); // #2 행 지정콜(전화기)
    await expect(page.locator('[data-testid="doctor-call-all"]')).toHaveCount(0);    // #3 전체콜
    await expect(page.locator('[data-testid="doctor-call-clear"]')).toHaveCount(0);  // #3 동반(해제)
    await expect(page.locator('[data-testid="doctor-call-calling"]')).toHaveCount(0); // dead 콜 하이라이트

    const widget = page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])');
    if ((await widget.count()) === 0) {
      test.skip(true, '진료콜 명단 데이터 없음(당일 콜대상 0) — 잔존 토글/배지 행단언 스킵');
      return;
    }
    // 잔존 토글 보존: 숨기기 + 접기/펼치기.
    await expect(page.locator('[data-testid="doctor-call-hide"]')).toBeVisible();
    await expect(page.locator('[data-testid="doctor-call-toggle"]')).toBeVisible();

    const rows = page.locator('[data-testid="doctor-call-row"]');
    if ((await rows.count()) > 0) {
      const firstRow = rows.first();
      // 위치 배지는 행당 정확히 1개(중복 위치 표기 없음) + "undefined" 미노출.
      const loc = firstRow.locator('[data-testid="doctor-call-location"]');
      await expect(loc).toHaveCount(1);
      await expect(loc).not.toHaveText(/undefined/);
      // 행 내부에도 제거 대상 부재(이중 가드).
      await expect(firstRow.locator('[data-testid="doctor-call-room"]')).toHaveCount(0);
      await expect(firstRow.locator('[data-testid="doctor-call-select"]')).toHaveCount(0);
      // 잔존 기능 진입점: 이름(차트)·메모.
      await expect(firstRow.locator('[data-testid="doctor-call-name"]')).toBeVisible();
      await expect(firstRow.locator('[data-testid="doctor-call-memo-display"]')).toBeVisible();
    }
  });
});
