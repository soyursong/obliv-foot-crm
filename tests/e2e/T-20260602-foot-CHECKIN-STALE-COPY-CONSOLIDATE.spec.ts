/**
 * E2E Spec: T-20260602-foot-CHECKIN-STALE-COPY-CONSOLIDATE (AC2 실행분)
 * 풋 셀프접수 stale 사본 단일화 — obliv-foot-crm 의 dead native SelfCheckIn 사본 완전 제거.
 * canonical = foot-checkin.pages.dev/jongno-foot (soyursong/foot-checkin) 단일.
 *
 * AC2 (단일화 실행): obliv 의 stale native SelfCheckIn.tsx 컴포넌트 + App.tsx 렌더 배선 제거.
 *   /checkin/jongno-foot 은 vercel.json 의 permanent 301 edge redirect 로 canonical 이관(무중단).
 * AC3 (회귀 0): /checkin/:clinicSlug 방어심화 라우트(CheckinRoute)는 보존 — deprecated slug 계약
 *   (helpers.expectDeprecatedCheckinRedirect)을 유지해 edge 우회/client 진입 시에도 canonical 로
 *   강제 리다이렉트. CheckinRoute 는 리다이렉트 전용으로 전환(native 렌더 제거)되어 접수 단절 0.
 * AC4 (DB 무파괴): 라우팅 config + 컴포넌트/spec 정리만 — 스키마/데이터 변경 없음.
 *
 * 검증 방식(중요): 셀프접수는 QR/직접 URL(키오스크) 진입이라 항상 Vercel edge 를 경유한다.
 *   단일화는 **vercel.json 의 permanent 301 edge redirect** 로 구현(SPA 미로드 즉시 리다이렉트,
 *   접수 동선 단절 0). obliv 의 stale native SelfCheckIn 사본은 YESNO-FLOW/VISITTYPE-REMOVE
 *   미반영 dead 코드(edge redirect 로 우회되어 현장 미노출)여서 dev wrong-target 근원이 되었고,
 *   본 AC2 에서 컴포넌트/라우트 배선 완전 제거. vite dev(테스트 서버)는 vercel.json 을 적용하지
 *   않으므로 edge redirect 는 **배포 config 정적 검증**으로 확인한다(아래). 프로덕션/프리뷰는
 *   Vercel 이 vercel.json 을 적용하므로 실제 301 이 발생한다(완료 게이트 = curl -sI 스모크).
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const CANONICAL_URL = 'https://foot-checkin.pages.dev/jongno-foot';

type VercelRedirect = { source: string; destination: string; permanent?: boolean };
type VercelConfig = { redirects?: VercelRedirect[]; rewrites?: { source: string }[] };

function readVercelConfig(): VercelConfig {
  const raw = fs.readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf-8');
  return JSON.parse(raw) as VercelConfig;
}

test.describe('T-20260602 풋 셀프접수 stale 사본 canonical 단일화 (AC2: dead 사본 제거 + edge redirect 보존)', () => {
  test('AC2-guard①: vercel.json 의 /checkin/jongno-foot → canonical permanent(301) 리다이렉트가 보존됨', () => {
    const cfg = readVercelConfig();
    const rule = (cfg.redirects ?? []).find((r) => r.source === '/checkin/jongno-foot');

    // ⚠ guard① — 이 redirect 는 절대 제거 금지. 접수 동선 무중단의 유일한 경로.
    expect(rule, '/checkin/jongno-foot redirect 규칙이 vercel.json 에 있어야 함(무중단 보장)').toBeDefined();
    expect(rule!.destination).toBe(CANONICAL_URL);
    expect(rule!.permanent).toBe(true);
  });

  test('AC2-guard①: edge redirect 가 SPA rewrite 보다 먼저 평가됨 (Vercel 은 redirects → rewrites 순서)', () => {
    const cfg = readVercelConfig();
    const spaRewrite = (cfg.rewrites ?? []).find((r) => r.source === '/(.*)');
    expect(spaRewrite, 'SPA fallback rewrite 보존').toBeDefined();
    expect((cfg.redirects ?? []).length).toBeGreaterThan(0);
  });

  test('AC2: obliv native SelfCheckIn 사본(컴포넌트 + 렌더 배선)이 완전 제거됨', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'src/App.tsx'), 'utf-8');
    // dead 사본의 native 렌더 배선 제거 — App.tsx 에 SelfCheckIn import/render 잔존 없음
    expect(src).not.toContain('<SelfCheckIn />');
    expect(src).not.toContain("import('@/pages/SelfCheckIn')");
    // SelfCheckIn 컴포넌트 파일 자체 제거(dev 가 더는 stale 사본을 고칠 수 없게 함)
    expect(fs.existsSync(path.join(REPO_ROOT, 'src/pages/SelfCheckIn.tsx'))).toBe(false);
  });

  test('AC3 (회귀/guard①): /checkin/:clinicSlug 방어심화 리다이렉트는 보존 — jongno-foot → canonical', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'src/App.tsx'), 'utf-8');
    // deprecated slug 계약(helpers.expectDeprecatedCheckinRedirect) 보존 — CheckinRoute 는
    //   canonical 리다이렉트 전용으로 유지(edge 우회/client 진입 방어심화). native 렌더는 없음.
    expect(src).toContain('/checkin/:clinicSlug');
    expect(src).toContain('CheckinRoute');
    expect(src).toContain('DEPRECATED_CHECKIN_CANONICAL');
    expect(src).toContain('https://foot-checkin.pages.dev/jongno-foot');
    // SPA 잔존 외부 이탈(HFQ 등) 없음 — 단일화 타깃은 foot-checkin canonical 뿐
    expect(src).not.toContain('JongnoFootCheckinRedirect');
    expect(src).not.toContain('window.location.replace(JONGNO');
  });
});
