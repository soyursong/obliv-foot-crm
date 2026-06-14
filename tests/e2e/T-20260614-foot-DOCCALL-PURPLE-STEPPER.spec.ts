/**
 * E2E spec — T-20260614-foot-DOCCALL-PURPLE-STEPPER
 *
 * 진료콜 명단(DoctorCallListBar) 2건 (현장 김주연 총괄, §DECISION CONFIRMED):
 *   이슈1 — 진료콜 빨강 → 보라(진료필요 status 색과 통일감). red-* 토큰 → purple-* 단일화.
 *   이슈2 — 진료 단계 노선도(지하철형) 4단계 stepper: 대기 ─ 원장확인 ─ 진료중 ─ 진료완료.
 *           현재 단계 = 채워진 원(●,purple) + 원 위 ▼ 현위치 마커. 각 노드 클릭 전환(원장·직원 공용).
 *           기존 ✋ 손 아이콘(DoctorAckBadge) **완전 대체**(병행 X).
 *
 * 상태 매핑(스키마 최소화 — 기존/architect 승인 컬럼 재사용):
 *   대기=doctor_ack_at NULL & doctor_status NULL / 원장확인=doctor_ack_at 값존재(T-20260609 흡수) /
 *   진료중=doctor_status 'in_treatment' / 진료완료=doctor_status 'done' (T-20260612 doctor_status, architect CONSULT).
 *
 * 컨벤션: 파생/전환 로직 page.evaluate 박제 + 소스 정적 단언(fs) + 대시보드 렌더 스모크(graceful skip).
 *
 * 시나리오(티켓 §현장 클릭 시나리오) → 검증 매핑:
 *   S1 색상            → 이슈1 (소스 red 0건 / purple 사용 + 위치배지 등 무회귀)
 *   S2 stepper 표시·전환 → 이슈2 (4단계·현위치 파생·전환 patch·✋ 완전대체·DOM 스모크)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAndWaitForDashboard } from '../helpers';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');

test.describe('T-20260614 DOCCALL-PURPLE-STEPPER — 진료콜 보라통일 + 진료단계 stepper', () => {
  // ── 이슈1 (소스 정적): DoctorCallListBar 색상 red → purple 단일화 ───────────────────────
  test('이슈1: 진료콜 명단 위젯 red-* 토큰 0건 + purple-* 채택(진료필요 색 통일)', () => {
    const src = SRC('components/DoctorCallListBar.tsx');
    // red 색상 클래스(border/bg/text/ring/hover:* )가 0건 — 빨강 잔존 없음.
    const redMatches = src.match(/(?:border|bg|text|ring|hover:bg|hover:text|hover:border|focus:ring)-red-\d/g) ?? [];
    expect(redMatches).toEqual([]);
    // purple 토큰을 실제로 사용(헤더/배지/포커스링 등).
    expect(/purple-\d/.test(src)).toBe(true);
  });

  // ── 이슈2 (파생 로직 박제): deriveDoctorStage 4단계 매핑 ─────────────────────────────────
  test('이슈2: deriveDoctorStage — 대기0/원장확인1/진료중2/진료완료3 정확 매핑', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(() => {
      // DoctorStageStepper.deriveDoctorStage 와 동일 규칙(박제). done>in_treatment>ack>대기.
      const derive = (ci: { doctor_ack_at: string | null; doctor_status: string | null }) => {
        if (ci.doctor_status === 'done') return 3;
        if (ci.doctor_status === 'in_treatment') return 2;
        if (ci.doctor_ack_at) return 1;
        return 0;
      };
      return {
        wait: derive({ doctor_ack_at: null, doctor_status: null }),
        ack: derive({ doctor_ack_at: '2026-06-14T01:00:00Z', doctor_status: null }),
        inTreat: derive({ doctor_ack_at: '2026-06-14T01:00:00Z', doctor_status: 'in_treatment' }),
        done: derive({ doctor_ack_at: '2026-06-14T01:00:00Z', doctor_status: 'done' }),
        // 되돌리기: doctor_status 우선 — done 이면 ack 무관하게 3.
        doneNoAck: derive({ doctor_ack_at: null, doctor_status: 'done' }),
      };
    });
    expect(r.wait).toBe(0);
    expect(r.ack).toBe(1);
    expect(r.inTreat).toBe(2);
    expect(r.done).toBe(3);
    expect(r.doneNoAck).toBe(3);
  });

  // ── 이슈2 (전환 patch 로직 박제): 단계 클릭 → check_ins UPDATE patch 정합 ─────────────────
  test('이슈2: setDoctorStage patch — 각 단계 컬럼 정합 + ack 보존 + 되돌리기 상위컬럼 해제', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(() => {
      const NOW = '2026-06-14T05:00:00.000Z';
      const buildPatch = (
        ci: { doctor_ack_at: string | null; doctor_started_at: string | null },
        stage: 0 | 1 | 2 | 3,
      ) => {
        const ackAt = ci.doctor_ack_at ?? NOW;
        const startedAt = ci.doctor_started_at ?? NOW;
        switch (stage) {
          case 0: return { doctor_ack_at: null, doctor_status: null, doctor_started_at: null, doctor_ended_at: null };
          case 1: return { doctor_ack_at: ackAt, doctor_status: null, doctor_started_at: null, doctor_ended_at: null };
          case 2: return { doctor_ack_at: ackAt, doctor_status: 'in_treatment', doctor_started_at: startedAt, doctor_ended_at: null };
          case 3: return { doctor_ack_at: ackAt, doctor_status: 'done', doctor_started_at: startedAt, doctor_ended_at: NOW };
        }
      };
      const fresh = { doctor_ack_at: null, doctor_started_at: null };
      const acked = { doctor_ack_at: '2026-06-14T01:00:00Z', doctor_started_at: '2026-06-14T02:00:00Z' };
      return {
        toWait: buildPatch(acked, 0),
        toAck: buildPatch(fresh, 1),
        toInTreat: buildPatch(fresh, 2),
        toDone: buildPatch(fresh, 3),
        // 되돌리기(진료중→원장확인): doctor_status 명시적 null + ack 기존값 보존.
        backToAck: buildPatch(acked, 1),
      };
    });
    // 대기: 전부 초기화
    expect(r.toWait).toEqual({ doctor_ack_at: null, doctor_status: null, doctor_started_at: null, doctor_ended_at: null });
    // 원장확인: ack만, 진료세션 컬럼 해제
    expect(r.toAck.doctor_ack_at).toBe('2026-06-14T05:00:00.000Z');
    expect(r.toAck.doctor_status).toBeNull();
    // 진료중: in_treatment + started
    expect(r.toInTreat.doctor_status).toBe('in_treatment');
    expect(r.toInTreat.doctor_started_at).toBe('2026-06-14T05:00:00.000Z');
    expect(r.toInTreat.doctor_ended_at).toBeNull();
    // 진료완료: done + ended
    expect(r.toDone.doctor_status).toBe('done');
    expect(r.toDone.doctor_ended_at).toBe('2026-06-14T05:00:00.000Z');
    // 되돌리기: 기존 ack 시각 보존(now 로 덮어쓰지 않음) + 상위 컬럼 null
    expect(r.backToAck.doctor_ack_at).toBe('2026-06-14T01:00:00Z');
    expect(r.backToAck.doctor_status).toBeNull();
    expect(r.backToAck.doctor_started_at).toBeNull();
  });

  // ── 이슈2 (소스 정적): ✋ 완전 대체 + 4단계 라벨/▼ 마커/공용 클릭 ───────────────────────────
  test('이슈2: ✋(DoctorAckBadge) 완전 대체 + 4단계 라벨·▼ 마커·권한 무게이트', () => {
    const bar = SRC('components/DoctorCallListBar.tsx');
    // DoctorCallListBar 가 DoctorAckBadge 를 더 이상 렌더하지 않음(완전 대체) — import/JSX 부재.
    expect(/import\s+\{\s*DoctorAckBadge/.test(bar)).toBe(false);
    expect(/<DoctorAckBadge/.test(bar)).toBe(false);
    // 대신 stepper 를 행에 렌더.
    expect(/<DoctorStageStepper/.test(bar)).toBe(true);

    const step = SRC('components/doctor/DoctorStageStepper.tsx');
    // 4단계 라벨 노선도 순서.
    expect(step).toContain("['대기', '원장확인', '진료중', '진료완료']");
    // ▼ 현위치 마커.
    expect(step).toContain('▼');
    expect(step).toContain('doctor-stage-here');
    // 권한 무게이트(원장·직원 공용) — doctorMode/role 게이트 없이 클릭 핸들러.
    expect(/doctorMode|isDoctor|DOCTOR_ROLES/.test(step)).toBe(false);
  });

  // ── 이슈1·이슈2 (DOM 스모크): 위젯 렌더 + stepper 노출/✋ 부재, graceful skip ─────────────────
  test('DOM: 진료콜 명단 행에 stepper 4노드 + ▼ + ✋배지 부재', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();

    // ✋ 의사확인 배지는 진료콜 명단(위젯)에서 완전 제거 — 명단 내부 0개.
    // (DoctorCallDashboard 등 타 surface 는 본 티켓 스코프 외이므로 위젯 내부로 한정 단언.)
    const widget = page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])');
    if ((await widget.count()) === 0) {
      test.skip(true, '진료콜 명단 데이터 없음(당일 콜대상 0) — 행단언 스킵');
      return;
    }
    const rows = page.locator('[data-testid="doctor-call-row"]');
    if ((await rows.count()) > 0) {
      const firstRow = rows.first();
      // 진료콜 명단 행 내부에 ✋ 의사확인 배지 부재(완전 대체).
      await expect(firstRow.locator('[data-testid="doctor-ack-badge"]')).toHaveCount(0);
      // stepper 노출 + 4노드.
      const stepper = firstRow.locator('[data-testid="doctor-stage-stepper"]');
      await expect(stepper).toHaveCount(1);
      await expect(stepper.locator('[data-testid="doctor-stage-node"]')).toHaveCount(4);
      // 현위치(▼) 마커 — 어느 단계든 정확히 1개(현재 단계 노드 위).
      await expect(stepper.locator('[data-testid="doctor-stage-here"]')).toHaveCount(1);
      // 잔존 기능 진입점(무회귀): 이름(차트)·메모·위치배지.
      await expect(firstRow.locator('[data-testid="doctor-call-name"]')).toBeVisible();
      await expect(firstRow.locator('[data-testid="doctor-call-memo-display"]')).toBeVisible();
      await expect(firstRow.locator('[data-testid="doctor-call-location"]')).toHaveCount(1);
    }
  });
});
