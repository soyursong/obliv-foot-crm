/**
 * Unit spec — T-20260822-foot-PROGANALYSIS-EXTRACT-DIRECTOR-GATE-FIX
 *
 * 버그: 진료대시보드>경과분석 탭의 인풋 .md/ZIP 추출 버튼이 canExportCsv=hasOpsAuthority
 *   (admin/manager only) 로만 게이트되어, 대표원장(문지은, role='director',
 *   has_ops_authority 컬럼 미적재)에게 '자기요청' 기능이 본인 화면에서 미노출되었다.
 *   ← 발행(canIssueProgressDocs)은 director 포함, 추출만 배제 = 비대칭 버그.
 *
 * 수정: 추출 노출 게이트 canExtractProgress = canExportCsv || canIssue.
 *   추출(.md/ZIP)은 대표원장 본인 문서작업의 read-only 반출(발행과 동일 계층)이며
 *   대상 데이터는 경과분석 명단에서 이미 열람 중 → 신규 PHI 노출 아님.
 *   전역 hasOpsAuthority(매출/통계/계정)는 무변경(scope 최소).
 *
 * 대상(순수 함수) → playwright 'unit' 프로젝트:
 *   src/lib/permissions.ts : hasOpsAuthority / canIssueProgressDocs
 *
 * 실기기 노출/클릭 확인 = supervisor 갤탭 field-soak(browser_verify, 원장 계정).
 */
import { test, expect } from '@playwright/test';
import {
  hasOpsAuthority,
  canIssueProgressDocs,
  type OpsAuthSubject,
} from '../../src/lib/permissions';

// 컴포넌트 내부 canExtractProgress 와 동일한 합성(SSOT 유지: canExportCsv || canIssue).
function canExtractProgress(subject: OpsAuthSubject): boolean {
  return hasOpsAuthority(subject) || canIssueProgressDocs(subject);
}

test.describe('PROGANALYSIS 추출 게이트 — 대표원장(director) 포함', () => {
  test('RC 재현: 대표원장(director, flag 無)은 hasOpsAuthority=false (구 게이트에서 미노출)', () => {
    const director: OpsAuthSubject = { role: 'director', has_ops_authority: null };
    expect(hasOpsAuthority(director)).toBe(false); // ← 구 canExportCsv 게이트가 원장 배제한 원인
  });

  test('발행 게이트는 이미 director 포함 (비대칭의 반쪽)', () => {
    expect(canIssueProgressDocs({ role: 'director' })).toBe(true);
    expect(canIssueProgressDocs({ role: 'admin' })).toBe(true);
    expect(canIssueProgressDocs({ role: 'manager' })).toBe(true);
  });

  test('수정 후: 대표원장(director)은 경과분석 추출(.md/ZIP) 노출됨', () => {
    expect(canExtractProgress({ role: 'director', has_ops_authority: null })).toBe(true);
  });

  test('admin/manager 는 회귀 없이 계속 추출 노출', () => {
    expect(canExtractProgress({ role: 'admin' })).toBe(true);
    expect(canExtractProgress({ role: 'manager' })).toBe(true);
  });

  test('순수 read 역할(치료사/코디/상담)은 추출 여전히 미노출 (PHI 가드 유지)', () => {
    expect(canExtractProgress({ role: 'therapist' })).toBe(false);
    expect(canExtractProgress({ role: 'coordinator' })).toBe(false);
    expect(canExtractProgress({ role: 'consultant' })).toBe(false);
  });

  test('has_ops_authority=true 명시 계정도 추출 노출 (전환기 호환)', () => {
    expect(canExtractProgress({ role: 'therapist', has_ops_authority: true })).toBe(true);
  });
});
