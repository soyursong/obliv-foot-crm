/**
 * T-20260807-foot-CFPAGES-ASSET-404-HTML-IMMUTABLE
 *
 * 현장 클릭 시나리오 → E2E 변환:
 *   시나리오 2 (엣지): 없는 /assets/*.js → 404 (index.html HTML 200 아님) — DoD#1
 *   시나리오 1 (정상): 실존 /assets/*.js → 200 · JS MIME · immutable 유지     — DoD#2
 *                      SPA 라우트(/dashboard 등) → 200 HTML (fallback 정상)   — DoD#3
 *
 * ★왜 자체 wrangler 를 띄우나:
 *   버그는 CF Pages 서버 라우팅(_redirects SPA fallback + _headers immutable +
 *   functions/assets/[[path]].js) 의 응답 시맨틱 문제다. 기본 Vite dev(webServer 8091)는
 *   CF Pages 라우팅을 재현하지 못하므로(fallback/_headers/functions 미적용) 거짓 통과가
 *   된다. 따라서 dist 를 wrangler pages dev(workerd/miniflare = 프로덕션 CF Pages 런타임)로
 *   서빙해 실제 라우팅을 관측한다. request 컨텍스트만 사용 → auth/DB 불요·결정론.
 *
 * unit 프로젝트 전용(auth.setup 미의존) + desktop-chrome testIgnore(무-project 실행 시
 *   setup 유입 차단). CI 상시 감시는 scripts/check-cfpages-asset-404.sh (ci-push §6).
 */
import { test, expect, request as pwRequest } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../../dist');
const ASSETS_DIR = path.join(DIST, 'assets');
const PORT = Number(process.env.CF_ASSET404_PORT || 8793);
const BASE = `http://127.0.0.1:${PORT}`;
const WRANGLER = process.env.WRANGLER_CMD || 'npx';
const WRANGLER_ARGS = process.env.WRANGLER_CMD
  ? ['pages', 'dev', 'dist']
  : ['--yes', 'wrangler@4.119.0', 'pages', 'dev', 'dist'];

let server: ChildProcess | undefined;

// dist 빌드 산출물이 없으면(무-빌드 QA 워크트리) 결정론적으로 skip.
const hasBuild = existsSync(ASSETS_DIR) && readdirSync(ASSETS_DIR).some((f) => f.endsWith('.js'));

function pickRealAsset(): string {
  const js = readdirSync(ASSETS_DIR).find((f) => f.endsWith('.js'));
  if (!js) throw new Error('dist/assets/*.js 실존 자산 없음');
  return `/assets/${js}`;
}

// readiness = 실제 HTTP 응답으로 판정(로그 파싱은 러너별로 불안정) — 자체 기동한 wrangler
// 이므로 unique 포트 + 사전 kill 하에 오탐 없음. wrangler 로그는 실패 시 진단용으로만 수집.
async function waitReady(proc: ChildProcess): Promise<void> {
  let log = '';
  const cap = (b: Buffer) => { log += b.toString(); };
  proc.stdout?.on('data', cap);
  proc.stderr?.on('data', cap);
  let exited: number | null | undefined;
  proc.on('exit', (code) => { exited = code; });

  const deadline = Date.now() + 85_000;
  while (Date.now() < deadline) {
    if (exited !== undefined) {
      throw new Error(`wrangler 조기 종료 code=${exited}\n--- log ---\n${log.slice(-1500)}`);
    }
    try {
      const res = await fetch(`${BASE}/dashboard`, { signal: AbortSignal.timeout(2000) });
      // 우리 CF 런타임은 SPA 라우트를 index.html(HTML)로 회신 → 기동 확증
      if (res.status === 200 && (res.headers.get('content-type') || '').includes('text/html')) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`wrangler ready timeout(85s)\n--- log ---\n${log.slice(-1500)}`);
}

test.describe('CF Pages 자산-404 서버오답 (DoD#1~3)', () => {
  test.skip(!hasBuild, 'dist 미빌드 — `npm run build` 후 실행');
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    test.setTimeout(120_000); // 훅 기본 60s → wrangler ready(최대 90s) 수용
    server = spawn(WRANGLER, [...WRANGLER_ARGS, '--port', String(PORT), '--ip', '127.0.0.1', '--compatibility-date=2024-01-01'], {
      cwd: path.resolve(__dirname, '../..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitReady(server);
  });

  test.afterAll(async () => {
    server?.kill('SIGKILL');
  });

  test('시나리오2/DoD#1: 없는 /assets/*.js → 404 (HTML 200 아님)', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${BASE}/assets/does-not-exist-xyz-e2e.js`);
    expect(res.status(), '없는 자산은 404 여야 함').toBe(404);
    expect(res.headers()['content-type'] || '', '없는 자산이 HTML 로 회신되면 SPA fallback 누수(재발)').not.toContain('text/html');
    await ctx.dispose();
  });

  test('시나리오1/DoD#2: 실존 /assets/*.js → 200 · JS MIME · immutable', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${BASE}${pickRealAsset()}`);
    expect(res.status(), '실존 자산은 200').toBe(200);
    const ct = res.headers()['content-type'] || '';
    expect(ct, `JS MIME 이어야 함(got: ${ct})`).toContain('javascript');
    expect(res.headers()['cache-control'] || '', 'immutable 유지되어야 함(DoD#2)').toContain('immutable');
    await ctx.dispose();
  });

  test('DoD#3: SPA 라우트 /dashboard → 200 HTML (fallback 정상·과차단 없음)', async () => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${BASE}/dashboard`);
    expect(res.status(), 'SPA 라우트는 200').toBe(200);
    expect(res.headers()['content-type'] || '', 'SPA 라우트는 index.html HTML').toContain('text/html');
    await ctx.dispose();
  });
});
