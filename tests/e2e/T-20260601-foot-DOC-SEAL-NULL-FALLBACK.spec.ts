/**
 * E2E Spec — T-20260601-foot-DOC-SEAL-NULL-FALLBACK
 *
 * [P0 핫픽스] 풋센터 서류 도장 전체 소실 회귀 복구
 *
 * 배경: 8FIX(5c54a27)+REOPEN2(c0f20b8)에서 우하단 stampOverlay 전면제거 →
 *   doctor_seal_html(DB clinicDoctor.seal_image_url) 일원화.
 *   그런데 seal_image_url이 DB null이면 doctor_seal_html 이미지가 사라져 전 서류 도장 공백.
 *   → autoBindContext.buildAutoBindValues에 getStampUrl() 로컬자산 fallback 추가.
 *
 * AC-1 (도장복구): seal_image_url null → 로컬 stamp 자산(jongno-foot-stamp.png) <img> 출력.
 * AC-2 (위치가드): 도장은 의사성명 근방 inline <img> — 우하단 stampOverlay(position:fixed/absolute) 부활 금지.
 * AC-3 (DB우선 엣지): seal_image_url 설정 시 DB 이미지 우선, 로컬자산으로 덮어쓰지 않음(회귀 없음).
 *
 * 실행: npx playwright test --project=unit T-20260601-foot-DOC-SEAL-NULL-FALLBACK.spec.ts
 * NOTE: autoBindContext는 supabase(import.meta.env) 의존 → 직접 import 불가.
 *   getStampUrl() 순수 import + 소스 정적검증 + 동일 fallback 로직 재현으로 검증.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getStampUrl } from '../../src/lib/formTemplates';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTOBIND_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/lib/autoBindContext.ts'),
  'utf-8',
);

// buildAutoBindValues L304~ 의 도장 분기 로직 재현 (소스와 동치 검증은 AC-소스가드에서)
function resolveSealHtml(sealImageUrl: string | null | undefined): string {
  const sealUrl = sealImageUrl || getStampUrl();
  return sealUrl
    ? `<img src="${sealUrl}" style="width:52px;height:52px;opacity:0.85;vertical-align:middle;display:inline-block;" onerror="this.style.display='none'" />`
    : '(인)';
}

// ── 사전 조건: 로컬 stamp 자산이 빌드에서 해석 가능해야 함 ──────────────────────

test.describe('precondition: 로컬 도장 자산', () => {
  test('getStampUrl() — jongno-foot-stamp 자산 URL 반환', () => {
    const url = getStampUrl();
    expect(url, 'getStampUrl()이 null — 로컬 자산 미해석').not.toBeNull();
    expect(url!).toContain('jongno-foot-stamp');
  });
});

// ── AC-소스가드: autoBindContext.ts가 실제로 fallback 구조를 갖는지 ─────────────

test.describe('AC-소스가드: autoBindContext fallback 구조', () => {
  test('getStampUrl import 존재', () => {
    expect(AUTOBIND_SRC).toContain("import { getStampUrl } from '@/lib/formTemplates'");
  });

  test('doctor_seal_html 분기에 getStampUrl() fallback 결합', () => {
    // seal_image_url || getStampUrl() — DB 우선, null이면 로컬자산
    expect(AUTOBIND_SRC).toMatch(/seal_image_url\s*\|\|\s*getStampUrl\(\)/);
  });

  test('우하단 stampOverlay 부활 금지 — position:fixed/absolute 직인 마크업 없음', () => {
    // doctor_seal_html은 inline. fixed/absolute 오버레이 마크업 잔재가 없어야 함
    // (주석의 'stampOverlay' 언급은 허용 — 실제 마크업/스타일만 가드)
    const lower = AUTOBIND_SRC.toLowerCase();
    expect(lower).not.toContain('position:fixed');
    expect(lower).not.toContain('position:absolute');
  });
});

// ── AC-1: 도장복구 — seal_image_url null이어도 로컬자산 <img> ──────────────────

test.describe('AC-1: DB seal null → 로컬자산 fallback', () => {
  test('seal_image_url=null → 로컬 stamp <img> 출력', () => {
    const html = resolveSealHtml(null);
    expect(html).toContain('<img');
    expect(html).toContain('jongno-foot-stamp');
    expect(html, '도장 공백 회귀').not.toBe('');
    expect(html).not.toBe('(인)');
  });

  test('seal_image_url=undefined (clinicDoctor 없음) → 로컬 stamp <img>', () => {
    const html = resolveSealHtml(undefined);
    expect(html).toContain('<img');
    expect(html).toContain('jongno-foot-stamp');
  });

  test('빈 문자열 seal_image_url → 로컬 stamp fallback (falsy 처리)', () => {
    const html = resolveSealHtml('');
    expect(html).toContain('<img');
    expect(html).toContain('jongno-foot-stamp');
  });
});

// ── AC-2: 위치가드 — 의사성명 근방 inline, stampOverlay 부활 금지 ─────────────

test.describe('AC-2: 위치 가드 (stampOverlay 부활 금지)', () => {
  test('도장은 inline <img> — position fixed/absolute 미사용', () => {
    const html = resolveSealHtml(null);
    expect(html).toContain('display:inline-block');
    expect(html).toContain('vertical-align:middle');
    expect(html.toLowerCase()).not.toContain('position:fixed');
    expect(html.toLowerCase()).not.toContain('position:absolute');
  });

  test('doctor_seal_html 단일 <img>만 (우하단 오버레이 중복 없음)', () => {
    const html = resolveSealHtml(null);
    const imgCount = (html.match(/<img/g) ?? []).length;
    expect(imgCount).toBe(1);
  });
});

// ── AC-3: DB우선 엣지 — seal_image_url 설정 시 DB 이미지 우선 ──────────────────

test.describe('AC-3: DB seal 설정 시 우선 (회귀 없음)', () => {
  const DB_SEAL = 'https://cdn.example.com/seals/dr-kim.png';

  test('seal_image_url 설정 → DB 이미지 사용, 로컬자산 미사용', () => {
    const html = resolveSealHtml(DB_SEAL);
    expect(html).toContain('<img');
    expect(html).toContain(DB_SEAL);
    expect(html, 'DB 우선 위반 — 로컬자산이 덮어씀').not.toContain('jongno-foot-stamp');
  });
});
