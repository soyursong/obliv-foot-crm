/**
 * Contract spec — T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD (build 코어)
 *
 * 목적: 비대기형(NOWAIT) 결제페이지 build 코어(FE route + pending_payment write + 매칭 EF + 만료 cron)
 *   의 계약·불변식을 순수 로직·소스 검증(browser 무접점, CI 결정적)으로 고정.
 *   실 브라우저/단말/cron 통합은 macstudio + 갤탭 field-soak 으로 검증(외부 단말·server cron 의존).
 *
 * 현장 클릭 시나리오(티켓) → 계약 매핑:
 *   S1(정상 자동매칭): C2(선점 write=open+SSOT TTL) · C3(즉시전환·대기0) · C4(안내문구) · C7(매칭 EF)
 *   S2(만료→수기폴백):  C5(만료 EF expires_at 비교) · C8(폴백 UI)
 *   S3(기존화면 불변):  C1(기능플래그 게이트 — OFF 시 진입버튼 null·route 리다이렉트)
 *   S4(금액불일치/잠금): C6(매칭=금액 동일 + 모호그룹 스킵 + raw 재사용 금지)
 *
 * 공통 불변식:
 *   INV-A pending_payment 은 payments write 안 함(§550 Model A, 매출 무접점).
 *   INV-B 매칭 방향 = matched_raw_txid(raw 역참조), matched_payment_id 신설 금지(§789).
 *   INV-C TTL 판정 = app-set expires_at/locked_until 비교(EF 에 5/6 상수 재복제 0, divergence 0).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  REDPAY_PLANB_AUTO_RECORD_NOTICE,
  computeExpiresAt,
  computeLockedUntil,
} from '../../src/lib/redpayPlanbTtl';

const LIB = 'src/lib/paymentPlanb.ts';
const HOOK = 'src/hooks/usePlanbClaimStatus.ts';
const PAGE = 'src/pages/PaymentPlanb.tsx';
const ENTRY = 'src/components/PlanbPaymentEntryButton.tsx';
const APP = 'src/App.tsx';
const CHECKIN = 'src/components/CheckInDetailSheet.tsx';
const EF = 'supabase/functions/redpay-planb-match/index.ts';
const CRON = 'supabase/migrations/20260729130000_foot_redpay_planb_match_cron.sql';
const CRON_RB = 'supabase/migrations/20260729130000_foot_redpay_planb_match_cron.rollback.sql';

const read = (p: string) => fs.readFileSync(p, 'utf8');
/** 주석 제거 후 실제 코드만(주석 doc 문자열 오탐 방지). */
const codeOf = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\*.*$/gm, '')
    .replace(/\/\/.*$/gm, '');

// ── S3 / C1: 기능플래그 게이트 (기존 화면 불변 회귀 가드) ──────────────────────
test.describe('C1 기능플래그 게이트 — OFF 시 신규 노출 0 (S3 회귀 가드)', () => {
  test('C1a: isPaymentPlanbEnabled 은 on|1|true 만 활성(기본 OFF)', () => {
    const code = codeOf(LIB);
    expect(code).toMatch(/VITE_PAYMENT_PLANB/);
    expect(code).toMatch(/raw === 'on' \|\| raw === '1' \|\| raw === 'true'/);
  });
  test('C1b: 진입 버튼은 플래그 OFF 시 null 반환(기존 CheckInDetailSheet 무변경)', () => {
    const code = codeOf(ENTRY);
    expect(code).toMatch(/if \(!isPaymentPlanbEnabled\(\)\) return null/);
  });
  test('C1c: PaymentPlanb route 는 플래그 OFF 시 /admin 리다이렉트', () => {
    const code = codeOf(PAGE);
    expect(code).toMatch(/if \(!enabled\) return <Navigate to="\/admin" replace/);
  });
  test('C1d: CheckInDetailSheet 진입점은 격리 컴포넌트 1줄만 추가(기존 결제등록 버튼 보존)', () => {
    const code = codeOf(CHECKIN);
    expect(code).toMatch(/<PlanbPaymentEntryButton /);
    // 기존 수기 결제등록 진입점(data-testid) 은 그대로 존재(무변경).
    expect(code).toMatch(/btn-chart1-payment-register/);
  });
  test('C1e: App.tsx 에 payment-planb 신규 route 등록(기존 /payment 미니창과 분리)', () => {
    const code = codeOf(APP);
    expect(code).toMatch(/path="payment-planb\/:checkInId"/);
    expect(code).toMatch(/PaymentPlanb/);
  });
});

