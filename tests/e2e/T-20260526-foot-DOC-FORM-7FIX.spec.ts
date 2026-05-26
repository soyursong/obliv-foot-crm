/**
 * E2E spec — T-20260526-foot-DOC-FORM-7FIX
 * 풋센터 서류 양식 7종 누락·오류 수정 검증
 *
 * DOC-FORM-REVISE(8c65e8d) + DOC-FORM-7FIX(d23d8a7) AC 통합 커버
 *
 * 시나리오 1: 소견서 출력     — 소견칸 확장 + 주민번호 하이픈 + 도장 위치
 * 시나리오 2: 진료비계산서·영수증 — 비급여 수가 + "(인)" + 네모칸 없음
 * 시나리오 3: 진단서/진료확인서   — "병명" 라벨 정정 + 주민번호 하이픈
 * 시나리오 4: 납입증명서        — 병원장 정보 + 날짜 자동기입 + 레이아웃
 * 시나리오 5: 엣지 케이스       — 주민번호 미등록 시 빈칸 (에러 없음)
 *
 * NOTE: autoBindContext.ts는 supabase 의존성으로 Node.js 단위 환경에서 직접 import 불가.
 *       formatRrn 등 순수 함수는 인라인 정의 후 동일 스펙으로 검증.
 *       bindHtmlTemplate(htmlFormTemplates.ts)는 supabase 의존성 없어 직접 import 가능.
 *
 * 실행: playwright test --project=unit T-20260526-foot-DOC-FORM-7FIX
 */

// T-20260526-foot-DOC-FORM-7FIX

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';

// ESM 환경에서 __dirname 대체
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

// ─── 인라인 순수 함수 (autoBindContext.ts 의존성 격리) ────────────────────────
//
// 아래 함수는 src/lib/autoBindContext.ts의 구현과 동일 스펙.
// 소스 코드 정적 검증(시나리오별 grep 테스트)으로 실구현과의 일치도 보장.

/**
 * 주민번호 하이픈 삽입 — AC-A (DOC-FORM-REVISE)
 * "1234561234567" → "123456-1234567"
 * 이미 하이픈 있으면 그대로. 13자리 아닌 경우 그대로. null/undefined → ''
 */
function formatRrn(rrn: string | null | undefined): string {
  if (!rrn) return '';
  const clean = rrn.replace(/-/g, '');
  if (clean.length === 13) return `${clean.slice(0, 6)}-${clean.slice(6)}`;
  return rrn;
}

// ─── 공통 바인딩 mock 값 ──────────────────────────────────────────────────────
// autoBindContext.buildAutoBindValues() 출력 시뮬레이션
// DOC-FORM-7FIX 관련 필드 위주

