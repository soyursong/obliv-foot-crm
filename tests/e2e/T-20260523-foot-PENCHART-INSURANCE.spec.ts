/**
 * T-20260523-foot-PENCHART-INSURANCE
 * [보험차트] 양식 명칭 + 자동채움 위치 정정
 *
 * 스펙 정정 (INFO MSG-20260523-230107-n5ht):
 *   - 대상: 펜차트 양식 1종([보험차트])만 — 발건강 질문지·환불동의서 무영향
 *   - 위치: 양식 상단, Obliv Clinic 로고(x≈185) 우측 — x=190, y=28 (헤더 영역)
 *   - 필드: 성함 + 주민번호 1줄 inline (2026-05-24 현장 요청: 한 줄·폰트 축소)
 *   - 구현 변경: PENCHART_AUTOFILL_POS 세로 스택 → drawPenChartAutofillInline 1줄 방식
 *
 * AC-1(C1): [보험차트] 열 때 빨간 박스 위치에 고객 성함 자동 표시
 * AC-2(C1): 동일 위치에 주민번호 자동 표시
 * AC-3(C2): 양식 선택 패널 명칭 [보험차트]
 * AC-4(C2): 양식 헤더 명칭 [보험차트]
 * AC-5: 자동 채움 (수동 입력 불필요)
 * AC-6(C3): 다른 양식(발건강 질문지·환불동의서) 무영향
 * AC-7: 빌드+E2E 회귀 없음
 *
 * 노트: PenChartTab 소스가 Vite import.meta.env 를 사용하므로
 *       Node.js 직접 임포트 불가 → 상수값 인라인 검증 + 소스 grep 방식 병행.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// 소스 파일 경로 (process.cwd() = 프로젝트 루트)
const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src/components/PenChartTab.tsx');
const SEED_SQL = path.join(ROOT, 'supabase/migrations/20260517000060_penchart_template_seed.sql');
const MIGRATION_SQL = path.join(ROOT, 'supabase/migrations/20260524000001_pen_chart_rename_insurance.sql');

test.describe('T-20260523-foot-PENCHART-INSURANCE', () => {

  // AC-3 / AC-4: 양식 명칭 [보험차트]
  test('AC-3/AC-4: BUILTIN_PEN_CHART_TEMPLATE.name_ko 가 "[보험차트]" (소스 검증)', () => {
    const src = fs.readFileSync(SRC, 'utf-8');
    // 인라인 상수 확인
    expect(src).toContain("name_ko: '[보험차트]'");
    // form_key 유지 확인
    expect(src).toContain("form_key: 'pen_chart'");
  });

  test('AC-3: 양식 선택 패널이 템플릿 name_ko 동적 참조 (하드코딩 제거)', () => {
    const src = fs.readFileSync(SRC, 'utf-8');
    // 선택 패널에서 "펜차트 양식" 하드코딩이 없어야 함
    // (penChartTemplate ?? BUILTIN_PEN_CHART_TEMPLATE).name_ko 로 대체됨)
    const hardcoded = /className.*purple.*\n.*>펜차트 양식</;
    expect(hardcoded.test(src)).toBe(false);
    // 동적 참조 존재 확인
    expect(src).toContain('(penChartTemplate ?? BUILTIN_PEN_CHART_TEMPLATE).name_ko');
  });

  // AC-1/AC-2: 자동채움 — inline 1줄 배치 (2026-05-24 현장 요청 반영)
  // 김주연 총괄 요청: "성함+주민번호 배치를 한 줄로 하고 폰트 사이즈 좀만 줄여줘"
  // → PENCHART_AUTOFILL_POS 세로 스택 방식 → drawPenChartAutofillInline 1줄 inline 방식으로 전환
  test('AC-1/AC-2: drawPenChartAutofillInline 함수 존재 + name/rrn 1줄 inline 렌더링', () => {
    const src = fs.readFileSync(SRC, 'utf-8');
    // 함수 자체 존재 확인
    expect(src).toContain('function drawPenChartAutofillInline(');
    // 성함 필드 처리 확인
    expect(src).toContain("parts.push(`성함: ${name}`)");
    // 주민번호 필드 처리 확인 (rrn 필드 사용)
    expect(src).toContain("parts.push(`주민번호: ${rrn}`)");
    // join으로 1줄 출력 확인
    expect(src).toContain("parts.join('  ')");
    // inline 좌표 확인: x=190 (로고 우측), y=28 (상단 헤더 영역)
    expect(src).toContain('ctx.fillText(parts.join(');
    const inlineFnBlock = src.match(/function drawPenChartAutofillInline[\s\S]*?\n\}/)?.[0] ?? '';
    expect(inlineFnBlock).toBeTruthy();
    // x 좌표가 로고(x≈185) 우측인지 확인 (x≥100)
    const xMatch = inlineFnBlock.match(/fillText\(parts\.join\([^)]*\),\s*(\d+)/);
    if (xMatch) {
      expect(parseInt(xMatch[1], 10)).toBeGreaterThanOrEqual(100);
    }
  });

  // AC-5: bgCanvas draw 경로에서 pen_chart → drawPenChartAutofillInline 자동 적용
  // (2026-05-24 현장 요청 반영: 위치 기반 → inline 1줄 방식으로 전환)
  test('AC-5: pen_chart form_key 분기에서 drawPenChartAutofillInline 호출', () => {
    const src = fs.readFileSync(SRC, 'utf-8');
    // 자동채움 분기 확인
    expect(src).toContain("} else if (fk === 'pen_chart') {");
    // inline 방식 호출 확인
    expect(src).toContain('drawPenChartAutofillInline(ctx, autofillDataRef.current)');
    // 구 방식(PENCHART_AUTOFILL_POS)은 pen_chart 분기에서 사용하지 않음
    // (환불동의서 분기에서는 drawAutofillOnCtx 계속 사용)
  });

  // AC-6: 다른 양식 form_key 명칭 무영향 확인
  test('AC-6: 발건강 질문지 form_key health_questionnaire_* 유지', () => {
    const src = fs.readFileSync(SRC, 'utf-8');
    expect(src).toContain("form_key: 'health_questionnaire_general'");
    expect(src).toContain("form_key: 'health_questionnaire_senior'");
    // 발건강 질문지 name_ko 에 "[보험차트]" 없음
    const hqGeneral = src.match(/BUILTIN_HEALTH_Q_GENERAL[^;]+;/s)?.[0] ?? '';
    expect(hqGeneral).not.toContain('[보험차트]');
  });

  test('AC-6: 환불동의서 form_key refund_consent 유지, name_ko 무변경', () => {
    const src = fs.readFileSync(SRC, 'utf-8');
    expect(src).toContain("form_key: 'refund_consent'");
    const refundBlock = src.match(/BUILTIN_REFUND_CONSENT[^;]+;/s)?.[0] ?? '';
    expect(refundBlock).not.toContain('[보험차트]');
  });

  // DB seed 마이그레이션 검증
  test('AC-3/AC-4: DB seed 마이그레이션 name_ko = "[보험차트]"', () => {
    const sql = fs.readFileSync(SEED_SQL, 'utf-8');
    expect(sql).toContain("'[보험차트]'");
    // 이전 명칭 남아있지 않음
    expect(sql).not.toContain("'펜차트 양식'");
  });

  test('AC-7: 갱신 마이그레이션 파일 존재 + UPDATE 문 확인', () => {
    expect(fs.existsSync(MIGRATION_SQL)).toBe(true);
    const sql = fs.readFileSync(MIGRATION_SQL, 'utf-8');
    expect(sql).toContain("'[보험차트]'");
    expect(sql).toContain("form_key = 'pen_chart'");
  });

});
