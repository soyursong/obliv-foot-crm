/**
 * E2E spec — T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE
 * 진료부 통합 대시보드(DoctorCallDashboard) A안+B안 동시 적용('둘다해줘', 문지은 대표원장).
 *
 *   A안 (테이블뷰): 환자 목록 → 테이블뷰. 행=환자, 열=이름|방|처방|상태.
 *                   기존 카드/행(li flex) 레이아웃을 압축 테이블(table/tr/td)로 재구성.
 *   B안 (임상경과 컴팩트화): MedicalChartPanel variant='clinical' 인라인 tall 아코디언(textarea rows 9)
 *                   → '한 줄 텍스트 인풋'(singleLine 모드)으로 축소.
 *   저장경로: clinical_progress 컬럼 그대로 재사용. DB 변경 없음. 저장 로직(handleSave) 비간섭.
 *
 * 회귀 금지(REDEFINITION_RISK HIGH — DOCDASH 동일 surface churn):
 *   - 방이름 표시 유지(reporter 긍정 확인됨) → 테이블 '방' 열에 표출.
 *   - STATUS-SPLIT(checkInFlag→QuickRxBar) / LABEL-RX-REFINE / CLINICAL-UX-REFINE 무회귀.
 *   - CLINICAL-SAVE-FAIL(같은 저장경로)과 충돌 금지 — clinical_progress write 경로(handleSave) 단 1곳 유지.
 *
 * 현장 클릭 시나리오 → AC (티켓 §7):
 *   AC-1: 테이블뷰 정상 표시(행=환자, 이름|방|처방|상태, 방이름 회귀 없음).
 *   AC-2: 임상경과 한 줄 입력+저장(tall 아코디언 없음, clinical_progress 저장, 새로고침 유지).
 *   AC-3: 엣지 — 빈 입력/진료의 미선택 저장 시 NOT NULL 가드 보존.
 *
 * 스타일: 형제 티켓(CLINICAL-SAVE-FAIL)과 동일 — 소스 정적 배선 가드 + 순수 판정 모사.
 *   auth/DB 비의존.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');
const PANEL = () => SRC('components/MedicalChartPanel.tsx');
/** singleLine 본문 영역만 잘라 반환(속성 순서 무관 검사용). */
function singleLineRegion(): string {
  const src = PANEL();
  const start = src.indexOf('const clinicalSingleLineBody');
  const end = src.indexOf("// T-20260609-foot-DOCDASH-CHART-UX item1 (AC1-1): embed clinical");
  expect(start, 'clinicalSingleLineBody 정의 존재').toBeGreaterThan(-1);
  expect(end, 'singleLine 영역 종료 마커 존재').toBeGreaterThan(start);
  return src.slice(start, end);
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 테이블뷰 정상 표시 (행=환자, 열=이름|방|처방|상태, 방이름 회귀 없음)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 — 테이블뷰(열=이름|방|처방|상태) + 방이름 회귀 없음', () => {
  test('두 섹션(호출 알람/진료완료) 모두 <table> 로 렌더 — li 카드 목록 아님', () => {
    const src = DASH();
    expect(src).toMatch(/data-testid="doctor-call-feed-table"/);
    expect(src).toMatch(/data-testid="doctor-completed-table"/);
    // 환자 행은 <tr> (이전 <li ... data-testid="doctor-call-feed-row"> 회귀 금지)
    expect(src).toMatch(/<tr[\s\S]{0,80}data-testid="doctor-call-feed-row"/);
    expect(src).toMatch(/<tr[\s\S]{0,80}data-testid="doctor-completed-row"/);
    // 구 li 레이아웃 잔존 금지
    expect(src).not.toMatch(/<li[\s\S]{0,80}data-testid="doctor-call-feed-row"/);
    expect(src).not.toMatch(/<li[\s\S]{0,80}data-testid="doctor-completed-row"/);
  });

  test('테이블 헤더 4열 = 이름·방·처방·상태 (양 섹션)', () => {
    const src = DASH();
    // <th> 라벨 4종이 모두 존재
    for (const label of ['이름', '방', '처방', '상태']) {
      expect(src).toMatch(new RegExp(`<th[^>]*>\\s*${label}\\s*</th>`));
    }
    // 헤더 블록이 두 곳(feed-table, completed-table) 모두에 존재
    const headerBlocks = src.match(/<thead>[\s\S]*?<\/thead>/g) ?? [];
    expect(headerBlocks.length).toBeGreaterThanOrEqual(2);
    for (const blk of headerBlocks) {
      expect(blk).toContain('이름');
      expect(blk).toContain('처방');
      expect(blk).toContain('상태');
    }
  });

  test('방이름(슬롯) 표시 회귀 없음 — 양 섹션 방 셀 + getAssignedSlotName 배선', () => {
    const src = DASH();
    // 방 셀 testid (양 섹션)
    expect(src).toMatch(/data-testid="doctor-call-room-cell"/);
    expect(src).toMatch(/data-testid="doctor-completed-room-cell"/);
    // 슬롯명 소스(getAssignedSlotName)가 양 행에서 호출됨
    const slotCalls = src.match(/getAssignedSlotName\(checkIn\)/g) ?? [];
    expect(slotCalls.length).toBeGreaterThanOrEqual(2);
    // 슬롯명을 실제로 렌더(MapPin + slotName)
    expect(src).toMatch(/\{slotName\}/);
  });

  test('회귀가드: 이름→진료차트 / 진료차트 / 진료완료 / 의사ack 액션 보존', () => {
    const src = DASH();
    // 이름 클릭 → 진료차트(full) 서랍 — 양 섹션
    expect(src).toMatch(/data-testid="doctor-call-name-chart-btn"/);
    expect(src).toMatch(/data-testid="doctor-completed-name-chart-btn"/);
    // 전체 진료차트 버튼
    expect(src).toMatch(/data-testid="doctor-call-fullchart-btn"/);
    expect(src).toMatch(/data-testid="doctor-completed-fullchart-btn"/);
    // 진료완료 버튼(활성 호출만)
    expect(src).toMatch(/<TreatmentCompleteButton/);
    // 의사 ack (버튼/배지)
    expect(src).toMatch(/<DoctorAckButton/);
    expect(src).toMatch(/<DoctorAckBadge/);
  });

  test('회귀가드: STATUS-SPLIT — QuickRxBar 에 checkInFlag(status_flag) 게이트 prop 전달', () => {
    const src = DASH();
    const rxBars = src.match(/<QuickRxBar[\s\S]*?\/>/g) ?? [];
    expect(rxBars.length).toBeGreaterThanOrEqual(2); // 호출/완료 섹션
    for (const bar of rxBars) {
      expect(bar).toContain('checkInFlag={checkIn.status_flag}');
      expect(bar).toContain('surface="doctor_call_dashboard"');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 임상경과 한 줄 입력+저장 (tall 아코디언 없음, clinical_progress 저장, 새로고침 유지)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 — 임상경과 한 줄 인풋(singleLine), tall 아코디언 제거', () => {
  test('대시보드 양 섹션이 MedicalChartPanel 에 singleLine 모드 전달', () => {
    const src = DASH();
    // embed + variant='clinical' + singleLine 동시 전달 (양 행)
    const panels = src.match(/<MedicalChartPanel[\s\S]*?\/>/g) ?? [];
    const clinicalPanels = panels.filter((p) => p.includes("variant=\"clinical\""));
    expect(clinicalPanels.length).toBeGreaterThanOrEqual(2);
    for (const p of clinicalPanels) {
      expect(p).toMatch(/\bsingleLine\b/);
      expect(p).toContain('embed');
    }
  });

  test('singleLine 모드는 한 줄 인풋(input)을 렌더 — tall textarea(rows 9 아코디언) 아님', () => {
    const src = PANEL();
    // singleLine prop 도입 + 분기
    expect(src).toMatch(/singleLine\??: boolean/);
    expect(src).toMatch(/if \(embed && variant === 'clinical'\)/);
    expect(src).toMatch(/if \(singleLine\)/);
    // 한 줄 인풋 본문 testid
    expect(src).toMatch(/data-testid="clinical-singleline-input"/);
    expect(src).toMatch(/data-testid="medical-chart-clinical-singleline"/);
    // 한 줄 인풋은 rows={1} (tall 아코디언의 rows 9/14 가 아님)
    const block = src.match(/data-testid="clinical-singleline-input"[\s\S]{0,300}/);
    expect(block, 'singleLine input block').not.toBeNull();
    expect(src).toMatch(/rows=\{1\}/);
  });

  test('clinical_progress 저장 동작 비간섭 — medical_charts write 경로는 handleSave 단 1쌍(insert+update)', () => {
    const src = PANEL();
    // 신규 저장경로 신설 금지: insert/update 각 1회(=handleSave 내부)만 존재
    const writes = src.match(/\.from\('medical_charts'\)\s*\.\s*(insert|update)/g) ?? [];
    expect(writes.length).toBe(2);
    // clinical_progress 가 payload 에 그대로 적재(컬럼 재사용·DB 변경 없음)
    expect(src).toMatch(/clinical_progress: formClinical\.trim\(\) \|\| null/);
    // singleLine 저장 버튼도 동일 handleSave 재사용(별도 write 없음)
    const region = singleLineRegion();
    expect(region).toContain('data-testid="clinical-singleline-save"');
    expect(region).toContain('onClick={handleSave}');
  });

  test('저장 성공 시 onSaved → 토글 접힘(양 섹션) 보존', () => {
    const src = DASH();
    const onSaved = src.match(/onSaved=\{\(\) => setShowClinical\(false\)\}/g) ?? [];
    expect(onSaved.length).toBeGreaterThanOrEqual(2);
  });

  test('// 자동완성(상용구) 배선 보존 — singleLine 도 clinicalRef/handleClinicalChange 재사용', () => {
    const region = singleLineRegion();
    expect(region).toContain('data-testid="clinical-singleline-input"');
    expect(region).toContain('ref={clinicalRef}');
    expect(region).toContain('onChange={handleClinicalChange}');
    // 단축어 팝오버도 동일 데이터(filteredSuperPhrases/filteredPhrases) 재사용
    expect(region).toContain('data-testid="clinical-singleline-phrase-popover"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — 엣지: 빈 입력/진료의 미선택 저장 시 NOT NULL 가드 (의료법 보존)
// ─────────────────────────────────────────────────────────────────────────────

/** handleSave 의 저장 차단 판정 모사(정본 early-return 순서). */
function canSave(args: { customerId: string | null; clinicId: string; formDate: string; signingDoctorId: string }): boolean {
  if (!args.customerId || !args.clinicId || !args.formDate) return false; // 로드 미완 가드
  if (!args.signingDoctorId) return false;                                 // 진료의 NOT NULL(의료법)
  return true;
}

test.describe('AC-3 — 빈 입력/진료의 미선택 NOT NULL 가드', () => {
  test('진료의 미선택이면 저장 차단(의료법 AC-P2-6)', () => {
    expect(canSave({ customerId: 'c1', clinicId: 'k1', formDate: '2026-06-11', signingDoctorId: '' })).toBe(false);
  });

  test('진료의 선택 시 저장 허용', () => {
    expect(canSave({ customerId: 'c1', clinicId: 'k1', formDate: '2026-06-11', signingDoctorId: 'doc-1' })).toBe(true);
  });

  test('customerId/formDate 미로드 시 저장 차단(silent 아님)', () => {
    expect(canSave({ customerId: null, clinicId: 'k1', formDate: '2026-06-11', signingDoctorId: 'doc-1' })).toBe(false);
    expect(canSave({ customerId: 'c1', clinicId: 'k1', formDate: '', signingDoctorId: 'doc-1' })).toBe(false);
  });

  test('FE 가드 배선 보존 — handleSave 진료의 차단 + singleLine 미선택 시각경고(rose 보더)', () => {
    const src = PANEL();
    // handleSave NOT NULL 차단(의료법) 보존
    expect(src).toMatch(/if \(!formSigningDoctorId\) \{/);
    expect(src).toMatch(/진료의가 필요합니다/);
    // singleLine: 한 줄 유지를 위해 별도 경고 <p> 대신 select rose 보더 + 저장버튼 게이트로 안내.
    const region = singleLineRegion();
    expect(region).toContain('data-testid="clinical-singleline-doctor"');
    expect(region).toMatch(/!formSigningDoctorId \? 'border-rose-300/);
    expect(region).toContain('disabled={saving || !formDate}');
  });

  test('DB: medical_charts 진료의 강제 트리거 보존(최종 방어선)', () => {
    const mig = readFileSync(
      path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260608170000_medchart_signing_doctor.sql'),
      'utf8',
    );
    expect(mig).toMatch(/enforce_medchart_signing_doctor/);
    expect(mig).toMatch(/NEW\.signing_doctor_id IS NULL/);
    expect(mig).toMatch(/BEFORE INSERT OR UPDATE ON medical_charts/);
  });
});
