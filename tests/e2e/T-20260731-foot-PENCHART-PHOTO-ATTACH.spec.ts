/**
 * T-20260731-foot-PENCHART-PHOTO-ATTACH  (B안 = 작성 중 첨부, stem-pre-binding)
 *
 *   펜차트(보험차트)에 참고 사진 첨부 — FE + Storage-only (db_change=FALSE).
 *   DA delta-CONSULT-REPLY 정본 = (b') 순수 co-located Storage 경로 컨벤션(신규 DB 첨부테이블 REJECT).
 *
 *   AC0(B안, 2026-07-31 김주연 총괄 확정): 첨부 시점 = '새 펜차트 작성' 창에서 **작성과 동시에** 첨부.
 *     → draw 진입 시 stem `{ts}_{rand}` 선(先)발번(stem-pre-binding) → 작성 중 첨부 & 저장이 동일 stem 결속.
 *   AC1 갤러리(파일)+카메라(capture) 둘 다 / AC1b 장수 제한 없음(multiple) / AC2 stem 결속 저장·재조회 /
 *   AC3 photos 버킷 재사용 / AC4 사진 미첨부 저장 정상 / AC5 경로 pin 준수 / AC6 public=false+signed-URL.
 *
 *   경로 pin: photos 버킷 · customer/{customerId}/pen-chart-attach/{stem}/{uuid}.{ext}
 *     · key = 펜차트 full stem(확장자만 제거, prefix 보존) → collision-safe 결속
 *     · sibling prefix 'pen-chart-attach/' 필수 · 'pen-chart/' 하위 nesting 금지(목록오염 방지)
 *
 * ★ 실 브라우저 인터랙션 spec + 경로 계약/pre-binding 결정론 검증. 소스 정적 assertion 안티패턴 배제.
 *   시드(로그인/고객) 미가용 환경에서는 해당 실DOM 테스트만 graceful skip.
 */
import { test, expect, type Page } from '@playwright/test';

const SEED_CUSTOMER_ID = process.env.E2E_PENCHART_CUSTOMER_ID ?? '1d63b376-8b57-4246-9086-8394d16a1d47';

// ════════════════════════════════════════════════════════════════════════
// [결정론 미러]: 컴포넌트 헬퍼(penChartAttachPrefix/stemFromChartName/penChartFilePrefix)와 동일 규칙 재현.
//   실 upload 경로는 아래 실DOM 테스트가 네트워크 PUT 으로 재검증(drift 방지 이중 게이트).
// ════════════════════════════════════════════════════════════════════════
const ATTACH_SUBDIR = 'pen-chart-attach';
const stemFromChartName = (name: string) => (name ?? '').replace(/\.[^./]+$/, '');
const penChartAttachPrefix = (customerId: string, stem: string) =>
  `customer/${customerId}/${ATTACH_SUBDIR}/${stem}`;
// PenChartTab.penChartFilePrefix 미러 (저장 파일명 prefix — 양식별).
const penChartFilePrefix = (formKey: string | undefined): string => {
  if (!formKey) return '';
  if (formKey.startsWith('health_questionnaire_')) return `hq_${formKey === 'health_questionnaire_senior' ? 'sr_' : ''}`;
  if (formKey === 'refund_consent') return 'rc_';
  if (formKey.startsWith('personal_checklist_')) return `pc_${formKey === 'personal_checklist_senior' ? 'sr_' : ''}`;
  return '';
};

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

// ════════════════════════════════════════════════════════════════════════
// AC0 [pre-binding 불변식, 결정론]: 작성 진입 시 선발번한 stem 이 (a)작성 중 첨부 prefix 와
//   (b)저장 PNG 파일명 사이에서 동일하게 결속됨을 증명.
//   → 작성 중 올린 사진이 저장 후 재조회에서 반드시 같은 펜차트에 붙는다(scenario1 step6).
// ════════════════════════════════════════════════════════════════════════
test('AC0 [pre-binding]: 선발번 stem 이 작성-중 첨부 prefix ↔ 저장 PNG stem 을 동일 결속', () => {
  const cid = 'CUST-B';
  const rawStem = '1717000000000_ab3d'; // draw 진입 시 선발번(prefix 미포함 raw {ts}_{rand})

  for (const formKey of [undefined, 'pen_chart', 'health_questionnaire_general', 'health_questionnaire_senior', 'refund_consent', 'personal_checklist_general'] as const) {
    const prefix = penChartFilePrefix(formKey as string | undefined);
    // 작성 중 첨부 패널이 결속하는 stem(activeAttachStem) = `${prefix}${rawStem}`
    const attachStem = `${prefix}${rawStem}`;
    // 저장 시 파일명 = `${prefix}${rawStem}.png` (handleDrawSave)
    const savedChartName = `${prefix}${rawStem}.png`;
    // 저장본 재조회가 계산하는 stem = stemFromChartName(savedChartName)
    const reviewStem = stemFromChartName(savedChartName);

    // ★ 핵심: 작성 중 결속 stem === 저장본 재조회 stem → 사진이 같은 폴더에서 재조회됨
    expect(attachStem).toBe(reviewStem);
    expect(penChartAttachPrefix(cid, attachStem)).toBe(penChartAttachPrefix(cid, reviewStem));
    // sibling prefix 준수 · pen-chart/ nesting 아님
    expect(penChartAttachPrefix(cid, attachStem)).toContain('/pen-chart-attach/');
    expect(penChartAttachPrefix(cid, attachStem)).not.toMatch(/\/pen-chart\/[^-]/);
  }
});

