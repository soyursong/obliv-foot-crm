/**
 * T-20260818-foot-FOREIGNER-INBOUND-WALKIN-TM-SEQUENCE — [외국인] 태그 환자 TM 순번 라우팅 (순수-로직 가드)
 *
 * 요청 (김주연 총괄, C0ATE5P6JTH):
 *   "2번차트에서 [외국인]으로 잡힌 환자는 인바운드/워크인 이여도 동일하게 TM 순번으로 넣어줘"
 *
 * 현장용어 → 코드 매핑(dev-foot 확정):
 *   · "2번차트 순번 배정"  = 상담 자동배정(maybeAutoAssign) 라우팅. primary substrate = deriveAssignLeadSource.
 *   · "TM 순번"           = leadSource==='TM' → pickTmConsultant(전일휴무 기본순번 턴 + 슬롯 랭킹투영 skip + 지속 커서).
 *   · "[외국인] 태그"      = customers.is_foreign (boolean, read-only).
 *
 * 검증 축(auth/browser 불요 결정론 unit — deriveAssignLeadSource 순수 함수 + deriveConsultAxis 무접촉):
 *   · AC1  외국인 + 인바운드/워크인/네이버/지인소개/공홈 → 유입경로 무관 TM 라우팅.
 *   · AC2  외국인 + TM → TM (결과 동일 = 회귀 없음).
 *   · AC3  비외국인(false/null/undefined) → 기존 visit_route 매핑 그대로 (회귀 없음).
 *   · AC4  외국인 + 재진(returning) → null (재진은 전략 미적용·상담 재진 skip 경계 → TM 강제 안 함).
 *   · AC5  집계/audit 축(deriveConsultAxis)은 is_foreign 무접촉 → 외국인의 유입경로별 집계 라벨 유지(CEO gate 경계, 회귀0).
 */
import { test, expect } from '@playwright/test';
import { deriveAssignLeadSource } from '../../src/lib/assignmentStrategy';
import { deriveConsultAxis } from '../../src/lib/autoAssign';

test.describe('T-20260818 외국인 TM 순번 라우팅 — deriveAssignLeadSource(is_foreign)', () => {
  // ── AC1: 외국인 + 비TM 유입경로 전부 → TM 강제 라우팅 ─────────────────────────
  test('AC1 — 외국인이면 인바운드/워크인/네이버/지인소개/공홈 무관 TM 순번 레일', () => {
    expect(deriveAssignLeadSource({ visit_route: '인바운드', is_foreign: true })).toBe('TM');
    expect(deriveAssignLeadSource({ visit_route: '워크인', is_foreign: true })).toBe('TM');
    expect(deriveAssignLeadSource({ visit_route: '네이버', is_foreign: true })).toBe('TM');
    expect(deriveAssignLeadSource({ visit_route: '지인소개', is_foreign: true })).toBe('TM');
    expect(deriveAssignLeadSource({ visit_route: '공홈', is_foreign: true })).toBe('TM');
    // lead_source 폴백 경로에서도 외국인이면 TM.
    expect(deriveAssignLeadSource({ lead_source: '인바운드', is_foreign: true })).toBe('TM');
    // 유입경로 미상/공란 외국인도 TM(비외국인 WALK_IN 폴백과 대비).
    expect(deriveAssignLeadSource({ is_foreign: true })).toBe('TM');
    expect(deriveAssignLeadSource({ visit_route: '', is_foreign: true })).toBe('TM');
  });

  // ── AC2: 외국인 + TM → TM (회귀 없음) ─────────────────────────────────────────
  test('AC2 — 외국인 + TM 유입은 기존과 동일(TM)', () => {
    expect(deriveAssignLeadSource({ visit_route: 'TM', is_foreign: true })).toBe('TM');
  });

  // ── AC3: 비외국인 → 기존 매핑 그대로 (회귀 없음) ──────────────────────────────
  test('AC3 — 비외국인은 유입경로별 기존 governed 매핑 유지(회귀0)', () => {
    // is_foreign=false
    expect(deriveAssignLeadSource({ visit_route: '인바운드', is_foreign: false })).toBe('INBOUND');
    expect(deriveAssignLeadSource({ visit_route: '워크인', is_foreign: false })).toBe('WALK_IN');
    expect(deriveAssignLeadSource({ visit_route: '네이버', is_foreign: false })).toBe('NAVER');
    expect(deriveAssignLeadSource({ visit_route: '지인소개', is_foreign: false })).toBe('REFERRAL');
    expect(deriveAssignLeadSource({ visit_route: '공홈', is_foreign: false })).toBe('HOMEPAGE');
    // is_foreign 미지정(undefined) — 기존 호출부 시그니처 하위호환.
    expect(deriveAssignLeadSource({ visit_route: '인바운드' })).toBe('INBOUND');
    expect(deriveAssignLeadSource({ visit_route: '워크인' })).toBe('WALK_IN');
    // is_foreign=null (DB nullable read) — falsy → 기존 매핑.
    expect(deriveAssignLeadSource({ visit_route: '인바운드', is_foreign: null })).toBe('INBOUND');
    // 레거시/공란 비외국인은 WALK_IN 폴백 보존.
    expect(deriveAssignLeadSource({ visit_route: '온라인', is_foreign: false })).toBe('WALK_IN');
    expect(deriveAssignLeadSource({ is_foreign: false })).toBe('WALK_IN');
  });

  // ── AC4: 외국인 + 재진 → null (TM 강제 안 함, 상담 재진 skip 경계) ────────────
  test('AC4 — 외국인이라도 재진(returning)은 null(전략 미적용, TM 강제 없음)', () => {
    expect(deriveAssignLeadSource({ visit_type: 'returning', visit_route: '인바운드', is_foreign: true })).toBeNull();
    expect(deriveAssignLeadSource({ visit_type: 'returning', is_foreign: true })).toBeNull();
    // 비외국인 재진도 기존대로 null(회귀0).
    expect(deriveAssignLeadSource({ visit_type: 'returning', visit_route: '워크인' })).toBeNull();
  });

  // ── AC5: 집계 축(deriveConsultAxis) is_foreign 무접촉 (CEO gate 경계, 회귀0) ──
  test('AC5 — deriveConsultAxis 집계/audit 축은 외국인 여부와 무관(라우팅만 TM, 집계 라벨 유지)', () => {
    // 외국인 + 인바운드라도 집계 축은 '인바운드' 유지(라우팅 TM 강제와 분리).
    expect(deriveConsultAxis({ visit_route: '인바운드' })).toBe('인바운드');
    expect(deriveConsultAxis({ visit_route: '워크인' })).toBe('워크인');
    expect(deriveConsultAxis({ visit_route: 'TM' })).toBe('TM');
    // 재진 판정(365-recency SSOT) 불변.
    expect(deriveConsultAxis({ visit_type: 'returning', visit_route: '인바운드' })).toBe('returning');
  });
});
