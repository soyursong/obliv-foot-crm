/**
 * E2E spec — T-20260609-foot-DOCPATIENTLIST-RXCANCEL-DISCHARGE-GATE
 * 진료환자목록 귀가 환자 처방취소 차단 (문지은 대표원장 6/9).
 *
 * 신고: 진료환자목록(DoctorPatientList)에서 이미 귀가(status==='done')한 환자의 처방취소 버튼이
 *       활성화돼 직접 취소가 가능 → 귀가 환자는 진료환자목록에서 처방취소를 막고, 수정이 필요하면
 *       환자 차트로 들어가서 변경하도록 유도.
 *
 * 핵심 설계: 귀가 판정을 별도 신설하지 않고 inClinicRxGate(checkRxInClinic) SSOT 를 그대로 재사용
 *   (T-20260609-foot-QUICKRX-INCLINIC-GATE 932a0d7 정본: status==='done'=귀가 + 전날/미래/취소 비잔류).
 *   RxConfirmedSummary(처방취소 surface)에 게이트 컨텍스트(checkInStatus/checkedInAt/onOpenChart)를
 *   추가. 컨텍스트 제공 소비처(DoctorPatientList)에서만 게이팅 → 미제공 소비처(DoctorCallDashboard)는
 *   종전 동작 보존(무회귀).
 *
 * 검증:
 *   AC1: 귀가(status==='done', 오늘) 환자 → 처방취소 차단 (gate.allowed=false).
 *   AC2: 차단 시 "차트에서 수정" 안내 + 차트 진입 동선(onOpenChart) 노출.
 *   AC3: 게이트 판정 = INCLINIC-GATE 귀가 SSOT(checkRxInClinic, status==='done')와 동일(불일치 0).
 *   AC4(GUARD): 원내 잔류(status active, 오늘) 환자 → 처방취소 정상(gate.allowed=true).
 *
 * 스타일: 형제 티켓(DOCDASH-LABEL-RX-REFINE/DOCPATIENTLIST-SORT-LAYOUT)과 동일 —
 *   SSOT(inClinicRxGate) 정본을 in-page 순수 로직으로 모사 + 소스 정적 검증(게이트 배선/무회귀 가드).
 *   auth/DB 비의존(unit 프로젝트).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

// ── 정본 모사: checkRxInClinic (lib/inClinicRxGate.ts) ─────────────────────────
//   별도 판정 신설 금지 — 본 모사는 SSOT 와 동일 분기여야 함(AC3 불일치 0 가드).
//   seoulISODate(iso) → KST(+09:00) 캘린더 날짜. 테스트는 명시 ISO 로 단순 모사.
type GateReason = 'not_today' | 'discharged' | 'cancelled' | 'missing';
interface GateResult { allowed: boolean; reason: GateReason | null }
const NOT_IN_CLINIC = new Set(['done', 'cancelled']);

/** KST 캘린더 날짜(YYYY-MM-DD) — '+09:00' 오프셋 적용 후 날짜만 추출 */
const seoulISODate = (iso: string): string =>
  new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);

const checkRxInClinic = (
  checkIn: { status?: string | null; checked_in_at?: string | null } | null | undefined,
  todayISO: string,
): GateResult => {
  if (!checkIn || !checkIn.checked_in_at) return { allowed: false, reason: 'missing' };
  const status = checkIn.status ?? '';
  if (status === 'cancelled') return { allowed: false, reason: 'cancelled' };
  if (seoulISODate(checkIn.checked_in_at) !== todayISO) return { allowed: false, reason: 'not_today' };
  if (status === 'done') return { allowed: false, reason: 'discharged' };
  return { allowed: true, reason: null };
};

const TODAY = '2026-06-10';
const todayCheckedIn = `${TODAY}T03:00:00+09:00`; // KST 오전 = 당일

