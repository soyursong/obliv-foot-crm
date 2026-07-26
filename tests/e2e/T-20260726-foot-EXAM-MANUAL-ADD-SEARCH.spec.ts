/**
 * T-20260726-foot-EXAM-MANUAL-ADD-SEARCH
 *
 * 검사 신청 수기 추가 — 치료테이블 [균검사] 탭. 성함/차트번호 검색 → 환자 선택 → 검사종류(균검사 KOH / 피검사) → 제출.
 * 배경(김주연 총괄): '검사 신청 항목이 자꾸 풀리는 버그' 보완루트(수기 진입경로). 원인 수정은 별도 티켓.
 *
 * AC-1  진입점 — [균검사] 탭 헤더에 '검사 신청 수기 추가' 버튼(스태프 이상 role 게이트).
 * AC-2  검색 — 성함 OR 차트번호 부분검색(customers, clinic-scoped ilike). 명시 선택(자동선택 없음).
 * AC-3  영속(회귀 핵심) — 旣 request_koh_for_customer / request_blood_test_for_customer RPC 재사용
 *        (2번차트 토글과 동일 저장경로). 신규 스키마 0(db_change=false). 재진입/새로고침 후 유지.
 * AC-4  검사종류 enum 정합 — 균검사=koh_requested(KOH) / 피검사=blood_test_requested 1:1.
 * AC-5  read-after-write — exam_targets/토글 쿼리 invalidate 로 목록·토글 즉시 반영.
 *
 * 정적(빌드 산출 소스) 검증 — 데이터 계약/DB 상태 미의존(no-DDL, 旣 persist 경로 재사용).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const dialog = () => read('src/components/treatment/ManualExamRequestDialog.tsx');
const exam = () => read('src/components/treatment/ExamTargetsSection.tsx');

test.describe('AC-1: 진입점 + role 게이트', () => {
  test('균검사 섹션에 수기추가 버튼 + role 게이트', () => {
    const e = exam();
    expect(e).toContain('data-testid="manual-exam-add-btn"');
    expect(e).toContain('검사 신청 수기 추가');
    // role 게이트: 스태프 이상만 노출
    expect(e).toContain('MANUAL_EXAM_ADD_ROLES');
    expect(e).toContain('canManualAdd');
    // 관리 스태프 + staff 포함, 치료사·컨설턴트 등 비관리 role 미포함
    expect(e).toMatch(/MANUAL_EXAM_ADD_ROLES[^\n]*'admin'[^\n]*'manager'[^\n]*'director'[^\n]*'coordinator'[^\n]*'staff'/);
    expect(e).not.toMatch(/MANUAL_EXAM_ADD_ROLES[^\n]*'therapist'/);
    // 게이트로 감싼 노출(버튼·다이얼로그 모두 canManualAdd 조건부)
    expect(e).toContain('{canManualAdd && (');
    expect(e).toContain('<ManualExamRequestDialog');
  });
});

test.describe('AC-2: 검색(성함/차트번호 부분일치, 명시 선택)', () => {
  test('customers 부분검색 + clinic-scoped + 명시 선택', () => {
    const d = dialog();
    // 성함 OR 차트번호 ilike 부분검색
    expect(d).toContain('name.ilike.%');
    expect(d).toContain('chart_number.ilike.%');
    expect(d).toContain(".from('customers')");
    // clinic-scoped
    expect(d).toContain("eq('clinic_id'");
    // 검색 입력 + 버튼 + 결과 리스트
    expect(d).toContain('data-testid="manual-exam-search-input"');
    expect(d).toContain('data-testid="manual-exam-search-btn"');
    expect(d).toContain('data-testid="manual-exam-results"');
    expect(d).toContain('data-testid="manual-exam-result-row"');
  });

  test('동명이인 구분 단서(차트번호·연락처) 노출 + 자동선택 없음', () => {
    const d = dialog();
    // 결과 행에 차트번호 + 전화 뒷자리(동명이인 구분)
    expect(d).toContain('chartNoBadge');
    expect(d).toContain('maskPhoneTail');
    // 명시 선택 — onClick 으로 setSelected, 자동선택(첫 결과 자동 pick) 아님
    expect(d).toContain('setSelected(c)');
    expect(d).toContain("data-selected");
  });
});

test.describe('AC-3/AC-5: 旣 persist 경로 재사용 + read-after-write', () => {
  test('旣 RPC 재사용(신규 스키마 0) — 토글과 동일 저장경로', () => {
    const d = dialog();
    expect(d).toContain('request_koh_for_customer');
    expect(d).toContain('request_blood_test_for_customer');
    expect(d).toContain('p_customer_id');
    expect(d).toContain('p_value: true');
    // 신규 테이블/컬럼 INSERT·UPDATE 직접 수행 안 함(RPC 위임만) — .insert(/.update( 부재
    expect(d).not.toContain('.insert(');
    expect(d).not.toContain('.update(');
  });

  test('exam_targets + 토글 쿼리 invalidate(즉시 반영)', () => {
    const d = dialog();
    expect(d).toContain("queryKey: ['exam_targets']");
    expect(d).toContain("queryKey: ['koh_toggle_target'");
    expect(d).toContain("queryKey: ['blood_toggle_target'");
  });
});

test.describe('AC-4: 검사종류 enum 정합', () => {
  test('균검사(KOH)/피검사 2종 — koh_requested/blood_test_requested RPC 1:1', () => {
    const d = dialog();
    // testid 는 종류별 동적 생성(`manual-exam-kind-${k}`), koh/blood 2종 enum 정의
    expect(d).toContain('manual-exam-kind-${k}');
    expect(d).toMatch(/koh:\s*{/);
    expect(d).toMatch(/blood:\s*{/);
    expect(d).toContain('균검사 (KOH)');
    expect(d).toContain('피검사');
    // 제출 버튼
    expect(d).toContain('data-testid="manual-exam-submit-btn"');
  });
});
