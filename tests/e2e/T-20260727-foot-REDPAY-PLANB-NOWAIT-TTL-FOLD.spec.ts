/**
 * Contract spec — T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD (TTL 축소 fold)
 *   + T-20260729-foot-REDPAY-PLANB-UNASSIGNED-INFLOW-METRIC
 *
 * 목적: TTL 5분/6분 축소 fold(2026-07-29 MSG-ku9c)가 정책 단일소스(app 상수)·DB DEFAULT·
 *   미배정 유입률 집계에 drift 없이 반영됐는지 순수 로직·소스 검증(browser 무접점).
 *
 * 계약(I1~I6):
 *  I1. TTL SSOT 상수 = auto-connect 5분 / lock 6분 (정책 단일소스).
 *  I2. expires_at/locked_until 계산이 created_at + 5분/6분.
 *  I3. 안내 문구 = "결제는 최대 5분 내 자동 기록".
 *  I4. DEFAULT 마이그 up = expires_at DEFAULT now()+'5 minutes' / rollback = '10 minutes' 복원 (비파괴).
 *  I5. 미배정 유입률 = (expired+failed)/total (payments 무접점, read-only status count).
 *  I6. 집계 lib 에 payments JOIN/select 없음 (매출 파이프 무접점 불변식).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  REDPAY_PLANB_AUTO_CONNECT_MIN,
  REDPAY_PLANB_LOCK_MIN,
  REDPAY_PLANB_TTL,
  REDPAY_PLANB_AUTO_RECORD_NOTICE,
  computeExpiresAt,
  computeLockedUntil,
  isWithinAutoConnect,
} from '../../src/lib/redpayPlanbTtl';
import {
  computeInflowRate,
  formatInflowRate,
  UNASSIGNED_STATUSES,
  type StatusCount,
} from '../../src/lib/redpayPlanbInflowMetric';

const MIG_UP = 'supabase/migrations/20260729120000_foot_redpay_planb_expires_default_5min.sql';
const MIG_ROLLBACK = 'supabase/migrations/20260729120000_foot_redpay_planb_expires_default_5min.rollback.sql';
const METRIC_LIB = 'src/lib/redpayPlanbInflowMetric.ts';

test.describe('T-20260727 REDPAY-PLANB TTL 축소 fold — 5분/6분', () => {
  test('I1: TTL SSOT 상수 = auto-connect 5분 / lock 6분', () => {
    expect(REDPAY_PLANB_AUTO_CONNECT_MIN).toBe(5);
    expect(REDPAY_PLANB_LOCK_MIN).toBe(6);
    expect(REDPAY_PLANB_TTL.autoConnectMs).toBe(5 * 60 * 1000);
    expect(REDPAY_PLANB_TTL.lockMs).toBe(6 * 60 * 1000);
  });

  test('I2: expires_at/locked_until = created_at + 5분/6분', () => {
    const created = new Date('2026-07-29T10:00:00.000Z');
    expect(computeExpiresAt(created).toISOString()).toBe('2026-07-29T10:05:00.000Z');
    expect(computeLockedUntil(created).toISOString()).toBe('2026-07-29T10:06:00.000Z');
    // 자동연결 판정: 4분59초 도착=유효 / 5분00초 도착=초과(미배정)
    expect(isWithinAutoConnect(created, '2026-07-29T10:04:59.000Z')).toBe(true);
    expect(isWithinAutoConnect(created, '2026-07-29T10:05:00.000Z')).toBe(false);
  });

  test('I3: 안내 문구 = "결제는 최대 5분 내 자동 기록"', () => {
    expect(REDPAY_PLANB_AUTO_RECORD_NOTICE).toBe('결제는 최대 5분 내 자동 기록');
  });

  test('I4: DEFAULT 마이그 up=5분 / rollback=10분 복원 (비파괴 SET DEFAULT)', () => {
    const up = fs.readFileSync(MIG_UP, 'utf8');
    expect(up).toMatch(/ALTER COLUMN expires_at SET DEFAULT\s*\(now\(\)\s*\+\s*interval '5 minutes'\)/);
    expect(up).not.toMatch(/DROP COLUMN|ADD COLUMN|ALTER COLUMN expires_at TYPE|SET NOT NULL|DROP NOT NULL/);
    const rb = fs.readFileSync(MIG_ROLLBACK, 'utf8');
    expect(rb).toMatch(/ALTER COLUMN expires_at SET DEFAULT\s*\(now\(\)\s*\+\s*interval '10 minutes'\)/);
  });
});

test.describe('T-20260729 UNASSIGNED-INFLOW-METRIC — read-only 집계', () => {
  test('I5: 유입률 = (expired+failed)/total', () => {
    const rows: StatusCount[] = [
      { status: 'open', count: 2 },
      { status: 'matched', count: 12 },
      { status: 'expired', count: 3 },
      { status: 'failed', count: 1 },
      { status: 'cancelled', count: 2 },
    ];
    const m = computeInflowRate(rows, '2026-07-29T00:00:00Z', '2026-07-30T00:00:00Z');
    expect(m.totalPreempts).toBe(20);
    expect(m.expiredCount).toBe(3);
    expect(m.failedCount).toBe(1);
    expect(m.unassignedCount).toBe(4);
    expect(m.inflowRate).toBeCloseTo(0.2, 6);
    expect(formatInflowRate(m)).toBe('20.0%');
  });

  test('I5b: total=0 이면 rate=0 (0분모 가드)', () => {
    const m = computeInflowRate([], '2026-07-29T00:00:00Z', '2026-07-30T00:00:00Z');
    expect(m.totalPreempts).toBe(0);
    expect(m.inflowRate).toBe(0);
    expect(UNASSIGNED_STATUSES).toEqual(['expired', 'failed']);
  });

  test('I6: 집계 lib payments 무접점 (매출 파이프 불변식)', () => {
    const raw = fs.readFileSync(METRIC_LIB, 'utf8');
    // 주석(설계 doc) 제거 후 실제 코드만 검사 — 'JOIN 금지' 같은 doc 문자열 오탐 방지
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')  // 블록 주석
      .replace(/^\s*\*.*$/gm, '')          // JSDoc 라인
      .replace(/\/\/.*$/gm, '');           // 라인 주석
    // payments 테이블 직접조회/임베드 금지 — 오직 pending_payment 만 조회.
    // (PendingPaymentStatus 등 타입명 오탐 방지 위해 payments '테이블 참조' 패턴만 검사)
    expect(code).not.toMatch(/\.from\(\s*['"]payments['"]\s*\)/);   // .from('payments')
    expect(code).not.toMatch(/['"]payments\s*[!(]/);                 // supabase embed: payments!fk / payments(
    expect(code).not.toMatch(/\bjoin\s+payments\b/i);                // raw SQL join
    expect(code).toMatch(/\.from\('pending_payment'\)/);
  });
});
