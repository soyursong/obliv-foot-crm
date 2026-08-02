/**
 * E2E Spec — T-20260730-foot-RX-STANDARD-DERM-FORMAT-UNIFY
 *
 * 풋센터 처방전(rx_standard) HTML/CSS 서식을 피부(derm) A4 표준서식으로 통일(CSS-only).
 * 범위 엄격: rx_standard 1종 + 접촉자산 2개(.rx-wrap CSS / buildRxItemsHtml)만.
 * db_change=false. 데이터·기능·바인딩·인쇄 파이프라인 무접촉 — 표현 계층(HTML/CSS)만.
 *
 * ── 목표값 (피부 처방전 2026-07-30 실측 SSOT, 티켓 frontmatter) ──
 *   페이지            724×1053px, border 2px, 유효폭 720
 *   의약품표 colgroup  337 / 80 / 80 / 80 / 143 (= 720)
 *   의약품표 헤더색     #B3B2B2, 일반행 최소 10행
 *   주사제 섹션 헤더     #b3b2b2, 최소 5행
 *   타이틀             fontSize 24 / letterSpacing 20
 *   보험체크 순서       건강보험·의료급여·산재·자동차·기타
 *   요양기관번호        미절단(nowrap·flex-shrink:0)
 *   질병칸             피부 10칸 글자분해 미적용 → foot 코드+명칭(diag_name 셀 추가) 유지
 *
 * ── 시나리오 ──
 *   1. 정상 동선 = rx_standard 렌더가 위 8개 목표값 전수 충족.
 *   2. 회귀 방지 = 계산서·영수증·소견서·진단서·세부내역 등 타 서류 무변경(공유 클래스 미오염).
 *
 * 실행: npx playwright test T-20260730-foot-RX-STANDARD-DERM-FORMAT-UNIFY.spec.ts
 */

import { test, expect } from '@playwright/test';
import { getHtmlTemplate, buildRxItemsHtml } from '../../src/lib/htmlFormTemplates';

const RX = getHtmlTemplate('rx_standard') ?? '';

test.describe('시나리오 1 — rx_standard = 피부 A4 표준서식 목표값 전수', () => {
  test('rx_standard 템플릿 존재', () => {
    expect(RX.length).toBeGreaterThan(0);
  });

  test('페이지: 724×1053px + 외곽선 2px (유효폭 720)', () => {
    expect(RX).toContain('width: 724px;');
    expect(RX).toContain('min-height: 1053px;');
    expect(RX).toContain('border: 2px solid #000;');
    // 무패딩(내부 표 720 full-width) — 구 190mm/6mm 패딩 서식 제거 확인
    expect(RX).not.toContain('width: 190mm;\n    min-height: 267mm;');
  });

  test('의약품표 colgroup = 337/80/80/80/143 (합 720)', () => {
    expect(RX).toContain('width:337px;');
    // 80px 컬럼 3개 + 143px 컬럼 → colgroup 존재
    expect(RX).toContain('<col style="width:80px;" />');
    expect(RX).toContain('width:143px;');
    const cg = 337 + 80 + 80 + 80 + 143;
    expect(cg).toBe(720);
  });

  test('의약품표 헤더색 = 피부 실측 #B3B2B2', () => {
    expect(RX).toContain('.rx-wrap th { background: #B3B2B2;');
    // 구 회색 #f0f0f0 헤더는 제거
    expect(RX).not.toContain('.rx-wrap th { background: #f0f0f0;');
  });

  test('타이틀 = fontSize 24 / letterSpacing 20', () => {
    expect(RX).toContain('font-size: 24px;');
    expect(RX).toContain('letter-spacing: 20px;');
    // 구 22pt/14px 제거
    expect(RX).not.toContain('font-size: 22pt;');
    expect(RX).not.toContain('letter-spacing: 14px;');
  });

  test('보험체크 순서 = 건강보험·의료급여·산재·자동차·기타', () => {
    // 실제 보험 체크 span 내부(체크박스 [&bull;]/[&nbsp;] 포함 라인)로 한정 — 상단 주석의
    // 동일 문구가 아니라 렌더되는 라인의 순서만 검증.
    const line = (RX.match(/\[&bull;\]건강보험[^<]*/) ?? [''])[0];
    expect(line.length, '보험 체크 라인 존재').toBeGreaterThan(0);
    const order = ['건강보험', '의료급여', '산재보험', '자동차보험', '기타'];
    let cursor = -1;
    for (const label of order) {
      const idx = line.indexOf(label);
      expect(idx, `${label} 존재`).toBeGreaterThan(-1);
      expect(idx, `${label} 순서`).toBeGreaterThan(cursor);
      cursor = idx;
    }
    // 구 명칭(의료보험/의료보호) 잔재 없음
    expect(RX).not.toContain('[&bull;]의료보험');
  });

  test('요양기관기호 미절단 (nowrap + flex-shrink:0)', () => {
    // 요양기관기호 span 이 white-space:nowrap · flex-shrink:0 로 8자리 전체 표시
    expect(RX).toMatch(/white-space:nowrap;\s*flex-shrink:0;[^>]*>요양기관기호/);
  });

  test('질병칸 = foot 코드+명칭 유지 (diag_name 셀 추가, 10칸 글자분해 미적용)', () => {
    // 코드 셀 + 명칭 셀 4쌍 모두 존재
    for (let n = 1; n <= 4; n++) {
      expect(RX).toContain(`{{diag_code_${n}}}`);
      expect(RX).toContain(`{{diag_name_${n}}}`);
    }
  });

  test('주사제 섹션 = 헤더 #b3b2b2 + 최소 5행 기입란', () => {
    expect(RX).toContain('background:#b3b2b2');
    // 주사제 표도 상단 의약품표와 동일 colgroup 정렬 → 337/80.. 2회 등장
    const colgroupCount = (RX.match(/width:337px;/g) ?? []).length;
    expect(colgroupCount).toBeGreaterThanOrEqual(2);
    // 5행 기입란(height:24px 빈 5셀 행) 존재
    const injRows = (RX.match(/<tr style="height:24px;"><td><\/td><td><\/td><td><\/td><td><\/td><td><\/td><\/tr>/g) ?? []).length;
    expect(injRows).toBeGreaterThanOrEqual(5);
  });
});

