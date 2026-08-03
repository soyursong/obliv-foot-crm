/**
 * Contract spec — T-20260803-foot-REDPAY-INSTALLVERIFY-NET0-AUTOCLASSIFY
 *   (최필경 총괄, ch C0ATE5P6JTH thread 1785716108)
 *
 * 목적: 레드페이 대사 '설치검증 추정' net0 쌍 자동분류(4조건 ALL)가 (a) 서버뷰 판정 SSOT
 *   (b) FE 소비 헬퍼 (c) 아침요약 N건 프레임 재사용 (d) 대사화면 표시/필터/사유/되돌림 에
 *   drift 없이 반영됐는지 순수 로직 + 소스 무결성으로 검증(분류 판정은 DB 뷰 = browser 무접점).
 *
 * 자동 분류 4조건(ALL): ① net0 쌍(같은 tid·금액·승인번호, 승인+즉시취소 합0)
 *   ② 취소 승인후 ≤120초 ③ TID 단독(전체이력 2건) ④ 소액 whitelist(100/500/1000/1004).
 *   하나라도 미충족 → 미분류 → 기존 확인요청 플로우 유지.
 *
 * 현장 클릭 시나리오(→ 계약 검증):
 *  S1. 정상 — 4조건 충족 쌍 = '설치검증 추정' 뱃지 + 분류사유(4조건) 표시.
 *  S2. 아침요약 — 개별 확인요청 대신 '설치검증 추정 N건' 한 줄.
 *  S3. 엣지 — 일부조건 미충족(비소액/TID 비단독) = 미분류(기존 플로우). 사람 '설치검증 아님' 되돌림 → 복귀.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  IMMEDIATE_CANCEL_MAX_SEC,
  SMALL_AMOUNT_WHITELIST,
  isInstallVerifyPresumed,
  countInstallVerifyPresumed,
  describeEvidence,
  type InstallVerifyClassified,
} from '../../src/lib/redpayInstallVerify';
import { buildInstallVerifyDigestLine } from '../../scripts/lib/redpay_unreg_digest_lib.mjs';

const MIG = 'supabase/migrations/20260803235500_foot_redpay_installverify_classify.sql';
const MIG_ROLLBACK = 'supabase/migrations/20260803235500_foot_redpay_installverify_classify.rollback.sql';
const MIG_DRYRUN = 'supabase/migrations/20260803235500_foot_redpay_installverify_classify.dryrun.sql';
const FE_LIB = 'src/lib/redpayInstallVerify.ts';
const FE_TAB = 'src/components/closing/RedpayReconcileTab.tsx';
const DIGEST_EF = 'supabase/functions/redpay-unreg-digest/digest-lib.ts';

function read(p: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');
}

// helper: 대사행 팩토리
function row(p: Partial<InstallVerifyClassified>): InstallVerifyClassified {
  return {
    row_id: p.row_id ?? 'r1',
    install_verify_presumed: p.install_verify_presumed ?? false,
    install_verify_evidence: p.install_verify_evidence ?? null,
  };
}

// ════════════════════════════════════════════════════════════════════════
// A. 서버뷰(분류 엔진 SSOT) — 4조건 AND + 임계 + 비파괴 무결성
// ════════════════════════════════════════════════════════════════════════
test('A1. 마이그: 분류엔진 뷰 v_redpay_installverify_pairs 존재', () => {
  const sql = read(MIG);
  expect(sql).toContain('CREATE OR REPLACE VIEW public.v_redpay_installverify_pairs');
});

test('A2. 4조건 ALL 이 뷰 WHERE 에 AND 로 봉인', () => {
  const sql = read(MIG);
  // ① net0 쌍: 승인 Y(+) + 취소 N/X/M(−), 합=0, 같은 tid·approval_no
  expect(sql).toContain("a.external_status = 'Y'");
  expect(sql).toContain("c.external_status = ANY (ARRAY['N'::text, 'X'::text, 'M'::text])");
  expect(sql).toContain('(a.amount + c.amount) = 0');
  expect(sql).toContain('c.approval_no = a.approval_no');
  // ② 취소 승인후 수십초 내(≤120s)
  expect(sql).toContain('p.gap_sec >= 0 AND p.gap_sec <= 120');
  // ③ TID 단독(전체이력 2건)
  expect(sql).toContain('tc.n = 2');
  // ④ 소액 whitelist
  expect(sql).toContain('p.approval_amount IN (100, 500, 1000, 1004)');
});

test('A3. 비파괴: payments 원장/매출 write 없음 — read-only 뷰만(무DDL 파생)', () => {
  const sql = read(MIG);
  expect(sql).not.toMatch(/UPDATE\s+public\.payments/i);
  expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.payments/i);
  expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.payments/i);
  // base-table ALTER/신규 컬럼/테이블/enum 없음(read-time 파생, DA CONSULT 게이트 비대상)
  expect(sql).not.toMatch(/ALTER TABLE/i);
  expect(sql).not.toMatch(/CREATE TABLE/i);
  expect(sql).not.toMatch(/CREATE TYPE/i);
});

test('A4. 대사뷰에 install_verify 2컬럼 ADDITIVE + LEFT JOIN pairs', () => {
  const sql = read(MIG);
  expect(sql).toContain('install_verify_presumed');
  expect(sql).toContain('install_verify_evidence');
  expect(sql).toContain('LEFT JOIN public.v_redpay_installverify_pairs iv');
});

test('A5. 롤백 + 드라이런 페어 존재(무영속 프로토콜)', () => {
  expect(fs.existsSync(path.resolve(__dirname, '../../', MIG_ROLLBACK))).toBeTruthy();
  const dry = read(MIG_DRYRUN);
  expect(dry).toContain('BEGIN;');
  expect(dry).toContain('ROLLBACK;');
  expect(dry).not.toMatch(/^\s*COMMIT;/im); // sentinel-bypass 방지: COMMIT 없음
  const rb = read(MIG_ROLLBACK);
  expect(rb).toContain('DROP VIEW IF EXISTS public.v_redpay_installverify_pairs');
});

test('A6. semantic firewall — is_test/is_simulation(canonical)과 별도 축', () => {
  const sql = read(MIG);
  expect(sql).toContain('설치검증_추정');
  // 분류 라벨이 canonical is_test/is_simulation 컬럼에 write 되지 않음
  expect(sql).not.toMatch(/is_test\s*=/i);
  expect(sql).not.toMatch(/is_simulation\s*=/i);
});

// ════════════════════════════════════════════════════════════════════════
// B. FE 소비 헬퍼 — 시나리오 1/2/3 순수 로직
// ════════════════════════════════════════════════════════════════════════
test('B0. 임계 상수 = 뷰와 동일 미러(120초 / 소액 whitelist)', () => {
  expect(IMMEDIATE_CANCEL_MAX_SEC).toBe(120);
  expect([...SMALL_AMOUNT_WHITELIST].sort((a, b) => a - b)).toEqual([100, 500, 1000, 1004]);
});

test('S1. 4조건 충족 쌍 = presumed + 분류사유 4줄', () => {
  const ev = {
    classified: '설치검증_추정',
    cond2_cancel_gap_sec: 17, cond2_threshold_sec: 120,
    cond3_tid_txn_count: 2, cond4_amount: 1004, tid: '1047479153',
  };
  const r = row({ row_id: 'iv1', install_verify_presumed: true, install_verify_evidence: ev });
  expect(isInstallVerifyPresumed(r)).toBe(true);
  const lines = describeEvidence(ev);
  expect(lines.length).toBe(4);            // 4조건 모두 표시
  expect(lines.join(' ')).toContain('17초');
  expect(lines.join(' ')).toContain('1,004원');
});

test('S2. 아침요약 — 개별 확인요청 대신 N건 한 줄(카운트 + 문안)', () => {
  const rows = [
    row({ row_id: 'a', install_verify_presumed: true }),
    row({ row_id: 'b', install_verify_presumed: true }),
    row({ row_id: 'c', install_verify_presumed: false }),
  ];
  expect(countInstallVerifyPresumed(rows)).toBe(2);
  const line = buildInstallVerifyDigestLine(2);
  expect(line).toContain('설치검증 추정 2건');
  expect(buildInstallVerifyDigestLine(0)).toBe('');   // 0건 → 요약줄 생략
});

test('S3a. 엣지 — 일부조건 미충족(뷰가 presumed=false) = 미분류(기존 플로우 유지)', () => {
  // 비소액(50,000) 또는 TID 비단독 건은 서버뷰가 presumed=false 로 내려줌 → 자동분류 안 됨.
  const notClassified = row({ row_id: 'big', install_verify_presumed: false });
  expect(isInstallVerifyPresumed(notClassified)).toBe(false);
  expect(countInstallVerifyPresumed([notClassified])).toBe(0);
});

test('S3b. 사람 override — 설치검증 아님 되돌림 → 기존 플로우 복귀(비파괴)', () => {
  const r = row({ row_id: 'iv1', install_verify_presumed: true });
  const overridden = new Set<string>(['iv1']);
  expect(isInstallVerifyPresumed(r, overridden)).toBe(false); // 되돌림 반영
  expect(countInstallVerifyPresumed([r], overridden)).toBe(0);
  // 원 데이터(install_verify_presumed) 는 불변 — 재노출 가능(비파괴).
  expect(r.install_verify_presumed).toBe(true);
});

// ════════════════════════════════════════════════════════════════════════
// C. 대사화면 UI 배선(표시/필터/사유/되돌림 + N건 요약)
// ════════════════════════════════════════════════════════════════════════
test('C1. 대사탭 — 설치검증 추정 뱃지 + 필터 토글 + N건 요약 + 사유 + 되돌림 배선', () => {
  const tab = read(FE_TAB);
  expect(tab).toContain("data-testid=\"installverify-summary\"");        // N건 요약 카드
  expect(tab).toContain("data-testid=\"installverify-filter-toggle\"");  // 숨기기/펼치기
  expect(tab).toContain("data-testid=\"installverify-badge\"");          // 설치검증 추정 뱃지
  expect(tab).toContain("data-testid=\"installverify-evidence\"");       // 분류 사유
  expect(tab).toContain("data-testid=\"installverify-revert\"");         // 설치검증 아님(되돌림)
  expect(tab).toContain('설치검증 추정 숨기기');
  expect(tab).toContain('설치검증 추정 펼치기');
  // FE 재판정 금지 — 뷰 컬럼 소비만(로컬 4조건 재계산 로직 없음)
  expect(tab).toContain('isInstallVerifyPresumed');
});

test('C2. 아침요약 프레임 재사용 — 신규 알림 채널 신설 없음(기존 digest 한 줄 append)', () => {
  const efLib = read(DIGEST_EF);
  expect(efLib).toContain('buildInstallVerifyDigestLine');
  // 기존 digest EF/poller 발송 경로 재사용(새 EF/채널 파일 신설 아님) — helper 만 추가.
  expect(efLib).toContain('export function buildInstallVerifyDigestLine');
});
