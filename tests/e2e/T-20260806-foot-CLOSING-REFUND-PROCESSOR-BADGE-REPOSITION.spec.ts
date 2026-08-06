/**
 * E2E spec — T-20260806-foot-CLOSING-REFUND-PROCESSOR-BADGE-REPOSITION
 *
 * 김주연 총괄 2026-08-06: 일마감>결제내역의 '환불처리 ○○○'(환불처리 직원명) 서브라인을
 *   행 중앙 담당자 컬럼 → 오른쪽 배지 영역(패키지/환불/완료 배지 옆, 환불 버튼 쪽)으로 위치 이동.
 *   첨부 스크린샷(F0BN9SX1HFX, 20260806_135836.png) 빨간 화살표 = 이동 목표 위치(배지 셀).
 *
 * ── 변경 범위 (FE, 순수 포지셔닝만) ────────────────────────────────────────────
 *   · 선행 구현(9802b523, T-20260805-...-PAYDETAIL-REFUND-PROCESSOR-DISPLAY) 위에 위치만 이동.
 *   · 표시 판정(refundProcessorForRow)·데이터소스(processor JOIN)·null 가드('—')·승계 규칙은 그대로 유지.
 *   · 담당자(중앙) 셀 = staff_name(배정담당)만 표시로 원복. 배지 셀(패키지/환불/완료 배지 아래)에 서브라인 이동.
 *
 * ★ 검증 방식: 일마감(/admin/closing)은 현장 PHI 계정 → 인증 우회 불가.
 *   → 정적 코드 구조 검증(위치 순서) + 앱 로드(HTTP 200) + 회귀 가드.
 *   실브라우저 위치 정합은 하단 갤탭 실기기 현장 confirm 체크리스트.
 *
 * ★ db_change=false. 신규 컬럼/테이블/enum/CHECK/RLS/RPC/DDL/mig/EF = 0. 레이아웃(포지셔닝)만.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const closing = () => read('src/pages/Closing.tsx');

test.describe('T-20260806-foot-CLOSING-REFUND-PROCESSOR-BADGE-REPOSITION', () => {

  // ── 회귀 가드: 앱 정상 로드 ────────────────────────────────────────────────
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1: 환불처리 서브라인이 여전히 존재(표시 자체는 유지) ──────────────────────
  test('AC-1: 환불처리 직원명 서브라인 testid 유지', () => {
    const c = closing();
    expect(c).toContain('data-testid="closing-paydetail-refund-processor"');
    expect(c).toMatch(/환불처리 \{rp\.name \?\? '—'\}/);
  });

  // ── AC-1: 서브라인이 배지 셀(완료 배지) 이후에 위치 — 오른쪽 배지 영역으로 이동 ────────
  test('AC-1: 환불처리 서브라인 = 배지(완료 badge) 이후 위치(오른쪽 배지 영역)', () => {
    const c = closing();
    const badgeIdx = c.indexOf('data-testid="fully-refunded-badge"');
    const procIdx = c.indexOf('data-testid="closing-paydetail-refund-processor"');
    const refundBtnIdx = c.indexOf('data-testid="refund-open-btn"');
    expect(badgeIdx).toBeGreaterThan(0);
    expect(procIdx).toBeGreaterThan(0);
    // 배지 셀(완료 badge) 이후 + 환불 버튼 근처 = 오른쪽 배지 영역
    expect(procIdx).toBeGreaterThan(badgeIdx);
    expect(procIdx).toBeLessThan(refundBtnIdx);
  });

  // ── AC-1(이동 검증): 담당자(중앙) 셀에는 더 이상 환불처리 서브라인 없음 ──────────────
  test('AC-1: 담당자 셀은 staff_name(배정담당)만 — 환불처리 서브라인 제거됨', () => {
    const c = closing();
    // 담당자 셀 스니펫 추출: staff_name 표시부부터 그 td 닫힘까지
    const staffLine = "{r.staff_name ?? <span className=\"text-muted-foreground/60\">미지정</span>}";
    const staffIdx = c.indexOf(staffLine);
    expect(staffIdx).toBeGreaterThan(0);
    // staff_name 표시 직후 td 종료 전 구간에 환불처리 서브라인이 없어야 함(중앙 컬럼에서 제거)
    const after = c.slice(staffIdx, staffIdx + 200);
    expect(after).not.toContain('closing-paydetail-refund-processor');
    expect(after).not.toContain('refundProcessorForRow');
  });

  // ── AC-3: 표시 판정·null 가드 predecessor 그대로 유지 ──────────────────────────
  test('AC-3: refundProcessorForRow 헬퍼·null 가드 로직 무변경', () => {
    const c = closing();
    expect(c).toContain('const refundProcessorForRow');
    expect(c).toMatch(/if \(r\.refunded\) return \{ has: true, name: r\.refund_processor_name \?\? null \}/);
    expect(c).toMatch(/if \(r\.payment_type === 'refund'\) return \{ has: true, name: r\.processor_name \?\? null \}/);
    // 이동한 위치에서도 has 게이트 + '—' fallback 유지
    expect(c).toContain('if (!rp.has) return null;');
    expect(c).toMatch(/환불처리 \{rp\.name \?\? '—'\}/);
  });

  // ── AC-2(db_change=false): 데이터소스 JOIN·집계·합계 net 무변경 ─────────────────
  test('AC-2: 데이터소스(processor JOIN)·합계 net 불변식 무접촉', () => {
    const c = closing();
    expect(c).toContain('processor:user_profiles!payments_created_by_fkey(name)');
    expect(c).toContain('processor_name: p.processor?.name ?? null');
    expect(c).toContain('orig.refund_processor_name = r.processor_name ?? null');
    // 합계 net reduce 보존
    expect(c).toContain("r.payment_type === 'refund' ? -r.amount : r.amount");
  });

  // ── 회귀: 담당자(배정담당) 컬럼·그룹핑·배지 무접촉 ───────────────────────────────
  test('회귀: 담당자 배정담당 표시·그룹핑 키·배지 보존', () => {
    const c = closing();
    expect(c).toContain("{r.staff_name ?? <span className=\"text-muted-foreground/60\">미지정</span>}");
    expect(c).toContain("const key = r.staff_name ?? '미지정';");
    // 배지 3종 보존
    expect(c).toContain('data-testid="refunded-badge"');
    expect(c).toContain('data-testid="fully-refunded-badge"');
  });

  // ── 회귀: 탭 1 금일 환불 이력 리스트(T-20260727) 무접촉 ────────────────────────
  test('회귀: 탭 1 금일 환불 이력 리스트 보존', () => {
    const c = closing();
    expect(c).toContain('data-testid="closing-refund-processor"');
    expect(c).toContain('data-testid="closing-refund-list"');
  });
});
