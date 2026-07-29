/**
 * T-20260729-foot-RANKING-DAYASSIGN-COUNT-CANCELLED-EXCLUDE — [랭킹] 탭 '당일 배정건수' 취소건 배제 E2E
 *
 * 스핀아웃 근거(F-5247 계보):
 *  · staffStats(누적/드릴 팝업, a7885a99) + 금일 배분 이력 표(8ff93685) 에서 확립한 불변식
 *    = "취소(cancelled) 배정은 배정 카운트/표시에서 배제 — done 등 활성 배정만 집계"
 *  · 동일 불변식이 [랭킹] 탭 '당일 배정건수'(#6, dayAssignCounts) 집계에도 성립해야 함.
 *  · 이전엔 check_ins 를 deleted_at IS NULL 만 필터 → cancelled(비-soft-hide) 배정이 유령으로 잔존,
 *    당일 배정건수 과다카운트. 이 델타로 서버 집계 쿼리에 .neq('status','cancelled') 추가.
 *
 * ── 검증 방식(예측가능·결정론) ──
 *  · #1 순수 로직 재현: 취소 배제를 반영한 dayAssignCounts 파생을 재현해 과다카운트 방지 단언.
 *  · #2 정적 소스 구조 단언: 당일 배정건수 쿼리에 cancelled 배제 필터가 존재 + deleted_at 유지.
 *  · 실렌더 클릭(갤탭 실브라우저)·라이브 매출 정합은 supervisor QA 커버.
 *  · db_change=false: 신규 컬럼/테이블 0. 배정 규칙/assigned_consultant_id 무변경(집계 필터만, RED LINE 무접촉).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const PAGE = 'src/pages/Assignments.tsx';

// ── 서버 집계(당일 배정건수) 규칙 순수 재현 ──────────────────────────────
//   컴포넌트 서버 쿼리 = check_ins WHERE consultant_id IS NOT NULL AND deleted_at IS NULL
//                        AND status != 'cancelled' AND checked_in_at ∈ [dayStart, dayEndExcl)
//   → 반환행을 consultant_id 별로 count. 아래는 그 술어의 클라이언트 재현.
interface CheckInLike {
  consultant_id: string | null;
  status: string;
  deleted_at: string | null;
}
function dayAssignCounts(rows: CheckInLike[]): Map<string, number> {
  const dc = new Map<string, number>();
  for (const r of rows) {
    if (!r.consultant_id) continue; // consultant_id IS NOT NULL
    if (r.deleted_at != null) continue; // deleted_at IS NULL
    if (r.status === 'cancelled') continue; // ★ 이 티켓 델타: 취소건 배제
    dc.set(r.consultant_id, (dc.get(r.consultant_id) ?? 0) + 1);
  }
  return dc;
}

test.describe('T-20260729 [랭킹] 당일 배정건수 cancelled 배제', () => {
  // ── 시나리오 1: F-5247 재배정 패턴 — 취소 배정은 카운트 제외, done 유지 ──
  test('S1 cancelled 배정 배제 + done/활성 유지 (F-5247 재배정 정합)', () => {
    // 장홍석 케이스 재현: 최현희(cancelled) + 강경민(done) 로 재배정된 1건.
    //   cancelled 는 최현희 카운트에서 빠지고, done 은 강경민 카운트에 유지되어야 함.
    const rows: CheckInLike[] = [
      { consultant_id: 'choi', status: 'cancelled', deleted_at: null }, // 취소된 이전 배정 → 제외
      { consultant_id: 'kang', status: 'done', deleted_at: null }, // 재배정(완료) → 유지
      { consultant_id: 'kang', status: 'consult_waiting', deleted_at: null }, // 활성 배정 → 유지
      { consultant_id: 'eom', status: 'consult', deleted_at: null }, // 활성 → 유지
    ];
    const dc = dayAssignCounts(rows);
    expect(dc.get('choi') ?? 0).toBe(0); // 취소만 있던 실장 = 0 (과다카운트 방지)
    expect(dc.get('kang')).toBe(2); // done + 활성 = 2
    expect(dc.get('eom')).toBe(1);
  });

  // ── 시나리오 2: 취소만 갱신됐을 때 총 카운트가 줄어드는지(과다→정상) ──
  test('S2 취소 반영 전/후 카운트 델타 — 유령 배정 제거', () => {
    const base: CheckInLike[] = [
      { consultant_id: 'a', status: 'done', deleted_at: null },
      { consultant_id: 'a', status: 'consult', deleted_at: null },
      { consultant_id: 'a', status: 'cancelled', deleted_at: null }, // 유령(취소) 1건
      { consultant_id: 'a', status: 'cancelled', deleted_at: null }, // 유령(취소) 1건
    ];
    // 이 티켓 델타 적용 후: done+consult 만 카운트 = 2 (취소 2건 배제).
    expect(dayAssignCounts(base).get('a')).toBe(2);

    // 이전(버그) 동작 = deleted_at 만 필터 → 4건 전건 카운트(과다). 회귀 방지용 대조.
    const buggy = base.filter((r) => r.consultant_id && r.deleted_at == null).length;
    expect(buggy).toBe(4);
    expect(dayAssignCounts(base).get('a')).toBeLessThan(buggy);
  });

  // ── 시나리오 3: 엣지 — soft-hide(deleted_at) + cancelled 동시, null consultant ──
  test('S3 엣지 — deleted_at·cancelled·null consultant 모두 배제', () => {
    const rows: CheckInLike[] = [
      { consultant_id: 'a', status: 'done', deleted_at: '2026-07-29T01:00:00Z' }, // soft-hide → 제외
      { consultant_id: 'a', status: 'cancelled', deleted_at: null }, // 취소 → 제외
      { consultant_id: null, status: 'done', deleted_at: null }, // 미배정 → 제외
      { consultant_id: 'a', status: 'done', deleted_at: null }, // 유일 유효
    ];
    const dc = dayAssignCounts(rows);
    expect(dc.get('a')).toBe(1);
    expect(dc.size).toBe(1);

    // 전건 취소/삭제 → 빈 맵.
    const allDead: CheckInLike[] = [
      { consultant_id: 'a', status: 'cancelled', deleted_at: null },
      { consultant_id: 'b', status: 'done', deleted_at: '2026-07-29T01:00:00Z' },
    ];
    expect(dayAssignCounts(allDead).size).toBe(0);
  });

  // ── 정적 소스 구조 단언(회귀 고정): 당일 배정건수 쿼리 = cancelled 배제 + deleted_at 유지 ──
  test('STATIC 소스 구조 — dayAssign 쿼리에 cancelled 배제 필터 존재 + 기존 가드 유지', () => {
    const src = read(PAGE);

    // 당일 배정건수 쿼리 블록 = check_ins.select('consultant_id') 로 시작하는 6-read 병렬 항목.
    const dayCiIdx = src.indexOf(".from('check_ins')\n            .select('consultant_id')");
    expect(dayCiIdx).toBeGreaterThan(-1);
    // 해당 쿼리 블록(당일 구간 fetch까지) 슬라이스.
    const block = src.slice(dayCiIdx, dayCiIdx + 800);

    // ★ 이 티켓 델타: 취소건 배제 필터.
    expect(block).toContain(".neq('status', 'cancelled')");
    // 기존 불변식 유지(회귀 방지): consultant_id NOT NULL + deleted_at IS NULL + 당일 구간.
    expect(block).toContain(".not('consultant_id', 'is', null)");
    expect(block).toContain(".is('deleted_at', null)");
    expect(block).toMatch(/gte\('checked_in_at', dayStart\)/);
    expect(block).toMatch(/lt\('checked_in_at', dayEndExcl\)/);

    // 불변식 계보 주석(staffStats·이력 표와 동일) 명시.
    expect(block).toContain('RANKING-DAYASSIGN-COUNT-CANCELLED-EXCLUDE');

    // #6 배정 건 수 소비 지점 유지.
    expect(src).toContain('dayAssignCount');
  });

  // ── 회귀 가드: staffStats·금일 배분 이력 표의 cancelled 배제 불변식 잔존(동일 불변식 일관) ──
  test('REGRESS 인접 surface(staffStats·이력 표) cancelled 배제 불변식 유지', () => {
    const src = read(PAGE);
    // staffStats + 금일 배분 이력 표(monthCheckIns 소비 루프)의 취소건 skip 이 그대로 살아있어야 함.
    const cancelledSkips = (src.match(/if \(ci\.status === 'cancelled'\) continue;/g) ?? []).length;
    expect(cancelledSkips).toBeGreaterThanOrEqual(2);

    // 랭킹 탭 admin 게이트 불변(인접 티켓 렌더 파손 없음).
    expect(src).toMatch(/mainTab !== 'ranking' \|\| !canViewRanking \|\| !clinic\) return;/);
  });
});
