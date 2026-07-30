/**
 * T-20260730-foot-ASSIGN-FULLSPEC-IMPL (§094v 다.) — 비TM 유입경로 6경로 분리 (Option B) 순수-로직 가드
 *
 * DA CONSULT-REPLY (da_decision_foot_assign_leadsource_6path_split_20260730) = ADDITIVE + GO, Option B
 *   (경로별 governed enum row + 독립 커서). 본 spec = auth/browser 불요 unit(결정론).
 *
 * 검증 축:
 *  · AC1  deriveAssignLeadSource: 6경로 governed 매핑(TM/INBOUND/WALK_IN/NAVER/REFERRAL/HOMEPAGE) — fall-through 제거.
 *  · AC2  네이버/지인소개/공홈 이 워크인(WALK_IN)에 묶이지 않고 각자 독립 lead_source 로 인식.
 *  · AC3  재진(returning) → null(전략 미적용) + 매핑 미스(레거시 '온라인'/'기타'/공란) → WALK_IN 안전 폴백(회귀0).
 *  · AC4  VISIT_ROUTE_OPTIONS(현장 6종 드롭다운) 전 값이 매핑에 존재(누락 0) + 정본 표기=영대문자(한글 주입 0).
 *  · AC5  CEO-게이트 경계(T-20260713): deriveConsultAxis 의 재진 365-recency·워크인 집계 축은 무접촉
 *         (returning → 'returning', 네이버 → 집계 축 '워크인' 유지 = 커서 분리는 lead_source 계층에서만 발생).
 *  · AC6  AssignLeadSource 타입 6값(집합) + DB CHECK 6값 적용(Management API, 토큰 있을 때만).
 */
import { test, expect } from '@playwright/test';
import {
  deriveAssignLeadSource,
  mapAxisToLeadSource,
} from '../../src/lib/assignmentStrategy';
import { deriveConsultAxis } from '../../src/lib/autoAssign';
import { VISIT_ROUTE_OPTIONS, VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE } from '../../src/lib/types';

