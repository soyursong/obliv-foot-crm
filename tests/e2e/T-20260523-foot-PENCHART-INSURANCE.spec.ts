/**
 * T-20260523-foot-PENCHART-INSURANCE
 * [보험차트] 양식 명칭 + 자동채움 위치 정정
 *
 * 스펙 정정 (INFO MSG-20260523-230107-n5ht):
 *   - 대상: 펜차트 양식 1종([보험차트])만 — 발건강 질문지·환불동의서 무영향
 *   - 위치: 양식 상단, Obliv Clinic 로고 우측·담당의 좌측 중앙 빨간 박스
 *   - 필드: 성함(상단) + 주민번호 앞자리(하단) 세로 스택
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

  // AC-1/AC-2: 자동채움 좌표가 중앙 박스 위치
  // PENCHART_AUTOFILL_POS 블록 추출: 닫는 ]; 패턴 사용
  test('AC-1/AC-2: PENCHART_AUTOFILL_POS 성함·주민번호 세로 스택 + 중앙 x≥270', () => {
    const src = fs.readFileSync(SRC, 'utf-8');
    // 블록 추출: "const PENCHART_AUTOFILL_POS" 시작 ~ 닫는 "];" 까지
    const posBlock = src.match(/const PENCHART_AUTOFILL_POS[\s\S]*?\];/)?.[0] ?? '';
    expect(posBlock).toBeTruthy();

    // 각 항목 라인 파싱 (한 줄에 key/x/y 모두 있음)
    const lines = posBlock.split('\n');
    let nameX = -1, nameY = -1, bdX = -1, bdY = -1;
    for (const line of lines) {
      const xM = line.match(/x:\s*(\d+)/);
      const yM = line.match(/y:\s*(\d+)/);
      if (!xM || !yM) continue;
      if (line.includes("key: 'name'")) {
        nameX = parseInt(xM[1], 10); nameY = parseInt(yM[1], 10);
      } else if (line.includes("key: 'birthDate'")) {
        bdX = parseInt(xM[1], 10); bdY = parseInt(yM[1], 10);
      }
    }

    // 중앙 박스: x≥270 (로고 우측, 담당의 좌측)
    expect(nameX).toBeGreaterThanOrEqual(270);
    expect(nameX).toBeLessThan(550);
    // birthDate x도 중앙 박스
    expect(bdX).toBeGreaterThanOrEqual(270);
    // 세로 스택: 주민번호 y > 성함 y
    expect(bdY).toBeGreaterThan(nameY);
    // 간격 10px 이상
    expect(bdY - nameY).toBeGreaterThanOrEqual(10);
  });

  // AC-5: bgCanvas draw 경로에서 pen_chart → PENCHART_AUTOFILL_POS 자동 적용
  test('AC-5: pen_chart form_key 분기에서 PENCHART_AUTOFILL_POS 호출', () => {
    const src = fs.readFileSync(SRC, 'utf-8');
    // 자동채움 분기 확인
    expect(src).toContain("} else if (fk === 'pen_chart') {");
    expect(src).toContain('drawAutofillOnCtx(ctx, autofillDataRef.current, PENCHART_AUTOFILL_POS)');
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
