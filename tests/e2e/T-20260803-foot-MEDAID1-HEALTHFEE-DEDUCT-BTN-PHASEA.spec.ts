/**
 * T-20260803-foot-MEDAID1-HEALTHFEE-DEDUCT-BTN-PHASEA  (P1, foot)
 *   의료급여1종 + 건강생활유지비(국가 지원금) 잔액 → 수납창 '공단 차감' 버튼.
 *   Phase A(총괄 김주연 A안 확정, MSG-qijq): 스태프가 공단 포털에서 확인한 잔액을 직접 입력 → '공단 차감'
 *   클릭 시 급여 본인부담금(정액 1,000 등)을 건강생활유지비에서 차감 → 실수납 0원(부분차감=잔액만큼).
 *   차감분은 payments method='health_maintenance'(공단 대납, settled) 분리 결제행으로 기록.
 *
 * ── AC / DA 계약 ─────────────────────────────────────────────────────────────
 *   AC2 대상가드 : medical_aid_1 AND 잔액>0 AND 급여 본인부담금>0 일 때만 버튼 노출/활성.
 *   AC3 차감동작 : 차감액=min(잔액, 급여 본인부담) — 부분차감 0원 강제 금지 + 차감 후 잔액 갱신 표기.
 *   AC4 (DA GO ADDITIVE) : 차감 = payments INSERT method='health_maintenance'(canonical). CHECK widen.
 *     Q2 split 불변식 : 차감 = rev_copay_self(급여 본인부담) 유지 — split=service_charges.is_insurance_covered 파생.
 *   AC4-GATE(b) : 마감 herald/일마감 grossTotal 이 신규 method 를 silent-drop 금지(실현매출 포함).
 *   AC4-GATE(c) : Σ(payments)==payableTotal — 차감분+잔여 실수납 = 수납잔액 불변.
 *   AC5 회귀    : 비대상(의료급여1종 아님/잔액0) 경로 무영향. RPC 4-method 검증 우회(예외 방지).
 *
 * ── 커버리지 ────────────────────────────────────────────────────────────────
 *   [S0 소스계약 — 항상 실행, 무네트워크] 컴포넌트/라이브러리/마감/마이그레이션 소스가 위 계약을
 *     만족하는지 권위 검증(React 대화형 렌더 대신 소스계약 — 이 레포 다수 spec 관례).
 *   [S1 live CHECK probe — 선택] DB 가용 + CHECK 배포 시 health_maintenance INSERT 허용 + 무효 method 거부,
 *     자가정리(테스트행 삭제). 미배포/자격없음 시 graceful skip.
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = (rel: string) => readFileSync(path.resolve(__dirname, '../../', rel), 'utf8');

const SUPA_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ══════════════════════════════════════════════════════════════════════════
// S0 — 소스 계약 (항상 실행)
// ══════════════════════════════════════════════════════════════════════════
test.describe('S0 소스계약 — 공단 차감 Phase A', () => {
  const pmw = () => repo('src/components/PaymentMiniWindow.tsx');
  const status = () => repo('src/lib/status.ts');
  const closing = () => repo('src/pages/Closing.tsx');
  const mig = () => repo('supabase/migrations/20260804090000_foot_payments_method_health_maintenance.sql');
  const rollback = () => repo('supabase/migrations/20260804090000_foot_payments_method_health_maintenance.rollback.sql');
  const dryrun = () => repo('supabase/migrations/20260804090000_foot_payments_method_health_maintenance.dryrun.sql');

  test('S0-1 PayMethod 는 health_maintenance 포함, METHOD_OPTIONS(수동선택)에는 미포함', () => {
    const src = pmw();
    expect(src).toMatch(/type PayMethod =[^;]*'health_maintenance'/);
    // METHOD_OPTIONS const 배열 블록에 health_maintenance 가 없어야 함(스태프 임의 선택 차단).
    //   ※ 'METHOD_OPTIONS' 문자열 첫 등장은 주석이므로 실제 const 선언(배열 리터럴)만 검사한다.
    const constIdx = src.indexOf('const METHOD_OPTIONS');
    expect(constIdx).toBeGreaterThan(-1);
    const optBlock = src.slice(constIdx, src.indexOf('];', constIdx));
    expect(optBlock).not.toContain('health_maintenance');
  });

  test('S0-2 METHOD_KO 에 공단(건강생활유지비) 라벨 등재(마감/영수증 표기 silent-drop 방지)', () => {
    expect(status()).toMatch(/health_maintenance:\s*'공단\(건강생활유지비\)'/);
  });

  test('S0-3 AC2 대상가드 — medical_aid_1 AND 잔액>0 AND 본인부담>0', () => {
    const src = pmw();
    expect(src).toMatch(/isMedicalAid1\s*=\s*customerInsuranceGrade === 'medical_aid_1'/);
    expect(src).toMatch(/healthFeeEligible\s*=\s*isMedicalAid1 && healthMaintenanceBalance > 0 && payCopaymentWithSurcharge > 0/);
    // 버튼 disabled 가드
    expect(src).toMatch(/disabled=\{!healthFeeEligible \|\| settled\}/);
  });

  test('S0-4 AC3 차감액=min(잔액,본인부담) + 부분차감 0원 강제 금지 + 갱신 잔액 표기', () => {
    const src = pmw();
    expect(src).toMatch(/healthFeeDeductable\s*=\s*Math\.min\(healthMaintenanceBalance,\s*payCopaymentWithSurcharge\)/);
    // 실수납/잔액은 max(0, ...) — 음수 방지(부분차감시 0원 강제 아님: 잔여는 netPayable 에 잔존)
    expect(src).toMatch(/netPayableAfterHealthFee\s*=\s*Math\.max\(0,\s*payableTotalWithSurcharge - healthFeeDeducted\)/);
    expect(src).toMatch(/healthFeeRemainingBalance\s*=\s*Math\.max\(0,\s*healthMaintenanceBalance - healthFeeDeducted\)/);
    // 화면 표기(차감 후 건강생활유지비 잔액 + 실수납액)
    expect(src).toContain('차감 후 건강생활유지비 잔액');
    expect(src).toMatch(/실수납액/);
  });

  test('S0-5 AC4-GATE(c) settle 분리행 — health_maintenance 결제행 + Σ==payableTotal', () => {
    const src = pmw();
    // handleSettle 에서 health_maintenance split 을 만들고 잔여는 buildSettleSplits 로(합계=amount)
    expect(src).toMatch(/method: 'health_maintenance', amount: hmAmount/);
    expect(src).toMatch(/const remainder = amount - hmAmount/);
    expect(src).toMatch(/buildSettleSplits\(remainder\)/);
  });

  test('S0-6 AC5 — health_maintenance settle 는 covered-RPC(4-method 검증) 우회', () => {
    const src = pmw();
    expect(src).toMatch(/isHealthMaintenanceSettle\s*=\s*splits\.some\(\(s\) => s\.method === 'health_maintenance'\)/);
    expect(src).toMatch(/!isDeductSettle && !isHealthMaintenanceSettle && splits\.length === 1/);
  });

  test('S0-7 AC4-GATE(b) 일마감 grossTotal 이 health_maintenance 실현매출 포함(silent-drop 금지)', () => {
    const src = closing();
    expect(src).toMatch(/singleHealthMaintenance\s*=\s*sum\(payments,\s*'health_maintenance'\)/);
    expect(src).toMatch(/grossTotal = totalCard \+ totalCash \+ totalTransfer \+ singleHealthMaintenance/);
    // 결제수단별 합계 카드에 명시 행 노출
    expect(src).toContain('공단(건강생활유지비)');
  });

  test('S0-8 마이그레이션 — CHECK widen(5값) + membership 유지 + ADDITIVE', () => {
    const src = mig();
    expect(src).toMatch(/CHECK \(method IN \('card','cash','transfer','membership','health_maintenance'\)\)/);
    // 롤백은 4값 복원(대칭)
    expect(rollback()).toMatch(/CHECK \(method IN \('card','cash','transfer','membership'\)\)/);
  });

  test('S0-9 AC4-GATE(b) 마감 herald 3함수 유니버스에 health_maintenance 포함 + membership 제외 유지', () => {
    const src = mig();
    const universeMatches = src.match(/method IN \('card','cash','transfer','health_maintenance'\)/g) ?? [];
    // closing_source_split / closing_insurance_split / closing_month_projection 3곳 (herald 유니버스 = 4값, membership 제외)
    expect(universeMatches.length).toBe(3);
    // membership 은 herald 유니버스에 없음(Q5 불변): membership 은 오직 CHECK(5값)에만 1회 등장
    const checkForm = src.match(/method IN \('card','cash','transfer','membership','health_maintenance'\)/g) ?? [];
    expect(checkForm.length).toBe(1);
  });

  test('S0-10 dry-run No-Persistence sentinel + CHECK/herald 검증 leg', () => {
    const src = dryrun();
    expect(src).toMatch(/RAISE EXCEPTION E'DRYRUN RESULT/);
    expect(src).toContain('health_maintenance');
    expect(src).toMatch(/DO \$dryrun\$/);
  });

  test('S0-11 AC3 영수증 차감 내역 3줄 — printInvoice 에 공단 대납 시 3줄 표기', () => {
    const src = repo('src/components/DocumentPrintPanel.tsx');
    // 공단 대납 합계 파생(health_maintenance, refund 제외)
    expect(src).toMatch(/const hmPaid = paymentItems\s*\n?\s*\.filter\(\(p\) => p\.method === 'health_maintenance' && p\.payment_type !== 'refund'\)/);
    // 3줄: 진료비 본인부담금 / 건강생활유지비 차감(−) / 실수납(환자 부담)
    expect(src).toContain('진료비 본인부담금');
    expect(src).toContain('건강생활유지비 차감 (공단 대납)');
    expect(src).toContain('실수납 (환자 부담)');
    // 비대상(hmPaid==0) 무영향 — 3줄은 hmPaid>0 조건부
    expect(src).toMatch(/hmPaid > 0\s*\?/);
    // 환자 실수납 = paid_amount − 공단대납분
    expect(src).toMatch(/patientNetPaid = Math\.max\(0, doc\.paid_amount - hmPaid\)/);
  });

  test('S0-12 결제수단 라벨 SSOT — 재발급 목록이 METHOD_KO 사용(raw 토큰 노출 방지)', () => {
    const src = repo('src/components/DocumentPrintPanel.tsx');
    expect(src).toMatch(/import \{ METHOD_KO \} from '@\/lib\/status'/);
    expect(src).toMatch(/const methodLabel = pay\.method \? \(METHOD_KO\[pay\.method\] \?\? pay\.method\) : ''/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// S1 — live CHECK probe (선택, graceful skip)
// ══════════════════════════════════════════════════════════════════════════
test.describe('S1 live — payments.method CHECK widen', () => {
  test('health_maintenance INSERT 허용 + 무효 method 거부 (자가정리)', async () => {
    test.skip(!SUPA_URL || !SERVICE_KEY, 'DB URL/service_role 미설정 — live probe skip');
    const sb = createClient(SUPA_URL!, SERVICE_KEY!, { auth: { persistSession: false } });

    // 1) health_maintenance 허용 여부 — 임시행 INSERT 후 즉시 삭제(자가정리)
    const { data: ins, error: insErr } = await sb
      .from('payments')
      .insert({ amount: 1000, method: 'health_maintenance', payment_type: 'payment' })
      .select('id')
      .maybeSingle();

    if (insErr && /check constraint|payments_method_check/i.test(insErr.message)) {
      test.skip(true, 'CHECK 미배포(마이그레이션 apply 전) — live probe skip');
    }
    expect(insErr, insErr?.message).toBeNull();
    expect(ins?.id).toBeTruthy();
    if (ins?.id) await sb.from('payments').delete().eq('id', ins.id);

    // 2) 무효 method 는 여전히 거부(CHECK 축소 아님)
    const { error: badErr } = await sb
      .from('payments')
      .insert({ amount: 1000, method: '__invalid__', payment_type: 'payment' })
      .select('id')
      .maybeSingle();
    expect(badErr, '무효 method 는 CHECK 거부되어야 함').not.toBeNull();
  });
});
