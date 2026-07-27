/**
 * E2E spec — T-20260727-foot-CLOSING-REFUND-ACTOR-HISTORY
 *   (consolidates split-sibling T-20260727-foot-PKG-REFUND-CREATEDBY-CAPTURE)
 *
 * 김주연 총괄 요청(과거 누락분): 일마감 환불처리 시 "누가 처리했는지" 이력을 남긴다.
 * 단건 환불 처리자는 PROCESSOR-DISPLAY(Part1)에서 payments.created_by 로 표시 완료.
 * 남은 갭 = 패키지 환불 — package_payments 에 created_by 부재 → 처리자 데이터 자체가 없어 '—'.
 *
 * ── 이 티켓 범위 (DA GO ADDITIVE: DA-20260727-foot-PKG-REFUND-CREATEDBY-CAPTURE) ──
 *   [DB] package_payments.created_by UUID + FK→user_profiles(ON DELETE SET NULL) 신규(ADDITIVE).
 *        refund_package_payment RPC INSERT 에 created_by=auth.uid() auto-capture(시그니처 무변경).
 *        마이그 20260727210000_foot_package_payments_created_by (up/dryrun/rollback).
 *   [FE] Closing.tsx 패키지 쿼리에 created_by + processor:user_profiles!package_payments_created_by_fkey(name)
 *        JOIN 추가. 패키지 enrichedRow processor_name = package_payments.processor.name 승계 / 과거행 null('—').
 *
 * ── AC 매핑 ──────────────────────────────────────────────────────────────────
 *   AC1(저장): refund_package_payment created_by=auth.uid() 캡처 + 처리 시각=created_at(기존 컬럼 재사용).
 *   AC2(표시): 환불 이력 리스트 '시각'(pay_time) + '처리자'(processor_name) 표시.
 *   AC3(서버 신뢰): auth.uid()(JWT sub, SECURITY DEFINER 무관 CALLER uid) — 클라 임의지정 경로 없음.
 *   AC4(과거 graceful): 과거 패키지 환불행 created_by=NULL → '—' (forward-only, 백필 미의무).
 *
 * ★ 검증 방식: 일마감(/admin/closing)은 현장 PHI 계정 → 인증 우회 불가.
 *   → 정적 코드/마이그 구조 검증 + 앱 로드(HTTP 200) + 회귀 가드. 실수치 정합은 갤탭 현장 confirm.
 *
 * ★ db_change=true. MIG-GATE(dryrun 무영속 PASS + post-probe clean + 원장 3자 정합) 별도.
 * ★ 배포순서: DDL(package_payments.created_by) 적용이 FE(패키지 processor JOIN) 머지보다 선행/원자.
 *   FE 가 먼저 뜨면 존재하지 않는 FK embed → PostgREST 400 → 패키지 쿼리 파손.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const closing = () => read('src/pages/Closing.tsx');
const migUp = () => read('supabase/migrations/20260727210000_foot_package_payments_created_by.sql');
const migDry = () => read('supabase/migrations/20260727210000_foot_package_payments_created_by.dryrun.sql');
const migRb = () => read('supabase/migrations/20260727210000_foot_package_payments_created_by.rollback.sql');

test.describe('T-20260727-foot-CLOSING-REFUND-ACTOR-HISTORY', () => {

  // ── 회귀 가드: 앱 정상 로드 ────────────────────────────────────────────────
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC1(저장): RPC created_by=auth.uid() auto-capture + INSERT target=package_payments 유지 ──
  test('AC1: refund_package_payment INSERT INTO package_payments 에 created_by=auth.uid() 캡처', () => {
    const m = migUp();
    // INSERT target=package_payments 유지 (DA PIN: payments 전환 금지 — 누적환불 회계 파괴)
    expect(m).toContain('INSERT INTO package_payments');
    // created_by 컬럼 + auth.uid() 값 auto-capture
    expect(m).toMatch(/created_by[\s\S]*auth\.uid\(\)/);
    // 시그니처 무변경(2-arg: p_payment_id UUID, p_method TEXT)
    expect(m).toContain('refund_package_payment(');
    expect(m).toContain('p_payment_id UUID');
    expect(m).toContain('p_method     TEXT');
  });

  // ── AC(ADDITIVE): 신규 컬럼 + FK(SET NULL) + partial index, 파괴 0 ──────────
  test('DDL ADDITIVE: package_payments.created_by ADD COLUMN IF NOT EXISTS + FK ON DELETE SET NULL', () => {
    const m = migUp();
    expect(m).toMatch(/ALTER TABLE public\.package_payments\s+ADD COLUMN IF NOT EXISTS created_by UUID/);
    expect(m).toContain('REFERENCES public.user_profiles(id) ON DELETE SET NULL');
    expect(m).toContain('CREATE INDEX IF NOT EXISTS idx_package_payments_created_by');
    // 파괴적 구문 없음
    expect(m).not.toMatch(/DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM/i);
  });

  // ── AC3(서버 신뢰): 클라 임의 처리자 지정 경로 없음 — auth.uid() 서버측만 ────
  test('AC3: 처리자=서버 auth.uid() (클라 전달 파라미터로 created_by 받지 않음)', () => {
    const m = migUp();
    // 함수 파라미터는 p_payment_id, p_method 뿐 — created_by/staff_id 파라미터 없음
    expect(m).not.toMatch(/p_created_by|p_staff_id|p_processor/);
    // SECURITY DEFINER 이나 auth.uid()=CALLER uid (DA PIN)
    expect(m).toContain('SECURITY DEFINER');
  });

  // ── MIG 무영속 가드: dryrun 은 COMMIT 없이 ROLLBACK, rollback 은 컬럼 drop+RPC 복원 ──
  test('MIG: dryrun BEGIN..ROLLBACK(무COMMIT) + assertion, rollback 컬럼 drop', () => {
    const d = migDry();
    expect(d).toContain('BEGIN;');
    expect(d).toContain('ROLLBACK;');
    expect(d).not.toMatch(/^\s*COMMIT;/m);
    expect(d).toContain('DRYRUN-FAIL');
    expect(d).toContain('package_payments_created_by_fkey');
    const rb = migRb();
    expect(rb).toContain('DROP COLUMN IF EXISTS created_by');
    expect(rb).toContain('DROP INDEX IF EXISTS idx_package_payments_created_by');
    // 롤백은 RPC 를 created_by 미포함 직전 버전으로 복원
    expect(rb).toContain('CREATE OR REPLACE FUNCTION refund_package_payment');
  });

  // ── AC2(표시): 패키지 쿼리 created_by + processor JOIN + processor_name 승계 ──
  test('AC2: 패키지 쿼리 processor JOIN + enrichedRow processor_name = package_payments.processor.name', () => {
    const c = closing();
    expect(c).toContain('processor:user_profiles!package_payments_created_by_fkey(name)');
    expect(c).toMatch(/created_by,\s*processor:user_profiles!package_payments_created_by_fkey\(name\)/);
    // many-to-one embed 배열추론 → unknown 경유 cast
    expect(c).toContain('as unknown as PackagePaymentRow[]');
    // 패키지 enrichedRow 가 실제 처리자 승계 (기존 null 하드코딩 제거)
    expect(c).toContain('processor_name: p.processor?.name ?? null');
    // 블로커 하드코딩(패키지 processor_name: null) 제거 확인
    expect(c).not.toMatch(/패키지는 처리자 데이터 자체가 없음/);
  });

  // ── AC2(표시): 환불 이력 리스트 '시각' + '처리자' 컬럼 (단건/패키지 공통) ────
  test('AC2: 환불 이력 리스트 시각(pay_time) + 처리자(processor_name) 셀 표시', () => {
    const c = closing();
    // 시각 컬럼 헤더 + pay_time 셀
    expect(c).toContain('<th className="py-1.5 pr-2 text-left font-medium">시각</th>');
    // 처리자 셀 = processor_name ?? '—' (단건/패키지 공통 경로)
    expect(c).toMatch(/data-testid="closing-refund-processor">\{r\.processor_name \?\? '—'\}/);
  });

  // ── AC4(과거 graceful): 미기록 → '—' (에러/공백 아님) ──────────────────────
  test('AC4: 처리자 미기록(과거 패키지 환불) → "—" fallback', () => {
    const c = closing();
    expect(c).toContain("{r.processor_name ?? '—'}");
    // 과거행 forward-only — 마이그 주석에 백필 미의무 명시
    expect(migUp()).toMatch(/forward-only|백필 미의무/);
  });

  // ── 회귀 가드: 기존 금일 환불 섹션 구조 + 단건 경로 보존 ─────────────────────
  test('회귀: 환불 목록 testid + 단건 payments processor JOIN 보존', () => {
    const c = closing();
    expect(c).toContain('data-testid="closing-refund-list"');
    // 단건(PROCESSOR-DISPLAY Part1) 경로 무접촉
    expect(c).toContain('processor:user_profiles!payments_created_by_fkey(name)');
    // 담당자별 그룹핑 키(assigned_staff 기반, money 로직) 무변경
    expect(c).toContain("const key = r.staff_name ?? '미지정';");
  });
});
