/**
 * E2E spec — T-20260721-foot-BILLING-REMAINING-WORK §3b (접수 insurance_grade 필수입력화)
 *
 * 배경: 신규 customers 행이 grade=null 로 생성되던 게 388건 null-grade 근원(공단부담 0·정산 왜곡).
 * 수정: NewCheckInDialog 신규 고객 생성 시 자격등급 미선택이면 접수 차단 + 선택값 즉시 적재.
 *   기존/예약연결 고객(resolvedExisting/selectedCustomerId)은 비대상(차트2 등급 관리) → 회귀 0.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DLG = fs.readFileSync(path.join(ROOT, 'src/components/NewCheckInDialog.tsx'), 'utf-8');

test('§3b-1 자격등급 상태 + 리셋', () => {
  expect(DLG).toContain('const [insuranceGrade, setInsuranceGrade] = useState<InsuranceGrade | null>(null)');
  expect(DLG).toContain('setInsuranceGrade(null)'); // resetDialog
});

test('§3b-2 신규 고객 생성 분기에서 미선택 시 저장 차단', () => {
  // resolvedExisting/ambiguous 아닌 = 신규 INSERT 분기 안에서 grade 가드
  const insertIdx = DLG.indexOf("} else if (!ambiguousLink) {");
  const branch = DLG.slice(insertIdx, insertIdx + 900);
  expect(branch).toContain('if (!insuranceGrade)');
  expect(branch).toContain('보험 자격등급을 선택');
  expect(branch).toContain('setSubmitting(false)');
  // 차단은 신규 INSERT 직전(customers.insert 이전)에 위치
  expect(branch.indexOf('if (!insuranceGrade)')).toBeLessThan(branch.indexOf(".from('customers')"));
});

test('§3b-3 신규 고객 INSERT 에 선택 등급 즉시 적재(수기입력 source)', () => {
  const insertIdx = DLG.indexOf("} else if (!ambiguousLink) {");
  // 신규 INSERT 오브젝트(clinic_id/name/phone/visit_type 뒤)에 자격등급 3필드가 위치 —
  //   insert payload 가 커서 window 를 넉넉히 잡는다(다음 분기 진입 전까지).
  const branchEnd = DLG.indexOf('.select(', insertIdx);
  const branch = DLG.slice(insertIdx, branchEnd > insertIdx ? branchEnd : insertIdx + 1400);
  expect(branch).toContain('insurance_grade: insuranceGrade');
  expect(branch).toContain("insurance_grade_source: 'manual_input'");
  expect(branch).toContain('insurance_grade_verified_at');
});

test('§3b-4 기존/예약연결 고객 접수는 등급 선택 비노출(회귀 0)', () => {
  // 선택 UI 는 신규(미식별) 접수에서만 노출
  expect(DLG).toContain('!selectedCustomerId && !linkedReservation?.customer_id');
  expect(DLG).toContain('data-testid="checkin-insurance-grade"');
  expect(DLG).toContain('ALL_INSURANCE_GRADES.map');
});
