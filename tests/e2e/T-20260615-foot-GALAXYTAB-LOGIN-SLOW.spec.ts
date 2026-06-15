/**
 * T-20260615-foot-GALAXYTAB-LOGIN-SLOW
 * 갤럭시탭 로그인 → 대시보드 진입 지연(30s+) 진단 결과 회귀 가드.
 *
 * 근본 원인(계측 확정):
 *   cn() 유틸이 쓰는 clsx·tailwind-merge·use-sync-external-store-shim 가 recharts/d3 와
 *   같은 vendor-charts 청크(≈397KB)에 묶여 있었다. entry static graph(모든 화면의 Button/Badge
 *   등)가 이 tiny 유틸을 정적으로 쓰므로, 로그인 화면조차 recharts 397KB 전체를 critical path 에
 *   정적 로드(modulepreload) → 갤탭 파싱·실행이 느려짐.
 *
 * 수정: vite manualChunks 에 vendor-utils 규칙 추가 → tiny 유틸 분리.
 *   recharts(vendor-charts)는 Stats 진입 시에만 lazy 로드.
 *
 * 본 spec 은 두 가지를 회귀 가드한다.
 *   AC1/AC2(번들): 빌드 산출물 critical path(modulepreload)에 vendor-charts 없음.
 *   AC3(기능/회귀): 로그인 → 대시보드 경로에서 차트 청크 네트워크 요청이 발생하지 않고,
 *                   대시보드가 정상 렌더된다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loginAndWaitForDashboard } from '../helpers';

const DIST = join(process.cwd(), 'dist');

test.describe('T-20260615-foot-GALAXYTAB-LOGIN-SLOW — 로그인 critical-path 가드', () => {
  test('빌드 산출물: index.html critical path 에 vendor-charts 가 없다', () => {
    const indexHtml = join(DIST, 'index.html');
    test.skip(!existsSync(indexHtml), 'dist/index.html 없음 — npm run build 선행 필요');

    const html = readFileSync(indexHtml, 'utf8');

    // entry 가 정적으로 끌어오는(modulepreload) 청크 목록
    const preloads = [...html.matchAll(/modulepreload[^>]*href="([^"]+)"/g)].map((m) => m[1]);

    // recharts 397KB 청크가 critical path 에 다시 얹히면 실패 (재발 차단)
    const chartsOnCritical = preloads.filter((p) => /vendor-charts/.test(p));
    expect(chartsOnCritical, `vendor-charts 가 critical path 에 재진입: ${chartsOnCritical.join(', ')}`).toHaveLength(0);

    // tiny 유틸 분리 청크는 critical path 에 있어야 정상 (분리됐다는 증거)
    expect(preloads.some((p) => /vendor-utils/.test(p)), 'vendor-utils 분리 청크가 modulepreload 에 없음').toBeTruthy();
  });

  test('빌드 산출물: vendor-charts 청크는 여전히 lazy 청크로 별도 존재', () => {
    const assetsDir = join(DIST, 'assets');
    test.skip(!existsSync(assetsDir), 'dist/assets 없음 — npm run build 선행 필요');
    const files = readdirSync(assetsDir);
    // recharts 는 Stats 진입 시 lazy 로드용으로 분리 존재해야 함
    expect(files.some((f) => /^vendor-charts-.*\.js$/.test(f)), 'vendor-charts lazy 청크가 사라짐 (Stats 차트 깨질 위험)').toBeTruthy();
    expect(files.some((f) => /^vendor-utils-.*\.js$/.test(f)), 'vendor-utils 청크가 생성되지 않음').toBeTruthy();
  });

  test('로그인 → 대시보드 경로에서 차트 청크가 네트워크로 요청되지 않는다', async ({ page }) => {
    const chartRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (/vendor-charts-.*\.js/.test(url)) chartRequests.push(url);
    });

    const ok = await loginAndWaitForDashboard(page);
    expect(ok, '로그인 → 대시보드 진입 실패').toBeTruthy();

    // 대시보드까지 도달했는데 차트 청크가 받아졌으면 critical path 오염
    expect(chartRequests, `대시보드 경로에서 차트 청크 로드됨: ${chartRequests.join(', ')}`).toHaveLength(0);
  });
});
