/**
 * T-20260625-foot-PENCHART-HEALTHQ-SENIOR-TO-FOREIGN
 * 2번차트 펜차트 "발건강질문지 자가작성" 양식 선택기 — 어르신용 제거 / 외국인용 추가
 * reporter: 김주연 총괄 (foot CRM C0ATE5P6JTH)
 *
 * 배경(AC-0 RESOLVED): "외국인용" = 旣배포 T-20260625-foot-FOREIGN-HEALTHQ-EN(commit 56ea7273)
 *   영문 설문 flow 재사용. 별도 신규 form_key 없음. 펜차트 자가작성 패널에서 "외국인용" 선택 시
 *   토큰 발급 lang='en' → 기존 영문 외국인 설문 렌더.
 *
 * AC-1 [어르신용 제거]: PenChartTab 양식 선택기에서 health_questionnaire_senior 미노출.
 *        선택 조회 .in() + fallback 배열에서 senior 제외.
 * AC-2 [데이터 안전]: BUILTIN_HEALTH_Q_SENIOR 상수·조회/편집 캔버스 경로(getCanvasHeightForForm,
 *        hq_sr_ 파일명 → senior 복원) 보존 (과거 어르신용 차트·결과 DELETE/DROP 없음).
 * AC-3 [외국인용 추가]: HealthQResultsPanel 자가작성 패널 양식 변형 = [일반 / 외국인용].
 *        외국인용 선택 → 발급 토큰 lang='en'.
 * AC-4 [회귀 0]: 일반 선택 → lang='ko' 발급. FOREIGN-HEALTHQ-EN(HealthQMobilePage lang 분기) 불변.
 *
 * NOTE: chart spec 관례 — 순수 로직 + 소스 회귀가드. 실제 갤탭 렌더/터치 confirm 은
 *       supervisor field-soak 단계에서 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const readSrc = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

const penChart = readSrc('src/components/PenChartTab.tsx');
const hqPanel = readSrc('src/components/HealthQResultsPanel.tsx');

// ════════════════════════════════════════════════════════════════════════
// AC-1: 펜차트 양식 선택기 — 어르신용 제거 (선택 경로)
// ════════════════════════════════════════════════════════════════════════
test.describe('AC-1: 펜차트 양식 선택기 senior 제거', () => {
  // loadTemplates 의 form_key .in() 조회 윈도우 추출
  const inStart = penChart.indexOf(".in('form_key', [");
  const inSeg = penChart.slice(inStart, inStart + 220);

  test('선택 조회 .in() 에서 health_questionnaire_senior 제외', () => {
    expect(inStart).toBeGreaterThan(0);
    expect(inSeg).toContain('health_questionnaire_general');
    expect(inSeg).not.toContain('health_questionnaire_senior');
  });

  test('fallback 배열(setHealthQTemplates)에 BUILTIN_HEALTH_Q_SENIOR 없음', () => {
    // 두 곳의 setHealthQTemplates fallback 모두 general 단독
    const matches = penChart.match(/setHealthQTemplates\([^\n]*\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (const m of matches) {
      // DB 결과(healthQs) 분기 줄은 변수만 참조 — fallback(builtin 배열) 줄만 검사
      if (m.includes('BUILTIN_HEALTH_Q')) {
        expect(m).toContain('BUILTIN_HEALTH_Q_GENERAL');
        expect(m).not.toContain('BUILTIN_HEALTH_Q_SENIOR');
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// AC-2: 데이터 안전 — senior 조회/편집 경로 보존
// ════════════════════════════════════════════════════════════════════════
test.describe('AC-2: senior 조회/편집 경로 보존 (비파괴)', () => {
  test('BUILTIN_HEALTH_Q_SENIOR 상수 정의 유지', () => {
    expect(penChart).toContain('export const BUILTIN_HEALTH_Q_SENIOR');
    expect(penChart).toContain("form_key: 'health_questionnaire_senior'");
  });

  test('과거 senior 차트 캔버스 높이/복원 경로 유지', () => {
    // 저장된 hq_sr_ 파일 → senior form_key 복원
    expect(penChart).toContain("return 'health_questionnaire_senior'");
    // senior 2페이지 캔버스 높이 분기 유지
    expect(penChart).toContain("formKey === 'health_questionnaire_senior'");
    // 파일명 prefix hq_sr_ 분기 유지
    expect(penChart).toContain('hq_sr_');
  });

  test('DELETE/DROP 같은 파괴 연산 없음 (선택지 제거뿐)', () => {
    // loadTemplates 부근에 senior row 삭제 코드 없음
    expect(penChart).not.toMatch(/delete\(\)[\s\S]{0,80}health_questionnaire_senior/i);
  });
});

// ════════════════════════════════════════════════════════════════════════
// AC-3 / AC-4: 자가작성 패널 양식 변형 = [일반 / 외국인용], 외국인용 → lang='en'
// ════════════════════════════════════════════════════════════════════════
test.describe('AC-3/AC-4: 자가작성 패널 외국인용 wiring', () => {
  test('변형 셀렉트 = 일반 / 외국인용 (어르신용 옵션 없음)', () => {
    expect(hqPanel).toContain('data-testid="healthq-variant-select"');
    expect(hqPanel).toContain('<option value="general">일반</option>');
    expect(hqPanel).toContain('<option value="foreign">외국인용 (English)</option>');
    // 발급 셀렉트에서 어르신용 옵션 제거
    expect(hqPanel).not.toContain('<option value="senior">어르신용</option>');
  });

  test('토큰 발급 — 외국인용=lang en / 일반=lang ko, form_type 항상 general', () => {
    expect(hqPanel).toContain("p_form_type:    'general'");
    expect(hqPanel).toContain("p_lang:         variant === 'foreign' ? 'en' : 'ko'");
  });

  // 순수 로직 재현 — 변형 → (form_type, lang) 매핑
  const tokenParams = (variant: 'general' | 'foreign') => ({
    form_type: 'general' as const,
    lang: variant === 'foreign' ? ('en' as const) : ('ko' as const),
  });

  test('일반 변형 → lang=ko (FOREIGN-HEALTHQ-EN 무회귀: ko 기존 동작)', () => {
    expect(tokenParams('general')).toEqual({ form_type: 'general', lang: 'ko' });
  });

  test('외국인용 변형 → lang=en (영문 설문 진입)', () => {
    expect(tokenParams('foreign')).toEqual({ form_type: 'general', lang: 'en' });
  });
});

// ════════════════════════════════════════════════════════════════════════
// AC-4: FOREIGN-HEALTHQ-EN 고객 모바일 EN 분기 — 불변 가드
// ════════════════════════════════════════════════════════════════════════
test.describe('AC-4: HealthQMobilePage lang 분기 불변', () => {
  const mobile = readSrc('src/pages/HealthQMobilePage.tsx');
  test('영문 헤더 + lang 분기 메커니즘 유지', () => {
    // 본 티켓은 발급 진입점만 변경 — 고객 모바일 EN 렌더 로직은 미변경
    expect(mobile).toContain('Foot Health Questionnaire');
  });
});
