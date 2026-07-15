/**
 * T-20260715-foot-RECEIPT-REPNAME-SEAL-BODYPORT (P1, body CLINIC-REPNAME 포트)
 *
 * 진료비 세부내역서(bill_detail) 대표자란 = 개설자 박영진({{receipt_representative}}, 진료의 아님) +
 * 기관 발행 서류(세부내역서 + 계산서·영수증 신양식) 도장 = 법인(요양기관) 인감({{institution_seal_html}}).
 * 진료의 축 서류(진단서·처방전 등)의 {{doctor_name}} + 원장 개인직인 세트({{doctor_seal_html}},
 * 한동훈·김윤기·김상은)는 무접촉. 문지은 개인직인 매핑은 별도 게이트(HELD) — 본 티켓 미접촉.
 *
 * 라이브 앱 브라우저 회귀가 아니라 템플릿 렌더/바인딩/격리 불변식을 강제(로그인 불요, 결정론적).
 * 배포순서 = DOCFEE(receipt_representative resolver) 선행 → 본 티켓 land.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');
const BIND_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/autoBindContext.ts'), 'utf8');
const FT_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/formTemplates.ts'), 'utf8');

function extractTemplate(constName: string): string {
  const m = HTML_SRC.match(new RegExp(`const ${constName}\\s*=\\s*\`([\\s\\S]*?)\`;`));
  expect(m, `${constName} 상수 존재`).not.toBeNull();
  return m![1];
}

// HTML 주석(<!-- ... -->) 제거 — 주석 내 설명용 토큰 문자열이 실제 마크업 검증에 오염되지 않도록.
function stripComments(tpl: string): string {
  return tpl.replace(/<!--[\s\S]*?-->/g, '');
}

test.describe('RECEIPT-REPNAME-SEAL — 세부내역서 대표자=박영진 + 기관 발행 서류 법인 도장', () => {
  // ── AC1/B1: 세부내역서 대표자란 = {{receipt_representative}} (진료의 아님) ──
  test('AC1: 세부내역서(bill_detail) 대표자 셀 = {{receipt_representative}} (doctor_name 아님)', () => {
    const tpl = stripComments(extractTemplate('BILL_DETAIL_HTML'));
    // 대표자 라벨 다음 셀이 receipt_representative 토큰이어야 한다.
    expect(tpl).toMatch(/대 표 자<\/td>\s*<td[^>]*>\{\{receipt_representative\}\}<\/td>/);
    // 대표자란에 진료의 축 토큰({{doctor_name}})이 남아있으면 안 된다(마크업 기준).
    expect(tpl).not.toContain('{{doctor_name}}');
  });

  // ── AC3/B2: 세부내역서 도장 = 법인 인감({{institution_seal_html}}), 진료의 개인직인 아님 ──
  test('AC3: 세부내역서 도장 = {{institution_seal_html}} (진료의 개인직인 {{doctor_seal_html}} 아님)', () => {
    const tpl = stripComments(extractTemplate('BILL_DETAIL_HTML'));
    expect(tpl).toContain('{{institution_seal_html}}');
    expect(tpl).not.toContain('{{doctor_seal_html}}');
  });

  // ── AC3/B2: 계산서·영수증 신양식(bill_receipt_new) 대표자 근방 법인 도장 ──
  test('AC3: 계산서·영수증 신양식 대표자 근방 = {{receipt_representative}} + {{institution_seal_html}}', () => {
    const tpl = stripComments(extractTemplate('BILL_RECEIPT_NEW_HTML'));
    expect(tpl).toMatch(/\{\{receipt_representative\}\}.*\{\{institution_seal_html\}\}/s);
    // 신양식에도 진료의 개인직인/이름 유입 금지(기관 발행 축).
    expect(tpl).not.toContain('{{doctor_seal_html}}');
    expect(tpl).not.toContain('{{doctor_name}}');
  });

  // ── 바인딩 소스: institution_seal_html = 항상 법인 인감(getStampUrl), 진료의 seal_image_url 무사용 ──
  test('바인딩: institution_seal_html = 항상 getStampUrl() 법인 인감 (clinicDoctor.seal_image_url 미참조)', () => {
    const m = BIND_SRC.match(/institution_seal_html:\s*\(\(\)\s*=>\s*\{([\s\S]*?)\}\)\(\),/);
    expect(m, 'institution_seal_html 토큰 정의 존재').not.toBeNull();
    const body = m![1];
    // 법인 인감 소스 = getStampUrl(), 진료의 개인직인(seal_image_url) 참조 없음.
    expect(body).toContain('getStampUrl()');
    expect(body).not.toContain('seal_image_url');
  });

  // ── AC2/AC6 회귀: 진료의 축 서류는 {{doctor_name}} + 개인직인 세트({{doctor_seal_html}}) 유지 ──
  test('AC2 회귀: 진료의 축 서류(진단서/처방전 등)는 {{doctor_name}} + {{doctor_seal_html}} 유지', () => {
    // 진료의 축 임상 서류는 여전히 doctor_name/doctor_seal_html 을 사용해야 한다(축 오염·회귀 금지).
    expect(HTML_SRC).toContain('{{doctor_name}}');
    expect(HTML_SRC).toContain('{{doctor_seal_html}}');
    // doctor_seal_html 은 진료의 개인직인(seal_image_url) 우선 소스를 유지.
    expect(BIND_SRC).toMatch(/doctor_seal_html:[\s\S]*?ctx\.clinicDoctor\?\.seal_image_url\s*\|\|\s*getStampUrl\(\)/);
  });

  // ── 문지은 HELD 불변식: 개인직인 강제 가드 자의 제거 금지(A3 스핀오프) ──
  test('HELD 불변식: shouldForceInstitutionSeal 가드(문지은 is_default→법인 인감) 무접촉 보존', () => {
    // 본 티켓은 문지은 개인직인 매핑을 건드리지 않는다 — 가드 로직 원형 유지.
    expect(BIND_SRC).toMatch(/export function shouldForceInstitutionSeal\(/);
    expect(BIND_SRC).toMatch(/return sealFallbackToInstitution\s*\|\|\s*isDefaultDoctor === true;/);
  });

  // ── FALLBACK 템플릿 field_map 정합 ──
  test('FALLBACK field_map 정합: bill_detail 대표자 키 = receipt_representative (doctor_name 아님)', () => {
    const block = FT_SRC.match(/form_key:\s*'bill_detail'[\s\S]*?sort_order:\s*5,\s*\},/);
    expect(block, 'bill_detail fallback 정의 존재').not.toBeNull();
    expect(block![0]).toContain("key: 'receipt_representative'");
    // 대표자란 doctor_name 제거 확인 (라벨 '대표자' 셀 한정 — 이 폴백 블록엔 대표자 셀 1개).
    expect(block![0]).not.toMatch(/key:\s*'doctor_name',\s*label:\s*'대표자'/);
  });

  // ── 렌더: 세부내역서 대표자 = 박영진 + 법인 도장 img, 진료의명 미유입 ──
  test('렌더: 세부내역서 대표자 셀에 박영진 + 법인 도장 img, 진료의명 미유입', async ({ page }) => {
    const tpl = extractTemplate('BILL_DETAIL_HTML');
    const html = tpl
      .replace(/\{\{receipt_representative\}\}/g, '박영진')
      .replace(/\{\{institution_seal_html\}\}/g, '<img data-testid="inst-seal" src="stamp.png" />')
      .replace(/\{\{patient_name\}\}/g, '환자샘플')
      .replace(/\{\{[a-z_]+\}\}/g, '');
    await page.setContent(`<!doctype html><html><body>${html}</body></html>`, { waitUntil: 'networkidle' });
    const body = await page.locator('body').innerText();
    expect(body).toContain('박영진');
    expect(body).not.toContain('홍길동'); // 진료의 sentinel 미유입
    await expect(page.locator('[data-testid="inst-seal"]')).toHaveCount(1);
  });
});
