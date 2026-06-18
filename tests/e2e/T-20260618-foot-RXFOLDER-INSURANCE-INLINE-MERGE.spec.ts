/**
 * E2E spec — T-20260618-foot-RXFOLDER-INSURANCE-INLINE-MERGE
 *
 * 현장(문지은 대표원장, C0ATE5P6JTH):
 *   "급여여부 관리를 별도 탭으로 두지 말고 … 약이 (처방세트) 좌측에 전체나열 되어있고, 거기서 체크박스/약
 *    클릭해서 급여여부관리 기능을 할 수 있게. 지금 페이지 오른쪽 단 안 쓰니 거기 쓰게."
 *
 * AC-0 그라운딩(코드 확정): 급여여부 = prescription_codes.insurance_status.
 *   - PrescriptionSetsTab(묶음처방) 좌측 약 = services-backed(searchServiceRxDrugs, services.id)
 *     → insurance_status 편집 불가 → 타깃 제외.
 *   - DrugFoldersTab(UI 라벨 "처방세트") [전체보기] = prescription_codes 백킹 + 약 전체나열 + 체크박스
 *     → 인라인 급여여부 편집 부착 타깃 확정.
 *
 * Surface 확정:
 *   - src/components/admin/DrugFoldersTab.tsx       (전체보기 2-pane + 급여여부 컬럼 + 우측 인라인 패널)
 *   - src/components/admin/InsuranceStatusPanel.tsx (급여여부 편집 SSOT — mutation/STATUS 단일 정의)
 *   - src/components/admin/HiraInsuranceSyncPanel.tsx (AC-5 HIRA 배치동기화 이전처)
 *   - src/pages/ClinicManagement.tsx                (급여여부 관리 별도 탭 제거 + 딥링크 정규화)
 *   - src/lib/drugFolders.ts                        (useFolderDrugs insurance_status 노출)
 *   - src/components/admin/InsuranceStatusTab.tsx   (제거됨 — 부재 단언)
 *
 * 본 spec 은 정본 소스 정적 단언으로 불변식을 인코딩(데이터/로그인 비의존) — 형제 RXSET spec 동형.
 */
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const TAB = 'src/components/admin/DrugFoldersTab.tsx';
const PANEL = 'src/components/admin/InsuranceStatusPanel.tsx';
const SYNC = 'src/components/admin/HiraInsuranceSyncPanel.tsx';
const CLINIC = 'src/pages/ClinicManagement.tsx';
const LIB = 'src/lib/drugFolders.ts';
const OLD_TAB = 'src/components/admin/InsuranceStatusTab.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 정상 동선 — 약 선택 → 우측 패널 급여여부 설정 (AC-1/AC-2)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: 전체보기가 2-pane(좌 약테이블 / 우 급여여부 패널)으로 구성', () => {
  const src = read(TAB);
  // 전체보기 컨테이너가 2-col 그리드(우측 단 활용)
  expect(src).toContain('drug-folder-viewall');
  expect(src).toMatch(/md:grid-cols-\[1fr_340px\]/);
  // 우측 급여여부 편집 영역 존재
  expect(src).toContain('drug-folder-viewall-insurance-pane');
  // 약명 클릭 = 우측 패널 선택 트리거
  expect(src).toContain('drug-folder-viewall-name-btn');
  expect(src).toContain('setInsuranceSelectedId');
});

test('AC-1: 약 미선택 시 우측은 안내 placeholder, 선택 시 InsuranceStatusPanel 렌더', () => {
  const src = read(TAB);
  expect(src).toContain('drug-folder-viewall-insurance-empty');
  expect(src).toContain('<InsuranceStatusPanel');
  expect(src).toContain('insuranceSelectedDrug');
});

test('AC-1: 전체보기 행에 급여여부 배지 컬럼 노출(차단상태 식별)', () => {
  const src = read(TAB);
  expect(src).toContain('급여여부');
  expect(src).toContain('drug-folder-viewall-insurance-badge');
  expect(src).toContain('INSURANCE_STATUS_STYLE');
});

