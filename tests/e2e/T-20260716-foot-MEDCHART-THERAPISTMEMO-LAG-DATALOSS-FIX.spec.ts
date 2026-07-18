/**
 * E2E spec — T-20260716-foot-MEDCHART-THERAPISTMEMO-LAG-DATALOSS-FIX
 *
 * RCA(T-20260716-…-RCA) 후속 FIX. 치료사 메모 입력 렉 + draft 유실 안정화.
 * 요구 3 시나리오 = (A)렉 / (B)draft복원 / (C)RLS 0-row 에러화.  AC 기준 = 치료메모.
 *
 * [수정 핵심]
 *  (A) 렉  : 입력 텍스트를 god-component 부모(CustomerChartPage, 201 useState)에서
 *            memoized 자식(TreatmentMemoComposer/Editor) 로컬 state로 격리
 *            → 키 입력 시 부모 무재렌더.
 *  (B) 유실: ① sessionStorage draft(고객ID별 key) — 창닫기/새로고침/고객전환 후 복원,
 *            ② 저장 성공 시 무조건 setNewMemoText('') 초기화 제거(부모 상태 폐지) →
 *               잔여 입력은 자식이 소유하며 성공 시에만 클리어,
 *            ③ edit .update()+.select()로 RLS 0-row silent-fail을 명시 에러로 표면화.
 *  db_change=false (스키마/마이그 0). RLS 정책 무변경 — 0-row '감지'만 추가.
 *
 * screenshot_gate=exempt (렌더-격리/구조 단언형). 런타임 '재렌더/이탈 무손실'·현장 체감은
 * field-soak 실기기에서 김주연 총괄 + 김태영 대표(풋 의료 R&R) 확인 + supervisor 필드 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = (rel: string) => readFileSync(resolve(__dirname, '../../src', rel), 'utf-8');

test.describe('T-20260716-foot-MEDCHART-THERAPISTMEMO-LAG-DATALOSS-FIX', () => {
  // ── (A) 렉 — 입력 상태 부모 격리 ──────────────────────────────────────────
  test('(A) 렉해소 — 입력 상태가 부모(CustomerChartPage)에 없고 memoized 자식이 로컬 소유', () => {
    const page = SRC('pages/CustomerChartPage.tsx');
    // 부모 useState 로 입력 텍스트를 들지 않음(키 입력→부모 전체 재렌더 원인 제거)
    expect(page.includes('const [newMemoText'), '(A) newMemoText 부모 state 제거').toBe(false);
    expect(page.includes('const [editingMemoText'), '(A) editingMemoText 부모 state 제거').toBe(false);
    expect(page.includes('value={newMemoText}'), '(A) 舊 인라인 controlled Textarea 제거').toBe(false);
    expect(page.includes('value={editingMemoText}'), '(A) 舊 인라인 수정 Textarea 제거').toBe(false);
    // 격리 컴포넌트 배선
    expect(
      page.includes("import { TreatmentMemoComposer, TreatmentMemoEditor } from '@/components/TreatmentMemoComposer'"),
      '(A) 격리 컴포넌트 import',
    ).toBe(true);
    expect(page.includes('<TreatmentMemoComposer'), '(A) composer 배선').toBe(true);
    expect(page.includes('<TreatmentMemoEditor'), '(A) editor 배선').toBe(true);

    const c = SRC('components/TreatmentMemoComposer.tsx');
    // React.memo + 로컬 text state (props 불변 시 부모 재렌더가 자식으로 전파되지 않음)
    expect(c.includes('export const TreatmentMemoComposer = memo('), '(A) composer memoized').toBe(true);
    expect(c.includes('export const TreatmentMemoEditor = memo('), '(A) editor memoized').toBe(true);
    expect(/const \[text, setText\] = useState/.test(c), '(A) 자식 로컬 text state').toBe(true);
    // 자식은 저장 로직을 직접 갖지 않음 — DB 호출은 부모 onSave 경유(자동저장 미신설)
    expect(/\.insert\(|\.update\(|supabase/.test(c), '(A) 자식 내부 DB 직접호출 없음').toBe(false);
  });

  // ── (B) draft 복원 — 창닫기/새로고침/고객전환 무손실 ─────────────────────
  test('(B) draft복원 — sessionStorage(고객ID key) 저장·복원·전환재초기화, 성공시에만 클리어', () => {
    const c = SRC('components/TreatmentMemoComposer.tsx');
    // ① 마운트 시 draft 복원(창닫기/새로고침 후 재진입 시 작성중 텍스트 복원)
    expect(c.includes('useState<string>(() => readDraft(draftKey))'), '(B①) 마운트 draft 복원').toBe(true);
    // 입력 변경 → draft 기록
    expect(/writeDraft\(draftKey, text\)/.test(c), '(B①) 입력 변경 시 draft 기록').toBe(true);
    // ② 저장 성공 시에만 클리어(무조건 초기화 폐지 → 잔여 보존)
    expect(c.includes("writeDraft(draftKey, '')"), '(B②) 저장 성공 시에만 draft 클리어').toBe(true);
    // PHI 위생 — 공용 태블릿 무기한 잔류 방지: localStorage 금지, sessionStorage(탭 종료 소멸)만
    expect(c.includes('sessionStorage'), '(B) sessionStorage 사용').toBe(true);
    expect(c.includes('localStorage'), '(B) localStorage 미사용(PHI 잔류 방지)').toBe(false);

    const page = SRC('pages/CustomerChartPage.tsx');
    // 고객ID별 draft key (교차 bleed 방지)
    expect(page.includes('draftKey={`foot_txmemo_draft:${customer.id}`}'), '(B) 고객ID별 draftKey').toBe(true);
    // 고객 전환(draftKey 변경) 시 해당 고객 draft로 재초기화
    expect(c.includes('prevKey.current !== draftKey'), '(B) 고객 전환 감지').toBe(true);
    expect(c.includes('setText(readDraft(draftKey))'), '(B) 전환 시 새 고객 draft 로드').toBe(true);
    // 舊 무조건 초기화(setNewMemoText('')) 부모 경로 소멸
    expect(page.includes("setNewMemoText('')"), '(B②) 舊 부모 무조건 초기화 경로 제거').toBe(false);
  });

  // ── (C) RLS 0-row 에러화 — edit silent-fail 표면화 ───────────────────────
  test('(C) RLS에러 — edit .update().select() + 0-row 감지 → 낙관적 성공 차단', () => {
    const page = SRC('pages/CustomerChartPage.tsx');
    // .update(...).eq(...).select() — 반영된 행을 회수(RLS USING 미매치 시 0행)
    expect(/\.update\(\{ content, updated_at: now \}\)/.test(page), '(C) UPDATE payload 불변').toBe(true);
    expect(page.includes(".select('id')"), '(C) .select()로 반영행 회수').toBe(true);
    // 0-row → 명시 에러(toast) + false 반환(낙관적 반영 차단)
    expect(page.includes('if (!data || data.length === 0)'), '(C) 0-row 감지 분기').toBe(true);
    expect(
      /toast\.error\([^)]*수정[^)]*(권한|반영)/.test(page),
      '(C) 0-row 시 명시 에러 노출',
    ).toBe(true);
    // silent-fail 방지: 0-row 경로에서 낙관적 목록 갱신/성공 종료가 발생하지 않음(return false 선행)
    const editFn = page.slice(
      page.indexOf('const saveTreatmentMemoEdit'),
      page.indexOf('const saveTreatmentMemoEdit') + 1200,
    );
    expect(
      editFn.indexOf('data.length === 0') < editFn.indexOf('setTreatmentMemos(prev'),
      '(C) 0-row 차단이 낙관적 setTreatmentMemos 보다 선행',
    ).toBe(true);
  });
});
