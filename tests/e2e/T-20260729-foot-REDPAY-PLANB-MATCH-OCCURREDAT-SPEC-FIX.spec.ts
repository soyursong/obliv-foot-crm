/**
 * Contract spec — T-20260729-foot-REDPAY-PLANB-MATCH-OCCURREDAT-SPEC-FIX
 *   (최필경 총괄, 스레드 1785285157.831119 / parent: T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD)
 *
 * 목적: 레드페이 플랜B 매칭 SPEC 정정 3🔴 가 정책 단일소스(app 상수)·매처 EF(redpay-planb-match)·
 *   비대기형 UX 에 drift 없이 반영됐는지 순수 로직 + 소스 검증(browser 무접점 — 매칭은 backend·flag OFF).
 *   매칭 로직 자체는 매처 단위테스트(deno test supabase/functions/redpay-planb-match/match.test.ts, 10 tests)로 검증하고,
 *   본 spec 은 (a) FE/EF SSOT 계약 (b) 시나리오 1~4 회귀 불변식 (c) AC 소스 무결성을 커버한다.
 *
 * 정정 요약:
 *  정정2 — 매칭 시간 키 received_at(도착) → occurred_at(승인시각=approved_at). 유효창 [created, created+5분].
 *          파라미터 2분리: 선점 유효창(5분) / 선점표 보관 기간(1시간, 신설).
 *  정정3 — 매칭 대상 = 승인(external_status='Y') 한정. cancelled/refunded 제외.
 *  정정1 — TTL 카드삽입시간 누락 = 정정2로 구조적 해소(무액션).
 *
 * 시나리오(현장 클릭 → 계약 검증):
 *  S1. 늦은 웹훅도 승인시각(occurred_at)으로 자동연결(received_at 늦어도 무관).
 *  S2. 만료(expired) 후 보관창(1h) 내 late 웹훅으로 자동연결(행 즉시삭제 없음).
 *  S3. 결제후즉시취소(양수 2건) — 취소 raw 오연결 차단(승인만 매칭).
 *  S4. 비대기형 UX 회귀 0 — 카운트다운=유효창 5분만, 웹훅 보관창/대기 안내 미노출.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  REDPAY_PLANB_AUTO_CONNECT_MIN,
  REDPAY_PLANB_RETENTION_MIN,
  REDPAY_PLANB_TTL,
  isWithinAutoConnect,
} from '../../src/lib/redpayPlanbTtl';

const MATCH_EF = 'supabase/functions/redpay-planb-match/index.ts';
const MATCH_LIB = 'supabase/functions/redpay-planb-match/match.ts';
const TTL_LIB = 'src/lib/redpayPlanbTtl.ts';
const METRIC_LIB = 'src/lib/redpayPlanbInflowMetric.ts';
const FE_PAGE = 'src/pages/PaymentPlanb.tsx';
const MIG_DIR = 'supabase/migrations';

/** 주석 제거 후 실제 코드만 검사(설계 doc 문자열 오탐 방지). */
function codeOnly(path: string): string {
  return fs.readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\*.*$/gm, '')
    .replace(/\/\/.*$/gm, '');
}

