/**
 * E2E Spec: T-20260811-foot-PLANA-REFUND-PKGSESSION-INVALIDATE
 *   플랜A 실테스트(최필경 총괄) 후속 — 패키지 환불 후 잔여 회차·미수 살아있음(money-path 정합).
 *
 * ── RC (dev DB 런타임 재현, kcdqtyivtqcjmcrdjkqi) ──────────────────────────────
 *   환불 전: status=active, 잔여 heated/unheated=1/11, outstanding=0
 *   환불 후: status=refunded(트리거 foot_recompute_package_status 정상 전이),
 *            잔여=1/11 (여전히 살아있음), outstanding=2,960,000 (부활)
 *   → money 원장·status 전이는 정상(환불행 append-only INSERT). 결함은 순수 파생/표시 레이어:
 *     (1) get_package_remaining(RPC)이 declared−used('used'만)로 잔여 산출·status 무시,
 *     (2) 상세 미수 박스가 computeOutstanding(total, net)을 status 무관 계산 → net=0 시 미수=total 부활.
 *   loadCustomerOutstanding(리스트 뱃지 SSOT)은 이미 status='active' 한정 → 상세시트만 outlier.
 *
 * ── FIX (db_change=false · FE 표시 게이팅 · 원장/세션/산식 semantics 무변경) ────────
 *   PackageDetailSheet + 리스트에 isRefundVoided(status==='refunded') 게이팅:
 *   AC-1: 잔여 회차 표시 0화(displayRemaining 전 종류 0) — 세션행/RPC 불변, 표시단 clamp.
 *   AC-2: 미수(패키지 잔금/진료비 잔금) 0화 — active-only SSOT(loadCustomerOutstanding) 정합.
 *   AC-3: 상태전이=트리거가 이미 수행(refunded) + '환불완료 · 사용불가' 배너 + 회차소진 버튼 active 게이트
 *         + 전 소진 picker active-only 필터(CheckInDetailSheet/CustomerChartPage/PackageTicketReadonlyList).
 *   AC-4: 리스트 환불행 회색(무효) 처리 — bg-muted/opacity + '환불' 뱃지.
 *   AC-6: hard-delete 0 · 환불 원장 append-only 보존(process_refund/refund_package_payment 무변경).
 *
 * ── 검증 방식 ────────────────────────────────────────────────────────────────
 *   결정론적 source-guard(auth/DB/webServer 불요·skip 0). 게이팅 로직이 소스에 착지했는지 단언.
 *   RC 실증(status 전이+잔여/미수 부활)은 dev DB 런타임으로 별도 확인(티켓 evidence).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../');
const PKG_SRC = fs.readFileSync(path.join(REPO_ROOT, 'src/pages/Packages.tsx'), 'utf-8');

test.describe('T-20260811-foot-PLANA-REFUND-PKGSESSION-INVALIDATE — 환불 후 잔여회차·미수 정합(표시 게이팅)', () => {
  // ── AC-1: 잔여 회차 표시 0화 ─────────────────────────────────────────────
  test('AC-1: 환불 티켓 잔여 회차 표시 0화 (displayRemaining 전 종류 0)', () => {
    // isRefundVoided 게이트 정의
    expect(PKG_SRC).toMatch(/const\s+isRefundVoided\s*=\s*pkg\.status\s*===\s*'refunded'/);
    // displayRemaining: 환불이면 전 세션종류 0
    expect(PKG_SRC).toMatch(/displayRemaining[\s\S]{0,240}heated:\s*0[\s\S]{0,120}unheated:\s*0/);
    // Stat 그리드가 remaining 대신 displayRemaining 소비 (잔여 0/total)
    expect(PKG_SRC).toContain("displayRemaining?.heated ?? pkg.heated_sessions");
    expect(PKG_SRC).toContain("displayRemaining?.unheated ?? pkg.unheated_sessions");
    // remaining 직접참조가 Stat 그리드에 잔존하지 않음(회귀 방지)
    expect(PKG_SRC).not.toContain("(remaining?.heated ?? pkg.heated_sessions)");
  });

  // ── AC-2: 미수 0화 (active-only SSOT 정합) ────────────────────────────────
  test('AC-2: 환불 티켓 미수(패키지/진료비 잔금) 0화', () => {
    // 패키지 잔금: 환불이면 outstanding=0
    expect(PKG_SRC).toMatch(/const\s+outstanding\s*=\s*isRefundVoided\s*\?\s*0\s*:\s*computeOutstanding\(pkg\.total_amount/);
    // 진료비 잔금 박스 자체를 환불 시 억제
    expect(PKG_SRC).toMatch(/\{\s*!isRefundVoided\s*&&\s*\(\(pkg\.consultation_fee/);
    // 리스트 잔금 컬럼도 환불 시 0
    expect(PKG_SRC).toMatch(/p\.status\s*===\s*'refunded'\s*\?\s*0\s*:\s*computeOutstanding\(p\.total_amount/);
  });

  // ── AC-3: 사용불가 배너 + 상태 표시 ──────────────────────────────────────
  test('AC-3: 환불완료·사용불가 배너 렌더', () => {
    expect(PKG_SRC).toContain('pkg-refunded-void-banner');
    expect(PKG_SRC).toContain('환불완료 · 사용불가');
    // 회차소진/환불/양도 액션은 status==='active' 게이트 하에서만 (refunded=버튼 미노출=사용불가)
    expect(PKG_SRC).toContain("{pkg.status === 'active' && (");
  });

  // ── AC-4: 리스트 환불행 회색(무효) 처리 ──────────────────────────────────
  test('AC-4: 리스트 환불행 회색 처리 + 식별 testid', () => {
    expect(PKG_SRC).toContain('pkg-row-refunded');
    expect(PKG_SRC).toMatch(/p\.status\s*===\s*'refunded'\s*&&\s*'bg-muted\/30 text-muted-foreground opacity-60'/);
    // '환불' 뱃지 라벨 유지(무효 상태 라벨)
    expect(PKG_SRC).toContain("refunded: '환불'");
  });

  // ── AC-6: 원장 무결 — 표시 게이팅만, 환불 write-path 무변경 ────────────────
  test('AC-6: hard-delete 0 · 환불 원장 append-only 보존 (write-path 무접촉)', () => {
    // 환불 실행은 여전히 서버 RPC refund_package_payment 경유 (FE 직접 원장 mutate 금지)
    expect(PKG_SRC).toContain("supabase.rpc('refund_package_payment'");
    // 본 티켓 게이팅은 packages.status 를 FE 에서 직접 write 하지 않는다(트리거 authority 유지).
    expect(PKG_SRC).not.toMatch(/from\('packages'\)\s*\.update\(\s*\{\s*status:\s*'refunded'/);
  });
});
