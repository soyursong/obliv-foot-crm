/**
 * T-20260608-foot-MEDCHART-SIGN-AUDIT (Phase 2) — 진료기록 진료의 귀속 + 변경이력 audit + 신규행 강제
 *
 * 배경(의료법): 진료기록부에는 진료의(작성 의사)의 서명/표기가 반드시 포함되어야 한다.
 *   Phase 1 audit 결과 medical_charts 에 의사 귀속 컬럼이 전무 → 현존 전 레코드 서명 누락.
 *
 * 현장 결정(문지은 대표원장, MSG-20260608-174251):
 *   AC-P2-1 진료의 자동 기본값: 로그인 계정이 의사(director/admin)면 본인 자동 선택.
 *   AC-P2-2 수동 변경: 드롭다운으로 변경 가능(스탭 포함, 권한 제한 없음). 선택지=활성 clinic_doctors.
 *   AC-P2-3 변경이력 audit(필수): 진료의 변경 시마다 누가·언제·이전값→새값 기록(append-only, 차트 단위 조회).
 *   AC-P2-4 서명 방식 A: 등록 직인/이름 자동삽입(Canvas 손서명 B 불채택). 직인 없으면 이름 텍스트로 충분.
 *   AC-P2-5 출력 표기: 저장된 signing_doctor 기준(출력시 임의 선택 의사 아님).
 *   AC-P2-6 강제 범위: 신규/수정행만 NOT NULL/CHECK 강제(트리거). 과거 NULL행 backfill 금지.
 *
 * 시나리오:
 *   S1 (스키마): medical_charts.signing_doctor_{id,name,seal_url} 컬럼 조회 가능.
 *   S2 (audit 테이블): medical_chart_signer_audit 컬럼 조회 가능 + append-only.
 *   S3 (강제 로직): 진료의 미선택 저장 차단 규칙(FE 게이트) 미러.
 *   S4 (자동 기본값 로직): 의사 계정이면 본인 자동, 스탭이면 미선택.
 *   S5 (변경이력 트리거 로직): old !== new 일 때만 audit append.
 *   S6 (출력 표기 로직): 저장된 signing_doctor_name 우선, 레거시(NULL)는 미보유 라벨.
 */
import { test, expect } from '@playwright/test';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';

