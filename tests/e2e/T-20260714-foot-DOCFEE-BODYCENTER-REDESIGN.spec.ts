/**
 * T-20260714-foot-DOCFEE-BODYCENTER-REDESIGN
 *
 * 진료비 계산서·영수증 '신양식'(form_key=bill_receipt_new) 코드-레벨 불변식.
 * 핵심 = AC3 정정: 대표자란 = 개설자 박영진(clinics.representative_name canonical) → {{receipt_representative}} 토큰.
 *   前 스펙(대표자={{doctor_name}} 진료의)은 폐기(policy_superseded). 진료의 축 서류({{doctor_name}})는 무접촉.
 *
 * 라이브 앱 브라우저 회귀가 아니라 템플릿 렌더/바인딩/격리 불변식을 강제(로그인 불요, 결정론적).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');
const BIND_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/autoBindContext.ts'), 'utf8');
const FT_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/formTemplates.ts'), 'utf8');

function extractNewTemplate(): string {
  const m = HTML_SRC.match(/const BILL_RECEIPT_NEW_HTML\s*=\s*`([\s\S]*?)`;/);
  expect(m, 'BILL_RECEIPT_NEW_HTML 상수 존재').not.toBeNull();
  return m![1];
}

test.describe('DOCFEE 신양식 — AC3 대표자=박영진 rebind + 축 격리', () => {
  test('AC3: 신양식 대표자 셀 = {{receipt_representative}} (진료의 doctor_name 아님)', () => {
    const tpl = extractNewTemplate();
    // 대표자 라벨 다음 셀이 receipt_representative 토큰으로 시작해야 한다.
    //   T-20260715-foot-RECEIPT-REPNAME-SEAL-BODYPORT(co-deploy)가 근방에 법인 도장
    //   ({{institution_seal_html}})을 append → 토큰 뒤 trailing 도장 허용.
    expect(tpl).toMatch(/대표자<\/td>\s*<td[^>]*>\{\{receipt_representative\}\}/);
    // 前 스펙(폐기): 신양식 어디에도 {{doctor_name}}/{{doctor_seal_html}} 바인딩이 없어야 한다(진료의 축 오염 금지).
    expect(tpl).not.toContain('{{doctor_name}}');
    expect(tpl).not.toContain('{{doctor_seal_html}}');
  });

  test('AC3: 렌더 시 대표자 셀에 박영진이 찍히고 진료의명은 안 찍힘', async ({ page }) => {
    const tpl = extractNewTemplate();
    const html = tpl
      .replace(/\{\{receipt_representative\}\}/g, '박영진')
      // 진료의명이 신양식에 유입되지 않음을 검증하기 위한 distinct sentinel
      .replace(/\{\{patient_name\}\}/g, '환자샘플')
      .replace(/\{\{[a-z_]+\}\}/g, '');
    await page.setContent(`<!doctype html><html><body>${html}</body></html>`, { waitUntil: 'networkidle' });
    const body = await page.locator('body').innerText();
    expect(body).toContain('박영진');
    expect(body).not.toContain('홍길동'); // 진료의 sentinel 미유입(신양식에 doctor_name 토큰 부재)
  });

  test('AC4: 진료과목=피부과 · 사업자등록번호=511-60-00988 · 전화=02-6956-3438 고정 표기', async ({ page }) => {
    const tpl = extractNewTemplate().replace(/\{\{[a-z_]+\}\}/g, '샘플');
    await page.setContent(`<!doctype html><html><body>${tpl}</body></html>`, { waitUntil: 'networkidle' });
    const body = await page.locator('body').innerText();
    expect(body).toContain('피부과');
    expect(body).toContain('511-60-00988');
    expect(body).toContain('02-6956-3438');
    expect(body).toContain('별지 제6호서식');
  });

  test('AC7 B안: 공단부담금 라인/칸 표시 유지 (합계에서만 제외)', async ({ page }) => {
    const tpl = extractNewTemplate().replace(/\{\{[a-z_]+\}\}/g, '샘플');
    await page.setContent(`<!doctype html><html><body>${tpl}</body></html>`, { waitUntil: 'networkidle' });
    const body = await page.locator('body').innerText();
    // 공단부담 항목·합계·⑦공단부담 총액 라인 표시 유지
    expect(body).toContain('공단부담금');
    expect(body).toContain('공단부담 총액');
    // ⑧ 환자부담 총액(공단 제외 = 본인+비급여) 라인 존재
    expect(body).toContain('환자부담 총액');
  });

  test('AC5 격리: 기존 bill_receipt 매핑은 BILL_RECEIPT_HTML 유지, 신양식은 별도 상수', () => {
    // 기존 라이브 매핑 무접촉
    expect(HTML_SRC).toMatch(/bill_receipt:\s*BILL_RECEIPT_HTML/);
    // 신양식 매핑은 신규 form_key 전용
    expect(HTML_SRC).toMatch(/bill_receipt_new:\s*BILL_RECEIPT_NEW_HTML/);
  });

  test('축 격리: 진료의 축 서류(진단서/처방전 등)는 여전히 {{doctor_name}} 사용', () => {
    // 신양식 외의 임상 서류는 doctor_name 축을 그대로 유지해야 한다(축 오염 회귀 금지).
    expect(HTML_SRC).toContain('{{doctor_name}}');
  });

  test('바인딩 소스: receipt_representative = clinics.representative_name canonical + 박영진 폴백', () => {
    // autoBindContext 가 receipt_representative 토큰을 clinics.representative_name 에서 채우고,
    // 부재/공란 시 개설자 박영진으로 affirmative 폴백(빈 대표자 금지).
    expect(BIND_SRC).toMatch(/receipt_representative:\s*\(ctx\.clinic\?\.representative_name\s*\|\|\s*'박영진'\)/);
    // clinics SELECT 에 representative_name 이 포함되어 있어야 한다.
    expect(BIND_SRC).toContain('representative_name');
  });

  test('FALLBACK 템플릿 field_map 정합: receipt_representative 키 포함, doctor_name(대표자) 미포함', () => {
    // bill_receipt_new fallback 정의 블록 추출
    const block = FT_SRC.match(/form_key:\s*'bill_receipt_new'[\s\S]*?sort_order:\s*36,\s*\},/);
    expect(block, 'bill_receipt_new fallback 정의 존재').not.toBeNull();
    expect(block![0]).toContain("key: 'receipt_representative'");
    expect(block![0]).not.toMatch(/key:\s*'doctor_name'/);
  });
});