// ── S1 / C2: 선점 write = open + SSOT TTL app-set ─────────────────────────────
test.describe('C2 선점 write — status=open + expires_at/locked_until SSOT app-set', () => {
  test('C2a: INSERT status=open, expires_at/locked_until 을 computeExpiresAt/LockedUntil 로 app-set', () => {
    const code = codeOf(LIB);
    expect(code).toMatch(/status: 'open'/);
    expect(code).toMatch(/expires_at: expiresAtIso/);
    expect(code).toMatch(/locked_until: lockedUntilIso/);
    expect(code).toMatch(/computeExpiresAt\(now\)/);
    expect(code).toMatch(/computeLockedUntil\(now\)/);
  });
  test('C2b: SSOT 계산 = created_at + 5분/6분 (write-time 정책 단일소스)', () => {
    const created = new Date('2026-07-29T10:00:00.000Z');
    expect(computeExpiresAt(created).toISOString()).toBe('2026-07-29T10:05:00.000Z');
    expect(computeLockedUntil(created).toISOString()).toBe('2026-07-29T10:06:00.000Z');
  });
  test('C2c: open 중복선점(23505) 은 throw 아닌 duplicate_open 안내로 전환', () => {
    const code = codeOf(LIB);
    expect(code).toMatch(/23505/);
    expect(code).toMatch(/duplicate_open/);
  });
  test('INV-A: 선점 write lib 은 payments 를 write 하지 않음(매출 무접점)', () => {
    const code = codeOf(LIB);
    expect(code).not.toMatch(/\.from\(\s*['"]payments['"]\s*\)/);
    expect(code).toMatch(/\.from\('pending_payment'\)/);
  });
});

// ── S1 / C3·C4: 즉시전환(대기0) + 안내문구 ────────────────────────────────────
test.describe('C3·C4 비대기형 UX — 즉시전환 + 안내문구', () => {
  test('C3: 제출 성공 즉시 pendingId 세팅으로 화면 전환(단말 대기 FE 호출 없음)', () => {
    const code = codeOf(PAGE);
    expect(code).toMatch(/setPendingId\(res\.id!\)/);
    // 카드 단말 호출 FE 코드 부재(fire-and-forget) — kovan/CAT/terminal 무접점.
    expect(code).not.toMatch(/kovan|KOVAN|\bCAT\b/);
  });
  test('C4: 안내 문구 = "결제는 최대 5분 내 자동 기록"', () => {
    expect(REDPAY_PLANB_AUTO_RECORD_NOTICE).toBe('결제는 최대 5분 내 자동 기록');
    const code = codeOf(PAGE);
    expect(code).toMatch(/planb-auto-record-notice/);
    expect(code).toMatch(/REDPAY_PLANB_AUTO_RECORD_NOTICE/);
  });
  test('C3b: 폴링 훅은 terminal 상태(matched/expired/failed/cancelled) 도달 시 폴링 정지', () => {
    const code = codeOf(HOOK);
    expect(code).toMatch(/isTerminalStatus/);
    expect(code).toMatch(/return false/); // terminal 이면 refetchInterval=false
  });
});

// ── S1 / C7 + S4 / C6: 매칭 EF 불변식 ─────────────────────────────────────────
test.describe('C7·C6 매칭 EF — 예상금액 매칭 + 충돌 안전 + 불변식', () => {
  test('C7: matched 전이 시 matched_raw_txid/matched_at set (raw 역참조 방향)', () => {
    const code = codeOf(EF);
    expect(code).toMatch(/status:\s*"matched"/);
    expect(code).toMatch(/matched_raw_txid:\s*raw\.id/);
    expect(code).toMatch(/matched_at:\s*nowIso/);
  });
  test('INV-B: matched_payment_id(payments 역참조) 신설 금지(§789)', () => {
    const code = codeOf(EF);
    expect(code).not.toMatch(/matched_payment_id/);
  });
  test('INV-A(EF): EF 는 payments 를 write/select 하지 않음(선점표 전용, §550)', () => {
    const code = codeOf(EF);
    expect(code).not.toMatch(/\.from\(\s*['"]payments['"]\s*\)/);
    expect(code).toMatch(/\.from\("pending_payment"\)/);
  });
  test('INV-C: EF 매칭은 app-set expires_at 비교(5/6 상수 재복제 0)', () => {
    const code = codeOf(EF);
    // 유효창 = now < expires_at, 만료 = now >= expires_at (컬럼 비교, 상수 없음)
    expect(code).toMatch(/\.gt\("expires_at",\s*nowIso\)/);
    expect(code).toMatch(/\.lte\("expires_at",\s*nowIso\)/);
    // EF 소스에 분 상수(5/6)로 TTL 재계산하는 코드 없음.
    expect(code).not.toMatch(/interval '5 minutes'|\* 60 \* 1000|autoConnectMs|lockMs/);
  });
  test('C6a: 매칭 후보 = 승인(Y) + 웹훅 수신(received_at NOT NULL) + amount>0', () => {
    const code = codeOf(EF);
    expect(code).toMatch(/\.eq\("external_status",\s*"Y"\)/);
    expect(code).toMatch(/\.not\("received_at",\s*"is",\s*null\)/);
    expect(code).toMatch(/\.gt\("amount",\s*0\)/);
  });
  test('C6b: 예상금액 동일 매칭(S4 금액 불일치 시 자동매칭 안 됨)', () => {
    const code = codeOf(EF);
    expect(code).toMatch(/Number\(r\.amount\)\s*===\s*Number\(o\.expected_amount\)/);
    // 수신시각이 자동연결 유효창 내: created_at <= received_at < expires_at
    expect(code).toMatch(/r\.received_at >= o\.created_at/);
    expect(code).toMatch(/r\.received_at < o\.expires_at/);
  });
  test('C6c: 같은 (clinic,amount) open 2건+ = 모호 → 자동매칭 스킵(수기 폴백)', () => {
    const code = codeOf(EF);
    expect(code).toMatch(/if \(list\.length > 1\)/);
    expect(code).toMatch(/skippedAmbiguous/);
  });
  test('C6d: raw 재사용 금지(다른 선점 소비분 + 이번 실행 내 이중매칭 가드)', () => {
    const code = codeOf(EF);
    expect(code).toMatch(/usedTxids/);
    expect(code).toMatch(/localUsed/);
  });
  test('C7b: matched 전이는 WHERE status=open 재확인(동시성 가드)', () => {
    const code = codeOf(EF);
    expect(code).toMatch(/\.eq\("id",\s*o\.id\)\s*\n?\s*\.eq\("status",\s*"open"\)/);
  });
  test('EF 인증 = X-Internal-Cron 또는 service_role bearer', () => {
    const code = codeOf(EF);
    expect(code).toMatch(/x-internal-cron/);
    expect(code).toMatch(/isServiceRole/);
    expect(code).toMatch(/return json\(401/);
  });
});

// ── S2 / C5: 만료 EF (open → expired) ─────────────────────────────────────────
test.describe('C5 만료 EF — now()>=expires_at open → expired (S2 수기 폴백)', () => {
  test('C5a: 만료 패스 = status open + expires_at <= now → expired', () => {
    const code = codeOf(EF);
    expect(code).toMatch(/status:\s*"expired"/);
    expect(code).toMatch(/\.eq\("status",\s*"open"\)/);
    expect(code).toMatch(/\.lte\("expires_at",\s*nowIso\)/);
  });
  test('C8: 만료/실패 상태에서 수기입력 폴백 안내 UI 노출', () => {
    const code = codeOf(PAGE);
    expect(code).toMatch(/planb-expired-fallback/);
    expect(code).toMatch(/수기/);
    expect(code).toMatch(/claimStatus === 'expired' \|\| claimStatus === 'failed'/);
  });
});

// ── 만료/매칭 cron 마이그 (ADDITIVE 계약) ─────────────────────────────────────
test.describe('CRON 마이그 — ADDITIVE(함수+cron job), 파괴적 변경 0', () => {
  test('CRON-a: 1분 주기 cron 등록 + trigger 함수 net.http_post → redpay-planb-match EF', () => {
    const up = read(CRON);
    expect(up).toMatch(/cron\.schedule\(\s*\n?\s*'foot-redpay-planb-match'/);
    expect(up).toMatch(/'\* \* \* \* \*'/); // 매 1분
    expect(up).toMatch(/functions\/v1\/redpay-planb-match/);
    expect(up).toMatch(/CREATE OR REPLACE FUNCTION public\.trigger_redpay_planb_match/);
  });
  test('CRON-b: 신규 컬럼/테이블/enum 0 (DA CONSULT 대상 아님, supervisor DDL-diff 만)', () => {
    const up = read(CRON);
    expect(up).not.toMatch(/CREATE TABLE|ADD COLUMN|DROP COLUMN|CREATE TYPE|ALTER TYPE|ADD CONSTRAINT/);
  });
  test('CRON-c: rollback 은 cron job + 함수만 제거(테이블 무접촉, 데이터 손실 0)', () => {
    const rb = read(CRON_RB);
    expect(rb).toMatch(/cron\.unschedule\('foot-redpay-planb-match'\)/);
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS public\.trigger_redpay_planb_match/);
    expect(rb).not.toMatch(/DROP TABLE|DROP COLUMN/);
  });
});
