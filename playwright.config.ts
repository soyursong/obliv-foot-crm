import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env (Supabase URL/key) + .env.test (테스트 전용 플래그) 를 모두 로드
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '.env.test') });

const AUTH_FILE = path.join(__dirname, '.auth', 'user.json');

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/helpers.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:8082',
    screenshot: 'on',
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  outputDir: './test-results',

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      // unit: auth 불필요 순수 함수 테스트 (htmlFormTemplates, formTemplates 등)
      // T-20260521-foot-CLINIC-INFO-SYNC PUSH 대응: 전종 검증 스펙 포함
      // T-20260521-foot-DOC-PRINT-UNIFY: 서류 출력 경로 통일 락 스펙 추가
      name: 'unit',
      testMatch: [
        '**/T-20260520-foot-PRINT-FORM-BIND.spec.ts',
        '**/T-20260521-foot-CLINIC-INFO-SYNC-FULLSUITE.spec.ts',
        '**/T-20260521-foot-DOC-PRINT-UNIFY.spec.ts',
        // T-20260523-foot-FORM-TEMPLATE-REGEN: pen_chart 이미지 오매핑 회귀 방지 (파일시스템 검증)
        '**/T-20260523-foot-FORM-TEMPLATE-REGEN.spec.ts',
        // T-20260523-foot-PENCHART-INSURANCE: [보험차트] 명칭 + 자동채움 위치 (소스 grep, DB 검증)
        '**/T-20260523-foot-PENCHART-INSURANCE.spec.ts',
      ],
      use: {
        ...devices['Desktop Chrome'],
      },
      // auth 의존성 없음 — page 객체 미사용 순수 함수 테스트
    },
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        storageState: AUTH_FILE,
      },
      dependencies: ['setup'],
    },
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
      },
      // Tablet은 공개 페이지만 (로그인 rate limit 회피, storageState 미사용)
      testMatch: ['**/page-screenshots.spec.ts', '**/self-checkin.spec.ts'],
      grep: /Public|Self check-in route/,
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:8082',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      // Vite dev 서버에 테스트 모드 플래그 전달 → src/lib/supabase.ts 에서 lock 우회
      VITE_DISABLE_AUTH_LOCK: '1',
    },
  },
});
