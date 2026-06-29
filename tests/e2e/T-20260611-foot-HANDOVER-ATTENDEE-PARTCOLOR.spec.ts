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
 *   S5. [FIX 회귀가드] Handover.tsx staff select가 display_name 미포함 —
 *        DB 미존재 컬럼 select 시 PostgREST 400 → roleByName 빈 맵 → 전 역할 slate fallback.
 *        S1~S4(SSOT 단위)는 이 데이터 경로 단절을 못 잡아 false green이었음(근본원인).
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { STAFF_ROLE_CARD_CLASS, STAFF_ROLE_ORDER, staffRoleCardClass } from '@/lib/status';

test.describe('T-20260611-foot-HANDOVER-ATTENDEE-PARTCOLOR 상담칩 sky→rose', () => {
  // ── S1. consultant = rose 계열, sky 토큰 제거 ─────────────────────────────
  //   T-20260629-foot-HANDOVER-COMPACT-PASTEL: 채도↓ 파스텔 톤으로 전환
  //   (bg-rose-100/text-rose-800 → bg-rose-50/text-rose-700). rose 계열·sky 부재 의도는 유지.
  test('S1 상담 칩은 rose(파스텔) 색이며 sky 토큰이 없다', () => {
    const cls = staffRoleCardClass('consultant');
    for (const c of ['bg-rose-50', 'text-rose-700', 'border-rose-200']) {
      expect(cls, `consultant 칩에 ${c}`).toContain(c);
    }
    expect(cls, 'consultant 칩에 sky 토큰 잔존 금지').not.toContain('sky');
    // 직접 매핑도 동일
    expect(STAFF_ROLE_CARD_CLASS.consultant).toBe('bg-rose-50 text-rose-700 border-rose-200');
  });

  // ── S2. AC4 회귀가드 — 코디/치료 무회귀 (파스텔 톤) ───────────────────────
  test('S2 코디=yellow / 치료=green 무회귀 (파스텔)', () => {
    expect(staffRoleCardClass('coordinator')).toBe('bg-yellow-50 text-yellow-700 border-yellow-200');
    expect(staffRoleCardClass('therapist')).toBe('bg-green-50 text-green-700 border-green-200');
  });

  // ── S3. 미매칭 역할 → 중립 fallback 무회귀 (파스텔) ───────────────────────
  test('S3 director·technician·미지정 → 중립 slate fallback', () => {
    const fallback = 'bg-slate-50 text-slate-600 border-slate-200';
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

  // ── S5. [근본원인 FIX 회귀가드] staff select에 display_name 금지 ────────────
  //   staff.display_name 컬럼은 DB 미존재(STAFF-NAME-UNIFY 타입만 추가, 미마이그레이션).
  //   select 포함 시 PostgREST 400(42703) → staffData=null → roleByName 빈 맵 →
  //   출근자 칩 전 역할이 slate fallback(=상담 rose 미반영의 실제 근본원인).
  //   소스 레벨 결정적 가드 — 동일 컬럼 재유입을 빌드 단계에서 즉시 차단.
  test('S5 Handover.tsx staff select가 display_name을 포함하지 않는다', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/Handover.tsx'),
      'utf8',
    );
    // staff 테이블 select(...) 절 추출
    const m = src.match(/from\(['"]staff['"]\)\s*\.\s*select\(\s*['"]([^'"]+)['"]\s*\)/);
    expect(m, "Handover.tsx의 staff select 절을 찾을 수 없음").not.toBeNull();
    expect(
      m![1],
      `staff select에 DB 미존재 컬럼 display_name 포함 금지(400 유발): "${m?.[1]}"`,
    ).not.toContain('display_name');
    // role·name은 칩 색 매핑에 필수 — 누락 회귀 방지
    expect(m![1]).toContain('name');
    expect(m![1]).toContain('role');
  });
});
