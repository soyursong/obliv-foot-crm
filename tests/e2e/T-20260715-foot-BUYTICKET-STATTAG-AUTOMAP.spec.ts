/**
 * E2E spec — T-20260715-foot-BUYTICKET-STATTAG-AUTOMAP
 *
 * 2번차트 > 패키지 > "구입 티켓 추가" 다이얼로그(PackagePurchaseFromTemplateDialog @ CustomerChartPage.tsx)
 *
 * ── 방향전환(총괄 김주연, MSG-20260715-141356-suta) ────────────────────────
 * '통계태깅 제거'(BUYTICKET-STATTAG-REMOVE / PKGTICKET-DLG-STATSTAG-REMOVE, superseded·closed) 접고
 * → 통계태깅(=시술유형 태깅) 값을 스태프 수동 선택 → 패키지 구성에서 자동 파생(자동 매핑)으로 전환.
 *
 * 스펙:
 *  - 시술유형 값 = 이미 구성된 패키지 종류에서 자동 파생. 수동 입력 UI(select) 제거(혼선 방지).
 *  - 필드는 읽기전용(자동분류). 구성 변경 시 자동 갱신.
 *  - 매핑 1:1 identity: 가열→'가열' / 비가열→'비가열' / 포돌로게→'포돌로게' / 수액→'수액' / 리본→'Re:Born'.
 *  - fallback: 매핑 가능한 라인 없음(체험권/사전처치만 등) → '' → persist 시 null(미태깅, CHECK nullable 허용).
 *    ⚠ 체험권(trial)은 packages.treatment_type CHECK 5토큰에 없음 → db_change=false 원칙상 '체험권' persist 불가 → NULL fallback.
 *  - reference_price(변경2 masterReferencePrice per-line, e76cb7df)와 직교 — 유형 파생이 기준정가에 간섭하지 않음.
 *
 * screenshot_gate=exempt (소스 슬라이스 단언형 — UI 교체/자동파생 로직 확인). 실제 DB insert 없음.
 * 실 렌더/동선(구성 변경 시 태깅 자동 갱신)은 supervisor 필드 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC = (rel: string) => readFileSync(resolve(__dirname, '../../src', rel), 'utf-8');

/** PackagePurchaseFromTemplateDialog 본문 슬라이스 (다음 컴포넌트 정의 이전까지) */
function dialogSlice(): string {
  const src = SRC('pages/CustomerChartPage.tsx');
  const idx = src.indexOf('function PackagePurchaseFromTemplateDialog');
  expect(idx, 'PackagePurchaseFromTemplateDialog 정의 존재').toBeGreaterThan(-1);
  const next = src.indexOf('function PackageAddonDialog', idx);
  return src.slice(idx, next > -1 ? next : idx + 40000);
}

test.describe('T-20260715-foot-BUYTICKET-STATTAG-AUTOMAP', () => {
  test('(1) 수동 선택 UI 제거 — select/selectTreatmentType 폐지', () => {
    const dlg = dialogSlice();
    // 수동 <select value={treatmentType}> 제거
    expect(dlg.includes('value={treatmentType}'), '(1) 수동 select value 바인딩 제거').toBe(false);
    // 수동 setter 경로 폐지
    expect(dlg.includes('selectTreatmentType'), '(1) selectTreatmentType 핸들러 제거').toBe(false);
    // 필수 선택 검증 문구 제거(자동 파생이므로 미선택 차단 불필요)
    expect(dlg.includes('시술 유형을 선택하세요'), '(1) 필수 선택 토스트 제거').toBe(false);
  });

  test('(2) 시술유형 = 패키지 구성에서 자동 파생(dominant)', () => {
    const dlg = dialogSlice();
    expect(dlg.includes('derivedTreatmentType'), '(2) 자동 파생 memo 존재').toBe(true);
    // 파생값을 treatmentType state 로 동기화(SSOT = 구성)
    expect(dlg.includes('setTreatmentType(derivedTreatmentType)'), '(2) 파생값 state 동기화').toBe(true);
    // dominant = 회수 최대 → 라인금액 → 고정순서 tie-break
    expect(
      dlg.includes('b.count - a.count || b.amount - a.amount || a.order - b.order'),
      '(2) dominant tie-break(회수>금액>순서)',
    ).toBe(true);
  });

  test('(3) 매핑 1:1 identity — CHECK 5토큰 전부', () => {
    const dlg = dialogSlice();
    // 각 항목(라인) → treatment_type 토큰 identity 매핑
    for (const [item, token] of [
      ['heated', '가열'],
      ['unheated', '비가열'],
      ['podologe', '포돌로게'],
      ['iv', '수액'],
      ['reborn', 'Re:Born'],
    ] as const) {
      expect(
        dlg.includes(`type: '${token}', count: ${item}`),
        `(3) ${item} → '${token}' identity 매핑`,
      ).toBe(true);
    }
  });

  test('(4) fallback — 매핑 라인 없으면 null(미태깅). 체험권(trial) 토큰 persist 안 함', () => {
    const dlg = dialogSlice();
    // 후보 없음 → '' 반환 → persist 시 null
    expect(dlg.includes('if (candidates.length === 0) return'), '(4) 매핑 후보 없음 → 미태깅 fallback').toBe(true);
    // insert 경로: treatment_type: treatmentType || null (미태깅 = null 저장)
    const nullWrites = dlg.match(/treatment_type:\s*treatmentType\s*\|\|\s*null/g) ?? [];
    expect(nullWrites.length, '(4) treatment_type || null 저장 2경로').toBeGreaterThanOrEqual(2);
    // '체험권' 토큰을 파생/저장 대상에 넣지 않음(CHECK 5토큰에 없음 → db_change=false 유지)
    expect(dlg.includes("type: '체험권'"), '(4) 체험권 토큰 파생 대상 아님').toBe(false);
    expect(dlg.includes("treatment_type: '체험권'"), '(4) 체험권 토큰 직접 저장 없음').toBe(false);
  });

  test('(5) reference_price(변경2 per-line)와 직교 — masterReferencePrice 무회귀', () => {
    const dlg = dialogSlice();
    // 자동파생이 기준정가 prefill 을 되살리지 않음(변경2 게이트 유지, treatmentType 게이트 미재도입)
    expect(dlg.includes('setReferencePrice(masterReferencePrice)'), '(5) 기준정가 per-line 합 유지').toBe(true);
    expect(dlg.includes("|| !treatmentType) return"), '(5) treatmentType 기준정가 게이트 미재도입').toBe(false);
  });

  test('(6) 읽기전용 표시 UI — data-testid 유지, 라벨 자동분류', () => {
    const dlg = dialogSlice();
    // 표시용 컨테이너에 testid 유지(회귀·필드검증 hook)
    expect(dlg.includes('data-testid="pkg-treatment-type"'), '(6) pkg-treatment-type testid 유지').toBe(true);
    // 파생값을 표시(라벨) + data 속성 노출
    expect(dlg.includes('data-treatment-type={treatmentType}'), '(6) 파생값 data 속성 노출').toBe(true);
    expect(dlg.includes('자동 분류'), '(6) 자동 분류 라벨 표기').toBe(true);
  });
});
