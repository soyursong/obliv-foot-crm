/**
 * E2E(unit) spec — T-20260808-foot-PENCHART-PRIVACY-CONSENT-FORM
 * 개인정보 수집·이용 동의서 신규 양식 — 서류 발행 화면 '동의서' 섹션 추가.
 *
 * 배경: 셀프접수(foot-checkin) 오류로 라이브 개인정보 동의 미수집 시 종이 백업 발행용.
 * 구현: 기존 동의서(외국인 비급여)와 동일 방식(HTML 템플릿 + form_templates seed). 순수 ADDITIVE.
 *   - 날짜(issue_date)=오늘 자동 / 성명(patient_name)=대상 환자 자동 / 서명=수기(빈칸, 인쇄 후 손서명)
 *   - 문안 = 셀프접수 라이브 동의문(privacyConsentLabel/privacyConsentNote) authoritative source verbatim
 *   - '동의서' 그룹으로 서류 목록 노출
 *
 * AC1: 서류 발행 화면 동의서 섹션에 개인정보 수집·이용 동의서가 신규 노출된다.
 *      → DOCLIST_ORDER_10 화이트리스트 등록 + groupDocList '동의서' 그룹 귀속 + FORM_META/FALLBACK 정합.
 * AC2: 날짜=오늘, 성명=대상 환자명 자동 반영. 서명란 수기(빈칸).
 *      → 템플릿 {{issue_date}}/{{patient_name}} 바인딩 + 서명셀 값 미바인딩(빈칸).
 * AC3: 셀프접수 라이브 동의문 확정본(수집항목·수집목적·보유기간 + 동의 라벨)이 verbatim 전량 렌더된다.
 * AC4: 기존 서류/동의서 발행에 회귀 없음(ADDITIVE only) — 기존 form_key/HTML 무접촉.
 *
 * NOTE: htmlFormTemplates / formTemplates 는 supabase 의존성 없어 unit(auth·server 불요)로 직접 import.
 * 실행: playwright test --project=unit T-20260808-foot-PENCHART-PRIVACY-CONSENT-FORM
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

const FORM_KEY = 'privacy_consent_form';

test.describe('T-20260808 PENCHART-PRIVACY-CONSENT-FORM — 개인정보 수집·이용 동의서', () => {

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
    expect(fb!.name_ko).toBe('개인정보 수집·이용 동의서');
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
      patient_name: '홍길동',
      clinic_name: '종로 오블리브 풋케어',
    });
    await page.setContent(bound);

    // 날짜=오늘, 성명=환자명 렌더
    await expect(page.getByText('2026-08-09')).toBeVisible();
    await expect(page.getByText('홍길동')).toBeVisible();

    // 서명 라벨 존재하되 값은 빈칸(수기) — 서명셀에 자동 반영 텍스트 없음
    await expect(page.getByText('서명', { exact: true })).toBeVisible();
    const sigCellText = await page.locator('.pcf-sig-cell').first().innerText();
    expect(sigCellText.trim()).toBe('');
  });

  test('AC2 — 성명이 특수문자여도 정상 반영 (엣지)', async ({ page }) => {
    const html = getHtmlTemplate(FORM_KEY)!;
    const bound = bindHtmlTemplate(html, {
      issue_date: '2026-08-09',
      patient_name: "O'Brien-李 (외국인)",
    });
    await page.setContent(bound);
    // HTML 이스케이프 후에도 텍스트로 정상 표시
    await expect(page.getByText("O'Brien-李 (외국인)")).toBeVisible();
  });

  // ── AC3: 셀프접수 라이브 동의문 확정본 verbatim 전량 렌더 ──────────────
  test('AC3 — 제목 + 수집항목/수집목적/보유기간 + 동의 라벨 verbatim 렌더', async ({ page }) => {
    const html = getHtmlTemplate(FORM_KEY)!;
    await page.setContent(bindHtmlTemplate(html, { issue_date: '2026-08-09', patient_name: '홍길동' }));

    // 제목
    await expect(page.getByText('개인정보 수집·이용 동의서')).toBeVisible();

    // authoritative source(foot-checkin SelfCheckIn.tsx privacyConsentNote) verbatim 3항
    await expect(page.getByText('성함, 주민등록번호, 연락처, 주소 등 기본 정보')).toBeVisible();
    await expect(page.getByText('진료를 위한 정보 수집')).toBeVisible();
    await expect(page.getByText('관련 법령에 따른 보관 기간 동안 보유')).toBeVisible();

    // 항목 라벨
    await expect(page.getByText('수집항목', { exact: true })).toBeVisible();
    await expect(page.getByText('수집목적', { exact: true })).toBeVisible();
    await expect(page.getByText('보유기간', { exact: true })).toBeVisible();

    // 동의 라벨(privacyConsentLabel verbatim, 필수)
    await expect(page.getByText(/개인정보 수집·이용에 동의합니다 \(필수\)/)).toBeVisible();

    // 확인 문구
    await expect(page.getByText(/본인은 위 개인정보의 수집·이용 목적 및 항목·보유기간을 충분히 이해/)).toBeVisible();
  });

  // ── AC4: 기존 서류 회귀 없음(ADDITIVE) ────────────────────────────────
  test('AC4 — 기존 서류 HTML 템플릿 무접촉(ADDITIVE only)', () => {
    // 기존 대표 양식들이 그대로 등록되어 있어야 함(회귀 0)
    for (const k of ['diagnosis', 'diag_opinion', 'bill_detail', 'first_visit_mgmt_record', 'foreigner_noncovered_consent']) {
      expect(isHtmlTemplate(k)).toBe(true);
      expect(getHtmlTemplate(k)).toBeTruthy();
    }
    // 신규 키가 기존 목록 순서 맨 뒤에 추가(중간 삽입으로 인한 재정렬 없음)
    expect(DOCLIST_ORDER_10[DOCLIST_ORDER_10.length - 1]).toBe(FORM_KEY);
  });
});
