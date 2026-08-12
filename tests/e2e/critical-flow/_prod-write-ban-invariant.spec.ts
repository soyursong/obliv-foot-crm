/**
 * CF-PROD-WRITE-BAN 불변식 + 가드 유닛 (cross-CRM CI 불변식) — AC-1/AC-4
 *   T-20260812-meta-CLOSING-HERALD-CF5-E2E-PROD-WRITE-BAN
 *
 * 순수 spec(auth/DB/webServer 불요·결정론) — unit 프로젝트에서만 실행(desktop-chrome testIgnore).
 *
 * 두 가지를 강제한다:
 *  1) [불변식] critical-flow 디렉터리의 어떤 spec 도 @supabase/supabase-js 에서 createClient 를
 *     직접 import 하지 않는다 → 반드시 ./_prodWriteGuard 의 가드된 createClient 를 쓴다.
 *     그리고 DB write/seed 하는 CF spec 은 fixtures 시더보다 먼저 도는
 *     test.beforeAll(assertCriticalFlowDbSafe) primary 게이트를 갖는다.
 *     (미래 신규 CF spec 이 가드를 우회해 prod 로 write 하는 재발을 정적으로 차단.)
 *  2) [가드 유닛] resolveTargetRef / isProdRef / assertCriticalFlowDbSafe / createClient 팩토리가
 *     PROD ref → hard-fail, dev/stage/local/unknown → 통과(회귀 0, AC-4) 임을 실증.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  KNOWN_PROD_REFS,
  resolveTargetRef,
  isProdRef,
  assertCriticalFlowDbSafe,
  createClient,
} from './_prodWriteGuard';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 비-prod(dev/stage) 대표 ref — 20자 [a-z0-9] 이지만 KNOWN_PROD_REFS 에 없음 → 절대 false-fail 안 함(AC-4).
const DEV_REF = 'devreflocal000000000';
const FOOT_PROD_REF = 'rxlomoozakkjesdqjtvd'; // cross-CRM 상수(어느 repo 에서든 동일)
const BODY_PROD_REF = 'hmxnjdmdgfxmsfvytssm';

test.describe('CF-PROD-WRITE-BAN 불변식 (AC-1)', () => {
  test('critical-flow spec 은 @supabase/supabase-js createClient 를 직접 import 하지 않는다', () => {
    const files = fs
      .readdirSync(__dirname)
      .filter((f) => f.endsWith('.spec.ts') && !f.startsWith('_')); // 가드/불변식 파일 자신은 제외
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf-8');
      const directImport =
        /import\s*\{[^}]*\bcreateClient\b[^}]*\}\s*from\s*['"]@supabase\/supabase-js['"]/.test(src);
      if (directImport) offenders.push(f);
    }
    expect(
      offenders,
      `다음 critical-flow spec 이 가드를 우회해 @supabase/supabase-js 에서 createClient 를 직접 import 합니다. ` +
        `./_prodWriteGuard 의 가드된 createClient 로 교체하세요: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  test('CF DB-write spec 은 가드 모듈 import + primary beforeAll 게이트를 갖는다(양성 확인)', () => {
    const files = fs
      .readdirSync(__dirname)
      .filter((f) => /^CF-\d/.test(f) && f.endsWith('.spec.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf-8');
      const doesDbWork = /\bcreateClient\b/.test(src) || /\bseed(CheckIn|Reservation|Package)\b/.test(src);
      if (!doesDbWork) continue;
      expect(src, `${f} 가 가드 모듈(./_prodWriteGuard)에서 import 해야 함`).toMatch(
        /from\s*['"]\.\/_prodWriteGuard['"]/,
      );
      expect(
        src,
        `${f} 는 fixtures 시더보다 먼저 도는 test.beforeAll(assertCriticalFlowDbSafe) 게이트를 가져야 함`,
      ).toMatch(/beforeAll\([\s\S]{0,80}?assertCriticalFlowDbSafe/);
    }
  });
});

test.describe('CF-PROD-WRITE-BAN 가드 유닛 (AC-1/AC-4)', () => {
  test('resolveTargetRef — supabase URL 에서 ref 추출', () => {
    expect(resolveTargetRef(`https://${FOOT_PROD_REF}.supabase.co`)).toBe(FOOT_PROD_REF);
    expect(resolveTargetRef(`https://${DEV_REF}.supabase.co`)).toBe(DEV_REF);
    expect(resolveTargetRef('http://localhost:54321')).toBeNull();
    expect(resolveTargetRef('')).toBeNull();
    expect(resolveTargetRef(undefined)).toBeNull();
  });

  test('isProdRef — 전 CRM prod ref 판정', () => {
    for (const ref of KNOWN_PROD_REFS) expect(isProdRef(ref)).toBe(true);
    expect(isProdRef(DEV_REF)).toBe(false); // dev = false (AC-4)
    expect(isProdRef('localhost')).toBe(false);
    expect(isProdRef(null)).toBe(false);
  });

  test('assertCriticalFlowDbSafe — PROD 타깃이면 hard-fail', () => {
    const prev = process.env.VITE_SUPABASE_URL;
    try {
      process.env.VITE_SUPABASE_URL = `https://${FOOT_PROD_REF}.supabase.co`;
      expect(() => assertCriticalFlowDbSafe('unit')).toThrow(/CF-PROD-WRITE-BAN/);
      // 형제 CRM(body) prod ref 도 차단(cross-wired secret 방어).
      process.env.VITE_SUPABASE_URL = `https://${BODY_PROD_REF}.supabase.co`;
      expect(() => assertCriticalFlowDbSafe('unit')).toThrow(/CF-PROD-WRITE-BAN/);
    } finally {
      if (prev === undefined) delete process.env.VITE_SUPABASE_URL;
      else process.env.VITE_SUPABASE_URL = prev;
    }
  });

  test('assertCriticalFlowDbSafe — dev/stage/local/unset 은 통과(회귀 0, AC-4)', () => {
    const prev = process.env.VITE_SUPABASE_URL;
    try {
      process.env.VITE_SUPABASE_URL = `https://${DEV_REF}.supabase.co`;
      expect(() => assertCriticalFlowDbSafe('unit')).not.toThrow();
      process.env.VITE_SUPABASE_URL = 'http://localhost:54321';
      expect(() => assertCriticalFlowDbSafe('unit')).not.toThrow();
      delete process.env.VITE_SUPABASE_URL;
      expect(() => assertCriticalFlowDbSafe('unit')).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.VITE_SUPABASE_URL;
      else process.env.VITE_SUPABASE_URL = prev;
    }
  });

  test('createClient 팩토리 — PROD 타깃이면 client 생성 이전에 throw', () => {
    const prev = process.env.VITE_SUPABASE_URL;
    try {
      process.env.VITE_SUPABASE_URL = `https://${FOOT_PROD_REF}.supabase.co`;
      expect(() => createClient(`https://${FOOT_PROD_REF}.supabase.co`, 'service-key-dummy')).toThrow(
        /CF-PROD-WRITE-BAN/,
      );
      process.env.VITE_SUPABASE_URL = `https://${DEV_REF}.supabase.co`;
      expect(() => createClient(`https://${DEV_REF}.supabase.co`, 'anon-key-dummy')).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.VITE_SUPABASE_URL;
      else process.env.VITE_SUPABASE_URL = prev;
    }
  });
});
