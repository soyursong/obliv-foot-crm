/**
 * Contract spec — T-20260730-foot-REDPAY-PLANB-V2-ADDENDUM-SPEC (§4-4 D절 스샷독립 로직)
 *
 * 목적: 최필경 총괄 v2 지시서 §4-4(D절, 중복방지)의 '색박스 스샷(F-4) 무관' 데이터·로직 슬라이스
 *   — D-2 서버 재조회(fetchPatientPlanbContext) · D-3 팝업 3분기 순수판정(resolvePlanbEntryBranch)
 *   — 의 계약·불변식을 (1) 순수함수 런타임 검증 + (2) 소스 정적 검증(browser 무접점, CI 결정적)으로 고정.
 *
 * ★ 스코프 경계(스샷 게이트 F-4): 팝업/배지 UI 좌표·형태, UI wiring, 현장 시나리오 1~5 E2E 는
 *   총괄 색박스 스샷 수신 후 별건(§4-4 build 착수 게이트). 본 spec 은 그 前단의 순수 로직만 고정한다.
 *
 * 시나리오 매핑(순수 판정 축):
 *   시나리오1(이미 대기중 등록 재클릭, D-3-a) → resolvePlanbEntryBranch === 'has_open'
 *   시나리오2(이미 수납완료 재클릭, D-3-b)     → 'paid'
 *   시나리오4(정상, D-3-c)                     → 'clear'
 *   시나리오3(동시클릭 경합, D-4)              → 기존 partial UNIQUE index(app-guard) — no-DDL 정적 검증
 *   시나리오5(배지, D-5)                       → created_by 재사용 정적 검증
 *
 * 불변식:
 *   INV-A D-2 재조회는 '서버' 기준(화면 stale 무시) — clinic+customer+status='open' / check_in_id+status='active'.
 *   INV-B fail-closed — 조회 error 는 throw(등록 보류), 삼키지 않음.
 *   INV-C payments 는 read-only(§550 Model A) — fetchPatientPlanbContext 는 어떤 write(insert/update/upsert/delete)도 안 함.
 *   INV-D D-4 동시클릭 방지 = 기존 index(no 신규 DDL). D-5 등록담당자 = created_by 재사용.
 *   INV-E 순수 판정 우선순위 has_open > paid > clear (중복결제 위험 직접원인=대기중 선점 우선).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  resolvePlanbEntryBranch,
  type PatientPlanbContext,
} from '../../src/lib/planbEntryBranch';

const LIB = 'src/lib/paymentPlanb.ts';
const PURE = 'src/lib/planbEntryBranch.ts';

const read = (p: string) => fs.readFileSync(p, 'utf8');
/** 주석 제거 후 실제 코드만(주석 doc 문자열 오탐 방지). */
const codeOf = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\*.*$/gm, '')
    .replace(/\/\/.*$/gm, '');

const openPending = (over: Partial<NonNullable<PatientPlanbContext['openPending']>> = {}) => ({
  id: 'pp-1',
  expected_amount: 120000,
  created_by: 'staff-A',
  created_at: '2026-07-30T05:00:00.000Z',
  ...over,
});
const paid = (over: Partial<PatientPlanbContext['paidPayments'][number]> = {}) => ({
  amount: 120000,
  created_at: '2026-07-30T05:00:00.000Z',
  external_approval_no: '12345678',
  ...over,
});

// ── INV-E: 순수 3분기 판정 (런타임) — 시나리오 1/2/4 축 ──────────────────────────
test.describe('D-3 resolvePlanbEntryBranch 순수 3분기 판정 (런타임)', () => {
  test('시나리오4(D-3-c): 아무것도 없음 → clear', () => {
    expect(resolvePlanbEntryBranch({ openPending: null, paidPayments: [] })).toBe('clear');
  });

  test('시나리오1(D-3-a): open 선점 존재 → has_open', () => {
    expect(
      resolvePlanbEntryBranch({ openPending: openPending(), paidPayments: [] }),
    ).toBe('has_open');
  });

  test('시나리오2(D-3-b): 활성 수납 존재(open 없음) → paid', () => {
    expect(
      resolvePlanbEntryBranch({ openPending: null, paidPayments: [paid()] }),
    ).toBe('paid');
  });

  test('INV-E 우선순위: open 선점 + 이미 수납 동시 → has_open (대기중 선점 우선)', () => {
    expect(
      resolvePlanbEntryBranch({ openPending: openPending(), paidPayments: [paid()] }),
    ).toBe('has_open');
  });

  test('여러 활성 수납이어도 open 없으면 paid', () => {
    expect(
      resolvePlanbEntryBranch({
        openPending: null,
        paidPayments: [paid(), paid({ amount: 30000, external_approval_no: null })],
      }),
    ).toBe('paid');
  });

  test('순수성: 입력 컨텍스트를 변형하지 않음(부수효과 0)', () => {
    const ctx: PatientPlanbContext = { openPending: openPending(), paidPayments: [paid()] };
    const snap = JSON.stringify(ctx);
    resolvePlanbEntryBranch(ctx);
    expect(JSON.stringify(ctx)).toBe(snap);
  });
});

