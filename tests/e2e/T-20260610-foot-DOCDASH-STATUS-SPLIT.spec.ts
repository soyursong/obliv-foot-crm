/**
 * E2E spec — T-20260610-foot-DOCDASH-STATUS-SPLIT
 * 진료완료 ≠ 귀가 상태 분리 (처방 차단 해소).
 *
 * 현장(문지은 대표원장) 정정:
 *   "진료완료랑 귀가랑 같지 않지. 의사가 진료실에서 나온 게 진료완료,
 *    처방전 뽑고 수납서류 다 해야 귀가." → 진료완료 시점에는 처방이 허용돼야 한다.
 *
 * STEP1-B 결정: (b) 무스키마 — 모델이 이미 두 신호를 분리 보유.
 *   · 진료완료 = status_flag='pink' (진료완료 버튼 TREATMENT-COMPLETE-BTN, status 미변경)
 *   · 귀가     = status='done'      (+ 수납완료 dark_gray, Dashboard '완료' 컬럼 이동)
 *   pink와 done(dark_gray)은 단일 status_flag 컬럼의 상호배타 값.
 *
 * 본 spec 은 정본 게이트(src/lib/inClinicRxGate)를 직접 import 해 진료완료/귀가 분리를 회귀로 잡는다.
 * + 회귀 가드(QUICKRX-INCLINIC-GATE / RXCANCEL-DISCHARGE-GATE / DASH-COMPLETE-PAYFLAG-SYNC) 소스 배선 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkRxInClinic,
  isInClinicForRx,
  rxInClinicMessage,
  rxInClinicShortLabel,
} from '../../src/lib/inClinicRxGate';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');

// 픽스처 — checked_in_at 은 UTC(timestamptz). KST 09:30 = 당일.
const TODAY = '2026-06-10';
const TODAY_AM_KST = '2026-06-10T00:30:00Z'; // KST 09:30 (당일)
const YESTERDAY_KST = '2026-06-09T01:00:00Z'; // KST 06-09 10:00 → 전날
const TOMORROW_KST = '2026-06-11T01:00:00Z'; // KST 06-11 10:00 → 미래

// ═══════════════════════════════════════════════════════════════════════════
// AC-1 — 진료완료(pink) 환자는 원내 잔류 → 처방 허용 (핵심 회귀)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-1 진료완료(pink) 처방 허용', () => {
  // 진료완료 버튼은 status를 바꾸지 않으므로 진료 단계 status + pink 조합.
  for (const status of ['examination', 'treatment_waiting', 'preconditioning', 'laser', 'payment_waiting']) {
    test(`오늘 내원 + status=${status} + status_flag=pink(진료완료) → 허용`, () => {
      const r = checkRxInClinic({ status, status_flag: 'pink', checked_in_at: TODAY_AM_KST }, TODAY);
      expect(r.allowed).toBe(true);
      expect(r.reason).toBeNull();
    });
  }

  test('진료완료(pink) 편의 헬퍼도 허용', () => {
    expect(isInClinicForRx({ status: 'examination', status_flag: 'pink', checked_in_at: TODAY_AM_KST }, TODAY)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-2 / AC-3 — 진료완료 ≠ 귀가: 귀가(done) 차단은 유지
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-2·AC-3 귀가(done) 차단 유지', () => {
  test('귀가 = status=done(+수납완료 dark_gray) → 차단(discharged)', () => {
    const r = checkRxInClinic({ status: 'done', status_flag: 'dark_gray', checked_in_at: TODAY_AM_KST }, TODAY);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('discharged');
  });

  test('status_flag 없는 done(레거시)도 귀가로 차단', () => {
    const r = checkRxInClinic({ status: 'done', checked_in_at: TODAY_AM_KST }, TODAY);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('discharged');
  });

  test('차단 안내가 진료완료와 귀가를 구분(귀가/수납완료 명시 + 진료완료 가능 안내 + 차트 동선)', () => {
    const msg = rxInClinicMessage('discharged');
    expect(msg).toContain('귀가');
    expect(msg).toContain('진료완료');
    expect(msg).toContain('차트');
    expect(rxInClinicShortLabel('discharged')).toContain('귀가');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-4 — 전날 / 미래 차단 유지 (INCLINIC-GATE 기존 보호 회귀 0)
//   진료완료(pink)여도 전날/미래면 차단 — 날짜 게이트가 진료완료 허용보다 선행.
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-4 전날·미래 차단 유지(진료완료여도)', () => {
  test('전날 + pink(진료완료) → 차단(not_today)', () => {
    const r = checkRxInClinic({ status: 'examination', status_flag: 'pink', checked_in_at: YESTERDAY_KST }, TODAY);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('not_today');
  });

  test('미래 + pink(진료완료) → 차단(not_today)', () => {
    const r = checkRxInClinic({ status: 'registered', status_flag: 'pink', checked_in_at: TOMORROW_KST }, TODAY);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('not_today');
  });

  test('취소 + pink → 취소가 우선 차단(cancelled)', () => {
    const r = checkRxInClinic({ status: 'cancelled', status_flag: 'pink', checked_in_at: TODAY_AM_KST }, TODAY);
    expect(r.reason).toBe('cancelled');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 무회귀 — status_flag 미제공 시 종전 동작(status 기준만) 보존
// ═══════════════════════════════════════════════════════════════════════════
test.describe('무회귀 — status_flag 미제공 시 종전 동작', () => {
  for (const status of ['registered', 'consultation', 'treatment_waiting', 'laser', 'payment_waiting']) {
    test(`status_flag 없이 status=${status} → 허용(종전과 동일)`, () => {
      expect(checkRxInClinic({ status, checked_in_at: TODAY_AM_KST }, TODAY).allowed).toBe(true);
    });
  }

  test('게이트는 입력을 변경하지 않음(순수 함수)', () => {
    const input = { status: 'examination', status_flag: 'pink', checked_in_at: TODAY_AM_KST };
    const snap = JSON.stringify(input);
    checkRxInClinic(input, TODAY);
    expect(JSON.stringify(input)).toBe(snap);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-5 — 진료대시보드에서 진료완료/귀가 시각 구분 (소스 배선 가드)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-5 진료완료/귀가 시각 구분', () => {
  test('DoctorPatientList StatusCell 이 pink=진료완료 / done=귀가 배지를 구분 렌더', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    expect(src).toContain('function StatusCell');
    expect(src).toContain("statusFlag === 'pink'");
    expect(src).toContain('진료완료');
    expect(src).toContain('귀가');
    // SELECT 에 status_flag 추가(기존 컬럼 확장)
    expect(src).toMatch(/status,\s*status_flag,\s*checked_in_at/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-6(GUARD) — 단일 게이트 SSOT 재사용: 3 dependent 동일 기준
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-6 단일 SSOT — 게이트 컨텍스트(status_flag) 배선', () => {
  test('QuickRxBar 가 checkInFlag 를 게이트에 전달(apply + cancel + UI 선검증)', () => {
    const src = SRC('components/doctor/QuickRxBar.tsx');
    // props 도입
    expect(src).toContain('checkInFlag');
    // 게이트 호출에 status_flag 전달(UI 선검증 + 취소 게이트)
    expect(src).toMatch(/status_flag:\s*checkInFlag/);
    // 적용 시점 DB 재검증 SELECT 에 status_flag 포함
    expect(src).toMatch(/status,\s*status_flag,\s*checked_in_at/);
  });

  test('DoctorPatientList / DoctorCallDashboard 가 checkInFlag 를 주입', () => {
    expect(SRC('components/doctor/DoctorPatientList.tsx')).toContain('checkInFlag={row.status_flag}');
    expect(SRC('components/doctor/DoctorCallDashboard.tsx')).toContain('checkInFlag={checkIn.status_flag}');
  });

  test('정본 게이트가 진료완료(pink) 1급 허용 + status===done 귀가 차단을 한 곳에서 판정', () => {
    const src = SRC('lib/inClinicRxGate.ts');
    expect(src).toContain('export function checkRxInClinic');
    expect(src).toMatch(/flag === 'pink'/);
    expect(src).toMatch(/status === 'done'/);
  });
});
