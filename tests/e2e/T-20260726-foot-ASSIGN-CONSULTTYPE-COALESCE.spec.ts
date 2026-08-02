/**
 * E2E/unit spec — T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN §COALESCE (카운터 파생 view 산식)
 *   (DA da_decision_foot_assign_consulttype_dropdown_20260726 §ADDENDUM 2026-08-03: Option B GO / Option A REJECT.
 *    planner MSG-20260803-072650: scoped_hold 해제 — 카운터 view COALESCE 산식 착수 GO.)
 *
 * 검증 대상 = 배정 카운터 effective 분류 SSOT `effectiveConsultBucket`(src/lib/autoAssign.ts).
 *   effective := COALESCE(assignment_consult_type, recencyAxis→초진/재진 정규화)
 *
 * ★ 카운터 view 산식 SSOT(planner 이대로 구현):
 *   배정(초진)   = COUNT(effective = '초진')                → bucket 'assigned'
 *   배정(재진)   = COUNT(effective IN ('재진','대리상담'))  → bucket 'returning'
 *   당일재상담   = COUNT(assignment_consult_type='당일재상담') → bucket 'sameday' (3축 전부 제외)
 *
 * 핵심 불변식:
 *  - 저장층 재병합 금지: 수동(assignment_consult_type)과 recency(deriveConsultAxis)는 각자 컬럼 독립 병존.
 *    view/read-path 에서 COALESCE 로만 합성(write-time stamp/backfill 없음).
 *  - 수동값(NOT NULL) 우선 — recency 무시. NULL(미오버라이드)일 때만 recency 정규화 소비.
 *  - 당일재상담 = 수동전용값(recency 파생 불가) → COALESCE 대상 아님, 초진/재진/목표 3축 전부 제외.
 *  - totality(HARD-a): deriveConsultAxis 는 total(null 반환 경로 無) → 2-arg COALESCE 로 count-complete,
 *    '미분류' silent-fold 없음(전향 NULL 은 recency 정규화로 '초진' 분류, 은닉 과소카운트 없음).
 *
 * 라이브 데이터 독립 — 순수 함수 진리표로 검증(브라우저 불요).
 */
import { test, expect } from '@playwright/test';
import { effectiveConsultBucket } from '../../src/lib/autoAssign';

// recency 축 도메인(deriveConsultAxis 반환): 'returning' → 재진성, 그 외(초진성) = TM/인바운드/워크인.
const RECENCY_RETURNING = 'returning';
const RECENCY_NEW = '워크인'; // 초진성 축 대표(TM/인바운드/워크인 동치)

test.describe('T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN §COALESCE 카운터 산식', () => {
  test('수동 NULL(미오버라이드): recency 정규화만 소비 (returning→재진 / else→초진)', () => {
    // NULL + recency 재진 → 재진 카운터
    expect(effectiveConsultBucket(null, RECENCY_RETURNING)).toBe('returning');
    expect(effectiveConsultBucket(undefined, RECENCY_RETURNING)).toBe('returning');
    // NULL + recency 초진성(워크인/TM/인바운드) → 초진 카운터
    expect(effectiveConsultBucket(null, RECENCY_NEW)).toBe('assigned');
    expect(effectiveConsultBucket(null, 'TM')).toBe('assigned');
    expect(effectiveConsultBucket(null, '인바운드')).toBe('assigned');
  });

  test('수동값 우선(COALESCE 좌항): recency 와 무관하게 수동 assertion 이 이긴다', () => {
    // 수동 '초진' — recency 가 재진이어도 초진으로 확정
    expect(effectiveConsultBucket('초진', RECENCY_RETURNING)).toBe('assigned');
    // 수동 '재진' — recency 가 초진성이어도 재진으로 확정
    expect(effectiveConsultBucket('재진', RECENCY_NEW)).toBe('returning');
    // 수동 '대리상담' — 재진 카운터에 합류(SSOT: effective IN ('재진','대리상담'))
    expect(effectiveConsultBucket('대리상담', RECENCY_NEW)).toBe('returning');
    expect(effectiveConsultBucket('대리상담', RECENCY_RETURNING)).toBe('returning');
  });

  test('당일재상담: 축① 직접참조 — recency 무관하게 3축 전부 제외(sameday)', () => {
    expect(effectiveConsultBucket('당일재상담', RECENCY_NEW)).toBe('sameday');
    expect(effectiveConsultBucket('당일재상담', RECENCY_RETURNING)).toBe('sameday');
    // sameday 는 assigned/returning 어디에도 속하지 않음(초진·재진 카운터 동시 배제).
    expect(effectiveConsultBucket('당일재상담', RECENCY_NEW)).not.toBe('assigned');
    expect(effectiveConsultBucket('당일재상담', RECENCY_NEW)).not.toBe('returning');
  });

  test('totality(HARD-a): 미상 recency 폴백도 NULL-fold 없이 초진으로 분류(count-complete)', () => {
    // deriveConsultAxis 미상 폴백값('워크인')·빈문자 등 어떤 초진성 축이 와도 초진(과소카운트 은닉 없음).
    expect(effectiveConsultBucket(null, '')).toBe('assigned');
    expect(effectiveConsultBucket(null, '지인소개')).toBe('assigned');
    // 어떤 입력이든 3-state 중 하나로 total 하게 귀결(누락 버킷 없음).
    const buckets = new Set(
      ['초진', '재진', '당일재상담', '대리상담', null].map((m) =>
        effectiveConsultBucket(m as never, RECENCY_NEW),
      ),
    );
    for (const b of buckets) expect(['assigned', 'returning', 'sameday']).toContain(b);
  });
});