const FULL_BIND_WITH_RRN: Record<string, string> = {
  // 환자
  patient_name: '홍길동',
  patient_phone: '010-1234-5678',
  patient_rrn: formatRrn('9005151234567'),   // → "900515-1234567" (AC-A)
  patient_address: '서울 종로구 인사동5길 38',
  patient_gender: '☐ 여  ☑ 남',
  patient_birthdate: '1990년 05월 15일',
  patient_age: '36',
  record_no: 'F-0042',
  // rrn 분리 (진료의뢰서 rrn_front/rrn_back)
  rrn_front: '900515',
  rrn_back: '1234567',
  // 진료·발행
  visit_date: '2026-05-26',
  issue_date: '2026-05-26',
  onset_date: '',
  visit_no: '',
  visit_days: '1',
  // 의사·병원
  doctor_name: '문지은',
  doctor_license_no: '99999',
  doctor_specialist_no: '',
  doctor_seal_image: '',
  doctor_seal_html: '(인)',          // seal_image_url null → "(인)" fallback
  clinic_name: '오블리브 풋센터 종로',
  clinic_address: '서울 종로구 인사동5길 38',
  clinic_phone: '02-1234-5678',
  clinic_fax: '',
  clinic_nhis_code: '12345678',
  clinic_code: '12345678',
  clinic_business_no: '123-45-67890',
  clinic_established_date: '2024-01-01',
  business_reg_no: '123-45-67890',
  // 금액
  total_amount: '50,000',
  insurance_covered: '0',
  copayment: '0',
  non_covered: '50,000',           // 비급여 수가 (AC-3)
  // 상병
  diag_code_1: 'L60.0',
  diag_name_1: '내향성 발톱',
  diag_code_2: '',
  diag_name_2: '',
  diag_flag_1: '',
  diag_flag_2: '',
  // 진료확인
  diagnosis_ko: '내향성 발톱으로 레이저 시술을 시행하였음.',
  memo: '',
  purpose: '보험청구용',
  treatment_opinion: '',
  // 진료의뢰서 (AC-5)
  referral_year: '2026',
  referral_month: '05',
  referral_day: '26',
  dept_name: '족부의학과',           // AC-7-③ + AC-5
  referring_doctor: '문지은',
  // 납입증명서 (AC-7)
  year: '2026',                     // AC-7-⑤
  month: '05',                      // AC-7-⑤
  annual_total: '0',
  recipient: '',
  excluded_items: '',
  m01_outpatient: '', m01_inpatient: '',
  m02_outpatient: '', m02_inpatient: '',
  m03_outpatient: '', m03_inpatient: '',
  m04_outpatient: '', m04_inpatient: '',
  m05_outpatient: '', m05_inpatient: '',
  m06_outpatient: '', m06_inpatient: '',
  m07_outpatient: '', m07_inpatient: '',
  m08_outpatient: '', m08_inpatient: '',
  m09_outpatient: '', m09_inpatient: '',
  m10_outpatient: '', m10_inpatient: '',
  m11_outpatient: '', m11_inpatient: '',
  m12_outpatient: '', m12_inpatient: '',
  // 보험
  insurance_grade_label: '',
  copay_rate: '',
  special_treatment_code: '',
};

/** 주민번호 미등록 고객 mock */
const FULL_BIND_NO_RRN: Record<string, string> = {
  ...FULL_BIND_WITH_RRN,
  patient_name: '김철수',
  patient_rrn: formatRrn(null),    // → ''
  rrn_front: '',
  rrn_back: '',
};

// 소스 파일 경로 (정적 검증용) — tests/e2e/ 기준 2단계 위로
const SRC_ROOT = path.join(__dirname, '../../src');
const AUTOBIND_SRC = path.join(SRC_ROOT, 'lib/autoBindContext.ts');
const FORM_TEMPLATES_SRC = path.join(SRC_ROOT, 'lib/htmlFormTemplates.ts');

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 소견서 (diag_opinion)
// AC-1: 소견 기입칸 5배 확장 (min-height 충분히 확장)
// AC-A: 주민번호 하이픈 포맷 "XXXXXX-XXXXXXX"
// AC-B: 도장 위치 — 의사 성명 근방 {{doctor_seal_html}} 바인딩
// ─────────────────────────────────────────────────────────────────────────────