// ── INV-A: D-2 서버 재조회 계약 (정적) ──────────────────────────────────────────
test.describe('D-2 fetchPatientPlanbContext 서버 재조회 계약', () => {
  const code = codeOf(LIB);

  test('INV-A open 선점 재조회: clinic+customer+status=open (서버 기준)', () => {
    expect(code).toMatch(/fetchPatientPlanbContext/);
    expect(code).toMatch(/from\('pending_payment'\)/);
    expect(code).toMatch(/\.eq\('clinic_id',\s*clinicId\)/);
    expect(code).toMatch(/\.eq\('customer_id',\s*customerId\)/);
    expect(code).toMatch(/\.eq\('status',\s*'open'\)/);
  });

  test("INV-A 활성 수납 재조회: check_in_id + status='active' (취소·삭제 제외)", () => {
    expect(code).toMatch(/from\('payments'\)/);
    expect(code).toMatch(/\.eq\('check_in_id',\s*checkInId\)/);
    expect(code).toMatch(/\.eq\('status',\s*'active'\)/);
  });

  test('INV-B fail-closed: 조회 error 는 throw(삼키지 않음)', () => {
    expect(code).toMatch(/if\s*\(openRes\.error\)\s*throw\s+openRes\.error/);
    expect(code).toMatch(/if\s*\(paidRes\.error\)\s*throw\s+paidRes\.error/);
  });

  test('INV-C payments read-only: 함수 내 write(insert/update/upsert/delete) 없음(§550 Model A)', () => {
    // fetchPatientPlanbContext 본문만 슬라이스해 write 콜 부재 확인.
    const start = code.indexOf('export async function fetchPatientPlanbContext');
    const nextFn = code.indexOf('export async function fetchPendingPaymentStatus');
    expect(start).toBeGreaterThan(-1);
    expect(nextFn).toBeGreaterThan(start);
    const body = code.slice(start, nextFn);
    expect(body).not.toMatch(/\.insert\(/);
    expect(body).not.toMatch(/\.update\(/);
    expect(body).not.toMatch(/\.upsert\(/);
    expect(body).not.toMatch(/\.delete\(/);
  });

  test('D-5 등록담당자: created_by 재조회(배지 표시 데이터)', () => {
    expect(code).toMatch(/created_by/);
  });
});

// ── INV-D: D-4 동시클릭 방지 no-DDL / 순수 모듈 격리 (정적) ──────────────────────
test.describe('§4-4 격리·no-DDL 계약', () => {
  test('INV-D D-4: 서버 제약은 기존 partial UNIQUE index(pending_payment_open_uq) 재사용 — 신규 DDL 언급', () => {
    const doc = read(LIB);
    expect(doc).toMatch(/pending_payment_open_uq/);
    expect(doc).toMatch(/no-DDL|신규 DDL 불요/);
  });

  test('순수 모듈 격리: planbEntryBranch.ts 는 supabase 무의존(런타임 부수효과 0)', () => {
    // 주석 doc 에는 배경설명상 'supabase' 단어가 등장 → 실제 코드(comment-strip)에 import/참조 부재로 판정.
    const codePure = codeOf(PURE);
    expect(codePure).not.toMatch(/from '@\/lib\/supabase'/);
    expect(codePure).not.toMatch(/supabase/);
    expect(codePure).not.toMatch(/\bimport\b/); // 순수 모듈 — 런타임 import 0.
  });

  test('paymentPlanb 단일 진입점: 순수 판정 re-export', () => {
    const doc = read(LIB);
    expect(doc).toMatch(/export\s*\{\s*resolvePlanbEntryBranch\s*\}/);
  });
});
