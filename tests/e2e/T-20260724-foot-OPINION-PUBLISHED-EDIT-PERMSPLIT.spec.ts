/**
 * E2E spec — T-20260724-foot-OPINION-PUBLISHED-EDIT-PERMSPLIT
 * 발행된 소견서/진단서 상세/열람 화면에서 필드 단위 편집권한 분리:
 *   - A부류(잠금/읽기전용): 진단소견·의사소견 = 원장 작성 medical content(발행 고정본, 의료법§22).
 *   - B부류(원내 직원 편집): 발급요청일자·상병코드·담당의·발급일 = 행정·발급 metadata.
 *
 * 확정 필드표 (문지은 대표원장 relay confirm, thread 1784882479.542659 — confirm_status=confirmed_by_relay):
 *   LOCKED = {진단소견, 의사소견} / EDITABLE = {발급요청일자, 상병코드, 담당의, 발급일}.
 *
 * 핵심 설계(AC4 발행 원문 스냅샷 불오염, NO-DDL):
 *   - 발행본(form_submissions status='published')은 DB 트리거·RLS 로 immutable — 절대 미접촉.
 *   - B부류 편집 오버레이는 '요청 행'(status='voided'+resolved_reason='published', RLS status<>'published' 로
 *     mutable) field_data 에 append(발급요청일자=request_date 직접 / 담당의·발급일·상병코드=admin_overrides).
 *   - 열람/재출력 시 renderOpinionDocHtml override 로 오버레이를 발행본 위에 얹어 렌더(published snapshot 불변).
 *   - 상병코드=medical-adjacent → 편집 감사로그(admin_edit_log: 누가·언제·이전값→새값)로 의료법§22 정합.
 *   - AC5 NOSYNC 정합: 옛 전체 '수정 팝업' 부활 아님 — 재출력/열람 동선 유지 + 행정필드 전용 인라인 패널만 추가.
 *
 * 검증 방식: 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200).
 *   실브라우저 클릭 시나리오는 하단 체크리스트(갤탭 실기기 현장 confirm 대상).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const queue = () => read('src/components/doctor/DocRequestQueue.tsx');
const formView = () => read('src/components/doctor/IssuedOpinionDocFormView.tsx');
const reqLib = () => read('src/lib/opinionRequest.ts');

test.describe('T-20260724-foot-OPINION-PUBLISHED-EDIT-PERMSPLIT — 발행본 필드 편집권한 분리', () => {

  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC2: A부류(원장 작성 내용) 읽기전용 잠금 표시 ─────────────────────────────
  test('AC2: 진단소견·의사소견 = 읽기전용 잠금 배너(회색·잠금 아이콘)', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-admin-lock-banner"');
    expect(q).toContain('<Lock');
    expect(q).toContain('진단소견·의사소견');
    expect(q).toContain('수정할 수 없어요');
  });

  // ── AC3: B부류 4필드 인라인 편집 + 저장 ──────────────────────────────────────
  test('AC3: 행정·발급 4필드(발급요청일자·상병코드·담당의·발급일) 편집 입력 + 저장 버튼', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-admin-edit-panel"');
    expect(q).toContain('data-testid="docreq-admin-request-date"');
    expect(q).toContain('data-testid="docreq-admin-diag-code"');
    expect(q).toContain('data-testid="docreq-admin-doctor-name"');
    expect(q).toContain('data-testid="docreq-admin-issue-date"');
    expect(q).toContain('data-testid="docreq-admin-save-btn"');
    // 저장 mutation 결선 + 성공/실패 토스트.
    expect(q).toContain('useUpdateOpinionAdminFields');
    expect(q).toContain('adminMut.mutateAsync');
    expect(q).toContain("toast.success('행정 정보를 저장했습니다.')");
    expect(q).toContain('toast.error(');
    // 변경 없으면 저장 비활성(dirty 가드).
    expect(q).toContain('disabled={!adminDirty || adminMut.isPending}');
  });

  test('AC3: 변경된 필드만 전달(미변경=undefined → 오버레이/로그 미생성)', () => {
    const q = queue();
    expect(q).toContain('adminForm.requestDate !== adminInit.requestDate ? adminForm.requestDate : undefined');
    expect(q).toContain('adminForm.diagCode !== adminInit.diagCode ? adminForm.diagCode : undefined');
    expect(q).toContain('adminForm.issueDate !== adminInit.issueDate ? adminForm.issueDate : undefined');
    // 담당의(진료의) 정정: 이름·id 앵커를 함께 전달(도장 자동추종 AC-6/AC-7). ATTENDINGDR(7decbe69)
    // OR-guard 재작성 — 이름 또는 id 어느 쪽이 바뀌어도 둘 다 전송, 둘 다 미변경이면 양쪽 undefined
    // (오버레이/로그 미생성 불변). AC3 "변경분만 전달" intent 보존.
    const doctorGuard = 'adminForm.doctorName !== adminInit.doctorName || adminForm.doctorId !== adminInit.doctorId';
    expect(q).toContain(doctorGuard);                                        // OR-guard 신규식(이름·id 동시 판정)
    expect(q).toContain('? adminForm.doctorName : undefined');               // doctorName: 변경 시 전송 / 미변경 undefined
    expect(q).toContain('? (adminForm.doctorId || undefined) : undefined');  // doctorId 변경 케이스 보강(앵커 저장)
  });

  // ── AC4: 발행 원문 스냅샷 불오염 — published 미접촉 ───────────────────────────
  test('AC4: 저장은 요청행(voided)에만 write — published 원본 절대 미접촉', () => {
    const l = reqLib();
    expect(l).toContain('export function useUpdateOpinionAdminFields');
    // 경계 가드: published 차단 + 발행완료 요청행만.
    expect(l).toContain("if (row?.status === 'published') throw new Error");
    expect(l).toContain("if (prev['resolved_reason'] !== 'published') throw new Error");
    expect(l).toContain("if (prev['request_origin'] !== 'staff_consult') throw new Error");
    // update 대상 = status='voided' 요청행만(published 미접촉).
    expect(l).toContain(".eq('status', 'voided')");
    // 본문(A부류) 키는 write 대상에 없음 — final_text/diagnosis_ko/treatment_opinion 미기록.
    const fnStart = l.indexOf('export function useUpdateOpinionAdminFields');
    const fnEnd = l.indexOf('// ─── 큐 행 임상 컬럼', fnStart);
    const fn = l.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 4000);
    expect(fn).not.toContain('final_text');
    expect(fn).not.toContain('diagnosis_ko');
    expect(fn).not.toContain('treatment_opinion');
    expect(fn).not.toContain("rpc('publish_opinion_doc'");
  });

  test('AC4(감사로그): 변경 필드마다 누가·언제·이전값→새값 append(의료법§22, 상병코드=medical-adjacent)', () => {
    const l = reqLib();
    expect(l).toContain('admin_edit_log');
    expect(l).toContain('const pushLog = (field: string, fieldLabel: string, oldValue: string, newValue: string)');
    // 무변경은 기록 안 함(실 변경만).
    expect(l).toContain('if (oldValue === newValue) return;');
    // 상병코드 정정도 감사로그 대상.
    expect(l).toContain("pushLog('diag_code', '상병코드', oldV, newV)");
    // provenance = 편집자 id + 표기명.
    expect(l).toContain('by: input.editorId');
    expect(l).toContain('byName: input.editorName');
  });

  // ── 오버레이 파싱/타입 ────────────────────────────────────────────────────────
  test('오버레이: AdminFieldOverrides 타입 + parseAdminOverrides + 발행완료 행에서 파싱', () => {
    const l = reqLib();
    expect(l).toContain('export interface AdminFieldOverrides');
    expect(l).toContain('export function parseAdminOverrides');
    // 완료 그룹(발행본 열람 소스)에서 오버레이+로그 파싱.
    expect(l).toContain('adminOverrides: parseAdminOverrides(fd)');
    expect(l).toContain('adminOverrides?: AdminFieldOverrides;');
  });

  // ── AC3/AC7: 오버레이가 열람/재출력 양식에 반영(published 위에 얹음) ────────────
  test('AC3/AC7: B부류 오버레이를 발행본 위에 얹어 렌더(담당의·발급일·상병코드 override)', () => {
    const fv = formView();
    expect(fv).toContain('adminOverrides');
    // 담당의/발급일 = 오버레이 우선 → 발행본 스냅샷 폴백.
    expect(fv).toContain('adminOverrides?.doctorName || viewDoc?.doctorName');
    expect(fv).toContain('adminOverrides?.issueDate');
    // 상병코드 = 오버레이 있으면 primary(diag_code_1)만 override.
    expect(fv).toContain('adminOverrides?.diagCode');
    // 큐 → 뷰로 오버레이 전달.
    const q = queue();
    expect(q).toContain('adminOverrides={viewTarget?.adminOverrides}');
  });

  // ── AC5: NOSYNC 정합 — 옛 전체 '수정 팝업' 부활 아님 ─────────────────────────
  test('AC5(NOSYNC 정합): 발행 경로(publish RPC) 미접촉 — 재출력 동선 유지 + 행정필드 인라인만 추가', () => {
    const q = queue();
    // 열람 뷰어에 발행/취소 RPC 부활 없음(행정필드 편집은 별도 인라인 패널).
    expect(q).not.toContain("rpc('publish_opinion_doc'");
    // 뷰어는 여전히 발행본 양식 열람(IssuedOpinionDocFormView) — 재출력/열람 동선 유지.
    expect(q).toContain('<IssuedOpinionDocFormView');
    const fv = formView();
    // 뷰 렌더러는 write(insert/update/delete) 없음 — 순수 렌더(저장은 큐의 mutation 경유).
    expect(fv).not.toContain('.insert(');
    expect(fv).not.toContain('.update(');
    expect(fv).not.toContain('.delete(');
  });
});

/**
 * 현장 클릭 시나리오 (갤탭 실기기 현장 confirm 체크리스트 — 단계별 확인 의무):
 *
 * [시나리오1] 정상 동선 — 행정필드만 편집 (AC1~AC4, AC7)
 *   1. 원내 직원(데스크/실장) 로그인 → 진료대시보드 → 서류작성 탭 → '서류 완료' 그룹
 *   2. 소견서 발행 이력 환자의 발행 서류명 클릭 → 발행본 열람 패널 열림
 *   3. 진단소견·의사소견 영역이 잠금(읽기전용) 안내로 표시되고 편집 불가한지 확인
 *   4. 아래 '행정·발급 정보 정정' 패널에서 발급요청일자를 다른 날짜로 변경 → '행정 정보 저장' → 성공 토스트
 *   5. 패널 재진입 시 발급요청일자는 바뀐 값, 진단/의사 소견은 발행 원문 그대로 유지 확인
 *   6. 담당의·발급일·상병코드 정정 시 양식(재출력) 미리보기에 반영되는지 확인
 *   Expected: 의사 소견은 불변, 행정필드만 정정·반영.
 *
 * [시나리오2] 엣지 — 상병코드 정정 감사로그 (AC4, 의료법§22)
 *   1. 상병코드를 정정 후 저장 → 이후 정정 내역(누가·언제·이전값→새값)이 감사로그에 남는지(운영 조회) 확인
 *   Expected: 상병코드=medical-adjacent → 감사 추적 가능.
 *
 * [시나리오3] 엣지 — 발행 원문 스냅샷 불오염 (AC4)
 *   1. 행정필드 저장이 발행본(published) 원본 본문·소견을 변경하지 않는지(재출력/열람 본문 불변) 확인
 *   Expected: 발행 원문(A부류)은 어떤 경로로도 불변.
 *
 * 비고(NO-DDL/경계): 오버레이 = form_submissions.field_data(JSONB) 재사용 — 신규 컬럼/테이블/RPC/마이그 = 0(db_change=false).
 *   published row 는 DB 트리거·RLS(status<>'published')로 immutable — write 대상은 요청행(voided)만.
 *   ★confirm gate: 문지은 대표원장 필드분류 relay confirm(confirm_status=confirmed_by_relay) → 착수·deploy GO.
 *   ★sibling: 치료테이블 side 는 T-20260724-foot-TREATTABLE-DOCS-PARITY 가 커버(필드표 동일 SSOT).
 */
