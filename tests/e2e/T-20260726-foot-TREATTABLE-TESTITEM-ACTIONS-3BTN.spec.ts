/**
 * E2E Spec — T-20260726-foot-TREATTABLE-TESTITEM-ACTIONS-3BTN (P2, FE-only, db_change=false)
 *
 * 치료테이블 [균검사]/[피검사] 탭 접수 리스트 각 행에 액션 3종 추가: [보류] [신청취소] [재검사].
 *
 * 확정 스펙(2026-07-26 김주연 총괄, MSG-20260726-165316-xaz6) 상태 전이:
 *   신청됨(active)    --[보류]----> 보류중(hold)        : 기존 행 상태 전이
 *   신청됨(active)    --[신청취소]-> 취소됨(cancelled)   : soft-cancel(hard-DELETE 금지)
 *   보류중(hold)      --[재검사]---> 신청됨(active)       : 기존 행 재활성(신규 row 없음)
 *   취소됨(cancelled) --[재검사]---> 신규 접수 row       : request_*_for_customer RPC 재사용
 *   · 보류 해제 = 별도 버튼 없음, [재검사]로 복귀. · 권한 = 권한 A(admin/manager/director)만.
 *
 * 영속 = form_submissions(field_data JSONB) 재사용 — 신규 스키마 0(no-DDL). 접수 체크박스 row 와 별 form_key.
 *
 * 구성:
 *   A. 순수 로직 — examItemStatus 상태맵/행클래스/뱃지메타 + permissions.canActOnExamItem 권한 게이트.
 *   B. 정적 소스 가드 — 두 탭 컴포넌트가 액션·권한게이트·소프트취소(DELETE 금지)·form_submissions 재사용·재검사 하이브리드 구현.
 *
 * 실행: npx playwright test T-20260726-foot-TREATTABLE-TESTITEM-ACTIONS-3BTN.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  examItemRowKey,
  examRowStatusClass,
  EXAM_STATUS_META,
  type ExamItemStatus,
} from '../../src/lib/examItemStatus';
import { canActOnExamItem, EXAM_ITEM_ACTION_ROLES } from '../../src/lib/permissions';

const HERE = dirname(fileURLToPath(import.meta.url));
const KOH_SRC = () => readFileSync(join(HERE, '../../src/components/treatment/ExamTargetsSection.tsx'), 'utf-8');
const BLOOD_SRC = () => readFileSync(join(HERE, '../../src/components/treatment/BloodDailyListSection.tsx'), 'utf-8');
const ACTIONS_SRC = () => readFileSync(join(HERE, '../../src/components/treatment/ExamItemActions.tsx'), 'utf-8');
const STATUS_LIB_SRC = () => readFileSync(join(HERE, '../../src/lib/examItemStatus.ts'), 'utf-8');

// ── A. 순수 로직 ────────────────────────────────────────────────────────────────
test.describe('A. examItemStatus — 상태맵/행표시/뱃지', () => {
  test('rowKey = customer × 검사신청일 (행 grain 1:1)', () => {
    expect(examItemRowKey('c1', '2026-07-26')).toBe('c1__2026-07-26');
    // 동일 환자라도 신청일 다르면 다른 행(일자별 추적).
    expect(examItemRowKey('c1', '2026-07-24')).not.toBe(examItemRowKey('c1', '2026-07-26'));
  });

  test('active = 오버레이 없음 / hold·cancelled = 시각 구분(Q3)', () => {
    expect(examRowStatusClass('active')).toBe('');
    // 보류중 = 회색 배경.
    expect(examRowStatusClass('hold')).toContain('muted');
    // 취소됨 = 취소선 + 회색.
    expect(examRowStatusClass('cancelled')).toContain('line-through');
  });

  test('뱃지 메타 — 보류/취소 라벨', () => {
    expect(EXAM_STATUS_META.hold.label).toBe('보류');
    expect(EXAM_STATUS_META.cancelled.label).toBe('취소');
  });

  test('상태 유니온 = active | hold | cancelled 3종', () => {
    const all: ExamItemStatus[] = ['active', 'hold', 'cancelled'];
    expect(all).toHaveLength(3);
  });
});

test.describe('A. 권한 게이트 — canActOnExamItem (권한 A)', () => {
  test('권한 A(admin/manager/director)만 true', () => {
    expect(canActOnExamItem('admin')).toBe(true);
    expect(canActOnExamItem('manager')).toBe(true);
    expect(canActOnExamItem('director')).toBe(true);
  });

  test('하위 권한(치료사/코디/상담/스태프/tm)은 false = 미노출(fail-closed)', () => {
    expect(canActOnExamItem('therapist')).toBe(false);
    expect(canActOnExamItem('coordinator')).toBe(false);
    expect(canActOnExamItem('consultant')).toBe(false);
    expect(canActOnExamItem('staff')).toBe(false);
    expect(canActOnExamItem('tm')).toBe(false);
    expect(canActOnExamItem(null)).toBe(false);
    expect(canActOnExamItem(undefined)).toBe(false);
  });

  test('role-set SSOT = 3역할', () => {
    expect([...EXAM_ITEM_ACTION_ROLES].sort()).toEqual(['admin', 'director', 'manager']);
  });
});

// ── B. 정적 소스 가드 ───────────────────────────────────────────────────────────
test.describe('B. 소스 가드 — 액션 3종 · 권한 · 소프트취소 · form_submissions 재사용', () => {
  test('공용 액션 컴포넌트 — 3종 버튼 노출 + 상태별 분기', () => {
    const src = ACTIONS_SRC();
    expect(src).toMatch(/hold-btn/);
    expect(src).toMatch(/cancel-btn/);
    expect(src).toMatch(/retest-btn/);
    // 보류/신청취소 = active 상태에서만, 재검사 = 非active 에서만(확정 상태전이 표).
    expect(src).toMatch(/status === 'active'/);
    expect(src).toMatch(/status !== 'active'/);
  });

  test('상태 라이브러리 — form_submissions field_data 재사용(신규 스키마 0) + soft(item_status)', () => {
    const src = STATUS_LIB_SRC();
    expect(src).toMatch(/from\('form_submissions'\)/);
    expect(src).toMatch(/item_status/);
    // hard-DELETE 금지 — 취소·전이는 INSERT/UPDATE 만.
    expect(src).not.toMatch(/\.delete\(/);
    // template_id NULL 재사용 패턴(LABTAB-SPLIT 계승).
    expect(src).toMatch(/template_id:\s*null/);
  });

  test('[균검사] 탭 — 액션 렌더 + 권한 게이트 + 재검사 하이브리드', () => {
    const src = KOH_SRC();
    expect(src).toMatch(/ExamItemActions/);
    // 권한 A 게이트 — 컬럼·셀 모두 canAct 조건.
    expect(src).toMatch(/canActOnExamItem\(profile\?\.role\)/);
    expect(src).toMatch(/canAct &&/);
    // 재검사 하이브리드: 보류중→재활성(active) / 취소됨→신규 RPC.
    expect(src).toMatch(/cur === 'hold'/);
    expect(src).toMatch(/setItemStatus\(r,\s*'active'\)/);
    expect(src).toMatch(/request_koh_for_customer/);
    // 신청취소 = 확인 다이얼로그(AC3) + soft 전이(cancelled). check_in_services 플래그 clear 안 함(이력 보존).
    expect(src).toMatch(/window\.confirm/);
    expect(src).toMatch(/setItemStatus\(r,\s*'cancelled'\)/);
  });

  test('[피검사] 탭 — 액션 렌더 + 권한 게이트 + 재검사 하이브리드', () => {
    const src = BLOOD_SRC();
    expect(src).toMatch(/ExamItemActions/);
    expect(src).toMatch(/canActOnExamItem\(profile\?\.role\)/);
    expect(src).toMatch(/canAct &&/);
    expect(src).toMatch(/cur === 'hold'/);
    expect(src).toMatch(/request_blood_test_for_customer/);
    expect(src).toMatch(/window\.confirm/);
    // 별 form_key(접수 체크박스 row 무회귀) — blood_item_action_status.
    expect(src).toMatch(/blood_item_action_status/);
  });

  test('회귀0 — 두 탭 모두 기존 접수/발급 경로 유지', () => {
    const blood = BLOOD_SRC();
    // 선행 LABTAB-BLOODLIST-4FIX 접수 체크박스 form_key 유지.
    expect(blood).toMatch(/blood_reception_daily/);
    // 업로드(#2/#3) 버튼 유지.
    expect(blood).toMatch(/blood-upload-btn/);
    const koh = KOH_SRC();
    // KOH 발급 경로 유지.
    expect(koh).toMatch(/publish_koh_result/);
    // 수기 추가 경로 유지.
    expect(koh).toMatch(/ManualExamRequestDialog/);
  });
});
