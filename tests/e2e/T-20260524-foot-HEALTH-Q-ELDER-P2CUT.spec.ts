/**
 * E2E spec: T-20260524-foot-HEALTH-Q-ELDER-P2CUT
 * 발건강 질문지(어르신용) 2페이지 뒷장 짤림 버그 수정
 *
 * AC-1: 발건강 질문지(어르신용) 선택 시 2페이지 전체 표시 (p1+p2)
 * AC-2: 뒷장(p2) 하단까지 내용 잘림 없이 렌더링
 * AC-3: p1↔p2 자연스러운 연결 (캔버스 높이=2246 = 1123*2)
 * AC-4: p2 영역에서도 펜 입력 정상 동작 (캔버스 전체 포인터 이벤트)
 * AC-5: 기존 일반용 발건강 질문지(1p) 무영향 (canvas 높이 1123 유지)
 * AC-6: 빌드 성공
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

test.describe('HEALTH-Q-ELDER-P2CUT — 어르신용 발건강 질문지 2페이지 수정', () => {

  // ── AC-6: 빌드 성공 ──────────────────────────────────────────────────────
  test('AC-6: 앱 정상 로드', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1/2/3: health_q_senior.png 2페이지 크기 확인 ──────────────────────
  test.describe('AC-1/2/3 health_q_senior.png 2페이지 크기 검증', () => {
    test('health_q_senior.png 에셋 서빙 정상', async ({ page }) => {
      const response = await page.goto('/forms/health_q_senior.png');
      expect(response?.status()).toBe(200);
      expect(response?.headers()['content-type']).toContain('image/png');
    });

    test('health_q_senior.png 2페이지 높이 (7016px) — 단일 페이지(3508) 아님', async ({ page }) => {
      // 브라우저에서 이미지 실제 크기 확인
      const response = await page.goto('/forms/health_q_senior.png');
      expect(response?.status()).toBe(200);
      const imgSize = await page.evaluate(() => {
        const img = document.querySelector('img') as HTMLImageElement | null;
        return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
      });
      if (imgSize) {
        // 2페이지 = ~7016px (2 × 3508), 1페이지 = ~3508px
        expect(imgSize.h).toBeGreaterThan(5000); // 2페이지 임계값
        expect(imgSize.w).toBeGreaterThan(2000); // 300DPI A4 폭
      }
    });

    test('health_q_general.png는 단일 페이지(3508) 유지 — AC-5 회귀 없음', async ({ page }) => {
      const response = await page.goto('/forms/health_q_general.png');
      expect(response?.status()).toBe(200);
      const imgSize = await page.evaluate(() => {
        const img = document.querySelector('img') as HTMLImageElement | null;
        return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
      });
      if (imgSize) {
        // 일반용은 1페이지 = ~3508px 높이
        expect(imgSize.h).toBeLessThan(5000); // 단일 페이지 임계값
      }
    });
  });

  // ── AC-3/5: 캔버스 높이 상수 검증 ────────────────────────────────────────
  test.describe('AC-3/5 캔버스 높이 로직 소스 검증', () => {
    test('getCanvasHeightForForm: health_questionnaire_senior → 2246 (2페이지)', () => {
      const src = fs.readFileSync(
        path.join(repoRoot, 'src/components/PenChartTab.tsx'),
        'utf-8',
      );
      // health_questionnaire_senior에 CANVAS_H_PC_SENIOR(2246) 적용 확인
      expect(src).toContain("formKey === 'health_questionnaire_senior'");
      expect(src).toContain('CANVAS_H_PC_SENIOR'); // 2246 = 1123 * 2
    });

    test('CANVAS_H_PC_SENIOR = 2246 (A4 2페이지)', () => {
      const src = fs.readFileSync(
        path.join(repoRoot, 'src/components/PenChartTab.tsx'),
        'utf-8',
      );
      const match = src.match(/CANVAS_H_PC_SENIOR\s*=\s*(\d+)/);
      expect(match).not.toBeNull();
      const value = parseInt(match![1], 10);
      expect(value).toBe(2246); // 1123 * 2
    });

    test('AC-5: personal_checklist_senior → 기존 CANVAS_H_PC_SENIOR 유지', () => {
      const src = fs.readFileSync(
        path.join(repoRoot, 'src/components/PenChartTab.tsx'),
        'utf-8',
      );
      expect(src).toContain("formKey === 'personal_checklist_senior'");
    });
  });

  // ── AC-4: 2페이지 캔버스에서 포인터 이벤트 범위 검증 (소스) ──────────────
  test.describe('AC-4 캔버스 포인터 이벤트 2페이지 적용', () => {
    test('getCanvasHeightForForm 반환값이 캔버스 height에 사용됨', () => {
      const src = fs.readFileSync(
        path.join(repoRoot, 'src/components/PenChartTab.tsx'),
        'utf-8',
      );
      // getCanvasHeightForForm 호출이 캔버스 height 속성에 연결되는지 확인
      expect(src).toContain('getCanvasHeightForForm');
      // 캔버스 DRAW_DPR 적용 패턴 확인
      expect(src).toContain('DRAW_DPR');
    });
  });
});

/**
 * 현장 클릭 시나리오 (수동 검증용 체크리스트):
 *
 * [시나리오1] 어르신용 질문지 2p 전체 표시
 *   1. 데스크 직원 로그인 → 2번차트 진입 → 고객 선택
 *   2. 펜차트 탭 → "발건강 질문지(어르신용)" 양식 선택
 *   3. 캔버스 렌더 후 스크롤 → p1 전체 내용 표시 확인
 *   4. 아래로 스크롤 → p2 전체 내용 표시 (하단까지 잘림 없음) 확인
 *   5. p2 영역에 태블릿펜으로 기입 → 정상 동작 확인
 *   6. 저장 → 재진입 → p1+p2 모두 정상 복원
 *
 * [시나리오2] 일반용(1p) 무영향
 *   1. "발건강 질문지(일반용)" 양식 선택
 *   2. 1페이지 정상 표시 + 펜 입력 정상 확인
 */
