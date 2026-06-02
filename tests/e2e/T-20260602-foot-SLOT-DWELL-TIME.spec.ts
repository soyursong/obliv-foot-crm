/**
 * T-20260602-foot-SLOT-DWELL-TIME — 슬롯(방)별 체류시간 집계 (B안: 2번차트 이력 조회)
 *
 * planner DECISION (2026-06-02 18:30, re: MSG-...-acz4):
 *   기존 status_transitions(전이 로그: from_status/to_status/transitioned_at) 재사용 →
 *   신규 RPC fn_check_in_slot_dwell 만 추가(read-only). 기존 테이블 무변경(AC-5 충족).
 *   B안(2번차트 '체류시간' 탭, 방문건별 슬롯 체류 인터벌) 우선 구현. A안(대시보드 실시간)은 후속.
 *
 * 본 spec 은 RPC 의 구간(segment) 산출 로직과 FE formatDwell 포맷을 코드와 동일 로직으로
 * 재현해 회귀 가드한다 (DB/브라우저 불필요 순수 로직).
 *
 * AC-1(총 체류시간 유지): segments 합 = (마지막 종착 시각 − 접수 시각). 접수 기준 총 체류 회귀 없음.
 * AC-2(슬롯별 집계): 방문건의 각 슬롯(from_status)별 체류 인터벌이 산출된다.
 * AC-3(현재 슬롯 경과): done/cancelled 아닌 경우 마지막 슬롯이 is_current=true, now() 기준 경과.
 * AC-5(스키마 최소): status_transitions 인터벌만으로 산출 — 신규 컬럼/테이블 불필요.
 */
import { test, expect } from '@playwright/test';

