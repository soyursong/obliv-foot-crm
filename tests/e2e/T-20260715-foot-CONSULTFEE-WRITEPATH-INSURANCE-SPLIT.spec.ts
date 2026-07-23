/**
 * E2E spec — T-20260715-foot-CONSULTFEE-WRITEPATH-INSURANCE-SPLIT
 *
 * 급여 진찰료(건강보험) 수납 write-path 보강 — service_charges 명세 행 생성 + 본인부담 payment + FK 링크.
 * DA Binding W1~W9 (DA-REPLY-T-20260715-foot-CONSULTFEE-WRITEPATH-INSURANCE-SPLIT.md, GO ADDITIVE going-forward).
 *
 * 런타임 검증(무영속, 실 prod 데이터)은 아래 스크립트가 담당(green build/spec 만으로 종결 아님):
 *   - node scripts/T-...CONSULTFEE...WRITEPATH..._dryrun_mgmtapi.mjs        (마이그 형상+무영속)
 *   - node scripts/T-...CONSULTFEE...WRITEPATH..._funcrehearsal_mgmtapi.mjs (RPC 기능 W1~W6 실데이터 PASS)
 *
 * 본 spec = 산출물 회귀 가드(정적 계약): 마이그 형상·RPC 규약·PMW 클라 라우팅·롤백.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const MIG = path.join(ROOT, 'supabase/migrations/20260715160000_foot_consultfee_writepath_insurance.sql');
const RBK = path.join(ROOT, 'supabase/migrations/20260715160000_foot_consultfee_writepath_insurance.rollback.sql');
const PMW = path.join(ROOT, 'src/components/PaymentMiniWindow.tsx');

const migSql = () => fs.readFileSync(MIG, 'utf-8');
const rbkSql = () => fs.readFileSync(RBK, 'utf-8');
const pmwSrc = () => fs.readFileSync(PMW, 'utf-8');

test.describe('T-20260715-foot-CONSULTFEE-WRITEPATH-INSURANCE-SPLIT', () => {

  // ── 마이그레이션 존재 ──────────────────────────────────────────────────────
  test('files: 마이그레이션 + 롤백 존재', () => {
    expect(fs.existsSync(MIG)).toBe(true);
    expect(fs.existsSync(RBK)).toBe(true);
  });

  // ── W4: parent C4 canonical nullable FK 재사용 (ADDITIVE) ───────────────────
  test('W4: payments.service_charge_id nullable FK ADDITIVE (IF NOT EXISTS, no-default, REFERENCES service_charges)', () => {
    const s = migSql();
    expect(s).toMatch(/ALTER TABLE payments\s+ADD COLUMN IF NOT EXISTS service_charge_id UUID REFERENCES service_charges\(id\)/);
    // no-default: ADD COLUMN 라인에 DEFAULT 미포함
    expect(s).not.toMatch(/service_charge_id UUID[^;]*DEFAULT/i);
  });

  // ── W1: service_charges.hira_unit_value_year ADDITIVE ───────────────────────
  test('W1: service_charges.hira_unit_value_year 컬럼 추가 (ADDITIVE)', () => {
    expect(migSql()).toMatch(/ALTER TABLE service_charges\s+ADD COLUMN IF NOT EXISTS hira_unit_value_year INT/);
  });

  // ── W1: calc_copayment 단일권위 (산식 재구현 금지) ──────────────────────────
  test('W1: RPC 가 calc_copayment 를 호출(산식 재구현 없음)', () => {
    const s = migSql();
    expect(s).toMatch(/FROM calc_copayment\(p_service_id, p_customer_id, p_clinic_id, p_visit_date\)/);
    // 산식 재구현 금지 — RPC 본문에 CEIL(...*rate) 같은 copay 산식 재구현 부재
    expect(s).not.toMatch(/CEIL\s*\(\s*v_base/i);
  });

  // ── W1: service_charge 필수 필드 적재 ──────────────────────────────────────
  test('W1: service_charges INSERT — is_insurance_covered TRUE + calc 반환 3값 + grade + hira_unit_value_year + check_in', () => {
    const s = migSql();
    const insBlock = s.slice(s.indexOf('INSERT INTO service_charges'));
    expect(insBlock).toContain('is_insurance_covered');
    expect(insBlock).toContain('v_calc.base_amount');
    expect(insBlock).toContain('v_calc.copayment_amount');
    expect(insBlock).toContain('customer_grade_at_charge');
    expect(insBlock).toContain('hira_unit_value_year');
    expect(insBlock).toContain('check_in_id');
  });

  // ── W2: tax_type NULL(=면세), '급여' 신설·기록 금지 ─────────────────────────
  test("W2: payment tax_type NULL(=면세/VAT-exempt), tax_type='급여' 미기록", () => {
    const s = migSql();
    const payIns = s.slice(s.indexOf('INSERT INTO payments'));
    // VALUES 절에 tax_type 자리 = NULL (급여 문자열 아님)
    expect(payIns).toMatch(/'payment',\s*NULL,\s*v_sc_id/);
    // payment INSERT 블록에서 tax_type 에 '급여' 리터럴을 넣지 않음 (헤더 주석 제외 — 실행 블록만)
    expect(payIns).not.toMatch(/'급여'/);
  });

  // ── W3: 원자 RPC + 멱등(advisory lock + check_in+service 가드) ──────────────
  test('W3: 단일 서버 트랜잭션 RPC + 멱등 (advisory lock + idempotent_hit)', () => {
    const s = migSql();
    expect(s).toMatch(/CREATE FUNCTION record_insurance_consult_payment/);
    expect(s).toContain('pg_advisory_xact_lock');
    expect(s).toContain('idempotent_hit');
    // 멱등: 기존 명세+링크 payment 존재 시 no-op 반환
    expect(s).toMatch(/RETURN QUERY SELECT[\s\S]*true;/);
  });

  // ── W4: FK set — payment.service_charge_id = 신규 명세 id ───────────────────
  test('W4: payment INSERT 시 service_charge_id = 신규 service_charge id 링크', () => {
    const s = migSql();
    expect(s).toMatch(/RETURNING id INTO v_sc_id/);
    const payIns = s.slice(s.indexOf('INSERT INTO payments'));
    expect(payIns).toContain('service_charge_id');
    expect(payIns).toContain('v_sc_id');
  });

  // ── W5: grade NULL(unverified) grain별 — 명세 공단=0 보수, data_incomplete BLOCK ──
  test('W5: grade unverified → 명세 공단부담 0 보수 + data_incomplete BLOCK', () => {
    const s = migSql();
    // grade 확정 아니면 covered=0
    expect(s).toMatch(/v_grade_confirmed\s*:=\s*\(v_calc\.applied_grade IS NOT NULL AND v_calc\.applied_grade <> 'unverified'\)/);
    expect(s).toMatch(/v_covered\s*:=\s*CASE WHEN v_grade_confirmed THEN v_calc\.insurance_covered_amount ELSE 0 END/);
    // data_incomplete → EXCEPTION(금액 날조 금지)
    expect(s).toMatch(/IF v_calc\.data_incomplete THEN[\s\S]*RAISE EXCEPTION/);
  });

  // ── W6: payment.amount == calc copay (공단분 수납 금지) ─────────────────────
  test('W6: payment.amount = v_calc.copayment_amount (공단분 미수납)', () => {
    const payIns = migSql().slice(migSql().indexOf('INSERT INTO payments'));
    expect(payIns).toContain('v_calc.copayment_amount');
    // base_amount 를 payment amount 로 쓰지 않음
    expect(payIns).not.toMatch(/amount[^,]*v_calc\.base_amount/);
  });

  // ── W7: going-forward — 기존 payments/service_charges UPDATE·재분류 0 ───────
  test('W7: going-forward — 마이그에 기존 행 UPDATE/DELETE 없음(F-4696/F-4702 무접촉)', () => {
    const s = migSql();
    expect(s).not.toMatch(/UPDATE\s+payments/i);
    expect(s).not.toMatch(/UPDATE\s+service_charges/i);
    expect(s).not.toMatch(/DELETE\s+FROM\s+(payments|service_charges)/i);
  });

  // ── 급여 전용 가드 ─────────────────────────────────────────────────────────
  test('guard: 비급여 service 호출 시 EXCEPTION (급여 전용 write-path)', () => {
    expect(migSql()).toMatch(/NOT COALESCE\(v_service\.is_insurance_covered, false\)[\s\S]*RAISE EXCEPTION/);
  });

  // ── PMW 클라이언트 라우팅 (T-20260723 [a1] 필터 확장 반영) ───────────────────
  test('client: PMW executeAutoDone 가 covered 급여건을 RPC 로 라우팅 (is_insurance_covered 단독)', () => {
    const s = pmwSrc();
    expect(s).toContain("record_insurance_consult_payment");
    // [a1] 발화 조건 = is_insurance_covered 단독. hira_category predicate 삭제됨(dead-path 봉인).
    expect(s).toMatch(/\.filter\(\(\{ service \}\) => service\.is_insurance_covered === true\)/);
    expect(s).not.toContain("service.hira_category === 'consultation'");
  });

  test('client: 단일 결제수단·비선수금 게이트 + 나머지(비급여) plain remainder', () => {
    const s = pmwSrc();
    expect(s).toMatch(/!isDeductSettle && splits\.length === 1/);
    expect(s).toContain('remainder');
    // covered 없으면 기존 splits 그대로(회귀 0)
    expect(s).toContain('effectiveSplits = splits');
  });

  test('client: RPC 에러 시 throw (부분성공 방지 — atomic) + data_incomplete 만 흡수', () => {
    const s = pmwSrc();
    const callIdx = s.indexOf("supabase.rpc(\n          'record_insurance_consult_payment'");
    expect(callIdx).toBeGreaterThan(-1);
    const block = s.slice(callIdx, callIdx + 1600);
    // [a1] data_incomplete 는 per-svc skip(전체 수납 미차단), 그 외 에러는 throw(원자성 유지).
    expect(block).toMatch(/data_incomplete/i);
    expect(block).toMatch(/throw rpcErr/);
  });

  // ── 롤백 (ADDITIVE) ────────────────────────────────────────────────────────
  test('rollback: RPC + 컬럼 DROP (ADDITIVE 롤백)', () => {
    const r = rbkSql();
    expect(r).toContain('DROP FUNCTION IF EXISTS record_insurance_consult_payment');
    expect(r).toMatch(/ALTER TABLE payments DROP COLUMN IF EXISTS service_charge_id/);
    expect(r).toMatch(/ALTER TABLE service_charges DROP COLUMN IF EXISTS hira_unit_value_year/);
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
