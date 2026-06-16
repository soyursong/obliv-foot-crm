/**
 * E2E spec — T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX (문지은 대표원장)
 * 진료알림판(DoctorCallDashboard) 3종 표시·레이아웃·반영타이밍 보정. 데이터 CRUD/필드매핑 불변.
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH spec 컨벤션 동일(라이브 DB 비의존, className/구조 패턴 정밀 검증).
 *
 * AC-1  별도 '경과시간(시간)' 칼럼 제거 → ✋ 옆 "+N분" 인라인 + 30분↑ 빨간색(계산 로직 cde6850 재사용, 표시위치만 이동)
 * AC-2  인라인 임상경과 패널 full-width → 50% + 오른쪽 끝 정렬 + 내부 overflow truncate
 * AC-3  인라인 임상경과 저장 후 미리보기 칼럼 즉시 반영(onSaved → refetchClinical 트리거)
 *
 * ⚠ GUARD(회귀 금지):
 *   · ✋ ack-only 동작(SHAKE-ACK-NOT-COMPLETE d913b1a) — 손 핸들러는 ack write 만, 완료/상태전이 미결합.
 *   · 임상경과 인라인 저장경로(CLINICAL-INLINE-REFINE) textarea 확대·담당의 one-row — MedicalChartPanel 내부 미접촉.
 *   · 처방게이트(QUICKRX-INCLINIC-GATE)·11FIX 미리보기·진료완료 명시 버튼(TreatmentCompleteButton) 보존.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 경과시간 칼럼 제거 + ✋ 옆 "+N분" 인라인 + 30분↑ 빨간색
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 — 경과시간 칼럼 제거 / ✋ 옆 +N분 / 30분↑ red', () => {
  test('두 테이블 모두 8칼럼(시간 칼럼 제거) — COLSPAN 상수', () => {
    const s = DASH();
    expect(s).toContain('const DOCDASH_COLSPAN = 8;');
    expect(s).toContain('const DOCDASH_COMPLETED_COLSPAN = 8;');
    // 9칼럼 잔재 금지.
    expect(s).not.toContain('const DOCDASH_COLSPAN = 9;');
    expect(s).not.toContain('const DOCDASH_COMPLETED_COLSPAN = 9;');
  });

  test("thead 에 '시간' 칼럼 헤더 없음 — 마지막 칼럼은 임상경과", () => {
    const s = DASH();
    // '시간' th 가 더 이상 존재하지 않음(별도 칼럼 폐지).
    expect(s).not.toContain('<th className="px-1.5 py-1">시간</th>');
    // 임상경과 th 는 양 테이블에 존재(마지막 칼럼).
    const clinicalTh = s.match(/<th className="px-1\.5 py-1">임상경과<\/th>/g) ?? [];
    expect(clinicalTh.length).toBe(2);
  });

  test('colgroup — 8칼럼, w-[5%] 시간 col 제거, 임상경과 37%로 흡수', () => {
    const s = DASH();
    // 시간 칼럼(5%) 제거.
    expect(s).not.toContain('<col className="w-[5%]" />');
    // 해방 5%p → 임상경과 32→37 (양 테이블 동일, 2회).
    const w37 = s.match(/<col className="w-\[37%\]" \/>/g) ?? [];
    expect(w37.length).toBe(2);
  });

  test('완료 테이블 빈 placeholder 셀/헤더 제거', () => {
    const s = DASH();
    expect(s).not.toContain('doctor-completed-elapsed-empty');
  });

  test('"+N분" 은 상태 셀(✋ 옆) 인라인으로 이전 — doctor-call-elapsed span 1개', () => {
    const s = DASH();
    // 별도 '시간' td 안의 elapsed 표기는 사라지고, 상태 셀의 인라인 span 1곳만 남음.
    const elapsedTestid = s.match(/data-testid="doctor-call-elapsed"/g) ?? [];
    expect(elapsedTestid.length).toBe(1);
    // 계산 로직(cde6850) 재사용 — elapsedMinutes/formatElapsedPlus 유지.
    expect(s).toContain('const elapsedMin = elapsedMinutes(getCallTime(checkIn));');
    expect(s).toContain('const elapsed = formatElapsedPlus(elapsedMin);');
  });

  test('30분 이상 빨간색 분기', () => {
    const s = DASH();
    expect(s).toContain("elapsedMin >= 30 ? 'font-semibold text-red-500' : 'text-muted-foreground'");
  });

  test('GUARD — ✋ ack-only(SHAKE-ACK-NOT-COMPLETE)·진료완료 명시버튼 보존', () => {
    const s = DASH();
    // 진료완료 전이는 손이 아니라 명시 버튼에서만.
    expect(s).toContain('<TreatmentCompleteButton');
    // 손 핸들러는 ack write(recordAck)만 — 완료 전이 미결합(별개 신호 주석 보존).
    expect(s).toContain('recordAck');
    expect(s).toContain('SHAKEHAND-NO-COMPLETE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 인라인 임상경과 패널 50% + 오른쪽 끝 정렬 + overflow truncate
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 — 인라인 임상경과 패널 width 50% / right-aligned', () => {
  test('대기·완료 인라인 패널 모두 ml-auto w-1/2 overflow-hidden 래퍼', () => {
    const s = DASH();
    const half = s.match(/className="ml-auto w-1\/2 overflow-hidden"/g) ?? [];
    expect(half.length).toBe(2); // 대기 + 완료
    expect(s).toContain('data-testid="doctor-call-chart-inline-half"');
    expect(s).toContain('data-testid="doctor-completed-chart-inline-half"');
  });

  test('GUARD — MedicalChartPanel singleLine clinical 내부 props 불변(textarea 확대/담당의 one-row 미접촉)', () => {
    const s = DASH();
    // 인라인 패널은 여전히 variant="clinical" singleLine — 내부 구현 미손상.
    expect(s).toContain('variant="clinical"');
    expect(s).toContain('singleLine');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — 인라인 임상경과 저장 후 미리보기 즉시 반영
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 — 임상경과 저장 후 미리보기 즉시 반영', () => {
  test('미리보기 소스(useCompletedClinicalProgress)에서 refetch 노출', () => {
    const s = DASH();
    // 진단: 미리보기 칼럼 갱신경로 = react-query useCompletedClinicalProgress(refetchInterval 30s, 비-realtime).
    //   저장 직후 30s 대기 없이 즉시 반영하려면 onSaved → 해당 쿼리 refetch 필요.
    expect(s).toContain('const { data: clinicalMap, refetch: refetchClinical } = useCompletedClinicalProgress(clinicId);');
  });

  test('두 행 컴포넌트에 onClinicalSaved 전달 + 저장 시 호출', () => {
    // ⚠ SUPERSEDED by T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-POLISH AC-3:
    //   3FIX 는 refetch-only 였으나 POLISH 가 optimistic 갱신으로 강화 — 배선이 (saved) 인자 전달형으로 바뀜.
    //   본 테스트는 POLISH 의 신 배선에 맞춰 갱신(stale fail 방지). 0지연 검증 본체는 POLISH spec 참조.
    const s = DASH();
    // 부모 → 행 prop 전달: 저장 본문으로 optimistic 갱신(대기 + 완료 = 2회).
    const passed = s.match(/onClinicalSaved=\{\(saved\) => applyClinicalOptimistic\(ci\.customer_id, saved\)\}/g) ?? [];
    expect(passed.length).toBe(2);
    // onSaved 에서 패널 닫기 + 저장 본문 전달(대기 + 완료 = 2회).
    const onSaved = s.match(/onSaved=\{\(saved\) => \{ setShowClinical\(false\); onClinicalSaved\?\.\(saved\); \}\}/g) ?? [];
    expect(onSaved.length).toBe(2);
  });
});
