/**
 * E2E spec — T-20260716-foot-DASHBD-DOCPRINT-SHORTCUT
 * 진료 대시보드(진료 환자 목록) 각 내원/고객 행에 "서류 출력" 1클릭 단축 버튼 추가.
 * 클릭 시 차트 진입 없이 곧바로 서류 출력 다이얼로그(기존 DocumentPrintPanel 재사용) 오픈.
 *
 * ★핵심 원칙: 차트 서류탭/재발급 모달의 기존 출력 경로(DocumentPrintPanel, LOGIC-LOCK L-006 단일 출력 경로)를
 *   그대로 재사용 — 신규 출력 로직/별도 다이얼로그 컴포넌트 신설 0. 대시보드 행 = 출력 트랙의 신규 진입점만 추가.
 * ★의료 안전 불변식(AC-3): 출력 대상은 발행완료(published/서명·직인) 서류만. draft/미서명은 노출 금지.
 *   본 단축은 published-only 게이트(medDocPrintGate: 소견서/진단서 status='published' 발행본)를
 *   DocumentPrintPanel 로부터 상속 → 차트 서류탭 출력과 동일(AC-4). 신규 필터를 만들지 않으므로
 *   noise/divergence 위험 0.
 *
 * 스타일: 형제 doctor-list 티켓 컨벤션(DOCDASH-LABEL-RX-REFINE 등)과 동일 —
 *   구현 정본을 in-page 순수 로직으로 모사(published-only 불변식) + 소스 파일 정적 검증(진입점/재사용 가드).
 *   auth/DB/server 비의존(unit 프로젝트). 실 클릭·실 출력 렌더는 supervisor 갤탭 field-soak.
 *
 * 현장 클릭 시나리오 → 본 spec 매핑:
 *   S1 (정상 1클릭 출력): 발행완료 서류 있는 행 → 서류 출력 버튼 → 차트 진입 없이 다이얼로그 → 발행완료 서류 목록.
 *   S2 (엣지/의료 안전): draft/미서명 서류만 있는 고객 → 출력 목록에 draft 미노출(published-only 상속).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

// ── 정본 모사: published-only 발행완료 게이트 (lib/medDocPrintGate.ts useAuthoredMedDocs) ──────
//   의료판단 서류(소견서/진단서)는 form_submissions.status='published'(원장 발행본)만 출력 대상.
//   대시보드 단축은 이 게이트를 신설하지 않고 DocumentPrintPanel 로부터 그대로 상속한다.
type SubmissionStatus = 'draft' | 'printed' | 'voided' | 'published';
interface SubmissionLike { id: string; status: SubmissionStatus; docType?: 'opinion' | 'diagnosis' }
/** medDocPrintGate 의 발행본 선별 술어 모사 — published 만 통과. */
const isPublishedMedDoc = (s: SubmissionLike): boolean => s.status === 'published';
/** 출력 대상 발행본 필터 (published 만). */
const selectPublishedForPrint = (subs: SubmissionLike[]): SubmissionLike[] =>
  subs.filter(isPublishedMedDoc);

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — AC-1/2: 진료 환자 목록 각 행에 "서류 출력" 버튼 + 1클릭 다이얼로그 진입점
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 — 서류 출력 1클릭 단축 진입점', () => {
  test('AC-1: 각 행 액션 영역에 "서류 출력" 버튼(data-testid=dashbd-docprint-btn)이 렌더된다', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    expect(src).toContain('data-testid="dashbd-docprint-btn"');
    expect(src).toContain('서류 출력');
    // 프린터 아이콘 사용(행 액션 룩앤필 준수: h-6 text-[11px] 소형 버튼)
    expect(src).toContain('<Printer');
    expect(src).toMatch(/h-6 text-\[11px\][^"]*border-teal/);
  });

  test('AC-2: 버튼 클릭 → 부모 단일 모달(DocumentPrintPanel) 오픈 (차트 진입 없음)', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    // 콜백 배선: 행 → openDocPrint(row.id) → docPrintCheckIn 상태 → 모달
    expect(src).toContain('onOpenDocPrint={() => openDocPrint(row.id)}');
    expect(src).toContain('const openDocPrint = async');
    expect(src).toContain('data-testid="dashbd-docprint-dialog"');
    // 모달 내부가 DocumentPrintPanel(기존 출력 surface) — 차트(MedicalChartPanel/openTreatmentChart)로 라우팅하지 않음
    expect(src).toMatch(/dashbd-docprint-dialog[\s\S]*<DocumentPrintPanel/);
  });

  test('AC-2: 버튼 콜백이 진료차트 오픈(openTreatmentChart)이 아니라 서류 출력 모달을 연다', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    // onOpenChart(차트) 와 onOpenDocPrint(서류출력) 은 별개 배선 — 서류출력이 차트로 새지 않음
    expect(src).toContain('onOpenChart={row.customer_id ? () => openTreatmentChart');
    expect(src).toContain('onOpenDocPrint={() => openDocPrint(row.id)}');
    // openDocPrint 는 check_in full-row lazy-fetch 후 docPrintCheckIn 설정(출력 surface가 요구하는 clinic_id 등 확보)
    expect(src).toMatch(/openDocPrint[\s\S]*from\('check_ins'\)[\s\S]*setDocPrintCheckIn/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — AC-3/4: 의료 안전 불변식(published-only) + 기존 출력 경로 재사용(동일 출력)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 — 의료 안전 불변식(발행완료만) + 재사용', () => {
  test('AC-3: draft/미서명 서류만 있는 고객 → 출력 대상에 draft 노출 0 (published 만 통과)', () => {
    const subs: SubmissionLike[] = [
      { id: 'd1', status: 'draft', docType: 'opinion' },
      { id: 'd2', status: 'draft', docType: 'diagnosis' },
    ];
    const printable = selectPublishedForPrint(subs);
    expect(printable).toHaveLength(0); // draft 는 절대 출력 대상 아님
    expect(printable.some((s) => s.status === 'draft')).toBe(false);
  });

  test('AC-3: 발행완료+draft 혼재 → 발행완료(published)만 노출, draft 제외', () => {
    const subs: SubmissionLike[] = [
      { id: 'p1', status: 'published', docType: 'opinion' },
      { id: 'd1', status: 'draft', docType: 'opinion' },
      { id: 'v1', status: 'voided', docType: 'diagnosis' },
      { id: 'p2', status: 'published', docType: 'diagnosis' },
    ];
    const printable = selectPublishedForPrint(subs);
    expect(printable.map((s) => s.id).sort()).toEqual(['p1', 'p2']);
    expect(printable.every((s) => s.status === 'published')).toBe(true);
  });

  test('AC-3: 정본(medDocPrintGate)이 published-only 필터를 유지 — 단축이 이 게이트를 우회하지 않음', () => {
    const gate = SRC('lib/medDocPrintGate.ts');
    // 발행본 조회는 status='published' 로 강제 (draft/미서명 제외의 SSOT)
    expect(gate).toContain(".eq('status', 'published')");
    // 대시보드 단축은 이 게이트를 소유한 DocumentPrintPanel 을 그대로 재사용(새 조회경로 신설 아님)
    const list = SRC('components/doctor/DoctorPatientList.tsx');
    expect(list).toContain("import { DocumentPrintPanel } from '@/components/DocumentPrintPanel'");
  });

  test('AC-4: 출력 surface 신설 0 — 차트 서류탭/재발급 모달과 동일 DocumentPrintPanel 재사용', () => {
    const list = SRC('components/doctor/DoctorPatientList.tsx');
    // 별도 신규 출력 다이얼로그 컴포넌트를 만들지 않음 — DocumentPrintPanel 을 그대로 사용
    expect(list).toContain('<DocumentPrintPanel checkIn={docPrintCheckIn} onUpdated={() => {}} historyAtTop />');
    // 재사용 원칙 주석 흔적(신규 출력 로직 신설 금지)
    expect(list).toContain('재사용 원칙');
    // 참조 정본(CustomerChartPage docReissue 모달)도 동일 컴포넌트를 사용함을 확인(동일 출력 경로 근거)
    const chart = SRC('pages/CustomerChartPage.tsx');
    expect(chart).toContain('<DocumentPrintPanel');
  });
});
