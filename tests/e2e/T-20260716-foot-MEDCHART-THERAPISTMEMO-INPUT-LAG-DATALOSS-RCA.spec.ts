/**
 * E2E spec — T-20260716-foot-MEDCHART-THERAPISTMEMO-INPUT-LAG-DATALOSS-RCA
 *
 * 치료메모(치료사) 입력 버벅임 + 데이터 손실 우려 — RCA 선행 후 안정화.
 *
 * [RCA 근본원인] 치료메모 입력 상태(newMemoText/editingMemoText)가 10,777줄 CustomerChartPage
 *   부모에 존재 → 키 입력마다 부모 전체 트리(201 useState·198 비메모 배열연산) 재렌더 → 입력 지연/떨림.
 *   손실: 작성 중 draft 영속 부재 + customer 변경 시 newMemoText 미리셋(교차 bleed).
 *
 * [해소] 입력 상태를 memoized 자식(TreatmentMemoComposer/TreatmentMemoEditor)이 로컬 소유:
 *   AC-1 입력 매끄러움 = 키 입력 시 자식만 재렌더(부모 무재렌더).
 *   AC-2 무손실       = sessionStorage draft(customer별 key)로 재렌더/이탈/새로고침에도 복원, 저장 성공 시 삭제.
 *   AC-3 무회귀       = 저장 payload/트리거·읽기전용(treatment_record)·권한(canManageMemo)·소프트삭제 무변경.
 *
 * ⚠ escalate-back 미해당 근거(소스 단언):
 *   (a) 임상기록(customer_treatment_memos) INSERT/UPDATE 는 '메모 추가/수정 저장' 명시 클릭에만 발생.
 *       draft는 브라우저 sessionStorage 임시버퍼일 뿐 DB 영속 아님(저장 시점·트리거·payload 무변경).
 *   (b) realtime 구독/저장 트리거 무변경. (c) 읽기전용/권한 거동 무변경.
 *
 * screenshot_gate=exempt (렌더-격리/구조 단언형, 실 DB insert 없음). 런타임 '재렌더/이탈 무손실'은
 * field-soak 실기기에서 김태영 대표(풋 의료 R&R)+김주연 총괄 확인 + supervisor 필드 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = (rel: string) => readFileSync(resolve(__dirname, '../../src', rel), 'utf-8');

test.describe('T-20260716-foot-MEDCHART-THERAPISTMEMO-INPUT-LAG-DATALOSS-RCA', () => {
  // ── AC-1: 랙 근본원인 제거 — 입력 상태가 부모에 없음 ──────────────────────
  test('(1) AC-1 랙해소 — 부모(CustomerChartPage)에서 입력 상태 제거(격리)', () => {
    const page = SRC('pages/CustomerChartPage.tsx');
    // 부모 useState로 입력 텍스트를 들고 있지 않음(키 입력→부모 재렌더 원인 제거)
    expect(page.includes("const [newMemoText"), '(1) newMemoText 부모 useState 제거').toBe(false);
    expect(page.includes("const [editingMemoText"), '(1) editingMemoText 부모 useState 제거').toBe(false);
    // 격리 컴포넌트 import + 배선
    expect(
      page.includes("import { TreatmentMemoComposer, TreatmentMemoEditor } from '@/components/TreatmentMemoComposer'"),
      '(1) 격리 컴포넌트 import',
    ).toBe(true);
    expect(page.includes('<TreatmentMemoComposer'), '(1) composer 배선').toBe(true);
    expect(page.includes('<TreatmentMemoEditor'), '(1) editor 배선').toBe(true);
    // 舊 인라인 controlled Textarea(value={newMemoText}) 잔존 금지
    expect(page.includes('value={newMemoText}'), '(1) 舊 인라인 새메모 Textarea 제거').toBe(false);
    expect(page.includes('value={editingMemoText}'), '(1) 舊 인라인 수정 Textarea 제거').toBe(false);
  });

  test('(2) AC-1 — 격리 컴포넌트는 memoized + 로컬 상태 소유', () => {
    const c = SRC('components/TreatmentMemoComposer.tsx');
    // React.memo 로 감싸 export (부모 재렌더가 props 불변 시 자식 재렌더 억제)
    expect(c.includes('export const TreatmentMemoComposer = memo('), '(2) composer memoized').toBe(true);
    expect(c.includes('export const TreatmentMemoEditor = memo('), '(2) editor memoized').toBe(true);
    // 입력 텍스트를 자식 로컬 state로 소유
    expect(/const \[text, setText\] = useState/.test(c), '(2) composer 로컬 text state').toBe(true);
    // onSave 콜백은 부모가 전달(안정) — 저장 로직은 부모 유지
    expect(c.includes('onSave: (text: string) => Promise<boolean>'), '(2) onSave 콜백 시그니처').toBe(true);
  });

  // ── AC-2: 데이터 손실 방어 — draft 시나리오 ───────────────────────────────
  test('(3) AC-2 무손실 — 입력→sessionStorage draft 동기화(재렌더/이탈 보존)', () => {
    const c = SRC('components/TreatmentMemoComposer.tsx');
    // 초기값을 draft에서 복원(이탈 후 재진입/새로고침 시 내용 복원)
    expect(c.includes('useState<string>(() => readDraft(draftKey))'), '(3) 마운트 시 draft 복원').toBe(true);
    // 입력 변경 → draft 기록
    expect(/writeDraft\(draftKey, text\)/.test(c), '(3) 입력 변경 시 draft 기록').toBe(true);
    // 저장 성공 시에만 draft 삭제
    expect(c.includes("writeDraft(draftKey, '')"), '(3) 저장 성공 시 draft 클리어').toBe(true);
    // PHI 위생: localStorage(무기한 잔류) 금지 — sessionStorage(탭 종료 시 소멸)만 사용
    expect(c.includes('sessionStorage'), '(3) sessionStorage 사용').toBe(true);
    expect(c.includes('localStorage'), '(3) localStorage 미사용(공용 태블릿 PHI 잔류 방지)').toBe(false);
  });

  test('(4) AC-2 — draft key는 customer별(교차 bleed 방지) + customer 전환 시 재초기화', () => {
    const page = SRC('pages/CustomerChartPage.tsx');
    // customer.id 별 draft key
    expect(page.includes('draftKey={`foot_txmemo_draft:${customer.id}`}'), '(4) customer별 draftKey').toBe(true);
    const c = SRC('components/TreatmentMemoComposer.tsx');
    // draftKey 변경(=customer 전환) 시 해당 customer draft로 재초기화
    expect(c.includes('prevKey.current !== draftKey'), '(4) draftKey 변경 감지').toBe(true);
    expect(c.includes('setText(readDraft(draftKey))'), '(4) 전환 시 새 customer draft 로드').toBe(true);
  });

  // ── AC-3: 무회귀 — 저장 시맨틱/권한/읽기전용 불변 ─────────────────────────
  test('(5) AC-3 무회귀 — 저장은 명시 클릭에만, payload/트리거 불변(자동저장 미신설)', () => {
    const page = SRC('pages/CustomerChartPage.tsx');
    // 저장 함수는 text 인자만 받고 동일 테이블에 동일 payload로 INSERT/UPDATE
    expect(
      page.includes('const saveNewTreatmentMemo = async (text: string): Promise<boolean>'),
      '(5) saveNew(text) 파라미터화',
    ).toBe(true);
    expect(
      page.includes('const saveTreatmentMemoEdit = async (text: string): Promise<boolean>'),
      '(5) saveEdit(text) 파라미터화',
    ).toBe(true);
    // payload 3필드(content/created_by/created_by_name) 보존
    expect(page.includes('created_by: profile?.email ?? null'), '(5) created_by payload 보존').toBe(true);
    expect(page.includes('created_by_name: profile?.name ?? null'), '(5) created_by_name payload 보존').toBe(true);
    // 격리 컴포넌트 내부에 DB 자동저장(insert/update) 미신설 — 저장은 부모 onSave 경유만
    const c = SRC('components/TreatmentMemoComposer.tsx');
    expect(/\.insert\(|\.update\(|supabase/.test(c), '(5) 컴포넌트 내부 DB 호출 없음(자동저장 미신설)').toBe(false);
  });

  test('(6) AC-3 무회귀 — 읽기전용(treatment_record)·권한(canManageMemo)·소프트삭제 유지', () => {
    const page = SRC('pages/CustomerChartPage.tsx');
    // 치료사차트(treatment_record) 읽기전용 경로는 MedicalChartPanel 소관 — 본 티켓 미접촉(무회귀).
    const mcp = SRC('components/MedicalChartPanel.tsx');
    expect(mcp.includes("setFormTx(chart.treatment_record || '')"), '(6) treatment_record 읽기전용 로드 유지(MedicalChartPanel 미접촉)').toBe(true);
    // 수정/삭제 권한 게이트 유지
    expect(
      page.includes('canManageMemo || (memo.created_by && memo.created_by === profile?.email)'),
      '(6) canManageMemo 권한 게이트 유지',
    ).toBe(true);
    // 치료메모 소프트삭제(의료법 진료기록 보존) 유지
    expect(page.includes("deleted_at: new Date().toISOString(), deleted_by: profile?.email"), '(6) soft-delete 유지').toBe(true);
    // 수정 진입은 editingMemoId만 세팅(텍스트는 editor 로컬 초기화)
    expect(page.includes('onClick={() => setEditingMemoId(memo.id)}'), '(6) 수정 진입 = editingMemoId만').toBe(true);
  });
});
