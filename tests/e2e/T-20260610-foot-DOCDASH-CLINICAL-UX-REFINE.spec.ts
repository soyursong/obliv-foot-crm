/**
 * E2E spec — T-20260610-foot-DOCDASH-CLINICAL-UX-REFINE
 * 진료완료 환자 임상경과 인라인 패널(MedicalChartPanel embed) UX 정제 (문지은 대표원장 6/10).
 *
 * 검증 대상 (presentation-only 4건, db_change=false):
 *   AC-1: clinicalMiniBody 컨텍스트 안내 <p data-testid="clinical-mini-context"> 3 variant 모두 제거.
 *   AC-2: '· 진료기록 필수 (의료법)' 라벨 span 양쪽(embed clinicalMiniBody / 풀차트
 *         signing-doctor-select-block) 제거. **로직=A안**: 진료의 NOT NULL 강제 검증은 유지(라벨 텍스트만 제거).
 *   AC-3: clinicalMiniBody Textarea embed rows 3→5, min-h 4.5rem→8rem. embed=false 풀차트(14/18rem) 불변.
 *   AC-4: clinicalMiniBody 담당의 label+select 1줄 인라인(flex items-center gap-2, label 고정폭 + select flex-1).
 *         "진료의를 선택해야 저장할 수 있습니다." 경고 p는 A안이므로 유지.
 *
 * ⚠ GUARD(절대 회귀 금지): 진료의 NOT NULL 강제(MEDCHART-SIGN-AUDIT AC-P2-6, 의료법) FE 검증 유지.
 *   handleSave 의 `if (!formSigningDoctorId)` 차단 + 양 surface 경고 p(저장 안내) 보존.
 * ⚠ REDEFINITION_RISK(비파괴): 同 surface 를 DOCDASH-CHART-UX(field-soak)가 막 인라인화.
 *   인라인 아코디언 구조·NOT NULL 강제·저장 append 로직 위 누적 — 회귀 가드 포함.
 *
 * 스타일: 형제 티켓(DOCDASH-LABEL-RX-REFINE)과 동일 — 소스 정적 검증(라벨/구조 회귀 가드).
 *   auth/DB 비의존(unit 프로젝트).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const PANEL = () => SRC('components/MedicalChartPanel.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 컨텍스트 안내 p 제거
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 — clinical-mini-context 제거', () => {
  test('clinical-mini-context testid 잔존 0 (3 variant 전부 제거)', () => {
    expect(PANEL()).not.toContain('data-testid="clinical-mini-context"');
  });

  test('안내 문구 3 variant 모두 소스에서 제거', () => {
    const s = PANEL();
    expect(s).not.toContain('진료차트의 임상경과를 이어서 작성합니다.');
    expect(s).not.toContain('오늘 새 임상경과를 작성합니다.');
    // variant3 의 안내 문구만 제거 — 헤더의 '본 차트 열기' 버튼(L2043)은 별개로 보존
    expect(s).not.toContain('전체 차트는 헤더의');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — '· 진료기록 필수 (의료법)' 라벨 span 양쪽 제거 (A안: 검증 로직 유지)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 — 의료법 라벨 span 제거 (양 surface)', () => {
  test('"· 진료기록 필수 (의료법)" span 잔존 0', () => {
    expect(PANEL()).not.toContain('진료기록 필수 (의료법)');
  });

  test('GUARD: 진료의 NOT NULL 강제(AC-P2-6) FE 차단 로직 보존', () => {
    const s = PANEL();
    expect(s).toContain('AC-P2-6');
    expect(s).toContain('if (!formSigningDoctorId) {');
    expect(s).toContain("toast.error('진료의가 필요합니다 — 담당 의사를 선택해주세요');");
  });

  test('GUARD: 양 surface 저장 안내 경고 p 보존 (A안)', () => {
    const s = PANEL();
    expect(s).toContain('data-testid="clinical-mini-doctor-warning"');
    expect(s).toContain('data-testid="signing-doctor-warning"');
    // "진료의를 선택해야 저장할 수 있습니다." 2건(embed + 풀차트) 유지
    const cnt = (s.match(/진료의를 선택해야 저장할 수 있습니다\./g) ?? []).length;
    expect(cnt).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 B안 — embed clinical 로그인 의사 auto-fill (reporter 문지은 confirm 1781074543.411799)
//   풀차트 SIGN-AUDIT auto-fill 패턴을 embed clinical 에 동일 이식.
//   "로그인 계정이 의사면 자동 본인 + 드롭다운 수동 변경 가능 + 비우면 저장 차단".
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 B안 — embed clinical 의사 auto-fill', () => {
  test('auto-fill effect: 이름 매칭(clinic_doctors)으로 본인 자동 선택', () => {
    const s = PANEL();
    // role 프록시 게이트 제거 → 이름 매칭 자체가 의사 판정
    expect(s).toContain('const mine = clinicDoctors.find((d) => d.name === currentUserName);');
    expect(s).toContain('if (mine) setFormSigningDoctorId(mine.id);');
  });

  test('GUARD: 신규+미선택일 때만 채움 (수동 선택/저장차트 보존)', () => {
    const s = PANEL();
    const block = s.slice(
      s.indexOf('AC-2 B안'),
      s.indexOf('if (mine) setFormSigningDoctorId(mine.id);'),
    );
    expect(block).toContain('if (selectedChartId) return;');
    expect(block).toContain('if (formSigningDoctorId) return;');
  });

  test('회귀: 옛 isDirector 역할 게이트가 auto-fill 을 막지 않음', () => {
    const s = PANEL();
    const block = s.slice(
      s.indexOf('AC-2 B안'),
      s.indexOf('if (mine) setFormSigningDoctorId(mine.id);'),
    );
    // manager/doctor 역할 의사도 auto-fill 되어야 하므로 effect 내 isDirector 하드 게이트 부재
    expect(block).not.toContain('if (!isDirector) return;');
  });

  test('B안 출처 주석(reporter confirm ts) 보존', () => {
    expect(PANEL()).toContain('AC-2 B안(reporter 문지은 confirm 1781074543.411799)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — clinicalMiniBody Textarea embed 크기 확대 (풀차트 불변)
// ─────────────────────────────────────────────────────────────────────────────
// NOTE(2026-06-10): T-20260610-foot-DOCDASH-CLINICAL-INLINE-REFINE 가 본 ticket 의 AC-3(textarea 크기)·
//   AC-4(담당의 행)를 2차 정제로 supersede. embed textarea 5→9rows/8rem→14rem(w-full), 담당의 행 flex-wrap 추가.
//   superseded 단언은 새 값으로 갱신(비파괴 적층) — 후속 ticket spec 이 최신값 회귀가드 보유.
test.describe('AC-3 — 임상경과 textarea embed 크기 (INLINE-REFINE 갱신)', () => {
  test('rows embed 9 / 풀차트 14', () => {
    expect(PANEL()).toContain('rows={embed ? 9 : 14}');
  });

  test('min-h embed 14rem(w-full) / 풀차트 18rem', () => {
    expect(PANEL()).toContain("embed ? 'w-full min-h-[14rem]' : 'min-h-[18rem]'");
  });

  test('회귀: 옛 값(3 / 4.5rem) 잔존 0', () => {
    const s = PANEL();
    expect(s).not.toContain('rows={embed ? 3 : 14}');
    expect(s).not.toContain('min-h-[4.5rem]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 — clinicalMiniBody 담당의 label+select 1줄 인라인
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 — 담당의 인라인 1줄', () => {
  test('label+select flex items-center gap-2 래퍼 + label 고정폭 + select flex-1', () => {
    const s = PANEL();
    // 인라인 래퍼가 clinical-mini-signing-doctor select 를 감싼다
    const block = s.slice(
      s.indexOf('AC-4: label+select 1줄 인라인'),
      s.indexOf('data-testid="clinical-mini-doctor-warning"'),
    );
    // INLINE-REFINE AC-4: flex-wrap 추가(좁은폭 wrap). 1줄 인라인 구조는 유지.
    expect(block).toContain('flex flex-wrap items-center gap-2');
    expect(block).toMatch(/<label className="w-16 shrink-0/);
    expect(block).toContain('flex-1 max-w-[280px]');
    expect(block).toContain('data-testid="clinical-mini-signing-doctor"');
  });

  test('회귀: embed select 가 옛 w-full(블록) 폭으로 되돌아가지 않음', () => {
    const s = PANEL();
    const block = s.slice(
      s.indexOf('AC-4: label+select 1줄 인라인'),
      s.indexOf('data-testid="clinical-mini-doctor-warning"'),
    );
    expect(block).not.toContain('w-full max-w-[280px]');
  });
});
