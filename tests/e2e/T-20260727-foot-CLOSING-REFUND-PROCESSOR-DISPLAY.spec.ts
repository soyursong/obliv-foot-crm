/**
 * E2E spec — T-20260727-foot-CLOSING-REFUND-PROCESSOR-DISPLAY
 *
 * 김주연 총괄 2차 리포팅. 1차(T-20260717-...SALESPATIENT-REFUND-PROCESSOR-COLUMN)는
 * 매출관리>환자별 탭에만 반영 → 일마감(Closing.tsx) 화면 미커버 + 일마감 환불 이력의
 * 담당자 컬럼이 실제 처리자 아닌 고객 배정담당(customers.assigned_staff_id) 오표시 버그.
 *
 * ── Part 1 (FE, DB의존 없음) — 이 spec 검증 범위 ─────────────────────────────
 *   · 단건 환불 쿼리(payments): created_by + processor:user_profiles!payments_created_by_fkey(name)
 *     JOIN 추가(SalesPatientTab 패턴 REUSE). FK 기본명 prod 확인(20260717140000 마이그 dryrun §2 검증필).
 *   · enrichedRows 단건행 processor_name = payments.processor.name 승계 / 미기록 → null.
 *   · 환불 이력 처리자 셀(closing-refund-processor)을 r.staff_name(버그, assigned_staff)
 *     → r.processor_name 로 데이터소스 정정. 미기록은 '—'.
 *
 * ── Part 1 블로커(패키지) ────────────────────────────────────────────────────
 *   · package_payments 는 created_by 컬럼/FK 부재 → processor JOIN 불가.
 *   · refund_package_payment RPC 는 package_payments(payments 아님)에 INSERT + created_by 미캡처.
 *   · ∴ 패키지 환불행 processor_name = null('—'). 실 처리자 표시는 Part 2(RPC created_by 캡처
 *     = 신규 컬럼+FK DDL, DA CONSULT 재조정 필요) 이후 백필로만 가능.
 *
 * ★ 검증 방식: 일마감(/admin/closing)은 현장 PHI 계정 → 인증 우회 불가.
 *   → 정적 코드 구조 검증 + 앱 로드(HTTP 200) + 회귀 가드(기존 환불 섹션 testid 보존).
 *   실브라우저 수치/이름 정합은 하단 갤탭 실기기 현장 confirm 체크리스트.
 *
 * ★ db_change=false (Part 1 read-only 표시 정정). 신규 컬럼/테이블/enum/CHECK/RLS/RPC = 0.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const closing = () => read('src/pages/Closing.tsx');

test.describe('T-20260727-foot-CLOSING-REFUND-PROCESSOR-DISPLAY', () => {

  // ── 회귀 가드: 앱 정상 로드 ────────────────────────────────────────────────
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1: 단건 결제 쿼리에 created_by + processor JOIN 추가 ─────────────────
  test('AC-1: 단건 payments 쿼리에 created_by + payments_created_by_fkey processor JOIN', () => {
    const c = closing();
    // SalesPatientTab 과 동일 alias/FK 재사용
    expect(c).toContain('processor:user_profiles!payments_created_by_fkey(name)');
    // created_by SELECT 포함
    expect(c).toMatch(/created_by,\s*processor:user_profiles!payments_created_by_fkey\(name\)/);
    // many-to-one embed 배열추론 → unknown 경유 cast (런타임 객체)
    expect(c).toContain('as unknown as PaymentRow[]');
  });

  // ── AC-2: 단건 enrichedRow 가 실제 처리자(processor.name) 를 승계 ───────────
  test('AC-2: 단건 enrichedRow processor_name = payments.processor.name (assigned_staff 아님)', () => {
    const c = closing();
    expect(c).toContain('processor_name: p.processor?.name ?? null');
    // EnrichedRow 타입에 processor_name 필드 선언
    expect(c).toMatch(/processor_name\?:\s*string \| null/);
  });

  // ── AC-3: 환불 이력 처리자 셀 데이터소스 정정 (staff_name → processor_name, '—') ──
  test('AC-3: 환불 처리자 셀 = r.processor_name ?? "—" (버그행 r.staff_name 제거)', () => {
    const c = closing();
    // 신규 처리자 셀 (testid + processor_name 소스 + '—' fallback)
    expect(c).toContain('data-testid="closing-refund-processor"');
    expect(c).toMatch(/data-testid="closing-refund-processor">\{r\.processor_name \?\? '—'\}/);
    // 버그 셀(환불 목록에서 r.staff_name ?? '미지정')이 처리자 위치에서 제거됨
    expect(c).not.toMatch(/data-testid="closing-refund-processor">\{r\.staff_name/);
  });

  // ── AC-4(블로커 가드): 패키지는 존재하지 않는 FK 로 JOIN 걸지 않음 (쿼리 파손 방지) ──
  test('AC-4: package_payments 쿼리에 존재하지 않는 processor JOIN 을 걸지 않음', () => {
    const c = closing();
    // package_payments_created_by_fkey 는 prod 에 부재 → embed 걸면 PostgREST 400 → 페이지 파손
    expect(c).not.toContain('package_payments_created_by_fkey');
    // 패키지 enrichedRow 는 processor_name = null 명시
    expect(c).toContain('processor_name: null');
  });

  // ── 회귀 가드: 기존 금일 환불 섹션 구조 보존 (T-20260717 STATS-MISSING) ──────
  test('회귀: 금일 환불 요약/목록/빈상태 testid 보존', () => {
    const c = closing();
    expect(c).toContain('data-testid="closing-refund-summary-card"');
    expect(c).toContain('data-testid="closing-refund-count-badge"');
    expect(c).toContain('data-testid="closing-refund-total-amount"');
    expect(c).toContain('data-testid="closing-refund-list"');
    expect(c).toContain('data-testid="closing-refund-empty"');
  });

  // ── 회귀 가드: 결제내역 본표(main table)는 staff_name(배정담당) 유지 — 무접촉 ──
  test('회귀: 결제내역 본표 staff_name 컬럼 무변경 (money/담당자별 로직 무접촉)', () => {
    const c = closing();
    // 담당자별 그룹핑 키(assigned_staff 기반)는 그대로
    expect(c).toContain("const key = r.staff_name ?? '미지정';");
  });
});
