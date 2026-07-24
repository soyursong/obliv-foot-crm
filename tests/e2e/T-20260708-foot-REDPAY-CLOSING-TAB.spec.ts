/**
 * E2E spec — T-20260708-foot-REDPAY-CLOSING-TAB
 * 일마감(/admin/closing#payments) '레드페이' 하위탭 신설 — 카드단말기 자동수집 대조.
 *
 * AC-1: 신규 저장 테이블/컬럼 0 (read-layer 뷰/RPC only).
 * AC-2: '레드페이' 하위탭 신설 + 기존 'CRM 수납' 레이아웃 무손상.
 * AC-3: 대조 = read-only VIEW v_redpay_reconciliation_daily (FE 조인·매칭 재계산 금지).
 * AC-4: 뷰가 풋 26 TID 화이트리스트 + clinic RLS 필터 (공유 merchant 방어).
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
// T-20260710-foot-REDPAY-URL-CONFIG-HARDEN — URL/엔드포인트 resolve 로직 SSOT (인라인 → _shared 추출).
//   형제 EF(receipt-ocr Step3)와 공유하는 단일 정의처. env 계약 = REDPAY_API_URL (신규 env 금지).
const REDPAY_CONFIG = 'supabase/functions/_shared/redpay-config.ts';

// 풋 26 TID 화이트리스트 (redpay_foot_terminal_registry.md §2 = authoritative SSOT, last_verified 2026-07-20)
//   T-20260720-...-WHITELIST-EXPAND: 13→26 (VAN7+유선6+멀티8+무선5). registry §5 8곳 소비처 동기.
const FOOT_TIDS = [
  '1047479255','1047479254','1047479261','1047479268','1047479262',
  '1047479263','1047479264','1047479469','1047479471','1047479472',
  '1047479473','1047479474','1047479475','1047479483','1047479476',
  '1047479477','1047479478','1047479479','1047479480','1047479481',
  '1047479482','1047479153','1047479148','1047479155','1047479158',
  '1047479157',
];

// ─── AC-2: 레드페이 하위탭 신설 + CRM 수납 무손상 ────────────────────────────
test.describe('T-20260708-REDPAY-CLOSING-TAB AC-2 — 하위탭 신설 소스 검증', () => {
  test('결제 탭 하위에 CRM 수납 / 레드페이 2개 하위탭 존재', () => {
    const src = fs.readFileSync(CLOSING, 'utf-8');
    // 하위탭 상태
    // T-20260710-foot-OCR-RECEIPT-REDPAY-MATCH-BUILD: '영수증 수납'(receipt) 3번째 하위탭 추가로
    //   상태 유니온이 확장됨('crm' | 'redpay' | 'receipt'). redpay 하위탭 자체는 무손상.
    expect(src).toMatch(/useState<'crm' \| 'redpay'(?: \| 'receipt')?>\('crm'\)/);
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

// ─── AC-4: 풋 26 TID 화이트리스트 서버-권위 필터 ──────────────────────────────
test.describe('T-20260708-REDPAY-CLOSING-TAB AC-4 — TID 화이트리스트 멀티테넌트 방어', () => {
  test('뷰가 풋 26 TID 를 서버-권위로 필터', () => {
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
//   RC 재확정(최필경): /api/partner/payments.php → 200, /api/partner/ → 403.
test.describe('T-20260708-REDPAY-CLOSING-TAB 403-FIX — EF URL 조립 방어', () => {
  // (a) 최종 URL 에 payments.php 파일명 포함 (전체경로 단일 SSOT + env override)
  //   T-20260710 HARDEN: 전체경로 기본값·resolve 로직은 _shared/redpay-config.ts SSOT 로 추출.
  //   index.ts 는 import 해 REDPAY_BASE_URL 만 조립 — URL 문자열 리터럴 하드코딩 부활 금지.
  test('URL 은 payments.php 전체 경로가 SSOT — 기본값 + env override + 파일명 가드', () => {
    const cfg = fs.readFileSync(REDPAY_CONFIG, 'utf-8');
    const src = fs.readFileSync(RECON_EF, 'utf-8');
    // 전체경로 기본값(SSOT, _shared). base+file 분해 없음.
    expect(cfg).toContain('DEFAULT_FULL_URL: "https://redpay.kr/api/partner/payments.php"');
    // 조립은 전체경로 상수 + 쿼리스트링만 (urljoin/base-only 금지)
    expect(src).toContain('const requestUrl = `${REDPAY_BASE_URL}?${params}`;');
    // index.ts 에 URL 문자열 리터럴 하드코딩 부활 금지 (SSOT 는 _shared 단일 정의처)
    expect(src).not.toContain('"https://redpay.kr');
    expect(src).not.toContain("'https://redpay.kr");
    // 디렉터리 경로만으로 base 를 정의하는 안티패턴 없음 (payments.php 탈락 원천 차단)
    expect(cfg).not.toContain('= "https://redpay.kr/api/partner/"');
    expect(cfg).not.toContain("= 'https://redpay.kr/api/partner/'");
    // base+endpoint 로 분해(=urljoin 재도입)하지 않았는지: 파일명 없는 디렉터리 독립 리터럴 없음.
    expect(cfg).not.toContain('"/api/partner/"');
  });

  // (c) URL base/endpoint 가 상수·env 단일 소스로 관리 (이은상 — 하드코딩 산재 금지)
  //   T-20260710 HARDEN: 정의는 _shared/redpay-config.ts SSOT, index.ts 는 import + resolve 호출.
  test('URL 은 상수/enum + env(REDPAY_API_URL) 단일 소스로 관리 + payments.php 탈락 가드', () => {
    const cfg = fs.readFileSync(REDPAY_CONFIG, 'utf-8');
    const src = fs.readFileSync(RECON_EF, 'utf-8');
    // 단일 상수/enum 로 엔드포인트 관리 (_shared SSOT)
    expect(cfg).toContain('export const REDPAY_ENDPOINT = {');
    expect(cfg).toContain('REQUIRED_FILENAME: "payments.php"');
    // env override 지점 (한 군데, _shared)
    expect(cfg).toContain('Deno.env.get("REDPAY_API_URL")');
    // payments.php 탈락 시 런타임 throw 가드 (RC 재발 구조적 차단)
    expect(cfg).toContain('export function resolveRedpayEndpoint()');
    expect(cfg).toContain('가드 위반');
    expect(cfg).toMatch(/endsWith\(\s*"\/"\s*\+\s*REDPAY_ENDPOINT\.REQUIRED_FILENAME\s*\)/);
    // index.ts 는 SSOT 를 import 해서 소비 (인라인 재정의 금지)
    expect(src).toContain('import { resolveRedpayEndpoint } from "../_shared/redpay-config.ts";');
    expect(src).not.toContain('function resolveRedpayEndpoint()'); // 인라인 재정의 부활 금지
    // REDPAY_BASE_URL 은 resolve 결과 (하드코딩 리터럴 아님)
    expect(src).toContain('const REDPAY_BASE_URL = resolveRedpayEndpoint();');
  });

  // (d) ★ env 계약 non-regression (WARN 핵심축, T-20260710 Option A) —
  //   override env 는 이미 배포된 REDPAY_API_URL 하나뿐. REDPAY_PAYMENTS_URL 등 신규 env 도입 금지
  //   (env 계약 회귀 = 라이브 정산 폴러 URL 오조립 재발 경로). SSOT·소비처 어디에도 잔존 금지.
  test('env 계약 — REDPAY_API_URL 단일, REDPAY_PAYMENTS_URL 신규 env 도입 금지', () => {
    const cfg = fs.readFileSync(REDPAY_CONFIG, 'utf-8');
    const src = fs.readFileSync(RECON_EF, 'utf-8');
    // SSOT 가 반드시 REDPAY_API_URL 을 읽는다 (배포된 계약 존중)
    expect(cfg).toContain('Deno.env.get("REDPAY_API_URL")');
    // 신규 env 계약 도입 금지 — 폐기된 30fba7e3 의 REDPAY_PAYMENTS_URL 잔존 0
    expect(cfg).not.toContain('REDPAY_PAYMENTS_URL');
    expect(src).not.toContain('REDPAY_PAYMENTS_URL');
    // 다른 URL override env 키로 읽는 우회 없음 (URL 관련 env 는 REDPAY_API_URL 뿐)
    expect(cfg).not.toContain('resolveRedpayPaymentsUrl');
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

  // (b) 마스터 키 멀티테넌트 방어 — business_no 필수 전송 + 풋 26 TID narrowing
  test('business_no 는 항상 요청 파라미터로 전송 (마스터 키 사업자 스코프)', () => {
    const src = fs.readFileSync(RECON_EF, 'utf-8');
    // business_no 를 URLSearchParams 에 필수로 세팅
    expect(src).toContain('business_no: REDPAY_BUSINESS_NO');
    // 빈 business_no 는 폴러 진입 자체를 차단 (G4 blocked)
    expect(src).toContain('!REDPAY_BUSINESS_NO');
  });

  test('풋 TID 화이트리스트를 콤마 다중값 tid 파라미터로 전송 (서버-측 narrowing)', () => {
    const src = fs.readFileSync(RECON_EF, 'utf-8');
    // 단일/13개 무관 콤마 조인 다중값 전송
    expect(src).toContain('params.set("tid", tidList.join(","))');
    // 과거 단일 TID 만 전송하던 코드 제거 확인
    expect(src).not.toContain('params.set("tid", tidList[0])');
  });

  test('클라이언트-측 2차 방어 — 화이트리스트 외 TID 는 upsert 전 제외', () => {
    const src = fs.readFileSync(RECON_EF, 'utf-8');
    expect(src).toContain('function filterToFootScope(');
    expect(src).toContain('TENANT-GUARD');
    // 화이트리스트 통과분(kept)만 upsert
    expect(src).toContain('upsertRawTransactions(clinicId, kept)');
  });

  // (데이터 파싱) data.items 중첩 + trxid dedup + 취소금액 음수 보존
  test('데이터 파싱 — data.items 중첩 + trxid dedup + 취소금액 음수 부호 보존', () => {
    const src = fs.readFileSync(RECON_EF, 'utf-8');
    // data.items[] 중첩 파싱
    expect(src).toContain('envelope.data?.items');
    // trxid dedup (페이지 내 (trxid,status,amount) 중복 제거 → ON CONFLICT 이중행 차단)
    expect(src).toContain('trxid dedup');
    expect(src).toContain('`${r.external_trxid}|${r.external_status}|${r.amount}`');
    // 취소금액 음수 부호 보존 (net 계산 그대로 합산)
    expect(src).toContain('amount:          t.amount');
    expect(src).toContain('음수');
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

// ─── T-20260724-foot-REDPAY-WHITELIST-EXPAND-0723GAP · Opt-B′ (ADDITIVE) 불변식 ───
//   registry-derived 소비뷰(20260711140000~) + 0723GAP 재프로비저닝 대응. 위 AC-4 블록은
//   frozen 20260708230000 아티팩트(하드코딩) 대상 — 라이브 소비뷰는 registry SSOT 파생(불변식 아래).
test.describe('T-20260724-0723GAP · Opt-B′ 마이그 불변식(ADDITIVE-only)', () => {
  const MIG_0723 = 'supabase/migrations/20260724170000_redpay_foot_registry_0723gap_optbprime.sql';
  const RB_0723 = 'supabase/migrations/20260724170000_redpay_foot_registry_0723gap_optbprime.rollback.sql';

  test('허용 DDL = ADD COLUMN superseded_tids + CREATE OR REPLACE (DROP UNIQUE/widening 금지)', () => {
    const sql = fs.readFileSync(MIG_0723, 'utf-8');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS superseded_tids text\[\]/);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.v_redpay_reconciliation_daily/);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.v_receipt_settlement_daily/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_redpay_feed_freshness/);
    // ⛔ 파괴적 변경 부재 — 대표 게이트 면제 스코프(planner verdict 2026-07-24).
    //   주석(설명용 "원 Opt-B(DROP UNIQUE...)")은 제거 후 실행 SQL 만 검사.
    const code = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    expect(code).not.toMatch(/DROP\s+CONSTRAINT/i);
    expect(code).not.toMatch(/DROP\s+.*UNIQUE/i);
    expect(code).not.toMatch(/ALTER\s+COLUMN.*TYPE/i);
    expect(code).not.toMatch(/DROP\s+.*(PRIMARY KEY|_pkey)/i);
    // ON CONFLICT(merchant_id) 유지(UNIQUE 완화 아님)
    expect(sql).toContain('ON CONFLICT (merchant_id) DO NOTHING');
  });

  test('tid-membership UNION 확장 — 구·신 TID 모두 가시(historical 무탈락)', () => {
    const sql = fs.readFileSync(MIG_0723, 'utf-8');
    expect(sql).toMatch(/UNION\s+SELECT unnest\(redpay_terminal_registry\.superseded_tids\)/);
    // 6 신 live TID(1047535xxx) + 285002 seed
    for (const t of ['1047535845', '1047535843', '1047535842', '1047535837', '1047535835', '1047535797']) {
      expect(sql).toContain(`'${t}'`);
    }
    expect(sql).toContain("'1777285002'");
  });

  test('롤백 = 데이터손실0 (뷰 UNION-이전 복원 + remap 역전 + 285002 DELETE + DROP COLUMN)', () => {
    const rb = fs.readFileSync(RB_0723, 'utf-8');
    expect(rb).toMatch(/CREATE OR REPLACE VIEW public\.v_redpay_reconciliation_daily/);
    expect(rb).toMatch(/DROP COLUMN IF EXISTS superseded_tids/);
    expect(rb).toMatch(/DELETE FROM public\.redpay_terminal_registry[\s\S]*1777285002/);
    expect(rb).not.toMatch(/unnest\(redpay_terminal_registry\.superseded_tids\)/); // UNION 제거 확인
  });
});