// ─────────────────────────────────────────────────────────────────────────────
// S1 — AC1: 귀가(status==='done') 환자 처방취소 차단
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 AC1 — 귀가 환자 처방취소 차단', () => {
  test('당일 귀가(status=done) → allowed=false, reason=discharged', () => {
    const g = checkRxInClinic({ status: 'done', checked_in_at: todayCheckedIn }, TODAY);
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe('discharged');
  });

  test('전날 환자(not_today) → 차단', () => {
    const g = checkRxInClinic({ status: 'confirmed', checked_in_at: '2026-06-09T03:00:00+09:00' }, TODAY);
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe('not_today');
  });

  test('상태 결측 → fail-closed(missing) 차단', () => {
    expect(checkRxInClinic({ status: 'done', checked_in_at: null }, TODAY).allowed).toBe(false);
    expect(checkRxInClinic(null, TODAY).reason).toBe('missing');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 — AC4(GUARD): 원내 잔류 환자 처방취소 정상 (회귀 가드)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 AC4 — 원내 잔류 환자 처방취소 정상', () => {
  test('당일 원내 잔류(status=waiting/in_progress 등 active) → allowed=true', () => {
    for (const status of ['waiting', 'in_progress', 'treatment', 'consulting', 'confirmed']) {
      const g = checkRxInClinic({ status, checked_in_at: todayCheckedIn }, TODAY);
      expect(g.allowed, `status=${status} 는 원내 잔류 → 취소 허용`).toBe(true);
      expect(g.reason).toBeNull();
    }
  });

  test('done/cancelled 만 비잔류(차단), 그 외 당일은 허용 (NOT_IN_CLINIC 정합)', () => {
    expect(NOT_IN_CLINIC.has('done')).toBe(true);
    expect(NOT_IN_CLINIC.has('cancelled')).toBe(true);
    expect(NOT_IN_CLINIC.has('waiting')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 — AC3: 귀가 판정 SSOT 재사용(별도 판정 신설 금지) — 소스 배선 가드
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 AC3 — inClinicRxGate SSOT 재사용', () => {
  test('RxConfirmedSummary 가 checkRxInClinic 게이트로 취소를 차단', () => {
    const src = SRC('components/doctor/QuickRxBar.tsx');
    // SSOT import + 호출 (별도 귀가 판정 로직 신설 금지)
    expect(src).toContain('checkRxInClinic');
    expect(src).toContain('rxInClinicMessage');
    // 게이트 컨텍스트 props 도입
    expect(src).toContain('checkInStatus');
    expect(src).toContain('checkedInAt');
    // 차단 판정 + 취소 불가 반영
    expect(src).toMatch(/blockedByGate/);
    expect(src).toMatch(/cancellable\s*=\s*doctorMode\s*&&\s*!!checkInId\s*&&\s*!blockedByGate/);
  });

  test('정본(lib/inClinicRxGate.ts)이 status===\'done\' 을 귀가(discharged)로 판정', () => {
    const src = SRC('lib/inClinicRxGate.ts');
    expect(src).toContain('export function checkRxInClinic');
    expect(src).toMatch(/status === 'done'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S4 — AC2: 차트 진입 동선 + DoctorPatientList 배선 / 무회귀 가드
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S4 AC2 — 차트 진입 동선 + 배선/무회귀', () => {
  test('DoctorPatientList 가 게이트 컨텍스트 + 차트 진입(openTreatmentChart) 전달', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    // 차트 진입 단일 게이트웨이(L-004 의도 보존). T-20260621-foot-DOCDASH-PASTDATE-CHARTROUTE BUG-2
    //   (문지은 대표원장 confirm): useChart().openChart(2번차트 서랍/고객차트) → 로컬 진료차트 직접오픈
    //   (openTreatmentChart)으로 라우팅 타깃 정정. 다른 진입점 useChart 동선 무접촉(AC-3).
    expect(src).toMatch(/const openTreatmentChart = \(customerId: string/);
    expect(src).toMatch(/openTreatmentChart\s*\(/);
    // RxConfirmedSummary 에 status/checkedInAt/onOpenChart 전달
    expect(src).toContain('checkInStatus={row.status}');
    expect(src).toContain('checkedInAt={row.checked_in_at}');
    expect(src).toContain('onOpenChart');
    // 차트 진입에 필요한 customer_id 를 쿼리에서 조회
    expect(src).toMatch(/id,\s*customer_id,\s*customer_name/);
  });

  test('차단 시 차트 진입 버튼/안내 노출 (RxConfirmedSummary)', () => {
    const src = SRC('components/doctor/QuickRxBar.tsx');
    expect(src).toContain('rx-cancel-open-chart');
    expect(src).toContain('차트에서 수정');
  });

  // T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK (정책 정정 — 누수 close):
  //   기존엔 "DoctorCallDashboard RxConfirmedSummary 가 게이트 컨텍스트 미전달 = 종전 동작 보존"을
  //   회귀로 박제했으나, 그게 바로 현장이 신고한 누수(귀가환자 처방취소 fail-open)였다.
  //   → 이제 진료대시보드도 게이트 컨텍스트를 전달(fail-closed) + DB 재검증 가드(우회 0)로 이중 차단.
  test('누수 close: DoctorCallDashboard 의 RxConfirmedSummary 는 게이트 컨텍스트를 전달(귀가 처방취소 차단)', () => {
    const src = SRC('components/doctor/DoctorCallDashboard.tsx');
    const blocks = src.match(/<RxConfirmedSummary[\s\S]*?\/>/g) ?? [];
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      // 게이트 판정에 필요한 3컨텍스트 + 차트 진입 동선 전달.
      expect(b).toContain('checkedInAt');
      expect(b).toContain('checkInStatus');
      expect(b).toContain('checkInFlag');
      expect(b).toContain('onOpenChart');
    }
  });

  test('우회 0: cancel 도 DB 재검증 공통 가드(assertInClinicForRxMutation) 경유 — UI prop 누락 무관 fail-closed', () => {
    const src = SRC('components/doctor/QuickRxBar.tsx');
    // useCancelConfirmedRx 가 공통 가드를 호출(귀가환자 처방취소를 DB 최신값으로 강제 차단).
    expect(src).toContain('useCancelConfirmedRx');
    expect(src).toContain('assertInClinicForRxMutation');
    expect(src).toContain("blockedAction: 'rx_cancel_blocked'");
  });
});
