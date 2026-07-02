/**
 * E2E spec — T-20260702-foot-MEDCHART-PROGRESS-EMPTYSTATE-DUMMY (풋센터 원장, P1)
 * 진료차트 > 진료경과 empty state 더미 잔류 제거 — 진료기록 0건 환자 첫 진입 시 폼 초기값 더미 0.
 *
 * 배경: 前 T-20260702-foot-MEDCHART-PROGRESS-DUMMY-UNHARDCODE(commit 0395a395)가 DUMMY_CHARTS 상수
 *       배열(리스트/렌더 경로)은 제거했으나, __dummy__ id 기반 죽은 더미 코드경로(저장/삭제 가드,
 *       타임라인 더미 배지·노란 아웃라인, 폼 타이틀 [더미] 라벨, 저장버튼 '더미 데이터 — 저장 불가')가
 *       폼/렌더 코드경로에 잔류. DUMMY_CHARTS 폐지 이후 __dummy__ id 차트는 생성 불가 = 전부 죽은 경로.
 * 수정: 진료경과 폼 초기값은 이미 빈 문자열(setFormClinical('')) — AC1 충족 상태 유지.
 *       잔류 __dummy__ 코드경로를 FE에서 완전 제거(잔존 0). 저장/쓰기 로직(upsert·진료의 NOT NULL) 무변경.
 *
 * 본 스펙은 이 레포의 진료차트 검증 컨벤션(소스 정적 검증 + 회귀 가드)을 따른다.
 *
 * AC 매핑:
 *   AC-1 진료기록 0건 환자 첫 진입 시 진료경과 폼이 빈 상태로 시작(더미 텍스트 0).
 *   AC-2 저장된 진료기록이 있는 환자는 clinical_progress 값 정상 로드(前 UNHARDCODE 무회귀).
 *   AC-3 더미/샘플 텍스트·__dummy__ 코드경로가 폼 초기값 코드경로에서 완전 제거(잔존 0).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const PANEL = () => SRC('components/MedicalChartPanel.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 진료기록 0건 환자: 폼 초기값 빈 상태(더미 텍스트 0)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 신규/미등록 환자 폼 초기값 빈 상태', () => {
  test('신규 작성(resetForm(null)) 시 formClinical 초기값이 빈 문자열', () => {
    const src = PANEL();
    // resetForm의 else(chart 없음=신규) 분기가 formClinical을 빈 문자열로 초기화.
    expect(src).toMatch(/setFormClinical\(''\)/);
  });

  test('formClinical useState 기본값이 빈 문자열(더미 상수 아님)', () => {
    const src = PANEL();
    expect(src).toMatch(/const \[formClinical, setFormClinical\] = useState\(''\)/);
  });

  test('빈 상태(isEmptyState)는 안내 placeholder만 — 더미 텍스트 아님', () => {
    const src = PANEL();
    expect(src).toContain('const isEmptyState');
    expect(src).toContain('data-testid="medchart-empty-state"');
    expect(src).toContain('아직 진료 기록이 없습니다');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 저장 데이터 있는 환자 무회귀 (前 UNHARDCODE fix 보존)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 저장 데이터 있는 환자 무회귀', () => {
  test('선택 차트 복원 시 clinical_progress 값 로드', () => {
    const src = PANEL();
    expect(src).toContain('setFormClinical(chart.clinical_progress');
  });

  test('진료경과 렌더는 chart.clinical_progress 바인딩 유지', () => {
    const src = PANEL();
    expect(src).toContain('chart.clinical_progress');
  });

  test('저장 페이로드(clinical_progress upsert) 무변경 — 쓰기 회귀 가드', () => {
    const src = PANEL();
    expect(src).toContain('clinical_progress: formClinical.trim() || null');
  });

  test('진료의 NOT NULL 강제(의료법) 저장 게이트 보존', () => {
    const src = PANEL();
    expect(src).toContain('formSigningDoctorId');
    expect(src).toContain('진료의가 필요합니다');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — 더미/샘플 상수·__dummy__ 코드경로 완전 제거(잔존 0)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 더미 코드경로 완전 제거', () => {
  test('__dummy__ id 가드/생성 코드가 소스에 부재(주석 제외)', () => {
    const src = PANEL();
    // 주석(설명)을 제외한 실행 코드에서 __dummy__ 참조 0.
    const codeOnly = src
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
    expect(codeOnly).not.toContain('__dummy__');
    // __dummy__ startsWith 가드가 전량 제거됐는지 — startsWith('__dummy__') 패턴 부재로 확인.
    expect(src).not.toMatch(/startsWith\(['"`]__dummy__/);
  });

  test('isDummyEntry / isDummyMode 상태 잔존 0', () => {
    const src = PANEL();
    expect(src).not.toContain('isDummyEntry');
    expect(src).not.toContain('isDummyMode');
  });

  test('DUMMY_CHARTS 상수·더미 샘플 고정 텍스트 잔존 0(前 UNHARDCODE 무회귀)', () => {
    const src = PANEL();
    expect(src).not.toContain('DUMMY_CHARTS');
    expect(src).not.toContain('더미 샘플');
    expect(src).not.toMatch(/id:\s*['"`]__dummy__/);
  });

  test('더미 전용 UI 문구(배지/저장불가) 잔존 0', () => {
    const src = PANEL();
    expect(src).not.toContain('더미 데이터 — 저장 불가');
    expect(src).not.toContain('더미 데이터는 저장할 수 없습니다');
    expect(src).not.toContain('더미 데이터는 삭제할 수 없습니다');
    expect(src).not.toContain("'[더미] '");
  });
});
