/**
 * E2E spec — T-20260610-foot-DOCPATIENTLIST-QUICKRX-CHARTBTN
 * 진료환자목록 미확정 환자 펼침 패널 '차트 열기' 버튼 누락 버그 — 차트 진입 배선 가드.
 *
 * 신고(문지은 대표원장 6/10): 진료환자목록(DoctorPatientList)에서 미확정(pending/none) 환자 행을
 *   펼치면 원내 비잔류(귀가/전날/미래/취소) 환자의 빠른처방 차단 패널에 '차트 열기' 버튼이 안 보임.
 *   확정 환자(RxConfirmedSummary)에는 차트 진입이 있으나 미확정 분기(QuickRxBar)에만 누락.
 *
 * 원인: PatientRow → QuickRxBar 렌더 시 onOpenChart prop 미전달.
 *   (PatientRow 는 부모에서 onOpenChart 수령 / RxConfirmedSummary 에는 전달했으나 QuickRxBar 분기만 누락)
 * 수정: QuickRxBar 에 onOpenChart={onOpenChart} 1줄 배선. 기존 openChart(LOGIC-LOCK L-004 단일
 *   게이트웨이=useChart) 재사용 — 신규 경로/컴포넌트 신설 금지.
 *
 * 검증:
 *   AC1: 미확정 펼침 패널(QuickRxBar)에 onOpenChart 전달 — 원내 비잔류 시 '차트 열기' 버튼 렌더.
 *   AC2: 차트 진입 = useChart.openChart(LOGIC-LOCK L-004) 단일 게이트웨이 경유(신규 경로 0).
 *   AC3: onOpenChart 미제공 시 null(버튼/패널 미노출) — 잔류 환자는 정상 처방 버튼 노출(무회귀).
 *   회귀가드:
 *     R1(DATEMODE-HISTORY): isPast(과거 read-only) 행 클릭 = onOpenChart 차트 진입 보존.
 *     R2(SORT-LAYOUT): 기본 행 grid 고정 열 레이아웃(원내 우선 그룹·정렬) 보존.
 *     R3(확정패널 차트열기): RxConfirmedSummary onOpenChart 차트 진입 회귀금지.
 *
 * 스타일: 형제 티켓(RXCANCEL-DISCHARGE-GATE/INCLINIC-GATE)과 동일 — 차단 게이트 SSOT
 *   in-page 모사 + 소스 정적 배선 가드. auth/DB 비의존(unit 프로젝트).
 *
 * ⚠️ SUPERSEDED(부분) — T-20260610-foot-QUICKRX-BLOCKED-PANEL-HIDE (문지은 6/10, 동일 reporter):
 *   "불가 환자에겐 버튼 영역 자체를 비워달라(아무것도 렌더 안 함)" 결정으로 QuickRxBar 차단 분기의
 *   '차트 열기' 버튼(quick-rx-open-chart)이 폐지되고 `if (blockedByUiGate) return null` 로 단순화됨.
 *   본 spec 의 QuickRxBar-차단-분기 단언(S1·S2·S3 일부)을 새 SSOT(빈 렌더)로 갱신함.
 *   유지: DoctorPatientList→QuickRxBar onOpenChart 배선(적용시점 게이트 토스트 액션으로 잔존) /
 *         RxConfirmedSummary(확정패널) 차트열기(rx-cancel-open-chart) — 별개 facet, 회귀가드 유효.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

// ── 정본 모사: checkRxInClinic (lib/inClinicRxGate.ts) — 차단 시 '차트 열기' 노출 조건 ──
//   별도 판정 신설 금지. SSOT 와 동일 분기여야 함(귀가/전날/미래/취소 = 비잔류 → 차단).
type GateReason = 'not_today' | 'discharged' | 'cancelled' | 'missing';
interface GateResult { allowed: boolean; reason: GateReason | null }
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

/**
 * QuickRxBar 차단 분기 렌더 결정 모사(구현 정본 line ~333) —
 *   T-20260610-foot-QUICKRX-BLOCKED-PANEL-HIDE 로 supersede:
 *   if (blockedByUiGate) { return null; }  // 앰버·불가문구·'차트 열기' 버튼 전부 폐지, 빈 렌더.
 * → 비잔류면 onOpenChart 유무와 무관하게 항상 빈 렌더(null). 잔류면 처방 버튼.
 */
