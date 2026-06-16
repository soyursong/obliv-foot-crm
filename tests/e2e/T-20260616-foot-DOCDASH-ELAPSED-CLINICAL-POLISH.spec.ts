/**
 * E2E spec — T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-POLISH (문지은 대표원장, 3FIX 후속 폴리시)
 * 진료알림판(DoctorCallDashboard) 3종 폴리시. 데이터 CRUD/스키마 불변 — 표시·레이아웃·갱신타이밍만.
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH spec 컨벤션 동일(라이브 DB 비의존, 구조/배선 패턴 정밀 검증).
 *
 * 배경: 3FIX(a1a44b10)가 AC-1(✋옆 +N분)·AC-2(인라인 50% 우측)·AC-3(refetch 트리거)를 이미 반영.
 *   POLISH 는 그 위에서 — AC-1·AC-2 는 무회귀 GUARD 로 고정, AC-3 는 refetch 왕복 동안 남던
 *   체감 지연을 optimistic 미리보기 갱신으로 0지연화(POLISH 의 핵심 델타).
 *
 * AC-1  경과시간 칼럼 제거 → ✋ 옆 "+N분"(30분↑ 빨강) — 3FIX 유지 GUARD (✋ ack-only 불변)
 * AC-2  인라인 임상경과 패널 ≈50% + 우측 정렬 + 내부 overflow 방지 — 3FIX 유지 GUARD (REFINE 무회귀)
 * AC-3  임상경과 저장 후 미리보기 즉시 반영 — optimistic 갱신 + 백그라운드 refetch 정합 (지연 해소)
 *
 * ⚠ GUARD(회귀 금지):
 *   · ✋ 첫탭 = ack-only(SHAKE-ACK-NOT-COMPLETE d913b1a) — 완료/색 전이 미결합.
 *   · CLINICAL-INLINE-REFINE(7195e5b) textarea 확대·담당의 one-row — MedicalChartPanel 내부 미접촉.
 *   · '-' 클릭 → 토글(NAME-EMOJI-CLINICAL-3FIX 5121edbc) 무회귀.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');
const PANEL = () => SRC('components/MedicalChartPanel.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 (AC-1) — 경과시간이 ✋ 옆 "+N분"으로만 노출, 별도 칼럼 없음, 30분↑ 빨강
//   현장: 진료대기 명단을 보며 "이 환자 몇 분째?"를 손(✋) 바로 옆에서 즉시 확인.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 GUARD — 경과시간 칼럼 제거 / ✋ 옆 +N분 / 30분↑ red', () => {
  test('두 테이블 모두 8칼럼(별도 시간 칼럼 없음)', () => {
    const s = DASH();
    expect(s).toContain('const DOCDASH_COLSPAN = 8;');
    expect(s).toContain('const DOCDASH_COMPLETED_COLSPAN = 8;');
    expect(s).not.toContain('const DOCDASH_COLSPAN = 9;');
  });

  test("thead 에 '시간' 칼럼 헤더 없음", () => {
    const s = DASH();
    expect(s).not.toContain('<th className="px-1.5 py-1">시간</th>');
  });

  test('"+N분" 은 상태 셀(✋ 옆) 인라인 1곳 + 30분↑ 빨강', () => {
    const s = DASH();
    const elapsedTestid = s.match(/data-testid="doctor-call-elapsed"/g) ?? [];
    expect(elapsedTestid.length).toBe(1);
    // WAITELAPSED-POLISH 계산 체인 재사용(표시 위치만 ✋ 옆).
    expect(s).toContain('const elapsedMin = elapsedMinutes(getCallTime(checkIn));');
    expect(s).toContain('const elapsed = formatElapsedPlus(elapsedMin);');
    expect(s).toContain("elapsedMin >= 30 ? 'font-semibold text-red-500' : 'text-muted-foreground'");
  });

  test('GUARD — ✋ 첫탭 ack-only(SHAKE-ACK-NOT-COMPLETE) + 진료완료 명시버튼 분리 보존', () => {
    const s = DASH();
    expect(s).toContain('<TreatmentCompleteButton');
    expect(s).toContain('recordAck');
    expect(s).toContain('SHAKEHAND-NO-COMPLETE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 (AC-2) — 임상경과 인라인 편집 패널이 화면 절반(우측)만 차지, 내부 overflow 안전
//   현장: '-' 또는 📝 로 임상경과 작성창을 열어도 행 전체를 덮지 않고 우측 절반에 단정히.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 GUARD — 인라인 임상경과 패널 ≈50% 우측 정렬 + overflow 방지', () => {
  test('대기·완료 인라인 패널 모두 ml-auto w-1/2 overflow-hidden 래퍼', () => {
    const s = DASH();
    const half = s.match(/className="ml-auto w-1\/2 overflow-hidden"/g) ?? [];
    expect(half.length).toBe(2);
    expect(s).toContain('data-testid="doctor-call-chart-inline-half"');
    expect(s).toContain('data-testid="doctor-completed-chart-inline-half"');
  });

  test('GUARD — CLINICAL-INLINE-REFINE 내부(variant clinical / singleLine) 미접촉', () => {
    const s = DASH();
    expect(s).toContain('variant="clinical"');
    expect(s).toContain('singleLine');
  });

  test("GUARD — 빈값 '-' 클릭 → 임상경과 토글(NAME-EMOJI-CLINICAL-3FIX) 무회귀", () => {
    const s = DASH();
    // 빈값 셀 클릭 = showClinical 열기(작성 진입). 대기 + 완료 = 2곳.
    const emptyBtn = s.match(/checkIn\.customer_id && setShowClinical\(true\)/g) ?? [];
    expect(emptyBtn.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 (AC-3) — 임상경과 저장 즉시 미리보기 칼럼에 반영(체감 지연 0)
//   현장: 작성창에서 저장을 누르는 순간 명단의 임상경과 미리보기가 곧바로 새 내용으로.
//   진단: 미리보기 소스는 useCompletedClinicalProgress(refetchInterval 30s, 非-realtime).
//     3FIX 의 refetch-only 는 Supabase 왕복 동안 옛 값이 남아 체감 지연 존재 →
//     POLISH 는 저장 본문으로 캐시(queryKey)를 optimistic 갱신해 0지연, refetch 는 백그라운드 정합.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 — 임상경과 저장 후 미리보기 즉시 반영(optimistic 0지연)', () => {
  test('미리보기 소스 hook 에서 refetch 노출(진단 근거 보존)', () => {
    const s = DASH();
    expect(s).toContain('const { data: clinicalMap, refetch: refetchClinical } = useCompletedClinicalProgress(clinicId);');
  });

  test('optimistic 갱신 헬퍼 — queryKey 캐시 즉시 set + 백그라운드 refetch', () => {
    const s = DASH();
    // react-query 캐시 직접 갱신 위해 useQueryClient 사용.
    expect(s).toContain('import { useQuery, useQueryClient }');
    expect(s).toContain('const queryClient = useQueryClient();');
    expect(s).toContain('const applyClinicalOptimistic = useCallback(');
    // 미리보기 맵(queryKey)을 저장 본문으로 즉시 set.
    expect(s).toContain("queryClient.setQueryData<Map<string, string>>(");
    expect(s).toContain("['docdash_completed_clinical', clinicId],");
    // 빈 본문이면 삭제(저장으로 비운 경우), 백그라운드 정합 refetch.
    expect(s).toContain('else next.delete(customerId);');
    expect(s).toContain('void refetchClinical();');
  });

  test('두 행 모두 저장 본문(saved) 을 부모 optimistic 헬퍼로 전달', () => {
    const s = DASH();
    const passed = s.match(/onClinicalSaved=\{\(saved\) => applyClinicalOptimistic\(ci\.customer_id, saved\)\}/g) ?? [];
    expect(passed.length).toBe(2);
    // 행 → 패널 onSaved 에서 저장 본문 전달(대기 + 완료 = 2회).
    const onSaved = s.match(/onSaved=\{\(saved\) => \{ setShowClinical\(false\); onClinicalSaved\?\.\(saved\); \}\}/g) ?? [];
    expect(onSaved.length).toBe(2);
  });

  test('MedicalChartPanel onSaved 가 저장된 임상경과 본문을 인자로 전달(하위호환 옵셔널)', () => {
    const p = PANEL();
    expect(p).toContain('onSaved?: (savedClinical?: string) => void;');
    expect(p).toContain('onSaved?.(formClinical.trim() || undefined);');
  });
});
