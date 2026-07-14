/**
 * T-20260714-foot-FEEDOC-FORM-REDESIGN-BODYSTYLE
 *
 * 시안-컨펌 게이트 티켓. 라이브 적용 금지(AC4) 상태이므로 이 spec 은 라이브 앱 회귀가 아니라
 * **격리 불변식(C1·C3)** 을 코드 레벨에서 강제한다:
 *   1. draft 템플릿이 라이브 레지스트리(htmlFormTemplates.ts)에 import/등록되지 않았다 (C1 완전분리).
 *   2. draft 템플릿이 별지 제6호서식(도수센터 기준) 핵심 요소를 담아 렌더된다 (AC1 시안).
 *
 * 라이브 서류 출력 경로에는 어떤 코드도 닿지 않으므로 라이브 회귀 위험 0 (C3).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();

test.describe('FEEDOC 서류양식 개편 — 라이브 격리 불변식', () => {
  test('C1: draft 템플릿이 라이브 레지스트리에 등록되지 않음', () => {
    const live = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');
    // 라이브 파일이 draft 모듈을 절대 import/참조하지 않아야 한다.
    expect(live).not.toContain('draftFormTemplates');
    expect(live).not.toContain('BILL_RECEIPT_DRAFT_HTML');
  });

  test('C1: 라이브 bill_receipt 레지스트리 매핑이 기존 라이브 상수 유지', () => {
    const live = fs.readFileSync(path.join(ROOT, 'src/lib/htmlFormTemplates.ts'), 'utf8');
    // 라이브 매핑은 기존 BILL_RECEIPT_HTML 이어야 하며 draft 로 스왑되지 않음.
    expect(live).toMatch(/bill_receipt:\s*BILL_RECEIPT_HTML/);
  });

  test('AC1: draft 템플릿이 별지 제6호서식(도수센터 기준) 핵심 요소를 담아 렌더', async ({ page }) => {
    const src = fs.readFileSync(path.join(ROOT, 'src/lib/draftFormTemplates.ts'), 'utf8');
    const m = src.match(/BILL_RECEIPT_DRAFT_HTML\s*=\s*`([\s\S]*?)`;/);
    expect(m).not.toBeNull();
    const html = m![1]
      .replace(/\{\{[a-z_]+\}\}/g, '샘플');
    await page.setContent(`<!doctype html><html><body>${html}</body></html>`, { waitUntil: 'networkidle' });

    const body = await page.locator('body').innerText();
    // 별지 제6호서식 고유 시그니처 (도수센터 기준 = 공식 법정서식)
    expect(body).toContain('별지 제6호서식');
    expect(body).toContain('진료비 계산서ㆍ영수증');
    expect(body).toContain('일부 본인부담');
    expect(body).toContain('공단부담금');
    expect(body).toContain('금액산정내용');
    expect(body).toContain('요양기관 종류');
    await expect(page.locator('.r6-wrap')).toBeVisible();
  });
});
