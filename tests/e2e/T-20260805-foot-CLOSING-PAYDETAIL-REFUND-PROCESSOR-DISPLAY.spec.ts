/**
 * E2E spec — T-20260805-foot-CLOSING-PAYDETAIL-REFUND-PROCESSOR-DISPLAY
 *
 * 김주연 총괄 2026-08-05: "환불처리 직원명 표기하는 거 매출집계-환자별 탭에 붙인 거,
 *   일마감-결제내역에도 동일하게 붙여줘" → 환불처리 직원명 표시 화면 parity 확장(4번째 화면).
 *
 * ── 선행 확인 결과(착수 전 게이트) ────────────────────────────────────────────
 *   · 첨부 스크린샷(F0BMZTU1ZV3)의 화면 = Closing.tsx '탭 2: 결제내역' 통합 결제내역 테이블
 *     (groupedDisplayRows.map, data-testid="closing-pay-row").
 *   · 이 '결제내역' 테이블은 T-20260727-foot-CLOSING-REFUND-PROCESSOR-DISPLAY 가 처리자명을 붙인
 *     '금일 환불' 이력 리스트(탭 1 summary, closing-refund-list)와 **별도 컴포넌트**.
 *     → 결제내역 테이블의 환불 행에는 처리자명이 없었다(담당자 컬럼=r.staff_name=배정담당) = 실 gap → 구현.
 *
 * ── 구현 범위 (FE, DB 의존 없음 — 순수 표시 parity) ───────────────────────────
 *   · 데이터소스 이미 prod 실재: 단건=payments.created_by(T-20260717) / 패키지=package_payments.created_by
 *     (T-20260727-PKG-CAPTURE). 신규 컬럼/RPC/DDL = 0. db_change=false.
 *   · 병합 환불(원결제행 annotate): 환불행 processor_name → orig.refund_processor_name 승계(refund_date/time 규칙 동일).
 *   · 자체 환불행(고아 환불, 원결제 당일 목록 밖): 행 자체 processor_name = 환불 처리자.
 *   · 결제내역 테이블 담당자 셀에 '환불처리 {name}' 서브라인 병기(배정담당과 별개 축, 라벨로 구분). 미기록 → '—'.
 *   · 매출집계>환자별 탭(SalesPatientTab '처리 직원명', sales-patient-processor)과 시각 parity.
 *
 * ★ 검증 방식: 일마감(/admin/closing)은 현장 PHI 계정 → 인증 우회 불가.
 *   → 정적 코드 구조 검증 + 앱 로드(HTTP 200) + 회귀 가드(기존 결제내역/환불 섹션 보존).
 *   실브라우저 이름 정합은 하단 갤탭 실기기 현장 confirm 체크리스트.
 *
 * ★ db_change=false. 신규 컬럼/테이블/enum/CHECK/RLS/RPC = 0.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const closing = () => read('src/pages/Closing.tsx');

test.describe('T-20260805-foot-CLOSING-PAYDETAIL-REFUND-PROCESSOR-DISPLAY', () => {

  // ── 회귀 가드: 앱 정상 로드 ────────────────────────────────────────────────
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1/AC-2: 결제내역 환불 행에 환불처리 직원명 서브라인 노출 ────────────────
  test('AC-1/2: 결제내역 담당자 셀에 환불처리 직원명 서브라인(testid) 노출', () => {
    const c = closing();
    // 신규 서브라인 testid
    expect(c).toContain('data-testid="closing-paydetail-refund-processor"');
    // '환불처리 {이름}' 라벨 병기(배정담당과 별개 축 명시)
    expect(c).toMatch(/환불처리 \{rp\.name \?\? '—'\}/);
  });

  // ── AC-2: 병합 환불(원결제행)이 환불행 processor_name 을 승계 ───────────────────
  test('AC-2: 병합 환불 → orig.refund_processor_name 승계 (단건+패키지 공통 경로)', () => {
    const c = closing();
    // EnrichedRow 타입에 refund_processor_name 필드 선언
    expect(c).toMatch(/refund_processor_name\?:\s*string \| null/);
    // 병합 annotate 시 승계
    expect(c).toContain('orig.refund_processor_name = r.processor_name ?? null');
  });

  // ── AC-1/AC-2: 표시행 환불 처리자 산출 헬퍼(병합/고아 환불 양쪽 커버) ────────────
  test('AC-1/2: refundProcessorForRow 헬퍼 — refunded(병합) + payment_type=refund(고아) 커버', () => {
    const c = closing();
    expect(c).toContain('const refundProcessorForRow');
    // 병합 환불행: 승계된 refund_processor_name
    expect(c).toMatch(/if \(r\.refunded\) return \{ has: true, name: r\.refund_processor_name \?\? null \}/);
    // 자체 환불행(고아): 행 processor_name
    expect(c).toMatch(/if \(r\.payment_type === 'refund'\) return \{ has: true, name: r\.processor_name \?\? null \}/);
  });

  // ── AC-3: 미기록(created_by NULL) 과거 행 → '—' (에러/공란 아님) ────────────────
  test('AC-3: 처리자 미기록 → "—" fallback (승계·표시 양단)', () => {
    const c = closing();
    // 승계 시 NULL 안전
    expect(c).toContain('orig.refund_processor_name = r.processor_name ?? null');
    // 표시 시 '—' fallback
    expect(c).toMatch(/환불처리 \{rp\.name \?\? '—'\}/);
  });

  // ── AC-4: 매출집계>환자별 탭과 시각 parity (동일 데이터소스 축) ──────────────────
  test('AC-4: SalesPatientTab 처리 직원명과 동일 축(created_by→user_profiles.name) 재사용', () => {
    const sales = read('src/components/sales/SalesPatientTab.tsx');
    // 환자별 탭 처리 직원명 컬럼(원본 기능)
    expect(sales).toContain('data-testid="sales-patient-processor"');
    expect(sales).toContain('processor:user_profiles!payments_created_by_fkey(name)');
    // 결제내역도 동일 processor JOIN 데이터소스 재사용(신규 패턴 도입 없음)
    const c = closing();
    expect(c).toContain('processor:user_profiles!payments_created_by_fkey(name)');
    expect(c).toContain('processor_name: p.processor?.name ?? null');
  });

  // ── AC-5(회귀): 결제내역 본표 기존 컬럼/합계/담당자 로직 무접촉 ───────────────────
  test('회귀: 결제내역 담당자(배정담당) 컬럼·그룹핑 키 무변경', () => {
    const c = closing();
    // 담당자 셀의 배정담당(staff_name) 표시 보존 — 미지정 fallback 유지
    expect(c).toContain("{r.staff_name ?? <span className=\"text-muted-foreground/60\">미지정</span>}");
    // 담당자별 그룹핑 키(assigned_staff 기반) 무변경
    expect(c).toContain("const key = r.staff_name ?? '미지정';");
    // 합계 불변식: 환불 net reduce 보존
    expect(c).toContain("r.payment_type === 'refund' ? -r.amount : r.amount");
  });

  // ── 회귀 가드: 탭 1 금일 환불 이력 리스트(T-20260727) 무접촉 ────────────────────
  test('회귀: 탭 1 금일 환불 이력 리스트(closing-refund-processor) 보존', () => {
    const c = closing();
    // 별도 컴포넌트(탭 1) 처리자 셀 유지 — 본 티켓은 탭 2 결제내역만 추가
    expect(c).toContain('data-testid="closing-refund-processor"');
    expect(c).toContain('data-testid="closing-refund-list"');
    // merged_refund 표시 스킵 규칙 보존(합계 net 불변식 유지)
    expect(c).toContain('r.merged_refund = true;');
  });
});