test('AC-2: 급여여부 mutation/STATUS 는 InsuranceStatusPanel 단일 SSOT (중복 분기 금지)', () => {
  const panel = read(PANEL);
  // covered/non_covered/deleted/criteria_changed 4종 옵션 계승
  expect(panel).toContain("INSURANCE_STATUS_OPTIONS");
  expect(panel).toContain("'covered'");
  expect(panel).toContain("'non_covered'");
  expect(panel).toContain("'deleted'");
  expect(panel).toContain("'criteria_changed'");
  // update insurance_status + source='manual' + updated_at
  expect(panel).toContain('.from(\'prescription_codes\')');
  expect(panel).toContain('insurance_status:');
  expect(panel).toContain("insurance_status_source: 'manual'");
  expect(panel).toContain('insurance_status_updated_at');
  // 저장 성공 토스트 문구 유지
  expect(panel).toContain('급여여부가 저장됐어요.');
  // 저장 성공 콜백으로 목록 갱신
  expect(panel).toContain('onSaved');
  // DrugFoldersTab 은 자체 insurance mutation 을 갖지 않고 패널에 위임 (중복 분기 0)
  const tab = read(TAB);
  expect(tab).not.toContain("insurance_status_source: 'manual'");
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 게이트 무회귀 (AC-3) — 게이트 로직/데이터 모델 무변경
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: 게이트 SSOT(prescriptionGate) 라벨/차단판정 재사용 — 게이트 로직 무변경', () => {
  const panel = read(PANEL);
  expect(panel).toContain("from '@/lib/prescriptionGate'");
  expect(panel).toContain('insuranceStatusLabel');
  expect(panel).toContain('isInsuranceBlockedStatus');
  // 패널은 insurance_status 데이터만 채움 — 게이트 판정 함수(checkRxInsuranceGate)를 호출/실행하지 않음.
  //   (소비측 게이트 로직은 미접촉 = 무회귀. 함수 호출 패턴 부재 단언; 설명 주석 언급은 허용.)
  expect(panel).not.toMatch(/checkRxInsuranceGate\s*\(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 신규 약 추가 (AC-4) — 기존 약품 검색·폴더배정 경로 보존
//   (신규 prescription_codes 생성은 §5 허용대로 후속 sub-ticket 분리. 기존 추가 동선은 무회귀.)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4: 처방폴더 내 기존 약품 검색→폴더 배정 동선 보존', () => {
  const src = read(TAB);
  expect(src).toContain('drug-folder-assign-search');
  expect(src).toContain('handleAssign');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 4: 권한 (AC) — 편집 권한자(admin/manager)만 인라인 편집 노출
// ─────────────────────────────────────────────────────────────────────────────
test('AC: 급여여부 편집은 admin/manager(canManageInsurance) 게이트 + RLS 이중 가드', () => {
  const tab = read(TAB);
  expect(tab).toContain('canManageInsurance');
  expect(tab).toMatch(/profile\?\.role === 'admin' \|\| profile\?\.role === 'manager'/);
  // 우측 패널 영역 자체가 canManageInsurance 게이트 안에 있음
  expect(tab).toContain('canManageInsurance && (');
  // 패널 내부도 canWrite=false 면 읽기전용
  const panel = read(PANEL);
  expect(panel).toContain('읽기 전용');
  expect(panel).toContain('disabled={!canWrite');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 5: 탭 제거 + 기능 보존 (AC-5)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-5: 급여여부 관리 별도 탭(InsuranceStatusTab) 제거', () => {
  // 컴포넌트 파일 자체가 제거됨
  expect(existsSync(join(ROOT, OLD_TAB))).toBe(false);
  const clinic = read(CLINIC);
  // import / tab trigger / tab content / accessibleTabs 진입점 모두 부재
  expect(clinic).not.toContain("import InsuranceStatusTab");
  expect(clinic).not.toContain('value="insurance_status"');
  expect(clinic).not.toContain('tab-insurance-status');
  expect(clinic).not.toContain("<InsuranceStatusTab");
});

test('AC-5: HIRA 배치동기화(insurance_sync_runs) 패널 유실 금지 — 처방폴더로 이전', () => {
  // 동기화 패널 컴포넌트 존재 + 핵심 식별자 보존
  const sync = read(SYNC);
  expect(sync).toContain('insurance_sync_runs');
  expect(sync).toContain('insurance-sync-panel');
  expect(sync).toContain('심평원(HIRA) 급여목록 동기화 현황');
  // DrugFoldersTab 전체보기 우측에서 마운트
  const tab = read(TAB);
  expect(tab).toContain('<HiraInsuranceSyncPanel');
});

test('AC-5: 구 딥링크 ?tab=insurance_status → drug_folders 정규화(북마크 호환)', () => {
  const clinic = read(CLINIC);
  expect(clinic).toMatch(/insurance_status' \? 'drug_folders'/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 데이터 계약: useFolderDrugs 가 insurance_status 를 노출 (배지/패널 정합)
// ─────────────────────────────────────────────────────────────────────────────
test('lib: useFolderDrugs select + FolderDrug 타입에 insurance_status 포함', () => {
  const lib = read(LIB);
  expect(lib).toContain('insurance_status');
  // select 절에 prescription_codes(...,insurance_status) 포함
  expect(lib).toMatch(/prescription_codes\([^)]*insurance_status[^)]*\)/);
});