function quickRxBlockedRender(
  checkIn: { status?: string | null; checked_in_at?: string | null },
  _onOpenChart: (() => void) | undefined,
  todayISO = TODAY,
): 'null' | 'rx-buttons' {
  const gate = checkRxInClinic(checkIn, todayISO);
  if (!gate.allowed) return 'null';
  return 'rx-buttons';
}

// ─────────────────────────────────────────────────────────────────────────────
// S1 — (PANEL-HIDE supersede) 미확정 비잔류 환자 = 빈 렌더(null), '차트 열기' 버튼 폐지
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 — 미확정 차단 패널 빈 렌더(PANEL-HIDE: 차트 열기 버튼 폐지)', () => {
  test('귀가(done) 환자 + onOpenChart 제공이어도 → 빈 렌더(null)', () => {
    expect(
      quickRxBlockedRender({ status: 'done', checked_in_at: todayCheckedIn }, () => {}),
    ).toBe('null');
  });

  test('전날/미래/취소 환자도 onOpenChart 제공이어도 → 빈 렌더(null)', () => {
    const yesterday = { status: 'confirmed', checked_in_at: '2026-06-09T03:00:00+09:00' };
    const tomorrow = { status: 'registered', checked_in_at: '2026-06-11T03:00:00+09:00' };
    const cancelled = { status: 'cancelled', checked_in_at: todayCheckedIn };
    for (const c of [yesterday, tomorrow, cancelled]) {
      expect(quickRxBlockedRender(c, () => {})).toBe('null');
    }
  });

  test('DoctorPatientList → QuickRxBar onOpenChart 배선 보존(적용시점 게이트 토스트 액션용, 회귀금지)', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    // QuickRxBar JSX 블록 — onOpenChart 전달은 유지(차단 분기 렌더가 아닌, 적용시점 게이트 실패 토스트 액션 경유).
    const block = src.match(/<QuickRxBar[\s\S]*?\/>/);
    expect(block, 'QuickRxBar JSX 블록 존재').not.toBeNull();
    expect(block![0]).toContain('onOpenChart={onOpenChart}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 — AC2: 차트 진입 = useChart.openChart (LOGIC-LOCK L-004) 단일 게이트웨이
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 AC2 — LOGIC-LOCK L-004 단일 차트 게이트웨이', () => {
  test('DoctorPatientList 가 useChart.openChart 경유로 차트 진입(신규 경로 0)', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    expect(src).toContain("import { useChart } from '@/lib/chartContext'");
    expect(src).toMatch(/const\s*\{\s*openChart\s*\}\s*=\s*useChart\(\)/);
    // PatientRow 에 onOpenChart = customer_id 있을 때만 openChart 호출(없으면 undefined → 버튼 비노출).
    expect(src).toMatch(/onOpenChart=\{row\.customer_id\s*\?\s*\(\)\s*=>\s*openChart\(row\.customer_id[\s\S]*?:\s*undefined\}/);
    // 차트 진입에 필요한 customer_id 를 쿼리에서 조회(없으면 onOpenChart undefined).
    expect(src).toMatch(/id,\s*customer_id,\s*customer_name/);
  });

  test('QuickRxBar: 차단 분기 차트라우팅 신설 0 + (PANEL-HIDE) 차단용 차트열기 버튼 폐지', () => {
    const src = SRC('components/doctor/QuickRxBar.tsx');
    // PANEL-HIDE supersede: 차단 분기는 빈 렌더 → '차트 열기' 버튼(quick-rx-open-chart) testid 부재.
    expect(src).not.toContain('data-testid="quick-rx-open-chart"');
    // QuickRxBar 가 자체적으로 차트 라우팅(navigate/window.open/href) 신설하지 않음(불변).
    expect(src).not.toMatch(/navigate\(|window\.open\(|location\.href/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 — AC3: onOpenChart 미제공 시 null / 잔류 환자는 정상 처방 버튼(무회귀)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 AC3 — 미제공 null + 잔류 정상(무회귀)', () => {
  test('비잔류 + onOpenChart 미제공 → null(버튼/앰버 패널 미노출)', () => {
    expect(
      quickRxBlockedRender({ status: 'done', checked_in_at: todayCheckedIn }, undefined),
    ).toBe('null');
  });

  test('원내 잔류(당일 active) 환자 → 처방 버튼 정상(차단 분기 미진입)', () => {
    for (const status of ['registered', 'consultation', 'treatment_waiting', 'laser', 'payment_waiting']) {
      expect(
        quickRxBlockedRender({ status, checked_in_at: todayCheckedIn }, () => {}),
      ).toBe('rx-buttons');
    }
  });

  test('QuickRxBar: 차단(blockedByUiGate) → 무조건 return null (PANEL-HIDE: 앰버·불가문구·차트열기 전부 폐지)', () => {
    const src = SRC('components/doctor/QuickRxBar.tsx');
    expect(src).toMatch(/if\s*\(blockedByUiGate\)\s*\{\s*return null;\s*\}/);
    // PANEL-HIDE 회귀가드: 앰버 'Ban' 차단 패널 / "빠른처방 불가" 문구 / 차단용 '차트 열기' 버튼 부활 금지.
    expect(src).not.toContain('quick-rx-blocked');
    expect(src).not.toContain('data-testid="quick-rx-open-chart"');
    expect(src).not.toMatch(/\bBan\b/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S4 — 회귀가드 R1/R2/R3
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S4 회귀가드 — DATEMODE-HISTORY / SORT-LAYOUT / 확정패널 차트열기', () => {
  test('R1(DATEMODE-HISTORY): isPast 행 클릭 = onOpenChart 차트 진입 보존', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    // 과거(read-only) 모드 분기 + 행 버튼 onClick=onOpenChart + 미제공 시 disabled.
    expect(src).toMatch(/if\s*\(isPast\)\s*\{/);
    expect(src).toMatch(/data-mode="history"/);
    expect(src).toMatch(/onClick=\{onOpenChart\}[\s\S]*?disabled=\{!onOpenChart\}/);
  });

  test('R2(SORT-LAYOUT): 기본 행 grid 고정 열 + 원내 우선 그룹 정렬 보존', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    // 고정 grid-template(8트랙). T-20260613 MIRROR(1.75rem 제거)+CHARTNO-COL-SPLIT(4.5rem)+
    //   T-20260615 DASHCOL-REALIGN(문지은 대표원장 confirm: 방→상태→방문유형→이름→차트번호→처방→예약메모→액션) 정합.
    expect(src).toMatch(/grid-cols-\[4\.75rem_3\.75rem_3rem_5rem_4\.5rem_5\.5rem_minmax\(0,1fr\)_auto\]/);
    // 원내 잔류 그룹 항상 상단 + 시간순/이름순 정렬 토글.
    expect(src).toMatch(/isInClinic\(a\.status\)/);
    expect(src).toMatch(/data-testid=\{`sort-by-\$\{key\}`\}/);
    expect(src).toMatch(/key:\s*'time'[\s\S]*?key:\s*'name'/);
  });

  test('R3(확정패널 차트열기): RxConfirmedSummary onOpenChart 차트 진입 회귀금지', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    // 확정 분기(RxConfirmedSummary) JSX 에 onOpenChart 전달 보존.
    const block = src.match(/<RxConfirmedSummary[\s\S]*?\/>/);
    expect(block, 'RxConfirmedSummary JSX 블록 존재').not.toBeNull();
    expect(block![0]).toContain('onOpenChart={onOpenChart}');
    // RxConfirmedSummary 자체의 차트 진입 버튼(귀가 차단 시) 보존.
    const qsrc = SRC('components/doctor/QuickRxBar.tsx');
    expect(qsrc).toContain('rx-cancel-open-chart');
  });
});
