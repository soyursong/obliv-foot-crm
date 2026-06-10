/**
 * E2E spec — T-20260610-foot-DOCDASH-CLINICAL-INLINE-REFINE
 * 진료대시보드 임상경과 인라인 패널(MedicalChartPanel variant='clinical' embed clinicalMiniBody) 2차 정제
 * (문지은 대표원장 6/10, prior DOCDASH-CLINICAL-UX-REFINE 위 refinement).
 *
 * 검증 대상 (presentation-only 4건, db_change=false):
 *   AC-1: 상단 컨텍스트 안내문구 "오늘 새 임상경과를 작성합니다." 제거 — prior REFINE 에서 이미 제거, 잔존 0 회귀가드.
 *   AC-2: 임상경과 텍스트 필수 validation 제거(선택입력화). 코드상 (a) clinical 텍스트 required 는 애초에 부재
 *         → clinical_progress 는 항상 optional(null 허용). ⚠GUARD (b) 진료의 NOT NULL 강제(AC-P2-6, 의료법) 보존.
 *   AC-3: clinicalMiniBody Textarea embed rows 5→9, min-h 8rem→14rem, w-full. embed=false 풀차트(14/18rem) 불변.
 *   AC-4: 담당의 label+select 동일 행 컴팩트 + flex-wrap(좁은폭 wrap 허용).
 *
 * ⚠ GUARD(절대 회귀 금지): 진료의 NOT NULL 강제(MEDCHART-SIGN-AUDIT AC-P2-6, 의료법) FE 검증 유지.
 *   handleSave 의 `if (!formSigningDoctorId)` 차단 + 양 surface 경고 p 보존. clinical 텍스트는 required 없음(선택).
 * ⚠ REDEFINITION_RISK(비파괴): 同 surface 를 DOCDASH-CHART-UX(인라인화) + DOCDASH-CLINICAL-UX-REFINE(1차정제) 위 적층.
 *
 * 스타일: prior REFINE spec 과 동일 — 소스 정적 검증(라벨/구조/사이즈 회귀 가드). auth/DB 비의존(unit 프로젝트).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const PANEL = () => SRC('components/MedicalChartPanel.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 상단 컨텍스트 안내문구 제거 (prior REFINE 산출, 잔존 0 회귀가드)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 — 상단 안내문구 잔존 0', () => {
  test('"오늘 새 임상경과를 작성합니다." 소스 잔존 0', () => {
    expect(PANEL()).not.toContain('오늘 새 임상경과를 작성합니다.');
  });

  test('clinical-mini-context testid 잔존 0 (3 variant 전부 제거 유지)', () => {
    expect(PANEL()).not.toContain('data-testid="clinical-mini-context"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 임상경과 텍스트 선택입력 (clinical required 부재) + 진료의 NOT NULL 강제 보존
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 — 임상경과 선택입력 / 진료의 강제 보존', () => {
  test('clinical_progress 는 항상 optional (빈값 → null)', () => {
    expect(PANEL()).toContain('clinical_progress: formClinical.trim() || null');
  });

  test('clinical 텍스트 required validation 부재 — 저장버튼 disabled 는 saving/formDate 만', () => {
    const s = PANEL();
    expect(s).toContain('disabled={saving || !formDate}');
    // 저장버튼 disabled 조건에 formClinical 이 결합되지 않음(임상경과 빈 채로도 저장 가능)
    expect(s).not.toContain('disabled={saving || !formDate || !formClinical');
    expect(s).not.toContain('!formClinical.trim()');
  });

  test('GUARD: 진료의 NOT NULL 강제(AC-P2-6) FE 차단 로직 보존', () => {
    const s = PANEL();
    expect(s).toContain('AC-P2-6');
    expect(s).toContain('if (!formSigningDoctorId) {');
    expect(s).toContain("toast.error('진료의가 필요합니다 — 담당 의사를 선택해주세요');");
  });

  test('GUARD: 담당의 미선택 경고 p 보존(저장 안내)', () => {
    expect(PANEL()).toContain('data-testid="clinical-mini-doctor-warning"');
    expect(PANEL()).toContain('진료의를 선택해야 저장할 수 있습니다.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — clinicalMiniBody Textarea embed 추가 확대 (풀차트 불변)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 — 임상경과 textarea embed 확대', () => {
  test('rows embed 9 / 풀차트 14', () => {
    expect(PANEL()).toContain('rows={embed ? 9 : 14}');
  });

  test('min-h embed 14rem(w-full) / 풀차트 18rem', () => {
    expect(PANEL()).toContain("embed ? 'w-full min-h-[14rem]' : 'min-h-[18rem]'");
  });

  test('회귀: 옛 값(rows 5 / min-h 8rem) 잔존 0', () => {
    const s = PANEL();
    expect(s).not.toContain('rows={embed ? 5 : 14}');
    expect(s).not.toContain("embed ? 'min-h-[8rem]' : 'min-h-[18rem]'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 — 담당의 동일 행 컴팩트 + flex-wrap
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 — 담당의 1줄 컴팩트 + wrap', () => {
  test('담당의 행 래퍼 flex-wrap 적용(좁은폭 wrap 허용)', () => {
    const s = PANEL();
    const block = s.slice(
      s.indexOf('AC-4: 담당의 선택칸+인접'),
      s.indexOf('data-testid="clinical-mini-signing-doctor"'),
    );
    expect(block).toContain('flex flex-wrap items-center gap-2');
    expect(block).toMatch(/<label className="w-16 shrink-0/);
  });

  test('select 컴팩트 폭(flex-1 max-w-[280px]) 유지 — 옛 w-full 블록 회귀 없음', () => {
    const s = PANEL();
    const block = s.slice(
      s.indexOf('AC-4: 담당의 선택칸+인접'),
      s.indexOf('data-testid="clinical-mini-doctor-warning"'),
    );
    expect(block).toContain('flex-1 max-w-[280px]');
    expect(block).not.toContain('w-full max-w-[280px]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-5 (guard) — 인라인 동선 / 저장로직 무변경 회귀가드
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-5 — 인라인 동선/저장로직 회귀가드', () => {
  test('embed clinical 인라인 아코디언 렌더 보존(AC1-1)', () => {
    const s = PANEL();
    expect(s).toContain("if (embed && variant === 'clinical')");
    expect(s).toContain('data-testid="medical-chart-clinical-inline"');
  });

  test('같은날 append/진료의 스냅샷 저장 payload 무변경', () => {
    const s = PANEL();
    expect(s).toContain('signing_doctor_id: formSigningDoctorId');
    expect(s).toContain('signing_doctor_name: selectedDoctor.name');
  });
});
