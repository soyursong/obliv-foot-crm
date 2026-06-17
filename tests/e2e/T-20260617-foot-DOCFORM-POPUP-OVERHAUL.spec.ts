/**
 * E2E spec — T-20260617-foot-DOCFORM-POPUP-OVERHAUL (Phase 1)
 * 풋 서류 영역 전면 재구성 — Phase 1: 진료대시보드 원장영역 연동(approved, 김주연 총괄).
 *
 * 범위(이 커밋 = Phase 1 진입점 일원화):
 *   AC-1 진료 알림판/완료 각 내원객 행에서 '서류' 액션 → 서류 발급 허브 직접 오픈(탭 이동 없이 대시보드에서 시작).
 *   AC-2 소견서 = OpinionDocTab.OpinionEditorDialog 재사용 + 환자 컨텍스트 자동 바인딩(visitorFromCheckIn).
 *   AC-3 진단서/서류발급 = DocumentPrintPanel 재사용(대시보드 진입점 추가, 현행 양식·발급 흐름 보존).
 *   AC-5 검사결과지(KOH) = KohPublishedResults 재사용(대시보드 행에서 진입, 입력은 균검사지 탭 유지).
 *   AC-6 published 불변 트리거(의료법§22) 보존 — 본 허브는 신규 mutation/RPC 0(각 컴포넌트 내부 보존).
 *   AC-7 LOGIC-LOCK L-006(bindHtmlTemplate 4출력경로) 보존 — htmlFormTemplates/printOpinionDoc 미변경(재사용만).
 *   AC-8 기존 탭(균검사지/소견서/1번차트 서류발급) 병행 보존(덮어쓰기 금지, REDEFINITION_SANCTIONED).
 *
 * Phase 1 잔여(별도 슬라이스, 본 커밋 제외): G4 진료의뢰서 test_result/medication 전용필드 분리 + KOH/처방약
 *   자동 pull, G6 진단서 '향후 치료기간' 전용 placeholder 분리 — htmlFormTemplates(L-006) 편집 동반 → 4경로 회귀
 *   가드 별도 진행. Phase 2~4(설정 팝업·영문 AI번역·상품코드)는 data-architect CONSULT 게이트 후.
 *
 * 스타일: 정본 순수 로직 모사 + 소스 정적 검증(회귀 가드). auth/DB 비의존(unit 프로젝트).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

// ── 정본 모사: visitorFromCheckIn (DoctorDocsHubDialog) ─────────────────────────
//   check_ins(임베드 customers) → 소견서 팝업 입력(VisitorRow) 매핑. PostgREST object|array 양쪽 흡수.
interface CheckInLike {
  id: string;
  customer_id?: string | null;
  customer_name?: string | null;
  visit_type?: string | null;
  checked_in_at?: string;
  customers?:
    | { chart_number?: string | null; birth_date?: string | null }
    | Array<{ chart_number?: string | null; birth_date?: string | null }>
    | null;
}
function visitorFromCheckIn(ci: CheckInLike) {
  const raw = ci.customers;
  const c = Array.isArray(raw) ? raw[0] : raw;
  return {
    id: ci.id,
    customer_id: ci.customer_id ?? null,
    customer_name: ci.customer_name ?? '—',
    chart_number: c?.chart_number ?? null,
    birth_date: c?.birth_date ?? null,
    visit_type: ci.visit_type ?? null,
    checked_in_at: ci.checked_in_at ?? '',
  };
}

// ── 정본 모사: 단일 Dialog 동시 오픈 게이트 (DoctorDocsHubDialog activeDoc) ────────
//   허브 메뉴는 activeDoc===null 일 때만, 개별 서류 팝업은 해당 activeDoc 일 때만 열림 → 항상 ≤1개.
type DocKind = 'opinion' | 'print' | 'koh';
function openFlags(open: boolean, activeDoc: DocKind | null) {
  return {
    hub: open && activeDoc === null,
    opinion: open && activeDoc === 'opinion',
    print: open && activeDoc === 'print',
    koh: open && activeDoc === 'koh',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// S1 — visitorFromCheckIn: 환자 컨텍스트 자동 바인딩(AC-2)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 AC-2 — 환자 컨텍스트 자동 바인딩(visitorFromCheckIn)', () => {
  test('customers object 임베드 → chart/birth 추출', () => {
    const v = visitorFromCheckIn({
      id: 'ci-1',
      customer_id: 'cust-1',
      customer_name: '홍길동',
      visit_type: 'new',
      checked_in_at: '2026-06-17T01:00:00+09:00',
      customers: { chart_number: 'A-100', birth_date: '1990-05-05' },
    });
    expect(v).toMatchObject({
      id: 'ci-1',
      customer_id: 'cust-1',
      customer_name: '홍길동',
      chart_number: 'A-100',
      birth_date: '1990-05-05',
      visit_type: 'new',
    });
  });

  test('customers array 임베드(PostgREST to-one array 직렬화) → 첫 원소 흡수', () => {
    const v = visitorFromCheckIn({
      id: 'ci-2',
      customer_id: 'cust-2',
      customer_name: '김철수',
      customers: [{ chart_number: 'B-200', birth_date: '1985-01-01' }],
    });
    expect(v.chart_number).toBe('B-200');
    expect(v.birth_date).toBe('1985-01-01');
  });

  test('customers 결측/이름 결측 → 안전 폴백(null·"—")', () => {
    const v = visitorFromCheckIn({ id: 'ci-3', customer_id: null, customers: null });
    expect(v.customer_id).toBeNull();
    expect(v.chart_number).toBeNull();
    expect(v.birth_date).toBeNull();
    expect(v.customer_name).toBe('—');
    expect(v.checked_in_at).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 — 단일 Dialog 동시 오픈 불변식(허브 ↔ 개별 서류 팝업)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 — 동시에 ≤1개 팝업만 열림', () => {
  test('닫힘(open=false) → 전부 닫힘', () => {
    const f = openFlags(false, null);
    expect([f.hub, f.opinion, f.print, f.koh].filter(Boolean)).toHaveLength(0);
  });

  test('열림 + 메뉴 상태(activeDoc=null) → 허브만', () => {
    const f = openFlags(true, null);
    expect(f.hub).toBe(true);
    expect([f.opinion, f.print, f.koh].filter(Boolean)).toHaveLength(0);
  });

  test('소견서/서류발급/KOH 선택 → 해당 1개만, 허브 숨김', () => {
    for (const kind of ['opinion', 'print', 'koh'] as DocKind[]) {
      const f = openFlags(true, kind);
      expect(f.hub).toBe(false);
      const openCount = [f.opinion, f.print, f.koh].filter(Boolean).length;
      expect(openCount).toBe(1);
      expect(f[kind]).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 — DoctorDocsHubDialog: 3 surface 순수 재사용 + 신규 mutation 0(AC-6/7)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 AC-6/7 — 기존 SSOT 컴포넌트 재사용(불변 트리거·L-006 보존)', () => {
  const src = () => SRC('components/doctor/DoctorDocsHubDialog.tsx');

  test('소견서=OpinionEditorDialog / 서류발급=DocumentPrintPanel / KOH=KohPublishedResults 재사용', () => {
    const s = src();
    expect(s).toContain("import { DocumentPrintPanel } from '@/components/DocumentPrintPanel'");
    expect(s).toContain("import KohPublishedResults from '@/components/KohPublishedResults'");
    expect(s).toContain('OpinionEditorDialog');
    expect(s).toContain('<DocumentPrintPanel');
    expect(s).toContain('<KohPublishedResults');
    expect(s).toContain('<OpinionEditorDialog');
  });

  test('AC-6: 허브는 신규 mutation/RPC 0 (발행·불변 트리거는 각 컴포넌트 내부)', () => {
    const s = src();
    expect(s).not.toContain('.rpc(');
    expect(s).not.toContain('.insert(');
    expect(s).not.toContain('.update(');
    expect(s).not.toContain('.delete(');
  });

  test('AC-7: 허브는 htmlFormTemplates/bindHtmlTemplate 미직접참조(L-006 미변경)', () => {
    const s = src();
    // 주석 멘션은 허용 — 실제 import/호출이 없어야 L-006 미변경(출력 SSOT 우회 0).
    expect(s).not.toContain("from '@/lib/htmlFormTemplates'");
    expect(s).not.toMatch(/bindHtmlTemplate\(/);
  });

  test('DocumentPrintPanel에 clinic_id 주입(대시보드 partial select 보강)', () => {
    const s = src();
    expect(s).toContain('clinic_id: checkIn.clinic_id ?? clinicId');
  });

  test('3종 진입 버튼 testid 노출(소견서/서류발급/KOH)', () => {
    const s = src();
    // HubButton helper에 testId prop으로 전달 → 내부에서 data-testid로 렌더
    expect(s).toContain('testId="docs-hub-opinion"');
    expect(s).toContain('testId="docs-hub-print"');
    expect(s).toContain('testId="docs-hub-koh"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S4 — OpinionDocTab: 재사용 export(소견서 SSOT 단일화, 재구현 금지)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S4 AC-2 — 소견서 발행 SSOT 재사용(export)', () => {
  const src = () => SRC('components/doctor/OpinionDocTab.tsx');

  test('OpinionEditorDialog / useClinicHeader export', () => {
    const s = src();
    expect(s).toContain('export function OpinionEditorDialog');
    expect(s).toContain('export function useClinicHeader');
  });

  test('회귀: 발행 RPC publish_opinion_doc + 비가역 안내 보존', () => {
    const s = src();
    expect(s).toContain("supabase.rpc('publish_opinion_doc'");
    expect(s).toContain('발행 후에는 수정·취소할 수 없습니다');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S5 — DoctorCallDashboard: 행 '서류' 진입점 + 허브 마운트(AC-1) / 무회귀(AC-8)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S5 AC-1/8 — 대시보드 행 서류 진입점 + 무회귀', () => {
  const src = () => SRC('components/doctor/DoctorCallDashboard.tsx');

  test('AC-1: 대기/완료 두 행 모두 서류 버튼 + onOpenDocs 배선', () => {
    const s = src();
    expect(s).toContain("import DoctorDocsHubDialog from '@/components/doctor/DoctorDocsHubDialog'");
    expect(s).toContain('data-testid="doctor-call-docs-btn"'); // 대기(호출) 행
    expect(s).toContain('data-testid="doctor-completed-docs-btn"'); // 완료 행
    expect(s).toContain('onOpenDocs={openDocsHub}');
    expect(s).toContain('onOpenDocs: (checkIn: CheckIn) => void;');
    // 허브 단일 마운트(부모 레벨)
    expect(s).toContain('<DoctorDocsHubDialog');
  });

  test('AC-1: 서류 진입점은 행 단위 — onOpenDocs(checkIn) 호출', () => {
    const s = src();
    // 두 행에서 onOpenDocs(checkIn) 호출(대기/완료) → 정확히 2회
    const calls = s.match(/onClick=\{\(\) => onOpenDocs\(checkIn\)\}/g) ?? [];
    expect(calls.length).toBe(2);
  });

  test('AC-8 무회귀: 8칼럼 colgroup(신규 칼럼 추가 없이 이름 셀 인라인 보조액션)', () => {
    const s = src();
    // 8칼럼 colspan 상수 보존(서류 버튼은 별도 칼럼이 아니라 이름 셀 내부)
    expect(s).toContain('const DOCDASH_COLSPAN = 8;');
    expect(s).toContain('const DOCDASH_COMPLETED_COLSPAN = 8;');
  });

  test('AC-8 무회귀: MedicalChartPanel(차팅)·QuickRxBar(처방) 기존 진입점 보존', () => {
    const s = src();
    expect(s).toContain('<MedicalChartPanel');
    expect(s).toContain('onOpenChart={openTreatmentChart}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S6 — DoctorTools 4탭 보존(균검사지/소견서 탭 병행 — AC-8)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S6 AC-8 — 기존 진료대시보드 탭 병행 보존', () => {
  test('균검사지·소견서 탭 트리거 잔존(허브 진입점은 추가일 뿐 제거 아님)', () => {
    const s = SRC('pages/DoctorTools.tsx');
    expect(s).toContain('data-testid="tab-koh-report"');
    expect(s).toContain('data-testid="tab-opinion-doc"');
    expect(s).toContain('<OpinionDocTab />');
    expect(s).toContain('<KohReportTab />');
  });
});
