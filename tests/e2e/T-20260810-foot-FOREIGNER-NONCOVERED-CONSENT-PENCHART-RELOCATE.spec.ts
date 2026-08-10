/**
 * E2E(unit) spec — T-20260810-foot-FOREIGNER-NONCOVERED-CONSENT-PENCHART-RELOCATE
 * 외국인 비급여 진료 동의서 — 서류 발행 화면(오배치) → 펜차트 양식 탭 재배치.
 *
 * 배경(스펙 정정): 김주연 총괄(U0ATDB587PV) — "서류 부분 아니고 펜차트 양식에 추가되어야 함"
 *   (MSG-20260810-125839-7q9y, thread ts 1786334136.771039, 이미지 F0BP3KCG3SN 첨부).
 *   구 T-20260808-foot-FOREIGNER-NONCOVERED-CONSENT-FORM(deployed·서류발행화면 HTML) = 오배치 → superseded.
 *
 * 구현(PENCHART-PRIVACY 패턴 동형):
 *   [add leg] PenChartTab BUILTIN_FOREIGNER_CONSENT(template_format='html_render') — 선택 시 HTML 서식
 *     (FOREIGNER_NONCOVERED_CONSENT_HTML, 5조항 국·영문 verbatim)을 html2canvas 로 A4 배경 래스터화 후
 *     손서명 2-layer 합성. 날짜=오늘·성명=환자 자동, 서명=수기(빈칸).
 *   [de-list leg] formTemplates: 서류 발행 화면(DocumentPrintPanel)에서 제거 —
 *     DOCLIST_ORDER_10 화이트리스트 제거 + DOC_CATEGORY_CONSENT_KEYS 제거 + FALLBACK active=false.
 *     운영 DB seed row active=false 마이그(20260810120000_..._active_false, prod apply=supervisor GO-token 후).
 *
 * AC1: 펜차트 양식 탭에 외국인 비급여 진료 동의서 A4 손서명 서식 신규 노출(html_render 서식=HTML 템플릿 재사용)
 *      + 서류 발행 화면에서 de-list(DOCLIST_ORDER_10/DOC_CATEGORY_CONSENT_KEYS 제거, FALLBACK active=false).
 * AC2: 날짜=오늘, 성명=대상 환자명 자동 반영. 서명란 수기(빈칸).
 * AC3: 5개 조항 확정본이 국·영문 병기로 전량 렌더(원 티켓 verbatim, dev 재창작 0).
 * AC4: 참고 이미지 F0BP3KCG3SN 배치와 정합(서명표 = 날짜/성명 · 서명/기관 2행 구조).
 * AC5: 기존 펜차트 양식/서류 발행에 회귀 없음(ADDITIVE only) — 기존 form_key/HTML 무접촉.
 *
 * NOTE: htmlFormTemplates / formTemplates 는 supabase 의존성 없어 unit(auth·server 불요)로 직접 import.
 *   펜차트 배경은 getHtmlTemplate('foreigner_noncovered_consent') 결과를 html2canvas 로 래스터화한 것이므로,
 *   해당 HTML 템플릿의 내용·바인딩 검증 = 펜차트 A4 배경(사용자가 보는 서식)의 substance 검증과 동치.
 * 실행: playwright test --project=unit T-20260810-foot-FOREIGNER-NONCOVERED-CONSENT-PENCHART-RELOCATE
 */