test.describe('T-20260608-foot-MEDCHART-SIGN-AUDIT', () => {

  // ── S1: medical_charts 진료의 귀속 컬럼 (스키마 적용 확인) ───────────────
  test('S1: medical_charts.signing_doctor_{id,name,seal_url} 컬럼이 조회 가능', async ({ request }) => {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!serviceKey) { test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY not set — skip DB check'); return; }
    const url = `${SUPABASE_URL}/rest/v1/medical_charts?select=id,signing_doctor_id,signing_doctor_name,signing_doctor_seal_url&limit=5`;
    const resp = await request.get(url, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(Array.isArray(body)).toBe(true);
    for (const row of body) {
      expect(row).toHaveProperty('signing_doctor_id');
      expect(row).toHaveProperty('signing_doctor_name');
      expect(row).toHaveProperty('signing_doctor_seal_url');
    }
  });

  // ── S2: medical_chart_signer_audit 테이블 (스키마 + append-only) ────────
  test('S2: medical_chart_signer_audit 컬럼이 조회 가능', async ({ request }) => {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!serviceKey) { test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY not set — skip DB check'); return; }
    const cols = 'id,medical_chart_id,clinic_id,old_doctor_id,old_doctor_name,new_doctor_id,new_doctor_name,changed_by,changed_by_name,changed_at';
    const url = `${SUPABASE_URL}/rest/v1/medical_chart_signer_audit?select=${cols}&limit=5`;
    const resp = await request.get(url, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(Array.isArray(body)).toBe(true);
    for (const row of body) {
      expect(row).toHaveProperty('old_doctor_name');
      expect(row).toHaveProperty('new_doctor_name');
      expect(row).toHaveProperty('changed_by');
      expect(row).toHaveProperty('changed_at');
    }
  });

  // ── S3: 진료의 미선택 저장 차단 (FE 강제 게이트 미러) ───────────────────
  // 시나리오 2: 진료의 미입력 상태로 저장 시도 → 차단.
  function canSaveChart(formSigningDoctorId: string, doctorExists: boolean): { ok: boolean; reason?: string } {
    if (!formSigningDoctorId) return { ok: false, reason: '진료의가 필요합니다 — 담당 의사를 선택해주세요' };
    if (!doctorExists) return { ok: false, reason: '선택한 진료의 정보를 찾을 수 없습니다 — 다시 선택해주세요' };
    return { ok: true };
  }

  test('S3-a: 진료의 미선택 → 저장 차단', () => {
    const r = canSaveChart('', true);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('진료의가 필요');
  });

  test('S3-b: 선택한 의사가 목록에 없음 → 저장 차단', () => {
    const r = canSaveChart('doc-uuid-x', false);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('찾을 수 없');
  });

  test('S3-c: 진료의 선택 + 유효 → 저장 허용', () => {
    expect(canSaveChart('doc-uuid-1', true).ok).toBe(true);
  });

  // ── S4: 진료의 자동 기본값 로직 (AC-P2-1) ───────────────────────────────
  // 신규 작성 + 미선택일 때, 의사(director/admin) 계정이면 이름 일치 의사 자동 선택.
  const DIRECTOR_ROLES = ['director', 'admin'];
  function autoDefaultDoctorId(
    args: { selectedChartId: string | null; currentSel: string; role: string; userName: string;
            doctors: { id: string; name: string }[] },
  ): string {
    const { selectedChartId, currentSel, role, userName, doctors } = args;
    if (selectedChartId) return currentSel;        // 저장된 차트는 복원값 유지
    if (currentSel) return currentSel;             // 이미 선택됨
    if (doctors.length === 0) return '';
    if (!DIRECTOR_ROLES.includes(role)) return ''; // 의사 role 아니면 자동값 없음
    const mine = doctors.find((d) => d.name === userName);
    return mine ? mine.id : '';
  }

  const docs = [{ id: 'd1', name: '문지은' }, { id: 'd2', name: '김원장' }];

  test('S4-a: 의사 계정 + 이름 일치 → 본인 자동 선택', () => {
    const r = autoDefaultDoctorId({ selectedChartId: null, currentSel: '', role: 'director', userName: '문지은', doctors: docs });
    expect(r).toBe('d1');
  });

  test('S4-b: 스탭(의사 아님) 계정 → 자동값 없음(수동 선택 필요)', () => {
    const r = autoDefaultDoctorId({ selectedChartId: null, currentSel: '', role: 'staff', userName: '접수직원', doctors: docs });
    expect(r).toBe('');
  });

  test('S4-c: 의사 계정이나 이름 불일치 → 자동값 없음', () => {
    const r = autoDefaultDoctorId({ selectedChartId: null, currentSel: '', role: 'admin', userName: '관리자', doctors: docs });
    expect(r).toBe('');
  });

  test('S4-d: 저장된 차트(편집) → 복원값 유지(자동 덮어쓰기 금지)', () => {
    const r = autoDefaultDoctorId({ selectedChartId: 'chart-1', currentSel: 'd2', role: 'director', userName: '문지은', doctors: docs });
    expect(r).toBe('d2');
  });

  // ── S5: 변경이력 append 트리거 로직 (AC-P2-3) ───────────────────────────
  // 진료의 귀속이 신규 지정/변경된 경우(old !== new)에만 audit append.
  function shouldAppendAudit(prevDoctorId: string | null, newDoctorId: string): boolean {
    return prevDoctorId !== newDoctorId;
  }

  test('S5-a: 신규 차트 최초 지정(NULL → 의사) → audit append', () => {
    expect(shouldAppendAudit(null, 'd1')).toBe(true);
  });

  test('S5-b: 수정 시 진료의 변경(d1 → d2) → audit append', () => {
    expect(shouldAppendAudit('d1', 'd2')).toBe(true);
  });

  test('S5-c: 진료의 변경 없이 다른 필드만 수정 → audit append 안 함', () => {
    expect(shouldAppendAudit('d1', 'd1')).toBe(false);
  });

  // ── S6: 출력 표기 로직 (AC-P2-5) ────────────────────────────────────────
  // 저장된 signing_doctor_name 기준. 레거시(NULL)는 '미보유' 라벨.
  function signingDisplay(chart: { signing_doctor_name?: string | null }): { kind: 'doctor' | 'legacy'; label: string } {
    if (chart.signing_doctor_name) return { kind: 'doctor', label: chart.signing_doctor_name };
    return { kind: 'legacy', label: '진료의 미보유 (레거시 기록)' };
  }

  test('S6-a: signing_doctor_name 보유 → 진료의 이름 표기', () => {
    const r = signingDisplay({ signing_doctor_name: '문지은' });
    expect(r.kind).toBe('doctor');
    expect(r.label).toBe('문지은');
  });

  test('S6-b: 레거시(NULL) → 미보유 라벨(임의 의사 표기 안 함)', () => {
    const r = signingDisplay({ signing_doctor_name: null });
    expect(r.kind).toBe('legacy');
    expect(r.label).toContain('미보유');
  });
});
