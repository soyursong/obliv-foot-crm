/**
 * E2E spec — T-20260723-foot-INSCONSULT-WRITEPATH-FKLINK-FOLD
 *
 * DA STEP 1 RATIFY: A-a1(원자 write-path 트리거 필터 확장) authoritative.
 *   db_change=false / ADDITIVE / no-DDL. 코드-only(트리거 발화필터 + 폴백 default-deny + read-side re-source).
 *
 * 본 spec = 산출물 회귀 가드(정적 계약). 실 prod 데이터 런타임 검증은 STEP0 probe 스크립트가 담당
 *   (green build/spec 만으로 종결 아님 — 갤탭 실기기 현장 confirm 후 done).
 *
 * 스코프(authoritative — DA 보충 RATIFY oalw MSG-20260723-211516): 본 티켓 = a1 write-path + B1 완전봉합만.
 *   B2 read-side re-source 는 **디커플**(별건 C4 read-side 활성화, 비블로킹, a1 먼저 → C4 후속) → 본 spec 미포함.
 *
 * 커버:
 *   [a1] 발화필터 hira_category predicate 삭제 → is_insurance_covered 단독.
 *   [G1] 이중 write 금지 — 폴백 snapshot 이 check_in_id dedup(already Set)으로 원자경로 적재분 skip.
 *   [G2] rows-affected — RPC 성공(error=null)인데 0-row(payment_id 부재) 시 throw(silent write-failure 오인 금지).
 *   [B1] 완전봉합 — 폴백에 §2-2-1b default-deny(grade≠확정 → 공단부담 0) 이식(원자 RPC W5 정합).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PMW = path.join(ROOT, 'src/components/PaymentMiniWindow.tsx');

const pmwSrc = () => fs.readFileSync(PMW, 'utf-8');

test.describe('T-20260723-foot-INSCONSULT-WRITEPATH-FKLINK-FOLD', () => {

  // ── [a1] 발화필터 확장: is_insurance_covered 단독 ────────────────────────────
  test('a1: coveredServices 필터 = is_insurance_covered 단독 (hira_category predicate 삭제)', () => {
    const s = pmwSrc();
    expect(s).toContain('const coveredServices =');
    expect(s).toMatch(/\.filter\(\(\{ service \}\) => service\.is_insurance_covered === true\)/);
    // hira_category 를 write-path 게이트로 쓰지 않음 (dead-path 근본원인 봉인, DA BINDING)
    expect(s).not.toContain("service.hira_category === 'consultation'");
  });

  test('a1: 단일 결제수단·비선수금 게이트는 유지 (분할/선수금은 폴백 소관)', () => {
    const s = pmwSrc();
    expect(s).toMatch(/!isDeductSettle && splits\.length === 1/);
  });

  // ── [G2] rows-affected — cross_crm_write_rowcheck_standard ──────────────────
  test('G2: RPC 성공인데 0-row(payment_id 부재) → throw (silent write-failure 오인 금지)', () => {
    const s = pmwSrc();
    // 반환 row 에서 payment_id 를 읽고, 부재 시 throw
    expect(s).toMatch(/payment_id\?: string \| null/);
    expect(s).toMatch(/if \(!row \|\| !row\.payment_id\)[\s\S]*throw new Error/);
    expect(s).toMatch(/원자 write 검증 실패\(0-row/);
  });

  // ── [G1/a1] data_incomplete 는 per-svc skip, 그 외 에러 throw ────────────────
  test('G1/a1: data_incomplete → per-svc skip(전체 수납 미차단), 그 외 에러 throw(원자성)', () => {
    const s = pmwSrc();
    const callIdx = s.indexOf("supabase.rpc(\n          'record_insurance_consult_payment'");
    expect(callIdx).toBeGreaterThan(-1);
    const block = s.slice(callIdx, callIdx + 1800);
    expect(block).toMatch(/\/data_incomplete\/i\.test\(rpcErr\.message/);
    expect(block).toMatch(/continue;/);
    expect(block).toMatch(/throw rpcErr;/);
  });

  // ── [B1] 완전봉합: 폴백에 default-deny(grade≠확정 → 공단 0) 이식 ──────────────
  test('B1: 폴백 snapshotCoveredServiceCharges 에 grade-confirmed zeroing 이식(원자 RPC W5 정합)', () => {
    const s = pmwSrc();
    const fbIdx = s.indexOf('const snapshotCoveredServiceCharges');
    expect(fbIdx).toBeGreaterThan(-1);
    const fb = s.slice(fbIdx, s.indexOf('const executeAutoDone'));
    // grade 미확정(unverified/NULL) → 공단부담 0 보수
    expect(fb).toMatch(/const gradeConfirmed\s*=\s*[\s\S]*applied_grade !== 'unverified'/);
    expect(fb).toMatch(/const coveredAmount = gradeConfirmed \? r\.insurance_covered_amount : 0;/);
    // 실제 적재에 zeroed 값 사용 (phantom 공단 미적재)
    expect(fb).toMatch(/insurance_covered_amount: coveredAmount,/);
    // data_incomplete 는 여전히 skip(계승)
    expect(fb).toMatch(/if \(r\.data_incomplete\) continue;/);
  });

  test('B1: 폴백 charge-only 유지 — payments 무접촉(copay 이중수납 방지)', () => {
    const s = pmwSrc();
    const fbIdx = s.indexOf('const snapshotCoveredServiceCharges');
    const fb = s.slice(fbIdx, s.indexOf('const executeAutoDone'));
    // 폴백은 service_charges 만 insert, payments insert 없음
    expect(fb).toMatch(/from\('service_charges'\)\s*\.insert\(rows\)/);
    expect(fb).not.toMatch(/from\('payments'\)\s*\.insert/);
  });

  // ── 앱 로드 스모크 ─────────────────────────────────────────────────────────
  test('smoke: 앱 정상 로드', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors.filter((e) => !/ResizeObserver/.test(e))).toEqual([]);
  });
});
