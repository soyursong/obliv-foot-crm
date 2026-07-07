/**
 * E2E Spec — T-20260702-foot-DOCPRINT-RX-FEEBREAKDOWN-LAYOUT
 *
 * ① 처방전(rx_standard) ② 진료비 세부산정내역(bill_detail) 2종 인쇄 레이아웃을 현장 참조양식
 * (IMG_8777 / IMG_8778)의 배치·컬럼·행 구조와 일치시키는 정밀 refine. 서식(틀)만 참조양식 기준,
 * 값은 실제 환자·처방·진료비 데이터 바인딩(예시 고객정보 하드코딩 금지).
 *
 * ── 최종 결정 (6-E, 2026-07-07 김주연 총괄 U0ATDB587PV, ts 1782979491) ──
 *   미결(1) 처방전 최상단 헤더 = B안(환자정보블록 유지, 조합기호 라인 미적용 · AC-1 override).
 *   미결(2) 처방의약품 표 컬럼 라벨 = (b) 현행 유지 확정.
 *     → 현행 라벨 '1회 투약량 / 1일투여 횟수 / 총투약 일수'가 정답.
 *       바인딩 값 unit_dose = per-dose(1회량)라 값-라벨 의미 정확 정합. 무단 값변환 보류가 정답으로 확정.
 *   두 결정 모두 코드변경 0 — 현 배포본이 두 결정과 이미 정합.
 *
 * ── 본 spec 범위 ──
 *   순수 템플릿(getHtmlTemplate)·바인딩 함수(buildRxItemsHtml / buildBillDetailItemsHtml)로
 *   레이아웃 구조·라벨·데이터바인딩을 직접 단언(AC-1/2/3/4/5, 라벨 (b) 결정 lock-in).
 *   AC-7/AC-8(실브라우저 Ctrl+P 인쇄 미리보기를 참조사진 위 오버레이로 컬럼 경계선 육안 대조)은
 *   supervisor 실브라우저 QA에서 최종 확인 — 컬럼 폭 CSS(colgroup/width)는 여기서 구조 존재만 단언.
 *   (레이아웃 표 코드는 AC-검증 배포본 a8298400 대비 byte-identical, (b) 결정은 0-code.)
 *
 * 실행: npx playwright test T-20260702-foot-DOCPRINT-RX-FEEBREAKDOWN-LAYOUT.spec.ts
 */

import { test, expect } from '@playwright/test';
import { getHtmlTemplate, buildRxItemsHtml, buildBillDetailItemsHtml } from '../../src/lib/htmlFormTemplates';

const RX = getHtmlTemplate('rx_standard') ?? '';
const BILL = getHtmlTemplate('bill_detail') ?? '';

test.describe('AC-1 처방전 레이아웃 (§2-A, 헤더 B안 override)', () => {
  test('rx_standard 템플릿 존재', () => {
    expect(RX.length).toBeGreaterThan(0);
  });

  test('처방의약품 표 헤더 = (b) 현행 라벨 (미결2 최종결정 lock-in)', () => {
    // (b) 확정: '1회 투약량 / 1일투여 횟수 / 총투약 일수' 그대로 유지 = 값-라벨 정합.
    // A안 라벨('1일 투약량/1일 투약횟수/1일 투약일수')은 (b)로 override되어 정답 아님.
    expect(RX).toContain('1회<br>투약량');
    expect(RX).toContain('1일투여<br>횟&nbsp;&nbsp;&nbsp;수');
    expect(RX).toContain('총투약<br>일&nbsp;&nbsp;&nbsp;수');
    // A안 라벨은 존재하지 않아야 함(무단 교체 금지 lock).
    expect(RX).not.toContain('1일<br>투약량');
  });

  test('처방의약품 표 컬럼 폭 존재 (AC-8: 투약량·횟수·일수 협폭 / 용법 광폭)', () => {
    // 협폭 3열 48px + 용법 광폭 190px. 명칭은 잔여 최광폭(width 미지정).
    expect(RX).toContain('width:48px;');
    expect(RX).toContain('width:190px;');
  });

  test('헤더 B안: 환자정보블록 유지 · 조합기호 라인 미적용 (AC-1 override)', () => {
    // 환자정보블록 유지(T-20260612 존중).
    expect(RX).toContain('{{patient_rrn}}');
    // 참조양식 §2-A#1 조합기호 라인은 B안으로 미적용 — 렌더 콘텐츠(주석 제외)에 조합기호 필드 없음.
    const rendered = RX.replace(/<!--[\s\S]*?-->/g, '');
    expect(rendered).not.toContain('조합기호');
  });
});

