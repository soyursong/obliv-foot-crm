/**
 * E2E Spec — T-20260706-foot-DOCCONFIRM-LAYOUT-5FIX
 *
 * [P1] 진료확인서(treat_confirm)·통원확인서(visit_confirm) 레이아웃 개선 5항목
 *      (현장 총괄 김주연, 2026-07-06, 색박스 주석 스크린샷 기반 approved)
 *
 * 두 서류 타입 단일 구현 동일 적용(reporter 재확인, MSG-hjgj):
 *   ① 상단 섹션(병록번호~연령/성별) 좌우 50:50 정렬 (라벨15%+값35% 대칭, table-layout:fixed)
 *   ② 환자 성명 옆 불필요한 막음칸(빈 셀) 제거 → 성명 값 colspan=3 전폭
 *   ③ 용도 입력칸 너비 내용맞춤 (전폭 → width:auto 테이블 + 라벨60px·값 min-width:320px)
 *   ④ "상기인은~확인함" 텍스트칸 세로 높이 3배 (min-height:108px + flex 중앙)
 *   ⑤ 하단 발행일~주소및명칭 섹션 좌우 50:50 정렬 (라벨15%+값35% 대칭, table-layout:fixed)
 *
 * 진료확인서는 code/nocode 변형이 TREAT_CONFIRM_HTML 단일 소스를 상속 → 3키 동시 반영.
 *
 * 실행: npx playwright test --project=unit T-20260706-foot-DOCCONFIRM-LAYOUT-5FIX.spec.ts
 * NOTE: 템플릿 리터럴 정적검증 + getHtmlTemplate/bindHtmlTemplate 실제 렌더 검증 병행.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_SRC = fs.readFileSync(
  path.join(__dirname, '../../src/lib/htmlFormTemplates.ts'),
  'utf-8',
);

/** `const NAME = \`...\`;` 형태의 템플릿 리터럴 본문을 추출 */
function extractTemplate(name: string): string {
  const start = TEMPLATES_SRC.indexOf(`const ${name} = \``);
  expect(start, `${name} 템플릿을 찾지 못함`).toBeGreaterThanOrEqual(0);
  const bodyStart = TEMPLATES_SRC.indexOf('`', start) + 1;
  const bodyEnd = TEMPLATES_SRC.indexOf('`;', bodyStart);
  expect(bodyEnd, `${name} 종료 백틱을 찾지 못함`).toBeGreaterThan(bodyStart);
  return TEMPLATES_SRC.slice(bodyStart, bodyEnd);
}

const TREAT_CONFIRM = extractTemplate('TREAT_CONFIRM_HTML');
const VISIT_CONFIRM = extractTemplate('VISIT_CONFIRM_HTML');

const CONFIRM_DOCS = [
  ['진료확인서', TREAT_CONFIRM] as const,
  ['통원확인서', VISIT_CONFIRM] as const,
];

// ── 시나리오 1 AC-①: 상단 섹션 좌우 50:50 ──────────────────────────────────
test.describe('시나리오1 AC-①: 상단 섹션 좌우 50:50 정렬', () => {
  for (const [name, tpl] of CONFIRM_DOCS) {
    test(`${name} 상단 표 table-layout:fixed + 라벨15%/값35% 좌우 대칭`, () => {
      // 병록번호 라벨 15% + record_no 값 35% + 연령 라벨 15% + age 값 35% = 50:50
      const topBlock = tpl.slice(0, tpl.indexOf('{{patient_rrn}}'));
      expect(topBlock, `${name} 상단표 table-layout:fixed 누락`).toContain('table-layout:fixed');
      expect(topBlock).toContain('style="width:15%; background:#f8f8f8;">병 록 번 호');
      expect(topBlock).toContain('style="width:35%;">{{record_no}}');
      expect(topBlock).toContain('style="width:15%; background:#f8f8f8;">연 령');
      // 구 고정폭(140px value / 70px label)은 상단 섹션에서 제거
      expect(topBlock).not.toContain('style="width:140px;">{{record_no}}');
    });
  }
});

// ── 시나리오 2 AC-②: 성명 옆 빈 셀 제거 ────────────────────────────────────
test.describe('시나리오2 AC-②: 환자 성명 옆 막음칸(빈 셀) 제거', () => {
  for (const [name, tpl] of CONFIRM_DOCS) {
    test(`${name} 성명 값 colspan=3 전폭 + 잔여 빈 셀/placeholder 없음`, () => {
      expect(tpl, `${name} 성명 colspan=3 미적용`).toMatch(
        /환자 성명<\/td>[\s\S]*?<td colspan="3">\{\{patient_name\}\}<\/td>/,
      );
      // 구 disease/visit_display_note placeholder 셀 삭제됨
      expect(tpl).not.toContain('{{disease_display_note}}');
      expect(tpl).not.toContain('{{visit_display_note}}');
    });
  }
});

