/**
 * E2E Spec: T-20260602-foot-CHECKIN-STALE-COPY-CONSOLIDATE
 * 풋 셀프접수 stale 사본 단일화 — obliv-foot-crm /checkin/jongno-foot 사본을
 * canonical foot-checkin.pages.dev/jongno-foot 로 단일화(308 edge redirect).
 *
 * AC2 (단일화 실행): stale /checkin/jongno-foot → canonical 308 리다이렉트(무중단).
 * AC3 (회귀 0): :clinicSlug 제네릭 native SelfCheckIn 라우트 보존(타 클리닉 영향 0).
 * AC4 (DB 무파괴): 라우팅 config 만 변경 — 스키마/데이터 변경 없음.
 *
 * 검증 방식(중요): 셀프접수는 QR/직접 URL(키오스크) 진입이라 항상 Vercel edge 를 경유한다.
 *   따라서 단일화는 **vercel.json 의 308 edge redirect** 로 구현했다(SPA 미로드 즉시 리다이렉트,
 *   접수 동선 단절 0). 라우트 삭제(/admin 폴백 위험)·클라이언트 React Router 리다이렉트
 *   (jongno-foot 슬러그를 쓰는 기존 native 셀프접수 spec 다수를 깨뜨림)는 미채택.
 *   vite dev(테스트 서버)는 vercel.json 을 적용하지 않으므로, edge redirect 는 브라우저 E2E 가
 *   아니라 **배포 config 정적 검증**으로 검증한다(아래). 프로덕션/프리뷰는 Vercel 이
 *   vercel.json 을 적용하므로 실제 308 이 발생한다.
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

test.describe('T-20260602 풋 셀프접수 stale 사본 canonical 단일화 (edge 308 redirect)', () => {
  test('AC2: vercel.json 에 /checkin/jongno-foot → canonical 308(permanent) 리다이렉트가 존재', () => {
    const cfg = readVercelConfig();
    const rule = (cfg.redirects ?? []).find((r) => r.source === '/checkin/jongno-foot');

    expect(rule, '/checkin/jongno-foot redirect 규칙이 vercel.json 에 있어야 함').toBeDefined();
    expect(rule!.destination).toBe(CANONICAL_URL);
    // permanent: true = HTTP 308 (method-preserving permanent redirect, AC2 "308/301")
    expect(rule!.permanent).toBe(true);
  });

  test('AC2: edge redirect 가 SPA rewrite 보다 먼저 평가됨 (Vercel 은 redirects → rewrites 순서)', () => {
    const cfg = readVercelConfig();
    // SPA fallback rewrite 가 그대로 존재해야 다른 경로는 정상 — jongno-foot 만 redirect 가 가로챔
    const spaRewrite = (cfg.rewrites ?? []).find((r) => r.source === '/(.*)');
    expect(spaRewrite, 'SPA fallback rewrite 보존').toBeDefined();
    // redirects 가 정의되어 있어야 함(Vercel 은 redirects 를 rewrites 보다 먼저 적용)
    expect((cfg.redirects ?? []).length).toBeGreaterThan(0);
  });

  test('AC3 (회귀): App.tsx :clinicSlug native SelfCheckIn 라우트 보존 + 클라이언트 리다이렉트 라우트 없음', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'src/App.tsx'), 'utf-8');
    // 타 클리닉 native 셀프접수 라우트 유지(:clinicSlug 제네릭)
    expect(src).toContain('/checkin/:clinicSlug');
    expect(src).toContain('<SelfCheckIn />');
    // 단일화는 edge(vercel.json)로만 — SPA 코드에 외부 이탈 리다이렉트 컴포넌트/HFQ 잔존 없음
    expect(src).not.toContain('JongnoFootCheckinRedirect');
    expect(src).not.toContain('window.location.replace(JONGNO');
  });
});