test.describe('T-20260730 6경로 분리 — deriveAssignLeadSource governed 매핑', () => {
  // ── AC1/AC2: 6경로 결정적 매핑, 네이버/지인소개/공홈 워크인 미결합 ──────────────
  test('AC1/AC2 — visit_route 6종이 각자 governed lead_source 로 결정적 매핑', () => {
    expect(deriveAssignLeadSource({ visit_route: 'TM' })).toBe('TM');
    expect(deriveAssignLeadSource({ visit_route: '인바운드' })).toBe('INBOUND');
    expect(deriveAssignLeadSource({ visit_route: '워크인' })).toBe('WALK_IN');
    expect(deriveAssignLeadSource({ visit_route: '네이버' })).toBe('NAVER');
    expect(deriveAssignLeadSource({ visit_route: '지인소개' })).toBe('REFERRAL');
    expect(deriveAssignLeadSource({ visit_route: '공홈' })).toBe('HOMEPAGE');

    // ★ 핵심: 세 신경로가 워크인(WALK_IN)으로 접히지 않고 서로 다른 값 → 독립 커서/정책 라우팅 근거.
    const navers = deriveAssignLeadSource({ visit_route: '네이버' });
    const refer = deriveAssignLeadSource({ visit_route: '지인소개' });
    const home = deriveAssignLeadSource({ visit_route: '공홈' });
    expect(new Set([navers, refer, home, 'WALK_IN']).size).toBe(4); // 4개 서로 다른 값
  });

  // ── AC3: 재진 null + 매핑 미스/공란 WALK_IN 폴백 ─────────────────────────────────
  test('AC3 — 재진→null(전략 미적용), 미상/공란→WALK_IN 안전 폴백(회귀0)', () => {
    expect(deriveAssignLeadSource({ visit_type: 'returning', visit_route: '네이버' })).toBeNull();
    expect(deriveAssignLeadSource({ visit_type: 'returning' })).toBeNull();
    // 레거시/미상 값은 기존 '워크인' 수렴 보존.
    expect(deriveAssignLeadSource({ visit_route: '온라인' })).toBe('WALK_IN');
    expect(deriveAssignLeadSource({ lead_source: '기타' })).toBe('WALK_IN');
    expect(deriveAssignLeadSource({})).toBe('WALK_IN');
    expect(deriveAssignLeadSource({ visit_route: '', lead_source: '' })).toBe('WALK_IN');
    // visit_route 우선, 없으면 lead_source 폴백.
    expect(deriveAssignLeadSource({ visit_route: null, lead_source: '네이버' })).toBe('NAVER');
  });

  // ── AC4: 현장 드롭다운 6종 전부 매핑 존재 + 정본 영대문자 ─────────────────────────
  test('AC4 — VISIT_ROUTE_OPTIONS 전 값 매핑 존재(누락 0) + governed 영대문자 표기', () => {
    for (const opt of VISIT_ROUTE_OPTIONS) {
      expect(VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE[opt]).toBeTruthy();
    }
    const targets = Object.values(VISIT_ROUTE_TO_ASSIGN_LEAD_SOURCE);
    // 정본 = 영대문자 governed enum(한글 값 주입 0).
    for (const t of targets) {
      expect(t).toMatch(/^[A-Z_]+$/);
    }
    expect(new Set(targets)).toEqual(new Set(['TM', 'INBOUND', 'WALK_IN', 'NAVER', 'REFERRAL', 'HOMEPAGE']));
  });

  // ── AC5: CEO-게이트 경계 — deriveConsultAxis(재진 recency·워크인 집계) 무접촉 ────────
  test('AC5 — deriveConsultAxis 집계 축·재진 recency 로직 무접촉(CEO gate 경계)', () => {
    // 재진 판정(365-recency SSOT) 그대로.
    expect(deriveConsultAxis({ visit_type: 'returning', visit_route: '네이버' })).toBe('returning');
    // 네이버/지인소개/공홈 은 여전히 집계 축(display/counting)에선 '워크인'으로 수렴 =
    //   경로 분리는 lead_source(라우팅) 계층에서만 발생, 집계/audit 축은 무변경(회귀0).
    expect(deriveConsultAxis({ visit_route: '네이버' })).toBe('워크인');
    expect(deriveConsultAxis({ visit_route: '지인소개' })).toBe('워크인');
    expect(deriveConsultAxis({ visit_route: '공홈' })).toBe('워크인');
    // 기존 3축은 불변.
    expect(deriveConsultAxis({ visit_route: 'TM' })).toBe('TM');
    expect(deriveConsultAxis({ visit_route: '인바운드' })).toBe('인바운드');
    expect(deriveConsultAxis({ visit_route: '워크인' })).toBe('워크인');
  });

  // ── AC6(보조): axis 기반 보조 매핑도 6값 codify(호환) ────────────────────────────
  test('AC6a — mapAxisToLeadSource 6값 codify(보조 매핑) + 미상 null', () => {
    expect(mapAxisToLeadSource('네이버')).toBe('NAVER');
    expect(mapAxisToLeadSource('지인소개')).toBe('REFERRAL');
    expect(mapAxisToLeadSource('공홈')).toBe('HOMEPAGE');
    expect(mapAxisToLeadSource('returning')).toBeNull();
    expect(mapAxisToLeadSource(null)).toBeNull();
  });

  // ── AC6(DB): CHECK 6값 적용 실측(Management API 토큰 있을 때만) ──────────────────
  test('AC6b — DB CHECK 6값(NAVER/REFERRAL/HOMEPAGE) 적용 실측', async () => {
    const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
    if (!TOKEN) test.skip(true, 'SUPABASE_ACCESS_TOKEN 부재(로컬/CI 무토큰) → DB 실측 skip');
    const REF = 'rxlomoozakkjesdqjtvd';
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
                WHERE conname IN ('assignment_leadsource_policy_lead_source_check',
                                  'assignment_pointer_state_lead_source_check');`,
      }),
    });
    expect(r.ok).toBeTruthy();
    const rows = (await r.json()) as { def: string }[];
    expect(rows.length).toBe(2);
    for (const row of rows) {
      for (const v of ['TM', 'INBOUND', 'WALK_IN', 'NAVER', 'REFERRAL', 'HOMEPAGE']) {
        expect(row.def).toContain(v);
      }
    }
  });
});
