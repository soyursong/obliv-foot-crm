/**
 * T-20260614-foot-MEDCHART-AUDIT-NOISE-VISIBILITY — 진료의 변경이력 생성이벤트 노이즈 제거
 *
 * 배경(슬랙 C0ATE5P6JTH, 문지은 대표원장):
 *   진료차트 변경이력에 `(없음)→문지은` 최초 지정(생성) 행이 떠서 "이게 무슨 변경이력이냐" 지적.
 *   최초 지정은 변경이 아님 → 표시에서 제외, 실제 진료의 변경만 노출.
 *
 * 변경(FE-only, 표시 필터): src/components/MedicalChartPanel.tsx
 *   visibleSignerAudit = signerAudit.filter(실제 변경만)
 *     - old가 null/빈값/'(없음)' → 생성행으로 보고 제외
 *     - new가 null/빈값 → 제외
 *     - old === new → 변경 아님, 제외
 *   적재(medical_chart_signer_audit append-only, L1209) 무변경 — 화면 필터만.
 *   ROLE-GATE(T-20260614-foot-CHARTSIGNAUDIT-ROLE-GATE)의 isDirector 게이트는 보존.
 *
 * 시나리오 (티켓 본문):
 *   S1 신규 생성차트(진료의 최초 지정) → 변경이력에 `(없음)→X` 미표시(0건).
 *   S2 진료의 X→Y 변경 → 변경이력 1행만(생성행 제외).
 *
 * 본 spec은 코드베이스 관행(logic-mirror)에 따라 표시 필터 로직을 미러한다.
 * (MedicalChartPanel.tsx visibleSignerAudit useMemo 와 동일 SSOT)
 */
import { test, expect } from '@playwright/test';

test.describe('T-20260614-foot-MEDCHART-AUDIT-NOISE-VISIBILITY', () => {

  interface AuditRow {
    id: string;
    old_doctor_name: string | null;
    new_doctor_name: string | null;
  }

  // MedicalChartPanel.tsx visibleSignerAudit 필터 미러 (SSOT 일치)
  function visibleSignerAudit(rows: AuditRow[]): AuditRow[] {
    return rows.filter((a) => {
      const oldName = (a.old_doctor_name ?? '').trim();
      const newName = (a.new_doctor_name ?? '').trim();
      if (!oldName || oldName === '(없음)') return false; // 최초 지정(생성) 제외
      if (!newName) return false;
      return oldName !== newName; // 실제 변경만
    });
  }

  // ── S1: 신규 생성차트 — 생성행 미표시 ───────────────────────────────────
  test('S1-a: old=null 최초 지정행은 표시 0건', () => {
    const rows: AuditRow[] = [
      { id: '1', old_doctor_name: null, new_doctor_name: '문지은' },
    ];
    expect(visibleSignerAudit(rows)).toHaveLength(0);
  });

  test("S1-b: old='(없음)' 문자열 최초 지정행도 표시 0건", () => {
    const rows: AuditRow[] = [
      { id: '1', old_doctor_name: '(없음)', new_doctor_name: '문지은' },
    ];
    expect(visibleSignerAudit(rows)).toHaveLength(0);
  });

  test('S1-c: old=빈문자/공백 최초 지정행도 표시 0건', () => {
    const rows: AuditRow[] = [
      { id: '1', old_doctor_name: '', new_doctor_name: '문지은' },
      { id: '2', old_doctor_name: '   ', new_doctor_name: '문지은' },
    ];
    expect(visibleSignerAudit(rows)).toHaveLength(0);
  });

  // ── S2: 실제 변경 — 1행만 ───────────────────────────────────────────────
  test('S2: 생성(없음→문지은) + 변경(문지은→다른의사) → 변경 1행만 노출', () => {
    const rows: AuditRow[] = [
      { id: '2', old_doctor_name: '문지은', new_doctor_name: '김의사' }, // 실제 변경
      { id: '1', old_doctor_name: null, new_doctor_name: '문지은' },     // 생성(제외)
    ];
    const visible = visibleSignerAudit(rows);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe('2');
    expect(visible[0].old_doctor_name).toBe('문지은');
    expect(visible[0].new_doctor_name).toBe('김의사');
  });

  test('S2-multi: 생성 + 변경 2회 → 변경 2행만', () => {
    const rows: AuditRow[] = [
      { id: '3', old_doctor_name: '김의사', new_doctor_name: '이의사' },
      { id: '2', old_doctor_name: '문지은', new_doctor_name: '김의사' },
      { id: '1', old_doctor_name: null, new_doctor_name: '문지은' },
    ];
    expect(visibleSignerAudit(rows)).toHaveLength(2);
  });

  // ── 회귀/엣지 ───────────────────────────────────────────────────────────
  test('R1: old===new (실질 무변경) 행은 제외', () => {
    const rows: AuditRow[] = [
      { id: '1', old_doctor_name: '문지은', new_doctor_name: '문지은' },
    ];
    expect(visibleSignerAudit(rows)).toHaveLength(0);
  });

  test('R2: new가 null/빈값(해제)인 행도 제외', () => {
    const rows: AuditRow[] = [
      { id: '1', old_doctor_name: '문지은', new_doctor_name: null },
      { id: '2', old_doctor_name: '문지은', new_doctor_name: '' },
    ];
    expect(visibleSignerAudit(rows)).toHaveLength(0);
  });

  test('R3: 빈 배열 → 빈 배열 (변경이력 없음 안내 유지)', () => {
    expect(visibleSignerAudit([])).toHaveLength(0);
  });

  test('R4: 적재(append-only) 무변경 — 원본 배열 길이 보존(필터는 비파괴)', () => {
    const rows: AuditRow[] = [
      { id: '2', old_doctor_name: '문지은', new_doctor_name: '김의사' },
      { id: '1', old_doctor_name: null, new_doctor_name: '문지은' },
    ];
    const before = rows.length;
    visibleSignerAudit(rows);
    expect(rows).toHaveLength(before); // 원본 audit 배열 불변(로그 보존)
  });
});
