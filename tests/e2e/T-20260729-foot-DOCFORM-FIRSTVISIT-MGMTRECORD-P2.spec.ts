/**
 * E2E Spec — T-20260729-foot-DOCFORM-FIRSTVISIT-MGMTRECORD-P2
 *
 * 초진 관리기록지 발행 팝업 7건 개편 (base=T-20260728-DOCFORM-FIRSTVISIT-MGMTRECORD, deployed).
 * 격리 불변식: 「초진 관리기록지 발행」 팝업 1개 화면만 변경. 결제/진단코드 원본·상용구 원본 READ-ONLY 재사용.
 *
 * 검증 전략 (base 티켓 QA 승인 패턴 계승 — SSOT 단위 + HTML 템플릿 무결성 + 소스 구조 가드; 실서버/auth 불필요):
 *   AC-1 의사선택 UI 단일화 — DocumentPrintPanel 소스: 근무캘린더('서류 발행 원장님 선택') 배너가
 *        form_key !== 'first_visit_mgmt_record' 로 게이트(mgmt 에서 숨김). 면허번호·직인 배너는 무조건 유지.
 *   AC-2 관리부위·발가락·초진촬영기록 섹션 제거 — HTML/체크그룹 마커 부재.
 *   AC-3 기타확인·발톱상태·관리계획 섹션 제거 — HTML/field_map 마커 부재.
 *   AC-4 '초기 관리 내용'→'시술 및 처방' + 치료코드 드롭다운({{procedure_rx_html}}, fvmr-procedure-select).
 *   AC-5 상병명 진단코드 드롭다운 신규({{diagnosis_codes_html}}, fvmr-diagnosis-select).
 *   AC-6 증상경과 자유텍스트+상용구({{symptom_progress}}, fvmr-symptom-progress + fvmr-phrase-buttons).
 *   AC-7 담당의사 서명란 2열(성함·직인 / 병원명·법인도장) — {{doctor_seal_html}} + {{institution_seal_html}}.
 *   AC-9 read-only 재사용 — services/phrase_templates 는 select 만(write 없음). 마이그레이션 무DDL(ADDITIVE UPDATE).
 *   AC-10 발행 인쇄물 렌더 스크린샷 self-check(브라우저 setContent 렌더 캡처).
 *
 * 실행: npx playwright test T-20260729-foot-DOCFORM-FIRSTVISIT-MGMTRECORD-P2.spec.ts
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  FALLBACK_TEMPLATES,
  FORM_META,
  type FormTemplate,
} from '../../src/lib/formTemplates';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEW_KEY = 'first_visit_mgmt_record';
const REPO = resolve(__dirname, '../..');
const panelSrc = readFileSync(resolve(REPO, 'src/components/DocumentPrintPanel.tsx'), 'utf8');
const migSrc = readFileSync(
  resolve(REPO, 'supabase/migrations/20260729193000_foot_mgmtrecord_7field_revise_fieldmap.sql'),
  'utf8',
);

// ── AC-1: 의사 선택 UI 단일화 (근무캘린더 배너 mgmt 에서 숨김, 면허·직인 배너 유지) ──
test('AC-1: 근무캘린더 원장 배너가 초진 관리기록지에서 게이트로 숨겨짐(면허·직인 단일 UI)', () => {
  // '서류 발행 원장님 선택' 배너 조건에 mgmt 제외 게이트가 있어야 한다.
  expect(panelSrc).toMatch(
    /dutyDoctors\.length > 1 && template\.form_key !== 'first_visit_mgmt_record'/,
  );
  // 면허번호·직인 배너는 form_key 게이트 없이 유지(단일 UI 로 남음).
  expect(panelSrc).toContain('면허번호·직인 기준 의사 선택');
  expect(panelSrc).toContain('서류 발행 원장님 선택');
});

// ── AC-2 / AC-3: 제거 섹션 마커 부재 (HTML 템플릿) ──
test('AC-2/AC-3: 관리부위·발가락·초진촬영기록·기타확인·발톱상태·관리계획 마커 제거', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  for (const gone of [
    '관리 부위', '좌(L)', '우(R)', '엄지', '둘째', '셋째', '넷째', '다섯째',   // 관리부위·발가락
    '사진 촬영 완료', '촬영하지 않음', '초진 시 촬영 기록',                      // 초진촬영기록
    '기타 확인 사항', '발톱 상태', '관리 계획',                                  // 기타확인·발톱상태·관리계획
    '초기 관리 내용', '발톱 정리', '문제성 발톱 관리', '압력 감소 조치', '보호패드 적용', // 구 초기관리 체크박스
  ]) {
    expect(html, `제거 대상 마커 잔존: ${gone}`).not.toContain(gone);
  }
});

test('AC-2: 제거된 체크그룹이 DocumentPrintPanel 체크그룹 상수에서 삭제됨', () => {
  // 잔존 체크그룹 = 방문 목적 / 통증 여부 / 보행 불편 만.
  const groupsBlock = panelSrc.slice(
    panelSrc.indexOf('FIRST_VISIT_MGMT_CHECK_GROUPS'),
    panelSrc.indexOf('interface InvoiceDoc'),
  );
  expect(groupsBlock).toContain("label: '방문 목적'");
  expect(groupsBlock).toContain("label: '통증 여부'");
  expect(groupsBlock).toContain("label: '보행 불편'");
  expect(groupsBlock).not.toContain("label: '관리 부위 (좌/우)'");
  expect(groupsBlock).not.toContain("label: '발가락'");
  expect(groupsBlock).not.toContain("label: '초진 시 촬영 기록'");
  expect(groupsBlock).not.toContain("label: '초기 관리 내용'");
});

// ── AC-4: 시술 및 처방 (개명 + 치료코드 드롭다운) ──
test('AC-4: 초기 관리 내용 → 시술 및 처방 + 치료코드 드롭다운 배선', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  expect(html).toContain('시술 및 처방');
  expect(html).toContain('{{procedure_rx_html}}');
  // 드롭다운 UI + 소스 필터(비-상병 서비스) 존재.
  expect(panelSrc).toContain('data-testid="fvmr-procedure-select"');
  expect(panelSrc).toMatch(/category_label \?\? ''\) !== '상병'/);
});

// ── AC-5: 상병명 진단코드 드롭다운 신규 ──
test('AC-5: 상병명 진단코드 드롭다운 신규 배선', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  expect(html).toContain('상병명');
  expect(html).toContain('{{diagnosis_codes_html}}');
  expect(panelSrc).toContain('data-testid="fvmr-diagnosis-select"');
  expect(panelSrc).toMatch(/category_label \?\? ''\) === '상병'/);
});

// ── AC-6: 증상경과 자유텍스트 + 상용구(펜차트 재사용) ──
test('AC-6: 증상경과 자유텍스트 + 상용구 버튼(phrase_templates pen_chart 재사용)', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  expect(html).toContain('증상경과');
  expect(html).toContain('{{symptom_progress}}');
  expect(panelSrc).toContain('data-testid="fvmr-symptom-progress"');
  expect(panelSrc).toContain('data-testid="fvmr-phrase-buttons"');
  // 펜차트 상용구 시스템 재사용(phrase_type='pen_chart').
  expect(panelSrc).toContain("from('phrase_templates')");
  expect(panelSrc).toMatch(/phrase_type'?,?\s*'pen_chart'/);
});

// ── AC-7: 담당의사 서명란 2열 ──
test('AC-7: 인쇄물 하단 담당의사 서명란(성함·직인 / 병원명·법인도장 2열)', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  expect(html).toContain('담당의사 (성함 / 직인)');
  expect(html).toContain('병원명 (법인도장)');
  expect(html).toContain('{{doctor_seal_html}}');        // 담당의사 직인
  expect(html).toContain('{{institution_seal_html}}');   // 병원 법인도장
});

// ── AC-3: FALLBACK field_map 정리 (제거분 부재, 유지분 존재) ──
test('AC-3: FALLBACK field_map — 제거된 자유텍스트 키 부재 + 유지 키 존재', () => {
  const fb = FALLBACK_TEMPLATES.find((t) => t.form_key === NEW_KEY)!;
  expect(fb).toBeTruthy();
  const keys = fb.field_map.map((f) => f.key);
  for (const gone of ['nail_status', 'other_check', 'care_other_text', 'care_plan']) {
    expect(keys, `제거 대상 field_map 키 잔존: ${gone}`).not.toContain(gone);
  }
  for (const keep of ['patient_name', 'visit_date', 'symptom_history', 'skin_status', 'remarks', 'doctor_name']) {
    expect(keys, `유지 대상 field_map 키 누락: ${keep}`).toContain(keep);
  }
  expect(fb.template_format).toBe('html');
  expect(FORM_META[NEW_KEY]).toBeTruthy();
});

// ── 바인딩: _html raw 주입 + 증상경과 이스케이프/개행 + {{}} 잔존 0 ──
test('바인딩: 시술및처방/상병명 raw 삽입 + 증상경과 escape + 미치환 {{}} 잔존 0', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  const values: Record<string, string> = {
    patient_name: '홍길동',
    patient_phone: '010-1234-5678',
    visit_date: '2026년 07월 29일',
    issue_date: '2026년 07월 29일',
    clinic_name: '오블리브 풋센터 종로',
    doctor_name: '문지은',
    doctor_seal_html: '<img src="seal.png" />',
    institution_seal_html: '(법인인)',
    procedure_rx_html: '<span class="fvmr-code-line">- SZ035-30 · 비가열레이저</span>',
    diagnosis_codes_html: '<span class="fvmr-code-line">- L60.0 · 조갑감입증</span>',
    symptom_progress: '초진 대비 호전\n압통 감소',
    vp_ingrown: '✔', pain_yes: '✔',
  };
  const bound = bindHtmlTemplate(html, values);
  expect(bound).toContain('홍길동');
  // _html 접미사 = raw 렌더(이스케이프 안 됨) → span 그대로 삽입.
  expect(bound).toContain('<span class="fvmr-code-line">- SZ035-30 · 비가열레이저</span>');
  expect(bound).toContain('L60.0 · 조갑감입증');
  expect(bound).toContain('<img src="seal.png" />');
  // 증상경과 = 일반 필드 → 개행 <br> 변환.
  expect(bound).toContain('초진 대비 호전<br>압통 감소');
  // 미치환 {{...}} 잔존 0.
  expect(bound).not.toMatch(/\{\{\s*\w+\s*\}\}/);
});

test('엣지: 빈 값(미선택) 바인딩 — 크래시/플레이스홀더 노출 0', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  const bound = bindHtmlTemplate(html, {});
  expect(bound).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  expect(bound).toContain('초 진 관 리 기 록 지');
  expect(bound).toContain('시술 및 처방');
  expect(bound).toContain('상병명');
});

// ── AC-9: read-only 재사용 + 무DDL ADDITIVE 마이그레이션 ──
test('AC-9: 마이그레이션은 field_map UPDATE(무DDL) + 대상 form_key 한정', () => {
  expect(migSrc).toMatch(/UPDATE\s+form_templates/i);
  expect(migSrc).toContain("form_key = 'first_visit_mgmt_record'");
  // 무DDL: CREATE/ALTER/DROP TABLE·COLUMN·TYPE 없음.
  expect(migSrc).not.toMatch(/\b(CREATE|ALTER|DROP)\s+(TABLE|COLUMN|TYPE|INDEX)/i);
  // 정리된 field_map 반영(제거 키 부재).
  for (const gone of ['nail_status', 'other_check', 'care_other_text', 'care_plan']) {
    expect(migSrc).not.toContain(`"key":"${gone}"`);
  }
});

test('AC-9: services/phrase_templates 는 READ-ONLY(select 만, mgmt 경로 write 무접점)', () => {
  // mgmt 전용 로더는 select 만 사용(insert/update/delete 없음).
  const loader = panelSrc.slice(
    panelSrc.indexOf('초진 관리기록지 전용 소스 로드'),
    panelSrc.indexOf('초진 관리기록지 전용 소스 로드') + 1400,
  );
  expect(loader).toContain("from('services')");
  expect(loader).toContain("from('phrase_templates')");
  expect(loader).not.toMatch(/\.(insert|update|delete|upsert)\(/);
});

// ── AC-5(회귀 0): 타 HTML 서류 무접촉 ──
test('회귀 0: 기존 HTML 서류에 개편 마커 미침투', () => {
  for (const k of ['bill_receipt_new', 'bill_detail', 'koh_result', 'diagnosis', 'visit_confirm']) {
    const tpl = getHtmlTemplate(k);
    expect(tpl).not.toBeNull();
    expect(tpl!).not.toContain('{{procedure_rx_html}}');
    expect(tpl!).not.toContain('{{symptom_progress}}');
    expect(tpl!).not.toContain('담당의사 (성함 / 직인)');
  }
});

// ── AC-10: 발행 인쇄물 렌더 스크린샷 self-check (실 브라우저 렌더) ──
test('AC-10: 발행 인쇄물 렌더 스크린샷 self-check', async ({ page }) => {
  const html = getHtmlTemplate(NEW_KEY)!;
  const bound = bindHtmlTemplate(html, {
    patient_name: '홍길동',
    patient_birthdate: '1990년 05월 15일',
    patient_phone: '010-1234-5678',
    visit_date: '2026년 07월 29일',
    issue_date: '2026년 07월 29일',
    clinic_name: '오블리브 풋센터 종로',
    doctor_name: '문지은',
    doctor_seal_html: '<span style="border:1px solid #a00;border-radius:50%;padding:8px;color:#a00;">문지은</span>',
    institution_seal_html: '<span style="border:1px solid #a00;border-radius:50%;padding:8px;color:#a00;">法人</span>',
    procedure_rx_html:
      '<span style="display:block;">- SZ035-30 · 비가열레이저</span><span style="display:block;">- 처방약 · 무좀연고</span>',
    diagnosis_codes_html: '<span style="display:block;">- L60.0 · 조갑감입증</span>',
    symptom_progress: '초진 대비 통증 호전. 발적 감소 확인.',
    vp_ingrown: '✔', pain_yes: '✔', gait_no: '✔',
  });
  await page.setViewportSize({ width: 900, height: 1400 });
  await page.setContent(`<div style="width:794px;margin:0 auto;">${bound}</div>`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('text=초 진 관 리 기 록 지')).toBeVisible();
  await expect(page.locator('text=시술 및 처방')).toBeVisible();
  await expect(page.locator('text=상병명')).toBeVisible();
  await expect(page.locator('text=증상경과')).toBeVisible();
  await expect(page.locator('text=담당의사 (성함 / 직인)')).toBeVisible();
  await page.screenshot({
    path: 'test-results/T-20260729-foot-DOCFORM-FIRSTVISIT-MGMTRECORD-P2-render.png',
    fullPage: true,
  });
});
