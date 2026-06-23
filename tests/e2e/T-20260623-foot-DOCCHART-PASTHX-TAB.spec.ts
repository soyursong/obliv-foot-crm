/**
 * T-20260623-foot-DOCCHART-PASTHX-TAB — 의사 진료차트 '과거력' 탭 신설
 *
 * 대상:
 *   - src/lib/pastHistory.ts            (순수 로직: 질문지 → (-/+) 자동 prefill + 표시 포맷)
 *   - src/components/doctor/PastHistoryTab.tsx   (탭 본체: 자동초안/편집/조회 + 영속화)
 *   - src/components/doctor/DoctorTreatmentPanel.tsx (4번째 탭 결선)
 *   - supabase/migrations/20260623180000_patient_past_history.sql (영속화 테이블 + RLS)
 *
 * playwright.config.ts `unit` 프로젝트(auth/page 불요) — 순수 함수 + 정적 소스 미러 가드.
 *
 * 시나리오(티켓 §현장 클릭 시나리오) → 가드 변환:
 *   1: 질문지(당뇨·혈압약·항암제) → 자동 초안 (+/+/-)·항암(+) + "미확정" 시각.
 *   2: 실장 (-)→(+) 토글 + 코멘트 → 확정/저장(append-only INSERT) → 재진입 보존·"확정".
 *   3: 의사 뷰 — 확정값 read-only(편집 불가).
 *   4: 질문지 없는 환자 — 전 라인 (-) 기본·수동·에러 0.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  computePastHxFromHealthQ,
  formatPastHxText,
  emptyPastHxLines,
  normalizePastHxLines,
  PAST_HX_ITEMS,
  HEALTHQ_PASTHX_MAP,
  type PastHxLines,
} from '../../src/lib/pastHistory';

const __dir = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(__dir, '../../', p), 'utf-8');
const pastHxSrc = read('src/lib/pastHistory.ts');
const tabSrc = read('src/components/doctor/PastHistoryTab.tsx');
const panelSrc = read('src/components/doctor/DoctorTreatmentPanel.tsx');
const opinionSrc = read('src/components/doctor/OpinionDocTab.tsx');
const migSrc = read('supabase/migrations/20260623180000_patient_past_history.sql');
const rollbackSrc = read('supabase/migrations/20260623180000_patient_past_history.rollback.sql');

// ── 시나리오 1: 질문지 → 자동 prefill ─────────────────────────────────────────
test.describe('시나리오 1 — 발건강 질문지 자동 prefill', () => {
  test('당뇨·혈압약·항암제 체크 → 혈압(+)·당뇨(+)·항암(+), 나머지(-)', () => {
    const lines = computePastHxFromHealthQ({
      medical_history: ['당뇨'],
      medications: ['혈압약', '항암제'],
    });
    expect(lines.bp).toBe('+');
    expect(lines.diabetes).toBe('+');
    expect(lines.chemo).toBe('+');
    expect(lines.hyperlipidemia).toBe('-');
    expect(lines.liver).toBe('-');
    expect(lines.renal).toBe('-');
    expect(lines.gait).toBe('-');
  });

  test('고지혈증 = medical_history OR medications(콜레스테롤약) 둘 다 도출', () => {
    expect(computePastHxFromHealthQ({ medical_history: ['고지혈증'] }).hyperlipidemia).toBe('+');
    expect(computePastHxFromHealthQ({ medications: ['콜레스테롤약'] }).hyperlipidemia).toBe('+');
  });

  test('간질환 도출', () => {
    expect(computePastHxFromHealthQ({ medical_history: ['간질환'] }).liver).toBe('+');
  });

  test('표시 포맷 = 현장 원문 2줄 구조', () => {
    const lines: PastHxLines = {
      bp: '-', diabetes: '+', hyperlipidemia: '-',
      liver: '-', renal: '-', chemo: '+', gait: '-',
    };
    expect(formatPastHxText(lines)).toBe(
      '혈압/당뇨/고지혈증 (-/+/-)\n간질환/신질환 (-/-) 항암/보행장애 (+/-)',
    );
  });
});

// ── 시나리오 4: 질문지 없는 환자 (회귀) ───────────────────────────────────────
test.describe('시나리오 4 — 질문지 없음 (수동 모드, 에러 0)', () => {
  test('null/undefined → 전 라인 (-) 기본', () => {
    for (const fd of [null, undefined, {}]) {
      const lines = computePastHxFromHealthQ(fd as Record<string, unknown> | null);
      expect(Object.values(lines).every((v) => v === '-')).toBe(true);
    }
  });

  test('emptyPastHxLines = 전 라인 (-)', () => {
    expect(formatPastHxText(emptyPastHxLines())).toBe(
      '혈압/당뇨/고지혈증 (-/-/-)\n간질환/신질환 (-/-) 항암/보행장애 (-/-)',
    );
  });

  test('비배열/이상값 입력에도 throw 없이 (-) 기본', () => {
    expect(() => computePastHxFromHealthQ({ medical_history: '당뇨' as unknown as string[] })).not.toThrow();
    expect(computePastHxFromHealthQ({ medical_history: 'x' as unknown as string[] }).diabetes).toBe('-');
  });

  test('신질환·보행장애는 자동 소스 없음(항상 수동) — §확인-2 b안', () => {
    expect(HEALTHQ_PASTHX_MAP.renal).toBeUndefined();
    expect(HEALTHQ_PASTHX_MAP.gait).toBeUndefined();
    expect(PAST_HX_ITEMS.find((i) => i.key === 'renal')?.autoSource).toBe(false);
    expect(PAST_HX_ITEMS.find((i) => i.key === 'gait')?.autoSource).toBe(false);
  });
});

// ── normalizePastHxLines (DB jsonb 안전 파싱) ─────────────────────────────────
test.describe('normalizePastHxLines — DB jsonb 정규화', () => {
  test('부분/누락 키 → 누락은 (-) 보강', () => {
    const n = normalizePastHxLines({ bp: '+', diabetes: '+' });
    expect(n.bp).toBe('+');
    expect(n.diabetes).toBe('+');
    expect(n.gait).toBe('-');
  });
  test('null/이상값 → 전 (-)', () => {
    expect(Object.values(normalizePastHxLines(null)).every((v) => v === '-')).toBe(true);
    expect(Object.values(normalizePastHxLines('x')).every((v) => v === '-')).toBe(true);
  });
});

// ── 라벨 drift 가드: HEALTHQ_PASTHX_MAP ↔ OpinionDocTab HEALTHQ_AUTOCHECK_MAP 동기화 ──
test.describe('라벨 동기화 가드 (질문지 라벨 drift 방지)', () => {
  test('과거력 매핑 라벨이 소견서 HEALTHQ_AUTOCHECK_MAP 과 동일', () => {
    // bp ← 혈압약, diabetes ← 당뇨, hyperlipidemia ← 고지혈증/콜레스테롤약, liver ← 간질환, chemo ← 항암제
    expect(opinionSrc).toContain("bp_med:              { medications: ['혈압약'] }");
    expect(opinionSrc).toContain("diabetes:            { medical_history: ['당뇨'] }");
    expect(opinionSrc).toContain("hyperlipidemia:      { medical_history: ['고지혈증'], medications: ['콜레스테롤약'] }");
    expect(opinionSrc).toContain("liver_disease:       { medical_history: ['간질환'] }");
    expect(opinionSrc).toContain("on_chemo:            { medications: ['항암제'] }");
    // 과거력 측도 동일 라벨 사용
    expect(HEALTHQ_PASTHX_MAP.bp?.medications).toContain('혈압약');
    expect(HEALTHQ_PASTHX_MAP.diabetes?.medical_history).toContain('당뇨');
    expect(HEALTHQ_PASTHX_MAP.hyperlipidemia?.medical_history).toContain('고지혈증');
    expect(HEALTHQ_PASTHX_MAP.hyperlipidemia?.medications).toContain('콜레스테롤약');
    expect(HEALTHQ_PASTHX_MAP.liver?.medical_history).toContain('간질환');
    expect(HEALTHQ_PASTHX_MAP.chemo?.medications).toContain('항암제');
  });
});

// ── 시나리오 2/3: 컴포넌트 결선·권한·영속화 (정적 소스 미러) ───────────────────
test.describe('PastHistoryTab — 편집/조회/영속화 결선', () => {
  test('health_q_results read-only 조회 (원본 수정 없음, AC-4)', () => {
    expect(tabSrc).toContain("from('health_q_results')");
    expect(tabSrc).toContain('form_data');
    expect(tabSrc).toContain('.maybeSingle()');
    // 질문지 테이블에 직접 write(update/insert/delete) 없음 (read-only) — 동일 statement 내 검사
    expect(tabSrc).not.toMatch(/from\('health_q_results'\)\s*\.(update|insert|delete)\(/);
    // 쓰기 대상은 patient_past_history 뿐 (질문지 테이블 아님)
    expect(tabSrc).not.toContain("health_q_results').insert");
    expect(tabSrc).not.toContain("health_q_results').update");
  });

  test('확정값 read = 최신 1건 (append-only, confirmed_at DESC LIMIT 1)', () => {
    expect(tabSrc).toContain("from('patient_past_history')");
    expect(tabSrc).toContain("order('confirmed_at', { ascending: false })");
    expect(tabSrc).toContain('.limit(1)');
  });

  test('저장 = INSERT(append-only, UPDATE 덮어쓰기 아님)', () => {
    expect(tabSrc).toMatch(/from\('patient_past_history'\)\s*\.insert\(/);
    expect(tabSrc).not.toMatch(/from\('patient_past_history'\)\s*\.update\(/);
  });

  test('미확정(확정 row 없음) → "질문지 자동초안 (미확정)" 시각 (AC-3 GUARD)', () => {
    expect(tabSrc).toContain('질문지 자동초안 (미확정)');
    expect(tabSrc).toContain('pasthx-status-draft');
    expect(tabSrc).toContain('pasthx-status-confirmed');
  });

  test('canEdit=false → 조회 전용 렌더 (의사 뷰, 편집 UI 없음)', () => {
    expect(tabSrc).toContain('if (!canEdit)');
    expect(tabSrc).toContain('pasthx-readonly');
    // 편집 모드에만 토글/저장 버튼
    expect(tabSrc).toContain('pasthx-confirm-btn');
    expect(tabSrc).toContain('pasthx-toggle-');
  });
});

// ── DoctorTreatmentPanel 결선 (4번째 탭) ──────────────────────────────────────
test.describe('DoctorTreatmentPanel — 과거력 탭 결선', () => {
  test('기존 3탭 보존 + 과거력 4번째 탭 추가 (회귀 0)', () => {
    expect(panelSrc).toContain('doctor-tab-charting');
    expect(panelSrc).toContain('doctor-tab-prescription');
    expect(panelSrc).toContain('doctor-tab-document');
    expect(panelSrc).toContain('doctor-tab-pasthx');
    // 4칸 그리드로 확장
    expect(panelSrc).toContain('grid grid-cols-4');
  });

  test('PastHistoryTab 결선 + customer_id/clinic_id 주입', () => {
    expect(panelSrc).toContain('import PastHistoryTab');
    expect(panelSrc).toContain('<PastHistoryTab');
    expect(panelSrc).toContain('customerId={fields?.customer_id ?? null}');
    expect(panelSrc).toContain('canEdit={canEditPastHx}');
    // check_ins 조회에 customer_id/clinic_id 포함
    expect(panelSrc).toContain('id, customer_id, clinic_id, doctor_note');
  });

  test('편집 권한 = manager·director·admin (§확인-3 a)', () => {
    expect(panelSrc).toContain('canEditPastHx');
    expect(panelSrc).toContain("profile?.role === 'manager'");
    expect(panelSrc).toContain("profile?.role === 'director'");
  });
});

// ── 마이그레이션 가드 (ADDITIVE + RLS + append-only) ──────────────────────────
test.describe('migration — patient_past_history (ADDITIVE·RLS·audit)', () => {
  test('신규 테이블 + FK = customer_id REFERENCES customers(id) (★patient_id 아님)', () => {
    expect(migSrc).toContain('CREATE TABLE IF NOT EXISTS patient_past_history');
    expect(migSrc).toContain('customer_id  uuid        NOT NULL REFERENCES customers(id)');
    expect(migSrc).not.toContain('patient_id');
  });

  test('clinic_id FK + RLS ENABLE + clinic isolation 정책', () => {
    expect(migSrc).toContain('clinic_id    uuid        NOT NULL REFERENCES clinics(id)');
    expect(migSrc).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migSrc).toContain('current_user_clinic_id()');
    expect(migSrc).toContain('clinic_isolation_pph_select');
    expect(migSrc).toContain('clinic_isolation_pph_insert');
  });

  test('append-only — UPDATE 정책 미부여(재확정=신규 row), DELETE=본인 정정만', () => {
    expect(migSrc).not.toMatch(/CREATE POLICY[^;]*FOR UPDATE/);
    expect(migSrc).toContain('own_delete_pph');
    expect(migSrc).toContain('confirmed_by = auth.uid()');
  });

  test('ADDITIVE — 기존 테이블 변경/DROP 없음', () => {
    expect(migSrc).not.toMatch(/ALTER TABLE (?!patient_past_history)/);
    expect(migSrc).not.toContain('DROP TABLE');
  });

  test('롤백 = 신규 테이블만 DROP (데이터 손실 0)', () => {
    expect(rollbackSrc).toContain('DROP TABLE IF EXISTS patient_past_history');
  });
});
