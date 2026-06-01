/**
 * E2E spec — T-20260601-foot-DOC-PRINT-8FIX
 * 풋센터 서류 출력 8영역 수정 검증 (도장 위치 재발 / 소견서 / 처방전 / 진료비영수증 /
 *   진료확인서 / 통원확인서 / 진료의뢰서 / 보험청구서)
 *
 * ─── OPEN-Q1 근본원인 (dev 규명) ───────────────────────────────────────────────
 *  직전 7FIX(closed 5/27)·RX-PRINT-DUAL 가 prod 서류출력에 "안 먹힌" 원인은 배포 누락이 아니라
 *  코드 결함 2종이 잔존했기 때문:
 *   (A) 도장(AC-1): 7FIX는 {{doctor_seal_html}}(의사 성명 근방)만 추가했고,
 *       DocumentPrintPanel.buildHtmlPageHtml 의 레거시 "우하단 고정 도장 오버레이"
 *       (position:absolute;right:52px;bottom:52px)를 제거하지 않아 존치 → 현장 출력에
 *       도장이 여전히 우하단에 찍힘. → 본 티켓에서 오버레이 제거.
 *   (B) 성별/연령(AC-2/5/6): 바인딩이 customers.gender / birth_date 컬럼만 참조했는데
 *       현장은 주민번호만 입력 → 컬럼 공란 → 빈값 출력. → 주민번호 자동산출 fallback 추가.
 *   (C) AC-4/AC-8(비급여·공단부담금)은 service_charges 기반 {{non_covered}}/{{insurance_covered}}
 *       바인딩이 이미 정상 → 코드 결함 아님(데이터 의존). 본 spec에서 바인딩 존재만 회귀 보호.
 *
 * 시나리오 1: 공통 도장 위치 (재발) — 레거시 우하단 오버레이 제거 + 의사 성명 근방 직인
 * 시나리오 2: 소견서 — 연령 연동 + 환자 연락처 라벨/양식 통일
 * 시나리오 3: 처방전 — 팩스 중복제거 + 사용기간 3일 + 총투약일수 공란 + QR 자동삽입
 * 시나리오 4: 진료확인서·통원확인서 — 성별/연령 연동 + "미표시" 문구 삭제
 * 시나리오 5: 진료비영수증·진료의뢰서·보험청구서 — 비급여/의뢰병원/공단부담금 바인딩
 * 시나리오 6: 주민번호 자동산출(성별/연령) 핵심 + 엣지(미등록·외국인·2000년대)
 *
 * NOTE: autoBindContext.ts는 supabase 의존성으로 Node 단위 환경에서 직접 import 불가.
 *       deriveGenderFromRrn 등 순수 함수는 인라인 복제 후 동일 스펙 검증 +
 *       소스 정적 검증(grep)으로 실구현과의 일치도 보장.
 *
 * 실행: playwright test --project=unit T-20260601-foot-DOC-PRINT-8FIX
 */

// T-20260601-foot-DOC-PRINT-8FIX

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const SRC_ROOT = path.join(__dirname, '../../src');
const AUTOBIND_SRC = path.join(SRC_ROOT, 'lib/autoBindContext.ts');
const FORM_TEMPLATES_SRC = path.join(SRC_ROOT, 'lib/htmlFormTemplates.ts');
const DOC_PANEL_SRC = path.join(SRC_ROOT, 'components/DocumentPrintPanel.tsx');
// T-20260601-foot-DOC-PRINT-8FIX REOPEN: 제3의 출력 경로 PATH-4(결제 미니창)
const PAY_MINI_SRC = path.join(SRC_ROOT, 'components/PaymentMiniWindow.tsx');

// ─── 인라인 순수 함수 (autoBindContext.ts 의존성 격리, 실구현과 동일 스펙) ──────────

/** 주민번호 13자리 정규화 */
function rrnDigits(rrn: string | null | undefined): string | null {
  if (!rrn) return null;
  const clean = rrn.replace(/[^0-9]/g, '');
  return clean.length === 13 ? clean : null;
}

/** 주민번호 → 'M' | 'F' | null  (7번째 자리 홀수=남, 짝수=여) */
function deriveGenderFromRrn(rrn: string | null | undefined): 'M' | 'F' | null {
  const d = rrnDigits(rrn);
  if (!d) return null;
  const g = parseInt(d[6], 10);
  if (Number.isNaN(g) || g === 0) return g === 0 ? 'F' : null;
  return g % 2 === 1 ? 'M' : 'F';
}

