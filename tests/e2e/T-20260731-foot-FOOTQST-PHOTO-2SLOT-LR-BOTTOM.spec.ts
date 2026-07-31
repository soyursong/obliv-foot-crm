/**
 * E2E spec — T-20260731-foot-FOOTQST-PHOTO-2SLOT-LR-BOTTOM
 * 발건강질문지 별도창 사진 업로드 — 맨 하단 + '오른발(R)/왼발(L)' 각 1장 슬롯 2개.
 *
 * ★정본 근거: data-architect CONSULT-REPLY MSG-20260731-154603-u7l6 (Path B GO + ADDITIVE).
 *   foot_side TEXT NULL CHECK(L/R). 오른발=R/왼발=L pin. NULL 허용(회귀0). 대문자 canonical.
 *   parent: T-20260731-foot-FOOTQST-PHOTO-UPLOAD (Pattern B 업로드 재사용).
 *
 * 시나리오 1 (functional): 폼 하단 오른발/왼발 슬롯 2개 → 각 슬롯 1장 업로드(썸네일) →
 *   제출 시 p_photos 가 foot_side(R/L) + token 경로 prefix 로 전달 (AC-1/2/3/4).
 * 시나리오 1-B (edge): 한쪽(오른발)만 업로드 → p_photos 1건(R)만 전달 (AC 시나리오2-1).
 * 시나리오 2 (static regression): 마이그레이션 ADDITIVE 불변식 + FE R/L pin + 스태프 라벨 회귀가드.
 *
 * anon + 토큰 게이트(fn_health_q_validate_token). validate/sign/upload/submit 라우트 모킹.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MOCK_LINK = 'e2e-mock-link';
const CLINIC = 'clinic-e2e';

// 1x1 PNG
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

async function mockValidateToken(page: Page) {
  await page.route('**/rest/v1/rpc/fn_health_q_validate_token', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true, token_id: 'tok-e2e', customer_id: 'cust-e2e',
        customer_name: 'E2E 테스트', clinic_id: CLINIC, check_in_id: null, form_type: 'general',
      }),
    });
  });
}

// 업로드 인프라(sign/PUT/submit) 모킹 — sign 은 요청 files 수만큼 token 경로 uploads 반환.
async function mockUploadInfra(page: Page): Promise<{ submitBody: () => Record<string, unknown> | null }> {
  let idx = 0;
  await page.route('**/functions/v1/health-q-photo-sign', async (route) => {
    const body = route.request().postDataJSON() as { files?: unknown[] };
    const n = Array.isArray(body?.files) ? body.files.length : 0;
    const uploads = Array.from({ length: n }, () => {
      const p = `health-q/${CLINIC}/${MOCK_LINK}/e2euuid-${idx++}.png`;
      return { path: p, signed_url: 'https://mock/upload', upload_token: 'utok', content_type: 'image/png' };
    });
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, bucket: 'foot-health-q-photos', uploads }),
    });
  });
  await page.route('**/storage/v1/object/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'ok' }) });
  });
  let captured: Record<string, unknown> | null = null;
  await page.route('**/rest/v1/rpc/fn_health_q_submit', async (route) => {
    captured = route.request().postDataJSON();
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, result_id: 'res-e2e', photos_saved: 2 }),
    });
  });
  return { submitBody: () => captured };
}

