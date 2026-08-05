/**
 * E2E Spec — T-20260805-foot-FOOTQST-POPUP-PHOTO-NORENDER
 *
 * 현장 버그 (2026-08-05): 고객이 발건강 질문지에 사진 첨부 → '별도창 보기' 클릭 시
 *   열린 창에서 첨부 사진이 표시되지 않음. (창 여는 동작 자체는 07-31 복구본으로 정상)
 *
 * 진단(READ-ONLY probe): health_q_photos 46행 실재 + service_role/staff RLS SELECT +
 *   staff createSignedUrl 모두 OK → 저장/RLS/스토리지 정상 = 표시(FE) 문제(AC5 저장버그 아님).
 *
 * RC: in-app ResultCard(T-20260731)는 health_q_photos + signed URL 로 사진을 렌더하나,
 *   별도창 문서 빌더 buildHealthQDocumentHtml(T-20260606)은 폼필드/발톱SVG 만 렌더하고
 *   첨부사진을 포함한 적이 없었음 → 팝업에서 사진 항상 누락.
 *
 * FIX: (1) 문서에 #hq-photo-mount 앵커 추가. (2) window.open 동기성(팝업차단) 보존을 위해
 *   창을 먼저 열고 openHealthQDocumentWindow 가 health_q_photos + signed URL 을 async 로
 *   조회해 앵커에 buildHealthQPhotoSectionHtml() 결과를 주입.
 *
 * 본 스펙 = 순수/결정론 단언(webServer·auth 불요, skip 0).
 *   실브라우저 팝업 렌더(로컬 build)는 scripts/*_popup_verify.mjs 로 별도 검증(PASS 첨부).
 *
 * 실행: npx playwright test T-20260805-foot-FOOTQST-POPUP-PHOTO-NORENDER.spec.ts
 */

import { test, expect } from '@playwright/test';
import { buildHealthQDocumentHtml, buildHealthQPhotoSectionHtml } from '../../src/lib/healthQDocument';
import type { HQResult } from '../../src/components/HealthQResultsPanel';

const fixture: HQResult = {
  id: 'res-1',
  form_type: 'general',
  form_data: { symptoms: ['발톱 변색'], foot_pain_level: '경미' },
  submitted_at: '2026-08-05T10:15:00+09:00',
  created_at: '2026-08-05T10:15:00+09:00',
};

// ── AC1: 문서에 async 주입 앵커(#hq-photo-mount)가 존재해야 사진 주입이 가능 ──────────
test('AC1: buildHealthQDocumentHtml 은 첨부사진 주입 앵커 #hq-photo-mount 를 포함한다', () => {
  const html = buildHealthQDocumentHtml(fixture, { customerName: '김혜주', chartNumber: 'F-5253' });
  expect(html).toContain('id="hq-photo-mount"');
  // 폼필드/문서 골격은 종전대로(무회귀)
  expect(html).toContain('발건강 질문지 (일반)');
  expect(html).toContain('김혜주');
});

// ── AC2: 사진 섹션 빌더 — R/L laterality 라벨 = ResultCard SSOT ────────────────────
test('AC2: buildHealthQPhotoSectionHtml — foot_side R→오른발 / L→왼발 / null→첨부 사진', () => {
  const html = buildHealthQPhotoSectionHtml([
    { url: 'https://x/r.jpg', foot_side: 'R' },
    { url: 'https://x/l.jpg', foot_side: 'L' },
    { url: 'https://x/u.jpg', foot_side: null },
  ]);
  expect(html).toContain('고객 첨부 사진');
  expect(html).toContain('<figcaption>오른발</figcaption>');
  expect(html).toContain('<figcaption>왼발</figcaption>');
  expect(html).toContain('<figcaption>첨부 사진</figcaption>');
  // 3장 모두 img 로 렌더
  expect((html.match(/<img /g) ?? []).length).toBe(3);
  expect(html).toContain('src="https://x/r.jpg"');
});

// ── AC3: 사진 0장이면 빈 문자열(섹션 미출력) — 사진 없는 고객 무영향 ──────────────────
test('AC3: 사진 0장 → 빈 문자열(섹션 미출력)', () => {
  expect(buildHealthQPhotoSectionHtml([])).toBe('');
});

// ── AC4: URL/라벨 escape — HTML 인젝션 방어 ────────────────────────────────────
test('AC4: url/label escape (XSS 방어)', () => {
  const html = buildHealthQPhotoSectionHtml([
    { url: 'https://x/a.jpg?t="><script>alert(1)</script>', foot_side: 'R' },
  ]);
  expect(html).not.toContain('<script>alert(1)</script>');
  expect(html).toContain('&quot;&gt;&lt;script&gt;');
});