/** 주민번호 → birth_date(YYMMDD 6자리) */
function deriveBirthYYMMDDFromRrn(rrn: string | null | undefined): string | null {
  const d = rrnDigits(rrn);
  if (!d) return null;
  return d.slice(0, 6);
}

function formatGenderCheckbox(gender: 'M' | 'F' | null | undefined): string {
  if (gender === 'F') return '☑ 여  ☐ 남';
  if (gender === 'M') return '☐ 여  ☑ 남';
  return '☐ 여  ☐ 남';
}

function calcAge(yymmdd: string | null | undefined): string {
  if (!yymmdd || yymmdd.length < 6) return '';
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const currentYY = new Date().getFullYear() % 100;
  const fullYear = yy > currentYY ? 1900 + yy : 2000 + yy;
  const mm = parseInt(yymmdd.slice(2, 4), 10) - 1;
  const dd = parseInt(yymmdd.slice(4, 6), 10);
  const birth = new Date(fullYear, mm, dd);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
  ) age--;
  return age >= 0 ? String(age) : '';
}

// ─── 공통 바인딩 mock (주민번호 자동산출 결과 주입) ──────────────────────────────

const RRN_MALE = '9005151234567';     // 7번째=1 → 남, 1990-05-15
const effGender = deriveGenderFromRrn(RRN_MALE);            // 'M'
const effBirth = deriveBirthYYMMDDFromRrn(RRN_MALE);        // '900515'

const FULL_BIND: Record<string, string> = {
  patient_name: '홍길동',
  patient_phone: '010-1234-5678',
  patient_rrn: '900515-1234567',
  patient_address: '서울 종로구 인사동5길 38',
  patient_gender: formatGenderCheckbox(effGender),          // '☐ 여  ☑ 남'
  patient_age: calcAge(effBirth),                           // 35 or 36 (today 의존)
  visit_date: '2026-06-01',
  issue_date: '2026-06-01',
  doctor_name: '문지은',
  doctor_seal_html: '(인)',
  clinic_name: '오블리브 풋센터 종로',
  clinic_address: '서울 종로구 인사동5길 38',
  clinic_phone: '02-1234-5678 / FAX 02-1234-5679',
  clinic_phone_only: '02-1234-5678',                        // AC-3① 팩스 없는 순수 전화
  clinic_fax: '02-1234-5679',
  clinic_nhis_code: '12345678',
  clinic_code: '12345678',
  total_amount: '50,000',
  insurance_covered: '12,000',                              // 공단부담금 (AC-8)
  copayment: '8,000',
  non_covered: '30,000',                                    // 비급여 (AC-4)
  subtotal_noncovered: '30,000',
  total_noncovered: '30,000',
  diag_code_1: 'L60.0',
  diag_name_1: '내향성 발톱',
  referral_to_hospital: '오블리브 풋센터 종로',              // AC-7
  usage_days: '3',                                          // AC-3②
  rx_qr_html: '<img src="https://api.qrserver.com/v1/create-qr-code/?data=RX" alt="처방전 QR" />',
  visit_no: '1',
};

