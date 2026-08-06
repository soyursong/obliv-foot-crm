/**
 * E2E spec — T-20260806-foot-CONSULTCONFIRM-SLACK-DECOUPLE-HARDEN (P1 resilience)
 *
 * 배경(P0 회고): send-consult-notify EF 의 Slack 발송 502(channel_not_found) 하나가 상담 배정 [확정] 전체를
 *   차단(당일 P0). claim(consult_notify_status='sending')은 rows=1 영속했으나, 그 뒤 Slack 실패가 EF 단일출구(502)로
 *   non-2xx 전파 → FE 가 [확정] 실패로 오인.
 *
 * DA CONSULT-REPLY(MSG-20260806-181946-wbis): GO(조건부)·ADDITIVE. [확정] 성공 = claim 영속(rows=1)만으로 성립,
 *   Slack 발송 = side-effect. HARD 계약 5항(VG1~VG5) + PHI 가드 전건 충족이 GO 조건.
 *
 * 검증 매핑:
 *   VG1 durable enqueue(atomicity) — enqueue_consult_notify RPC 가 claim+outbox 를 단일 txn 원자 영속.
 *   VG2 retry+backoff+DLQ         — process_consult_notify_outbox worker(분당) + 지수 backoff + attempts>=7 DLQ.
 *   VG3 멱등 anchor               — event_id=check_in_id UNIQUE + ON CONFLICT DO NOTHING.
 *   VG4 발송실패 가시화            — check_ins 'failed' 배지 + alert_consult_notify_dlq 슬랙 알람.
 *   VG5 channel_not_found 종단분류 — dlq_reason='channel_gone' 즉시 terminal(무한 재시도 금지).
 *   PHI 가드                       — outbox payload=운영 메타 only(고객명 미영속, 발송시점 재조회).
 *
 * 정본 소스 정적 단언(데이터/로그인 비의존) — 형제 foot spec 동형. 실렌더(채널장애 하 확정 성공/배지/멱등)는
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
const MIG = 'supabase/migrations/20260807120000_foot_consult_notify_outbox_decouple.sql';
const ROLLBACK = 'supabase/migrations/20260807120000_foot_consult_notify_outbox_decouple.rollback.sql';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 (핵심 회귀): 채널 장애 하에도 [확정] 성공 — Slack 실패 non-2xx 전파 제거
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오1: Slack 발송 실패가 더 이상 [확정]을 502 로 차단하지 않음 (구 단일출구 제거)', () => {
  const src = read(EF);
  // 구 결합 버그: Slack 실패 시 claim NULL 롤백 + 502 return → 완전 제거됐는지.
  expect(src).not.toMatch(/return json\(\{ error: `Slack 발송 실패[\s\S]*?\}, 502\)/);
  expect(src).not.toMatch(/consult_notify_status: null, consult_notify_by: null/); // 구 claim 롤백 제거
  // 신규: Slack 실패 경로는 모두 2xx(confirmed:true) 반환.
  expect(src).toMatch(/notifyFailed: true/);
  expect(src).toMatch(/notifyPending: true/);
  // 유일한 non-2xx = enqueue(claim+outbox 원자) 자체 실패.
  expect(src).toMatch(/if \(enqErr\) \{[\s\S]*?\}, 500\)/);
});

test('시나리오1: FE 는 EF 2xx 를 [확정] 성공으로 처리 + 발송실패/대기 안내(묵음 금지 채널)', () => {
  const src = read(PAGE);
  // notifyFailed → 경고(묵음 제외 warning), notifyPending → confirm(묵음 제외)
  expect(src).toMatch(/res\.notifyFailed/);
  expect(src).toMatch(/toast\.warning\(/);
  expect(src).toMatch(/res\.notifyPending/);
  expect(src).toMatch(/toast\.confirm\(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// VG1 — durable enqueue (atomicity): claim + outbox 단일 txn, fire-and-forget 금지
// ─────────────────────────────────────────────────────────────────────────────
test('VG1: enqueue_consult_notify RPC 가 claim(check_ins NULL→sending) + outbox INSERT 를 단일 txn 원자 영속', () => {
  const sql = read(MIG);
  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.enqueue_consult_notify/);
  // 조건부 claim (NULL 가드) + rows-affected 진단
  expect(sql).toMatch(/UPDATE public\.check_ins[\s\S]*?consult_notify_status = 'sending'[\s\S]*?AND consult_notify_status IS NULL/);
  expect(sql).toMatch(/GET DIAGNOSTICS v_claimed = ROW_COUNT/);
  // claim=0 이면 재enqueue 금지(멱등)
  expect(sql).toMatch(/IF v_claimed = 0 THEN[\s\S]*?'claimed', false/);
  // 같은 함수(=단일 txn) 안에서 outbox INSERT
  expect(sql).toMatch(/INSERT INTO public\.consult_notify_outbox/);
});

test('VG1: EF 는 RPC enqueue 만으로 [확정] 성공을 확정, enqueue 실패 시에만 non-2xx(동반 실패)', () => {
  const src = read(EF);
  expect(src).toMatch(/supabase\.rpc\("enqueue_consult_notify"/);
  // fire-and-forget silent drop 금지 — 발송 전 반드시 outbox 영속(RPC) 후에만 진행
  expect(src).toMatch(/if \(!enqRes\.claimed\)[\s\S]*?alreadySent: true/);
});

// ─────────────────────────────────────────────────────────────────────────────
// VG2 — retry + backoff + DLQ terminal (참조 dopamine_callback_outbox 표준 이식)
// ─────────────────────────────────────────────────────────────────────────────
test('VG2: pg_cron worker(분당) + 지수 backoff(1·2·4·8·16·32·60) + 픽업 인덱스', () => {
  const sql = read(MIG);
  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.process_consult_notify_outbox/);
  expect(sql).toMatch(/cron\.schedule\(\s*'foot-consult-notify-worker',\s*'\* \* \* \* \*'/);
  // 지수 backoff: LEAST(power(2, attempts), 60) minutes
  expect(sql).toMatch(/LEAST\(power\(2, o\.attempts\)::INT, 60\)/);
  expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
});

test('VG2: dispatch EF 는 attempts>=7 재시도 소진 시 DLQ terminal, 그 외 5xx/네트워크는 pending 재시도', () => {
  const src = read(DISPATCH);
  expect(src).toMatch(/const MAX_ATTEMPTS = 7/);
  expect(src).toMatch(/exhausted[\s\S]*?dlq_reason: "retry_exhausted"/);
  expect(src).toMatch(/status: "pending"/); // transient 재시도
});

// ─────────────────────────────────────────────────────────────────────────────
// VG3 — 멱등 anchor (event_id=check_in_id), 상담대기방 중복 발송 금지
// ─────────────────────────────────────────────────────────────────────────────
test('VG3: outbox event_id UNIQUE + ON CONFLICT DO NOTHING (재시도 중복발송 차단)', () => {
  const sql = read(MIG);
  expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_consult_notify_outbox_event\s*\n?\s*ON public\.consult_notify_outbox \(event_id\)/);
  // event_id = check_in_id
  expect(sql).toMatch(/p_check_in_id::TEXT/);
  expect(sql).toMatch(/ON CONFLICT \(event_id\) DO NOTHING/);
});

test('VG3: 발송 성공 시 outbox delivered(sent) 마킹 + check_ins 승격 (재발사 금지, dispatch 종결 skip)', () => {
  const dsp = read(DISPATCH);
  expect(dsp).toMatch(/\["sent", "duplicate", "failed"\]\.includes\(o\.status\) \|\| o\.dlq/); // 종결 skip 멱등
  expect(dsp).toMatch(/status: "sent"[\s\S]*?slack_ts: sent\.ts/);
});

// ─────────────────────────────────────────────────────────────────────────────
// VG4 — 발송실패 가시화 (load-bearing): check_ins 'failed' 배지 + 슬랙 DLQ 알람
// ─────────────────────────────────────────────────────────────────────────────
test('VG4: check_ins.consult_notify_status CHECK 에 failed 추가 + FE 발송실패 배지', () => {
  const sql = read(MIG);
  expect(sql).toMatch(/consult_notify_status IN \('sending', 'sent', 'failed'\)/);
  const page = read(PAGE);
  expect(page).toMatch(/r\.notifyStatus === 'failed'[\s\S]*?발송실패/);
  expect(page).toMatch(/data-testid=\{`dist-notify-failed-\$\{r\.id\}`\}/);
});

test('VG4: DLQ 신규 → 슬랙 #infra-alerts 알람 함수 + worker 매 틱 알람 픽업 (silent DLQ 축적 금지)', () => {
  const sql = read(MIG);
  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.alert_consult_notify_dlq/);
  expect(sql).toMatch(/dlq = true AND dlq_alerted = false/);
  expect(sql).toMatch(/PERFORM public\.alert_consult_notify_dlq\(\)/); // worker 가 매 틱 호출
});

// ─────────────────────────────────────────────────────────────────────────────
// VG5 — channel_not_found 종단분류 (즉시 terminal, 무한 재시도 금지)
// ─────────────────────────────────────────────────────────────────────────────
test('VG5: channel_gone(channel_not_found/not_in_channel/is_archived) → 즉시 DLQ terminal + 즉시 가시화', () => {
  const ef = read(EF);
  const dsp = read(DISPATCH);
  // 종단분류 discriminator (양쪽)
  expect(ef).toMatch(/CHANNEL_GONE = \/channel_not_found\|not_in_channel\|is_archived/);
  expect(dsp).toMatch(/CHANNEL_GONE = \/channel_not_found\|not_in_channel\|is_archived/);
  // channel_gone 은 즉시 dlq_reason='channel_gone' terminal (retry 안 함)
  expect(ef).toMatch(/CHANNEL_GONE\.test\(sent\.error[\s\S]*?dlq_reason: "channel_gone"/);
  expect(dsp).toMatch(/CHANNEL_GONE\.test\(sent\.error[\s\S]*?dlq_reason: "channel_gone"/);
  // 즉시 가시화: check_ins 'failed' + 슬랙 알람 즉시 호출
  expect(ef).toMatch(/consult_notify_status: "failed"/);
  expect(ef).toMatch(/rpc\("alert_consult_notify_dlq"\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// PHI 가드 — outbox payload = 운영 메타 only (고객명 미영속, 발송시점 재조회)
// ─────────────────────────────────────────────────────────────────────────────
test('PHI: outbox payload 는 운영 메타(check_in_id/clinic_id/channel/inflow)만 — 고객명/차트/전화 미영속', () => {
  const sql = read(MIG);
  // enqueue RPC 가 outbox 에 넣는 payload 에 customer_name/phone/chart 부재
  const payloadBlock = sql.match(/jsonb_build_object\([\s\S]*?'check_in_id', p_check_in_id[\s\S]*?\)/)?.[0] ?? '';
  expect(payloadBlock).not.toMatch(/customer_name|phone|chart|고객명/);
  // dispatch/EF 는 고객명을 check_ins 에서 발송시점 재조회(transient)
  const dsp = read(DISPATCH);
  expect(dsp).toMatch(/\.from\("check_ins"\)[\s\S]*?customer_name/);
});

// ─────────────────────────────────────────────────────────────────────────────
// RED LINE INV-1: 발송상태 컬럼만 write — 매출귀속/배정 포인터 무접촉
// ─────────────────────────────────────────────────────────────────────────────
test('RED LINE INV-1: EF/dispatch 어디도 assigned_consultant_id/consultant_id write 없음, customers 무접촉', () => {
  for (const f of [EF, DISPATCH]) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/assigned_consultant_id/);
    expect(code).not.toMatch(/from\("customers"\)/);
    const updateBlocks = code.match(/\.update\(\{[\s\S]*?\}\)/g) ?? [];
    for (const blk of updateBlocks) {
      // check_ins update 는 consult_notify_* 만 (dispatch/EF)
      if (/consult_notify_status/.test(blk)) {
        expect(blk).not.toMatch(/\bconsultant_id\b/);
        expect(blk).not.toMatch(/\btherapist_id\b/);
      }
    }
  }
  // RPC(enqueue) 의 check_ins UPDATE SET 절도 consult_notify_* 만
  const sql = read(MIG);
  const rpcUpdate = sql.match(/UPDATE public\.check_ins\s*\n\s*SET[\s\S]*?WHERE/)?.[0] ?? '';
  expect(rpcUpdate).toMatch(/consult_notify_status = 'sending'/);
  expect(rpcUpdate).not.toMatch(/\bconsultant_id =|assigned_consultant_id/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 마이그레이션 안전성 — ADDITIVE, 파괴적 변경 0, 롤백 존재
// ─────────────────────────────────────────────────────────────────────────────
test('마이그: ADDITIVE — 신규 테이블/함수/CHECK 확장만, DROP COLUMN/파괴 변경 부재', () => {
  const sql = read(MIG);
  expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.consult_notify_outbox/);
  expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/); // 내부 전용
  expect(sql).not.toMatch(/DROP COLUMN/);
  expect(sql).not.toMatch(/ALTER TABLE[^\n]*customers/);
});

test('마이그: 롤백 존재 — worker/함수/테이블 DROP + CHECK 원복', () => {
  const rb = read(ROLLBACK);
  expect(rb).toMatch(/DROP TABLE IF EXISTS public\.consult_notify_outbox/);
  expect(rb).toMatch(/cron\.unschedule\('foot-consult-notify-worker'\)/);
  expect(rb).toMatch(/DROP FUNCTION IF EXISTS public\.enqueue_consult_notify/);
});