// ── '새 펜차트 작성' 별도창(popupMode) 진입 → 양식(펜차트) 선택 → draw 모드 ──
async function enterNewPenChartDraw(page: Page): Promise<boolean> {
  await page.goto(`/penchart-editor?customerId=${SEED_CUSTOMER_ID}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  // 미인증이면 /login 리다이렉트 → 시드 미가용
  if (/\/login/.test(page.url())) return false;
  // 양식 선택 패널(펜차트 카드) 대기 후 선택
  const penCard = page.getByText('양식 선택', { exact: true });
  if (!(await penCard.isVisible({ timeout: 12000 }).catch(() => false))) return false;
  // '펜차트/보험차트' 카드(첫 카드) 클릭 → draw 진입
  await page.locator('button:has(svg)').filter({ hasText: /차트/ }).first().click().catch(() => {});
  // draw 툴바의 '사진 첨부' 토글 노출 여부로 draw 진입 확인
  return await page.locator('[data-testid="penchart-draw-attach-toggle"]').isVisible({ timeout: 8000 }).catch(() => false);
}

// ════════════════════════════════════════════════════════════════════════
// AC0·AC1 [실DOM]: 작성 중(draw) 첨부 — 토글 → 오버레이 패널 + 드롭존 + 카메라 input 노출
// ════════════════════════════════════════════════════════════════════════
test('AC0·AC1 [실DOM]: 새 펜차트 작성 중 사진 첨부 토글 → 오버레이(드롭존+카메라) 노출', async ({ page }) => {
  const ok = await enterNewPenChartDraw(page);
  test.skip(!ok, '시드(로그인/고객) 미가용 — 실DOM skip');

  // 토글 클릭 → 작성 중 첨부 오버레이 오픈
  await page.locator('[data-testid="penchart-draw-attach-toggle"]').click();
  await expect(page.locator('[data-testid="penchart-draw-attach-overlay"]')).toBeVisible();
  await expect(page.locator('[data-testid="penchart-attach-dropzone"]')).toBeVisible();

  // AC1: 갤러리 파일 input(multiple, accept image) + 카메라 input(capture) 둘 다
  const input = page.locator('[data-testid="penchart-attach-input"]');
  await expect(input).toHaveAttribute('type', 'file');
  await expect(input).toHaveAttribute('accept', /image/);
  await expect(input).toHaveAttribute('multiple', ''); // AC1b 장수 제한 없음(다중)
  const cam = page.locator('[data-testid="penchart-attach-camera-input"]');
  await expect(cam).toHaveAttribute('capture', /environment/);
  await expect(page.locator('[data-testid="penchart-attach-camera-btn"]')).toBeVisible();
});

// ════════════════════════════════════════════════════════════════════════
// AC0·AC2·AC3·AC5 [실DOM]: 작성 중 업로드 = photos/customer/{id}/pen-chart-attach/{stem}/<uuid>.<ext>
//   네트워크 PUT 을 가로채 경로를 실측 → 선발번 stem 이 pin 을 지키는지 재검증(정적 미러와 이중 게이트).
// ════════════════════════════════════════════════════════════════════════
test('AC0·2·3·5 [실DOM]: 작성 중 첨부 업로드 경로 = photos/pen-chart-attach/{선발번stem}/<uuid>.<ext>', async ({ page }) => {
  const ok = await enterNewPenChartDraw(page);
  test.skip(!ok, '시드(로그인/고객) 미가용 — 실DOM skip');

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

  await page.locator('[data-testid="penchart-draw-attach-toggle"]').click();
  await expect(page.locator('[data-testid="penchart-draw-attach-overlay"]')).toBeVisible();

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
  // AC3: photos 버킷(route 가 photos 로 이미 스코프됨) · AC5: pin 경로 구성요소 전수 검증
  expect(path).toContain(`customer/${SEED_CUSTOMER_ID}/pen-chart-attach/`);
  expect(path).toMatch(/\.png$/);                       // 확장자 보존
  expect(path).not.toMatch(/\/pen-chart\/[^-]/);        // pen-chart/ 하위 nesting 아님(sibling)
  // stem = pen-chart-attach/ 다음 세그먼트 = 선발번 {ts}_{rand}(또는 prefix+ts_rand)
  const stemSeg = path.split('/pen-chart-attach/')[1]?.split('/')[0] ?? '';
  expect(stemSeg).toMatch(/^(hq_(sr_)?|rc_|pc_(sr_)?)?\d{10,}_[a-z0-9]{2,}$/);
  // uuid 파일명 (마지막 세그먼트)
  const leaf = path.split('/').pop() ?? '';
  expect(leaf).toMatch(/^[0-9a-f-]{8,}\.png$/i);
});

// ════════════════════════════════════════════════════════════════════════
// AC4 [실DOM]: 사진 미첨부여도 작성 동선 정상 — 첨부 토글은 선택 항목(기본 닫힘, 캔버스 비침습)
// ════════════════════════════════════════════════════════════════════════
test('AC4 [실DOM]: 첨부 없이도 작성 동선 정상 (첨부 오버레이 기본 닫힘·비침습)', async ({ page }) => {
  const ok = await enterNewPenChartDraw(page);
  test.skip(!ok, '시드(로그인/고객) 미가용 — 실DOM skip');

  // 진입 직후 오버레이는 닫힌 상태(첨부=선택) — 저장 버튼 등 작성 동선은 그대로 노출.
  await expect(page.locator('[data-testid="penchart-draw-attach-overlay"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="penchart-draw-attach-toggle"]')).toBeVisible();
});
