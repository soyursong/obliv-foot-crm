/**
 * E2E(unit) spec — T-20260808-foot-FOREIGNER-NONCOVERED-CONSENT-FORM
 * 외국인 비급여 진료 동의서 신규 양식 — 서류 발행 화면 동의서 섹션 추가.
 *
 * 구현: 기존 비급여 동의서(서류 발행 화면 HTML 템플릿 + form_templates seed)와 동일 방식. 순수 ADDITIVE.
 *   - 날짜(issue_date)=오늘 자동 / 성명(patient_name)=대상 환자 자동 / 서명=수기(빈칸, 인쇄 후 손서명)
 *   - 국·영문 병기 5개 조항 확정본 전량 렌더
 *   - '동의서' 그룹으로 서류 목록 노출
 *
 * AC1: 서류 발행 화면 동의서 섹션에 외국인 비급여 진료 동의서가 신규 노출된다.
 *      → DOCLIST_ORDER_10 화이트리스트 등록 + groupDocList '동의서' 그룹 귀속 + FORM_META/FALLBACK 정합.
 * AC2: 날짜=오늘, 성명=대상 환자명 자동 반영. 서명란 수기(빈칸).
 *      → 템플릿 {{issue_date}}/{{patient_name}} 바인딩 + 서명셀 값 미바인딩(빈칸).
 * AC3: 5개 조항 확정본이 국·영문 병기로 전량 렌더된다.
 * AC4: 기존 서류/동의서 발행에 회귀 없음(ADDITIVE only) — 기존 form_key/HTML 무접촉.
 *
 * NOTE: htmlFormTemplates / formTemplates 는 supabase 의존성 없어 unit(auth·server 불요)로 직접 import.
 * 실행: playwright test --project=unit T-20260808-foot-FOREIGNER-NONCOVERED-CONSENT-FORM
 */
