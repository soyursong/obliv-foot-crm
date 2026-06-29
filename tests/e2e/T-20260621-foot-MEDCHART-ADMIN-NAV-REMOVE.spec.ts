/**
 * E2E spec — T-20260621-foot-MEDCHART-ADMIN-NAV-REMOVE
 * 진료차트(MedicalChartPanel) 우측 패널의 '관리화면 이동' 지름길 버튼 3종 제거.
 *
 * 배경(문지은 대표원장 요청): "진료차트는 나·부원장이 보는 공간 → 우측에서 관리화면 넘어가는 버튼 다 없애.
 *   진료관리는 내가 따로 들어가서 관리. 일반 원장이 차트에서 접근하면 안 됨."
 *
 * AC-1: 처방세트(rx-set-edit-btn)·상용구(phrase-edit-btn)·슈퍼상용구(super-phrase-edit-btn)
 *       '관리 화면으로' 버튼 전원(role 무관) 제거.
 * AC-2: 미사용된 handleNavigateToAdmin 함수 + navigate/useNavigate 제거.
 * AC-3: 관리화면 진입 lock-out 없음 — 서비스관리(/admin/services) 사이드바 잔존 +
 *       진료관리(/admin/clinic-management) 라우트/페이지 보존(차트 지름길만 제거).
 * AC-4: 우측 패널 처방세트/상용구/슈퍼상용구 '선택→폼 삽입' 본래 기능 유지(컨테이너·핸들러 보존).
 *
 * 검증 전략:
 *   S1/S2/AC-2 — MedicalChartPanel.tsx 정본 소스 정적 검증(데이터 비의존, 결정적).
 *     기존 repo 다수 spec과 동일한 fs 소스레벨 패턴.
 *   S3 — 라이브 내비게이션(사이드바 목적지 잔존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PANEL_SRC = resolve(__dirname, '../../src/components/MedicalChartPanel.tsx');
const ADMIN_LAYOUT_SRC = resolve(__dirname, '../../src/components/AdminLayout.tsx');
const APP_SRC = resolve(__dirname, '../../src/App.tsx');

function readSrc(p: string): string {
  return readFileSync(p, 'utf8');
}

// ── S1: '관리 화면으로' 지름길 버튼 3종 제거 (AC-1) ─────────────────────────────
test.describe('S1: 관리화면 지름길 버튼 3종 제거 (AC-1)', () => {
  const src = readSrc(PANEL_SRC);

  test('rx-set-edit-btn(처방세트 관리 화면으로) 버튼 testid 부재', () => {
    expect(src).not.toContain('data-testid="rx-set-edit-btn"');
    expect(src).not.toContain('처방세트 관리 화면으로');
  });

  test('phrase-edit-btn(상용구 관리 화면으로) 버튼 testid 부재', () => {
    expect(src).not.toContain('data-testid="phrase-edit-btn"');
    expect(src).not.toContain('상용구 관리 화면으로');
  });

  test('super-phrase-edit-btn(슈퍼상용구 관리 화면으로) 버튼 testid 부재', () => {
    expect(src).not.toContain('data-testid="super-phrase-edit-btn"');
    expect(src).not.toContain('슈퍼상용구 관리 화면으로');
  });

  test('handleNavigateToAdmin 호출(onClick) 잔존 0건', () => {
    // 주석(제거 기록)은 허용하되 실제 onClick 호출은 0건이어야 함.
    expect(src).not.toContain('handleNavigateToAdmin(');
  });
});

// ── S2/AC-2: 미사용 네비게이션 코드 제거 ────────────────────────────────────────
test.describe('S2: 미사용 navigate 코드 제거 (AC-2)', () => {
  const src = readSrc(PANEL_SRC);

  test('useNavigate import 제거', () => {
    expect(src).not.toContain("import { useNavigate } from 'react-router-dom'");
  });

  test('navigate 인스턴스(const navigate = useNavigate()) 제거', () => {
    expect(src).not.toContain('const navigate = useNavigate()');
    // navigate(...) 실제 호출도 0건
    expect(src).not.toMatch(/\bnavigate\(['"`]/);
  });
});

// ── AC-4: 우측 패널 '선택→폼 삽입' 본래 기능 유지 ───────────────────────────────
test.describe('AC-4: 처방/상용구/슈퍼상용구 본래 기능 유지', () => {
  const src = readSrc(PANEL_SRC);

  test('우측 탭 콘텐츠 컨테이너 3종 보존 (rx/phrase/super)', () => {
    expect(src).toContain('data-testid="right-panel-rx-content"');
    expect(src).toContain('data-testid="right-panel-phrase-content"');
    expect(src).toContain('data-testid="right-panel-super-content"');
  });

  test('처방 검색→삽입(rx-search-box) 본래 기능 보존', () => {
    expect(src).toContain('data-testid="rx-search-box"');
    expect(src).toContain('data-testid="rx-search-input"');
  });

  test('상용구 선택삽입 핸들러(insertPhrase/togglePhraseRow류) 보존', () => {
    // 본래 클릭삽입 동선(RX-PHRASE-CLICK-INSERT)은 무영향이어야 함.
    expect(src).toMatch(/insertPhrase|insertSelectedPhrase|togglePhraseRow|applySuperPhrase/);
  });
});

// ── AC-3: 관리화면 진입 lock-out 가드 (소스 + 라이브) ──────────────────────────
test.describe('AC-3: 관리화면 진입 경로 보존(lock-out 없음)', () => {
  test('소스: 서비스관리(/admin/services) 사이드바 항목 잔존', () => {
    const nav = readSrc(ADMIN_LAYOUT_SRC);
    expect(nav).toContain('/admin/services');
    expect(nav).toContain('서비스관리');
  });

  test('소스: 진료관리(/admin/clinic-management) 라우트/페이지 보존', () => {
    const app = readSrc(APP_SRC);
    expect(app).toContain('clinic-management');
  });

  test('라이브: 서비스관리 진입 가능 (사이드바 단일 진입점 살아있음)', async ({ page }) => {
    const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
    await page.goto(BASE_URL);
    const loginInput = page.getByPlaceholder('이메일');
    if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
      await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
      await page.getByRole('button', { name: '로그인' }).click();
      await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 }).catch(() => {});
    }
    const resp = await page.goto(`${BASE_URL}/admin/services`);
    // 라우트가 살아있어 200대로 응답(또는 SPA 라우팅으로 진입). 404/하드에러 아님.
    if (resp) expect(resp.status()).toBeLessThan(400);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    expect(page.url()).toContain('/admin/services');
  });
});
