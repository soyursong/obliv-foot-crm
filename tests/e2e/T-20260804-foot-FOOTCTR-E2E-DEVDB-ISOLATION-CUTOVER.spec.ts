/**
 * T-20260804-foot-FOOTCTR-E2E-DEVDB-ISOLATION-CUTOVER — E2E/dev DB 근본격리(L3) 회귀 spec
 *
 * 배경: SMS-DUMMY-SEAL(e9f8fb7c) 의 L3 leg = defense-in-depth 근본격리.
 *   E2E/dev 러너가 .env.local(=PROD ref rxlomoozakkjesdqjtvd) 대신
 *   .env.dev-isolation.local(=DEV ref kcdqtyivtqcjmcrdjkqi)로 write 하도록 컷오버.
 *
 * 검증 대상(playwright.config.ts 부팅 블록이 사용하는 순수 로직 tests/devIsolationEnv.ts):
 *   AC-1 isTruthyFlag: 플래그 truthy/falsy 판정 — OFF 기본값이 현행 CI 무파손을 보장.
 *   AC-2 mapDevIsolationEnv 정상: DEV_SUPABASE_* → 하네스 표준 키(VITE_/SERVICE_ROLE) 매핑
 *        + EXPECT_DEV_DB_REF 자동 세팅(PRODREF-HARDGUARD 활성 트리거).
 *   AC-3 fail-closed: url/ref 부재, prod ref 오배선 → throw(조용히 prod 로 흐르지 않음).
 *   AC-4 실 provisioning 파일(.env.dev-isolation.local) 정합 — 존재 시 dev ref 로 매핑됨.
 *
 * READ-ONLY — 브라우저/DB 접속 없음(순수 함수 검증). prod 무접점.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import dotenv from 'dotenv';
import {
  isTruthyFlag,
  mapDevIsolationEnv,
  KNOWN_PROD_REF,
  DEV_ISOLATION_REF,
} from '../devIsolationEnv';

// 이 spec 은 네트워크/스토리지 불요 — auth·webServer 의존 제거(격리 실행 안전).
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('E2E-DEVDB-ISOLATION L3 근본격리 로직', () => {
  test('AC-1 isTruthyFlag — OFF 기본값(현행 CI 무파손) + ON 값 판정', () => {
    // OFF: 미설정/빈값/명시적 falsy → false (컷오버 전 prod 타깃 유지)
    for (const off of [undefined, null, '', '0', 'false', 'off', 'no', ' FALSE ']) {
      expect(isTruthyFlag(off as string | undefined)).toBe(false);
    }
    // ON: 1/true/on/임의 truthy
    for (const on of ['1', 'true', 'on', 'yes', 'dev']) {
      expect(isTruthyFlag(on)).toBe(true);
    }
  });

  test('AC-2 mapDevIsolationEnv — DEV_SUPABASE_* → 하네스 표준 키 매핑 + guard 활성', () => {
    const mapped = mapDevIsolationEnv(
      {
        DEV_SUPABASE_PROJECT_REF: DEV_ISOLATION_REF,
        DEV_SUPABASE_URL: `https://${DEV_ISOLATION_REF}.supabase.co`,
        DEV_SUPABASE_ANON_KEY: 'anon-xyz',
        DEV_SUPABASE_SERVICE_ROLE_KEY: 'service-xyz',
      },
      'unit',
    );
    expect(mapped.VITE_SUPABASE_URL).toContain(DEV_ISOLATION_REF);
    expect(mapped.VITE_SUPABASE_URL).not.toContain(KNOWN_PROD_REF);
    expect(mapped.VITE_SUPABASE_ANON_KEY).toBe('anon-xyz');
    expect(mapped.SUPABASE_SERVICE_ROLE_KEY).toBe('service-xyz');
    // EXPECT_DEV_DB_REF 세팅 = PRODREF-HARDGUARD(assertExpectedDbTarget) 활성 트리거
    expect(mapped.EXPECT_DEV_DB_REF).toBe(DEV_ISOLATION_REF);
  });

  test('AC-3 fail-closed — prod ref 오배선은 abort(조용히 prod 로 흐르지 않음)', () => {
    // (a) url/ref 부재
    expect(() => mapDevIsolationEnv({}, 'unit')).toThrow(/DEV_SUPABASE_URL\/DEV_SUPABASE_PROJECT_REF/);
    // (b) URL 이 prod ref 를 가리킴 → abort
    expect(() =>
      mapDevIsolationEnv(
        {
          DEV_SUPABASE_PROJECT_REF: KNOWN_PROD_REF,
          DEV_SUPABASE_URL: `https://${KNOWN_PROD_REF}.supabase.co`,
        },
        'unit',
      ),
    ).toThrow(/prod 오배선/);
    // (c) ref 와 URL 불일치(오배선) → abort
    expect(() =>
      mapDevIsolationEnv(
        {
          DEV_SUPABASE_PROJECT_REF: DEV_ISOLATION_REF,
          DEV_SUPABASE_URL: 'https://someother.supabase.co',
        },
        'unit',
      ),
    ).toThrow(/dev ref/);
  });

  test('AC-4 실 provisioning 파일 정합 — 존재 시 dev ref 로 매핑(부재 시 skip)', () => {
    const candidates = [
      process.env.FOOT_DEV_ISOLATION_ENV,
      path.join(os.homedir(), 'GitHub', 'obliv-foot-crm', '.env.dev-isolation.local'),
      path.join(os.homedir(), 'Documents', 'GitHub', 'obliv-foot-crm', '.env.dev-isolation.local'),
    ].filter((p): p is string => !!p);
    const hit = candidates.find((p) => fs.existsSync(p));
    test.skip(!hit, 'provisioning 파일 부재(fresh 워크트리/CI secret) → 순수 로직 AC-1~3 으로 대체');
    const parsed = dotenv.parse(fs.readFileSync(hit!));
    const mapped = mapDevIsolationEnv(parsed, hit!);
    expect(mapped.EXPECT_DEV_DB_REF).toBe(DEV_ISOLATION_REF);
    expect(mapped.VITE_SUPABASE_URL).toContain(DEV_ISOLATION_REF);
    expect(mapped.VITE_SUPABASE_URL).not.toContain(KNOWN_PROD_REF);
  });
});
