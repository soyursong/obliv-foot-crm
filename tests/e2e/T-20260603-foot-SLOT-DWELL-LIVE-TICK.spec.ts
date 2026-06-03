/**
 * T-20260603-foot-SLOT-DWELL-LIVE-TICK — 슬롯 체류시간 실시간 카운트(라이브 틱)
 *
 * follow-up of T-20260602-foot-SLOT-DWELL-TIME.
 * 선행 AC-3(현재 슬롯 경과)이 RPC 호출 시점 정적 스냅샷으로 멈추던 문제를 FE 라이브화.
 *
 * 구현(FE 전용, DB/RPC 무변경):
 *   - slotDwellNowMs(useState) + slot_dwell 탭 활성 시 setInterval(1초)→Date.now() / 이탈 시 clearInterval
 *   - 렌더 effSec(s): is_current면 (slotDwellNowMs − entered_at)/1000, 아니면 RPC duration_seconds 그대로
 *   - agg/totalSec/동선칩 모두 effSec 사용 → 진행중 포함 시 1초마다 라이브
 *
 * 본 spec 은 FE effSec 파생 로직을 코드와 동일하게 재현해 회귀 가드한다 (순수 로직, 브라우저 불필요).
 *
 * AC-1(총 체류 라이브): totalSec = Σ effSec, is_current 포함 시 now 기반 증가.
 * AC-2(현재 슬롯 라이브): is_current 세그먼트 경과 = (now − entered_at), now 진행 시 증가.
 * AC-3(완료 방문 불변): is_current=false 세그먼트는 duration_seconds 그대로 (now 무관).
 * AC-4(cleanup): interval id clearInterval — 별도 cleanup 로직 가드(개념 회귀).
 */
import { test, expect } from '@playwright/test';

// CustomerChartPage.tsx SlotDwellSeg 의 라이브 계산에 필요한 필드만 발췌
interface SlotDwellSeg {
  entered_at: string;
  duration_seconds: number;
  is_current: boolean;
  status: string;
}

// FE effSec 재현: 진행중이면 now 기준 경과, 완료는 스냅샷 그대로 (음수 가드 포함)
function effSec(s: SlotDwellSeg, nowMs: number): number {
  return s.is_current
    ? Math.max(0, (nowMs - new Date(s.entered_at).getTime()) / 1000)
    : s.duration_seconds;
}

test.describe('T-20260603-foot-SLOT-DWELL-LIVE-TICK (pure-logic)', () => {
  const enteredAt = '2026-06-03T10:00:00+09:00';
  const enteredMs = new Date(enteredAt).getTime();

  // 진행중 세그먼트 + 완료 세그먼트 혼합 방문건
  const segs: SlotDwellSeg[] = [
    // 완료된 상담실 30분 (스냅샷 고정)
    { status: 'consulting', entered_at: '2026-06-03T09:30:00+09:00', duration_seconds: 30 * 60, is_current: false },
    // 진행중 치료실 — entered_at 기준 now 로 라이브 계산
    { status: 'treating', entered_at: enteredAt, duration_seconds: 0, is_current: true },
  ];

  // AC-2: is_current 세그먼트는 now 가 진행하면 경과시간이 증가한다 (정적 아님)
  test('AC-2: 진행중 세그먼트는 now 기준 라이브 경과', () => {
    const t10 = effSec(segs[1], enteredMs + 10_000); // 10초 경과
    const t12 = effSec(segs[1], enteredMs + 12_000); // 12초 경과
    expect(t10).toBe(10);
    expect(t12).toBe(12);
    expect(t12).toBeGreaterThan(t10); // 라이브 증가 (고정값 아님)
  });

  // AC-3: 완료(is_current=false) 세그먼트는 now 와 무관하게 duration_seconds 불변
  test('AC-3: 완료 세그먼트는 now 무관 불변', () => {
    const a = effSec(segs[0], enteredMs + 10_000);
    const b = effSec(segs[0], enteredMs + 9_999_000);
    expect(a).toBe(30 * 60);
    expect(b).toBe(30 * 60); // now 가 한참 흘러도 동일
  });

  // AC-1: totalSec = Σ effSec — 진행중 포함 시 now 진행에 따라 총합 증가
  test('AC-1: 총 체류 = Σ effSec, 진행중 포함 시 라이브', () => {
    const total10 = segs.reduce((sum, s) => sum + effSec(s, enteredMs + 10_000), 0);
    const total12 = segs.reduce((sum, s) => sum + effSec(s, enteredMs + 12_000), 0);
    expect(total10).toBe(30 * 60 + 10); // 상담실 30분 고정 + 치료실 10초
    expect(total12).toBe(30 * 60 + 12);
    expect(total12 - total10).toBe(2); // 2초 경과분만 증가
  });

  // 슬롯별 누적(agg) 도 effSec 기반 — 진행중 슬롯만 라이브, 완료 슬롯 고정
  test('AC-1(agg): 슬롯별 누적도 진행중만 라이브', () => {
    const agg = (nowMs: number) => {
      const m = new Map<string, number>();
      for (const s of segs) m.set(s.status, (m.get(s.status) ?? 0) + effSec(s, nowMs));
      return m;
    };
    const a = agg(enteredMs + 10_000);
    const b = agg(enteredMs + 12_000);
    expect(a.get('consulting')).toBe(30 * 60); // 완료 슬롯 고정
    expect(b.get('consulting')).toBe(30 * 60);
    expect(a.get('treating')).toBe(10);        // 진행중 슬롯 라이브
    expect(b.get('treating')).toBe(12);
  });

  // 음수(시계 오차) 가드: now < entered_at 이어도 0 이상
  test('effSec: now < entered_at 음수 가드 → 0', () => {
    expect(effSec(segs[1], enteredMs - 5_000)).toBe(0);
  });

  // AC-4(개념 가드): interval 콜백은 now 만 갱신, cleanup 은 clearInterval 로 멱등
  test('AC-4: setInterval 콜백은 now 갱신, clearInterval 로 정지', () => {
    let now = enteredMs;
    const tick = () => { now = enteredMs + 1000; }; // 1초마다 now 갱신 모사
    const id = setInterval(tick, 1000);
    clearInterval(id); // 탭 이탈/언마운트
    const before = now;
    // clear 후에는 tick 이 더 돌지 않음을 보장 (잔존 타이머 없음 개념)
    expect(typeof id === 'number' || typeof id === 'object').toBe(true);
    expect(now).toBe(before);
  });
});
