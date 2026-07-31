/**
 * E2E Spec — T-20260731-foot-FIRSTVISIT-VISITPURPOSE-SYMPTOMS
 *
 * 초진 관리기록지 '방문목적'에 발건강 설문지 '발 관련 증상' 전체를 additive 추가.
 * 요청: 김주연 총괄 (스크린샷 F0BM2RNDTP0). db_change:false — form_submissions.field_data(JSONB) 인쇄시점 바인딩,
 *       자매 T-20260731-foot-FIRSTVISIT-MGMTRECORD-CONTENT-SAVE-PERSIST 저장구조(allValues + _fvmr.manual)에 무DDL 상속.
 *
 * 격리 불변식: 「초진 관리기록지 발행」 팝업 + 발건강 설문지(HealthQMobilePage) 라벨 SSOT만 접촉.
 *   타 HTML 서류 READ-ONLY. 신규 컬럼/enum 0. '기타'는 P3(vp_other) 기존칸과 정합(중복 미생성).
 *
 * 검증 전략(P3 QA 승인 패턴 계승 — SSOT 구조 가드 + HTML 템플릿 무결성 + 실 브라우저 렌더 self-check):
 *   AC-1  SSOT(footSymptomOptions): '발 관련 증상' 10종 현장 확정 문구·순서 + 방문목적옵션 = 9종('기타' 제외).
 *   AC-2  발건강 설문지(HealthQMobilePage)가 SSOT 재사용(로컬 리터럴 중복 제거 → 어휘 drift 0).
 *   AC-3  DocumentPrintPanel 방문 목적 그룹 = 기존 4종 + 증상 9종(additive) + 기타(vp_other) 말미.
 *   AC-4  인쇄 템플릿에 {{vp_sym0..8}} 9개 플레이스홀더 + 라벨 정합 + 기존 4종·기타 보존(additive).
 *   AC-5  바인딩: 증상 체크 → ✔ 렌더 / 미체크 → 빈 네모 / 미치환 {{}} 잔존 0.
 *   AC-6(회귀 0)  타 HTML 서류에 vp_sym 마커 미침투.
 *   AC-7  실 브라우저 렌더 self-check — 증상 9개 라벨 + 기타 표시.
 *
 * 실행: npx playwright test T-20260731-foot-FIRSTVISIT-VISITPURPOSE-SYMPTOMS.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';
import { FOOT_SYMPTOM_OPTIONS, FOOT_VISIT_PURPOSE_SYMPTOM_OPTIONS } from '../../src/lib/footSymptomOptions';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEW_KEY = 'first_visit_mgmt_record';
const REPO = resolve(__dirname, '../..');
const panelSrc = readFileSync(resolve(REPO, 'src/components/DocumentPrintPanel.tsx'), 'utf8');
const healthQSrc = readFileSync(resolve(REPO, 'src/pages/HealthQMobilePage.tsx'), 'utf8');

// 현장 확정 문구·순서 (MSG-175815-mlsv 발건강질문지 5섹션 1번 항목).
const CANON_SYMPTOMS = [
  '발톱 변색 및 변형',
  '내성발톱(파고드는 발톱)',
  '발가락 통증',
  '발냄새',
  '발건조 및 각질',
  '발 땀 많음',
  '가려움증',
  '발톱 끝 부서짐',
  '울퉁불퉁한 발톱',
  '기타',
];

// ── AC-1: SSOT 문구·순서 + 방문목적 옵션 파생('기타' 제외) ──
test('AC-1①: FOOT_SYMPTOM_OPTIONS = 현장 확정 10종 문구·순서 그대로', () => {
  expect(FOOT_SYMPTOM_OPTIONS).toEqual(CANON_SYMPTOMS);
});

test('AC-1②: 방문목적 증상옵션 = 9종(기타 제외) + key = vp_sym0..8', () => {
  expect(FOOT_VISIT_PURPOSE_SYMPTOM_OPTIONS).toHaveLength(9);
  // '기타'는 방문목적 전용칸(vp_other)과 중복 → SSOT에서 제외.
  expect(FOOT_VISIT_PURPOSE_SYMPTOM_OPTIONS.some((o) => o.label === '기타')).toBe(false);
  FOOT_VISIT_PURPOSE_SYMPTOM_OPTIONS.forEach((o, i) => {
    expect(o.key).toBe(`vp_sym${i}`);
    expect(o.label).toBe(CANON_SYMPTOMS[i]);
  });
});

// ── AC-2: 설문지가 SSOT 재사용(로컬 리터럴 중복 제거) ──
test('AC-2: HealthQMobilePage 가 SSOT(FOOT_SYMPTOM_OPTIONS) 재사용 → 어휘 drift 0', () => {
  expect(healthQSrc).toContain("from '@/lib/footSymptomOptions'");
  expect(healthQSrc).toContain('const SYMPTOM_OPTIONS = FOOT_SYMPTOM_OPTIONS');
  // 구 로컬 리터럴 배열(중복 정의)이 잔존하면 drift 위험 → 금지.
  expect(healthQSrc).not.toMatch(/const SYMPTOM_OPTIONS = \[/);
});

// ── AC-3: 방문 목적 체크 그룹 = 기존 4종 + 증상 9종(additive) + 기타 말미 ──
test('AC-3: DocumentPrintPanel 방문 목적 그룹 = 기존 4종 보존 + 증상 9종 spread + vp_other 말미', () => {
  // 기존 P3 옵션 보존(additive — 삭제 아님).
  for (const k of ['vp_ingrown', 'vp_fungal', 'vp_thick', 'vp_deformed', 'vp_other']) {
    expect(panelSrc, `기존 방문목적 옵션 누락(비-additive): ${k}`).toContain(`'${k}'`);
  }
  // 증상 9종 = SSOT spread (하드코딩 재열거 금지).
  expect(panelSrc).toContain('...FOOT_VISIT_PURPOSE_SYMPTOM_OPTIONS');
  expect(panelSrc).toContain("from '@/lib/footSymptomOptions'");
  // spread 가 vp_other 앞에 위치(기타 말미 유지) — 방문 목적 그룹 블록 내 순서 가드.
  const grpBlock = panelSrc.slice(
    panelSrc.indexOf("label: '방문 목적'"),
    panelSrc.indexOf("label: '통증 여부'"),
  );
  expect(grpBlock.indexOf('...FOOT_VISIT_PURPOSE_SYMPTOM_OPTIONS'))
    .toBeLessThan(grpBlock.indexOf("key: 'vp_other'"));
});

// ── AC-4: 인쇄 템플릿 {{vp_sym0..8}} + 라벨 정합 + 기존 보존 ──
test('AC-4: 인쇄 템플릿에 {{vp_symN}} 9개 + 라벨 정합 + 기존 4종·기타 보존(additive)', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  // 증상 9종 플레이스홀더 + 라벨.
  FOOT_VISIT_PURPOSE_SYMPTOM_OPTIONS.forEach((o) => {
    expect(html, `플레이스홀더 누락: ${o.key}`).toContain(`{{${o.key}}}`);
    expect(html, `라벨 누락: ${o.label}`).toContain(o.label);
  });
  // 기존 방문목적(additive — 잔존).
  expect(html).toContain('{{vp_ingrown}}');
  expect(html).toContain('{{vp_other}}');
  expect(html).toContain('{{vp_other_text}}');
});

// ── AC-5: 바인딩(체크 ✔ / 미체크 빈칸 / 미치환 0) ──
test('AC-5: 증상 체크 → ✔ 렌더 / 미체크 → 빈 네모 / 미치환 {{}} 잔존 0', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  const bound = bindHtmlTemplate(html, {
    patient_name: '홍길동',
    visit_date: '2026년 07월 31일',
    issue_date: '2026년 07월 31일',
    clinic_name: '오블리브 풋센터 종로',
    doctor_name: '문지은',
    // 증상 3종만 체크(vp_sym0/vp_sym2/vp_sym8), 나머지는 미설정.
    vp_sym0: '✔',
    vp_sym2: '✔',
    vp_sym8: '✔',
  });
  // 체크된 증상 라벨 존재 + ✔ 마크 삽입.
  expect(bound).toContain('발톱 변색 및 변형');
  expect(bound).toContain('발가락 통증');
  expect(bound).toContain('울퉁불퉁한 발톱');
  expect(bound).toContain('✔');
  // 미치환 {{}} 잔존 0 (미체크 키는 '' 치환 → 빈 네모).
  expect(bound).not.toMatch(/\{\{\s*\w+\s*\}\}/);
});

// ── AC-6(회귀 0): 타 HTML 서류에 vp_sym 마커 미침투 ──
test('AC-6(회귀 0): 기존 HTML 서류에 vp_sym 마커 미침투', () => {
  for (const k of ['bill_receipt_new', 'bill_detail', 'koh_result', 'diagnosis', 'visit_confirm']) {
    const tpl = getHtmlTemplate(k);
    expect(tpl).not.toBeNull();
    expect(tpl!).not.toContain('{{vp_sym0}}');
    expect(tpl!).not.toContain('울퉁불퉁한 발톱');
  }
});

// ── AC-7: 실 브라우저 렌더 self-check ──
test('AC-7: 발행 인쇄물 렌더 self-check(증상 9종 + 기타 표시)', async ({ page }) => {
  const html = getHtmlTemplate(NEW_KEY)!;
  const bindVals: Record<string, string> = {
    patient_name: '홍길동',
    patient_birthdate: '1990년 05월 15일',
    patient_phone: '010-1234-5678',
    visit_date: '2026년 07월 31일',
    issue_date: '2026년 07월 31일',
    clinic_name: '오블리브 풋센터 종로',
    doctor_name: '문지은',
    doctor_seal_html: '<span style="border:1px solid #a00;border-radius:50%;padding:8px;color:#a00;">문지은</span>',
    institution_seal_html: '<span style="border:1px solid #a00;border-radius:50%;padding:8px;color:#a00;">法人</span>',
    procedure_rx_html: '<span style="display:block;">- SZ035-30 · 비가열레이저</span>',
    diagnosis_codes_html: '<span style="display:block;">- L60.0 · 조갑감입증</span>',
    symptom_progress: '초진 대비 통증 호전.',
    vp_other: '✔', vp_other_text: '발톱 주변 통증',
  };
  // 증상 9종 전부 체크(실렌더 라벨 노출 확인).
  FOOT_VISIT_PURPOSE_SYMPTOM_OPTIONS.forEach((o) => { bindVals[o.key] = '✔'; });
  const bound = bindHtmlTemplate(html, bindVals);
  await page.setViewportSize({ width: 900, height: 1600 });
  await page.setContent(`<div style="width:794px;margin:0 auto;">${bound}</div>`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('text=초 진 관 리 기 록 지')).toBeVisible();
  for (const o of FOOT_VISIT_PURPOSE_SYMPTOM_OPTIONS) {
    await expect(page.locator(`text=${o.label}`).first()).toBeVisible();
  }
  await expect(page.locator('text=기타:').first()).toBeVisible();
  await page.screenshot({
    path: 'test-results/T-20260731-foot-FIRSTVISIT-VISITPURPOSE-SYMPTOMS-render.png',
    fullPage: true,
  });
});
