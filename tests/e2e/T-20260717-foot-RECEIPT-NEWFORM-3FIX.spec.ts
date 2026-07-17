/**
 * T-20260717-foot-RECEIPT-NEWFORM-3FIX
 *
 * 진료비 계산서·영수증 '신양식'(form_key=bill_receipt_new, 별지 제6호서식) 결함 3건 수정 불변식.
 * 김주연 총괄(2026-07-17, ch C0ATE5P6JTH) 요청, 첨부 결함 스샷 F0BHUNLHPMZ 기준.
 *
 *   #1 대제목 위치 정렬 — '진료비 계산서ㆍ영수증' 제목이 우측으로 밀림(off-center). 표준서식(별지 제6호)은
 *      제목 정중앙 + 체크박스([■]외래…) 좌측. chk 를 absolute left 로 흐름 밖에 두어 제목만 정중앙 정렬.
 *   #2 진찰료 급여 본인부담금/공단부담금 컬럼 보완 — foot 급여=진찰료(footBillDetailCategory 기본→진찰료)가
 *      원천. 前: 급여 aggregate 가 '처치 및 수술료' 행에 오배치 → 진찰료 칸 공란. 진찰료 행으로 이동(표시 전용,
 *      중복표기 방지: 처치 및 수술료 행에서는 제거). 값 원천=service_charges(Revenue Insurance Split SSOT).
 *   #3 사업자등록번호 정본 갱신 — 511-60-00938 → 457-23-00938.
 *
 * 라이브 앱 브라우저 회귀가 아니라 템플릿 렌더/바인딩 불변식을 강제(로그인 불요, 결정론적).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');

function extractNewTemplate(): string {
  const m = HTML_SRC.match(/const BILL_RECEIPT_NEW_HTML\s*=\s*`([\s\S]*?)`;/);
  expect(m, 'BILL_RECEIPT_NEW_HTML 상수 존재').not.toBeNull();
  return m![1];
}

test.describe('RECEIPT 신양식 3FIX — 대제목 정렬 / 진찰료 급여 split / 사업자번호', () => {
  // ── #1 대제목 위치 정렬 ──
  test('#1 대제목: rn-title=relative + chk span=absolute left:0 (제목 정중앙 정렬)', () => {
    const tpl = extractNewTemplate();
    // rn-title div 가 position:relative 컨테이너
    expect(tpl).toMatch(/<div class="rn-title"[^>]*style="[^"]*position:relative;[^"]*"/);
    // 체크박스(chk) span 이 흐름 밖(absolute left:0)으로 빠져 제목 텍스트만 full-width center
    expect(tpl).toMatch(/<span class="chk"[^>]*style="[^"]*position:absolute;[^"]*left:0;[^"]*"/);
    // 제목 텍스트는 chk span 종료 직후 붙어야 함(前 선행 공백 제거로 정중앙 오프셋 제거)
    expect(tpl).toMatch(/<\/span>진료비 계산서ㆍ영수증<\/div>/);
  });

  test('#1 렌더: 제목 문구가 그대로 표시되고 체크박스도 표시됨', async ({ page }) => {
    const tpl = extractNewTemplate().replace(/\{\{[a-z_]+\}\}/g, '샘플');
    await page.setContent(`<!doctype html><html><body>${tpl}</body></html>`, { waitUntil: 'networkidle' });
    const body = await page.locator('body').innerText();
    expect(body).toContain('진료비 계산서ㆍ영수증');
    expect(body).toContain('[■]외래');
  });

  // ── #2 진찰료 급여 본인부담금/공단부담금 컬럼 보완 ──
  test('#2 진찰료 행에 {{copayment}}(본인부담금)/{{insurance_covered}}(공단부담금) 바인딩', () => {
    const tpl = extractNewTemplate();
    // 진찰료 행: 항목명 진찰료 다음 첫 2개 급여 셀이 copayment/insurance_covered 토큰
    expect(tpl).toMatch(
      /<td>진찰료<\/td><td class="rn-num">\{\{copayment\}\}<\/td><td class="rn-num">\{\{insurance_covered\}\}<\/td>/,
    );
  });

  test('#2 처치 및 수술료 행은 급여 토큰 제거(중복표기 방지 — 합계 ①/② 이중계상 금지)', () => {
    const tpl = extractNewTemplate();
    // 처치 및 수술료 행에 copayment/insurance_covered 토큰이 있으면 안 됨(진찰료로 이동)
    expect(tpl).toMatch(
      /<td>처치 및 수술료<\/td><td class="rn-num"><\/td><td class="rn-num"><\/td>/,
    );
    // 템플릿 전체에서 {{copayment}} 는 진찰료 행 + 합계 ① 두 곳(공단부담 {{insurance_covered}} 도 진찰료+합계②+⑦)만
    // — 처치행 잔존 없음 확인: copayment 출현 = 정확히 2회.
    const copayCount = (tpl.match(/\{\{copayment\}\}/g) ?? []).length;
    expect(copayCount, '{{copayment}} 출현=진찰료행+합계① 2회').toBe(2);
  });

  test('#2 렌더: 진찰료 행에 급여 split 금액이 표시됨(정상 동선)', async ({ page }) => {
    const tpl = extractNewTemplate()
      .replace(/\{\{copayment\}\}/g, '8,800')
      .replace(/\{\{insurance_covered\}\}/g, '20,580')
      .replace(/\{\{[a-z_]+\}\}/g, '');
    await page.setContent(`<!doctype html><html><body>${tpl}</body></html>`, { waitUntil: 'networkidle' });
    // 진찰료 행 <tr> 안에 8,800 과 20,580 이 함께 존재하는지 확인
    const jinchalRow = page.locator('tr', { hasText: '진찰료' }).first();
    await expect(jinchalRow).toContainText('8,800');
    await expect(jinchalRow).toContainText('20,580');
    // 처치 및 수술료 행에는 해당 급여 금액이 없어야 함(이동 검증)
    const cheochiRow = page.locator('tr', { hasText: '처치 및 수술료' }).first();
    await expect(cheochiRow).not.toContainText('8,800');
  });

  test('#2 엣지: 급여 0/비급여만(빈 토큰) 바인딩 시 깨짐 없이 공란 표기', async ({ page }) => {
    // 시나리오2: 급여 항목 0원 → copayment/insurance_covered 공란. 렌더 오류/깨짐 없음.
    const tpl = extractNewTemplate().replace(/\{\{[a-z_]+\}\}/g, '');
    await page.setContent(`<!doctype html><html><body>${tpl}</body></html>`, { waitUntil: 'networkidle' });
    const body = await page.locator('body').innerText();
    // 표 구조·라벨은 정상 유지
    expect(body).toContain('진찰료');
    expect(body).toContain('본인부담금');
    expect(body).toContain('공단부담금');
    // 진찰료 라벨 렌더 정상(행 존재)
    await expect(page.locator('tr', { hasText: '진찰료' }).first()).toBeVisible();
  });

  // ── #3 사업자등록번호 정본 갱신 ──
  test('#3 사업자등록번호 = 457-23-00938 (구 511-60-00988 제거)', async ({ page }) => {
    const tpl = extractNewTemplate().replace(/\{\{[a-z_]+\}\}/g, '샘플');
    await page.setContent(`<!doctype html><html><body>${tpl}</body></html>`, { waitUntil: 'networkidle' });
    const body = await page.locator('body').innerText();
    expect(body).toContain('457-23-00938');
    expect(body).not.toContain('511-60-00988');
  });

  // ── 격리/정합 ──
  test('격리: 3FIX 는 신양식(bill_receipt_new)에 한정 — 기존 bill_receipt 매핑 무접촉', () => {
    expect(HTML_SRC).toMatch(/bill_receipt:\s*BILL_RECEIPT_HTML/);
    expect(HTML_SRC).toMatch(/bill_receipt_new:\s*BILL_RECEIPT_NEW_HTML/);
  });
});
