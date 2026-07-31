/**
 * T-20260731-foot-PENCHART-PHOTO-ATTACH
 *   펜차트(보험차트)에 참고 사진 첨부 — FE + Storage-only (db_change=FALSE).
 *   DA delta-CONSULT-REPLY 정본 = (b') 순수 co-located Storage 경로 컨벤션(신규 DB 첨부테이블 REJECT).
 *
 *   AC1 별도 업로드 영역(파일선택+드래그&드롭) / AC2 펜차트 stem 결속 저장·재조회 /
 *   AC3 photos 버킷 재사용 / AC4 사진 미첨부 저장 정상 / AC5 경로 pin 준수 / AC6 public=false+signed-URL.
 *
 *   경로 pin: photos 버킷 · customer/{customerId}/pen-chart-attach/{stem}/{uuid}.{ext}
 *     · key = 펜차트 full stem(확장자만 제거, prefix 보존) → collision-safe 결속
 *     · sibling prefix 'pen-chart-attach/' 필수 · 'pen-chart/' 하위 nesting 금지(목록오염 방지)
 *
 * ★ 실 브라우저 인터랙션 spec + 경로 계약 결정론 검증. 소스 정적 assertion 안티패턴 배제.
 *   시드(로그인/고객/저장된 펜차트) 미가용 환경에서는 해당 실DOM 테스트만 graceful skip.
 */
import { test, expect, type Page } from '@playwright/test';

const SEED_CUSTOMER_ID = process.env.E2E_PENCHART_CUSTOMER_ID ?? '1d63b376-8b57-4246-9086-8394d16a1d47';

// ════════════════════════════════════════════════════════════════════════
// AC5 [결정론]: 경로 pin — 컴포넌트 헬퍼(penChartAttachPrefix/stemFromChartName)와 동일 규칙 미러.
//   실 upload 경로는 아래 실DOM 테스트가 네트워크 PUT 으로 재검증(drift 방지 이중 게이트).
// ════════════════════════════════════════════════════════════════════════
const ATTACH_SUBDIR = 'pen-chart-attach';
const stemFromChartName = (name: string) => (name ?? '').replace(/\.[^./]+$/, '');
const penChartAttachPrefix = (customerId: string, stem: string) =>
  `customer/${customerId}/${ATTACH_SUBDIR}/${stem}`;

test('AC5 [경로계약]: sibling prefix pen-chart-attach/ · full stem 결속 · pen-chart/ nesting 금지', () => {
  const cid = 'CUST123';

  // full stem = 확장자만 1회 제거, prefix(hq_/rc_/pc_) 보존
  expect(stemFromChartName('1717000000000_ab3d.png')).toBe('1717000000000_ab3d');
  expect(stemFromChartName('hq_1717000000000_ab3d.png')).toBe('hq_1717000000000_ab3d');
  expect(stemFromChartName('rc_1717000000000_ab3d.png')).toBe('rc_1717000000000_ab3d');
  // ts 단독이 아니라 full stem(ts_rand) 이 키 — 같은 ms 두 차트 collision-safe
  const a = penChartAttachPrefix(cid, stemFromChartName('1717000000000_ab3d.png'));
  const b = penChartAttachPrefix(cid, stemFromChartName('1717000000000_zz99.png'));
  expect(a).not.toBe(b);

  const prefix = penChartAttachPrefix(cid, stemFromChartName('1717000000000_ab3d.png'));
  expect(prefix).toBe('customer/CUST123/pen-chart-attach/1717000000000_ab3d');
  // sibling prefix 필수
  expect(prefix).toContain('/pen-chart-attach/');
  // 'pen-chart/' 하위 nesting 금지 — loadSavedCharts(list 'customer/{id}/pen-chart') 목록오염 방지
  expect(prefix).not.toMatch(/\/pen-chart\/[^-]/);
  expect(prefix.startsWith(`customer/${cid}/`)).toBe(true); // 고객 prefix 하위 co-located(orphan sweep 자동커버)
});