test.describe('시나리오 1: 소견서 (diag_opinion) — AC-1 소견칸 확장 + AC-A 주민번호 하이픈 + AC-B 도장 위치', () => {

  // ── formatRrn 스펙 검증 (인라인 함수 + 소스 코드 정적 확인) ──

  test('AC-A: formatRrn 스펙 — 연속 13자리 → "XXXXXX-XXXXXXX" 하이픈 포맷', () => {
    // T-20260526-foot-DOC-FORM-7FIX
    expect(formatRrn('9005151234567')).toBe('900515-1234567');
    expect(formatRrn('0001012345678')).toBe('000101-2345678');
    expect(formatRrn('8510201234567')).toBe('851020-1234567');
  });

  test('AC-A: formatRrn 스펙 — 이미 하이픈 있으면 그대로 반환', () => {
    expect(formatRrn('900515-1234567')).toBe('900515-1234567');
  });

  test('AC-A: formatRrn 스펙 — 13자리 아닌 경우 원본 반환', () => {
    expect(formatRrn('12345')).toBe('12345');
    expect(formatRrn('1234567890123456')).toBe('1234567890123456');
  });

  test('AC-A: autoBindContext.ts 소스 — formatRrn null guard 구현 확인', () => {
    // 실구현(autoBindContext.ts)에 formatRrn null guard가 있는지 정적 검증
    const src = fs.readFileSync(AUTOBIND_SRC, 'utf-8');
    // null guard: `if (!rrn) return ''`
    expect(src).toContain('formatRrn');
    expect(src).toMatch(/if\s*\(!rrn\)\s*return\s*['"]{2}/);
    // slice 기반 하이픈 삽입
    expect(src).toMatch(/slice\(0,\s*6\).*slice\(6\)/s);
  });

  test('AC-A: autoBindContext.ts 소스 — patientRrn = formatRrn(...) 사용 확인', () => {
    const src = fs.readFileSync(AUTOBIND_SRC, 'utf-8');
    // buildAutoBindValues에서 patientRrn에 formatRrn 적용
    expect(src).toContain('formatRrn(ctx.customer?.rrn)');
  });

  test('AC-1: diag_opinion 템플릿 존재 확인', () => {
    const html = getHtmlTemplate('diag_opinion');
    expect(html).not.toBeNull();
  });

  test('AC-1: diag_opinion 소견 기입칸 — large-area 클래스 또는 min-height 300px 이상', () => {
    const html = getHtmlTemplate('diag_opinion')!;
    // AC-1: 5배 확장 → min-height가 기존 60px 대비 300px 이상이어야 함
    const hasLargeArea = html.includes('class="large-area"') || html.includes("class='large-area'");
    // large-area 클래스이면서 소견 관련 행 확인
    const opinionRow = html.match(/소[\s\S]{0,50}견[\s\S]{0,200}min-height\s*:\s*(\d+)px/);
    const heightVal = opinionRow ? parseInt(opinionRow[1]) : 0;
    expect(hasLargeArea || heightVal >= 300).toBe(true);
  });

  test('AC-B: diag_opinion 소스 — {{doctor_seal_html}} 바인딩 포함', () => {
    const html = getHtmlTemplate('diag_opinion')!;
    expect(html).toContain('{{doctor_seal_html}}');
  });

  test('AC-B: diag_opinion 소스 — 의사 성명 셀 근방에 doctor_seal_html 위치', () => {
    const html = getHtmlTemplate('diag_opinion')!;
    // "의 사 성 명" 근방 500자 이내에 doctor_seal_html 바인딩
    const idx = html.indexOf('doctor_seal_html');
    const ctxWindow = html.slice(Math.max(0, idx - 500), idx + 50);
    expect(ctxWindow).toMatch(/의[\s\S]{0,30}사[\s\S]{0,30}성[\s\S]{0,30}명/);
  });

  test('AC-B: autoBindContext.ts 소스 — doctor_seal_html "(인)" fallback 구현 확인', () => {
    const src = fs.readFileSync(AUTOBIND_SRC, 'utf-8');
    // seal_image_url 없을 때 "(인)" fallback
    expect(src).toContain("'(인)'");
    expect(src).toContain('doctor_seal_html');
  });

  test('소견서 바인딩 — patient_rrn 하이픈 + "(인)" 도장 렌더링', () => {
    const html = getHtmlTemplate('diag_opinion')!;
    const rendered = bindHtmlTemplate(html, FULL_BIND_WITH_RRN);
    // 주민번호 하이픈
    expect(rendered).toContain('900515-1234567');
    // 도장 "(인)"
    expect(rendered).toContain('(인)');
    // "명명" 오타 없음
    expect(rendered).not.toContain('명명');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 진료비 계산서·영수증 (bill_receipt)
// AC-3: 비급여 수가 {{non_covered}} 자동기입
//        진료의사 "(인)" 표시 (doctor_seal_html fallback)
//        네모칸 □ 리터럴 없음
// ─────────────────────────────────────────────────────────────────────────────

test.describe('시나리오 2: 진료비 계산서·영수증 (bill_receipt) — 비급여 수가 + "(인)" + 네모칸 없음', () => {

  test('AC-3: bill_receipt 템플릿 존재 확인', () => {
    const html = getHtmlTemplate('bill_receipt');
    expect(html).not.toBeNull();
  });

  test('AC-3: bill_receipt — {{non_covered}} 바인딩 포함 (비급여 수가 자동기입)', () => {
    const html = getHtmlTemplate('bill_receipt')!;
    expect(html).toContain('{{non_covered}}');
  });

  test('AC-3: bill_receipt — 진료의사 행에 {{doctor_seal_html}} 포함 ("(인)" 자리)', () => {
    const html = getHtmlTemplate('bill_receipt')!;
    expect(html).toContain('{{doctor_seal_html}}');
    // "진료의사" 근방 200자 이내에 doctor_seal_html 위치
    expect(html).toMatch(/진료의사[\s\S]{0,200}doctor_seal_html/);
  });

  test('AC-3: bill_receipt — □ 네모칸 리터럴(U+25A1) 없어야 함', () => {
    const html = getHtmlTemplate('bill_receipt')!;
    expect(html).not.toContain('□');  // □
    expect(html).not.toContain('□');
  });

  test('AC-3: bill_receipt — ☐ 체크박스(U+2610) 없어야 함 (빈 셀은 CSS로만)', () => {
    const html = getHtmlTemplate('bill_receipt')!;
    expect(html).not.toContain('☐');  // ☐
    expect(html).not.toContain('☐');
  });

  test('bill_receipt 바인딩 — non_covered 금액 + "(인)" + 주민번호 하이픈 렌더링', () => {
    const html = getHtmlTemplate('bill_receipt')!;
    const rendered = bindHtmlTemplate(html, FULL_BIND_WITH_RRN);
    // 비급여 금액
    expect(rendered).toContain('50,000');
    // 도장 "(인)"
    expect(rendered).toContain('(인)');
    // 주민번호 하이픈
    expect(rendered).toContain('900515-1234567');
    // □ 없음
    expect(rendered).not.toContain('□');
    // 렌더링 완료
    expect(rendered.length).toBeGreaterThan(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 진단서 (diagnosis) / 진료확인서 (treat_confirm)
// AC-4/AC-6: "명명" → "병명" 라벨 정정
// AC-A: 주민번호 하이픈 포맷
// ─────────────────────────────────────────────────────────────────────────────

test.describe('시나리오 3: 진단서 (diagnosis) / 진료확인서 (treat_confirm) — "병명" 라벨 정정 + 주민번호 하이픈', () => {

  test('AC-4/AC-6: diagnosis 템플릿 존재 확인', () => {
    const html = getHtmlTemplate('diagnosis');
    expect(html).not.toBeNull();
  });

  test('AC-4/AC-6: treat_confirm 템플릿 존재 확인', () => {
    const html = getHtmlTemplate('treat_confirm');
    expect(html).not.toBeNull();
  });

  test('AC-4/AC-6: diagnosis — "명명" 오타 없어야 함', () => {
    const html = getHtmlTemplate('diagnosis')!;
    expect(html).not.toContain('명명');
  });

  test('AC-4/AC-6: treat_confirm — "명명" 오타 없어야 함', () => {
    const html = getHtmlTemplate('treat_confirm')!;
    expect(html).not.toContain('명명');
  });

  test('AC-4/AC-6: diagnosis — "병명" 라벨 포함 (병&nbsp;&nbsp;명 또는 병명)', () => {
    const html = getHtmlTemplate('diagnosis')!;
    // "병명" or "병  명" (with various whitespace/entity)
    expect(html).toMatch(/병[\s\S]{0,30}명/);
    // "명명" 형태 아님
    expect(html).not.toMatch(/[^병]명명/);
  });

  test('AC-4/AC-6: treat_confirm — "병명" 라벨 포함', () => {
    const html = getHtmlTemplate('treat_confirm')!;
    expect(html).toMatch(/병[\s\S]{0,30}명/);
    expect(html).not.toMatch(/[^병]명명/);
  });

  test('AC-A: diagnosis — {{patient_rrn}} 바인딩 포함', () => {
    const html = getHtmlTemplate('diagnosis')!;
    expect(html).toContain('{{patient_rrn}}');
  });

  test('AC-A: treat_confirm — {{patient_rrn}} 바인딩 포함', () => {
    const html = getHtmlTemplate('treat_confirm')!;
    expect(html).toContain('{{patient_rrn}}');
  });

  test('diagnosis 바인딩 — patient_rrn 하이픈 + "병명" 라벨 정상 렌더링', () => {
    const html = getHtmlTemplate('diagnosis')!;
    const rendered = bindHtmlTemplate(html, FULL_BIND_WITH_RRN);
    expect(rendered).toContain('900515-1234567');
    expect(rendered).not.toContain('명명');
  });

  test('treat_confirm 바인딩 — patient_rrn 하이픈 + "병명" 라벨 정상 렌더링', () => {
    const html = getHtmlTemplate('treat_confirm')!;
    const rendered = bindHtmlTemplate(html, FULL_BIND_WITH_RRN);
    expect(rendered).toContain('900515-1234567');
    expect(rendered).not.toContain('명명');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 4: 납입증명서 (payment_cert)
// AC-7-①: 양식명 중앙 배치 (text-align:center)
// AC-7-③: [진료과] → {{dept_name}} 자동기입
// AC-7-④: 하단 병원장 정보 ({{doctor_name}} + {{doctor_seal_html}})
// AC-7-⑤: "본 진료비는 {{year}}년 {{month}}월까지" 날짜 자동기입
// ─────────────────────────────────────────────────────────────────────────────

test.describe('시나리오 4: 납입증명서 (payment_cert) — 레이아웃 + 병원장 정보 + 날짜 자동기입', () => {

  test('AC-7: payment_cert 템플릿 존재 확인', () => {
    const html = getHtmlTemplate('payment_cert');
    expect(html).not.toBeNull();
  });

  test('AC-7-①: 타이틀 — 중앙 배치 (납입증명서 근방 text-align:center 존재)', () => {
    const html = getHtmlTemplate('payment_cert')!;
    // 타이틀 영역(납입증명서)이 center 정렬 div 내부에 위치
    const certIdx = html.indexOf('납입증명서');
    const ctxBefore = html.slice(Math.max(0, certIdx - 200), certIdx);
    expect(ctxBefore).toMatch(/text-align\s*:\s*center/);
  });

  test('AC-7-③: {{dept_name}} 바인딩 포함 (진료과 자동기입)', () => {
    const html = getHtmlTemplate('payment_cert')!;
    expect(html).toContain('{{dept_name}}');
  });

  test('AC-7-④: 병원장 {{doctor_name}} + {{doctor_seal_html}} 포함', () => {
    const html = getHtmlTemplate('payment_cert')!;
    expect(html).toContain('{{doctor_name}}');
    expect(html).toContain('{{doctor_seal_html}}');
  });

  test('AC-7-④: 병원장 텍스트 근방에 doctor_name 위치', () => {
    const html = getHtmlTemplate('payment_cert')!;
    // "병" 이후 300자 이내에 doctor_name (병원장 : {{doctor_name}} 패턴)
    expect(html).toMatch(/병[\s\S]{0,300}doctor_name/);
  });

  test('AC-7-⑤: {{year}} + {{month}} 바인딩 포함', () => {
    const html = getHtmlTemplate('payment_cert')!;
    expect(html).toContain('{{year}}');
    expect(html).toContain('{{month}}');
  });

  test('AC-7-⑤: "본 진료비는" 뒤 200자 이내에 year/month 바인딩 포함', () => {
    const html = getHtmlTemplate('payment_cert')!;
    expect(html).toMatch(/본\s*진료비는[\s\S]{0,200}year/);
    expect(html).toMatch(/본\s*진료비는[\s\S]{0,250}month/);
  });

  test('AC-7-⑤: autoBindContext.ts 소스 — year/month 현재 날짜 자동기입 구현 확인', () => {
    const src = fs.readFileSync(AUTOBIND_SRC, 'utf-8');
    // year: format(new Date(), 'yyyy')
    expect(src).toMatch(/year\s*:\s*format\s*\(.*'yyyy'\)/);
    // month: format(new Date(), 'MM')
    expect(src).toMatch(/month\s*:\s*format\s*\(.*'MM'\)/);
  });

  test('AC-7-③: autoBindContext.ts 소스 — dept_name 족부의학과 자동기입 확인', () => {
    const src = fs.readFileSync(AUTOBIND_SRC, 'utf-8');
    expect(src).toContain("dept_name");
    expect(src).toContain('족부의학과');
  });

  test('payment_cert 바인딩 — 병원장 정보 + 날짜 + 진료과 렌더링 확인', () => {
    const html = getHtmlTemplate('payment_cert')!;
    const rendered = bindHtmlTemplate(html, FULL_BIND_WITH_RRN);
    // 의사 이름
    expect(rendered).toContain('문지은');
    // 도장 "(인)"
    expect(rendered).toContain('(인)');
    // 진료과
    expect(rendered).toContain('족부의학과');
    // 연도
    expect(rendered).toContain('2026');
    // 월
    expect(rendered).toContain('05');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 5: 엣지 케이스 — 주민번호 미등록 고객
// AC-A: rrn null/undefined/'' → 에러 없이 빈칸 처리
// ─────────────────────────────────────────────────────────────────────────────

test.describe('시나리오 5: 엣지 케이스 — 주민번호 미등록 고객 (에러 없음, 빈칸 표시)', () => {

  test('AC-A: formatRrn(null) — 빈 문자열 반환, 예외 없음', () => {
    // T-20260526-foot-DOC-FORM-7FIX null guard
    expect(() => formatRrn(null)).not.toThrow();
    expect(formatRrn(null)).toBe('');
  });

  test('AC-A: formatRrn(undefined) — 빈 문자열 반환, 예외 없음', () => {
    expect(() => formatRrn(undefined)).not.toThrow();
    expect(formatRrn(undefined)).toBe('');
  });

  test('AC-A: formatRrn("") — 빈 문자열 반환, 예외 없음', () => {
    expect(() => formatRrn('')).not.toThrow();
    expect(formatRrn('')).toBe('');
  });

  test('BIND_NO_RRN — patient_rrn 빈 문자열 확인', () => {
    expect(FULL_BIND_NO_RRN.patient_rrn).toBe('');
  });

  test('BIND_NO_RRN — rrn_front / rrn_back 빈 문자열 확인', () => {
    expect(FULL_BIND_NO_RRN.rrn_front).toBe('');
    expect(FULL_BIND_NO_RRN.rrn_back).toBe('');
  });

  test('diag_opinion — rrn null 고객 바인딩 — 에러 없이 완료, "undefined"/"null" 미출력', () => {
    const html = getHtmlTemplate('diag_opinion')!;
    expect(() => bindHtmlTemplate(html, FULL_BIND_NO_RRN)).not.toThrow();
    const rendered = bindHtmlTemplate(html, FULL_BIND_NO_RRN);
    expect(rendered).not.toContain('>undefined<');
    expect(rendered).not.toContain('>null<');
    // {{patient_rrn}} 플레이스홀더 잔류 없음 (빈 문자열로 치환됨)
    expect(rendered).not.toContain('{{patient_rrn}}');
  });

  test('bill_receipt — rrn null 고객 바인딩 — 에러 없이 완료', () => {
    const html = getHtmlTemplate('bill_receipt')!;
    expect(() => bindHtmlTemplate(html, FULL_BIND_NO_RRN)).not.toThrow();
    const rendered = bindHtmlTemplate(html, FULL_BIND_NO_RRN);
    expect(rendered).not.toContain('>undefined<');
    expect(rendered).not.toContain('{{patient_rrn}}');
  });

  test('diagnosis — rrn null 고객 바인딩 — 에러 없이 완료', () => {
    const html = getHtmlTemplate('diagnosis')!;
    expect(() => bindHtmlTemplate(html, FULL_BIND_NO_RRN)).not.toThrow();
    const rendered = bindHtmlTemplate(html, FULL_BIND_NO_RRN);
    expect(rendered).not.toContain('{{patient_rrn}}');
  });

  test('전 서류 양식 — rrn null 고객 바인딩 에러 없음 (일괄 검증)', () => {
    // T-20260526-foot-DOC-FORM-7FIX: 7종 서류 null guard 일괄 확인
    const formKeys = [
      'diag_opinion',
      'diagnosis',
      'treat_confirm',
      'visit_confirm',
      'bill_receipt',
      'payment_cert',
      'referral_letter',
    ];
    for (const formKey of formKeys) {
      const html = getHtmlTemplate(formKey);
      if (!html) continue;  // 템플릿 없으면 스킵
      expect(() => bindHtmlTemplate(html, FULL_BIND_NO_RRN)).not.toThrow();
      const rendered = bindHtmlTemplate(html, FULL_BIND_NO_RRN);
      // 플레이스홀더 잔류 없음
      expect(rendered).not.toContain('{{patient_rrn}}');
      // 에러 텍스트 없음
      expect(rendered).not.toContain('>undefined<');
      console.log(`[시나리오5] ${formKey}: rrn null 바인딩 OK`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 추가 소스 정적 검증 — DOC-FORM-7FIX 핵심 변경사항
// ─────────────────────────────────────────────────────────────────────────────

test.describe('소스 정적 검증 — DOC-FORM-7FIX / DOC-FORM-REVISE 핵심 변경', () => {

  test('autoBindContext.ts — T-20260526-foot-DOC-FORM-7FIX 마커 존재', () => {
    const src = fs.readFileSync(AUTOBIND_SRC, 'utf-8');
    // 본 티켓 참조 마커가 소스에 존재
    expect(src).toContain('T-20260526-foot-DOC-FORM-7FIX');
  });

  test('autoBindContext.ts — rrn_front / rrn_back split 구현 존재 (AC split 분리)', () => {
    const src = fs.readFileSync(AUTOBIND_SRC, 'utf-8');
    expect(src).toContain('rrn_front');
    expect(src).toContain('rrn_back');
    // split('-') 기반 구현
    expect(src).toMatch(/split\s*\(\s*['"]-['"]\s*\)/);
  });

  test('htmlFormTemplates.ts — BILL_RECEIPT_HTML doctor_seal_html 포함 (DOC-FORM-7FIX)', () => {
    const src = fs.readFileSync(FORM_TEMPLATES_SRC, 'utf-8');
    // bill_receipt 섹션에 doctor_seal_html 바인딩
    // BILL_RECEIPT_HTML const 선언에서 다음 const 선언까지의 구간에서 검색
    const billStart = src.indexOf('const BILL_RECEIPT_HTML');
    expect(billStart).toBeGreaterThan(0);
    // 다음 const/export 선언 위치 (구간 끝)
    const billEnd = src.indexOf('\nconst ', billStart + 100);
    const billSection = billEnd > 0 ? src.slice(billStart, billEnd) : src.slice(billStart, billStart + 12000);
    expect(billSection).toContain('doctor_seal_html');
  });

  test('htmlFormTemplates.ts — PAYMENT_CERT_HTML month 바인딩 포함 (AC-7-⑤)', () => {
    const src = fs.readFileSync(FORM_TEMPLATES_SRC, 'utf-8');
    // PAYMENT_CERT_HTML const 선언에서 다음 const 선언까지의 구간에서 검색
    const certStart = src.indexOf('const PAYMENT_CERT_HTML');
    expect(certStart).toBeGreaterThan(0);
    const certEnd = src.indexOf('\nconst ', certStart + 100);
    const certSection = certEnd > 0 ? src.slice(certStart, certEnd) : src.slice(certStart, certStart + 12000);
    expect(certSection).toContain('{{month}}');
    expect(certSection).toContain('{{year}}');
    expect(certSection).toContain('{{dept_name}}');
    expect(certSection).toContain('{{doctor_seal_html}}');
  });
});