import { test, expect } from '@playwright/test';
import { getHtmlTemplate, bindHtmlTemplate, isHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import {
  FORM_META,
  FALLBACK_TEMPLATES,
  DOCLIST_ORDER_10,
  DOC_CATEGORY_CONSENT_KEYS,
  groupDocList,
} from '../../src/lib/formTemplates';

const FORM_KEY = 'foreigner_noncovered_consent';

test.describe('T-20260810 FOREIGNER-NONCOVERED-CONSENT-PENCHART-RELOCATE — 외국인 비급여 진료 동의서 펜차트 재배치', () => {

  // ── AC1 (add leg): 펜차트 배경 서식 = HTML 템플릿 재사용 canonical ─────────
  test('AC1 add — 펜차트 html_render 배경 서식(HTML 템플릿) 등록 확인', () => {
    // 펜차트 BUILTIN_FOREIGNER_CONSENT(template_format='html_render') 가 배경으로 래스터화하는 원본 HTML.
    expect(isHtmlTemplate(FORM_KEY)).toBe(true);
    const html = getHtmlTemplate(FORM_KEY);
    expect(html).toBeTruthy();
    expect(html!.length).toBeGreaterThan(500);
    // 서식 제목(국·영문)
    expect(html).toContain('외국인 비급여 진료 동의서');
    expect(html).toContain('Agreement on Non-Covered Medical Treatment');
  });

  // ── AC1 (de-list leg): 서류 발행 화면에서 제거 ────────────────────────────
  test('AC1 de-list — 서류 발행 화면(DocumentPrintPanel) 목록에서 제거', () => {
    // DOCLIST_ORDER_10 화이트리스트에서 제거 → orderDocList 필터로 즉시 de-list.
    expect(DOCLIST_ORDER_10).not.toContain(FORM_KEY);
    // '동의서' 그룹 귀속에서도 제거.
    expect(DOC_CATEGORY_CONSENT_KEYS).not.toContain(FORM_KEY);
    // FALLBACK(빈 DB/프리뷰) 행은 존재하되 active=false (reversible de-list, hard-DELETE 지양).
    const fb = FALLBACK_TEMPLATES.find((t) => t.form_key === FORM_KEY);
    expect(fb).toBeTruthy();
    expect(fb!.active).toBe(false);
    // groupDocList 결과 어느 그룹에도 노출되지 않음(active=false + 화이트리스트 제거).
    const groups = groupDocList(FALLBACK_TEMPLATES.filter((t) => t.active));
    const allKeys = groups.flatMap((g) => g.templates.map((t) => t.form_key));
    expect(allKeys).not.toContain(FORM_KEY);
  });

  // ── AC2: 날짜/성명 자동 + 서명 수기(빈칸) ─────────────────────────────────
  test('AC2 — 날짜(issue_date)·성명(patient_name) 자동 바인딩 / 서명 빈칸', async ({ page }) => {
    const html = getHtmlTemplate(FORM_KEY)!;
    const bound = bindHtmlTemplate(html, {
      issue_date: '2026-08-10',
      patient_name: '홍길동',
      clinic_name: '종로 오블리브 풋케어',
    });
    await page.setContent(bound);

    // 날짜=오늘, 성명=환자명, 기관=원내명 렌더
    await expect(page.getByText('2026-08-10')).toBeVisible();
    await expect(page.getByText('홍길동')).toBeVisible();
    await expect(page.getByText('종로 오블리브 풋케어')).toBeVisible();

    // 서명 라벨(국·영문) 존재하되 서명셀 값은 빈칸(수기, 자동반영 X)
    await expect(page.getByText(/서명 \/ Signature/)).toBeVisible();
    const sigCellText = await page.locator('.fnc-sig-cell').first().innerText();
    expect(sigCellText.trim()).toBe('');
  });

  test('AC2 — 성명이 영문/특수문자여도 정상 반영 (엣지)', async ({ page }) => {
    const html = getHtmlTemplate(FORM_KEY)!;
    const bound = bindHtmlTemplate(html, {
      issue_date: '2026-08-10',
      patient_name: "O'Brien-李 (외국인)",
    });
    await page.setContent(bound);
    await expect(page.getByText("O'Brien-李 (외국인)")).toBeVisible();
  });

  // ── AC3: 5개 조항 국·영문 병기 verbatim 전량 렌더 ─────────────────────────
  test('AC3 — 5개 조항 국·영문 병기 확정본 verbatim 렌더', async ({ page }) => {
    const html = getHtmlTemplate(FORM_KEY)!;
    await page.setContent(bindHtmlTemplate(html, { issue_date: '2026-08-10', patient_name: '홍길동' }));

    // [1] 비급여 진료 안내 / Non-Covered Medical Care
    await expect(page.getByText('1. 비급여 진료 안내 / Non-Covered Medical Care')).toBeVisible();
    await expect(page.getByText('한국 건강보험이 적용되지 않는 외국인 환자는 전액 비급여 진료가 적용됨을 안내드립니다.')).toBeVisible();
    await expect(page.getByText(/As a foreign patient not covered by Korean National Health Insurance/)).toBeVisible();

    // [2] 진료 및 서비스 비용 / Medical & Service Fees
    await expect(page.getByText('2. 진료 및 서비스 비용 / Medical & Service Fees')).toBeVisible();
    await expect(page.getByText('본치료비 및 장치·재료비 외에 의사 진찰료 및 관리사 서비스 비용이 별도로 부과됨에 동의합니다.')).toBeVisible();
    await expect(page.getByText(/a separate physician consultation fee and practitioner service fee will be charged/)).toBeVisible();

    // [3] 포도로게(교정기) 관련 안내 / Podology (Orthotic Device) Terms — 3개 하위 항목
    await expect(page.getByText('3. 포도로게(교정기) 관련 안내 / Podology (Orthotic Device) Terms')).toBeVisible();
    await expect(page.getByText('장치 장착 후 출국 시, 사후 관리(재조정·추가 시술)가 제한될 수 있습니다.')).toBeVisible();
    await expect(page.getByText('귀국 후 추가 처치가 필요한 경우 그 비용은 환자 본인이 부담합니다.')).toBeVisible();
    await expect(page.getByText('교정 결과는 개인의 발 상태에 따라 차이가 있을 수 있습니다.')).toBeVisible();
    await expect(page.getByText(/follow-up care \(readjustment \/ additional procedures\) may be limited/)).toBeVisible();

    // [4] 원내 정책 및 책임 범위 / Clinic Policy & Scope of Responsibility
    await expect(page.getByText('4. 원내 정책 및 책임 범위 / Clinic Policy & Scope of Responsibility')).toBeVisible();
    await expect(page.getByText('본원은 의료 서비스만을 제공하며, 비의료적 개인 요청(택시 호출, 출입국 관련 서명 등)에는 응할 의무가 없습니다.')).toBeVisible();
    await expect(page.getByText(/The clinic provides medical services only/)).toBeVisible();

    // [5] 수납 및 환불 정책 / Payment & Refund Policy
    await expect(page.getByText('5. 수납 및 환불 정책 / Payment & Refund Policy')).toBeVisible();
    await expect(page.getByText('상담 및 시술 후 발생한 진료비의 납부에 동의하며, 이미 완료된 서비스에 대해서는 환불이 불가함을 확인합니다.')).toBeVisible();
    await expect(page.getByText(/services already rendered are non-refundable/)).toBeVisible();

    // 확인 문구(국·영문)
    await expect(page.getByText('본인은 위 내용을 충분히 이해하였으며 이에 동의합니다.')).toBeVisible();
    await expect(page.getByText(/I have fully read and understood the above and hereby agree to its terms/)).toBeVisible();
  });

  // ── AC4: 참고 이미지 F0BP3KCG3SN 배치 정합 (서명표 2행 구조) ───────────────
  test('AC4 — 서명표 배치 정합(날짜/성명 · 서명/기관 국·영문 라벨)', async ({ page }) => {
    const html = getHtmlTemplate(FORM_KEY)!;
    await page.setContent(bindHtmlTemplate(html, { issue_date: '2026-08-10', patient_name: '홍길동', clinic_name: '종로 오블리브 풋케어' }));
    // 서명표 국·영문 라벨 4종
    await expect(page.getByText(/날짜 \/ Date/)).toBeVisible();
    await expect(page.getByText(/성명 \/ Name/)).toBeVisible();
    await expect(page.getByText(/서명 \/ Signature/)).toBeVisible();
    await expect(page.getByText(/기관 \/ Clinic/)).toBeVisible();
  });

  // ── AC5: 기존 서류/양식 회귀 없음(ADDITIVE) ──────────────────────────────
  test('AC5 — 기존 서류 HTML/목록 무접촉(회귀 0)', () => {
    // 자매 동의서(개인정보 수집·이용)는 그대로 유지(active=true) — de-list 대상 아님.
    const privacy = FALLBACK_TEMPLATES.find((t) => t.form_key === 'privacy_consent_form');
    expect(privacy).toBeTruthy();
    expect(privacy!.active).toBe(true);
    // 기존 대표 양식 HTML 무접촉
    for (const k of ['diagnosis', 'diag_opinion', 'bill_detail', 'first_visit_mgmt_record', 'privacy_consent_form']) {
      expect(isHtmlTemplate(k)).toBe(true);
      expect(getHtmlTemplate(k)).toBeTruthy();
    }
    // FORM_META 는 펜차트 렌더/발행이력 참조용으로 보존(제거하면 기존 발행문서 메타 소실).
    expect(FORM_META[FORM_KEY]).toBeTruthy();
  });
});
