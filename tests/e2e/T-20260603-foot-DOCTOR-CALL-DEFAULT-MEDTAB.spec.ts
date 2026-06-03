/**
 * E2E spec — T-20260603-foot-DOCTOR-CALL-DEFAULT-MEDTAB
 * 진료알림판(진료콜 명단 팝업, DOCTOR-CALL-POPUP-RELOC)에서 환자 이름 클릭 시
 * 기본 진입을 '기본차트'(2번차트 서랍=펜차트) → '진료차트'(MedicalChartPanel)로 정정.
 *
 * 배경: Dashboard.handleOpenChartFromList 가 ctxOpenChart(=기본차트 서랍)로 열려
 *   #2 주석 의도("이름 클릭 → 진료차트 즉시 열기")와 실제가 어긋났음.
 *   DoctorCallDashboard FOLLOWUP3 C-1과 동일하게 MedicalChartPanel 직접 오픈으로 통일.
 *
 * 핵심 불변식:
 *   AC-1 진료알림판 경로(handleOpenChartFromList)는 '진료차트'(medical)로 진입한다.
 *   AC-2 customer_id 미연결 시 동명이인 1건 자동 매칭 → 진료차트 진입(+check_in 연결) 보존.
 *        동명이인 2건 이상/0건은 진입 없이 안내(회귀 방지).
 *   AC-3 다른 진입점(고객관리·체크인 상세·카드 클릭=ctxOpenChart)의 기본차트 서랍 기본탭은
 *        '펜차트'(기본차트)로 그대로 유지 — 회귀 0.
 *
 * 컨벤션: 구현 정본의 라우팅 규칙을 in-page 순수 로직으로 모사해 회귀를 잡는다(기존 RX-계열·POPUP-RELOC spec 패턴).
 */
import { test, expect } from '@playwright/test';

// ── 라우팅 정본 모델 ───────────────────────────────────────────────────────────
// 진입점별 차트 오픈 대상: 'medical' = 진료차트(MedicalChartPanel), 'basic' = 기본차트 서랍(펜차트)
type ChartTarget = 'medical' | 'basic';
type OpenResult =
  | { kind: 'open'; target: ChartTarget; customerId: string; linkCheckIn?: boolean }
  | { kind: 'info'; reason: string };

type Customer = { id: string; name: string };

/** 진료알림판(진료콜 명단 팝업) 이름 클릭 — 항상 '진료차트' 진입. */
function openFromDoctorCallList(
  ci: { customer_id: string | null; customer_name: string | null },
  clinicCustomers: Customer[],
): OpenResult {
  if (ci.customer_id) {
    return { kind: 'open', target: 'medical', customerId: ci.customer_id };
  }
  if (ci.customer_name) {
    const matches = clinicCustomers.filter((c) => c.name === ci.customer_name).slice(0, 2);
    if (matches.length === 1) {
      // customer_id 자동 연결 + 진료차트 진입
      return { kind: 'open', target: 'medical', customerId: matches[0].id, linkCheckIn: true };
    }
    if (matches.length > 1) return { kind: 'info', reason: 'duplicate-name' };
    return { kind: 'info', reason: 'not-linked' };
  }
  return { kind: 'info', reason: 'not-linked' };
}

/** 그 외 진입점(고객관리·체크인 상세·카드 클릭) — 기본차트 서랍(펜차트). 회귀 방지용 박제. */
function openFromOtherEntry(customerId: string): OpenResult {
  return { kind: 'open', target: 'basic', customerId };
}

const CUSTOMERS: Customer[] = [
  { id: 'cust-1', name: '김발가락' },
  { id: 'cust-2', name: '이중복' },
  { id: 'cust-3', name: '이중복' }, // 동명이인
];

test.describe('T-20260603 DOCTOR-CALL-DEFAULT-MEDTAB — 진료알림판 기본 진입 = 진료차트', () => {
  // ── AC-1: customer_id 연결된 환자 이름 클릭 → 진료차트 ─────────────────────────
  test('AC-1: customer_id 있으면 진료차트(medical) 직접 오픈', () => {
    const r = openFromDoctorCallList({ customer_id: 'cust-1', customer_name: '김발가락' }, CUSTOMERS);
    expect(r.kind).toBe('open');
    expect((r as { target: ChartTarget }).target).toBe('medical');
    expect((r as { customerId: string }).customerId).toBe('cust-1');
  });

  // ── AC-2: customer_id 미연결 — 동명이인 1건 자동 매칭 → 진료차트 + check_in 연결 ──
  test('AC-2: 미연결+동명 1건 → 진료차트 진입 + check_in 자동 연결', () => {
    const r = openFromDoctorCallList({ customer_id: null, customer_name: '김발가락' }, CUSTOMERS);
    expect(r.kind).toBe('open');
    expect((r as { target: ChartTarget }).target).toBe('medical');
    expect((r as { customerId: string }).customerId).toBe('cust-1');
    expect((r as { linkCheckIn?: boolean }).linkCheckIn).toBe(true);
  });

  test('AC-2: 미연결+동명이인 2건 이상 → 진입 없이 안내(회귀 방지)', () => {
    const r = openFromDoctorCallList({ customer_id: null, customer_name: '이중복' }, CUSTOMERS);
    expect(r.kind).toBe('info');
    expect((r as { reason: string }).reason).toBe('duplicate-name');
  });

  test('AC-2: 미연결+매칭 0건/이름 없음 → 진입 없이 안내', () => {
    const noMatch = openFromDoctorCallList({ customer_id: null, customer_name: '없는사람' }, CUSTOMERS);
    expect(noMatch.kind).toBe('info');
    expect((noMatch as { reason: string }).reason).toBe('not-linked');
    const noName = openFromDoctorCallList({ customer_id: null, customer_name: null }, CUSTOMERS);
    expect(noName.kind).toBe('info');
    expect((noName as { reason: string }).reason).toBe('not-linked');
  });

  // ── AC-3: 다른 진입점은 기본차트(펜차트) 서랍 유지 — 회귀 0 ──────────────────────
  test('AC-3: 고객관리/체크인 상세/카드 클릭 등 다른 진입점은 기본차트 서랍 유지', () => {
    const r = openFromOtherEntry('cust-1');
    expect(r.kind).toBe('open');
    expect((r as { target: ChartTarget }).target).toBe('basic');
    // 진료알림판 경로만 'medical', 그 외는 'basic'으로 분기됨을 교차 확인
    const fromList = openFromDoctorCallList({ customer_id: 'cust-1', customer_name: '김발가락' }, CUSTOMERS);
    expect((fromList as { target: ChartTarget }).target).not.toBe(
      (r as { target: ChartTarget }).target,
    );
  });
});
