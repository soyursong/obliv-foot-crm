/**
 * E2E spec — T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK
 * 귀가환자 진료대시보드 인플레이스 처방 mutate 차단 누수 close + 차트변경 내부로그(audit).
 *
 * 대표원장(U0ALGAAAJAV) 재요청: "귀가처리 환자는 대시보드에서 처방취소 같은 거 안 되게.
 *   처방수정은 차트 직접 열어서만. 귀가되면 대시보드 인플레이스 처리 막아줘. 다 내부로그."
 *
 * 누수 진단(diff-first):
 *   inClinicRxGate(932a0d7) 의 '판정(checkRxInClinic)'은 SSOT지만 '강제'가 진입점마다 흩어져
 *   apply 만 fail-closed, cancel/confirm 은 DB 게이트 없이 opt-in UI prop 에 의존 → fail-OPEN.
 *   진료대시보드(DoctorCallDashboard)가 RxConfirmedSummary 에 prop 미전달 → 귀가환자 처방취소 통과.
 *
 * 본 spec 은 공통 가드 모듈(src/lib/rxMutationGuard)의 순수부 + 게이트 판정 SSOT 회귀를 잡는다.
 *   · summarizeRxForAudit: PII/RRN 없는 약물요약(건수+용법), 200자 캡.
 *   · rxGateError: IN_CLINIC_GATE 코드 + 현장 안내문구.
 *   · 가드 판정 = checkRxInClinic(SSOT) 그대로 — 귀가(done)/전날/미래/취소 차단, 원내잔류(pink) 허용.
 *   (assert/fetch/log 는 supabase 의존 — 게이트 판정 회귀 + 차단 에러 변환을 핵심으로 검증)
 */
import { test, expect } from '@playwright/test';
import { checkRxInClinic } from '../../src/lib/inClinicRxGate';
import {
  rxGateError,
  summarizeRxForAudit,
  IN_CLINIC_GATE_CODE,
} from '../../src/lib/rxMutationGuard';

// 픽스처 ──────────────────────────────────────────────────────────────────────
const TODAY = '2026-06-11';
const TODAY_KST = '2026-06-11T00:30:00Z'; // KST 09:30 (당일)
const YESTERDAY_KST = '2026-06-10T01:00:00Z'; // KST 06-10 10:00 (전날)

// ═══════════════════════════════════════════════════════════════════════════
// AC-1 — 본체 누수 회귀: 귀가(done) 환자는 게이트가 차단(취소/확정/적용 공통 판정)
//   cancel/confirm 도 이 동일 판정을 거치게 강제 수렴 → 진입점 무관 fail-closed.
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-1 귀가환자 처방 mutate 공통 차단(판정 SSOT)', () => {
  test('귀가(status=done) → 차단(discharged)', () => {
    const g = checkRxInClinic({ status: 'done', checked_in_at: TODAY_KST }, TODAY);
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe('discharged');
  });

  test('귀가(done) + status_flag dark_gray(수납완료) → 차단', () => {
    const g = checkRxInClinic({ status: 'done', status_flag: 'dark_gray', checked_in_at: TODAY_KST }, TODAY);
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe('discharged');
  });

  test('취소(cancelled) → 차단', () => {
    const g = checkRxInClinic({ status: 'cancelled', checked_in_at: TODAY_KST }, TODAY);
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe('cancelled');
  });

  test('전날 내원 → 차단(not_today)', () => {
    const g = checkRxInClinic({ status: 'treatment_waiting', checked_in_at: YESTERDAY_KST }, TODAY);
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe('not_today');
  });

  test('정보 누락 → fail-closed(missing)', () => {
    const g = checkRxInClinic({ status: 'treatment_waiting' }, TODAY);
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe('missing');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-2 — 무회귀: 원내 잔류(진료완료 pink / 진행중)는 허용(처방취소·확정 정상)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-2 원내잔류 허용(무회귀)', () => {
  test('진료완료(status_flag=pink, status 미done) → 허용(아직 귀가 아님)', () => {
    const g = checkRxInClinic({ status: 'treatment_waiting', status_flag: 'pink', checked_in_at: TODAY_KST }, TODAY);
    expect(g.allowed).toBe(true);
    expect(g.reason).toBeNull();
  });

  for (const status of ['registered', 'consultation', 'examination', 'treatment_waiting', 'preconditioning', 'laser', 'payment_waiting']) {
    test(`진행중(${status}, 당일) → 허용`, () => {
      const g = checkRxInClinic({ status, checked_in_at: TODAY_KST }, TODAY);
      expect(g.allowed).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-3 — 차단 시 IN_CLINIC_GATE 에러(코드 + 현장 안내문구). 호출부가 차트 동선 분기.
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-3 rxGateError — 차단 에러 변환', () => {
  test('discharged → code=IN_CLINIC_GATE + 귀가 안내문구', () => {
    const err = rxGateError('discharged');
    expect(err.code).toBe(IN_CLINIC_GATE_CODE);
    expect(err.message).toContain('귀가');
    expect(err.message).toContain('차트');
  });

  test('not_today / missing 도 code 부여', () => {
    expect(rxGateError('not_today').code).toBe(IN_CLINIC_GATE_CODE);
    expect(rxGateError('missing').code).toBe(IN_CLINIC_GATE_CODE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-4 — 차트변경 audit 요약: PII/RRN 없는 약물요약(건수 + 용법). 200자 캡. 빈→'(없음)'.
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-4 summarizeRxForAudit — PII-free 요약', () => {
  test('빈/비배열 → (없음)', () => {
    expect(summarizeRxForAudit(null)).toBe('(없음)');
    expect(summarizeRxForAudit(undefined)).toBe('(없음)');
    expect(summarizeRxForAudit([])).toBe('(없음)');
    expect(summarizeRxForAudit('not-array')).toBe('(없음)');
  });

  test('약물 다건 → "N건: ..." 건수 prefix + 약물명 포함(PII 없음)', () => {
    const s = summarizeRxForAudit([
      { name: '록소닌정', dosage: '1정', count: 3, days: 5 },
      { name: '뮤테란캡슐', dosage: '1캡슐', count: 2, days: 3 },
    ]);
    expect(s.startsWith('2건')).toBe(true);
    expect(s).toContain('록소닌정');
    expect(s).toContain('뮤테란캡슐');
    // 주민번호 형태(6-7) 등 PII 토큰이 섞이지 않음
    expect(s).not.toMatch(/\d{6}-\d{7}/);
  });

  test('200자 초과 → 말줄임(…) 캡', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `약물${i}`, dosage: '1정', count: 3, days: 5 }));
    const s = summarizeRxForAudit(many);
    expect(s.length).toBeLessThanOrEqual(220); // '60건: ' prefix + 200 body + … 여유
    expect(s).toContain('…');
    expect(s.startsWith('60건')).toBe(true);
  });
});
