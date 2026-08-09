/**
 * E2E — T-20260806-foot-CHARTOWNER-ROSTER-STALE-PROP-HARDEN (Option A — 가시화)
 *
 * 배경: 2번 차트 담당자(customers.assigned_staff_id) 저장 후 당일 open check_in 으로의 하향전파
 *   헬퍼(updateTodayOpenCheckInConsultant)가 latestCheckIn 이 stale(취소/완료/당일 아님/부재)이면 'none' 을
 *   반환하고 아무 안내 없이 종료 → 담당자만 조용히 갱신되고 배정 명단엔 미반영되는 silent divergence.
 *   현장은 "등록됐다"고 인지하지만 명단엔 없음.
 *
 * FIX(Option A, FE-only): 저장·명단 반영 로직은 무변경(membership 소스=check_ins-only by-design 계약 무접점).
 *   하향전파 결과를 스태프에게 노출하는 안내만 추가 — silent no-op 제거.
 *   · 'none'(당일 open check_in 부재) → 묵음 제외 채널 toast.warning 로 "명단 미반영" 안내.
 *   · 'error'(write 실패) → toast.error. rows-affected=0 을 'none'(미반영)이 아닌 'error'(실패)로 분리(오분류 차단).
 *   · toast.info/success 는 @/lib/toast wrapper 에서 묵음이므로 안내 채널로 쓰지 않음(현장 미노출 방지).
 *
 * 검증(정적 = 결정적 회귀 방어):
 *   [AC1] rows-affected=0 → 'none' 아님, 'error' 로 분리(오분류 차단).
 *   [AC2] 래퍼(syncChartOwnerToTodayRoster) = 'none' → toast.warning / 'error' → toast.error (묵음 제외 채널).
 *   [AC3] 두 담당자 저장 경로(Zone1 담당자 셀렉트 · 상담탭 담당자 셀렉트) 모두 래퍼 경유(silent no-op 잔존 0).
 *   [AC4] 계약 무접점 회귀: 헬퍼는 여전히 check_ins.consultant_id 만 write + 당일/open/done/cancelled 게이트 보존
 *         + assigned_staff_id 미덮음. 안내 문구에 개발용어 없음(현장 언어).
 *
 * E2E(브라우저 클릭) 대신 정적 소스 단언: 본 건은 특정 toast 채널 노출 여부(FE 안내 가시성)가 계약의 핵심이며,
 *   stale check_in + 인증 상태 시딩으로 토스트를 실제 렌더시키는 것보다 소스 단언이 회귀를 더 결정적으로 잡는다.
 *   (참조 spec: T-20260724-foot-ASSIGN-CHARTOWNER-DISTRIB-SYNC — 동일 헬퍼 정적 단언 패턴)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

test.describe('[정적] CHARTOWNER-ROSTER-STALE 가시화 하드닝', () => {
  const chart = read('src/pages/CustomerChartPage.tsx');

  test('AC1: rows-affected=0 은 "none"(미반영)이 아니라 "error"(실패)로 분리 — 오분류 차단', () => {
    const idx = chart.indexOf('const updateTodayOpenCheckInConsultant');
    expect(idx).toBeGreaterThan(0);
    const block = chart.slice(idx, idx + 1800);
    // 0-row 분기가 존재하고 그 분기가 'error' 를 반환(더 이상 'none' 이 아님)
    const zeroRowIdx = block.indexOf('data.length === 0');
    expect(zeroRowIdx).toBeGreaterThan(0);
    const zeroRowBlock = block.slice(zeroRowIdx, zeroRowIdx + 200);
    expect(zeroRowBlock).toContain("return 'error'");
    expect(zeroRowBlock).not.toContain("return 'none'");
  });

  test('AC2: 래퍼가 결과를 묵음 제외 채널로 노출 — none→warning / error→error', () => {
    const idx = chart.indexOf('const syncChartOwnerToTodayRoster');
    expect(idx).toBeGreaterThan(0);
    const block = chart.slice(idx, idx + 900);
    // 헬퍼 결과를 받아 분기
    expect(block).toContain('await updateTodayOpenCheckInConsultant(staffId)');
    expect(block).toMatch(/result === 'none'/);
    expect(block).toMatch(/result === 'error'/);
    // 묵음 제외 채널만 사용(info/success 는 @/lib/toast 에서 묵음 → 안내 채널 금지)
    expect(block).toContain('toast.warning(');
    expect(block).toContain('toast.error(');
    expect(block).not.toContain('toast.info(');
    expect(block).not.toContain('toast.success(');
  });

  test('AC3: 두 담당자 저장 경로 모두 래퍼 경유 — 직접 헬퍼 호출(silent no-op) 잔존 0', () => {
    // 담당자 저장 경로에서 원시 헬퍼를 직접 await 하지 않는다(래퍼만 호출)
    expect(chart).not.toContain('await updateTodayOpenCheckInConsultant(v)');
    // 래퍼 호출은 정확히 2곳(Zone1 담당자 셀렉트 + 상담탭 담당자 셀렉트)
    const calls = chart.match(/await syncChartOwnerToTodayRoster\(v\)/g) ?? [];
    expect(calls.length).toBe(2);
  });

  test('AC4: 계약 무접점 회귀 — 헬퍼는 check_ins.consultant_id 만 write + 게이트 보존 + assigned_staff_id 미덮음', () => {
    const idx = chart.indexOf('const updateTodayOpenCheckInConsultant');
    const block = chart.slice(idx, idx + 1600); // 헬퍼 본문 창(래퍼 이전)
    expect(block).toContain('.update({ consultant_id: staffId })');
    expect(block).not.toContain('assigned_staff_id'); // 영구값 미덮음(방향 격리)
    expect(block).toContain('!== todaySeoulISODate()'); // 당일(KST) 게이트
    expect(block).toContain("ci.status === 'cancelled'"); // 취소 제외
    expect(block).toContain("ci.status === 'done'"); // done 보존(RED LINE)
  });

  test('AC4b: 안내 문구는 현장 언어 — 개발용어/코드 식별자 미포함', () => {
    const idx = chart.indexOf('const syncChartOwnerToTodayRoster');
    const block = chart.slice(idx, idx + 900);
    // 스태프에게 나가는 문구
    expect(block).toContain('담당자는 저장됐지만');
    expect(block).toContain('배정 명단');
    // 문구(따옴표 안)에 개발용어가 새어나가지 않음
    const msgs = [...block.matchAll(/toast\.(warning|error)\('([^']+)'\)/g)].map((m) => m[2]);
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    for (const m of msgs) {
      expect(m).not.toMatch(/check_in|consultant_id|assigned_staff_id|RLS|rows-affected|none|error|toast/i);
    }
  });
});