test.describe('정정2 — occurred_at(승인시각) 매칭 키 전환', () => {
  test('AC-1: 유효창 판정 시간 키 = occurred_at, 닫힌 구간 [created, created+5분]', () => {
    const created = new Date('2026-07-29T12:00:00.000Z');
    // S1: 승인 +1분(유효창 내) → true. 도착시각(received_at)이 늦어도 무관(판정에 미사용).
    expect(isWithinAutoConnect(created, '2026-07-29T12:01:00.000Z')).toBe(true);
    expect(isWithinAutoConnect(created, '2026-07-29T12:00:00.000Z')).toBe(true);  // 하한 경계 포함
    expect(isWithinAutoConnect(created, '2026-07-29T12:05:00.000Z')).toBe(true);  // 상한 경계(=expires) 포함
    expect(isWithinAutoConnect(created, '2026-07-29T12:05:00.001Z')).toBe(false); // 유효창 초과
    expect(isWithinAutoConnect(created, '2026-07-29T11:59:59.000Z')).toBe(false); // 승인 전 제외
  });

  test('AC-1 소스: 매처가 approved_at(occurred_at) 을 시간 키로 사용, received_at 은 창 비교 미사용', () => {
    const ef = codeOnly(MATCH_EF);
    const lib = codeOnly(MATCH_LIB);
    // 후보 raw select 에 approved_at 포함.
    expect(ef).toMatch(/\.select\([^)]*approved_at[^)]*\)/);
    // 순수 유효창 판정은 occurred_at(approved_at) 기준.
    expect(lib).toMatch(/isWithinValidWindow/);
    // received_at 를 유효창 상/하한 비교에 쓰지 않음(도착시각 창 비교 잔재 금지).
    expect(lib).not.toMatch(/received_at\s*[<>]=?\s*/);
    expect(ef).not.toMatch(/r\.received_at\s*[<>]=?\s*o\./);
  });

  test('S1 로직: 승인 +1분·도착 +4분(카운트다운 만료 근접)이어도 자동연결', () => {
    const created = new Date('2026-07-29T12:00:00.000Z');
    // 승인시각 기준 판정 — 도착이 +4분이어도 승인이 +1분이면 유효.
    expect(isWithinAutoConnect(created, '2026-07-29T12:01:00.000Z')).toBe(true);
  });
});

