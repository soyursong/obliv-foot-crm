import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260611-foot-HEALER-DEDUCT-LINK — 힐러 '다음 예약' read-only 표시 (RESVCAL item5 잔류)
 * 원천: 김주연 총괄(C0ATE5P6JTH). 결정: B확정(2026-06-12, slack ts 1781212227.795019,
 *       MSG-20260612-061151-e5n7) — 힐러 패키지 차감 = 자동차감 없음·치료사 수동.
 *
 * 본 커밋 구현 범위 = read-only indicator만 (FE-only, DB read-only, 차감 트랜잭션 무접촉):
 *   - 고객의 미래(>= today) 힐러(healer_flag) 예약 중 가장 이른 1건을 집계(nextHealerByCustomer).
 *   - 예약관리 카드에 '다음 힐러' 배지 노출 — 카드 자신이 힐러가 아니고, 미래 힐러가 카드보다 늦을 때만.
 *
 * ⚠️ 절대 금지(회귀 가드): 차감 자동연동 sub-scope 전량 드롭.
 *   autoDeductSession / deduct_session_atomic / healer_laser_confirm 차감 트리거 미접촉.
 *
 * 거대 인라인(Reservations.tsx) 관례 = source-integrity gating. 실 렌더는 supervisor field-soak.
 * DB read-only(FE 파생 표시).
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 — 다음 예약 힐러 read-only 표시
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 다음 예약 힐러 표시', () => {
  test('AC1-1: nextHealerByCustomer 상태 + 미래 힐러 read 집계 존재', () => {
    expect(RESV_PAGE, 'nextHealerByCustomer 상태 미정의')
      .toContain('const [nextHealerByCustomer, setNextHealerByCustomer]');
    // 미래(>= today) 힐러 예약을 read-only로 집계: healer_flag=true + 취소 제외 + 날짜>=today
    expect(RESV_PAGE, "healer_flag read 필터 누락").toContain(".eq('healer_flag', true)");
    expect(RESV_PAGE, '취소 예약 제외 필터 누락').toContain(".neq('status', 'cancelled')");
    expect(RESV_PAGE, '미래 예약 필터(>= today) 누락').toContain(".gte('reservation_date', today)");
    expect(RESV_PAGE, 'setNextHealerByCustomer 적재 누락').toContain('setNextHealerByCustomer(hlM)');
  });

  test('AC1-2: 가장 이른 힐러 1건만 보관 (date/time asc + 최초 1건)', () => {
    expect(RESV_PAGE, '날짜 오름차순 정렬 누락')
      .toContain(".order('reservation_date', { ascending: true })");
    expect(RESV_PAGE, '시간 오름차순 정렬 누락')
      .toContain(".order('reservation_time', { ascending: true })");
    // 최초 1건만 보관 (이미 있으면 skip → earliest 유지)
    expect(RESV_PAGE, 'earliest 1건 보관 로직 누락').toContain('!hlM[row.customer_id]');
  });

  test('AC1-3: 카드에 다음 힐러 배지 노출 (testid + 라벨)', () => {
    expect(RESV_PAGE, '다음 힐러 배지 testid 누락').toContain('next-healer-badge-${r.id}');
    expect(RESV_PAGE, '다음 힐러 라벨 누락').toContain('다음 힐러');
  });

  test('AC1-4: 카드 자신이 힐러면 중복 표시 안 함 + 미래(카드보다 늦음)일 때만 노출', () => {
    const m = RESV_PAGE.match(/next-healer-badge[\s\S]{0,200}?다음 힐러/);
    expect(m, '다음 힐러 배지 블록 파싱 실패').toBeTruthy();
    // 가드 1: 자신이 힐러가 아닐 때만 (중복 회피)
    // T-20260614-foot-HEALER-RESV-CLASSIFY-DEF supersede: 가드를 healer_flag 단독 → resvKind(영속 healer_intent||healer_flag)로 격상.
    //   healer_intent(영속)로 힐러인 카드도 '다음 힐러' 배지 중복 회피 대상에 포함(분류 SSOT 일치).
    expect(RESV_PAGE, '힐러 카드 중복 회피 가드(resvKind!==healer) 누락')
      .toContain("resvKind(r) !== 'healer'");
    // 가드 2: 미래 힐러가 현재 카드보다 늦을 때만 (hl <= cardKey → 미노출)
    expect(RESV_PAGE, '미래(카드보다 늦음) 비교 가드 누락').toContain('hl <= cardKey');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 — 차감 미발생 회귀 가드 (B확정: 자동차감 드롭)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 차감 미발생 회귀 가드', () => {
  test('AC2-1: 본 변경에 차감 자동연동 트리거 신설 없음', () => {
    // healer_laser_confirm 시점 자동차감 호출이 신설되지 않았는지 확인.
    expect(RESV_PAGE, '힐러 시술확인 시점 autoDeductSession 자동호출 신설 금지')
      .not.toMatch(/healer_laser_confirm[\s\S]{0,200}?autoDeductSession/);
    expect(RESV_PAGE, '힐러 시술확인 시점 deduct_session_atomic 자동호출 신설 금지')
      .not.toMatch(/healer_laser_confirm[\s\S]{0,200}?deduct_session_atomic/);
  });

  test('AC2-2: 신규 다음힐러 집계 블록은 select read만 (write/rpc 차감 무접촉)', () => {
    const m = RESV_PAGE.match(/고객별 '다음 예약이 힐러' read-only 집계[\s\S]*?setNextHealerByCustomer\(hlM\);/);
    expect(m, '다음힐러 집계 블록 파싱 실패').toBeTruthy();
    const block = m![0];
    expect(block, '집계 블록 내 update 금지').not.toContain('.update(');
    expect(block, '집계 블록 내 insert 금지').not.toContain('.insert(');
    expect(block, '집계 블록 내 deduct RPC 금지').not.toContain('deduct_session_atomic');
    expect(block, '집계 블록 내 autoDeductSession 금지').not.toContain('autoDeductSession');
    expect(block, 'read 전용(select) 아님').toContain(".select('customer_id, reservation_date, reservation_time')");
  });
});
