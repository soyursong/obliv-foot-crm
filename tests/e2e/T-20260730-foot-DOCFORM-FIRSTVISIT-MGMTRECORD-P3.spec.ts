/**
 * E2E Spec — T-20260730-foot-DOCFORM-FIRSTVISIT-MGMTRECORD-P3
 *
 * 초진 관리기록지 field-soak 후속 정리 6건 (base=T-20260729-...-P2, deployed).
 * 격리 불변식: 「초진 관리기록지 발행」 팝업 1개 화면만 변경. 의사 마스터/서비스관리/슈퍼상용구 READ-ONLY. db_change:false.
 *
 * 검증 전략(P2 QA 승인 패턴 계승 — 소스 구조 가드 + HTML 템플릿 무결성 + 실 브라우저 렌더 self-check; 실서버/auth 불필요):
 *   item1/AC-1  상단 제목 표준 헤더 통일 + 영어 문장(FIRST-VISIT MANAGEMENT RECORD) 제거.
 *   item2/AC-2  담당의사 실시간 연동 = staff_id 브릿지 조인(Option A, planner MSG-uhdw 승인) + 항목명 '담당의사' + NULL행 HIDE.
 *   item3/AC-3  방문목적 [기타] 선택 시 자유 입력칸(vp_other_text) 조건부 노출 → 인쇄 바인딩.
 *   item4/AC-4  '시술 및 처방' = 서비스관리 4개 카테고리(기본/검사/풋케어/수액)만 optgroup 그룹 나열.
 *   item5/AC-5  증상경과 입력칸 약 3배(rows 9 / 인쇄 130px) + 상용구 소스 진료관리>슈퍼상용구(super_phrases) 전환.
 *   item6/AC-6  고객정보 블록(성명·생년월일·연락처·초진일·증상발생경위·피부상태)을 담당의사 항목 하단으로 이동.
 *   AC-7        renderEditableField 단일 헬퍼 재사용(이중구현 금지) + 타 HTML 서류 무접촉(회귀 0).
 *
 * 실행: npx playwright test T-20260730-foot-DOCFORM-FIRSTVISIT-MGMTRECORD-P3.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FALLBACK_TEMPLATES, FORM_META } from '../../src/lib/formTemplates';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEW_KEY = 'first_visit_mgmt_record';
const REPO = resolve(__dirname, '../..');
const panelSrc = readFileSync(resolve(REPO, 'src/components/DocumentPrintPanel.tsx'), 'utf8');

// ── item1 / AC-1: 상단 제목 표준 헤더 통일 + 영어 문장 제거 ──
test('AC-1: 상단 제목 표준 헤더 유지 + 영어 부제(FIRST-VISIT MANAGEMENT RECORD) 제거', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  expect(html).toContain('초 진 관 리 기 록 지');
  expect(html).toContain('class="title"');
  // 영어 문장 제거(제목 아래 영문 부제 없음).
  expect(html).not.toContain('FIRST-VISIT MANAGEMENT RECORD');
  expect(html).not.toContain('class="subtitle"');
});

// ── item2 / AC-2: 담당의사 실시간 연동 = staff_id 브릿지 조인(Option A) + 항목명 + NULL=HIDE ──
test('AC-2①: 담당의사 소스 = clinic_doctors.staff_id 브릿지로 직원공간 원장 role active 조인', () => {
  // clinic_doctors 조회에 staff_id 브릿지 키 포함.
  expect(panelSrc).toMatch(/from\('clinic_doctors'\)[\s\S]*?select\('id, name, is_default, staff_id'\)/);
  // 직원공간 staff 원장 role active id 집합 로드(SSOT).
  expect(panelSrc).toMatch(/from\('staff'\)[\s\S]*?\.eq\('role', 'director'\)[\s\S]*?\.eq\('active', true\)/);
  expect(panelSrc).toContain('setMgmtActiveDirectorStaffIds');
  // 브릿지 조인 = clinic_doctors.staff_id ∈ active director id 집합.
  expect(panelSrc).toMatch(/mgmtActiveDirectorStaffIds\.has\(d\.staff_id\)/);
  // 구 name-matching 방식 잔존 금지(Option A 로 재배선 완결).
  expect(panelSrc).not.toContain('mgmtActiveDoctorNames');
});

test('AC-2②: 항목명 = 초진 관리기록지에서 "담당의사" (타 서류는 면허번호·직인 라벨 유지)', () => {
  expect(panelSrc).toMatch(/form_key === 'first_visit_mgmt_record' \? '담당의사' : '면허번호·직인 기준 의사 선택'/);
});

test('AC-2③(NULL=HIDE): staff_id 미링크(NULL) 행은 담당의사 목록에서 숨김 + backfill warn', () => {
  const memoBlock = panelSrc.slice(
    panelSrc.indexOf('const visibleClinicDoctors'),
    panelSrc.indexOf('const visibleClinicDoctors') + 900,
  );
  // 미링크(!d.staff_id) → return false (HIDE).
  expect(memoBlock).toMatch(/if \(!d\.staff_id\)[\s\S]*?return false/);
  // 안전장치: silent drop 방지 dev-console warn.
  expect(memoBlock).toContain('console.warn');
  // mgmt 외 서류는 격리(기존 clinicDoctors 그대로).
  expect(memoBlock).toMatch(/form_key !== 'first_visit_mgmt_record'[\s\S]*?return clinicDoctors/);
});

// ── item3 / AC-3: 방문목적 기타칸(vp_other_text) 조건부 입력 ──
test('AC-3: 방문목적 [기타] 체크 시 vp_other_text 자유 입력칸 조건부 노출 + 인쇄 바인딩', () => {
  // 조건부 렌더: 방문 목적 그룹 + vp_other 체크 시.
  expect(panelSrc).toContain('data-testid="fvmr-vp-other-text"');
  expect(panelSrc).toMatch(/grp\.label === '방문 목적'[\s\S]*?vp_other[\s\S]*?FIRST_VISIT_MGMT_CHECK_MARK/);
  expect(panelSrc).toContain("updateField('vp_other_text'");
  // 인쇄 템플릿에 {{vp_other_text}} 바인딩 존재.
  const html = getHtmlTemplate(NEW_KEY)!;
  expect(html).toContain('{{vp_other_text}}');
});

// ── item4 / AC-4: 시술 및 처방 = 4개 카테고리만 그룹 나열 ──
test('AC-4: 시술및처방 드롭다운 = 서비스관리 4개 카테고리(기본/검사/풋케어/수액) optgroup 그룹 나열', () => {
  expect(panelSrc).toMatch(/FVMR_PROCEDURE_CATEGORIES = \['기본', '검사', '풋케어', '수액'\]/);
  // 서비스관리 동일 기준(category_label ?? category) 폴백.
  expect(panelSrc).toMatch(/category_label \?\? s\.category \?\? ''/);
  // optgroup 그룹핑 + 4카테고리 필터 렌더.
  expect(panelSrc).toMatch(/FVMR_PROCEDURE_CATEGORIES\.map\(\(cat\)/);
  expect(panelSrc).toContain('<optgroup');
  // 카테고리 소스 select 에 category 포함.
  expect(panelSrc).toMatch(/from\('services'\)[\s\S]*?select\('id, name, service_code, category_label, category'\)/);
});

// ── item5 / AC-5: 증상경과 3배 확대 + 슈퍼상용구 소스 ──
test('AC-5: 증상경과 입력칸 3배(rows 9 / 인쇄 130px) + 슈퍼상용구(super_phrases) 소스 전환', () => {
  // 입력 textarea rows 확대.
  const taBlock = panelSrc.slice(
    panelSrc.indexOf('data-testid="fvmr-symptom-progress"'),
    panelSrc.indexOf('data-testid="fvmr-symptom-progress"') + 400,
  );
  expect(taBlock).toContain('rows={9}');
  // 인쇄 박스 3배(130px).
  const html = getHtmlTemplate(NEW_KEY)!;
  expect(html).toMatch(/증상경과[\s\S]*?height:130px/);
  // 상용구 소스 = 진료관리>슈퍼상용구(super_phrases.clinical_progress), 구 펜차트(phrase_templates/pen_chart) 미사용.
  expect(panelSrc).toContain("from('super_phrases')");
  expect(panelSrc).toContain('clinical_progress');
  const loader = panelSrc.slice(
    panelSrc.indexOf('초진 관리기록지 전용 소스 로드'),
    panelSrc.indexOf('초진 관리기록지 전용 소스 로드') + 1800,
  );
  expect(loader).not.toContain("from('phrase_templates')");
  expect(loader).not.toContain("'pen_chart'");
});

// ── item6 / AC-6: 고객정보 블록을 담당의사 하단으로 이동 ──
test('AC-6: 고객정보 블록(6필드)을 담당의사 하단 전용 블록으로 이동 + 하단 일반 루프 제외(중복 방지)', () => {
  // 이동 대상 키 집합 정의(6필드).
  for (const k of ['patient_name', 'patient_birthdate', 'patient_phone', 'visit_date', 'symptom_history', 'skin_status']) {
    expect(panelSrc, `CUSTOMER_INFO_KEYS 누락: ${k}`).toContain(`'${k}'`);
  }
  // 담당의사 하단 전용 블록 렌더(fvmr-customer-info).
  expect(panelSrc).toContain('data-testid="fvmr-customer-info"');
  expect(panelSrc).toMatch(/FIRST_VISIT_MGMT_CUSTOMER_INFO_KEYS\.map\(\(key\)/);
  // 하단 일반 루프에서 relocated 키 제외.
  expect(panelSrc).toMatch(/!FIRST_VISIT_MGMT_RELOCATED_KEYS\.has\(f\.key\)/);
});

// ── AC-7: 이중구현 금지(단일 헬퍼 재사용) + 타 서류 회귀 0 ──
test('AC-7: renderEditableField 단일 헬퍼 재사용(이중구현 금지)', () => {
  // 헬퍼 정의 1회 + 상단(고객정보)·하단(일반) 양쪽에서 재사용.
  const defCount = (panelSrc.match(/const renderEditableField = /g) ?? []).length;
  expect(defCount).toBe(1);
  const useCount = (panelSrc.match(/renderEditableField\(f\)/g) ?? []).length;
  expect(useCount).toBeGreaterThanOrEqual(2);
});

test('AC-7(회귀 0): 기존 HTML 서류에 개편 마커 미침투', () => {
  for (const k of ['bill_receipt_new', 'bill_detail', 'koh_result', 'diagnosis', 'visit_confirm']) {
    const tpl = getHtmlTemplate(k);
    expect(tpl).not.toBeNull();
    expect(tpl!).not.toContain('{{vp_other_text}}');
    expect(tpl!).not.toContain('초 진 관 리 기 록 지');
  }
});

// ── field_map 정합: relocated 키 존재(이동일 뿐 삭제 아님) + FORM_META ──
test('field_map: 이동 대상 키 유지(삭제 아님) + vp_other_text 존재', () => {
  const fb = FALLBACK_TEMPLATES.find((t) => t.form_key === NEW_KEY)!;
  expect(fb).toBeTruthy();
  const keys = fb.field_map.map((f) => f.key);
  for (const keep of ['patient_name', 'patient_birthdate', 'patient_phone', 'visit_date', 'symptom_history', 'skin_status', 'vp_other_text']) {
    expect(keys, `field_map 키 누락: ${keep}`).toContain(keep);
  }
  expect(FORM_META[NEW_KEY]).toBeTruthy();
});

// ── 바인딩: vp_other_text 삽입 + 미치환 {{}} 잔존 0 ──
test('바인딩: vp_other_text 인쇄 삽입 + 미치환 {{}} 잔존 0', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  const bound = bindHtmlTemplate(html, {
    patient_name: '홍길동',
    visit_date: '2026년 07월 30일',
    issue_date: '2026년 07월 30일',
    clinic_name: '오블리브 풋센터 종로',
    doctor_name: '문지은',
    vp_other: '✔',
    vp_other_text: '발톱 주변 통증 상담',
    symptom_progress: '초진 대비 호전',
  });
  expect(bound).toContain('발톱 주변 통증 상담');
  expect(bound).not.toMatch(/\{\{\s*\w+\s*\}\}/);
});

// ── 발행 인쇄물 렌더 self-check(실 브라우저 렌더) ──
test('발행 인쇄물 렌더 self-check(제목 통일·영문 부재·증상경과 확대)', async ({ page }) => {
  const html = getHtmlTemplate(NEW_KEY)!;
  const bound = bindHtmlTemplate(html, {
    patient_name: '홍길동',
    patient_birthdate: '1990년 05월 15일',
    patient_phone: '010-1234-5678',
    visit_date: '2026년 07월 30일',
    issue_date: '2026년 07월 30일',
    clinic_name: '오블리브 풋센터 종로',
    doctor_name: '문지은',
    doctor_seal_html: '<span style="border:1px solid #a00;border-radius:50%;padding:8px;color:#a00;">문지은</span>',
    institution_seal_html: '<span style="border:1px solid #a00;border-radius:50%;padding:8px;color:#a00;">法人</span>',
    procedure_rx_html: '<span style="display:block;">- SZ035-30 · 비가열레이저</span>',
    diagnosis_codes_html: '<span style="display:block;">- L60.0 · 조갑감입증</span>',
    symptom_progress: '초진 대비 통증 호전. 발적 감소 확인.',
    vp_other: '✔', vp_other_text: '발톱 주변 통증', pain_yes: '✔',
  });
  await page.setViewportSize({ width: 900, height: 1400 });
  await page.setContent(`<div style="width:794px;margin:0 auto;">${bound}</div>`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('text=초 진 관 리 기 록 지')).toBeVisible();
  await expect(page.locator('text=시술 및 처방')).toBeVisible();
  await expect(page.locator('text=증상경과')).toBeVisible();
  // 영문 부제 부재.
  await expect(page.locator('text=FIRST-VISIT MANAGEMENT RECORD')).toHaveCount(0);
  await page.screenshot({
    path: 'test-results/T-20260730-foot-DOCFORM-FIRSTVISIT-MGMTRECORD-P3-render.png',
    fullPage: true,
  });
});
