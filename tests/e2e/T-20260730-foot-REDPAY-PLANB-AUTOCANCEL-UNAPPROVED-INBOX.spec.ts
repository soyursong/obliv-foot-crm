/**
 * T-20260730-foot-REDPAY-PLANB-AUTOCANCEL-UNAPPROVED-INBOX — AC-1 '미승인 수납' 집계 순수-로직 가드
 * ──────────────────────────────────────────────────────────────────────────────
 * 대상: src/lib/redpayPlanbUnapprovedCount.ts (unapprovedCutoffIso / isUnapprovedFinal)
 *   read-only 집계의 '미승인 확정' 판정이 자동취소(AC-3) 컷오프(expires_at + 보관창 1h)와
 *   정확히 동일 기준을 쓰는지, status/보관창 경계가 정확한지 결정론적으로 검증.
 *   ★ auth/server/browser 불요 — 순수함수 직접 구동(unit 프로젝트). db_change 없음.
 *
 * 회귀 방어 포인트:
 *   · 컷오프 = now - REDPAY_PLANB_TTL.retentionMs (=60분). AC-3 자동취소 대상셋과 동일 기준.
 *   · status ∈ {expired, failed} 만 미승인. matched/open/cancelled 는 절대 제외(승인·진행중·이미처리).
 *   · 보관창 닫히기 전(expired-within-retention)은 late 웹훅으로 아직 matched 전이 가능 → 미승인 아님(과대집계 방지).
 *   · expires_at NULL → 판정 불가 → 미승인 아님(안전).
 */
import { test, expect } from '@playwright/test';
import {
  unapprovedCutoffIso,
  isUnapprovedFinal,
  UNAPPROVED_STATUSES,
} from '../../src/lib/redpayPlanbUnapprovedCount';
import { REDPAY_PLANB_TTL } from '../../src/lib/redpayPlanbTtl';

const RETENTION_MS = REDPAY_PLANB_TTL.retentionMs; // 60분
const NOW = Date.parse('2026-07-30T12:00:00.000Z');

// 헬퍼: NOW 기준 오프셋(ms) 만큼 과거/미래인 expires_at ISO.
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

test.describe('AC-1 미승인 수납 순수-로직 가드', () => {
  test('컷오프 = now - 보관창(60분), AC-3 자동취소 기준과 동일', () => {
    expect(REDPAY_PLANB_TTL.retentionMs).toBe(60 * 60 * 1000);
    expect(unapprovedCutoffIso(NOW)).toBe(new Date(NOW - RETENTION_MS).toISOString());
  });

  test('status 게이트: expired/failed 만 미승인 후보 (matched/open/cancelled 절대 제외)', () => {
    expect([...UNAPPROVED_STATUSES]).toEqual(['expired', 'failed']);
    const wellPastRetention = at(-RETENTION_MS - 60_000); // 보관창 이후(확실히 닫힘)
    // 미승인 후보 status
    expect(isUnapprovedFinal({ status: 'expired', expires_at: wellPastRetention }, NOW)).toBe(true);
    expect(isUnapprovedFinal({ status: 'failed', expires_at: wellPastRetention }, NOW)).toBe(true);
    // 제외 status — 보관창 지났어도 미승인 아님
    for (const s of ['matched', 'open', 'cancelled']) {
      expect(isUnapprovedFinal({ status: s, expires_at: wellPastRetention }, NOW)).toBe(false);
    }
  });

  test('보관창 경계: 닫히기 전 expired 는 미승인 아님(과대집계 방지), 닫힌 뒤 미승인', () => {
    // 만료됐지만 보관창(60분) 아직 안 지남 → late 웹훅 자동연결 여지 → 미승인 아님
    const withinRetention = at(-RETENTION_MS + 60_000); // expires_at = now-59분
    expect(isUnapprovedFinal({ status: 'expired', expires_at: withinRetention }, NOW)).toBe(false);
    // 정확히 경계(expires_at == now - retention) → <= 이므로 미승인 확정
    const exactBoundary = at(-RETENTION_MS);
    expect(isUnapprovedFinal({ status: 'expired', expires_at: exactBoundary }, NOW)).toBe(true);
    // 보관창 이후 → 미승인 확정
    const pastRetention = at(-RETENTION_MS - 1);
    expect(isUnapprovedFinal({ status: 'expired', expires_at: pastRetention }, NOW)).toBe(true);
  });

  test('expires_at NULL → 판정 불가 → 미승인 아님(안전)', () => {
    expect(isUnapprovedFinal({ status: 'expired', expires_at: null }, NOW)).toBe(false);
    expect(isUnapprovedFinal({ status: 'failed', expires_at: null }, NOW)).toBe(false);
  });
});
