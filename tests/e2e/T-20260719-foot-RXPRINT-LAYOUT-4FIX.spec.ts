/**
 * E2E spec — T-20260719-foot-RXPRINT-LAYOUT-4FIX
 * 풋 처방전(rx_standard) 서식 4-fix (김주연 총괄 풋센터 현장 피드백)
 *
 * AC-①: 좌측 상단 고객정보 과다노출 블록(환자정보/성명/생년월일/주민번호/연락처/주소) 삭제.
 *        단, 하단 정식 요양급여 서식표의 법정 필수 성명·주민번호(의료법 시행규칙 §12)는 존치.
 *        처방의료인 성명·면허번호(RX-DOCTOR-BIND 실사고 수정분) 회귀 금지.
 * AC-②: 환자 성명/주민번호 기입칸 아래 빈 여백(빈 tr) 제거 — 주민번호 셀 rowspan=2 로 채움.
 * AC-③: 질병분류기호 = 결제미니창 선택 상병코드 바인딩(diag_code_N). 미선택 시 공란 폴백.
 * AC-④: '조제시 참고사항' 기입란 좌측 확장(비율 정합) — 독립 테이블 table-layout:fixed 재분배.
 *
 * 바인딩(템플릿) 레벨 단위 테스트. AC-③ 데이터 소스 폴백(service_charges→check_in_services)은
 * DocumentPrintPanel/PaymentMiniWindow 컴포넌트 로직(read-path)이며, 본 스펙은 diag_code_N 이
 * 질병분류기호 셀에 정상 렌더/공란됨을 보증한다(주입 소스 무관 동일 렌더).
 */
import { test, expect } from '@playwright/test';
import { bindHtmlTemplate, getHtmlTemplate } from '../../src/lib/htmlFormTemplates';

// 상단 헤더에만 존재하던 고객정보 값(삭제 대상) — 렌더 결과에 절대 나타나면 안 됨.
// PHI 스캔 회피 위해 실제 phone/생년월일/주소 형식 대신 비-PHI 센티넬 사용(존재/부재 판정에 형식 불요).
const HEADER_ONLY_PHONE = 'HDRPHONE-SENTINEL';
const HEADER_ONLY_BIRTH = 'HDRBIRTH-SENTINEL';
const HEADER_ONLY_ADDR = 'HDRADDR-SENTINEL';

// 하단 정식 요양급여 서식표 법정 필수 필드(존치) + 처방의료인(회귀가드) — 모두 비-PHI 센티넬.
const PATIENT_NAME = 'PATIENTNAME-SENTINEL';
const PATIENT_RRN = 'RRN-SENTINEL-0001';
const PRESCRIBER_NAME = 'PRESCRIBER-SENTINEL';
const PRESCRIBER_LICENSE = 'LIC-SENTINEL-0001';

const baseRxValues = (): Record<string, string> => ({
  record_no: 'F-4885',
  patient_name: PATIENT_NAME,
  patient_rrn: PATIENT_RRN,
  patient_birthdate: HEADER_ONLY_BIRTH,
  patient_phone: HEADER_ONLY_PHONE,
  patient_address: HEADER_ONLY_ADDR,
  prescriber_name: PRESCRIBER_NAME,
  prescriber_license_no: PRESCRIBER_LICENSE,
  doctor_seal_html: '(인)',
  rx_qr_html: '',
  rx_copy_label: '약국보관용',
  clinic_code: '13328581',
  clinic_phone_only: '02-6956-3438',
  clinic_fax: '02-6956-3439',
  clinic_email: 'official@oblivseoul.kr',
  hira_institution_name: '오블리브의원 서울오리진점',
  issue_date: '20260719',
  issue_no: '000001',
  usage_days: '3',
  rx_items_html: '',
  diag_code_1: '',
  diag_name_1: '',
  diag_code_2: '',
  diag_name_2: '',
  diag_code_3: '',
  diag_name_3: '',
  diag_code_4: '',
  diag_name_4: '',
  diag_row_3_style: 'display:none',
  diag_row_4_style: 'display:none',
  diag_extra_codes_html: '',
});

// ── AC-①: 상단 고객정보 블록 삭제 ────────────────────────────────────────────

