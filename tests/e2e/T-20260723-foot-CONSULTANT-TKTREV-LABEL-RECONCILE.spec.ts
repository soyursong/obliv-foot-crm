/**
 * T-20260723-foot-CONSULTANT-TKTREV-LABEL-RECONCILE
 * 통계 '상담실장 티켓팅 실적'(View B / foot_stats_consultant) ↔ 일마감 대사 표시(표시계층 only).
 *
 * 부모 RCA(T-20260723-foot-CONSULTANT-TKTREV-DAYCLOSE-RECONCILE, done) 결론:
 *   View B = 상담실장에게 귀속된 매출만 집계(BINDING-3). 일마감 = 전체 결제.
 *   차액 Δ = 미귀속분(상담이력 없는 결제 + 비상담직군). 수학적으로 View B ⊂ 전체결제 →
 *   두 값이 같아지는 건 by-design 상 불가(회귀·버그 아님).
 *
 * 스코프(표시계층만): (1) by-design 안내 문구, (2) 미귀속분 파생 표시.
 *   미귀속 = 총매출(순) − 상담사 귀속합. ∴ 실적합 + 미귀속 ≡ 총매출(순) (항등).
 *   집계 산식·귀속 스코프·RPC·DB 무변경. reconcileConsultantRevenue = 순수 read-only 파생.
 *
 * 순수 로직 불변식(auth·server 불요, unit project). 실 화면 렌더/현장 체감 =
 *   supervisor field-soak(김주연 총괄 confirm, AC5).
 */

import { test, expect } from '@playwright/test';
import { reconcileConsultantRevenue } from '../../src/lib/consultantSalesExport';
import type { ConsultantRow } from '../../src/lib/stats';

// 고정 픽스처: 상담실장 3명 귀속 매출 합 = 1,000,000 + 600,000 + 300,000 = 1,900,000
const ROWS: ConsultantRow[] = [
  { consultant_id: 'a', name: '실장A', ticketing_count: 8, package_count: 3, avg_amount: 200_000, total_amount: 1_000_000, consulted_customer_count: 5 },
  { consultant_id: 'b', name: '실장B', ticketing_count: 3, package_count: 0, avg_amount: null,     total_amount: 300_000,   consulted_customer_count: 0 },
  { consultant_id: 'c', name: '실장C', ticketing_count: 10, package_count: 2, avg_amount: 150_000, total_amount: 600_000,   consulted_customer_count: 4 },
];

test.describe('상담실장 실적 ↔ 일마감 대사 (표시계층 파생)', () => {
  // ─ 시나리오 1: 정상 동선 — 실적합 + 미귀속 = 총매출(순) 항등 성립 ─
  test('시나리오1: 미귀속 = 총매출 − 실적합, 항등(실적합+미귀속=총매출) 성립', () => {
    // 일마감 전체 결제(총매출 순) = 2,500,000 (귀속 1,900,000 + 미귀속 600,000)
    const recon = reconcileConsultantRevenue(ROWS, 2_500_000);
    expect(recon.attributed).toBe(1_900_000);        // 상담사 귀속합 (RPC total_amount 합)
    expect(recon.unattributed).toBe(600_000);        // 미귀속 = 2,500,000 − 1,900,000
    expect(recon.total).toBe(2_500_000);             // 총매출(순) = 일마감 대사 기준
    // 항등: 실적합 + 미귀속 ≡ 총매출 (반올림 오차 없이 정확히)
    expect(recon.attributed + recon.unattributed).toBe(recon.total);
  });

  // ─ 시나리오 2-1: 미귀속 0인 기간 (모든 결제가 상담사 귀속) ─
  test('시나리오2-1: 미귀속 0 → 합계 = 총매출 그대로', () => {
    const recon = reconcileConsultantRevenue(ROWS, 1_900_000);
    expect(recon.attributed).toBe(1_900_000);
    expect(recon.unattributed).toBe(0);
    expect(recon.total).toBe(1_900_000);
    expect(recon.attributed + recon.unattributed).toBe(recon.total);
  });

  // ─ 시나리오 2-2: 데이터 없는 기간 → 실적/미귀속/총매출 모두 0, 에러 없음 ─
  test('시나리오2-2: 빈 기간(실장 0명·매출 0) → 전부 0', () => {
    const recon = reconcileConsultantRevenue([], 0);
    expect(recon.attributed).toBe(0);
    expect(recon.unattributed).toBe(0);
    expect(recon.total).toBe(0);
  });

  // ─ 불변: total_amount(RPC canonical, net·accounting_date)를 그대로 합산 — 재집계 없음 ─
  test('불변: 귀속합은 RPC total_amount 합(재집계·역산 아님)', () => {
    // total_amount 만으로 합산됨 (avg_amount×ticketing 역산 dead-path 미발화)
    const recon = reconcileConsultantRevenue(ROWS, 3_000_000);
    expect(recon.attributed).toBe(1_000_000 + 300_000 + 600_000);
  });

  // ─ 엣지: 실장 0명이지만 전체결제는 존재 → 전액 미귀속 ─
  test('엣지: 상담사 0명·총매출 존재 → 전액 미귀속', () => {
    const recon = reconcileConsultantRevenue([], 480_000);
    expect(recon.attributed).toBe(0);
    expect(recon.unattributed).toBe(480_000);
    expect(recon.total).toBe(480_000);
    expect(recon.attributed + recon.unattributed).toBe(recon.total);
  });
});