test.describe('시나리오 1(계속) — buildRxItemsHtml 일반행 최소 10행', () => {
  test('빈 items → 10행', () => {
    const html = buildRxItemsHtml([]);
    expect((html.match(/<tr /g) ?? []).length).toBe(10);
  });

  test('items 3건 → 3건 + 7 빈행 = 10행 (5셀/행)', () => {
    const html = buildRxItemsHtml([
      { name: '약A' }, { name: '약B' }, { name: '약C' },
    ]);
    expect((html.match(/<tr /g) ?? []).length).toBe(10);
    // 각 행 5셀(colgroup 5열 정합)
    const firstRow = html.split('</tr>')[0];
    expect((firstRow.match(/<td/g) ?? []).length).toBe(5);
  });

  test('items 12건(>10) → 절삭 없이 12행 (약품행 손실 0)', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ name: `약${i}` }));
    const html = buildRxItemsHtml(items);
    expect((html.match(/<tr /g) ?? []).length).toBe(12);
  });
});

test.describe('시나리오 2 — 타 서류 무회귀 (공유 클래스·타 템플릿 미오염)', () => {
  const OTHER_KEYS = [
    'bill_detail', 'bill_receipt', 'bill_receipt_new',
    'diag_opinion_v2', 'payment_cert', 'referral_letter',
    'medical_record_request', 'ins_claim_form', 'first_visit_mgmt_record',
  ];

  for (const key of OTHER_KEYS) {
    test(`${key}: 렌더 유지 + rx 전용 서식 미주입`, () => {
      const tpl = getHtmlTemplate(key) ?? '';
      expect(tpl.length, `${key} 템플릿 존재`).toBeGreaterThan(0);
      // rx 전용 래퍼 클래스(.rx-wrap)를 타 서류가 갖지 않음 = 공유 클래스 오염 없음
      expect(tpl.includes('class="rx-wrap"'), `${key} 에 rx-wrap 미주입`).toBe(false);
      // rx 전용 724px 페이지폭이 타 서류로 새지 않음
      expect(tpl.includes('width: 724px;'), `${key} 에 724px 미누출`).toBe(false);
    });
  }

  test('rx-wrap CSS 스코프 = rx_standard 전용 (타 서류 wrapper 무접촉)', () => {
    // rx-wrap 규칙은 오직 rx_standard 템플릿에만 존재
    for (const key of OTHER_KEYS) {
      const tpl = getHtmlTemplate(key) ?? '';
      expect(tpl.includes('.rx-wrap {'), `${key} 에 .rx-wrap 규칙 없음`).toBe(false);
    }
  });
});
