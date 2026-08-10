/**
 * E2E(unit) spec — T-20260808-foot-PENCHART-PRIVACY-CONSENT-FORM
 * 개인정보 수집·이용 등 동의서 신규 양식 — 서류 발행 화면 '동의서' 섹션 추가.
 *
 * 배경: 셀프접수(foot-checkin) 오류로 라이브 필수 동의 미수집 시 종이 백업 발행용.
 * 구현: 기존 동의서(외국인 비급여)와 동일 방식(HTML 템플릿 + form_templates seed). 순수 ADDITIVE.
 *   - 날짜(issue_date)=오늘 자동 / 성명(patient_name)=대상 환자 자동 / 서명=수기(빈칸, 인쇄 후 손서명)
 *   - 문안 = 셀프접수 라이브 동의문 authoritative source verbatim (dev 창작 금지)
 *   - scope(uem5-fold + AC-6): 셀프접수 필수 동의 전건 백업 = 필수 4종 + 선택 1종 (5블록)
 *       [1] 개인정보 수집·이용(필수) [2] 고유식별정보 수집·이용(별도 필수, 개보법 §24)
 *       [3] 민감정보(건강·진료정보, 개보법 §23, 필수) [4] 건강보험 자격조회(필수)
 *       [5] 예약 안내 문자(SMS) 수신(선택)
 *   - '동의서' 그룹으로 서류 목록 노출
 *
 * FIX(2026-08-09, AC-5 NO-GO→FIX): AC-6 고유식별정보 블록 추가(개보법 §24 별도 필수, 문안=
 *   ConsentFormDialog UNIQUE_ID verbatim 재사용) + AC-7 레이아웃 간격 확대(CSS). db_change=false.
 *
 * AC1: 서류 발행 화면 동의서 섹션에 개인정보 수집·이용 동의서가 신규 노출된다.
 *      → DOCLIST_ORDER_10 화이트리스트 등록 + groupDocList '동의서' 그룹 귀속 + FORM_META/FALLBACK 정합.
 * AC2: 날짜=오늘, 성명=대상 환자명 자동 반영. 서명란 수기(빈칸).
 *      → 템플릿 {{issue_date}}/{{patient_name}} 바인딩 + 서명셀 값 미바인딩(빈칸).
 * AC3: 셀프접수 라이브 동의문 확정본(필수 3종 + 선택 1종)이 verbatim 전량 렌더된다.
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

  // ── AC3+AC6: 셀프접수 라이브 동의문 확정본 verbatim 전량 렌더 (필수 4종 + 선택 1종) ──
  test('AC3+AC6 — 제목 + 필수 4종(고유식별정보 포함) + 선택 1종 동의 블록 verbatim 렌더', async ({ page }) => {
    const html = getHtmlTemplate(FORM_KEY)!;
    await page.setContent(bindHtmlTemplate(html, { issue_date: '2026-08-09', patient_name: '홍길동' }));

    // 제목
    await expect(page.getByText('개인정보 수집·이용 동의서')).toBeVisible();

    // [1] 개인정보 수집·이용 (필수) — SelfCheckIn.tsx privacyConsentNote verbatim
    await expect(page.getByText('성함, 주민등록번호, 연락처, 주소 등 기본 정보')).toBeVisible();
    await expect(page.getByText('진료를 위한 정보 수집')).toBeVisible();
    await expect(page.getByText(/개인정보 수집·이용에 동의합니다 \(필수\)/)).toBeVisible();

    // [2] 고유식별정보 수집·이용 (필수) — ConsentFormDialog UNIQUE_ID verbatim
    // FIX(2026-08-10): commit dd8d2a14 [T-20260810-foot-CONSENT-UNIQUEID-SECTION-FORMAT-ALIGN /
    //   자매 FORM2-FORMAT-ALIGN] 이 §2 표기·서식을 1·3·4번과 통일 — 헤드 '(별도 필수, 개보법 §24)'→'(필수)',
    //   dual 위젯(□동의함 □동의하지 않음)→ 1·3·4 동일 단일 체크박스. 이 스펙의 정합 前 단언이 라이브와
    //   drift 하여 FAIL 하던 것을 배포 실재(deployed reality)로 동기화. §24 별도 opt-in '실질'(독립 동의
    //   라인)은 보존됨 — '(필수)' 는 표기 통일이지 별도 동의 삭제가 아님.
    await expect(page.getByText('주민등록번호, 외국인등록번호, 여권번호')).toBeVisible();
    await expect(page.getByText('의료법 및 국민건강보험법에 따른 본인확인, 진료기록 작성, 건강보험 자격확인')).toBeVisible();
    await expect(page.getByText('의료법에 따른 진료기록 보존기간 (10년)')).toBeVisible();
    // §2 = 1·3·4 와 동일 단일 체크박스 '(필수)' 서식 (별도 opt-in = 독립 동의 라인으로 보존)
    await expect(page.getByText(/□ 고유식별정보 수집·이용에 동의합니다 \(필수\)/)).toBeVisible();
    // 정합 후: dual 위젯(동의함/동의하지 않음)·'별도 필수' 라벨 미노출
    await expect(page.getByText(/□ 동의함/)).toHaveCount(0);
    await expect(page.getByText(/□ 동의하지 않음/)).toHaveCount(0);
    await expect(page.getByText(/별도 필수/)).toHaveCount(0);

    // [3] 민감정보(건강·진료정보) (필수, 개보법 §23) — consentSensitiveItems verbatim
    await expect(page.getByText('건강정보, 진료기록, 상병명, 처방내역 등 민감 의료정보')).toBeVisible();
    await expect(page.getByText('발건강 케어 및 시술 서비스 제공, 진료 이력 관리')).toBeVisible();
    await expect(page.getByText(/민감정보\(건강·진료정보\) 수집·이용에 동의합니다 \(필수\)/)).toBeVisible();
    await expect(page.getByText(/개인정보보호법 §23/)).toBeVisible();

    // [4] 건강보험 자격조회 (필수) — insuranceConsentNote verbatim
    await expect(page.getByText('성함, 주민등록번호, 건강보험 자격정보')).toBeVisible();
    await expect(page.getByText('진료비 산정 및 청구, 보험 급여 적정성 확인')).toBeVisible();
    await expect(page.getByText(/건강보험 자격조회에 동의합니다 \(필수\)/)).toBeVisible();

    // [5] 예약 안내 문자(SMS) 수신 (선택) — smsOptIn / smsOptInNote verbatim
    await expect(page.getByText(/예약 안내 문자 수신에 동의합니다 \(선택\)/)).toBeVisible();
    await expect(page.getByText(/미동의 시 예약 안내 문자, 홈케어 방법 등 자동 발송 대상에서 제외될 수 있습니다/)).toBeVisible();

    // 공통 보유기간 문구는 (고유식별 제외) 필수 3종에 각 1회 = 총 3회 렌더
    await expect(page.getByText('관련 법령에 따른 보관 기간 동안 보유')).toHaveCount(3);

    // 항목 라벨 (pcf-note 테이블 블록 = 4개: 개인정보/고유식별/민감정보/건강보험)
    await expect(page.getByText('수집항목', { exact: true })).toHaveCount(4);
    await expect(page.getByText('수집목적', { exact: true })).toHaveCount(3); // 고유식별은 '이용목적'
    await expect(page.getByText('이용목적', { exact: true })).toHaveCount(1); // AC-6 고유식별 블록
    await expect(page.getByText('보유기간', { exact: true })).toHaveCount(4);

    // 확인 문구(통합본)
    await expect(page.getByText(/본인은 위 각 항목의 수집·이용 목적 및 항목·보유기간을 충분히 이해/)).toBeVisible();
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
