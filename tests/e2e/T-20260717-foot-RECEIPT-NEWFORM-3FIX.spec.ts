/**
 * T-20260717-foot-RECEIPT-NEWFORM-3FIX
 *
 * 진료비 계산서·영수증 '신양식'(form_key=bill_receipt_new, 별지 제6호서식) 결함 3건 수정 불변식.
 * 김주연 총괄(2026-07-17, ch C0ATE5P6JTH) 요청, 첨부 결함 스샷 F0BHUNLHPMZ 기준.
 *
 *   #1 대제목 위치 정렬 — '진료비 계산서ㆍ영수증' 제목이 우측으로 밀림(off-center). 표준서식(별지 제6호)은
 *      제목 정중앙 + 체크박스([■]외래…) 좌측. chk 를 absolute left 로 흐름 밖에 두어 제목만 정중앙 정렬.
 *   #2 진찰료 급여 본인부담금/공단부담금 컬럼 보완 — foot 급여=진찰료(footBillDetailCategory 기본→진찰료)가
 *      원천. 前: 급여 aggregate 가 '처치 및 수술료' 행에 오배치 → 진찰료 칸 공란. 값 원천=service_charges
 *      (Revenue Insurance Split SSOT).
 *      ※ CATSPLIT-PAIDBOX(T-20260722-foot-BILLRECEIPT-NEWFORM-CATSPLIT-PAIDBOX, deployed 80a530eb) 후행정합:
 *        급여 split canon 재정의 — 진찰료 aggregate({{copayment}}/{{insurance_covered}}) →
 *        category-level split. 진찰료 행 = remainder({{consult_copay}}/{{consult_ins}}), 검사료 행 =
 *        {{exam_copay}}/{{exam_ins}}, 처치 및 수술료 행 = {{proc_copay}}/{{proc_ins}}(야간가산 fold 이후 최종
 *        aggregate 기준). 급여 검사(KOH 등)가 진찰료로 흡수되지 않도록 category별 별도 표기(별지 제6호서식).
 *        본 #2 assertion 은 CATSPLIT spec 신 canon 을 선례로 후행정합(중복 창안 금지).
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
  test('#2 진찰료 행 = remainder 토큰 {{consult_copay}}/{{consult_ins}} (CATSPLIT canon — aggregate 직결 아님)', () => {
    const tpl = extractNewTemplate();
    // CATSPLIT 후행정합: 진찰료 행 급여칸 = category remainder 토큰(CATSPLIT A-static 선례).
    expect(tpl).toMatch(
      /<td>진찰료<\/td><td class="rn-num">\{\{consult_copay\}\}<\/td><td class="rn-num">\{\{consult_ins\}\}<\/td>/,
    );
    // 회귀: 진찰료 행에 aggregate {{copayment}} 직결 잔존 금지(급여 검사 흡수 원인 — CATSPLIT 로 재정의).
    expect(tpl).not.toMatch(/<td>진찰료<\/td><td class="rn-num">\{\{copayment\}\}<\/td>/);
  });

  test('#2 처치·검사료 행 = category 토큰({{proc_*}}/{{exam_*}}) — 진찰료 흡수 방지(CATSPLIT canon)', () => {
    const tpl = extractNewTemplate();
    // CATSPLIT 후행정합: 처치 및 수술료 행 급여칸 = {{proc_copay}}/{{proc_ins}} + 비급여 {{proc_noncov}}(CATSPLIT A-static 선례).
    expect(tpl).toMatch(
      /<td>처치 및 수술료<\/td><td class="rn-num">\{\{proc_copay\}\}<\/td><td class="rn-num">\{\{proc_ins\}\}<\/td><td class="rn-num"><\/td><td class="rn-num">\{\{proc_noncov\}\}<\/td>/,
    );
    // 검사료 행도 급여칸 별도 표기(급여 검사 KOH 가 진찰료로 흡수되지 않도록).
    expect(tpl).toMatch(
      /<td>검사료<\/td><td class="rn-num">\{\{exam_copay\}\}<\/td><td class="rn-num">\{\{exam_ins\}\}<\/td><td class="rn-num"><\/td><td class="rn-num">\{\{exam_noncov\}\}<\/td>/,
    );
    // 이중계상 금지: 어느 category 행에도 aggregate {{copayment}} 직결 잔존 없음(합계 ①/⑦ 전용).
    expect(tpl).not.toMatch(/<td>(진찰료|처치 및 수술료|검사료)<\/td><td class="rn-num">\{\{copayment\}\}<\/td>/);
  });

  test('#2 렌더: 진찰료 행에 remainder 급여 split 금액이 표시됨(정상 동선)', async ({ page }) => {
    // CATSPLIT 골든 F-4990 계승: 진찰료 remainder 본인 5,643 / 공단 13,197, 검사료 급여 본인 3,157 별도.
    const tpl = extractNewTemplate()
      .replace(/\{\{consult_copay\}\}/g, '5,643')
      .replace(/\{\{consult_ins\}\}/g, '13,197')
      .replace(/\{\{exam_copay\}\}/g, '3,157')
      .replace(/\{\{exam_ins\}\}/g, '7,383')
      .replace(/\{\{[a-z_]+\}\}/g, '');
    await page.setContent(`<!doctype html><html><body>${tpl}</body></html>`, { waitUntil: 'networkidle' });
    // 진찰료 행 <tr> 안에 remainder 5,643 / 13,197 이 함께 존재하는지 확인
    const jinchalRow = page.locator('tr', { hasText: '진찰료' }).first();
    await expect(jinchalRow).toContainText('5,643');
    await expect(jinchalRow).toContainText('13,197');
    // 검사료 급여는 검사료 행에 별도 표기(진찰료 흡수 아님)
    const examRow = page.locator('tr', { hasText: '검사료' }).first();
    await expect(examRow).toContainText('3,157');
    // 진찰료 행에는 검사료 급여 금액이 섞이지 않음(remainder 분리 검증)
    await expect(jinchalRow).not.toContainText('3,157');
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
