/**
 * E2E spec — T-20260611-foot-MEDREC-CLINICAL-SAVE-UICLEANUP
 * 진료기록 패널(MedicalChartPanel) UI 정리 (②만 — ① 임상경과 인라인 저장실패는 별도 P1 hotfix
 * T-20260611-foot-DOCDASH-CLINICAL-SAVE-FAIL 소유, 본 티켓 범위 제외/회귀가드만).
 *
 * 신고(②): 진료기록 패널의 시각 잡동사니(읽기전용 태그·중복 라벨)와 모호한 버튼명.
 *
 * 작업(AC):
 *   AC-1 레이아웃: 진료일 | 담당의사 두 단. (임상경과/진료메모 2단 + 처방내역 진단명 아래 누적은
 *        NOTES-2COL 850ceed 기구현 — 회귀 금지, 미충족분=진료일·담당의사 두 단만 추가.)
 *   AC-2 정리: 치료사차트/치료메모 '읽기전용' 태그 badge 제거 / 치료메모 태그형 라벨 제거 /
 *        '원장 전용' 태그 제거 → 안내문구 "의료진 전용 메모입니다. 타 스태프에게 노출되지 않습니다"
 *        (의료진 전용 role 노출제한 동작 isDirector 게이트는 유지).
 *   AC-3 리네임: 신규 저장 버튼 "기록 저장" → "진료기록 저장".
 *   AC-4 회귀: 2COL·배지제거(c93ec1c)·INLINE-REFINE·SAVE-FAIL(chartsLoadedRef)·SIGN-AUDIT
 *        (진료의 NOT NULL) 보존.
 *
 * 시나리오(티켓 본문):
 *   S1: 진료기록 작성 영역 — 신규 저장 버튼 라벨이 "진료기록 저장"(AC-3) + 치료사차트/치료메모
 *       '읽기전용' 태그 badge 미존재(AC-2).
 *   S2: 의료진 전용 메모 — 안내문구 노출 + '원장 전용' 태그 제거(AC-2) + isDirector 게이트 유지.
 *
 * 스타일: 형제 티켓(DOCDASH-CLINICAL-SAVE-FAIL)과 동일 — source 정적 가드(auth/DB 비의존, 결정론적).
 *   이 패널은 6/9~6/11 6건+ 연속변형 핫스팟이라 시드/권한 의존 라이브 시나리오는 flaky →
 *   정본 소스에 대한 presence/absence 가드로 AC를 결정론적으로 고정한다.
 *   (라이브 실화면 still-wrong 최종판정은 supervisor QA — REDEFINITION_RISK 방침.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const PANEL = () => SRC('components/MedicalChartPanel.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// S1 — 진료기록 작성영역: 저장 버튼명(AC-3) + 읽기전용 태그 제거(AC-2)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 — 저장 버튼명 + 치료사차트/치료메모 읽기전용 태그 제거', () => {
  test('AC-3: 신규 저장 버튼 라벨이 "진료기록 저장" (구 "기록 저장" 제거)', () => {
    const src = PANEL();
    expect(src).toContain("'진료기록 저장'");
    // 구 라벨이 신규 저장 버튼 삼항에 남아있지 않아야 함.
    expect(src).not.toMatch(/:\s*'기록 저장'/);
  });

  test('AC-2: 치료사차트 헤더 "읽기전용" 태그 badge 제거 — 라벨만 유지', () => {
    const src = PANEL();
    // 치료사차트 라벨은 보존.
    expect(src).toContain('>치료사차트<');
    // 치료사차트 헤더의 gray '읽기전용' badge 제거.
    expect(src).not.toContain(
      '<span className="text-[10px] text-muted-foreground bg-gray-100 rounded px-1.5 py-0.5">읽기전용</span>',
    );
  });

  test('AC-2: 치료메모 이력 태그형 라벨 + "읽기전용" badge 헤더 제거', () => {
    const src = PANEL();
    // 태그형 '치료메모 이력' 라벨 span 제거(주석 언급은 무관 — 렌더 span 만 검사).
    expect(src).not.toContain('>치료메모 이력</span>');
    // 치료메모 이력의 muted '읽기전용' badge 제거.
    expect(src).not.toContain(
      '<span className="text-[9px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">읽기전용</span>',
    );
    // 단, 치료메모 이력 항목 컨테이너(데이터 표시)는 보존 — 라벨만 정리한 것.
    expect(src).toContain('data-testid="treat-memo-in-chart-section"');
  });

  test('AC-2 동작보존: 치료사차트 Textarea readOnly/disabled(읽기전용 동작) 유지', () => {
    const src = PANEL();
    const block = src.match(/data-testid="medical-chart-treatment"[\s\S]{0,80}/);
    expect(block, '치료사차트 textarea 존재').not.toBeNull();
    // 동작 자체(읽기전용)는 그대로 — 태그만 제거.
    expect(src).toMatch(/readOnly\s+disabled[\s\S]*?data-testid="medical-chart-treatment"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 — 의료진 전용 메모: 안내문구(AC-2) + 태그 제거 + isDirector 게이트 유지
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 — 의료진 전용 메모 안내문구 + "원장 전용" 태그 제거', () => {
  // T-20260612-foot-MEDREC-DATE-DIAG-UI-REFINE ⑦ SUPERSEDES this AC-2 안내문구:
  //   reporter(문지은) 직접지시 — 안내문구 전부 제거 → '의료진 전용메모' 소헤더만. 회귀 가드를 역전.
  test('AC-2(⑦ superseded): 안내문구 제거 + "의료진 전용메모" 소헤더만', () => {
    const src = PANEL();
    // ⑦: 구 안내문구·구 testid 완전 제거.
    expect(src).not.toContain('의료진 전용 메모입니다. 타 스태프에게 노출되지 않습니다');
    expect(src).not.toContain('data-testid="doctor-memo-notice"');
    // ⑦: 소헤더만 남김.
    expect(src).toContain('data-testid="doctor-memo-header"');
    expect(src).toContain('>의료진 전용메모</h4>');
    // 구 '원장 전용' 태그 badge 제거(유지).
    expect(src).not.toContain(
      '<span className="text-[10px] text-muted-foreground bg-gray-100 rounded px-1.5 py-0.5">원장 전용</span>',
    );
  });

  test('AC-2 게이트 유지: 의료진 전용 메모는 isDirector 일 때만 렌더', () => {
    const src = PANEL();
    // doctor-memo-section 은 여전히 isDirector 조건부 렌더 안에 있어야 함(노출제한 동작 보존).
    expect(src).toMatch(/\{isDirector \?\s*\([\s\S]*?data-testid="doctor-memo-section"/);
    // 비원장은 미렌더(null) 분기 보존.
    expect(src).toContain('data-testid="doctor-memo-input"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 진료일 | 담당의사 두 단 (NOTES-2COL 기구현 회귀 금지)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 — 진료일|담당의사 두 단 + 기구현 2COL 회귀 금지', () => {
  test('진료일·담당의사가 두 단(flex-row) 래퍼로 묶임', () => {
    const src = PANEL();
    expect(src).toContain('data-testid="chart-date-doctor-row"');
    // 래퍼 div 가 두 단(flex-row) 클래스를 가짐 (className 이 data-testid 앞에 옴).
    expect(src).toMatch(/className="flex flex-col sm:flex-row[^"]*" data-testid="chart-date-doctor-row"/);
    // 두 칼럼 모두 flex-1 로 균등 — 래퍼 직후 진료일, 이후 담당의사 select 존재.
    expect(src).toMatch(/chart-date-doctor-row[\s\S]*?data-testid="medical-chart-date"[\s\S]*?data-testid="signing-doctor-select-block"/);
  });

  test('회귀: 임상경과/진료메모 2단(NOTES-2COL) 보존', () => {
    const src = PANEL();
    expect(src).toContain('data-testid="notes-2col-row"');
    expect(src).toContain('data-testid="doctor-memo-section"');
  });

  test('회귀: 처방내역이 진단명 아래(누적) 배치 — 진단명 → 처방내역 순서 보존', () => {
    const src = PANEL();
    expect(src).toMatch(/data-testid="medical-chart-diagnosis"[\s\S]*?data-testid="prescription-items-table"|data-testid="medical-chart-diagnosis"[\s\S]*?처방내역 없음/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 — 회귀가드: 인접 핫픽스/의료법 배선 불변
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 회귀가드 — 인접 변경 보존', () => {
  test('c93ec1c 배지제거: 개발 라벨 "2번차트 1구역" 미부활', () => {
    const src = SRC('components/CustomerChartSheet.tsx');
    expect(src).not.toContain('2번차트 1구역');
  });

  test('AC-5: 2번차트(CustomerChartSheet 조회면)는 MedicalChartPanel 미공유 — 레이아웃 변경 무전파', () => {
    // 입력 패널(MedicalChartPanel)의 2단 레이아웃·태그제거가 2번차트 진료내역 조회면에 전파되지 않음을
    // 컴포넌트 독립으로 보장. CustomerChartSheet 가 MedicalChartPanel 을 렌더/임포트하지 않아야 함.
    const sheet = SRC('components/CustomerChartSheet.tsx');
    expect(sheet).not.toContain('MedicalChartPanel');
  });

  test('SAVE-FAIL(P1) 보존: chartsLoadedRef 레이스 게이트 배선 불변', () => {
    const src = PANEL();
    expect(src).toMatch(/const chartsLoadedRef = useRef\(false\)/);
    expect(src).toMatch(/if \(!chartsLoadedRef\.current\) return;/);
  });

  test('SIGN-AUDIT 보존: 진료의 NOT NULL FE 가드(저장 차단) 불변', () => {
    const src = PANEL();
    expect(src).toMatch(/if \(!formSigningDoctorId\) \{/);
    expect(src).toMatch(/진료의가 필요합니다/);
  });

  test('SIGN-AUDIT 보존: medical_charts 진료의 강제 트리거(의료법) 마이그 불변', () => {
    const mig = readFileSync(
      path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260608170000_medchart_signing_doctor.sql'),
      'utf8',
    );
    expect(mig).toMatch(/enforce_medchart_signing_doctor/);
    expect(mig).toMatch(/BEFORE INSERT OR UPDATE ON medical_charts/);
  });
});