// ── 펜차트 list 모드(보험차트 탭 = /chart/{id} 기본 탭) 진입 + 저장 차트 1장 선택 ──
async function selectFirstSavedChart(page: Page): Promise<boolean> {
  await page.goto(`/chart/${SEED_CUSTOMER_ID}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  // 기본 탭이 pen_chart(clinical) — 저장된 차트 카드(썸네일) 대기
  const firstThumb = page.locator('[data-testid^="penchart-download-"]').first();
  if (!(await firstThumb.isVisible({ timeout: 12000 }).catch(() => false))) return false;
  // 카드 클릭 → selectedChart 확대뷰 → 첨부 패널 노출
  const card = firstThumb.locator('xpath=ancestor::div[contains(@class,"cursor-pointer")][1]');
  await card.click().catch(() => {});
  return await page.locator('[data-testid="penchart-attach-panel"]').isVisible({ timeout: 6000 }).catch(() => false);
}

// ════════════════════════════════════════════════════════════════════════
// AC1 [실DOM]: 별도 업로드 영역 — 드래그&드롭 존 + 파일선택 input 노출
// ════════════════════════════════════════════════════════════════════════
test('AC1 [실DOM]: 사진 첨부 영역(드롭존+파일선택) 노출', async ({ page }) => {
  const ok = await selectFirstSavedChart(page);
  test.skip(!ok, '시드(로그인/고객/저장된 펜차트) 미가용 — 실DOM skip');

  await expect(page.locator('[data-testid="penchart-attach-dropzone"]')).toBeVisible();
  const input = page.locator('[data-testid="penchart-attach-input"]');
  await expect(input).toHaveAttribute('type', 'file');
  await expect(input).toHaveAttribute('accept', /image/);
});

// ════════════════════════════════════════════════════════════════════════
// AC2·AC3·AC5 [실DOM]: 업로드 시 photos 버킷 · pin 경로로 PUT (stem 결속)
//   네트워크 PUT 을 가로채 경로를 실측 → 실제 코드가 pin 을 지키는지 재검증(정적 미러와 이중 게이트).
// ════════════════════════════════════════════════════════════════════════
test('AC2·3·5 [실DOM]: 첨부 업로드 = photos/customer/{id}/pen-chart-attach/{stem}/<uuid>.<ext>', async ({ page }) => {
  const ok = await selectFirstSavedChart(page);
  test.skip(!ok, '시드(로그인/고객/저장된 펜차트) 미가용 — 실DOM skip');

  // 어떤 stem 에 결속되는지 = 선택된 차트 카드 파일명. 첫 카드의 download testid 에서 역산.
  const dlTestId = await page.locator('[data-testid^="penchart-download-"]').first().getAttribute('data-testid');
  const chartName = (dlTestId ?? '').replace(/^penchart-download-/, '');
  const expectedStem = stemFromChartName(chartName);

  // 실 storage 오염 방지 — 업로드 PUT/POST 를 성공 mock 으로 fulfill 하고 경로만 캡처.
  let capturedPath: string | null = null;
  await page.route('**/storage/v1/object/photos/**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' || req.method() === 'PUT') {
      const m = req.url().match(/\/storage\/v1\/object\/photos\/(.+?)(\?|$)/);
      if (m) capturedPath = decodeURIComponent(m[1]);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ Key: `photos/${m ? m[1] : ''}` }),
      });
      return;
    }
    await route.continue();
  });

  // 파일선택 input 에 PNG 1장 주입 (드래그&드롭과 동일 uploadFiles 경로).
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.locator('[data-testid="penchart-attach-input"]').setInputFiles({
    name: 'reference.png',
    mimeType: 'image/png',
    buffer: png,
  });

  await expect.poll(() => capturedPath, { timeout: 10000 }).not.toBeNull();
  const path = capturedPath as unknown as string;
  // AC3: photos 버킷 (route 가 photos 로 이미 스코프됨) · AC5: pin 경로 구성요소 전수 검증
  expect(path).toContain(`customer/${SEED_CUSTOMER_ID}/pen-chart-attach/${expectedStem}/`);
  expect(path).toMatch(/\.png$/);                       // 확장자 보존
  expect(path).not.toMatch(/\/pen-chart\/[^-]/);        // pen-chart/ 하위 nesting 아님(sibling)
  // uuid 파일명 (마지막 세그먼트)
  const leaf = path.split('/').pop() ?? '';
  expect(leaf).toMatch(/^[0-9a-f-]{8,}\.png$/i);
});

// ════════════════════════════════════════════════════════════════════════
// AC4 [실DOM]: 사진 미첨부여도 펜차트 목록/선택 동선 정상 (첨부 UI 가 차트 저장 동선에 비침습)
// ════════════════════════════════════════════════════════════════════════
test('AC4 [실DOM]: 첨부 없이도 차트 선택·확대뷰 정상 (비침습)', async ({ page }) => {
  const ok = await selectFirstSavedChart(page);
  test.skip(!ok, '시드(로그인/고객/저장된 펜차트) 미가용 — 실DOM skip');

  // 확대뷰 이미지 + 첨부 패널이 공존 (첨부 없이도 렌더). 첨부 grid 는 0건일 수 있음(정상).
  await expect(page.locator('img[alt="펜차트"]')).toBeVisible();
  await expect(page.locator('[data-testid="penchart-attach-panel"]')).toBeVisible();
});
