/**
 * E2E(unit) spec — T-20260811-foot-PENCHART-PRIVACY-CONSENT-FORMLIST-ADD
 * 개인정보 수집·이용 동의서 — 서류 발행 화면(DocumentPrintPanel)에만 노출되던 privacy_consent_form 을
 * 펜차트 양식 선택 목록에도 노출(환불/비급여·외국인 동의서와 나란히).
 *
 * 배경(현장 요청): 김주연 총괄(C0ATE5P6JTH) — "개인정보수집동의서 서류 출력 항목에 들어가 있잖아!
 *   펜차트 양식 항목에 넣어달라고!!!!" → 서류출력 목록에만 있던 것을 펜차트 양식 목록에도 membership 추가.
 *
 * 구조 동형 선례(deployed): T-20260810-foot-FOREIGNER-NONCOVERED-CONSENT-PENCHART-RELOCATE.
 *   차이 = 본 건은 ADDITIVE only — 서류출력 목록의 기존 개인정보동의서는 유지(제거/ de-list 아님).
 *
 * 구현(FOREIGNER 패턴 동형):
 *   PenChartTab BUILTIN_PRIVACY_CONSENT(template_format='html_render') — 선택 시 HTML 서식
 *   (PRIVACY_CONSENT_FORM_HTML, 5개 동의항목 verbatim)을 html2canvas 로 A4 배경 래스터화 후 손서명 2-layer 합성.
 *   날짜=오늘·성명=환자 자동, 서명=수기(빈칸). form_templates 행은 T-20260808 에서 이미 seed(db_change=false).
 *
 * AC1: 펜차트 양식 목록에 개인정보 수집·이용 동의서 A4 손서명 서식 신규 노출(html_render=HTML 템플릿 재사용).
 * AC2: 날짜=오늘, 성명=환자명 자동. 서명란 수기(빈칸).
 * AC3: 문안 = T-20260808 확정본 verbatim(5개 동의항목 전량 렌더, dev 재창작 0).
 * AC4: 서명표 배치(날짜/성명 · 기관/서명) 정합.
 * AC5: 기존 양식/서류출력 회귀 0 — 서류출력의 privacy_consent_form 유지(ADDITIVE), 대표 양식 HTML 무접촉.
 *
 * NOTE: htmlFormTemplates / formTemplates 는 supabase 의존성 없어 unit(auth·server 불요)로 직접 import.
 *   펜차트 배경은 getHtmlTemplate('privacy_consent_form') 결과를 html2canvas 로 래스터화한 것이므로,
 *   해당 HTML 템플릿의 내용·바인딩 검증 = 펜차트 A4 배경(사용자가 보는 서식)의 substance 검증과 동치.
 *   목록 membership(BUILTIN_PRIVACY_CONSENT 배선)은 PenChartTab.tsx 정적 소스 가드로 검증
 *   (PenChartTab 은 supabase 의존 → import 불가, source-level assert).
 * 실행: playwright test --project=unit T-20260811-foot-PENCHART-PRIVACY-CONSENT-FORMLIST-ADD
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { getHtmlTemplate, bindHtmlTemplate, isHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import {
  FORM_META,
  FALLBACK_TEMPLATES,
  DOCLIST_ORDER_10,
  DOC_CATEGORY_CONSENT_KEYS,
  groupDocList,
} from '../../src/lib/formTemplates';

const FORM_KEY = 'privacy_consent_form';
const __dir = dirname(fileURLToPath(import.meta.url));
const PENCHART_SRC = readFileSync(resolve(__dir, '../../src/components/PenChartTab.tsx'), 'utf8');

test.describe('T-20260811 PENCHART-PRIVACY-CONSENT-FORMLIST-ADD — 개인정보 동의서 펜차트 목록 추가', () => {

  // ── AC1: 펜차트 목록 membership + 배경 서식(HTML 템플릿) 등록 ────────────────
  test('AC1 — 펜차트 양식 목록에 BUILTIN_PRIVACY_CONSENT(html_render) 배선', () => {
    // (a) 코드-드리븐 builtin 정의: template_format='html_render' + form_key=privacy_consent_form
    expect(PENCHART_SRC).toMatch(/export const BUILTIN_PRIVACY_CONSENT\s*:\s*Template\s*=/);
    const block = PENCHART_SRC.slice(PENCHART_SRC.indexOf('BUILTIN_PRIVACY_CONSENT'));
    expect(block).toMatch(/template_format:\s*'html_render'/);
    expect(block).toMatch(/form_key:\s*'privacy_consent_form'/);
    // (b) 양식 선택 목록 버튼에서 선택 핸들러로 배선
    expect(PENCHART_SRC).toContain('handleSelectTemplate(BUILTIN_PRIVACY_CONSENT)');
    // (c) html_render 판별자에 privacy_consent_form 포함 → 배경 래스터화 경로 진입
    expect(PENCHART_SRC).toMatch(/isHtmlRenderFormKey[\s\S]{0,240}privacy_consent_form/);
  });

  test('AC1 — 펜차트 배경 래스터화 원본 HTML 템플릿 등록 확인', () => {
    expect(isHtmlTemplate(FORM_KEY)).toBe(true);
    const html = getHtmlTemplate(FORM_KEY);
    expect(html).toBeTruthy();
    expect(html!.length).toBeGreaterThan(500);
    expect(html).toContain('개인정보 수집·이용 동의서');
    expect(html).toContain('Consent to Collection &amp; Use of Personal Information');
  });

  // ── AC2: 날짜/성명 자동 + 서명 수기(빈칸) ─────────────────────────────────
  test('AC2 — 날짜(issue_date)·성명(patient_name) 자동 바인딩 / 서명 빈칸', async ({ page }) => {
    const html = getHtmlTemplate(FORM_KEY)!;
    const bound = bindHtmlTemplate(html, {
      issue_date: '2026-08-11',
      patient_name: '홍길동',
      clinic_name: '오블리브 풋센터 종로',
    });
    await page.setContent(bound);

    await expect(page.getByText('2026-08-11')).toBeVisible();
    await expect(page.getByText('홍길동')).toBeVisible();
    await expect(page.getByText('오블리브 풋센터 종로')).toBeVisible();

    // 서명셀(pcf-sig-cell)은 빈칸(수기, 자동반영 X)
    const sigCellText = await page.locator('.pcf-sig-cell').first().innerText();
    expect(sigCellText.trim()).toBe('');
  });

  test('AC2 — 성명이 영문/특수문자여도 정상 반영 (엣지)', async ({ page }) => {
    const html = getHtmlTemplate(FORM_KEY)!;
    await page.setContent(bindHtmlTemplate(html, { issue_date: '2026-08-11', patient_name: "O'Brien-李" }));
    await expect(page.getByText("O'Brien-李")).toBeVisible();
  });

  // ── AC3: 5개 동의항목 확정본 verbatim 전량 렌더 ──────────────────────────────
  test('AC3 — 5개 동의항목 확정본 verbatim 렌더', async ({ page }) => {
    const html = getHtmlTemplate(FORM_KEY)!;
    await page.setContent(bindHtmlTemplate(html, { issue_date: '2026-08-11', patient_name: '홍길동' }));

    await expect(page.getByText('1. 개인정보 수집·이용 동의 (필수)')).toBeVisible();
    await expect(page.getByText('진료를 위한 정보 수집')).toBeVisible();
    await expect(page.getByText('□ 개인정보 수집·이용에 동의합니다 (필수)')).toBeVisible();

    await expect(page.getByText('2. 고유식별정보 수집·이용 동의 (필수)')).toBeVisible();
    await expect(page.getByText('주민등록번호, 외국인등록번호, 여권번호')).toBeVisible();
    await expect(page.getByText('□ 고유식별정보 수집·이용에 동의합니다 (필수)')).toBeVisible();

    await expect(page.getByText('3. 민감정보(건강·진료정보) 수집·이용 동의 (필수, 개인정보보호법 §23)')).toBeVisible();
    await expect(page.getByText('발건강 케어 및 시술 서비스 제공, 진료 이력 관리')).toBeVisible();
    await expect(page.getByText('□ 민감정보(건강·진료정보) 수집·이용에 동의합니다 (필수)')).toBeVisible();

    await expect(page.getByText('4. 건강보험 자격조회 동의 (필수)')).toBeVisible();
    await expect(page.getByText('진료비 산정 및 청구, 보험 급여 적정성 확인')).toBeVisible();
    await expect(page.getByText('□ 건강보험 자격조회에 동의합니다 (필수)')).toBeVisible();

    await expect(page.getByText('5. 예약 안내 문자(SMS) 수신 동의 (선택)')).toBeVisible();
    await expect(page.getByText(/미동의 시 예약 안내 문자, 홈케어 방법 등 자동 발송 대상에서 제외될 수 있습니다\./)).toBeVisible();

    // 최종 확인 문구(verbatim)
    await expect(page.getByText(/본인은 위 각 항목의 수집·이용 목적 및 항목·보유기간을 충분히 이해하였으며/)).toBeVisible();
  });

  // ── AC4: 서명표 배치(날짜/성명 · 기관/서명) 정합 ─────────────────────────────
  test('AC4 — 서명표 라벨 4종 렌더', async ({ page }) => {
    const html = getHtmlTemplate(FORM_KEY)!;
    await page.setContent(bindHtmlTemplate(html, { issue_date: '2026-08-11', patient_name: '홍길동', clinic_name: '오블리브 풋센터 종로' }));
    for (const label of ['날짜', '성명', '기관', '서명']) {
      await expect(page.locator('.pcf-sign-label', { hasText: label }).first()).toBeVisible();
    }
  });

  // ── AC5: 기존 서류출력/양식 회귀 0 (ADDITIVE — de-list 아님) ─────────────────
  test('AC5 — 서류출력의 개인정보동의서 유지(ADDITIVE) + 대표 양식 HTML 무접촉', () => {
    // (a) 서류출력 화이트리스트/그룹 membership 유지(제거 금지).
    expect(DOCLIST_ORDER_10).toContain(FORM_KEY);
    expect(DOC_CATEGORY_CONSENT_KEYS).toContain(FORM_KEY);
    // (b) FALLBACK 행 active=true 유지(서류출력 노출 보존).
    const fb = FALLBACK_TEMPLATES.find((t) => t.form_key === FORM_KEY);
    expect(fb).toBeTruthy();
    expect(fb!.active).toBe(true);
    // (c) groupDocList 결과에 여전히 노출(서류출력 목록 회귀 0).
    const groups = groupDocList(FALLBACK_TEMPLATES.filter((t) => t.active));
    const allKeys = groups.flatMap((g) => g.templates.map((t) => t.form_key));
    expect(allKeys).toContain(FORM_KEY);
    // (d) 대표 양식 HTML 무접촉 + 자매 외국인 동의서 유지.
    for (const k of ['diagnosis', 'diag_opinion', 'bill_detail', 'foreigner_noncovered_consent', FORM_KEY]) {
      expect(isHtmlTemplate(k)).toBe(true);
      expect(getHtmlTemplate(k)).toBeTruthy();
    }
    expect(FORM_META[FORM_KEY]).toBeTruthy();
  });
});
