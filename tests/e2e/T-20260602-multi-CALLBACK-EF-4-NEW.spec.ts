/**
 * T-20260602-multi-CALLBACK-EF-4-NEW — 풋 CRM outbox (발신부)
 * 명세: agents/docs/_draft/dopamine_callback_receive_pattern.md v0.1
 * 롱레 참조: dev-crm commit ca26361 (미러링)
 *
 * 범위 (풋 = AC-S1~S4):
 *   AC-S1: dopamine_callback_outbox 테이블 — (id, event_type, payload, attempts,
 *          next_attempt_at, last_error, dlq, created_at) + 멱등키/상태/감사 컬럼
 *   AC-S2: 라이프사이클 트리거(visited/no_show/cancelled/rejected) → outbox INSERT
 *          (동기 발송 X). 도파민 연동(source_system=dopamine + external_id) 건만.
 *          풋 변형: reservations.status noshow → 계약 event_type no_show 매핑.
 *   AC-S3: pg_cron worker(분당) — exponential backoff(1·2·4·8·16·32·60min),
 *          attempts>=7 → dlq=true. claim→dispatch(EF)→상태전이.
 *   AC-S4: DLQ 신규 1건+ → 슬랙 #infra-alerts 알람.
 *
 * 게이트: 1주 dry-run(shadow, 도파민 audit만) → supervisor → live (config.mode).
 *
 * 정적 검증 — 마이그레이션 + dispatcher EF + 롤백 파일 내용 단언 (unit 프로젝트, browser 미사용).
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIG = resolve(
  __dirname,
  '../../supabase/migrations/20260603010000_dopamine_callback_outbox.sql',
);
const MIG_RB = resolve(
  __dirname,
  '../../supabase/migrations/20260603010000_dopamine_callback_outbox.rollback.sql',
);
const EF = resolve(
  __dirname,
  '../../supabase/functions/dopamine-callback-dispatch/index.ts',
);

test.describe('T-20260602-multi-CALLBACK-EF-4-NEW (풋 outbox)', () => {
  let mig: string;
  let migRb: string;
  let ef: string;

  test.beforeAll(() => {
    mig = readFileSync(MIG, 'utf-8');
    migRb = readFileSync(MIG_RB, 'utf-8');
    ef = readFileSync(EF, 'utf-8');
  });

  // ───────────────────────────────────────────────────────────────────────
  // AC-S1: outbox 테이블 — 명세 컬럼 전부
  // ───────────────────────────────────────────────────────────────────────
  test('AC-S1-a: dopamine_callback_outbox 테이블 + 명세 컬럼', () => {
    expect(mig).toContain('CREATE TABLE IF NOT EXISTS public.dopamine_callback_outbox');
    for (const col of [
      'event_type',
      'payload',
      'attempts',
      'next_attempt_at',
      'last_error',
      'dlq',
      'created_at',
    ]) {
      expect(mig).toContain(col);
    }
  });

  test('AC-S1-b: event_type CHECK = 라이프사이클 4종 (계약 conformance)', () => {
    expect(mig).toContain(
      "CHECK (event_type IN ('visited','no_show','cancelled','rejected'))",
    );
  });

  test('AC-S1-c: 멱등키 UNIQUE(event_type, event_id)', () => {
    expect(mig).toContain('uq_dopamine_outbox_event');
    expect(mig).toMatch(/UNIQUE INDEX[\s\S]*\(event_type, event_id\)/);
  });

  test('AC-S1-d: status enum + RLS on (내부 전용)', () => {
    expect(mig).toContain(
      "CHECK (status IN ('pending','processing','sent','duplicate','failed'))",
    );
    expect(mig).toContain(
      'ALTER TABLE public.dopamine_callback_outbox ENABLE ROW LEVEL SECURITY',
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // AC-S2: 라이프사이클 트리거 → 적재만 (동기 발송 X)
  // ───────────────────────────────────────────────────────────────────────
  test('AC-S2-a: check_ins INSERT + reservations UPDATE OF status 트리거', () => {
    expect(mig).toContain('AFTER INSERT ON public.check_ins');
    expect(mig).toContain('AFTER UPDATE OF status ON public.reservations');
  });

  test('AC-S2-b: 도파민 연동 건만 (source_system=dopamine + external_id)', () => {
    expect(mig).toContain("v_resv.source_system IS DISTINCT FROM 'dopamine'");
    expect(mig).toContain("NEW.source_system IS DISTINCT FROM 'dopamine'");
    expect(mig).toContain('external_id IS NULL');
  });

  test('AC-S2-c: 풋 status 매핑 — noshow/cancelled 필터 + noshow→no_show + visited', () => {
    // 풋 reservations.status = ('confirmed','checked_in','cancelled','noshow') — rejected 없음
    expect(mig).toContain("NEW.status NOT IN ('noshow','cancelled')");
    // noshow(언더스코어 없음) → 계약 event_type 'no_show'로 매핑
    expect(mig).toContain("WHEN 'noshow' THEN 'no_show'");
    expect(mig).toContain("v_event_type     := 'visited'");
  });

  test('AC-S2-c2: payload.source_system = foot (롱레=crm 와 구분)', () => {
    expect(mig).toContain("'source_system',  'foot'");
  });

  test('AC-S2-d: 적재만 — 트리거 함수 내 동기 HTTP 발송 없음', () => {
    const fnStart = mig.indexOf('FUNCTION public.enqueue_dopamine_callback()');
    const fnEnd = mig.indexOf('$$;', fnStart);
    const fnBody = mig.slice(fnStart, fnEnd);
    expect(fnBody).not.toContain('http_post');
    expect(fnBody).toContain('INSERT INTO public.dopamine_callback_outbox');
  });

  test('AC-S2-e: 멱등 적재 — ON CONFLICT DO NOTHING', () => {
    expect(mig).toContain('ON CONFLICT (event_type, event_id) DO NOTHING');
  });

  // ───────────────────────────────────────────────────────────────────────
  // AC-S3: pg_cron worker + exponential backoff + DLQ 임계
  // ───────────────────────────────────────────────────────────────────────
  test('AC-S3-a: worker 함수 + 분당 pg_cron 등록 (풋 잡명)', () => {
    expect(mig).toContain(
      'CREATE OR REPLACE FUNCTION public.process_dopamine_callback_outbox()',
    );
    expect(mig).toContain("'foot-dopamine-callback-worker'");
    expect(mig).toContain("'* * * * *'");
  });

  test('AC-S3-b: exponential backoff (2^n, 60min cap = 1·2·4·8·16·32·60)', () => {
    expect(mig).toContain("LEAST(power(2, o.attempts)::INT, 60) || ' minutes'");
  });

  test('AC-S3-c: claim 패턴 — FOR UPDATE SKIP LOCKED + processing 전이', () => {
    expect(mig).toContain('FOR UPDATE SKIP LOCKED');
    expect(mig).toContain("status          = 'processing'");
    expect(mig).toContain('attempts        = o.attempts + 1');
  });

  test('AC-S3-d: stuck(processing 만료) 자가 회수', () => {
    expect(mig).toContain("status IN ('pending', 'processing')");
    expect(mig).toContain('next_attempt_at <= now()');
  });

  test('AC-S3-e: EF — attempts>=7 재시도 소진 시 dlq=true', () => {
    expect(ef).toContain('MAX_ATTEMPTS = 7');
    expect(ef).toContain('row.attempts as number) >= MAX_ATTEMPTS');
    expect(ef).toContain('dlq: true');
  });

  // ───────────────────────────────────────────────────────────────────────
  // AC-S4: DLQ 신규 → 슬랙 #infra-alerts 알람
  // ───────────────────────────────────────────────────────────────────────
  test('AC-S4-a: DLQ 알람 함수 + worker 호출', () => {
    expect(mig).toContain('CREATE OR REPLACE FUNCTION public.alert_dopamine_callback_dlq()');
    expect(mig).toContain('PERFORM public.alert_dopamine_callback_dlq()');
  });

  test('AC-S4-b: dlq 신규(dlq_alerted=false) 만 + 알람 후 표시(중복 방지)', () => {
    expect(mig).toContain('WHERE dlq = true AND dlq_alerted = false');
    expect(mig).toContain('SET dlq_alerted = true');
  });

  test('AC-S4-c: #infra-alerts webhook (전용 → ops fallback) + net.http_post', () => {
    expect(mig).toContain("name = 'slack_infra_alerts_webhook_url'");
    expect(mig).toContain("name = 'slack_ops_webhook_url'"); // fallback
    expect(mig).toMatch(/PERFORM net\.http_post\([\s\S]*v_webhook/);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 게이트: shadow/live (1주 dry-run)
  // ───────────────────────────────────────────────────────────────────────
  test('GATE: dopamine_callback_config 기본 shadow + EF mode 전달', () => {
    expect(mig).toContain('CREATE TABLE IF NOT EXISTS public.dopamine_callback_config');
    expect(mig).toContain("mode        TEXT        NOT NULL DEFAULT 'shadow'");
    expect(mig).toContain("VALUES (true, 'shadow')");
    // EF: shadow 안전 기본 + payload 에 mode 전달
    expect(ef).toContain('mode = body.mode === "live" ? "live" : "shadow"');
    expect(ef).toContain('{ ...(row.payload as Record<string, unknown>), mode }');
  });

  // ───────────────────────────────────────────────────────────────────────
  // dispatcher EF — 응답 → 상태 전이 규약
  // ───────────────────────────────────────────────────────────────────────
  test('EF-a: 단일 EF crm-lifecycle-callback + 2xx applied:false → duplicate, 4xx → failed+dlq', () => {
    expect(ef).toContain('crm-lifecycle-callback');
    expect(ef).toContain('status: "duplicate"');
    expect(ef).toContain('httpStatus >= 400 && httpStatus < 500');
  });

  test('EF-b: 내부 인증(X-Internal-Cron) + 종결건 재발사 금지(멱등)', () => {
    expect(ef).toContain('X-Internal-Cron');
    expect(ef).toContain('already_terminal');
    expect(ef).toContain('"sent", "duplicate", "failed"');
  });

  test('EF-c: 단일 POST (재시도는 worker 소유) + X-Callback-Secret', () => {
    expect(ef).toContain('X-Callback-Secret');
    // EF 내 자체 재시도 루프 없음 (worker backoff 가 유일한 재시도)
    expect(ef).not.toContain('postWithRetry');
    expect(ef).not.toMatch(/for\s*\(let attempt/);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 롤백 안전망
  // ───────────────────────────────────────────────────────────────────────
  test('롤백: cron 해제 + 트리거/함수/테이블 제거', () => {
    expect(migRb).toContain("cron.unschedule('foot-dopamine-callback-worker')");
    expect(migRb).toContain('DROP TRIGGER IF EXISTS trg_dopamine_cb_checkin');
    expect(migRb).toContain('DROP TRIGGER IF EXISTS trg_dopamine_cb_resv');
    expect(migRb).toContain('DROP FUNCTION IF EXISTS public.enqueue_dopamine_callback()');
    expect(migRb).toContain('DROP FUNCTION IF EXISTS public.process_dopamine_callback_outbox()');
    expect(migRb).toContain('DROP TABLE IF EXISTS public.dopamine_callback_outbox');
  });
});
