/**
 * E2E spec — T-20260708-foot-REDPAY-CLOSING-TAB
 * 일마감(/admin/closing#payments) '레드페이' 하위탭 신설 — 카드단말기 자동수집 대조.
 *
 * AC-1: 신규 저장 테이블/컬럼 0 (read-layer 뷰/RPC only).
 * AC-2: '레드페이' 하위탭 신설 + 기존 'CRM 수납' 레이아웃 무손상.
 * AC-3: 대조 = read-only VIEW v_redpay_reconciliation_daily (FE 조인·매칭 재계산 금지).
 * AC-4: 뷰가 풋 13 TID 화이트리스트 + clinic RLS 필터 (공유 merchant 방어).
 * AC-5: Phase3(합침/자동반영) 미구현 — read-only.
 * AC-6: 활성화 전에도 UI/뷰 렌더 (빈 목록/기수집분).
 * AC-7: 적재 freshness 노출 — 거래없음 vs 적재死 구분.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const CLOSING = 'src/pages/Closing.tsx';
const REDPAY_TAB = 'src/components/closing/RedpayReconcileTab.tsx';
const MIG = 'supabase/migrations/20260708230000_redpay_recon_daily_view.sql';
const MIG_ROLLBACK = 'supabase/migrations/20260708230000_redpay_recon_daily_view.rollback.sql';
const RECON_EF = 'supabase/functions/redpay-reconcile/index.ts';

// 풋 13 TID 화이트리스트 (obliv_origin_env.md)
const FOOT_TIDS = [
  '1047479483','1047479476','1047479477','1047479478','1047479479',
  '1047479480','1047479481','1047479482','1047479153','1047479148',
  '1047479155','1047479158','1047479157',
];

// ─── AC-2: 레드페이 하위탭 신설 + CRM 수납 무손상 ────────────────────────────
test.describe('T-20260708-REDPAY-CLOSING-TAB AC-2 — 하위탭 신설 소스 검증', () => {
  test('결제 탭 하위에 CRM 수납 / 레드페이 2개 하위탭 존재', () => {
    const src = fs.readFileSync(CLOSING, 'utf-8');
    // 하위탭 상태
    expect(src).toContain("useState<'crm' | 'redpay'>('crm')");
    // 하위탭 트리거 2종
    expect(src).toContain('<TabsTrigger value="crm"');
    expect(src).toContain('<TabsTrigger value="redpay"');
    expect(src).toContain('CRM 수납');
    expect(src).toContain('레드페이');
    // 레드페이 하위탭에 컴포넌트 마운트
    expect(src).toContain('<RedpayReconcileTab date={date} clinicId={clinic.id} />');
  });

  test('기존 CRM 수납 레이아웃 무손상 — 담당자 필터/수기추가/담당자별 매출 유지', () => {
    const src = fs.readFileSync(CLOSING, 'utf-8');
    // 기존 CRM 수납 탭의 핵심 요소가 그대로 존재
    expect(src).toContain('수기 추가');
    expect(src).toContain('담당자별 매출');
    expect(src).toContain('filteredEnrichedRows');
    // 하위탭 CRM 콘텐츠 래퍼 존재
    expect(src).toContain('<TabsContent value="crm"');
    expect(src).toContain('<TabsContent value="redpay"');
  });
});

// ─── AC-3: read-only VIEW 소비 — FE 조인/매칭 재계산 금지 ─────────────────────
test.describe('T-20260708-REDPAY-CLOSING-TAB AC-3 — read-only 뷰 소비 검증', () => {
  test('FE는 v_redpay_reconciliation_daily 뷰만 소비', () => {
    const src = fs.readFileSync(REDPAY_TAB, 'utf-8');
    expect(src).toContain("from('v_redpay_reconciliation_daily')");
    // recon_status 파생은 뷰(서버)에서 — FE는 라벨 매핑만
    expect(src).toContain('recon_status');
    // FE에서 payments 원본 조인 재계산 금지: payments 직접 쿼리 없음
    expect(src).not.toContain("from('payments')");
    expect(src).not.toContain("from('redpay_raw_transactions').select('*')");
  });

  test('마이그: 뷰가 recon_status 5종 파생 + security_invoker', () => {
    const sql = fs.readFileSync(MIG, 'utf-8');
    expect(sql).toContain('CREATE OR REPLACE VIEW public.v_redpay_reconciliation_daily');
    expect(sql).toContain('security_invoker = true');
    for (const s of ['matched', 'missing_in_crm', 'missing_at_van', 'amount_mismatch', 'refund_not_in_crm']) {
      expect(sql).toContain(s);
    }
    // FULL/LEFT JOIN payments
    expect(sql).toContain('LEFT JOIN public.payments p ON p.id = r.matched_payment_id');
  });
});

// ─── AC-4: 풋 13 TID 화이트리스트 서버-권위 필터 ──────────────────────────────
test.describe('T-20260708-REDPAY-CLOSING-TAB AC-4 — TID 화이트리스트 멀티테넌트 방어', () => {
  test('뷰가 풋 13 TID 를 서버-권위로 필터', () => {
    const sql = fs.readFileSync(MIG, 'utf-8');
    for (const tid of FOOT_TIDS) {
      expect(sql).toContain(`'${tid}'`);
    }
    // clinic RLS + TID 이중 방어
    expect(sql).toContain('r.tid IN (');
  });

  test('freshness RPC도 풋 TID + clinic 스코프', () => {
    const sql = fs.readFileSync(MIG, 'utf-8');
    expect(sql).toContain('get_redpay_feed_freshness');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('user_profiles WHERE id = auth.uid()');
  });
});

// ─── AC-1/AC-5: 신규 저장 DDL 0 + Phase3 방어 ─────────────────────────────────
test.describe('T-20260708-REDPAY-CLOSING-TAB AC-1/AC-5 — additive-only + Phase3 미구현', () => {
  test('마이그: 신규 저장 테이블/컬럼 0 — CREATE VIEW/FUNCTION only', () => {
    const sql = fs.readFileSync(MIG, 'utf-8');
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/ALTER TABLE .* ADD COLUMN/i);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION/i);
  });

  test('롤백: DROP VIEW/FUNCTION only', () => {
    const rb = fs.readFileSync(MIG_ROLLBACK, 'utf-8');
    expect(rb).toContain('DROP VIEW IF EXISTS public.v_redpay_reconciliation_daily');
    expect(rb).toContain('DROP FUNCTION IF EXISTS public.get_redpay_feed_freshness');
  });

  test('AC-5: Phase3(합침/자동반영) 미구현 — 자동 합침 버튼/RPC 없음', () => {
    const src = fs.readFileSync(REDPAY_TAB, 'utf-8');
    expect(src).not.toContain('합침');
    expect(src).not.toMatch(/자동\s*반영/);
    // read-only: 결제 INSERT/UPDATE/RPC mutation 없음
    expect(src).not.toContain('.insert(');
    expect(src).not.toContain('.update(');
  });
});

// ─── AC-6/AC-7: 활성화 전 렌더 + freshness ────────────────────────────────────
test.describe('T-20260708-REDPAY-CLOSING-TAB AC-6/AC-7 — 활성화 전 렌더 + freshness', () => {
  test('AC-7: freshness 판정 3상태 (활성화전/정상/적재死)', () => {
    const src = fs.readFileSync(REDPAY_TAB, 'utf-8');
    expect(src).toContain('get_redpay_feed_freshness');
    expect(src).toContain('last_incremental_to');
    // 3상태 판정
    expect(src).toContain("'idle'");
    expect(src).toContain("'ok'");
    expect(src).toContain("'stale'");
    // 거래없음 vs 적재死 문구
    expect(src).toContain('활성화');
    expect(src).toContain('지연');
  });

  test('AC-6: 빈 목록에서도 깨지지 않는 empty state', () => {
    const src = fs.readFileSync(REDPAY_TAB, 'utf-8');
    expect(src).toContain('레드페이 자동수집 결제가 없습니다');
  });
});

// ─── 403 근본원인(URL 오조립) 방어 — redpay-reconcile EF ─────────────────────
//   ref: redpay-403-incident F0BGDKNATK7 (2026-07-10 이은상 팀장 forensic).
//   403 = nginx HTML 디렉터리 거부(payments.php 파일명 탈락) — API 키 문제 아님.
test.describe('T-20260708-REDPAY-CLOSING-TAB 403-FIX — EF URL 조립 방어', () => {
  test('URL 은 payments.php 전체 경로를 상수에 하드코딩 (urljoin/base-only 금지)', () => {
    const src = fs.readFileSync(RECON_EF, 'utf-8');
    // 파일명 포함 전체 경로 상수
    expect(src).toContain('const REDPAY_BASE_URL           = "https://redpay.kr/api/partner/payments.php";');
    // 조립은 상수 + 쿼리스트링만
    expect(src).toContain('const requestUrl = `${REDPAY_BASE_URL}?${params}`;');
    // base 를 파일명 없는 디렉터리 문자열로 정의하는 안티패턴 없음 (payments.php 탈락 원천 차단)
    expect(src).not.toContain('= "https://redpay.kr/api/partner/"');
    expect(src).not.toContain("= 'https://redpay.kr/api/partner/'");
  });

  test('조치#3 — 실제 발사 URL 로깅 (payments.php 탈락 즉시 지목)', () => {
    const src = fs.readFileSync(RECON_EF, 'utf-8');
    expect(src).toContain('redpay request url=${requestUrl}');
    // fetch 는 로깅한 requestUrl 을 그대로 사용
    expect(src).toContain('await fetchWithRetry(requestUrl,');
  });

  test('조치#2 — Content-Type 가드: 비-JSON 이면 오류표 조회 없이 원문 노출', () => {
    const src = fs.readFileSync(RECON_EF, 'utf-8');
    // Content-Type 헤더 검사
    expect(src).toContain('res.headers.get("Content-Type")');
    expect(src).toContain('application/json');
    // 비-JSON 시 status/content_type/url/body 원문을 담아 throw
    expect(src).toContain('URL 오조립/미도달 의심');
    expect(src).toMatch(/status=\$\{res\.status\}/);
    expect(src).toContain('url=${requestUrl}');
    // Content-Type 가드가 !res.ok 분기보다 먼저 배치 (HTML 403 을 JSON 오류로 오분류 방지)
    const ctypeIdx = src.indexOf('res.headers.get("Content-Type")');
    const okIdx = src.indexOf('if (!res.ok) {');
    expect(ctypeIdx).toBeGreaterThan(0);
    expect(okIdx).toBeGreaterThan(ctypeIdx);
  });

  test('안전 — 읽기전용 GET(payments.php)만, cancel.php 실거래 취소 절대 미호출', () => {
    const src = fs.readFileSync(RECON_EF, 'utf-8');
    expect(src).not.toContain('cancel.php');
  });
});

// ─── 브라우저 기능 검증 (skip-safe) ──────────────────────────────────────────
test.describe('T-20260708-REDPAY-CLOSING-TAB — 브라우저 렌더', () => {
  test('결제 탭에서 레드페이 하위탭 표시 + 클릭 시 대조 뷰 렌더', async ({ page }) => {
    await page.goto('/admin/closing#payments');
    await page.waitForLoadState('networkidle');

    const redpayTab = page.getByRole('tab', { name: /레드페이/ });
    const count = await redpayTab.count();
    if (count === 0) {
      test.skip(true, '인증 미설정 환경 — storageState 필요');
      return;
    }
    await redpayTab.click();
    await page.waitForTimeout(400);
    // 대조 카드 타이틀 또는 empty state 노출 (에러 없이 렌더)
    const hasTitle = await page.getByText(/레드페이 · CRM 수납 대조|레드페이 자동수집 결제가 없습니다/).count();
    expect(hasTitle).toBeGreaterThan(0);
  });
});
