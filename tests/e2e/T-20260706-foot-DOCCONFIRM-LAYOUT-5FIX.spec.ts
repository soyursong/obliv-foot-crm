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
      // 병록번호 라벨 15% + record_no 값 35% + (row1 우반부 라벨 15% + 값 35%) = 50:50
      const topBlock = tpl.slice(0, tpl.indexOf('{{patient_rrn}}'));
      expect(topBlock, `${name} 상단표 table-layout:fixed 누락`).toContain('table-layout:fixed');
      expect(topBlock).toContain('style="width:15%; background:#f8f8f8;">병 록 번 호');
      expect(topBlock).toContain('style="width:35%;">{{record_no}}');
      // T-20260730-foot-UNIT-PREEXIST-RED-TRIAGE(stale 정정): 우반부 라벨 고정('연 령')이 낡음.
      //   T-20260731-foot-DOCFORM-URGENT-6FIX AC-5⑤(롤모델 정합)로 통원확인서는 행1우측=성별/행2우측=연령으로 위치가
      //   교환됨(진료확인서는 행1우측=연령 유지). 두 서류 모두 row1 우반부 라벨이 width:15%(좌우 대칭)인 불변식은 유지 →
      //   서류별 실제 row1 우반부 라벨로 일반화해 50:50 레이아웃을 가드(레이아웃 회귀 아님).
      const row1RightLabel = name === '진료확인서' ? '연 령' : '성별';
      expect(topBlock, `${name} row1 우반부 라벨 width:15% 대칭 누락`).toContain(`style="width:15%; background:#f8f8f8;">${row1RightLabel}`);
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
// T-20260730-foot-UNIT-PREEXIST-RED-TRIAGE(stale 정정): 용도칸 정본이 후속 티켓으로 두 서류가 갈렸다.
//   · 진료확인서(TREAT): T-20260729-foot-DOC-LAYOUT-FIX ③ 로 용도표 width:auto→100%+table-layout:fixed,
//     라벨폭 60px→80px(위 통원일자칸과 통일), 값셀 min-width:320px 제거. → 현행 정본으로 갱신.
//   · 통원확인서(VISIT): T-20260731-foot-DOCFORM-URGENT-6FIX AC-5⑧(팀장 2026-07-31, 롤모델 정합)로 용도 행을
//     인쇄물에서 제거(미렌더). {{purpose}} 토큰·발급 UI·저장 경로는 무접촉 — 인쇄물에만 미표시. → '미렌더' 가드.
//   (구 60px/width:auto/min-width:320px 기대는 위 두 변경으로 낡음 — 레이아웃 회귀 아님)
const stripHtmlComments = (t: string) => t.replace(/<!--[\s\S]*?-->/g, '');

test.describe('시나리오3 AC-③: 용도 입력칸 너비 내용맞춤', () => {
  test('진료확인서 용도 표 width:100%;table-layout:fixed + 라벨80px·값 {{purpose}}', () => {
    const active = stripHtmlComments(TREAT_CONFIRM);
    expect(active, '진료확인서 용도표 width:100%;table-layout:fixed 미적용').toMatch(
      /width:100%; table-layout:fixed;">\s*<tbody>[\s\S]*?용&nbsp;&nbsp;도/,
    );
    expect(active).toContain('style="width:80px; background:#f8f8f8; text-align:center;">용&nbsp;&nbsp;도');
    expect(active).toContain('<td>{{purpose}}</td>');
  });

  test('통원확인서 용도 행은 인쇄물 미렌더(URGENT-6FIX AC-5⑧)', () => {
    // 주석(복원용 스니펫)에는 용도 마크업이 남아있으므로 HTML 주석을 제거한 '활성 렌더 본문'에서만 검증
    const active = stripHtmlComments(VISIT_CONFIRM);
    expect(active, '통원확인서 용도 라벨이 인쇄물에 잔존(제거 정본 위배)').not.toContain('용&nbsp;&nbsp;도');
    expect(active, '통원확인서 {{purpose}} 활성 렌더 잔존').not.toContain('{{purpose}}');
  });
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
