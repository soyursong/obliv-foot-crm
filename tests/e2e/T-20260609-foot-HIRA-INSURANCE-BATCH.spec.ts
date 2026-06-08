/**
 * E2E spec — T-20260609-foot-HIRA-INSURANCE-BATCH Phase2
 * HIRA 약제급여목록 → prescription_codes 급여상태 매핑·병합 순수 로직 회귀.
 *
 * 검증:
 *   AC2 매핑/정규화 — HIRA 급여구분 텍스트 → insurance_status enum (normalizeHiraStatus).
 *   AC3 우선순위    — manual override 보존 vs hira 자동갱신 (resolveInsuranceMerge).
 *   안전 — 인식 불가 상태/삭제 오판 방지(부재≠삭제), 동일상태 noop.
 *
 * 배치(scripts/hira_insurance_sync.mjs)는 이 canonical 모듈의 JS 미러를 사용하므로,
 * 본 spec 이 정본 규칙을 고정하면 배치 동작도 함께 회귀된다.
 */
import { test, expect } from '@playwright/test';
import {
  normalizeHiraStatus,
  resolveInsuranceMerge,
  emptyTally,
  applyDecisionToTally,
} from '../../src/lib/hiraInsurance';

// ═══════════════════════════════════════════════════════════════════════════
// 1) normalizeHiraStatus — AC2 급여구분 텍스트 정규화
// ═══════════════════════════════════════════════════════════════════════════
test.describe('HIRA 급여구분 정규화(AC2)', () => {
  test('빈값/null/공백 → covered (급여목록 존재 = 급여)', () => {
    expect(normalizeHiraStatus('')).toBe('covered');
    expect(normalizeHiraStatus(null)).toBe('covered');
    expect(normalizeHiraStatus(undefined)).toBe('covered');
    expect(normalizeHiraStatus('   ')).toBe('covered');
  });

  test('급여/등재/정상/유지 → covered', () => {
    expect(normalizeHiraStatus('급여')).toBe('covered');
    expect(normalizeHiraStatus('등재')).toBe('covered');
    expect(normalizeHiraStatus('정상')).toBe('covered');
    expect(normalizeHiraStatus('유지')).toBe('covered');
  });

  test('비급여/전액본인/100분의100 → non_covered', () => {
    expect(normalizeHiraStatus('비급여')).toBe('non_covered');
    expect(normalizeHiraStatus('전액본인부담')).toBe('non_covered');
    expect(normalizeHiraStatus('100/100')).toBe('non_covered');
    expect(normalizeHiraStatus('100분의100')).toBe('non_covered');
  });

  test('급여삭제/삭제/등재취소/경과조치종료/말소 → deleted', () => {
    expect(normalizeHiraStatus('급여삭제')).toBe('deleted');
    expect(normalizeHiraStatus('삭제')).toBe('deleted');
    expect(normalizeHiraStatus('등재취소')).toBe('deleted');
    expect(normalizeHiraStatus('경과조치종료')).toBe('deleted');
    expect(normalizeHiraStatus('등재말소')).toBe('deleted');
  });

  test('급여기준변경/기준변경/사용범위변경/적응증변경 → criteria_changed', () => {
    expect(normalizeHiraStatus('급여기준변경')).toBe('criteria_changed');
    expect(normalizeHiraStatus('기준변경')).toBe('criteria_changed');
    expect(normalizeHiraStatus('사용범위변경')).toBe('criteria_changed');
    expect(normalizeHiraStatus('적응증변경')).toBe('criteria_changed');
  });

  test('인식 불가 텍스트 → null (함부로 차단상태로 바꾸지 않음 = 안전)', () => {
    expect(normalizeHiraStatus('알수없는값')).toBeNull();
    expect(normalizeHiraStatus('xyz')).toBeNull();
  });

  test('공백/줄바꿈 섞인 표기도 정규화', () => {
    expect(normalizeHiraStatus(' 비 급 여 ')).toBe('non_covered');
    expect(normalizeHiraStatus('급여\n삭제')).toBe('deleted');
  });

  // 차단상태 우선순위: 삭제 토큰이 '급여기준변경'보다 먼저 매칭 — 명시 검증
  test('"급여삭제"는 deleted(우선) — covered 로 흡수되지 않음', () => {
    expect(normalizeHiraStatus('급여삭제')).toBe('deleted');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) resolveInsuranceMerge — AC3 우선순위(수동 override 보존)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('급여상태 병합 우선순위(AC3)', () => {
  test('manual + 값 있음 → skip_manual (HIRA 자동갱신이 덮지 않음)', () => {
    const d = resolveInsuranceMerge(
      { insurance_status: 'covered', insurance_status_source: 'manual' },
      'non_covered',
      false,
    );
    expect(d.action).toBe('skip_manual');
    expect(d.nextStatus).toBeNull();
  });

  test('manual + 값 있음 + forceOverwriteManual=true → update (강제 덮어쓰기)', () => {
    const d = resolveInsuranceMerge(
      { insurance_status: 'covered', insurance_status_source: 'manual' },
      'non_covered',
      true,
    );
    expect(d.action).toBe('update');
    expect(d.nextStatus).toBe('non_covered');
  });

  test('source=hira 기존값 → update (자동갱신 대상)', () => {
    const d = resolveInsuranceMerge(
      { insurance_status: 'covered', insurance_status_source: 'hira' },
      'deleted',
      false,
    );
    expect(d.action).toBe('update');
    expect(d.nextStatus).toBe('deleted');
  });

  test('미설정(NULL) → update (신규 채움)', () => {
    const d = resolveInsuranceMerge(
      { insurance_status: null, insurance_status_source: null },
      'covered',
      false,
    );
    expect(d.action).toBe('update');
    expect(d.nextStatus).toBe('covered');
  });

  test('source=manual 이지만 값이 NULL → update (보존할 수동값 없음)', () => {
    const d = resolveInsuranceMerge(
      { insurance_status: null, insurance_status_source: 'manual' },
      'covered',
      false,
    );
    expect(d.action).toBe('update');
    expect(d.nextStatus).toBe('covered');
  });

  test('동일 상태 → noop (불필요한 쓰기 없음)', () => {
    const d = resolveInsuranceMerge(
      { insurance_status: 'covered', insurance_status_source: 'hira' },
      'covered',
      false,
    );
    expect(d.action).toBe('noop');
  });

  test('HIRA 상태 null(인식불가) → skip_invalid (절대 변경 안 함 = 안전)', () => {
    const d = resolveInsuranceMerge(
      { insurance_status: 'covered', insurance_status_source: 'hira' },
      null,
      false,
    );
    expect(d.action).toBe('skip_invalid');
    expect(d.nextStatus).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) tally 집계 — 배치 통계(insurance_sync_runs 컬럼) 정합
// ═══════════════════════════════════════════════════════════════════════════
test.describe('동기화 집계(SyncTally)', () => {
  test('action별 카운터 반영', () => {
    const t = emptyTally();
    applyDecisionToTally(t, 'update');
    applyDecisionToTally(t, 'update');
    applyDecisionToTally(t, 'skip_manual');
    applyDecisionToTally(t, 'noop');
    applyDecisionToTally(t, 'skip_invalid');
    expect(t.updated).toBe(2);
    expect(t.skipped_manual).toBe(1);
    expect(t.skipped_nochange).toBe(2); // noop + skip_invalid
  });
});
