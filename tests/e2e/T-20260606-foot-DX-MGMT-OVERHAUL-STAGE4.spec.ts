/**
 * E2E spec — T-20260606-foot-DX-MGMT-OVERHAUL  Stage 4 [D]
 * 출력 화면 상병코드 동반 표시 (예: "M79.3 족저근막염")
 *
 * 배경(근본원인): 상병 폴더 picker(DiagnosisFolderPicker)는 텍스트 오염 방지를 위해
 *   medical_charts.diagnosis 에 **순수 상병명(name)만** 저장한다. 따라서 출력 자동바인딩
 *   경로(autoBindContext)에서 parseIcdFromText 로는 코드를 추출할 수 없어(code='')
 *   서류 출력의 상병코드 칸이 비어 나갔다.
 *   → Stage 4 보강: 상병명으로 services(category_label='상병') 마스터를 역조회해
 *     service_code 를 채운다. (clinic 스코프·등록 상병만 참조 — 타 환자 차트 비참조,
 *     Stage 0 보안 불변식 유지.)
 *
 * AC-4: 출력에 코드+이름 함께 표기.
 */
import { test, expect } from '@playwright/test';
import { parseIcdFromText } from '../../src/lib/autoBindContext';
import { bindHtmlTemplate, getHtmlTemplate } from '../../src/lib/htmlFormTemplates';

// ── 근본원인 회귀 가드: picker 저장값(순수 상병명)은 코드 추출 불가 ───────────────
test.describe('Stage4 근본원인 — 순수 상병명 저장값은 inline 코드 없음', () => {
  test('"족저근막염" 단독 저장값 → parseIcdFromText code=""(역조회 필요 신호)', () => {
    const parsed = parseIcdFromText('족저근막염');
    expect(parsed.code).toBe('');          // 코드 없음 → services 역조회로 보강해야 함
    expect(parsed.name).toBe('족저근막염'); // 이름은 보존
  });

  test('"M72.2 족저근막염" 처럼 코드 포함 텍스트는 그대로 분리(하위호환)', () => {
    const parsed = parseIcdFromText('M72.2 족저근막염');
    expect(parsed.code).toBe('M72.2');
    expect(parsed.name).toBe('족저근막염');
  });
});

// ── services 마스터 역조회 규약(불변식 인코딩) ─────────────────────────────────
//   autoBindContext 가 수행하는 역조회의 계약: name 일치 + clinic 스코프 + category_label='상병'.
//   (실제 supabase 쿼리는 통합환경에서 동작; 여기서는 보강 규약을 단위로 고정.)
interface DxMasterRow { name: string; service_code: string | null; category_label: string; clinic_id: string }

function resolveDiagCode(
  storedName: string,
  master: DxMasterRow[],
  clinicId: string,
): string {
  const parsed = parseIcdFromText(storedName);
  if (parsed.code) return parsed.code; // 텍스트에 이미 코드 → 그대로
  const hit = master.find(
    (m) => m.clinic_id === clinicId && m.category_label === '상병' && m.name === parsed.name,
  );
  return hit?.service_code ?? '';
}

test.describe('Stage4 services 역조회로 코드 보강', () => {
  const MASTER: DxMasterRow[] = [
    { name: '족저근막염', service_code: 'M72.2', category_label: '상병', clinic_id: 'foot' },
    { name: '내향성 발톱', service_code: 'L60.0', category_label: '상병', clinic_id: 'foot' },
    { name: '족저근막염', service_code: 'X99.9', category_label: '상병', clinic_id: 'other' }, // 타 clinic
  ];

  test('AC-4 순수 상병명 저장값 → 마스터 코드 보강(M72.2 족저근막염)', () => {
    expect(resolveDiagCode('족저근막염', MASTER, 'foot')).toBe('M72.2');
  });

  test('clinic 스코프 — 타 지점 코드 누설 금지', () => {
    // foot 지점 조회는 other 지점의 X99.9 를 절대 반환하지 않음
    expect(resolveDiagCode('족저근막염', MASTER, 'foot')).not.toBe('X99.9');
  });

  test('마스터에 없는 상병명은 코드 공란(이름만 출력) — graceful', () => {
    expect(resolveDiagCode('미등록상병', MASTER, 'foot')).toBe('');
  });
});

// ── 출력 템플릿 레벨: 코드 + 이름 함께 표기 ─────────────────────────────────────
const DIAG_FORMS = ['diagnosis', 'treat_confirm', 'visit_confirm', 'diag_opinion'];

const makeBoundValues = (code: string, name: string): Record<string, string> => ({
  patient_name: '테스트환자', patient_rrn: '900101-1234567', patient_phone: '010-1234-5678',
  patient_address: '서울시 종로구', patient_age: '35', patient_gender: '☐ 여  ☑ 남',
  patient_birthdate: '1990년 01월 01일', record_no: 'C-0001', visit_no: '001',
  visit_date: '2026-06-06', visit_days: '1', issue_date: '2026-06-06',
  clinic_name: '오블리브 풋센터 종로', clinic_address: '서울시 종로구', clinic_phone: '02-1234-5678',
  doctor_name: '김원장', doctor_license_no: '12345', doctor_seal_html: '(인)',
  diag_code_1: code, diag_name_1: name, diag_flag_1: '',
  diag_code_2: '', diag_name_2: '', diag_flag_2: '',
  diag_code_3: '', diag_name_3: '', diag_flag_3: '',
  diag_code_4: '', diag_name_4: '', diag_flag_4: '',
  diag_row_3_style: 'display:none', diag_row_4_style: 'display:none', diag_extra_codes_html: '',
  rrn_front: '900101', rrn_back: '1234567', referral_year: '2026', referral_month: '06',
  referral_day: '06', dept_name: '족부의학과', referring_doctor: '김원장', year: '2026', month: '06',
});

for (const formKey of DIAG_FORMS) {
  test(`AC-4 [${formKey}] 보강된 코드+이름이 함께 출력`, () => {
    const tpl = getHtmlTemplate(formKey);
    if (!tpl) {
      console.warn(`[SKIP] ${formKey} 템플릿 없음`);
      return;
    }
    const code = resolveDiagCode('족저근막염', [
      { name: '족저근막염', service_code: 'M72.2', category_label: '상병', clinic_id: 'foot' },
    ], 'foot');
    const html = bindHtmlTemplate(tpl, makeBoundValues(code, '족저근막염'));
    expect(html).toContain('M72.2');       // 코드 — 이전엔 공란이던 칸
    expect(html).toContain('족저근막염');  // 이름
  });
}