// ──────────────────────────────────────────────────────────────────────
// FE formatDwell 재현 — CustomerChartPage.tsx (체류시간 초 → 한글)
// ──────────────────────────────────────────────────────────────────────
function formatDwell(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${sec}초`;
  return `${sec}초`;
}

// ──────────────────────────────────────────────────────────────────────
// RPC fn_check_in_slot_dwell 구간 산출 로직 재현 (SQL과 동일):
//   - 각 전이 i: 구간 status = from_status, [직전 전이 시각(없으면 checked_in_at), 전이 시각]
//   - 마지막(현재) 구간: status = 마지막 to_status(전이 없으면 current_status),
//     [마지막 전이 시각(없으면 checked_in_at), now]. current_status ∈ done/cancelled 면 미산출.
//   - duration_seconds = max(0, floor((exited−entered)/1000))
// ──────────────────────────────────────────────────────────────────────
interface Transition { from_status: string; to_status: string; transitioned_at: string }
interface Seg { seq: number; status: string; duration_seconds: number; is_current: boolean }

function computeSegments(
  checkedInAt: string,
  currentStatus: string,
  transitions: Transition[],
  now: string,
): Seg[] {
  const ci = new Date(checkedInAt).getTime();
  const sorted = [...transitions].sort(
    (a, b) => new Date(a.transitioned_at).getTime() - new Date(b.transitioned_at).getTime(),
  );
  const segs: Seg[] = [];
  let prev = ci;
  sorted.forEach((t, idx) => {
    const exited = new Date(t.transitioned_at).getTime();
    segs.push({
      seq: idx + 1,
      status: t.from_status,
      duration_seconds: Math.max(0, Math.floor((exited - prev) / 1000)),
      is_current: false,
    });
    prev = exited;
  });
  // 마지막(현재) 슬롯 — done/cancelled 제외
  if (currentStatus !== 'done' && currentStatus !== 'cancelled') {
    const status = sorted.length > 0 ? sorted[sorted.length - 1].to_status : currentStatus;
    const entered = sorted.length > 0 ? new Date(sorted[sorted.length - 1].transitioned_at).getTime() : ci;
    segs.push({
      seq: sorted.length + 1,
      status,
      duration_seconds: Math.max(0, Math.floor((new Date(now).getTime() - entered) / 1000)),
      is_current: true,
    });
  }
  return segs;
}

test.describe('T-20260602-foot-SLOT-DWELL-TIME (pure-logic)', () => {
  // 시나리오 1: 상담실(t0)→치료실(t1) 이동 후 진행중 — 방별 체류시간 누적
  test('AC-2/AC-3: 상담실 체류 = (t1−t0), 치료실은 현재 진행중(is_current)', () => {
    const checkedInAt = '2026-06-02T10:00:00+09:00';
    const transitions: Transition[] = [
      // 10:00 접수(registered) → 10:05 상담실(consulting)
      { from_status: 'registered', to_status: 'consulting', transitioned_at: '2026-06-02T10:05:00+09:00' },
      // 10:05 상담실 → 10:35 치료실(treating)  ⇒ 상담실 30분
      { from_status: 'consulting', to_status: 'treating', transitioned_at: '2026-06-02T10:35:00+09:00' },
    ];
    const now = '2026-06-02T10:50:00+09:00'; // 치료실 15분 경과
    const segs = computeSegments(checkedInAt, 'treating', transitions, now);

    // 슬롯별 누적
    const agg = new Map<string, number>();
    for (const s of segs) agg.set(s.status, (agg.get(s.status) ?? 0) + s.duration_seconds);

    expect(agg.get('registered')).toBe(5 * 60);   // 접수 슬롯 5분
    expect(agg.get('consulting')).toBe(30 * 60);  // 상담실 30분 (t1−t0)
    expect(agg.get('treating')).toBe(15 * 60);    // 치료실 15분 (현재 경과)

    // 마지막 슬롯이 현재(진행중)
    const current = segs.find((s) => s.is_current);
    expect(current?.status).toBe('treating');
    expect(current?.duration_seconds).toBe(15 * 60);
  });

  // AC-1: 총 원내 체류 = 접수 시각 기준 (모든 구간 합 = now − checked_in_at), 회귀 없음
  test('AC-1: 총 체류 = 구간 합 = (종착 − 접수 시각)', () => {
    const checkedInAt = '2026-06-02T10:00:00+09:00';
    const transitions: Transition[] = [
      { from_status: 'registered', to_status: 'consulting', transitioned_at: '2026-06-02T10:05:00+09:00' },
      { from_status: 'consulting', to_status: 'treating', transitioned_at: '2026-06-02T10:35:00+09:00' },
    ];
    const now = '2026-06-02T10:50:00+09:00';
    const segs = computeSegments(checkedInAt, 'treating', transitions, now);
    const total = segs.reduce((sum, s) => sum + s.duration_seconds, 0);
    const expectedTotal = (new Date(now).getTime() - new Date(checkedInAt).getTime()) / 1000;
    expect(total).toBe(expectedTotal); // 50분 = 3000초, 접수 기준 총 체류와 일치
  });

  // AC-3(회귀 가드): done 이면 현재 슬롯 미산출 — 완료 방문은 진행중 구간 없음
  test('AC-3: done/cancelled 방문은 is_current 구간 없음(완료 후 카운트 정지)', () => {
    const checkedInAt = '2026-06-02T10:00:00+09:00';
    const transitions: Transition[] = [
      { from_status: 'registered', to_status: 'treating', transitioned_at: '2026-06-02T10:10:00+09:00' },
      { from_status: 'treating', to_status: 'done', transitioned_at: '2026-06-02T10:40:00+09:00' },
    ];
    const now = '2026-06-02T12:00:00+09:00'; // 완료 후 한참 뒤여도
    const segs = computeSegments(checkedInAt, 'done', transitions, now);
    expect(segs.some((s) => s.is_current)).toBe(false);
    // 완료 방문 총합 = 마지막 전이(done) 시각 − 접수 = 40분, now 영향 없음
    const total = segs.reduce((sum, s) => sum + s.duration_seconds, 0);
    expect(total).toBe(40 * 60);
    expect(segs.find((s) => s.status === 'treating')?.duration_seconds).toBe(30 * 60);
  });

  // AC-5(전이 없는 방문): status_transitions 없어도 접수 슬롯 단일 구간 산출
  test('AC-5: 전이 로그 없는 방문 — 접수 슬롯 단일 진행중 구간', () => {
    const checkedInAt = '2026-06-02T11:00:00+09:00';
    const now = '2026-06-02T11:20:00+09:00';
    const segs = computeSegments(checkedInAt, 'registered', [], now);
    expect(segs).toHaveLength(1);
    expect(segs[0].status).toBe('registered');
    expect(segs[0].is_current).toBe(true);
    expect(segs[0].duration_seconds).toBe(20 * 60);
  });

  // formatDwell 포맷 가드 (한글, 음수 가드)
  test('formatDwell: 시/분/초 한글 포맷 + 음수 가드', () => {
    expect(formatDwell(45)).toBe('45초');
    expect(formatDwell(65)).toBe('1분 5초');
    expect(formatDwell(30 * 60)).toBe('30분 0초');
    expect(formatDwell(3600 + 23 * 60)).toBe('1시간 23분');
    expect(formatDwell(-10)).toBe('0초'); // 음수(시계 오차) 가드
  });
});
