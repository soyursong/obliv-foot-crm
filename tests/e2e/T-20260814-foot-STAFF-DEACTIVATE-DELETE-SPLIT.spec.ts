/**
 * T-20260814-foot-STAFF-DEACTIVATE-DELETE-SPLIT — 직원 '비활성' vs '삭제' 분리 로직 검증
 *   (DA CONSULT-REPLY MSG-20260814-221208-dpnm 반영 — soft-delete single-axis 재작성)
 *
 * 요청(현장): "비활성/삭제 기능 구분. 테스트로 등록된 거 깔끔하게 삭제. 비활성/삭제 버튼 각각."
 *   · 비활성 = 접근/로그인 차단 + 데이터 보존 (staff.active=false, 가역 일시중단, 기존 경로 재사용).
 *   · 삭제   = 목록/드롭다운에서 제거 (staff.deleted_at 스탬프, soft-delete, 비파괴).
 *             client `.delete()` hard-delete = REJECT-as-mechanism. staff 행 물리 보존 → FK·이력 무손상.
 *             zero-ref 테스트계정도 uniform soft-delete(참조 유무로 hard/soft 분기 금지) → 참조 census 불요.
 *   · 요구사항#6(색상 명시 스펙): 비활성 = 회색(가역·주의) / 삭제 = 빨간색 계열(destructive).
 *
 * mechanism = app-level(순수 payload/술어/rows-affected 로직) + deleted_at ADD COLUMN(ADDITIVE DDL).
 *   이 spec 은 soft-delete payload 생성·read-path 술어 parity·rows-affected 판정(silent write-failure 금지)의
 *   순수 로직 검증(page/auth/server 불요).
 *
 * 검증축:
 *   (A) soft-delete payload — deleted_at(ISO)·deleted_by·deleted_reason·active=false 정합.
 *   (B) read-path 술어 parity — 활성 직원 술어 = 'deleted_at IS NULL' 통일(삭제=목록제거·DB보존).
 *   (C) rows-affected 판정 — 0-row(RLS 거부/이미삭제) 를 '성공' 오인 차단(Cross-CRM Write Rows-Affected 표준).
 *   (D) 비파괴 불변식 — payload 에 물리 DELETE 신호 없음(deleted_at 스탬프만·hard-delete 금지).
 */
import { test, expect } from '@playwright/test';
import {
  ACTIVE_STAFF_PREDICATE,
  DEFAULT_DELETE_REASON,
  buildStaffSoftDeletePatch,
  interpretSoftDeleteResult,
} from '../../src/lib/staffSoftDelete';

test.describe('T-20260814 STAFF-DEACTIVATE-DELETE-SPLIT — soft-delete payload', () => {
  // ── (A) soft-delete payload ──────────────────────────────────
  test('A1: deleted_at = 삭제 시각 ISO 타임스탬프', () => {
    const now = new Date('2026-08-14T13:00:00.000Z');
    const patch = buildStaffSoftDeletePatch('uid-1', { now });
    expect(patch.deleted_at).toBe('2026-08-14T13:00:00.000Z');
  });

  test('A2: deleted_by = 수행자 uid (감사)', () => {
    expect(buildStaffSoftDeletePatch('uid-9').deleted_by).toBe('uid-9');
    // 세션 profile 부재 시 null 허용(감사 미상)
    expect(buildStaffSoftDeletePatch(null).deleted_by).toBeNull();
  });

  test('A3: active=false 동반 — 삭제 직원은 접근·로그인도 차단', () => {
    expect(buildStaffSoftDeletePatch('uid-1').active).toBe(false);
  });

  test('A4: deleted_reason — 미입력 시 기본 마커, 입력 시 트림 반영', () => {
    expect(buildStaffSoftDeletePatch('uid-1').deleted_reason).toBe(DEFAULT_DELETE_REASON);
    expect(buildStaffSoftDeletePatch('uid-1', { reason: '  ' }).deleted_reason).toBe(DEFAULT_DELETE_REASON);
    expect(buildStaffSoftDeletePatch('uid-1', { reason: '  중복 계정 정리 ' }).deleted_reason).toBe('중복 계정 정리');
  });

  // ── (B) read-path 술어 parity ────────────────────────────────
  test('B1: 활성 직원 술어 = deleted_at IS NULL (전 read-path 통일)', () => {
    expect(ACTIVE_STAFF_PREDICATE).toBe('deleted_at IS NULL');
  });

  test('B2: 술어는 active(비활성 축) 를 참조하지 않음 — deleted_at 직교 축', () => {
    // 삭제=목록제거(deleted_at), 비활성=접근차단(active) 는 독립 축.
    // '비활성 포함' 토글(active) 로도 삭제 직원은 재노출되지 않아야 함.
    expect(ACTIVE_STAFF_PREDICATE).not.toContain('active');
  });

  // ── (C) rows-affected 판정 (silent write-failure 금지) ─────────
  test('C1: 1행 반영 → 성공', () => {
    expect(interpretSoftDeleteResult([{ id: 'x' }]).ok).toBe(true);
  });

  test('C2: 0행/null/undefined → 실패(no_rows) — RLS 거부·이미삭제 오성공 차단', () => {
    expect(interpretSoftDeleteResult([]).ok).toBe(false);
    expect(interpretSoftDeleteResult([]).reason).toBe('no_rows');
    expect(interpretSoftDeleteResult(null).ok).toBe(false);
    expect(interpretSoftDeleteResult(undefined).ok).toBe(false);
  });

  // ── (D) 비파괴 불변식 (hard-delete 금지) ──────────────────────
  test('D1: payload = deleted_at 스탬프만 — 물리 삭제 신호 없음', () => {
    const patch = buildStaffSoftDeletePatch('uid-1');
    // soft-delete 는 UPDATE payload. 물리 DELETE 를 함의하는 키가 없어야 함.
    const keys = Object.keys(patch).sort();
    expect(keys).toEqual(['active', 'deleted_at', 'deleted_by', 'deleted_reason']);
  });

  test('D2: deleted_at 은 항상 세팅(NULL 아님) — 목록제거 authority 확정', () => {
    const patch = buildStaffSoftDeletePatch('uid-1');
    expect(patch.deleted_at).toBeTruthy();
    expect(() => new Date(patch.deleted_at).toISOString()).not.toThrow();
  });
});
