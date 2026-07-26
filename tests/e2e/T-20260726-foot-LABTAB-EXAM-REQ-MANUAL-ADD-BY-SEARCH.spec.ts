/**
 * T-20260726-foot-LABTAB-EXAM-REQ-MANUAL-ADD-BY-SEARCH
 *
 * 피검사(검사 신청) 수기 추가 — 치료테이블 [피검사] 탭(피검사 일일 진행 리스트 = BloodDailyListSection).
 * 성함/차트번호 검색 → 환자 선택 → 피검사 신청 직접 등록. 배경(김주연 총괄): 검사 신청이 자꾸 '풀리는'
 * 버그의 우회수단(workaround) — 풀려도 담당자가 즉시 재등록. (풀림 근본원인은 별건 FOLLOWUP 진단.)
 *
 * ── 핵심 아키텍처(진단 결과) ─────────────────────────────────────────────
 *   피검사 일일 진행 리스트의 각 행 = check_in_services.blood_test_requested=true 의 '라이브 투영'
 *   (useBloodTargets, 14일 checked_in_at 윈도). form_submissions 는 접수/서류수령 오버레이만.
 *   ∴ 리스트에 실제로 뜨는 '검사 신청' 수기 추가 = form_submissions INSERT 가 아니라
 *     旣 request_blood_test_for_customer RPC(서비스행 없으면 서버가 자동생성) 재사용이 정합 경로.
 *   → 균검사 탭(ExamTargetsSection) '검사 신청 수기 추가'와 동일 ManualExamRequestDialog 를
 *     lockKind='blood' 로 재사용(신규 검색 인프라·신규 스키마 0, db_change=false).
 *
 * AC-1  진입점 — [피검사] 탭(BloodDailyListSection) 헤더에 '검사 신청 수기 추가' 버튼(스태프 이상 role 게이트).
 * AC-2  검색 — 성함 OR 차트번호 부분검색(customers, clinic-scoped ilike). 명시 선택(자동선택 없음). 결과없음 안내.
 * AC-3  영속(회귀 핵심) — 旣 request_blood_test_for_customer RPC 재사용(2번차트 토글과 동일 저장경로). 신규 스키마 0.
 * AC-4  종류 고정 — 피검사 탭 진입은 lockKind='blood' → 종류 선택 UI 숨김 + blood 고정 제출.
 * AC-5  read-after-write / 정합 — blood_daily_targets invalidate → 즉시 리스트 반영. useBloodTargets 재조회로
 *        4FIX 정렬(역순)·완료행 자동비활성 규칙에 자동 부합(수기 항목 별도 정렬/상태 로직 없음).
 * AC-6  role SSOT — canManualAddExam/MANUAL_EXAM_ADD_ROLES(permissions.ts) = 균검사 탭과 동일 집합(gate #4).
 *
 * 정적(빌드 산출 소스) 검증 — 데이터 계약/DB 상태 미의존(no-DDL, 旣 persist 경로 재사용). 기존
 *   T-20260726-foot-EXAM-MANUAL-ADD-SEARCH.spec.ts(균검사) 동형 컨벤션.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const bloodSection = () => read('src/components/treatment/BloodDailyListSection.tsx');
const dialog = () => read('src/components/treatment/ManualExamRequestDialog.tsx');
const perms = () => read('src/lib/permissions.ts');

test.describe('AC-1: 진입점 + role 게이트 (피검사 탭)', () => {
  test('피검사 일일 진행 리스트 헤더에 수기추가 버튼 + role 게이트', () => {
    const b = bloodSection();
    expect(b).toContain('data-testid="blood-manual-add-btn"');
    expect(b).toContain('검사 신청 수기 추가');
    // role 게이트: 스태프 이상만 노출(SSOT 헬퍼)
    expect(b).toContain('canManualAddExam');
    expect(b).toContain('const canManualAdd =');
    // 버튼·다이얼로그 모두 canManualAdd 조건부 노출
    expect(b).toContain('{canManualAdd && (');
    expect(b).toContain('<ManualExamRequestDialog');
  });
});

test.describe('AC-6: role SSOT (균검사 탭과 동일 집합)', () => {
  test('MANUAL_EXAM_ADD_ROLES/canManualAddExam permissions.ts SSOT', () => {
    const p = perms();
    expect(p).toContain('MANUAL_EXAM_ADD_ROLES');
    expect(p).toContain('export function canManualAddExam');
    // 관리 스태프 + staff 포함, 치료사·컨설턴트 등 비관리 role 미포함(fail-closed)
    expect(p).toMatch(/MANUAL_EXAM_ADD_ROLES[^\n]*'admin'[^\n]*'manager'[^\n]*'director'[^\n]*'coordinator'[^\n]*'staff'/);
    expect(p).not.toMatch(/MANUAL_EXAM_ADD_ROLES[^\n]*'therapist'/);
    expect(p).not.toMatch(/MANUAL_EXAM_ADD_ROLES[^\n]*'consultant'/);
  });
});

test.describe('AC-2: 검색(성함/차트번호 부분일치, 명시 선택, 결과없음 안내)', () => {
  test('customers 부분검색 + clinic-scoped + 명시 선택(다이얼로그 재사용)', () => {
    const d = dialog();
    expect(d).toContain('name.ilike.%');
    expect(d).toContain('chart_number.ilike.%');
    expect(d).toContain(".from('customers')");
    expect(d).toContain("eq('clinic_id'");
    expect(d).toContain('data-testid="manual-exam-search-input"');
    expect(d).toContain('data-testid="manual-exam-search-btn"');
    expect(d).toContain('data-testid="manual-exam-results"');
    expect(d).toContain('data-testid="manual-exam-result-row"');
    // 명시 선택(자동선택 없음)
    expect(d).toContain('setSelected(c)');
    // 시나리오3(엣지): 검색결과 없음 안내
    expect(d).toContain('data-testid="manual-exam-results-empty"');
    expect(d).toContain('일치하는 환자가 없습니다');
  });

  test('동명이인 구분 단서(차트번호·연락처)', () => {
    const d = dialog();
    expect(d).toContain('chartNoBadge');
    expect(d).toContain('maskPhoneTail');
  });
});

test.describe('AC-3/AC-5: 旣 RPC 재사용(신규 스키마 0) + read-after-write', () => {
  test('request_blood_test_for_customer RPC 위임(직접 INSERT/UPDATE 부재)', () => {
    const d = dialog();
    expect(d).toContain('request_blood_test_for_customer');
    expect(d).toContain('p_customer_id');
    expect(d).toContain('p_value: true');
    // RPC 위임만 — 신규 테이블/컬럼 직접 write 없음
    expect(d).not.toContain('.insert(');
    expect(d).not.toContain('.update(');
  });

  test('피검사 일일 리스트 즉시 반영 — blood_daily_targets invalidate', () => {
    const d = dialog();
    expect(d).toContain("queryKey: ['blood_daily_targets']");
    expect(d).toContain("queryKey: ['exam_targets']");
  });
});

test.describe('AC-4: 피검사 종류 고정(lockKind)', () => {
  test('피검사 탭 진입은 lockKind="blood" 고정 전달', () => {
    const b = bloodSection();
    expect(b).toContain('lockKind="blood"');
  });

  test('lockKind 지정 시 종류 선택 UI 숨김 + blood 고정', () => {
    const d = dialog();
    // prop 정의
    expect(d).toContain('lockKind?: ExamKind');
    // 초기 종류 = lockKind ?? 'koh'
    expect(d).toContain("lockKind ?? 'koh'");
    // 종류 선택 블록은 lockKind 없을 때만 노출(피검사 탭에서 숨김)
    expect(d).toContain('selected && !lockKind');
    // 피검사 전용 타이틀
    expect(d).toContain('피검사 신청 수기 추가');
    // 균검사 탭 회귀 방지 — 두 종류 enum·selector 소스 보존
    expect(d).toMatch(/koh:\s*{/);
    expect(d).toMatch(/blood:\s*{/);
    expect(d).toContain('manual-exam-kind-${k}');
  });
});

test.describe('AC-5(정합): 4FIX 정렬·자동비활성 자동 부합(수기 항목 별도 로직 없음)', () => {
  test('수기 항목도 useBloodTargets 재조회 경로 통과(공통 정렬/상태)', () => {
    const b = bloodSection();
    // 리스트 행은 useBloodTargets(공통 소스) — 수기든 자동이든 동일 쿼리로 렌더 → 4FIX 규칙 공유
    expect(b).toContain('useBloodTargets');
    // 4FIX 역순 정렬(검사신청일 내림차순) 로직 보존
    expect(b).toContain('b.requestDate.localeCompare(a.requestDate)');
    // 4FIX 완료행 자동비활성 판정 보존
    expect(b).toContain('const isComplete');
  });
});
