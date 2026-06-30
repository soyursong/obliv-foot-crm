/**
 * T-20260629-foot-HANDOVER-COMPACT-PASTEL
 * 직원 근무 캘린더(/admin/handover) — 출근자 배지/인수인계 카드 컴팩트화 + 파스텔 톤.
 *
 * 요청(김주연 총괄, 6/29): ① 출근자 이름 배지가 크고 진해 줄이 길어짐 → 작게(파스텔),
 *   ② 인수인계 카드 높이 축소. 색은 은은한 파스텔로 바꾸되 파트별 색 구분은 유지.
 *
 * 순수 FE 코스메틱(CSS/스타일). 서버/렌더 의존 없는 소스 레벨 결정적 가드 —
 *   클래스 회귀를 빌드 단계에서 즉시 잡는다.
 *
 * 커버 (AC):
 *   AC1. 출근자 칩 small pill 화 — px-3 py-1.5 rounded-lg shadow → px-2 py-0.5 rounded-full, shadow 제거
 *   AC2. 파스텔 톤 — 역할칩 채도↓(bg-*-50/text-*-700/border-*-200), 파트별 색(rose/yellow/green) 구분 유지,
 *        vivid 색(bg-*-500/600/700 솔리드) 0건
 *   AC3. 인수인계 카드 높이 축소 — space-y-2 p-3 → space-y-1.5 p-2.5
 *   AC4. 회귀가드 — 작성/삭제/수정 testid·핸들러 보존 (data-testid handover-edit/delete/card 유지)
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { STAFF_ROLE_CARD_CLASS, staffRoleCardClass } from '@/lib/status';

const HANDOVER_SRC = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/Handover.tsx'),
  'utf8',
);

test.describe('T-20260629-foot-HANDOVER-COMPACT-PASTEL 컴팩트+파스텔', () => {
  // ── AC1. 출근자 칩 small pill 화 ─────────────────────────────────────────
  test('AC1 출근자 칩 = small pill (px-2 py-0.5 rounded-full, shadow 제거)', () => {
    // 출근자 칩 className 절 추출 (staffRoleCardClass 호출 포함 라인)
    const m = HANDOVER_SRC.match(
      /handover-selected-attendee-chip[\s\S]{0,260}?className=\{`([^`]+)`\}/,
    );
    expect(m, '출근자 칩 className 절을 찾을 수 없음').not.toBeNull();
    const cls = m![1];
    // 컴팩트 토큰 존재
    expect(cls, 'small pill: rounded-full').toContain('rounded-full');
    expect(cls, 'small pill: px-2').toContain('px-2');
    expect(cls, 'small pill: py-0.5').toContain('py-0.5');
    // 큰 칩 토큰 제거
    expect(cls, 'px-3 제거').not.toContain('px-3');
    expect(cls, 'py-1.5 제거').not.toContain('py-1.5');
    expect(cls, 'shadow 제거').not.toContain('shadow');
  });

  // ── AC2. 파스텔 톤 + 파트 구분 유지 ──────────────────────────────────────
  test('AC2 역할칩 파스텔 톤 — bg-*-50/text-*-700/border-*-200, 파트색 구분 유지', () => {
    expect(STAFF_ROLE_CARD_CLASS.consultant).toBe('bg-rose-50 text-rose-700 border-rose-200');
    expect(STAFF_ROLE_CARD_CLASS.coordinator).toBe('bg-yellow-50 text-yellow-700 border-yellow-200');
    expect(STAFF_ROLE_CARD_CLASS.therapist).toBe('bg-green-50 text-green-700 border-green-200');
    // 파트별 색 구분 유지 — 세 칩의 색 계열(hue)이 서로 달라야 함
    const hue = (cls: string) => cls.match(/bg-([a-z]+)-/)?.[1];
    const hues = new Set([
      hue(staffRoleCardClass('consultant')),
      hue(staffRoleCardClass('coordinator')),
      hue(staffRoleCardClass('therapist')),
    ]);
    expect(hues.size, '파트별 색 구분 유지(3색 서로 다름)').toBe(3);
  });

  test('AC2 역할칩에 vivid 솔리드 색(bg-*-500/600/700) 0건', () => {
    for (const cls of Object.values(STAFF_ROLE_CARD_CLASS)) {
      expect(cls, `vivid bg 금지: "${cls}"`).not.toMatch(/bg-[a-z]+-(500|600|700|800|900)\b/);
    }
    // fallback 도 파스텔
    expect(staffRoleCardClass('unknown')).toBe('bg-slate-50 text-slate-600 border-slate-200');
  });

  // ── AC3. 인수인계 카드 높이 축소 ─────────────────────────────────────────
  // ⚠ T-20260630-foot-HANDOVER-BOX-COMPACT-MONO 가 한 단계 더 컴팩트화
  //   (p-2.5→p-2, space-y-1.5→space-y-1, list space-y-1.5→space-y-1)하며 본 AC3 기대치 갱신.
  //   "p-3/space-y-2 같은 큰 토큰 제거 + 더 작은 컴팩트 토큰" 의도는 그대로 보증.
  test('AC3 인수인계 카드 컴팩트 — space-y-1 p-2 (p-3/p-2.5 제거)', () => {
    // handover-card 컨테이너 className 추출
    const m = HANDOVER_SRC.match(
      /data-testid="handover-card"[\s\S]{0,300}?className=\{`([^`]+)`\}/,
    );
    expect(m, 'handover-card className 절을 찾을 수 없음').not.toBeNull();
    const cls = m![1];
    expect(cls, '카드 패딩 축소 p-2').toMatch(/\bp-2\b/);
    expect(cls, '큰 패딩 p-3 제거').not.toMatch(/\bp-3\b/);
    expect(cls, '직전 패딩 p-2.5 제거(추가 축소)').not.toMatch(/\bp-2\.5\b/);
    expect(cls, '카드 내부 간격 축소 space-y-1').toMatch(/\bspace-y-1\b/);
    expect(cls, '큰 간격 space-y-2 제거').not.toMatch(/\bspace-y-2\b/);
    expect(cls, '직전 간격 space-y-1.5 제거(추가 축소)').not.toMatch(/\bspace-y-1\.5\b/);
    // 리스트 컨테이너 간격도 축소(space-y-1)
    expect(HANDOVER_SRC).toMatch(/className="space-y-1" data-testid="handover-list"/);
  });

  // ── AC4. 회귀가드 — 작성/삭제/수정 보존 ──────────────────────────────────
  test('AC4 작성/수정/삭제 핸들러·testid 무회귀', () => {
    expect(HANDOVER_SRC, '카드 testid 유지').toContain('data-testid="handover-card"');
    expect(HANDOVER_SRC, '수정 버튼 testid 유지').toContain('data-testid="handover-edit"');
    expect(HANDOVER_SRC, '삭제 버튼 testid 유지').toContain('data-testid="handover-delete"');
    expect(HANDOVER_SRC, '수정 핸들러 유지').toContain('openEdit(n)');
    expect(HANDOVER_SRC, '삭제 핸들러 유지').toContain('handleDelete(n)');
    // 파트명·작성자·시간 표시 보존 (AC3 가독성)
    expect(HANDOVER_SRC, '파트 라벨 표시 유지').toContain('partLabel(n.part_code)');
    expect(HANDOVER_SRC, '작성자 표시 유지').toContain("n.author_name ?? '직원'");
  });
});
