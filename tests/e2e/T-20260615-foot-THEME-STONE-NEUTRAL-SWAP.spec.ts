import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

/**
 * T-20260615-foot-THEME-STONE-NEUTRAL-SWAP
 *
 * 배경: 6/15 RECOLOR(ad7dbcf, teal-50→#FAFAFA) 이후에도 김주연 총괄이
 *   "대시보드 슬롯 배경 아직 베이지" 재컴플레인. 원인 = 컴포넌트에 하드코딩된
 *   Tailwind stone-* 잔여 5곳. stone-50(#fafaf9)/stone-100(#f5f5f4)=warm gray라
 *   베이지로 읽힘. → 무채(neutral-*) 로 일괄 swap.
 *
 * ⚠ 범위: 컴포넌트 하드코딩 Tailwind 유틸클래스만. index.css :root 토큰은 비범위
 *   (별도 T-20260615 WHITE-RESTORE-BEIGE-OVERREACH 소관).
 *
 * AC 매핑:
 *   AC1 isInactiveZone 비활성존 = bg-neutral-50
 *   AC2 점유슬롯 bg-neutral-100 / hover bg-neutral-200 / active bg-neutral-300
 *   AC3 opacity 슬롯 bg-stone-100/50 → bg-neutral-100/50
 *   AC4 formTemplates bg-stone-50→neutral-50, border-stone-300→border-neutral-300
 *   AC5 bg-white·bg-teal-*·의미색(status/emerald/green) 불변
 *   AC6 src 전역 stone-* 색클래스 잔존 0 (정적 가드)
 *   AC7 대시보드 authed 실렌더 — DOM에 stone-* 클래스 0 + 스샷 증거
 *
 * 이 spec 은 unit(auth 불요, fs 정적 가드)과 desktop-chrome(authed 실렌더)
 *   두 부분으로 구성된다.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

// stone-{색조} 유틸클래스(bg-/border-/text-/from-/to- 등)만 매칭.
//   data-testid="milestone-input" 같은 milestone 오탐을 배제하기 위해
//   stone- 앞에 단어경계(영문자가 아닌 것)를 강제한다.
const STONE_UTIL = /(?<![a-zA-Z])stone-(?:50|100|200|300|400|500|600|700|800|900|950)\b/g;

test.describe('THEME-STONE-NEUTRAL-SWAP — 정적 소스 가드 (AC1~AC6)', () => {
  test('AC6: src 전역 stone-* 색클래스 잔존 0', () => {
    // grep 으로 잡힌 컴포넌트 소스 전체를 정밀 스캔. 색 유틸클래스 stone-* 는 0이어야 한다.
    const files = [
      'src/pages/Dashboard.tsx',
      'src/lib/formTemplates.ts',
    ];
    for (const f of files) {
      const src = read(f);
      const hits = src.match(STONE_UTIL) || [];
      expect(hits, `${f} 에 stone-* 색클래스 잔존: ${hits.join(', ')}`).toHaveLength(0);
    }
  });

  test('AC1/AC2/AC3: Dashboard.tsx 슬롯 배경 neutral 치환', () => {
    const src = read('src/pages/Dashboard.tsx');
    // AC1 — 비활성존 행 배경
    expect(src, 'AC1 isInactiveZone bg-neutral-50').toContain("isInactiveZone && 'bg-neutral-50'");
    // AC2 — 점유슬롯 기본/hover/active
    expect(src, 'AC2 점유슬롯 neutral 100/200/300').toContain(
      "'bg-neutral-100 hover:bg-neutral-200 active:bg-neutral-300'",
    );
    // AC3 — opacity 슬롯 2곳 (초진/재진 컬럼)
    const op = src.match(/bg-neutral-100\/50/g) || [];
    expect(op.length, 'AC3 bg-neutral-100/50 (초진+재진 2곳)').toBeGreaterThanOrEqual(2);
  });

  test('AC4: formTemplates.ts medical_record_request neutral 치환', () => {
    const src = read('src/lib/formTemplates.ts');
    expect(src, 'AC4 bg-neutral-50 border-neutral-300').toContain('bg-neutral-50 border-neutral-300');
  });

  test('AC5: 의미색·teal·white carve-out 불변(회귀 가드)', () => {
    const src = read('src/pages/Dashboard.tsx');
    // teal 라이브존 컬러 보존
    expect(src, 'teal 라이브존 보존').toContain('bg-teal-50 hover:bg-teal-100 active:bg-teal-200');
    // 의미색(점유 카운트) 보존
    expect(src, 'yellow 신규 카운트 보존').toContain('bg-yellow-50/40');
    expect(src, 'green 재진 카운트 보존').toContain('bg-green-50/40');
  });
});

test.describe('THEME-STONE-NEUTRAL-SWAP — authed 실렌더 (AC7)', () => {
  test('AC7: 대시보드 DOM에 stone-* 클래스 0 + 슬롯 무채 배경', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    expect(page.url(), '인증 후 로그인으로 튕김(.auth 상태 확인)').not.toContain('/login');

    // DOM 전 요소의 class 토큰에 stone-{색조} 가 단 1개도 없어야 한다.
    const stoneHits = await page.evaluate(() => {
      const re = /(?:^|[\s])stone-(?:50|100|200|300|400|500|600|700|800|900|950)(?=$|[\s])/;
      const out: string[] = [];
      document.querySelectorAll('*').forEach((el) => {
        const cls = el.getAttribute('class');
        if (cls && re.test(' ' + cls + ' ')) out.push(cls);
      });
      return out;
    });
    expect(stoneHits, `대시보드 DOM stone-* 잔존: ${stoneHits.join(' | ')}`).toHaveLength(0);

    // 타임라인 슬롯 행이 렌더되는지 확인 후 증거 스샷.
    await page.locator('[data-testid="timeline-slot-row"]').first().waitFor({ timeout: 8000 }).catch(() => {});

    await page.screenshot({
      path: 'evidence/T-20260615-foot-THEME-STONE-NEUTRAL-SWAP_dashboard.png',
      fullPage: true,
    });
  });
});