test.describe('AC-2 진료비 세부산정내역 12컬럼 2단 헤더 (§2-B)', () => {
  test('bill_detail 템플릿 존재', () => {
    expect(BILL.length).toBeGreaterThan(0);
  });

  test('요양기관기호 라인 (§2-B#3)', () => {
    expect(BILL).toContain('요양기관기호');
    expect(BILL).toContain('{{clinic_code}}');
  });

  test('2단 헤더: 급여 > 일부본인부담(본인부담금/공단부담금) + 전액본인부담 + 비급여', () => {
    expect(BILL).toContain('>급여<');
    expect(BILL).toContain('일부본인부담');
    expect(BILL).toContain('본인부담금');
    expect(BILL).toContain('공단부담금');
    expect(BILL).toContain('전액<br>본인부담');
    expect(BILL).toContain('비급여');
  });

  test('12컬럼 colgroup 고정 (AC-8 실측 폭 비율)', () => {
    const colgroup = BILL.match(/<colgroup>[\s\S]*?<\/colgroup>/)?.[0] ?? '';
    const colCount = (colgroup.match(/<col[ /]/g) ?? []).length;
    expect(colCount).toBe(12);
    expect(BILL).toContain('table-layout:fixed');
  });

  test('집계 3행: 계 / 끝처리 조정금액 / 합계', () => {
    expect(BILL).toContain('>계<');
    expect(BILL).toContain('끝처리 조정금액');
    expect(BILL).toContain('>합계<');
  });
});

test.describe('AC-3 실데이터 바인딩 · 예시고객 하드코딩 금지', () => {
  test('참조이미지 예시 고객정보가 템플릿에 하드코딩되지 않음', () => {
    for (const t of [RX, BILL]) {
      expect(t).not.toContain('김지혜');
      expect(t).not.toContain('이승혁');
      expect(t).not.toContain('F-4428');
      expect(t).not.toContain('900000');
    }
  });

  test('bill_detail 항목·합계는 플레이스홀더 바인딩', () => {
    expect(BILL).toContain('{{items_html}}');
    expect(BILL).toContain('{{total_amount}}');
    expect(BILL).toContain('{{total_noncovered}}');
  });

  test('처방의약품 행은 실입력 값 바인딩 (예시 하드코딩 아님)', () => {
    const html = buildRxItemsHtml([
      { name: '주블리아외용액 4ml(에피나코나졸)', unit_dose: '1', daily_freq: '2', total_days: '1', method: '아침, 저녁으로 환부에 바르세요' },
    ]);
    expect(html).toContain('주블리아외용액 4ml(에피나코나졸)');
    // 예시양식 약품은 하드코딩되지 않음(전달값만 렌더).
    expect(html).not.toContain('바르토벤');
  });
});

test.describe('라벨 (b) 값-라벨 의미 정합 (미결2 근거)', () => {
  test('unit_dose(per-dose 1회량) 값이 첫 값 컬럼에 그대로 바인딩', () => {
    // 1일 2회 처방: unit_dose=1(1회량) / daily_freq=2. 라벨 (b) '1회 투약량' 하에서 값 정합.
    const html = buildRxItemsHtml([
      { name: '외용액', unit_dose: '1', daily_freq: '2', total_days: '1', method: '아침·저녁' },
    ]);
    // 무단 값변환 없이 입력 그대로.
    expect(html).toContain('>1</td>');
    expect(html).toContain('>2</td>');
  });

  test('빈 처방은 고정 높이 빈 행 유지 (엣지: 오류 없이 레이아웃 보존)', () => {
    const html = buildRxItemsHtml([]);
    // 8행 고정 표(빈 행 padding).
    expect((html.match(/<tr /g) ?? []).length).toBe(8);
  });
});

test.describe('AC-5 주민번호 양식별 처리 (RRN-ADD B안 회귀 금지)', () => {
  test('bill_detail 주민등록번호 헤더 + 셀 유지 (RRN-ADD B안)', () => {
    expect(BILL).toContain('주민등록번호');
    expect(BILL).toContain('{{patient_rrn}}');
  });

  test('처방전 주민번호 필드 유지 (rrn_decrypt + 권한게이트 경로)', () => {
    expect(RX).toContain('{{patient_rrn}}');
  });
});

test.describe('AC-4 급여/비급여 컬럼 = service_charges 표시 (무재산정)', () => {
  test('buildBillDetailItemsHtml는 전달된 항목값을 표시만 (재계산 없음)', () => {
    const html = buildBillDetailItemsHtml([
      { category: '기타', date: '2026-06-30', code: 'SZ775', name: '비가열성 진균증 레이저 치료', amount: 300000, count: 1, days: 1, is_insurance_covered: false },
    ]);
    expect(html).toContain('비가열성 진균증 레이저 치료');
    // 비급여 항목: 총액·비급여열에 저장값 그대로 표시(무재산정).
    expect(html).toContain('300,000');
    // 급여 컬럼(본인/공단/전액)은 비급여이므로 0.
    expect((html.match(/>0<\/td>/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