// ── 시나리오 3 AC-③: 용도 입력칸 내용맞춤 ──────────────────────────────────
test.describe('시나리오3 AC-③: 용도 입력칸 너비 내용맞춤', () => {
  for (const [name, tpl] of CONFIRM_DOCS) {
    test(`${name} 용도 표 width:auto + 라벨60px·값 min-width:320px`, () => {
      expect(tpl, `${name} 용도표 width:auto 미적용`).toMatch(
        /width:auto;">\s*<tbody>[\s\S]*?용&nbsp;&nbsp;도/,
      );
      expect(tpl).toContain('style="width:60px; background:#f8f8f8; text-align:center;">용&nbsp;&nbsp;도');
      expect(tpl).toContain('style="min-width:320px;">{{purpose}}');
    });
  }
});

// ── 시나리오 4 AC-④: 상기인 텍스트칸 높이 3배 ─────────────────────────────
test.describe('시나리오4 AC-④: "상기인은~확인함" 텍스트칸 세로 높이 3배', () => {
  for (const [name, tpl] of CONFIRM_DOCS) {
    test(`${name} confirm-text min-height:108px + flex 중앙정렬`, () => {
      expect(tpl, `${name} confirm-text 높이 확장 누락`).toMatch(
        /class="confirm-text" style="margin-top:6px; min-height:108px; display:flex; align-items:center; justify-content:center;"/,
      );
    });
  }

  test('상기인 문구 자체는 타입별 보존(진료중임/통원중임)', () => {
    expect(TREAT_CONFIRM).toContain('상기인은 위와 같이 진료중임(진료하였음)을 확인함.');
    expect(VISIT_CONFIRM).toContain('상기인은 위와 같이 통원중임(통원하였음)을 확인함.');
  });
});

// ── 시나리오 5 AC-⑤: 하단 섹션 좌우 50:50 ─────────────────────────────────
test.describe('시나리오5 AC-⑤: 하단 발행일~주소및명칭 좌우 50:50 정렬', () => {
  for (const [name, tpl] of CONFIRM_DOCS) {
    test(`${name} 하단 표 table-layout:fixed + 라벨15%/값35% 좌우 대칭`, () => {
      // confirm-text 직후 = 하단 발행블록 테이블(여는 태그 포함) 시작
      const bottomBlock = tpl.slice(tpl.indexOf('confirm-text'));
      expect(bottomBlock, `${name} 하단표 table-layout:fixed 누락`).toContain('table-layout:fixed');
      expect(bottomBlock).toContain('style="width:15%; background:#f8f8f8;">발 행 일');
      expect(bottomBlock).toContain('style="width:35%;">{{issue_date}}');
      expect(bottomBlock).toContain('style="width:15%; background:#f8f8f8; white-space:nowrap; font-size:8pt;">주소 및 명칭');
      expect(bottomBlock).toContain('style="width:35%;">{{clinic_address}}');
      // 구 고정폭(60px/130px) 하단 섹션에서 제거
      expect(bottomBlock).not.toContain('style="width:130px;">{{issue_date}}');
    });
  }
});

// ── 시나리오 6 회귀 가드: 실제 렌더 + 진료확인서 3키 동기 ──────────────────
test.describe('시나리오6 회귀: 실제 렌더 + 진료확인서 code/nocode 동기', () => {
  test('5키(treat_confirm·code·nocode·visit_confirm) 렌더 정상 + 5FIX 반영', () => {
    for (const key of ['treat_confirm', 'treat_confirm_code', 'treat_confirm_nocode', 'visit_confirm']) {
      const html = bindHtmlTemplate(getHtmlTemplate(key)!, {});
      expect(html, `${key} 렌더 실패`).toContain('table-layout:fixed');
      expect(html, `${key} 상기인 높이 3배 미반영`).toContain('min-height:108px');
      expect(html, `${key} 빈셀 잔존`).not.toContain('{{patient_name}}'); // bind 후 placeholder 소진
      expect(html).toContain('colspan="3"');
    }
  });

  test('진료확인서 code 변형은 상병(DISEASE_BLOCK) 유지 — 5FIX와 직교', () => {
    const codeHtml = bindHtmlTemplate(getHtmlTemplate('treat_confirm_code')!, {});
    expect(codeHtml).toContain('상 병 코 드');
    const nocodeHtml = bindHtmlTemplate(getHtmlTemplate('treat_confirm_nocode')!, {});
    expect(nocodeHtml).not.toContain('상 병 코 드');
  });
});
