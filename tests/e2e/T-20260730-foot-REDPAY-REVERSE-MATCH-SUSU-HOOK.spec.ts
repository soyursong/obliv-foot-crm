/**
 * Contract spec — T-20260730-foot-REDPAY-REVERSE-MATCH-SUSU-HOOK-BUILD
 *   SSOT = da_consult_reply_foot_redpay_reverse_match_susu_hook_20260730.md
 *   decision_id = DA-20260730-FOOT-REDPAY-REVERSE-MATCH-SUSU-HOOK · verdict=GO · change-class=no-DDL
 *
 * 목적: 레드페이 역방향 매칭([수납] 저장 훅)의 정책 계약이 SSOT(redpayPlanbTtl) · 순수 로직 모듈
 *   (reverseMatch.ts) · AC 불변식에 drift 없이 반영됐는지 검증. 매칭은 backend 판정이므로 browser 무접점 —
 *   판정 로직 자체는 deno 단위테스트(deno test supabase/functions/_shared/reverseMatch.test.ts, 21 tests)로
 *   전수 검증하고, 본 spec 은 (a) SSOT 계약(E-1 파라미터 2분리) (b) 시나리오 1~4 불변식 소스 (c) AC 소스 무결성을 커버한다.
 *
 * ── precondition 실측(착수 前, READ-ONLY) 결과 ────────────────────────────────────
 *   ① payment_reconciliation_log.event_type CHECK 부재(자유텍스트) → 'reverse_matched' 추가 = 진성 no-DDL
 *      (CHECK-widen ADDITIVE 아님, db_change=false). 현행 값: missing_in_crm/missing_at_van/match_failed/auto_matched.
 *   ② prod payments: external_approval_no·external_tid 실재 ✅. pg_provider·paid_at 컬럼 부재(§788 canonical≠prod)
 *      → AC2 pg_provider='redpay' = method='card'+external_* 로 매핑, AC4 paid_at = accounting_date 앵커(SSOT confirm 게이트).
 *
 * ── 시나리오(DA E2E 요구 1~4) ────────────────────────────────────────────────────
 *   S1. 자동연결   — 단일 승인·동금액·유효창(5분) 내 미매칭 raw 1건 → matched(1 raw : 1 payment).
 *   S2. no-op      — 후보 없음/모호/비대상 → 기존 수납 흐름 완전 무변경(대원칙 §2).
 *   S3. 멱등/race  — raw.id 앵커 소비(claim rows-affected=1) — 패자(webhook/타표면)는 후보에서 배제(중복입금 0).
 *   S4. 보관창 경계 — 역방향 유효창(5분, 신뢰창) ≠ raw 보관창(1h) 분리(E-1). 창 경계 닫힌구간.
 *
 * ── write-path 배선 확정(planner D1~D4, MSG-20260730-160252) ──────────────────────
 *   D1 원자성 = EF claim-first(신규 RPC 없음 → no-DDL). raw claim UPDATE(WHERE matched_payment_id IS NULL,
 *     rows-affected=1)가 유일 직렬화점. D2 race-loss = payment 유지(annotate-on-existing, 삭제 금지).
 *   D3 매출-일자 앵커 = accounting_date = raw.approved_at KST. D4 cue.paid = annotate-on-existing parity(재발화 없음).
 *   → 라이브 write-path = EF(redpay-reverse-match) + client lib(redpayReverseMatch) + [수납] 훅(manualPaymentWritePath).
 *   실 매칭 판정은 deno(reverseMatch.test.ts 21) 전수검증, write-path 오케스트레이션 불변식은 아래 S1~S4 소스계약으로 고정.
 *   (backend 매칭·seeded raw 대조는 browser 무접점 → false-green 금지 원칙 하에 소스계약으로 검증.)
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  REDPAY_REVERSE_MATCH_WINDOW_MIN,
  REDPAY_PLANB_RETENTION_MIN,
  REDPAY_PLANB_TTL,
} from '../../src/lib/redpayPlanbTtl';

// Playwright 는 repo root 에서 실행 → CWD 상대경로(기존 planb spec 컨벤션).
const REVERSE_SRC = 'supabase/functions/_shared/reverseMatch.ts';
const EF_SRC = 'supabase/functions/redpay-reverse-match/index.ts';
const CLIENT_SRC = 'src/lib/redpayReverseMatch.ts';
const HOOK_SRC = 'src/lib/manualPaymentWritePath.ts';
const readReverse = () => fs.readFileSync(REVERSE_SRC, 'utf8');
const readEf = () => fs.readFileSync(EF_SRC, 'utf8');
const readClient = () => fs.readFileSync(CLIENT_SRC, 'utf8');
const readHook = () => fs.readFileSync(HOOK_SRC, 'utf8');

// ── (a) SSOT 계약 — E-1 파라미터 2분리 ───────────────────────────────────────────
test('E-1: 역방향 유효창(5분) ≠ raw 보관창(1h) — 별개 축 분리', () => {
  expect(REDPAY_REVERSE_MATCH_WINDOW_MIN).toBe(5);    // 역방향 자동대조 유효창(총괄 확정 2026-07-30, 10분 철회)
  expect(REDPAY_PLANB_RETENTION_MIN).toBe(60);        // raw 보관창(기존, 불변)
  expect(REDPAY_REVERSE_MATCH_WINDOW_MIN).not.toBe(REDPAY_PLANB_RETENTION_MIN); // 목적 상이 → 한 값으로 묶지 않음
  expect(REDPAY_PLANB_TTL.reverseMatchWindowMs).toBe(5 * 60 * 1000);
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

// ── (b) 시나리오 1~4 — write-path 오케스트레이션 소스계약(D1~D4 · 활성) ─────────────────
//   supervisor 매출정합 diff 게이트 불변식을 소스로 고정: payment 1회계상·orphan 방지(check_in 결속)·
//   raw-claim rows-affected=1·매출일자=accounting_date=approved_at·race 패자 payment 유지·이중귀속0.

test('S1 자동연결 — [수납] 카드 저장 훅 → EF 트리거 배선 + 3-write claim-first(D1)', () => {
  // (1) [수납] 훅: 카드행 저장 후 역방향 매칭 트리거(fire-and-forget)가 배선됐는가.
  const hook = readHook();
  expect(hook).toMatch(/triggerReverseMatchForCardPayments/);
  expect(hook).toMatch(/fireReverseMatchIfCard/);
  expect(hook).toMatch(/splits\.some\(\(s\) => s\.method === 'card'\)/); // 카드 있을 때만 트리거

  // (2) client lib: EF 이름 SSOT 참조 + fire-and-forget(throw 안 함).
  const client = readClient();
  expect(client).toMatch(/EDGE_FUNCTIONS\.REDPAY_REVERSE_MATCH/);
  expect(client).toMatch(/payment_id: paymentId/);

  // (3) EF: claim-first 3-write — ① raw claim ② payment annotate ③ reconciliation_log.
  const ef = readEf();
  expect(ef).toMatch(/buildReverseClaimUpdate/);            // ① claim
  expect(ef).toMatch(/buildReverseMatchPaymentUpdate\(raw, reconNow, \/\* includeAccountingDate \*\/ true\)/); // ② D3 앵커
  expect(ef).toMatch(/buildReverseReconLogRow/);            // ③ reverse_matched 로그
});

test('S1b 직렬화점 = raw claim rows-affected=1(D1 · Write-Rowcheck)', () => {
  const ef = readEf();
  // claim UPDATE 에 WHERE matched_payment_id IS NULL 가드(.is(..., null)) + rows-affected=1 검증.
  expect(ef).toMatch(/\.is\("matched_payment_id", null\)/);
  expect(ef).toMatch(/claimed\.length !== 1/);
  // payment annotate 도 rows-affected=1 검증(silent write-failure 금지).
  expect(ef).toMatch(/payUpdated\.length !== 1/);
});

test('S2 no-op — 후보 없음/모호/비대상 = 기존 수납 흐름 무변경(AC5·§2)', () => {
  const ef = readEf();
  // matched 아니면 claim/annotate 진입 전 return(payment 무접촉).
  expect(ef).toMatch(/decision\.reason !== "matched"/);
  expect(ef).toMatch(/not_card_payment/);
  // 훅은 fire-and-forget(void) — 트리거 실패가 [수납] 저장을 블록하지 않음.
  const hook = readHook();
  expect(hook).toMatch(/void triggerReverseMatchForCardPayments/);
  const client = readClient();
  expect(client).toMatch(/non-fatal/); // 예외 흡수(throw 안 함)
});

test('S3 멱등/race — claim 패자(rows=0) payment 유지·annotate 미진입(D2, 이중귀속0)', () => {
  const ef = readEf();
  // race-loss: claim 0-row → matched:false, reason=race_lost 로 반환(payment annotate 진입 안 함).
  expect(ef).toMatch(/race_lost/);
  // annotate 실패 시 rollback = raw 링크만 원복(payment 삭제/금액 무접촉 = D2).
  expect(ef).toMatch(/buildReverseClaimRollback/);
  const reverse = readReverse();
  // rollback payload 에 payment 를 지우는 키가 없음(D2 annotate-on-existing).
  expect(reverse).toMatch(/buildReverseClaimRollback[\s\S]*matched_payment_id: null, match_rule: null/);
});

test('S4 보관창 경계 — 유효창(5분) ≠ 보관창(1h) + orphan 방지(check_in 결속)', () => {
  const ef = readEf();
  // 조회 pool = 보관창 1h(REVERSE_MATCH_RETENTION_MS) 하한. 실 유효창 5분 필터는 순수모듈이 적용.
  expect(ef).toMatch(/REVERSE_MATCH_RETENTION_MS/);
  expect(ef).toMatch(/selectReverseMatchCandidate/);
  // D3 매출-일자 앵커 = accounting_date(응답에 실려 supervisor diff 관측).
  expect(ef).toMatch(/accounting_date/);
  // orphan 방지 — 이미 대사된(reconciled_at≠NULL) payment 재-annotate 금지(멱등).
  expect(ef).toMatch(/already_reconciled/);
});
