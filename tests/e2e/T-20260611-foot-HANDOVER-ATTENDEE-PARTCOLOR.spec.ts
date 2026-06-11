/**
 * T-20260611-foot-HANDOVER-ATTENDEE-PARTCOLOR
 * 인수인계 "오늘 출근 명단" 상담(consultant) 칩 색 = sky → rose 전환 회귀가드.
 *
 * 요청(김주연 총괄): 상담 파트 칩을 하늘(sky)에서 로즈(rose)로 변경.
 *   STAFF_ROLE_CARD_CLASS.consultant: sky → rose (정적 클래스, JIT purge 안전).
 *   코디(yellow)·치료(green)는 유지, 정렬(roleIdx = STAFF_ROLE_ORDER)도 유지.
 *
 * 본 스펙은 색·정렬의 단일 진실원천(status.ts) 자체를 결정적으로 검증한다.
 *   서버/렌더 의존 없는 순수 단위 가드 → 색 회귀를 빌드 단계에서 즉시 잡는다.
 *
 * 커버:
 *   S1. consultant 칩 = rose (sky 토큰 완전 제거)
 *   S2. AC4 회귀가드 — coordinator=yellow / therapist=green 무회귀
 *   S3. 미매칭 역할(director·technician 등) → 중립 slate fallback 무회귀
 *   S4. 정렬 순서(STAFF_ROLE_ORDER) 무회귀 — 상담이 코디·치료보다 앞
 */
import { test, expect } from '@playwright/test';
import { STAFF_ROLE_CARD_CLASS, STAFF_ROLE_ORDER, staffRoleCardClass } from '@/lib/status';

test.describe('T-20260611-foot-HANDOVER-ATTENDEE-PARTCOLOR 상담칩 sky→rose', () => {
  // ── S1. consultant = rose, sky 토큰 제거 ──────────────────────────────────
  test('S1 상담 칩은 rose 색이며 sky 토큰이 없다', () => {
    const cls = staffRoleCardClass('consultant');
    for (const c of ['bg-rose-100', 'text-rose-800', 'border-rose-300']) {
      expect(cls, `consultant 칩에 ${c}`).toContain(c);
    }
    expect(cls, 'consultant 칩에 sky 토큰 잔존 금지').not.toContain('sky');
    // 직접 매핑도 동일
    expect(STAFF_ROLE_CARD_CLASS.consultant).toBe('bg-rose-100 text-rose-800 border-rose-300');
  });

  // ── S2. AC4 회귀가드 — 코디/치료 무회귀 ──────────────────────────────────
  test('S2 코디=yellow / 치료=green 무회귀', () => {
    expect(staffRoleCardClass('coordinator')).toBe('bg-yellow-100 text-yellow-800 border-yellow-300');
    expect(staffRoleCardClass('therapist')).toBe('bg-green-100 text-green-800 border-green-300');
  });

  // ── S3. 미매칭 역할 → 중립 fallback 무회귀 ────────────────────────────────
  test('S3 director·technician·미지정 → 중립 slate fallback', () => {
    const fallback = 'bg-slate-100 text-slate-700 border-slate-300';
    for (const role of ['director', 'technician', '', 'unknown']) {
      expect(staffRoleCardClass(role), `role="${role}" fallback`).toBe(fallback);
    }
  });

  // ── S4. 정렬 순서 무회귀 (roleIdx 근거) ───────────────────────────────────
  test('S4 STAFF_ROLE_ORDER — 상담이 코디·치료보다 앞', () => {
    const idx = (r: string) => STAFF_ROLE_ORDER.indexOf(r as never);
    expect(idx('consultant')).toBeGreaterThanOrEqual(0);
    expect(idx('consultant')).toBeLessThan(idx('coordinator'));
    expect(idx('coordinator')).toBeLessThan(idx('therapist'));
  });
});
