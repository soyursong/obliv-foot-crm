/**
 * E2E spec — T-20260806-foot-CONSULTCONFIRM-SLACK-DECOUPLE-HARDEN (P1)
 *
 * 상담 배정 [확정] ↔ Slack 상담대기방 발송 decouple resilience (canon-conformance, ADDITIVE).
 *   [확정] 성공 = claim write 영속(rows=1)만으로 성립. Slack 발송 = side-effect(best-effort).
 *   기존 EF 단일출구가 notify 실패(502 channel_not_found)를 [확정] 성공경로에 우발 결합 → 당일 운영정지(P0) = 버그.
 *   → RPC(claim + outbox enqueue 동일 txn) → 2xx → 인라인 best-effort 발송 → 실패 시 outbox 재시도/backoff/DLQ.
 *
 * DA SSOT: da_replies/da_decision_foot_consultconfirm_slack_decouple_harden_20260806.md (GO·ADDITIVE·§3.1 면제).
 *
 * ── 검증 방식(foot 정본 컨벤션) ──
 *   정본 소스 정적 단언(데이터/로그인 비의존) — 형제 foot spec 동형. HARD 계약조건 VG1~VG5 + PHI 가드를
 *   소스 계약으로 못박는다. 실렌더(로그인→채널장애 mock→[확정]→확정성공+발송실패 배지) 3동선은
 *   supervisor 맥스튜디오 실브라우저 단계 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const EF = 'supabase/functions/send-consult-notify/index.ts';
const DISPATCH = 'supabase/functions/consult-notify-dispatch/index.ts';
const SHARED = 'supabase/functions/_shared/consultNotifyDeliver.ts';
const MIG = 'supabase/migrations/20260806210000_foot_consult_notify_outbox_decouple.sql';
const ROLLBACK = 'supabase/migrations/20260806210000_foot_consult_notify_outbox_decouple.rollback.sql';

function confirmHandler(): string {
  const src = read(PAGE);
  const start = src.indexOf('const doConfirmNotify');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('const doSoftHideDrill', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 채널 장애 하 확정 성공 (핵심 회귀) — 발송 실패가 [확정] 성공을 차단하지 않음
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오1-a: EF — claim 영속(RPC) 후 항상 2xx({ok,confirmed}) 반환. 발송실패 non-2xx 전파 제거', () => {
  const src = read(EF);
  // 원자적 claim+enqueue RPC 경유
  expect(src).toContain('enqueue_consult_notify');
  // [확정] 성공 응답은 2xx {ok:true, confirmed:true} — 발송 결과와 독립
  expect(src).toMatch(/return json\(\{\s*ok:\s*true,\s*confirmed:\s*true,\s*enqueued/);
  // 회귀 방지: 발송 실패 시 502 non-2xx 로 전파하던 구 단일출구 제거
  expect(src).not.toContain('Slack 발송 실패: ${sent.error');
  expect(src).not.toMatch(/return json\(\{\s*error:\s*`Slack 발송 실패/);
});

test('시나리오1-b: EF — 발송 실패는 [확정] 성공을 훼손하지 않음(2xx 유지, delivery 부가정보만)', () => {
  const src = read(EF);
  // 발송 결과는 delivery 객체로만 응답 — 2xx 불변
  expect(src).toContain('delivery');
  // 인라인 발송 예외도 비치명 처리(catch → 2xx 유지)
  expect(src).toContain('인라인 발송 예외(비치명');
  // 구 claim 롤백(sending→NULL) 경로 제거 — 이제 claim 은 [확정]으로 영속(발송 실패 시 롤백 안 함)
  expect(src).not.toMatch(/consult_notify_status:\s*null[\s\S]{0,120}consult_notify_by:\s*null/);
});

test('시나리오1-c: FE — 발송 실패 시 확정 성공 토스트 + 발송 gap 인지(VG4). non-2xx 만 진짜 실패 처리', () => {
  const h = confirmHandler();
  // 확정 성공(2xx) 분기에서 delivery.delivered===false 면 확정완료 + 발송실패 안내
  expect(h).toMatch(/res\.delivery.*delivered === false|delivery && res\.delivery\.delivered === false/);
  expect(h).toContain('상담 배정 확정 완료');
  expect(h).toContain('목록의 발송 상태');
  // channel_not_found 는 이제 2xx 경로 → error 분기는 진짜 확정 실패(인증/enqueue)만
  expect(h).toContain('진짜 [확정] 실패');
});

test('시나리오1-d: FE — VG4 발송실패 가시화 배지(dist-notify-failed) 렌더 경로 존재', () => {
  const src = read(PAGE);
  expect(src).toMatch(/notifyStatus === 'failed'/);
  expect(src).toContain('dist-notify-failed-');
  expect(src).toContain('발송실패');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 정상 채널 (delivery 성공 경로) — 확정 + 즉시 delivered
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오2: EF — 정상 채널 인라인 발송 성공 시 outbox delivered + check_ins sent 승격', () => {
  const src = read(EF);
  expect(src).toMatch(/status:\s*"delivered"/);
  // 발송 성공 → check_ins 'sent' 승격(내 'sending' claim 만)
  expect(src).toMatch(/consult_notify_status:\s*"sent"[\s\S]{0,240}eq\("consult_notify_status",\s*"sending"\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 멱등 (중복발송 금지) — claim_id/event_id 멱등키 + delivered 마킹
// ─────────────────────────────────────────────────────────────────────────────
test('VG3 멱등: outbox UNIQUE(event_id=check_in.id) — 재시도/재클릭 중복발송 0', () => {
  const mig = read(MIG);
  expect(mig).toContain('uq_consult_notify_outbox_event');
  expect(mig).toMatch(/UNIQUE INDEX[\s\S]{0,120}\(event_id\)/);
  // enqueue 는 ON CONFLICT(event_id) DO NOTHING (멱등 적재)
  expect(mig).toMatch(/ON CONFLICT \(event_id\) DO NOTHING/);
});

test('VG3 멱등: 종결(delivered/duplicate/failed·dlq) 행 재발송 skip (shared deliver 가드)', () => {
  const shared = read(SHARED);
  expect(shared).toMatch(/if \(row\.dlq \|\| \["delivered", "duplicate", "failed"\]\.includes\(row\.status\)\)/);
  // FE 도 확정건(sent/sending/failed) 재확정 금지
  const h = confirmHandler();
  expect(h).toMatch(/notifyStatus === 'sent' \|\| .*notifyStatus === 'sending' \|\| .*notifyStatus === 'failed'/);
});

// ─────────────────────────────────────────────────────────────────────────────
// HARD 계약조건 VG1~VG5 — 소스 계약 못박기
// ─────────────────────────────────────────────────────────────────────────────
test('VG1 durable enqueue: claim + outbox INSERT 동일 txn(RPC). enqueue 실패 시 RAISE → 롤백(silent drop 0)', () => {
  const mig = read(MIG);
  // enqueue_consult_notify 함수 본문 슬라이스 — claim(check_ins) 과 outbox INSERT 가 같은 함수(=단일 txn) 내.
  const fnStart = mig.indexOf('CREATE OR REPLACE FUNCTION public.enqueue_consult_notify');
  expect(fnStart).toBeGreaterThan(-1);
  const fnEnd = mig.indexOf('COMMENT ON FUNCTION public.enqueue_consult_notify', fnStart);
  expect(fnEnd).toBeGreaterThan(fnStart);
  const fn = mig.slice(fnStart, fnEnd);
  const upIdx = fn.indexOf('UPDATE public.check_ins');
  const insIdx = fn.indexOf('INSERT INTO public.consult_notify_outbox');
  expect(upIdx).toBeGreaterThan(-1);
  expect(insIdx).toBeGreaterThan(upIdx); // claim 후 같은 함수 내 enqueue
  // enqueue 실패(outbox 행 부재) 시 예외 → 전체 롤백 (claim 무효 = [확정]과 함께 실패)
  expect(fn).toMatch(/IF v_outbox_id IS NULL THEN[\s\S]{0,140}RAISE EXCEPTION/);
});

test('VG2 retry+backoff+DLQ: pg_cron worker + 지수 backoff + attempts 소진 DLQ (도파민 표준 이식)', () => {
  const mig = read(MIG);
  expect(mig).toContain('process_consult_notify_outbox');
  expect(mig).toContain("cron.schedule");
  expect(mig).toContain('foot-consult-notify-worker');
  // 지수 backoff (power(2, attempts), cap 60min)
  expect(mig).toMatch(/LEAST\(power\(2, o\.attempts\)::INT, 60\)/);
  const shared = read(SHARED);
  expect(shared).toContain('MAX_ATTEMPTS');
  expect(shared).toMatch(/exhausted[\s\S]{0,200}dlq: true/);
});

test('VG4 발송실패 가시화(load-bearing): DLQ 슬랙알람 + check_ins failed 배지 (최소 1 이상 — 둘 다)', () => {
  const mig = read(MIG);
  // (a) DLQ 슬랙 #infra-alerts 알람
  expect(mig).toContain('alert_consult_notify_dlq');
  expect(mig).toContain('상담대기방 발송 DLQ 신규');
  // (b) check_ins 'failed' → FE 배지 (dispatcher/EF 가 write)
  const shared = read(SHARED);
  expect(shared).toMatch(/consult_notify_status:\s*"failed"/);
  const page = read(PAGE);
  expect(page).toContain('dist-notify-failed-');
});

test('VG5 channel_not_found 종단분류: channel-gone=terminal(즉시 DLQ) / transient=retry (discriminator)', () => {
  const shared = read(SHARED);
  expect(shared).toContain('SLACK_TERMINAL_ERRORS');
  expect(shared).toContain('channel_not_found');
  expect(shared).toContain('classifySlackError');
  // terminal → 즉시 dlq(무한재시도 금지), transient → pending(재시도)
  expect(shared).toMatch(/cls === "terminal"[\s\S]{0,300}dlq: true/);
  expect(shared).toMatch(/status:\s*"pending",\s*error_class:\s*"transient"/);
  // EF 인라인 경로도 동일 discriminator 사용
  const ef = read(EF);
  expect(ef).toContain('classifySlackError');
});

// ─────────────────────────────────────────────────────────────────────────────
// PHI 가드 (dev-foot verify-gate 판정: PASS — payload 운영메타만, 성명은 발송시점 해소)
// ─────────────────────────────────────────────────────────────────────────────
test('PHI 가드: outbox payload 는 운영메타(check_in_id/clinic_id/inflow)만 — 환자 성명 미저장', () => {
  const mig = read(MIG);
  // enqueue payload = check_in_id/clinic_id/inflow 만 (customer_name/차트/전화 미포함)
  const enqStart = mig.indexOf('INSERT INTO public.consult_notify_outbox');
  const enqEnd = mig.indexOf('ON CONFLICT (event_id) DO NOTHING', enqStart);
  const enq = mig.slice(enqStart, enqEnd);
  expect(enq).toContain("'check_in_id'");
  expect(enq).toContain("'inflow'");
  expect(enq).not.toContain('customer_name');
  // 성명·mention 은 dispatcher 가 발송시점 check_ins/staff 에서 server-authoritative 해소
  const shared = read(SHARED);
  expect(shared).toMatch(/customer_name[\s\S]{0,200}발송시점|발송시점[\s\S]{0,200}해소|해소/);
  expect(shared).toContain('.from("check_ins")');
});

// ─────────────────────────────────────────────────────────────────────────────
// 안전 불변 — RED LINE INV-1 (매출귀속 무접촉) + 롤백 대칭(ADDITIVE)
// ─────────────────────────────────────────────────────────────────────────────
test('안전 불변: RED LINE INV-1 — RPC/EF/shared 어디도 consultant_id/assigned_consultant_id write 0', () => {
  for (const f of [MIG, EF, SHARED, DISPATCH]) {
    const src = read(f);
    expect(src).not.toMatch(/(SET|update\(\{)[^;]*assigned_consultant_id\s*[:=]/);
    // consultant_id 는 SET/update 대상 아님 (읽기만) — write 패턴 부재
    expect(src).not.toMatch(/consult_notify[\s\S]{0,40}\bconsultant_id:\s*[^,\n]+,\s*consult_notify/);
  }
});

test('안전 불변: 롤백 대칭(ADDITIVE) — table/fn/cron 전량 제거 + CHECK 2값 원복', () => {
  const rb = read(ROLLBACK);
  expect(rb).toContain('DROP TABLE IF EXISTS public.consult_notify_outbox');
  expect(rb).toContain("cron.unschedule('foot-consult-notify-worker')");
  expect(rb).toContain('DROP FUNCTION IF EXISTS public.enqueue_consult_notify');
  // CHECK 원복 = 2값('sending','sent')
  expect(rb).toMatch(/consult_notify_status IN \('sending','sent'\)/);
  // dopamine_callback_outbox 무접촉 언급(순소실 0)
  expect(rb).toContain('dopamine_callback_outbox');
});

test('안전 불변: CHECK 확장 ADDITIVE — failed 추가(기존 sending/sent 무변경)', () => {
  const mig = read(MIG);
  expect(mig).toMatch(/consult_notify_status IN \('sending','sent','failed'\)/);
});
