/**
 * Contract spec — T-20260730-foot-REDPAY-REVERSE-MATCH-SUSU-HOOK-BUILD
 *   SSOT = da_consult_reply_foot_redpay_reverse_match_susu_hook_20260730.md
 *   decision_id = DA-20260730-FOOT-REDPAY-REVERSE-MATCH-SUSU-HOOK · verdict=GO · change-class=no-DDL
 *
 * 목적: 레드페이 역방향 매칭([수납] 저장 훅)의 정책 계약이 SSOT(redpayPlanbTtl) · 순수 로직 모듈
 *   (reverseMatch.ts) · AC 불변식에 drift 없이 반영됐는지 검증. 매칭은 backend 판정이므로 browser 무접점 —
 *   판정 로직 자체는 deno 단위테스트(deno test supabase/functions/redpay-reconcile/reverseMatch.test.ts, 17 tests)로
 *   전수 검증하고, 본 spec 은 (a) SSOT 계약(E-1 파라미터 2분리) (b) 시나리오 1~4 불변식 소스 (c) AC 소스 무결성을 커버한다.
 *
 * ── precondition 실측(착수 前, READ-ONLY) 결과 ────────────────────────────────────
 *   ① payment_reconciliation_log.event_type CHECK 부재(자유텍스트) → 'reverse_matched' 추가 = 진성 no-DDL
 *      (CHECK-widen ADDITIVE 아님, db_change=false). 현행 값: missing_in_crm/missing_at_van/match_failed/auto_matched.
 *   ② prod payments: external_approval_no·external_tid 실재 ✅. pg_provider·paid_at 컬럼 부재(§788 canonical≠prod)
 *      → AC2 pg_provider='redpay' = method='card'+external_* 로 매핑, AC4 paid_at = accounting_date 앵커(SSOT confirm 게이트).
 *
 * ── 시나리오(DA E2E 요구 1~4) ────────────────────────────────────────────────────
 *   S1. 자동연결   — 단일 승인·동금액·유효창(10분) 내 미매칭 raw 1건 → matched(1 raw : 1 payment).
 *   S2. no-op      — 후보 없음/모호/비대상 → 기존 수납 흐름 완전 무변경(대원칙 §2).
 *   S3. 멱등/race  — raw.id 앵커 소비(claim rows-affected=1) — 패자(webhook/타표면)는 후보에서 배제(중복입금 0).
 *   S4. 보관창 경계 — 역방향 유효창(10분, 신뢰창) ≠ raw 보관창(1h) 분리(E-1). 창 경계 닫힌구간.
 *
 * ⚠ 라이브 write-path(RPC/EF + FE 배선 + cue.paid SoT emit + AC4 매출-일자 필드 확정)는 planner FOLLOWUP
 *   아키텍처 confirm 게이트 이후 배선 → 해당 browser 시나리오는 test.fixme 로 보류(false-green 금지).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  REDPAY_REVERSE_MATCH_WINDOW_MIN,
  REDPAY_PLANB_RETENTION_MIN,
  REDPAY_PLANB_TTL,
} from '../../src/lib/redpayPlanbTtl';

// Playwright 는 repo root 에서 실행 → CWD 상대경로(기존 planb spec 컨벤션).
const REVERSE_SRC = 'supabase/functions/redpay-reconcile/reverseMatch.ts';
const readReverse = () => fs.readFileSync(REVERSE_SRC, 'utf8');

// ── (a) SSOT 계약 — E-1 파라미터 2분리 ───────────────────────────────────────────
test('E-1: 역방향 유효창(10분) ≠ raw 보관창(1h) — 별개 축 분리', () => {
  expect(REDPAY_REVERSE_MATCH_WINDOW_MIN).toBe(10);   // 역방향 자동대조 유효창(총괄 v2 제안)
  expect(REDPAY_PLANB_RETENTION_MIN).toBe(60);        // raw 보관창(기존, 불변)
  expect(REDPAY_REVERSE_MATCH_WINDOW_MIN).not.toBe(REDPAY_PLANB_RETENTION_MIN); // 목적 상이 → 한 값으로 묶지 않음
  expect(REDPAY_PLANB_TTL.reverseMatchWindowMs).toBe(10 * 60 * 1000);
  expect(REDPAY_PLANB_TTL.retentionMs).toBe(60 * 60 * 1000);
});

// ── (c) AC 소스 무결성 — reverseMatch.ts 불변식 소스 검증 ─────────────────────────
test('AC5·E-2④: 멱등 앵커 = raw.id(단독 유일키). trxid 단독 링크 금지', () => {
  const src = readReverse();
  // claim/후보 앵커가 raw.id 기반(used 집합·matched_payment_id IS NULL)임을 소스로 고정.
  expect(src).toMatch(/matched_payment_id === null/);
  expect(src).toMatch(/used\.has\(r\.id\)/);
  // trxid/approval_no 는 annotate corroborator 일 뿐 후보선택 술어가 아님(단독키 금지 주석 고정).
  expect(src).toMatch(/단독 유일키|corroborator|단독키 금지|단독 링크 금지/);
});

test('E-2①: 승인만(external_status=Y). 취소/환불(N/M/X) 제외', () => {
  const src = readReverse();
  expect(src).toMatch(/external_status === "Y"/);
  expect(src).toMatch(/isApprovedReverseRaw/);
});

test('E-2②: 금액 완전일치 + 같은 clinic', () => {
  const src = readReverse();
  expect(src).toMatch(/Number\(r\.amount\) === Number\(payment\.amount\)/);
  expect(src).toMatch(/r\.clinic_id === payment\.clinic_id/);
});

test('E-2③: 같은금액 창내 후보 2건+ → ambiguous_multi(자동 스킵)', () => {
  const src = readReverse();
  expect(src).toMatch(/candidates\.length > 1/);
  expect(src).toMatch(/ambiguous_multi/);
});

test('AC4: 매출-일자 앵커 = approved_at KST 일자(감지·저장 시각 아님)', () => {
  const src = readReverse();
  expect(src).toMatch(/anchorAccountingDateKst/);
  expect(src).toMatch(/9 \* 60 \* 60 \* 1000/); // KST(UTC+9) 변환
  // 앵커 원천이 approved_at 임을 소스로 고정(now/detected 아님).
  expect(src).toMatch(/approved_at.*KST|approved_at\(승인시각\)/);
});

test('AC1: 비대상/후보없음/모호 = no-op(기존 수납 흐름 무변경)', () => {
  const src = readReverse();
  expect(src).toMatch(/not_card_payment/);
  expect(src).toMatch(/no_candidate/);
  // method='card' ∧ payment_type='payment' 만 대상.
  expect(src).toMatch(/payment\.method !== "card"/);
  expect(src).toMatch(/payment\.payment_type !== "payment"/);
});

test('AC8: event_type=reverse_matched(신규 값) — precondition 실측 no-DDL(CHECK 부재)', () => {
  const src = readReverse();
  // no-DDL 확정(CHECK 부재 → 자유텍스트) 근거가 모듈 헤더에 명시됐는지.
  expect(src).toMatch(/no-DDL/);
  expect(src).toMatch(/event_type CHECK 부재|CHECK 부재/);
});

// ── (b) 시나리오 1~4 — 라이브 write-path 배선 후 활성(FOLLOWUP 아키텍처 confirm 게이트) ──────
test.fixme('S1 자동연결(browser) — [수납] 카드 저장 시 유효창 내 미매칭 raw 자동연결·승인번호 표시', async () => {
  // gated: RPC/EF write-path + FE 배선 confirm 후. 판정 로직은 reverseMatch.test.ts S1 커버.
});
test.fixme('S2 no-op(browser) — 후보 없음/모호 시 수납만 저장, external_* 미부착', async () => {});
test.fixme('S3 멱등/race(browser) — webhook auto-match 와 동시 → raw.id claim 승자만, 중복입금 0', async () => {});
test.fixme('S4 보관창 경계(browser) — 유효창 10분 초과 승인 raw 는 저장훅 자동연결 안 됨(수동 폴백)', async () => {});