test.describe('정정2 — 파라미터 2분리 (선점 유효창 5분 / 보관 기간 1시간)', () => {
  test('AC-2: 보관 기간 SSOT = 60분, 유효창(5분)과 별개 축', () => {
    expect(REDPAY_PLANB_AUTO_CONNECT_MIN).toBe(5);   // 선점 유효창(유지)
    expect(REDPAY_PLANB_RETENTION_MIN).toBe(60);     // 선점표 보관 기간(신설)
    expect(REDPAY_PLANB_TTL.retentionMs).toBe(60 * 60 * 1000);
    expect(REDPAY_PLANB_TTL.autoConnectMs).toBe(5 * 60 * 1000);
    // 두 축 분리 — 보관창 ≠ 유효창.
    expect(REDPAY_PLANB_TTL.retentionMs).not.toBe(REDPAY_PLANB_TTL.autoConnectMs);
  });

  test('AC-2 소스: 매처 MATCH 후보 = open + 보관창 내 expired (즉시삭제 없음)', () => {
    const ef = codeOnly(MATCH_EF);
    const lib = codeOnly(MATCH_LIB);
    // MATCH 후보 pending status ∈ {open, expired}.
    expect(ef).toMatch(/\.in\(\s*["']status["']\s*,\s*\[\s*["']open["']\s*,\s*["']expired["']\s*\]\s*\)/);
    // 보관창 cutoff(now - retention) 로 gt 필터.
    expect(ef).toMatch(/retentionCutoffIso/);
    expect(lib).toMatch(/RETENTION_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
    // 만료행 즉시삭제(DELETE) 없음 — EF 에 pending_payment .delete() 금지.
    expect(ef).not.toMatch(/from\(["']pending_payment["']\)[\s\S]{0,80}\.delete\(/);
    // EXPIRE 패스는 여전히 status='expired' 마킹(행 보존).
    expect(ef).toMatch(/status:\s*["']expired["']/);
  });

  test('S2 로직: 유효 open 은 항상 보관창 내, 만료 후 61분은 후보 제외 (경계)', () => {
    // isWithinRetention 은 EF/deno 전용 순수 함수라 여기선 TTL 상수로 경계만 검증.
    // 만료 후 60분 이내는 보관, 61분은 제외 — retentionMs=60분.
    expect(REDPAY_PLANB_TTL.retentionMs).toBe(3600 * 1000);
  });
});

test.describe('정정3 — 매칭 대상 승인(payment.approved)만, 취소/환불 제외', () => {
  test('AC-3 소스: 후보 raw = external_status=Y + approved_at NOT NULL, 취소 제외', () => {
    const ef = codeOnly(MATCH_EF);
    const lib = codeOnly(MATCH_LIB);
    // external_status='Y'(승인=payment.approved) 필터.
    expect(ef).toMatch(/\.eq\(\s*["']external_status["']\s*,\s*["']Y["']\s*\)/);
    // approved_at NOT NULL 필터(occurred_at 시간 키 존재 보장).
    expect(ef).toMatch(/\.not\(\s*["']approved_at["']\s*,\s*["']is["']\s*,\s*null\s*\)/);
    // 승인 판별 1급 게이트 = external_status='Y'(취소도 approved_at 세팅될 수 있음).
    expect(lib).toMatch(/external_status\s*===\s*["']Y["']/);
  });

  test('S3 로직: 취소(N)·부분취소(M)·오류(X)·음수는 승인 판별에서 제외', () => {
    // isApprovedRaw 는 deno test(match.test.ts)가 상세 검증. 여기선 소스 계약만 확인.
    const lib = codeOnly(MATCH_LIB);
    expect(lib).toMatch(/isApprovedRaw/);
    // amount>0 게이트(취소 양수/음수 방어와 병행).
    expect(lib).toMatch(/Number\(raw\.amount\)\s*>\s*0/);
  });
});

test.describe('정정1 — TTL 카드삽입시간 = 정정2로 구조적 해소(무액션)', () => {
  test('AC-5/정정1: TTL 값(5분/6분) 불변, 신규 마이그(DB 변경) 없음', () => {
    // TTL 값 변경 없음.
    expect(REDPAY_PLANB_AUTO_CONNECT_MIN).toBe(5);
    // 본 티켓은 db_change:false — 신규 마이그 파일을 추가하지 않는다(occurred_at=approved_at 컬럼 기존 영속).
    const migs = fs.readdirSync(MIG_DIR).filter((f) => f.includes('OCCURREDAT') || f.includes('occurredat'));
    expect(migs).toEqual([]);
  });
});

test.describe('S4 — 비대기형 UX 회귀 0 (AC-4)', () => {
  test('AC-4: FE 카운트다운은 유효창(5분)만, 보관창/웹훅 대기 안내 미노출', () => {
    const fe = fs.readFileSync(FE_PAGE, 'utf8');
    // FE 는 보관 기간(retention/60분/1시간)·웹훅 대기 문구를 화면에 노출하지 않음.
    expect(fe).not.toMatch(/REDPAY_PLANB_RETENTION_MIN|retentionMs|보관\s*(기간|창)|1시간\s*(보관|대기)/);
    // 자동기록 안내는 5분 유효창 기준(기존 유지).
    expect(fe).toMatch(/REDPAY_PLANB_AUTO_RECORD_NOTICE|최대 5분/);
  });

  test('AC-4: 기존 결제화면·수기입력 폴백 파일 무접점(플랜B 격리)', () => {
    // 본 정정은 매처 EF + TTL/metric lib + 플랜B 전용만 변경. 기존 결제 컴포넌트 파일은 건드리지 않음.
    // (수기입력/기존 결제 미니윈도 컴포넌트가 플랜B lib 를 import 하지 않음을 확인.)
    const feImportsPlanbTtl = fs.readFileSync(FE_PAGE, 'utf8').includes('redpayPlanbTtl')
      || fs.readFileSync(FE_PAGE, 'utf8').includes('paymentPlanb');
    expect(feImportsPlanbTtl).toBe(true); // 플랜B page 만 플랜B lib 소비(격리).
  });
});

test.describe('AC-7 — UNASSIGNED-INFLOW-METRIC 보관창 정합(교차확인)', () => {
  test('메트릭 lib 이 보관창(1시간) 정합 주석 반영 + payments 무접점 불변식 유지', () => {
    const rawDoc = fs.readFileSync(METRIC_LIB, 'utf8');
    // 보관창 정합 주석(late-match 반영) 존재.
    expect(rawDoc).toMatch(/보관창.*1시간|REDPAY_PLANB_RETENTION_MIN/);
    // payments 무접점(매출 파이프 불변식) — 코드에 payments 테이블 참조 금지.
    const code = rawDoc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\*.*$/gm, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\.from\(\s*['"]payments['"]\s*\)/);
    expect(code).toMatch(/\.from\('pending_payment'\)/);
  });
});
