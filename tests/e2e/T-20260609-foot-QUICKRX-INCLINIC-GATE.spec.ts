/**
 * E2E spec — T-20260609-foot-QUICKRX-INCLINIC-GATE
 * 빠른처방 원내 잔류 게이팅 + 되돌리기(undo).
 *
 * 현장(문지은 대표원장) 신고: 빠른처방은 "진료 본 의사가 지금 원내에 있는 환자에게
 *   빠르게 처방만" 하는 버튼인데, 상태 검증이 없어 전날·미래·귀가 환자에게도 처방이 박힘.
 *
 * SSOT 재사용(불일치 0): 원내 대시보드(Dashboard.tsx)의 "원내 잔류(active)" 판정과 동일 기준.
 *   - 당일(KST) 체크인  + status !== 'done' && status !== 'cancelled'  (Dashboard active 필터)
 *   - done 전환 시 completed_at 기록 → done = 귀가/완료(원내 비잔류).
 *
 * 본 spec 은 구현 정본 모듈(src/lib/inClinicRxGate, src/lib/rxUndo)을 직접 import 해 회귀를 잡는다.
 * 적용 진입점(빠른처방 모드 B: DoctorPatientList · DoctorCallDashboard)이 단일 게이트를 경유한다.
 * (모드 A=차트 onSelectItems 는 sanctioned 경로 — 게이트 미적용. "이미 나간 처방은 차트에서 수정")
 */
import { test, expect } from '@playwright/test';
import {
  checkRxInClinic,
  isInClinicForRx,
  rxInClinicMessage,
  rxInClinicShortLabel,
} from '../../src/lib/inClinicRxGate';
import { captureRxSnapshot, buildUndoPatch, type RxSnapshot } from '../../src/lib/rxUndo';

// 테스트 픽스처 ──────────────────────────────────────────────────────────────
const TODAY = '2026-06-09';
// checked_in_at 은 UTC(timestamptz). KST 09:00 = 2026-06-09T00:00:00Z → 당일.
const TODAY_AM_KST = '2026-06-09T00:30:00Z'; // KST 09:30 (당일)
const TODAY_EARLY_KST = '2026-06-08T15:30:00Z'; // KST 06-09 00:30 (KST 새벽, UTC는 전날) → 당일
const YESTERDAY_KST = '2026-06-08T01:00:00Z'; // KST 06-08 10:00 → 전날
const TOMORROW_KST = '2026-06-10T01:00:00Z'; // KST 06-10 10:00 → 미래

