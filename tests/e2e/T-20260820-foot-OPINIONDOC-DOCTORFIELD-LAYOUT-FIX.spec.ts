/**
 * E2E spec — T-20260820-foot-OPINIONDOC-DOCTORFIELD-LAYOUT-FIX
 * 소견서 발급 '진료의'(의 사 성 명) 칸 위치 고정 — 발급 시마다 레이아웃이 흔들리지 않고
 * 텍스트(이름)만 바뀌도록 안정화 (문지은 대표원장, 풋센터 C0ATE5P6JTH).
 *
 * AS-IS: diag_opinion 하단 서명표 진료의 셀이 `{{doctor_name}}&nbsp;&nbsp;{{doctor_seal_html}}`
 *        inline flow 라, 이름 길이에 따라 직인(도장) X좌표가 밀려 발급 시마다 정렬이 흔들림.
 * TO-BE: flex 2슬롯(이름=flex:1 중앙 / 직인=flex 0 0 56px 우측 고정) → 텍스트 길이 무관 위치·정렬 고정.
 *
 * AC-1: 진료의 칸 위치·정렬이 텍스트 길이/내용과 무관하게 고정(밀림 없음).
 * AC-2: 서로 다른 이름 길이 2케이스 실렌더 대조 → 직인 X좌표 + 이름 슬롯 좌표 동일(텍스트만 변경).
 * AC-3: 발급 로직/데이터/저장 무변경(순수 표시 레이아웃) — 실제 템플릿(getHtmlTemplate/bindHtmlTemplate) 단일 경로 재사용.
 */

import { test, expect } from '@playwright/test';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

// 실제 발급/출력이 쓰는 템플릿(소견서=diag_opinion) + 바인더(L-006 단일 경로) 재사용.
const TPL = getHtmlTemplate('diag_opinion')!;

// 발급 시 autoBindContext 가 넣는 직인과 동일 규격(52x52 고정 img). 측정용 id 부여.
const SEAL_IMG =
  '<img id="seal-test" src="data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52"><circle cx="26" cy="26" r="24" fill="none" stroke="red" stroke-width="2"/></svg>',
  ).toString('base64') +
  '" style="width:52px;height:52px;opacity:0.85;vertical-align:middle;display:inline-block;" />';

// 진료의 셀의 이름 슬롯 — 템플릿 고유의 flex:1 1 auto 인라인 스타일로 유일 식별(bindHtmlTemplate 은 doctor_name
//   을 이스케이프하므로 값에 id 를 주입할 수 없다 → 템플릿 마크업 셀렉터로 측정).
const NAME_SLOT = 'span[style*="flex:1 1 auto"]';

function renderOpinion(doctorName: string): string {
  return bindHtmlTemplate(TPL, {
    doctor_name: doctorName, // 실제 발급값 형태(escape 대상 일반 필드).
    doctor_seal_html: SEAL_IMG, // _html 접미사 → raw 통과(직인 img).
    doctor_license_no: '145617',
    patient_name: '홍길동',
    issue_date: '2026-08-20',
    clinic_name: '오블리브의원 종로점',
  });
}

const SHORT = '문지은'; // 3자
const LONG = '황보라영선우'; // 6자 (긴 이름)

test.describe('T-20260820 소견서 진료의 칸 위치 고정', () => {
  test('AC-1/AC-2 — 이름 길이가 달라도 직인 X좌표·이름 슬롯 좌표가 동일(밀림 0)', async ({ page }) => {
    await page.setContent(renderOpinion(SHORT), { waitUntil: 'domcontentloaded' });
    await page.locator('#seal-test').waitFor({ state: 'visible' });
    const sealShort = (await page.locator('#seal-test').boundingBox())!;
    const nameShort = (await page.locator(NAME_SLOT).boundingBox())!;

    await page.setContent(renderOpinion(LONG), { waitUntil: 'domcontentloaded' });
    await page.locator('#seal-test').waitFor({ state: 'visible' });
    const sealLong = (await page.locator('#seal-test').boundingBox())!;
    const nameLong = (await page.locator(NAME_SLOT).boundingBox())!;

    // 직인(도장) X좌표: 이름 길이 무관 고정 (핵심 — 종전엔 여기서 ~31px 밀렸음).
    expect(Math.abs(sealShort.x - sealLong.x)).toBeLessThanOrEqual(0.5);
    // 이름 슬롯 좌측 좌표: 고정.
    expect(Math.abs(nameShort.x - nameLong.x)).toBeLessThanOrEqual(0.5);
    // 직인 상단(수직 정렬)도 고정.
    expect(Math.abs(sealShort.y - sealLong.y)).toBeLessThanOrEqual(0.5);
  });

  test('AC-3 — 템플릿이 flex 2슬롯 고정 마크업을 사용(회귀 가드)', () => {
    // 진료의 셀 = flex 컨테이너 + 직인 고정 슬롯(flex:0 0 56px). 종전 inline `&nbsp;&nbsp;` push 제거.
    expect(TPL).toContain('flex:0 0 56px');
    // 소견서 하단 서명표 진료의 셀 토큰은 그대로 유지(발급 로직/데이터 무변 — 바인딩 키 불변).
    expect(TPL).toContain('{{doctor_name}}');
    expect(TPL).toContain('{{doctor_seal_html}}');
  });
});