import { test, expect } from '@playwright/test';
import { getHtmlTemplate, bindHtmlTemplate, isHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import {
  FORM_META,
  FALLBACK_TEMPLATES,
  DOCLIST_ORDER_10,
  DOC_CATEGORY_CONSENT_KEYS,
  DOC_GROUP_LABEL_CONSENT,
  groupDocList,
} from '../../src/lib/formTemplates';

const FORM_KEY = 'foreigner_noncovered_consent';

test.describe('T-20260808 FOREIGNER-NONCOVERED-CONSENT-FORM — 외국인 비급여 진료 동의서', () => {

  // ── AC1: 서류 목록/동의서 섹션 노출 배선 ───────────────────────────────
  test('AC1 — 서류 목록 화이트리스트 + FORM_META + FALLBACK 정합', () => {
    // DOCLIST_ORDER_10 화이트리스트에 등록 (목록 노출 발동 조건)
    expect(DOCLIST_ORDER_10).toContain(FORM_KEY);
    // FORM_META 메타 존재
    expect(FORM_META[FORM_KEY]).toBeTruthy();
    expect(FORM_META[FORM_KEY].print_preset).toBe('optional');
    // FALLBACK_TEMPLATES (빈 DB/프리뷰 정합) 존재 + html
    const fb = FALLBACK_TEMPLATES.find((t) => t.form_key === FORM_KEY);
    expect(fb).toBeTruthy();
    expect(fb!.template_format).toBe('html');
    expect(fb!.name_ko).toBe('외국인 비급여 진료 동의서');
    expect(fb!.active).toBe(true);
    // 서명 자동캡처 아님(수기) → requires_signature=false
    expect(fb!.requires_signature).toBe(false);
    // field_map = 자동채움 2필드(성명·발행일)만. 서명 필드 없음(수기 빈칸).
    const keys = (fb!.field_map ?? []).map((f) => f.key);
    expect(keys).toContain('patient_name');
    expect(keys).toContain('issue_date');
    expect(keys).not.toContain('signature');
  });

  test('AC1 — groupDocList "동의서" 그룹으로 귀속', () => {
    expect(DOC_CATEGORY_CONSENT_KEYS).toContain(FORM_KEY);
    expect(DOC_GROUP_LABEL_CONSENT).toBe('동의서');
    const groups = groupDocList(FALLBACK_TEMPLATES);
    const consentGroup = groups.find((g) => g.label === '동의서');
    expect(consentGroup).toBeTruthy();
    expect(consentGroup!.templates.map((t) => t.form_key)).toContain(FORM_KEY);
  });

  // ── HTML 템플릿 등록 ──────────────────────────────────────────────────
  test('HTML 템플릿 등록 확인 (getHtmlTemplate/isHtmlTemplate)', () => {
    expect(isHtmlTemplate(FORM_KEY)).toBe(true);
    const html = getHtmlTemplate(FORM_KEY);
    expect(html).toBeTruthy();
    expect(html!.length).toBeGreaterThan(200);
  });

  // ── AC2: 날짜/성명 자동 + 서명 수기(빈칸) ─────────────────────────────
  test('AC2 — 날짜(issue_date)·성명(patient_name) 자동 바인딩 / 서명 빈칸', async ({ page }) => {
    const html = getHtmlTemplate(FORM_KEY)!;
    const bound = bindHtmlTemplate(html, {
      issue_date: '2026-08-09',
      patient_name: 'John Smith',
      clinic_name: '종로 오블리브 풋케어',
    });
    await page.setContent(bound);

    // 날짜=오늘, 성명=환자명 렌더
    await expect(page.getByText('2026-08-09')).toBeVisible();
    await expect(page.getByText('John Smith')).toBeVisible();

    // 서명 라벨 존재하되 값은 빈칸(수기) — 서명셀에 자동 반영 텍스트 없음
    await expect(page.getByText('서명 / Signature')).toBeVisible();
    const sigCellText = await page.locator('.fnc-sig-cell').first().innerText();
    expect(sigCellText.trim()).toBe('');
  });

  test('AC2 — 성명이 영문/특수문자여도 정상 반영 (엣지)', async ({ page }) => {
    const html = getHtmlTemplate(FORM_KEY)!;
    const bound = bindHtmlTemplate(html, {
      issue_date: '2026-08-09',
      patient_name: "O'Brien-李 (외국인)",
    });
    await page.setContent(bound);
    // HTML 이스케이프 후에도 텍스트로 정상 표시
    await expect(page.getByText("O'Brien-李 (외국인)")).toBeVisible();
  });

  // ── AC3: 5개 조항 국·영문 병기 전량 렌더 ──────────────────────────────
  test('AC3 — 국·영문 병기 타이틀 + 5개 조항 전량 렌더', async ({ page }) => {
    const html = getHtmlTemplate(FORM_KEY)!;
    await page.setContent(bindHtmlTemplate(html, { issue_date: '2026-08-09', patient_name: '홍길동' }));

    // 타이틀 국·영문 병기
    await expect(page.getByText('외국인 비급여 진료 동의서')).toBeVisible();
    await expect(page.getByText('Agreement on Non-Covered Medical Treatment & Fees')).toBeVisible();

    // 5개 조항 헤딩(국·영문 병기)
    const clauseHeads = [
      '1. 비급여 진료 안내 / Non-Covered Medical Care',
      '2. 진료 및 서비스 비용 / Medical & Service Fees',
      '3. 포도로게(교정기) 관련 안내 / Podology (Orthotic Device) Terms',
      '4. 원내 정책 및 책임 범위 / Clinic Policy & Scope of Responsibility',
      '5. 수납 및 환불 정책 / Payment & Refund Policy',
    ];
    for (const h of clauseHeads) {
      await expect(page.getByText(h, { exact: false })).toBeVisible();
    }

    // 국문 본문 핵심 문구(확정본)
    await expect(page.getByText(/한국 건강보험이 적용되지 않는 외국인/)).toBeVisible();
    await expect(page.getByText(/의사 진찰료 및 관리사 서비스 비용이 별도로 부과/)).toBeVisible();
    await expect(page.getByText(/귀국 후 추가 처치가 필요한 경우/)).toBeVisible();
    await expect(page.getByText(/비의료적 개인 요청/)).toBeVisible();
    await expect(page.getByText(/이미 완료된 서비스에 대해서는 환불이 불가/)).toBeVisible();

    // 영문 본문 병기(외국인 대상)
    await expect(page.getByText(/not covered by Korean National Health Insurance/)).toBeVisible();
    await expect(page.getByText(/physician consultation fee and practitioner service fee/)).toBeVisible();
    await expect(page.getByText(/non-medical personal requests/)).toBeVisible();
    await expect(page.getByText(/services already rendered are non-refundable/)).toBeVisible();
  });

  // ── AC4: 기존 서류 회귀 없음(ADDITIVE) ────────────────────────────────
  test('AC4 — 기존 서류 HTML 템플릿 무접촉(ADDITIVE only)', () => {
    // 기존 대표 양식들이 그대로 등록되어 있어야 함(회귀 0)
    for (const k of ['diagnosis', 'diag_opinion', 'bill_detail', 'first_visit_mgmt_record']) {
      expect(isHtmlTemplate(k)).toBe(true);
      expect(getHtmlTemplate(k)).toBeTruthy();
    }
    // 신규 키가 기존 서류 뒤에 append 되었고(중간 삽입으로 인한 재정렬 없음),
    // 본 티켓 직전까지의 기존 12종 상대 순서가 그대로 보존되어야 함.
    // ── 비취약 단언: 후행 티켓이 동의서 등을 더 append 해도 깨지지 않도록,
    //    "맨 마지막" 위치 고정 대신 (a)기존 폼 뒤 append + (b)기존 상대순서 불변 을 검증한다.
    const PRE_EXISTING_ORDER = [
      'bill_receipt_new', 'bill_detail', 'rx_standard', 'koh_result', 'diag_opinion',
      'diagnosis', 'treat_confirm_code', 'treat_confirm_nocode', 'referral_letter',
      'visit_confirm', 'medical_record_request', 'first_visit_mgmt_record',
    ];
    // (a) 신규 키는 기존 폼 전부보다 뒤에 위치(append) — 중간 삽입 아님
    const foreignerIdx = DOCLIST_ORDER_10.indexOf(FORM_KEY);
    const priorLastIdx = DOCLIST_ORDER_10.indexOf('first_visit_mgmt_record');
    expect(foreignerIdx).toBeGreaterThan(priorLastIdx);
    // (b) 기존 12종의 상대 순서 불변(재정렬 0)
    const relativeExisting = DOCLIST_ORDER_10.filter((k) => PRE_EXISTING_ORDER.includes(k));
    expect(relativeExisting).toEqual(PRE_EXISTING_ORDER);
  });
});