test('AC-① 상단 고객정보 과다노출 블록(생년월일/연락처/주소) 미렌더', () => {
  const tpl = getHtmlTemplate('rx_standard');
  expect(tpl).toBeTruthy();
  const html = bindHtmlTemplate(tpl!, baseRxValues());

  // 헤더 라벨 삭제 확인
  expect(html).not.toContain('환자정보');
  expect(html).not.toContain('생년월일');
  expect(html).not.toContain('연 락 처');
  // 헤더에만 있던 값(생년월일/연락처/주소) 미노출
  expect(html).not.toContain(HEADER_ONLY_PHONE);
  expect(html).not.toContain(HEADER_ONLY_BIRTH);
  expect(html).not.toContain(HEADER_ONLY_ADDR);
});

test('AC-① 회귀가드: 법정 필수(성명·주민번호) + 처방의료인(성명·면허) 존치', () => {
  const tpl = getHtmlTemplate('rx_standard');
  const html = bindHtmlTemplate(tpl!, baseRxValues());

  // 하단 정식 요양급여 서식표 법정 필수 기재(의료법 시행규칙 §12) — 존치
  expect(html).toContain(PATIENT_NAME);
  expect(html).toContain(PATIENT_RRN);
  // 처방의료인 성명·면허번호(RX-DOCTOR-BIND 약국반려 실사고 수정분) — 회귀 금지
  expect(html).toContain(PRESCRIBER_NAME);
  expect(html).toContain(PRESCRIBER_LICENSE);
  // 처방전 제목·요양기관기호 유지
  expect(html).toContain('처'); // 처방전 제목
  expect(html).toContain('요양기관기호');
});

// ── AC-②: 성명/주민번호 하단 빈 여백 제거 ────────────────────────────────────

test('AC-② 주민번호 셀 rowspan=2 로 하단 빈 여백 제거 + E-mail 행 존치', () => {
  const tpl = getHtmlTemplate('rx_standard')!;
  // 원본 템플릿 문자열에서 빈 여백을 만들던 이중 빈 td 시퀀스가 제거됐는지(구조) 확인
  const raw = tpl;
  // 주민번호 라벨/값이 rowspan=2 로 확장됨
  expect(raw).toMatch(/rowspan="2"[^>]*>주\S*민\S*번\S*호/);
  // E-mail 주소 행은 여전히 존재
  const html = bindHtmlTemplate(tpl, baseRxValues());
  expect(html).toContain('E-mail');
  expect(html).toContain('official@oblivseoul.kr');
  expect(html).toContain('02-6956-3439'); // 팩스번호 행 정합
  // 구 빈-여백 셀(성명/주민번호 아래 <td></td><td></td>) 시퀀스 부재
  expect(raw).not.toMatch(/<td><\/td>\s*<td><\/td>\s*<td[^>]*>E-mail/);
});

// ── AC-③: 질병분류기호 = 선택 상병코드 바인딩 ───────────────────────────────

test('AC-③ 질병분류기호에 선택 상병코드(diag_code_1) 렌더', () => {
  const tpl = getHtmlTemplate('rx_standard')!;
  const values = {
    ...baseRxValues(),
    diag_code_1: 'L60.0',
    diag_name_1: '내향성 발톱',
  };
  const html = bindHtmlTemplate(tpl, values);
  expect(html).toContain('질병분류기호');
  expect(html).toContain('L60.0'); // 결제미니창 선택 상병코드 반영
});

test('AC-③ 폴백: 상병코드 미선택 시 질병분류기호 공란(오류/잔여토큰 없음)', () => {
  const tpl = getHtmlTemplate('rx_standard')!;
  const html = bindHtmlTemplate(tpl, baseRxValues()); // diag_code_* 모두 ''
  expect(html).toContain('질병분류기호');
  // 상병코드 값이 없으므로 임의 코드가 찍히지 않음
  expect(html).not.toContain('L60.0');
  // 미치환 토큰 잔존 금지(공란 렌더)
  expect(html).not.toContain('{{diag_code_1}}');
});

// ── AC-④: 조제시 참고사항 좌측 확장 ─────────────────────────────────────────

test('AC-④ 조제시 참고사항 테이블 폭 재분배(table-layout:fixed) + 라벨 존치', () => {
  const tpl = getHtmlTemplate('rx_standard')!;
  const html = bindHtmlTemplate(tpl, baseRxValues());
  // ⑥ 주사제/조제시 참고사항 테이블에 fixed 레이아웃 적용 → 기입란 좌측 확장
  expect(tpl).toContain('table-layout:fixed');
  // 주사제 처방내역 폭 재조정(360px) 마커
  expect(tpl).toContain('width:360px');
  // 라벨·문구 존치(회귀가드)
  expect(html).toContain('조제시');
  expect(html).toContain('참고사항');
  expect(html).toContain('주사제');
});