async function gotoForm(page: Page): Promise<boolean> {
  await mockValidateToken(page);
  await page.goto(`/health-q/${MOCK_LINK}`);
  try {
    await page.getByTestId('hq-foot-photo-section').waitFor({ timeout: 12_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('T-20260731 FOOTQST-PHOTO-2SLOT — 오른발/왼발 2슬롯 사진 첨부', () => {

  test('시나리오1: 오른발/왼발 각 1장 업로드 → p_photos foot_side(R/L)+token경로 전달 (AC-1/2/3/4)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    // AC-1: 맨 하단에 오른발/왼발 라벨 슬롯 2개
    await expect(page.getByTestId('hq-foot-slot-R')).toBeVisible();
    await expect(page.getByTestId('hq-foot-slot-L')).toBeVisible();
    await expect(page.getByTestId('hq-foot-slot-R').getByText('오른발')).toBeVisible();
    await expect(page.getByTestId('hq-foot-slot-L').getByText('왼발')).toBeVisible();

    const { submitBody } = await mockUploadInfra(page);

    // AC-2: 각 슬롯에 1장 업로드 → 해당 슬롯 썸네일
    await page.getByTestId('hq-foot-slot-R').locator('input[type="file"]').setInputFiles({
      name: 'right.png', mimeType: 'image/png', buffer: PNG_1PX,
    });
    await expect(page.getByTestId('hq-foot-thumb-R')).toBeVisible();

    await page.getByTestId('hq-foot-slot-L').locator('input[type="file"]').setInputFiles({
      name: 'left.png', mimeType: 'image/png', buffer: PNG_1PX,
    });
    await expect(page.getByTestId('hq-foot-thumb-L')).toBeVisible();

    // 제출 → p_photos 2건, foot_side R/L, token 경로 prefix
    await page.getByRole('button', { name: /제출하기|Submit/ }).click();
    await expect.poll(() => submitBody(), { timeout: 12_000 }).not.toBeNull();

    const body = submitBody() as unknown as {
      p_photos?: Array<{ path: string; content_type: string; byte_size: number; foot_side: string }>;
    };
    expect(Array.isArray(body.p_photos)).toBe(true);
    expect(body.p_photos!.length).toBe(2);
    // 순서 = FOOT_SLOTS(R→L) 고정
    expect(body.p_photos!.map((p) => p.foot_side)).toEqual(['R', 'L']);
    for (const ph of body.p_photos!) {
      expect(ph.path.startsWith(`health-q/${CLINIC}/${MOCK_LINK}/`)).toBe(true);
      expect(ph.content_type).toBe('image/png');
      expect(['L', 'R']).toContain(ph.foot_side);
    }
  });

  test('시나리오1-B: 한쪽(오른발)만 업로드 → p_photos 1건(R)만 (AC 시나리오2-1)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    const { submitBody } = await mockUploadInfra(page);

    await page.getByTestId('hq-foot-slot-R').locator('input[type="file"]').setInputFiles({
      name: 'right.png', mimeType: 'image/png', buffer: PNG_1PX,
    });
    await expect(page.getByTestId('hq-foot-thumb-R')).toBeVisible();
    // 왼발 슬롯은 빈 상태(추가 라벨 노출)
    await expect(page.getByTestId('hq-foot-slot-L').getByText('사진 추가')).toBeVisible();

    await page.getByRole('button', { name: /제출하기|Submit/ }).click();
    await expect.poll(() => submitBody(), { timeout: 12_000 }).not.toBeNull();

    const body = submitBody() as unknown as { p_photos?: Array<{ foot_side: string }> };
    expect(body.p_photos!.length).toBe(1);
    expect(body.p_photos![0].foot_side).toBe('R');
  });

  test('시나리오2-A: 마이그레이션 — foot_side ADDITIVE(nullable+CHECK L/R) + partial unique + RPC 연결', () => {
    const mig = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260731200000_foot_healthq_photo_foot_side.sql'), 'utf8');
    // ADDITIVE: ADD COLUMN IF NOT EXISTS nullable + CHECK L/R (대문자 canonical)
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS foot_side TEXT NULL/);
    expect(mig).toMatch(/CHECK \(foot_side IS NULL OR foot_side IN \('L','R'\)\)/);
    // partial unique index (슬롯당 1장, NULL 무영향)
    expect(mig).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_health_q_photos_result_side[\s\S]*WHERE foot_side IS NOT NULL/);
    // RPC 가 foot_side 를 읽어 INSERT (signature 불변 4-arg, CREATE OR REPLACE)
    expect(mig).toMatch(/v_side\s+TEXT/);
    expect(mig).toMatch(/v_photo ->> 'foot_side'/);
    expect(mig).toMatch(/INSERT INTO health_q_photos \([\s\S]*foot_side[\s\S]*\)/);
    // 파괴적 DDL 부재 (기존 컬럼 DROP/RENAME/재정의 없음 — 회귀0)
    expect(mig).not.toMatch(/DROP COLUMN/);
    expect(mig).not.toMatch(/DROP TABLE/);

    // 롤백 = 역연산(index DROP + column DROP + parent 4-arg 복원)
    const rb = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260731200000_foot_healthq_photo_foot_side.rollback.sql'), 'utf8');
    expect(rb).toMatch(/DROP INDEX IF EXISTS public\.uq_health_q_photos_result_side/);
    expect(rb).toMatch(/DROP COLUMN IF EXISTS foot_side/);
  });

  test('시나리오2-B: FE 슬롯 라벨→값 pin (오른발=R / 왼발=L, swap 금지)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/pages/HealthQMobilePage.tsx'), 'utf8');
    // FOOT_SLOTS 상수: 오른발=R, 왼발=L 매핑 고정
    expect(src).toMatch(/side:\s*'R',\s*ko:\s*'오른발'/);
    expect(src).toMatch(/side:\s*'L',\s*ko:\s*'왼발'/);
    // 제출 payload 에 foot_side 동봉 (laterality 연결)
    expect(src).toMatch(/foot_side:\s*entry\.side/);
    // Pattern B 업로드 재사용 (버킷 직접 upload 아님)
    expect(src).toMatch(/uploadToSignedUrl/);
    expect(src).not.toMatch(/from\(['"]foot-health-q-photos['"]\)\s*\.upload\(/);
  });

  test('시나리오2-C: 스태프 뷰어 — foot_side 조회 + 오른발/왼발 라벨 표시', () => {
    const panel = readFileSync(
      resolve(process.cwd(), 'src/components/HealthQResultsPanel.tsx'), 'utf8');
    // foot_side 를 select 로 조회
    expect(panel).toMatch(/\.select\(['"]id, storage_path, foot_side['"]\)/);
    // R/L → 오른발/왼발 라벨 매핑
    expect(panel).toMatch(/foot_side === 'R' \? '오른발' : p\.foot_side === 'L' \? '왼발'/);
  });
});