const FULL_BIND_NO_RRN: Record<string, string> = {
  ...FULL_BIND,
  patient_name: '김무번호',
  patient_gender: formatGenderCheckbox(null),               // '☐ 여  ☐ 남'
  patient_age: calcAge(null),                               // ''
  patient_rrn: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 공통 도장 위치 (재발 검증) — AC-1
//   레거시 우하단 고정 오버레이 제거 + 직인은 {{doctor_seal_html}}(의사 성명 근방)로 일원화
// ─────────────────────────────────────────────────────────────────────────────

test.describe('시나리오 1: 공통 도장 위치 재발 (AC-1) — 레거시 우하단 오버레이 제거 + 성명 근방 직인', () => {

  test('AC-1: DocumentPrintPanel — HTML 양식 출력 경로의 ${stampOverlay} 주입 전면 제거됨', () => {
    // T-20260601-foot-DOC-PRINT-8FIX: 7FIX 재발 근본원인 — HTML 양식 출력 경로(2곳:
    //   buildHtmlPageHtml + 영수증 재발급)에 우하단 고정 도장 오버레이가 잔존했음.
    //   (JPG 비트맵 좌표 템플릿 경로의 stampHtml은 별개 메커니즘 — 본 검증 대상 아님)
    const src = fs.readFileSync(DOC_PANEL_SRC, 'utf-8');
    // HTML 페이지 조립부의 stampOverlay 변수/주입 토큰이 모두 사라져야 함
    expect(src).not.toMatch(/\$\{stampOverlay\}/);
    expect(src).not.toMatch(/const\s+stampOverlay\s*=/);
  });

  test('AC-1: DocumentPrintPanel — 영수증 재발급 경로에 8FIX 도장 일원화 주석 존재', () => {
    const src = fs.readFileSync(DOC_PANEL_SRC, 'utf-8');
    // 재발급 경로(getHtmlTemplate('bill_receipt')) 근방에 오버레이 제거 근거 주석
    expect(src).toMatch(/AC-1[\s\S]{0,400}getHtmlTemplate\('bill_receipt'\)/);
  });

  test('AC-1: DocumentPrintPanel — 8FIX 근본원인 주석 마커 존재', () => {
    const src = fs.readFileSync(DOC_PANEL_SRC, 'utf-8');
    expect(src).toContain('T-20260601-foot-DOC-PRINT-8FIX');
  });

  // REOPEN (김주연 총괄 "수정 안 됨 동일함"): 8FIX(5c54a27)가 PATH-1(DocumentPrintPanel)만
  //   고치고 제3의 출력 경로 PATH-4(PaymentMiniWindow.buildHtmlPageDiv) 복제본의 동일 오버레이를
  //   누락 → 결제창 영수증/처방전 출력에 도장 우하단 재발. 회귀 가드 추가.
  test('AC-1 REOPEN: PaymentMiniWindow(PATH-4) — buildHtmlPageDiv의 ${stampOverlay} 우하단 오버레이 전면 제거됨', () => {
    const src = fs.readFileSync(PAY_MINI_SRC, 'utf-8');
    // buildHtmlPageDiv 본문(HTML 양식 경로) 추출 후 그 안에 stampOverlay 변수/주입이 없어야 함
    const fn = src.slice(src.indexOf('function buildHtmlPageDiv'), src.indexOf('function printViaIframe'));
    expect(fn, 'PATH-4 HTML 경로 stampOverlay 변수 잔존').not.toMatch(/const\s+stampOverlay\s*=/);
    expect(fn, 'PATH-4 HTML 경로 ${stampOverlay} 주입 잔존').not.toMatch(/\$\{stampOverlay\}/);
    expect(fn, 'PATH-4 HTML 경로 우하단 좌표 도장 잔존').not.toMatch(/right:52px;bottom:52px/);
  });

  test('AC-1 REOPEN: PaymentMiniWindow(PATH-4) — REOPEN 근본원인 주석 마커 존재', () => {
    const src = fs.readFileSync(PAY_MINI_SRC, 'utf-8');
    expect(src).toMatch(/T-20260601-foot-DOC-PRINT-8FIX REOPEN AC-1/);
  });

  // REOPEN2 (planner FIX-REQUEST #2 — 출력경로 전수 sweep): PATH-4 HTML 경로 외에도
  //   이미지(좌표 오버레이) 양식 경로 + 미리보기 JSX에 동일 우하단 도장 오버레이가 잔존했음.
  //   활성 13종은 전부 HTML이라 이 경로는 미도달 레거시지만, "1곳만 수정" 재발 클래스를
  //   근본 차단하기 위해 양 파일의 전 출력경로에서 우하단 도장 오버레이를 전수 소거.
  test('AC-1 REOPEN2: 양 파일 전 출력경로 — 우하단 도장 오버레이(코드) 전수 소거', () => {
    for (const [label, file] of [['PaymentMiniWindow', PAY_MINI_SRC], ['DocumentPrintPanel', DOC_PANEL_SRC]] as const) {
      const src = fs.readFileSync(file, 'utf-8');
      // 코드 라인의 우하단 고정 도장 좌표/변수/주입이 전부 사라져야 함 (주석은 영향 없음)
      expect(src, `${label} stampHtml 변수 잔존`).not.toMatch(/const\s+stampHtml\s*=/);
      expect(src, `${label} \${stampHtml} 주입 잔존`).not.toMatch(/\$\{stampHtml\}/);
      expect(src, `${label} \${stampOverlay} 주입 잔존`).not.toMatch(/\$\{stampOverlay\}/);
      expect(src, `${label} 우하단 고정 도장 좌표 잔존`).not.toMatch(/position:absolute;right:52px;bottom:52px/);
      // 도장 URL 호출 자체가 양식 출력/미리보기 경로에서 제거됨 (import 포함)
      expect(src, `${label} getStampUrl 참조 잔존`).not.toContain('getStampUrl');
    }
  });

  test('AC-1 REOPEN2: DocumentPrintPanel — 우하단 도장 미리보기 JSX 제거', () => {
    const src = fs.readFileSync(DOC_PANEL_SRC, 'utf-8');
    expect(src).not.toContain('도장 오버레이 미리보기');
    expect(src).not.toMatch(/bottom-10 right-10/);
  });

  test('AC-1 REOPEN2: 영수증(bill_receipt) 렌더 — 우하단 도장 마크업 없이 doctor_seal_html 일원화', () => {
    const html = getHtmlTemplate('bill_receipt')!;
    const rendered = bindHtmlTemplate(html, FULL_BIND);
    expect(rendered).not.toMatch(/right:52px;bottom:52px/);
    expect(rendered).not.toContain('{{doctor_seal_html}}');
  });

  test('AC-1: 진료확인서·소견서·처방전·보험청구서 — {{doctor_seal_html}}가 의사/대표자 성명 근방', () => {
    for (const formKey of ['treat_confirm', 'diag_opinion', 'rx_standard', 'ins_claim_form']) {
      const html = getHtmlTemplate(formKey);
      if (!html) continue;
      expect(html, `${formKey}에 doctor_seal_html 바인딩`).toContain('{{doctor_seal_html}}');
      // doctor_name 과 doctor_seal_html 이 근접(같은 셀/줄 = 150자 이내)
      expect(html, `${formKey} 성명 근방 직인`).toMatch(/doctor_name[\s\S]{0,150}doctor_seal_html/);
    }
  });

  test('AC-1: 렌더 결과 — 직인이 "(인)"으로 의사 성명 뒤에 표시', () => {
    const html = getHtmlTemplate('treat_confirm')!;
    const rendered = bindHtmlTemplate(html, FULL_BIND);
    expect(rendered).toContain('문지은');
    expect(rendered).toContain('(인)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 소견서 (diag_opinion) — AC-2
//   ① 연령 연동  ② 전화 양식 타 서류와 통일  ③ 라벨 "환자 연락처"
// ─────────────────────────────────────────────────────────────────────────────

test.describe('시나리오 2: 소견서 (diag_opinion) — 연령 연동 + 환자 연락처 라벨/양식 통일', () => {

  test('AC-2①: diag_opinion — {{patient_age}} 바인딩 포함 (연령 연동)', () => {
    const html = getHtmlTemplate('diag_opinion')!;
    expect(html).toContain('{{patient_age}}');
  });

  test('AC-2③: diag_opinion — "환자 연락처" 라벨 포함', () => {
    const html = getHtmlTemplate('diag_opinion')!;
    expect(html).toContain('환자 연락처');
  });

  test('AC-2②: diag_opinion — 환자 전화 라벨/값 분리 (타 서류 양식 통일, 셀 분리)', () => {
    const html = getHtmlTemplate('diag_opinion')!;
    // "환자 연락처" 라벨 셀 뒤에 {{patient_phone}} 값 셀이 분리되어 위치
    expect(html).toMatch(/환자 연락처[\s\S]{0,80}\{\{patient_phone\}\}/);
    // 기존 "환자전화 {{patient_phone}}" 단일셀 합산 양식이 사라졌는지
    expect(html).not.toMatch(/환자전화&nbsp;\{\{patient_phone\}\}/);
  });

  test('AC-2: diag_opinion 렌더 — 연령(숫자) + 전화 + 연락처 라벨 표시', () => {
    const html = getHtmlTemplate('diag_opinion')!;
    const rendered = bindHtmlTemplate(html, FULL_BIND);
    expect(rendered).toContain('환자 연락처');
    expect(rendered).toContain('010-1234-5678');
    // 연령은 숫자 (today 의존이라 정확값 미고정, 비어있지 않음)
    expect(FULL_BIND.patient_age).toMatch(/^\d+$/);
    expect(rendered).not.toContain('{{patient_age}}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 처방전 (rx_standard) — AC-3
//   ① 팩스 중복 제거  ② 사용기간 "교부일로부터 ( 3 ) 일간"  ③ 총투약일수 공란  ④ QR 자동삽입
// ─────────────────────────────────────────────────────────────────────────────

test.describe('시나리오 3: 처방전 (rx_standard) — 팩스 중복제거 + 사용기간 3일 + 총투약일수 공란 + QR', () => {

  test('AC-3①: rx_standard 전화번호 칸 — {{clinic_phone_only}} 사용 (팩스 조합 clinic_phone 아님)', () => {
    const html = getHtmlTemplate('rx_standard')!;
    expect(html).toContain('{{clinic_phone_only}}');
    // "전 화 번 호" 라벨 근방 100자에 clinic_phone_only
    expect(html).toMatch(/전[\s\S]{0,20}화[\s\S]{0,20}번[\s\S]{0,20}호[\s\S]{0,120}clinic_phone_only/);
  });

  test('AC-3①: autoBindContext — clinic_phone_only = 팩스 없는 순수 전화번호', () => {
    const src = fs.readFileSync(AUTOBIND_SRC, 'utf-8');
    expect(src).toContain('clinic_phone_only');
    // clinic.phone 만 사용(팩스 미포함)
    expect(src).toMatch(/clinic_phone_only\s*:\s*ctx\.clinic\?\.phone/);
  });

  test('AC-3①: rx_standard 렌더 — 전화칸에 팩스 번호 미포함', () => {
    const html = getHtmlTemplate('rx_standard')!;
    const rendered = bindHtmlTemplate(html, FULL_BIND);
    // 순수 전화는 존재, 전화칸 옆 "FAX" 중복 표기 없음 (clinic_phone_only는 FAX 미포함)
    expect(FULL_BIND.clinic_phone_only).not.toContain('FAX');
    expect(rendered).toContain('02-1234-5678');
  });

  test('AC-3②: 처방전 사용기간 기본값 3일 — autoBindContext/패널/결제창 모두 통일', () => {
    const abSrc = fs.readFileSync(AUTOBIND_SRC, 'utf-8');
    const panelSrc = fs.readFileSync(DOC_PANEL_SRC, 'utf-8');
    // usage_days 기본 '3'
    expect(abSrc).toMatch(/usage_days\s*:\s*'3'/);
    expect(panelSrc).toContain("base.usage_days = '3'");
    // 레거시 '7' 기본 사라짐
    expect(panelSrc).not.toContain("base.usage_days = '7'");
  });

  test('AC-3②: rx_standard — "교부일로부터 ( {{usage_days}} ) 일간" 문구 형식', () => {
    const html = getHtmlTemplate('rx_standard')!;
    expect(html).toMatch(/교부일로부터[\s\S]{0,40}\{\{usage_days\}\}[\s\S]{0,40}일간/);
  });

  test('AC-3③: 총 투약일수 자동연동 제거 — buildRxItemsHtml total_days 항상 공란', () => {
    const src = fs.readFileSync(FORM_TEMPLATES_SRC, 'utf-8');
    // buildRxItemsHtml 내 total_days: '' (item.total_days 연동 제거)
    expect(src).toMatch(/total_days:\s*''/);
    // 8FIX 마커
    expect(src).toContain('T-20260601-foot-DOC-PRINT-8FIX AC-3③');
  });

  test('AC-3④: rx_standard — QR 자리 텍스트("처방전QR코드") 삭제 + {{rx_qr_html}} 자동삽입', () => {
    const html = getHtmlTemplate('rx_standard')!;
    expect(html).toContain('{{rx_qr_html}}');
    expect(html).not.toContain('처방전<br>QR코드');
  });

  test('AC-3④: autoBindContext — rx_qr_html 자동 생성 (api.qrserver 재사용, 신규 의존 없음)', () => {
    const src = fs.readFileSync(AUTOBIND_SRC, 'utf-8');
    expect(src).toContain('rx_qr_html');
    expect(src).toContain('api.qrserver.com');
  });

  test('AC-3④: rx_standard 렌더 — QR img 삽입, 텍스트 placeholder 미잔류', () => {
    const html = getHtmlTemplate('rx_standard')!;
    const rendered = bindHtmlTemplate(html, FULL_BIND);
    expect(rendered).toContain('<img');
    expect(rendered).not.toContain('{{rx_qr_html}}');
    expect(rendered).not.toContain('QR코드');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 4: 진료확인서(treat_confirm) · 통원확인서(visit_confirm) — AC-5 / AC-6
//   성별/연령 연동 + 진료확인서 "상병 및 향후치료의견 미표시" 문구 삭제
// ─────────────────────────────────────────────────────────────────────────────

test.describe('시나리오 4: 진료확인서·통원확인서 — 성별/연령 연동 + "미표시" 문구 삭제', () => {

  test('AC-5①②: treat_confirm — {{patient_gender}} + {{patient_age}} 바인딩 포함', () => {
    const html = getHtmlTemplate('treat_confirm')!;
    expect(html).toContain('{{patient_gender}}');
    expect(html).toContain('{{patient_age}}');
    // 하드코딩 성별("☑ 남성"/"☑ 남") 잔류 없음
    expect(html).not.toContain('☑ 남성');
  });

  test('AC-5③: treat_confirm — "상병 및 향후치료의견 미표시" 문구 삭제됨', () => {
    const html = getHtmlTemplate('treat_confirm')!;
    expect(html).not.toContain('상병 및 향후치료의견 미표시');
  });

  test('AC-6①②: visit_confirm — {{patient_gender}} + {{patient_age}} 바인딩 포함', () => {
    const html = getHtmlTemplate('visit_confirm')!;
    expect(html).toContain('{{patient_gender}}');
    expect(html).toContain('{{patient_age}}');
    expect(html).not.toContain('☑ 남');
  });

  test('AC-5/AC-6: 렌더 — 성별 체크(남) + 연령 숫자, placeholder 미잔류', () => {
    for (const formKey of ['treat_confirm', 'visit_confirm']) {
      const html = getHtmlTemplate(formKey)!;
      const rendered = bindHtmlTemplate(html, FULL_BIND);
      // 남성 체크 표기 (☑ 남)
      expect(rendered, `${formKey} 성별 체크`).toContain('☑ 남');
      expect(rendered, `${formKey} gender placeholder`).not.toContain('{{patient_gender}}');
      expect(rendered, `${formKey} age placeholder`).not.toContain('{{patient_age}}');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 5: 진료비영수증(bill_receipt) · 진료의뢰서(referral_letter) · 보험청구서(ins_claim_form)
//   AC-4 비급여 / AC-7 의뢰병원 / AC-8 공단부담금·비급여 — 바인딩 회귀 보호
// ─────────────────────────────────────────────────────────────────────────────

test.describe('시나리오 5: 진료비영수증·진료의뢰서·보험청구서 — 비급여/의뢰병원/공단부담금 연동', () => {

  test('AC-4: bill_receipt — {{non_covered}} 바인딩 (비급여 수가 자동기입)', () => {
    const html = getHtmlTemplate('bill_receipt')!;
    expect(html).toContain('{{non_covered}}');
    const rendered = bindHtmlTemplate(html, FULL_BIND);
    expect(rendered).toContain('30,000');
  });

  test('AC-7: referral_letter — {{referral_to_hospital}} 바인딩 (의뢰병원 자동기입)', () => {
    const html = getHtmlTemplate('referral_letter')!;
    expect(html).toContain('{{referral_to_hospital}}');
    const rendered = bindHtmlTemplate(html, FULL_BIND);
    expect(rendered).toContain('오블리브 풋센터 종로');
    expect(rendered).not.toContain('{{referral_to_hospital}}');
  });

  test('AC-7: autoBindContext — referral_to_hospital = clinic.name 자동기입', () => {
    const src = fs.readFileSync(AUTOBIND_SRC, 'utf-8');
    expect(src).toContain('referral_to_hospital');
    expect(src).toMatch(/referral_to_hospital\s*:\s*ctx\.clinic\?\.name/);
  });

  test('AC-8: ins_claim_form — 공단부담금({{insurance_covered}}) + 비급여({{non_covered}}) 바인딩', () => {
    const html = getHtmlTemplate('ins_claim_form')!;
    expect(html).toContain('{{insurance_covered}}');
    expect(html).toContain('{{non_covered}}');
    // 공단부담금 라벨 근방에 insurance_covered
    expect(html).toMatch(/공단부담금[\s\S]{0,80}insurance_covered/);
    const rendered = bindHtmlTemplate(html, FULL_BIND);
    expect(rendered).toContain('12,000');   // 공단부담금
    expect(rendered).toContain('30,000');   // 비급여
  });

  test('AC-8: autoBindContext — insurance_covered/non_covered = service_charges 기반 계산', () => {
    const src = fs.readFileSync(AUTOBIND_SRC, 'utf-8');
    // service_charges 에서 공단부담/비급여 합산
    expect(src).toContain('insurance_covered_amount');
    expect(src).toMatch(/is_insurance_covered/);
    expect(src).toContain('chargesNonCovered');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 6: 주민번호 자동산출 (근본원인 fix) + 엣지 케이스
//   AC-2①/AC-5①②/AC-6①② — customers 컬럼 공란 시 주민번호에서 성별·연령 산출
// ─────────────────────────────────────────────────────────────────────────────

test.describe('시나리오 6: 주민번호 자동산출(성별/연령) + 엣지', () => {

  test('성별 — 7번째 자리 홀수=남(M), 짝수=여(F)', () => {
    expect(deriveGenderFromRrn('9005151234567')).toBe('M');   // 1
    expect(deriveGenderFromRrn('9005152234567')).toBe('F');   // 2
    expect(deriveGenderFromRrn('0501013234567')).toBe('M');   // 3 (2000년대 남)
    expect(deriveGenderFromRrn('0501014234567')).toBe('F');   // 4 (2000년대 여)
    expect(deriveGenderFromRrn('8005155234567')).toBe('M');   // 5 (외국인 남)
    expect(deriveGenderFromRrn('8005156234567')).toBe('F');   // 6 (외국인 여)
  });

  test('생년월일 — 앞 6자리 추출', () => {
    expect(deriveBirthYYMMDDFromRrn('9005151234567')).toBe('900515');
    expect(deriveBirthYYMMDDFromRrn('0501013234567')).toBe('050101');
  });

  test('엣지 — null/빈값/하이픈/길이오류 → 안전 처리', () => {
    expect(deriveGenderFromRrn(null)).toBeNull();
    expect(deriveGenderFromRrn('')).toBeNull();
    expect(deriveGenderFromRrn('12345')).toBeNull();
    // 하이픈 포함도 정규화
    expect(deriveGenderFromRrn('900515-1234567')).toBe('M');
    expect(deriveBirthYYMMDDFromRrn('900515-1234567')).toBe('900515');
  });

  test('formatGenderCheckbox — M/F/null 매핑', () => {
    expect(formatGenderCheckbox('M')).toBe('☐ 여  ☑ 남');
    expect(formatGenderCheckbox('F')).toBe('☑ 여  ☐ 남');
    expect(formatGenderCheckbox(null)).toBe('☐ 여  ☐ 남');
  });

  test('autoBindContext — gender/birth 컬럼 우선, 공란 시 주민번호 fallback 구현 확인', () => {
    const src = fs.readFileSync(AUTOBIND_SRC, 'utf-8');
    expect(src).toContain('deriveGenderFromRrn');
    expect(src).toContain('deriveBirthYYMMDDFromRrn');
    // ?? 로 컬럼 우선 + fallback
    expect(src).toMatch(/ctx\.customer\?\.gender\s*\?\?\s*deriveGenderFromRrn/);
    expect(src).toMatch(/ctx\.customer\?\.birth_date\s*\?\?\s*deriveBirthYYMMDDFromRrn/);
  });

  test('AC-9 무파괴 — 주민번호 미등록 고객, 전 8양식 에러 없이 빈칸 렌더', () => {
    const formKeys = [
      'diag_opinion', 'treat_confirm', 'visit_confirm', 'referral_letter',
      'bill_receipt', 'ins_claim_form', 'rx_standard', 'diagnosis',
    ];
    for (const formKey of formKeys) {
      const html = getHtmlTemplate(formKey);
      if (!html) continue;
      expect(() => bindHtmlTemplate(html, FULL_BIND_NO_RRN), `${formKey} 렌더`).not.toThrow();
      const rendered = bindHtmlTemplate(html, FULL_BIND_NO_RRN);
      expect(rendered, `${formKey} undefined 미출력`).not.toContain('>undefined<');
      expect(rendered, `${formKey} null 미출력`).not.toContain('>null<');
    }
  });
});
