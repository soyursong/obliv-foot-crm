/**
 * E2E spec — T-20260709-foot-LAYOUT-WHITESPACE-REDUCE
 * 발건강질문지 자가작성 "별도창(인쇄용) 이미지" 뷰어의 form row 세로폭 축소.
 *
 * 현장(김주연 총괄) 요청: "레이아웃 불필요한 여백 줄여주고 반영ㄱㄱ"
 *   → 구두 명확화 "이런 칸 너비 말하는거야 세로폭" (별도창 시안 ts 1783410391.238309 기준).
 *
 * 대상: src/lib/healthQDocument.ts 문서 빌더의 `.qa .row` (자가작성 응답 각 항목 칸).
 * 조정: 상/하 패딩 8→4·행간 1.45→1.35 로 세로 높이 일괄 축소. 가로 패딩 13px 유지(너비 불변).
 *
 * AC-1: 각 form row 세로 높이 축소 → 동일 뷰포트 항목 수 증가 (실 DOM 측정).
 * AC-2: 텍스트/이미지 잘림·겹침 없음 (멀티라인·다수 항목 포함).
 * AC-3: 순수 FE spacing — 가로 폭(width) 불변, DB/스키마 무접촉(정적 가드).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', '..', 'src', 'lib', 'healthQDocument.ts');
const src = fs.readFileSync(SRC, 'utf8');

// ── 소스에서 문서 <style> 블록 추출 (실 렌더에 정본 CSS 그대로 주입) ──
function extractCss(): string {
  const m = src.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) throw new Error('healthQDocument <style> 블록을 찾지 못함');
  return m[1];
}

// ── 대표 응답(단일/중간/멀티라인 + 다수 항목) — 잘림·겹침 검증용 ──
const ROWS: Array<[string, string]> = [
  ['성함', '홍길동'],
  ['연락처', '010-1234-5678'],
  ['생년월일', '1990.01.01'],
  ['방문 경로', '인터넷 검색 / 지인 소개로 방문하게 되었습니다'],
  ['현재 증상', '엄지발톱이 파고들어 걸을 때 통증이 심하고, 붉게 부어오른 상태가 2주 이상 지속되고 있습니다. 특히 신발을 신으면 더 아픕니다.'],
  ['통증 정도', '7/10'],
  ['과거 치료 경험', '타 병원에서 발톱 일부 제거술을 받은 적이 있으나 재발하였습니다'],
  ['복용 약물', '없음'],
  ['알러지', '페니실린 계열 항생제'],
  ['기저 질환', '당뇨 (경계성)'],
  ['희망 시술', '발톱교정 (비수술)'],
  ['기타 문의', '시술 후 관리 방법과 재발 가능성이 궁금합니다'],
];

function buildBody(css: string): string {
  const rows = ROWS
    .map(([l, v]) => `<div class="row"><div class="label">${l}</div><div class="value">${v}</div></div>`)
    .join('');
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>${css}</style></head><body>
    <div class="win"><div class="paper">
      <div class="section"><div class="sec-title"><span class="no">◆</span> 자가작성 응답</div>
        <div class="qa">${rows}</div></div>
    </div></div></body></html>`;
}

test.describe('T-20260709-foot-LAYOUT-WHITESPACE-REDUCE — 별도창 form row 세로폭 축소', () => {
  // AC-3(정적): 세로 패딩 축소 반영 + 가로 패딩 13px(너비) 불변 + 이전 8px 회귀 금지
  test('AC-3 form row 컴팩트 패딩 소스 가드 (세로만 축소·가로 불변)', () => {
    const labelRule = src.match(/\.qa \.row \.label\{[^}]*\}/)?.[0] ?? '';
    const valueRule = src.match(/\.qa \.row \.value\{[^}]*\}/)?.[0] ?? '';
    expect(labelRule).not.toBe('');
    expect(valueRule).not.toBe('');
    // 세로 패딩 = 4px (8px 회귀 금지), 가로 패딩 = 13px 유지(너비 불변)
    expect(labelRule).toContain('padding:4px 13px');
    expect(valueRule).toContain('padding:4px 13px');
    expect(labelRule).not.toContain('padding:8px 13px');
    expect(valueRule).not.toContain('padding:8px 13px');
    // 행간도 축소되어 세로 밀도 향상
    expect(valueRule).toMatch(/line-height:1\.3\d/);
  });

  // AC-1: 실 DOM 측정 — 각 단일라인 row 높이가 컴팩트(≤30px)로 축소
  test('AC-1 실 렌더 — 각 form row 세로 높이 축소(컴팩트)', async ({ page }) => {
    await page.setContent(buildBody(extractCss()));
    const heights = await page.evaluate(() =>
      [...document.querySelectorAll('.qa .row')].map((r) => Math.round(r.getBoundingClientRect().height)),
    );
    expect(heights.length).toBe(ROWS.length);
    // 단일라인 rows(멀티라인 '현재 증상' index 4 제외)는 모두 컴팩트(≤30px).
    // 8px 패딩·line-height 1.45 시절 단일라인 높이(~34px)보다 낮아야 한다.
    heights.forEach((h, i) => {
      if (i === 4) return; // 멀티라인 항목 — 별도 검증(AC-2)
      expect(h).toBeLessThanOrEqual(30);
    });
  });

  // AC-2: 잘림·겹침 없음 — 멀티라인 value 가 clip 되지 않고, row 간 겹침 없음
  test('AC-2 잘림·겹침 없음 (멀티라인·다수 항목)', async ({ page }) => {
    await page.setContent(buildBody(extractCss()));
    const report = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.qa .row')];
      const clipped: number[] = [];
      let overlap = false;
      let prevBottom = -Infinity;
      rows.forEach((r, i) => {
        const v = r.querySelector('.value') as HTMLElement;
        if (v.scrollHeight > v.clientHeight + 1) clipped.push(i); // 내용이 칸보다 큼 = 잘림
        const top = r.getBoundingClientRect().top;
        if (top < prevBottom - 0.5) overlap = true; // 이전 row 하단보다 위 = 겹침
        prevBottom = r.getBoundingClientRect().bottom;
      });
      // 멀티라인 항목이 실제 2줄 이상으로 감겼는지(축소가 내용을 자르지 않았는지) 확인
      const multi = rows[4].querySelector('.value') as HTMLElement;
      const multiHeight = Math.round(multi.getBoundingClientRect().height);
      return { clipped, overlap, multiHeight };
    });
    expect(report.clipped).toEqual([]); // 잘린 항목 0
    expect(report.overlap).toBe(false); // 겹침 없음
    expect(report.multiHeight).toBeGreaterThan(28); // 멀티라인은 자연 확장(내용 보존)
  });
});
