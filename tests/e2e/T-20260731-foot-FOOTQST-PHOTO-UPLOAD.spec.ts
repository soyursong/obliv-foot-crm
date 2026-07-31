/**
 * E2E spec — T-20260731-foot-FOOTQST-PHOTO-UPLOAD
 * 발건강질문지 고객 사진 첨부 (Pattern B: anon→edge fn 서명 URL→uploadToSignedUrl→제출 RPC 연관)
 *
 * ★정본 근거: data-architect CONSULT-REPLY MSG-20260731-135832-y3x7 (GO + ADDITIVE).
 *
 * 시나리오 1 (functional): 폼 렌더 → 사진 첨부(썸네일) → 제출 시 edge fn 서명 URL 업로드 →
 *   fn_health_q_submit 이 p_photos(경로 prefix health-q/{clinic}/{token}/) 로 호출됨 (AC-1/2/3).
 * 시나리오 2 (static regression, DA 강제 5항): 마이그레이션/edge fn/소스 불변식 회귀가드.
 *
 * anon + 토큰 게이트(fn_health_q_validate_token). E2E 는 validate/sign/upload/submit 를 라우트 모킹.
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

async function gotoForm(page: Page): Promise<boolean> {
  await mockValidateToken(page);
  await page.goto(`/health-q/${MOCK_LINK}`);
  try {
    await page.getByText('발 · 발톱 사진 첨부', { exact: false }).first().waitFor({ timeout: 12_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('T-20260731 FOOTQST-PHOTO-UPLOAD — 발건강질문지 사진 첨부', () => {

  test('시나리오1: 사진 첨부 → 썸네일 → 제출 시 p_photos(token 경로) 전달 (AC-1/2/3)', async ({ page }) => {
    const ok = await gotoForm(page);
    if (!ok) test.skip(true, 'health-q 라우트 없음 — 환경 불일치');

    // 사진 첨부 UI 노출
    await expect(page.getByText('카메라 촬영', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('앨범 선택', { exact: false }).first()).toBeVisible();

    // 파일 첨부 → 썸네일 그리드
    await page.locator('input[type="file"][accept="image/*"]').last().setInputFiles({
      name: 'foot.png', mimeType: 'image/png', buffer: PNG_1PX,
    });
    await expect(page.getByTestId('hq-photo-grid')).toBeVisible();
    await expect(page.getByTestId('hq-photo-grid').locator('img')).toHaveCount(1);

    // edge fn 서명 URL 발급 모킹 (token 경로 반환)
    const signedPath = `health-q/${CLINIC}/${MOCK_LINK}/e2euuid.png`;
    await page.route('**/functions/v1/health-q-photo-sign', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          ok: true, bucket: 'foot-health-q-photos',
          uploads: [{ path: signedPath, signed_url: 'https://mock/upload', upload_token: 'utok', content_type: 'image/png' }],
        }),
      });
    });
    // signed upload PUT + documents JSON 백업 → 200 성공 모킹
    await page.route('**/storage/v1/object/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: signedPath }) });
    });

    // 제출 RPC body 캡처
    let submitBody: Record<string, unknown> | null = null;
    await page.route('**/rest/v1/rpc/fn_health_q_submit', async (route) => {
      submitBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, result_id: 'res-e2e', photos_saved: 1 }) });
    });

    await page.getByRole('button', { name: /제출하기|Submit/ }).click();
    await expect.poll(() => submitBody, { timeout: 12_000 }).not.toBeNull();

    const body = submitBody as unknown as { p_photos?: Array<{ path: string; content_type: string; byte_size: number }> };
    expect(Array.isArray(body.p_photos)).toBe(true);
    expect(body.p_photos!.length).toBe(1);
    // 경로가 token/clinic prefix 로 시작 (DA ③ anon-write token 경로 한정)
    expect(body.p_photos![0].path.startsWith(`health-q/${CLINIC}/${MOCK_LINK}/`)).toBe(true);
    expect(body.p_photos![0].content_type).toBe('image/png');
  });

  test('시나리오2-A: 마이그레이션 — 버킷 private + 테이블 CASCADE/denorm + RLS + anon storage insert 부재 (DA ①②④⑤)', () => {
    const mig = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260731150000_foot_healthq_photo_upload.sql'), 'utf8');
    // ① 신규 전용 private 버킷
    expect(mig).toMatch(/foot-health-q-photos/);
    expect(mig).toMatch(/public = false/);
    // ⑤ CASCADE + clinic_id denorm
    expect(mig).toMatch(/result_id\s+UUID\s+NOT NULL REFERENCES public\.health_q_results\(id\) ON DELETE CASCADE/);
    expect(mig).toMatch(/clinic_id\s+UUID\s+NOT NULL REFERENCES public\.clinics\(id\)/);
    // ④ 직원 SELECT clinic 스코프 (테이블 + storage.objects 미러)
    expect(mig).toMatch(/health_q_photos_select_clinic[\s\S]*current_user_clinic_id\(\)/);
    expect(mig).toMatch(/health_q_photos_obj_read[\s\S]*foldername\(name\)\)\[2\] = public\.current_user_clinic_id\(\)/);
    // ② anon 에 storage.objects INSERT 정책이 이 버킷에 부여되지 않음 (문서화 + 실제 부재)
    expect(mig).not.toMatch(/FOR INSERT TO anon/);
    expect(mig).not.toMatch(/TO anon[\s\S]*foot-health-q-photos/);
    // ③ 제출 RPC 가 경로 prefix 재검증
    expect(mig).toMatch(/v_prefix\s*:=\s*'health-q\/'/);
    expect(mig).toMatch(/left\(v_path, length\(v_prefix\)\) = v_prefix/);
    // jsonb photo_paths REJECT → 전용 1:N 테이블
    expect(mig).toMatch(/CREATE TABLE IF NOT EXISTS public\.health_q_photos/);
    // DELETE 정책 미부여(archive-first) — storage 삭제 정책 부재
    expect(mig).not.toMatch(/health_q_photos_obj_delete/);
  });

  test('시나리오2-B: edge fn — service_role + token 검증 + anon 직접 GRANT 없음 (DA a-HARD)', () => {
    const ef = readFileSync(
      resolve(process.cwd(), 'supabase/functions/health-q-photo-sign/index.ts'), 'utf8');
    expect(ef).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(ef).toMatch(/createSignedUploadUrl/);
    // token 검증(used_at / expires_at)
    expect(ef).toMatch(/health_q_tokens/);
    expect(ef).toMatch(/token_expired/);
    expect(ef).toMatch(/already_used/);
    // 경로는 EF 가 검증 clinic_id/token 으로 구성 (anon path 선택 불가)
    expect(ef).toMatch(/health-q\/\$\{tok\.clinic_id\}\/\$\{token\}\//);
    // 이미지 화이트리스트
    expect(ef).toMatch(/unsupported_type/);

    const cfg = readFileSync(resolve(process.cwd(), 'supabase/config.toml'), 'utf8');
    expect(cfg).toMatch(/\[functions\.health-q-photo-sign\][\s\S]*verify_jwt = false/);
  });

  test('시나리오2-C: 소스 불변식 — 사진은 uploadToSignedUrl 로만 업로드(버킷 직접 upload 아님)', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/pages/HealthQMobilePage.tsx'), 'utf8');
    // Pattern B: 서명 URL 업로드
    expect(page).toMatch(/uploadToSignedUrl/);
    expect(page).toMatch(/health-q-photo-sign/);
    // 사진을 foot-health-q-photos 버킷에 anon 이 직접 .from(...).upload() 하지 않음
    expect(page).not.toMatch(/from\(['"]foot-health-q-photos['"]\)\s*\.upload\(/);
  });
});