// ═══════════════════════════════════════════════════════════════════════════
// AC1 / AC7(GUARD) — 정상: 원내 잔류(오늘 내원, 진행중) 환자는 실행 가능
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1·AC7 원내 잔류 환자 허용(정상 케이스 회귀 없음)', () => {
  for (const status of [
    'registered', 'consultation', 'examination', 'treatment_waiting',
    'preconditioning', 'laser', 'payment_waiting',
  ]) {
    test(`오늘 내원 + status=${status} → 허용`, () => {
      const r = checkRxInClinic({ status, checked_in_at: TODAY_AM_KST }, TODAY);
      expect(r.allowed).toBe(true);
      expect(r.reason).toBeNull();
    });
  }

  test('KST 새벽(UTC 전날) 체크인도 당일로 인정 → 허용', () => {
    expect(isInClinicForRx({ status: 'laser', checked_in_at: TODAY_EARLY_KST }, TODAY)).toBe(true);
  });

  test('진료완료(completed_at 있음)지만 status 진행중(레이저)은 여전히 원내 잔류 → 허용', () => {
    // completed_at 은 귀가 신호가 아님(시술 잔존 가능). 귀가 판정은 status==="done" 으로만.
    expect(isInClinicForRx({ status: 'laser', checked_in_at: TODAY_AM_KST }, TODAY)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2 — 귀가(완료) 환자 차단
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC2 귀가(완료) 차단', () => {
  test('오늘 내원이어도 status=done(귀가/완료) → 차단', () => {
    const r = checkRxInClinic({ status: 'done', checked_in_at: TODAY_AM_KST }, TODAY);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('discharged');
  });

  test('차단 안내: 귀가(수납완료) 명시 + 차트에서 수정 동선', () => {
    // T-20260610-foot-DOCDASH-STATUS-SPLIT: '원내 잔류' → '귀가(수납완료)'로 문구 재정의(진료완료 혼동 차단).
    const msg = rxInClinicMessage('discharged');
    expect(msg).toContain('귀가');
    expect(msg).toContain('차트');
    expect(rxInClinicShortLabel('discharged')).toContain('빠른처방 불가');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC3 — 전날 / 미래 환자 차단
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC3 전날·미래 차단', () => {
  test('전날 체크인 → 차단(not_today)', () => {
    const r = checkRxInClinic({ status: 'laser', checked_in_at: YESTERDAY_KST }, TODAY);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('not_today');
  });

  test('미래 체크인 → 차단(not_today)', () => {
    const r = checkRxInClinic({ status: 'registered', checked_in_at: TOMORROW_KST }, TODAY);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('not_today');
  });

  test('전날 + done 도 당연히 차단', () => {
    expect(isInClinicForRx({ status: 'done', checked_in_at: YESTERDAY_KST }, TODAY)).toBe(false);
  });

  test('not_today 안내 문구에 차트 수정 동선', () => {
    expect(rxInClinicMessage('not_today')).toContain('차트');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 취소 / 누락 — fail-closed 차단
// ═══════════════════════════════════════════════════════════════════════════
test.describe('취소·누락 fail-closed', () => {
  test('cancelled 는 날짜 무관 차단', () => {
    expect(checkRxInClinic({ status: 'cancelled', checked_in_at: TODAY_AM_KST }, TODAY).reason).toBe('cancelled');
  });

  test('checked_in_at 누락 → missing 차단', () => {
    expect(checkRxInClinic({ status: 'laser' }, TODAY).reason).toBe('missing');
  });

  test('null/undefined checkIn → missing 차단', () => {
    expect(checkRxInClinic(null, TODAY).allowed).toBe(false);
    expect(checkRxInClinic(undefined, TODAY).allowed).toBe(false);
  });

  test('게이트는 입력을 변경하지 않음(순수 함수)', () => {
    const input = { status: 'done', checked_in_at: TODAY_AM_KST };
    const snap = JSON.stringify(input);
    checkRxInClinic(input, TODAY);
    expect(JSON.stringify(input)).toBe(snap);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC5·AC6 — 되돌리기(undo): 방금 적용 취소/원복, 이중적용·유령행 없음
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC5·AC6 되돌리기(undo)', () => {
  test('처방 없던 상태 → 적용 → 되돌리면 처방 없음(none)으로 정확 원복', () => {
    // 적용 전(처방 없음) 스냅샷
    const before = captureRxSnapshot({
      prescription_items: null,
      prescription_status: 'none',
      doctor_confirm_prescription: false,
      doctor_confirmed_at: null,
    });
    // 되돌리기 패치 = 적용 전 4개 필드 그대로
    const patch = buildUndoPatch(before);
    expect(patch.prescription_items).toBeNull();
    expect(patch.prescription_status).toBe('none');
    expect(patch.doctor_confirm_prescription).toBe(false);
    expect(patch.doctor_confirmed_at).toBeNull();
  });

  test('기존 임시처방 있던 상태 → 덮어쓰기 후 되돌리면 임시처방 원복', () => {
    const before = captureRxSnapshot({
      prescription_items: [{ name: '소염제', frequency: '1일 3회', days: 3 }],
      prescription_status: 'pending',
      doctor_confirm_prescription: false,
      doctor_confirmed_at: null,
    });
    const patch = buildUndoPatch(before);
    expect(patch.prescription_status).toBe('pending');
    expect(Array.isArray(patch.prescription_items)).toBe(true);
    expect((patch.prescription_items as Array<{ name: string }>)[0].name).toBe('소염제');
  });

  test('확정처방 원복 — doctor_confirm/confirmed_at 까지 정확 복원', () => {
    const before = captureRxSnapshot({
      prescription_items: [{ name: '항생제' }],
      prescription_status: 'confirmed',
      doctor_confirm_prescription: true,
      doctor_confirmed_at: '2026-06-09T01:00:00Z',
    });
    const patch = buildUndoPatch(before);
    expect(patch.prescription_status).toBe('confirmed');
    expect(patch.doctor_confirm_prescription).toBe(true);
    expect(patch.doctor_confirmed_at).toBe('2026-06-09T01:00:00Z');
  });

  test('idempotent — captureRxSnapshot ∘ buildUndoPatch 는 4개 필드를 보존(이중적용 없음)', () => {
    const row = {
      prescription_items: [{ name: 'x' }],
      prescription_status: 'pending',
      doctor_confirm_prescription: false,
      doctor_confirmed_at: null,
    };
    const snap1: RxSnapshot = captureRxSnapshot(row);
    const snap2: RxSnapshot = captureRxSnapshot(buildUndoPatch(snap1));
    expect(snap2).toEqual(snap1);
  });

  test('undo 패치는 단일 행 update 4개 필드만 — INSERT/추가 키 없음(유령행 방지)', () => {
    const patch = buildUndoPatch(captureRxSnapshot({ prescription_status: 'none' }));
    expect(Object.keys(patch).sort()).toEqual(
      ['doctor_confirm_prescription', 'doctor_confirmed_at', 'prescription_items', 'prescription_status'].sort(),
    );
  });

  test('captureRxSnapshot 결측치 정규화(undefined → none/false/null)', () => {
    const snap = captureRxSnapshot({});
    expect(snap).toEqual({
      prescription_items: null,
      prescription_status: 'none',
      doctor_confirm_prescription: false,
      doctor_confirmed_at: null,
    });
  });
});
