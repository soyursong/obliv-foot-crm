/**
 * E2E spec — T-20260620-foot-CHART2-OPINION-SELECT-BOX-LINK
 * 상담내역 탭(실장영역)에 '원장님께 요청드릴 소견서/진단서 내용 선택' 박스 신설 →
 * 진료 대시보드 '서류작성' 큐(원장영역)로 연동. 발행은 원장 전용(authoring 경계 불변).
 *
 * AC-1  : 진료대시보드 소견서 선택박스(서류종류+옵션그리드)를 상담내역에 인라인 포팅.
 * AC-2  : 실장 선택 → 저장(요청 메타 draft 생성).
 * AC-3  : 원장 진료대시보드 '서류작성' 큐로 전달(연동).
 * AC-4  : ★authoring 경계(BLOCKING) — 실장 박스는 '요청/참고'만. 발행 본문 작성·확정 = 원장 전용.
 *         발행은 publish_opinion_doc RPC(is_doctor_role 게이트)로만. 큐/실장박스에 발행 행위 없음.
 * AC-5  : 회귀0 — 기존 OpinionDocTab(금일 내방객 소견서) 동선 보존.
 * AC-6  : 서류종류 2종(소견서/진단서) 토글.
 * AC-7  : 해당항목 옵션 그리드(진단서/금기증) 다중 토글.
 * AC-8  : 인라인 배치(팝업 제거) — 상담내역 구역에 박스 직접 렌더.
 * AC-9  : 진료대시보드 '서류작성' 큐 — '작성하기' 버튼 + 반짝효과(신규 요청 시각화).
 * AC-10 : 원장 작성하기 → 좌측 prefill(선택항목 미리채움) + 실장 메모 참고 패널.
 * AC-11 : 서류작성 큐 9컬럼(이름/생년/차트번호/오늘시술/처방내역/임상경과/서류종류/해당항목/발행).
 * AC-12 : 균검사지 옆 '소견서' 탭 → '서류작성' 리네임(value/data-testid 보존).
 *
 * 검증 방식: 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) +
 *   authoring 경계 회귀 가드. 실브라우저 클릭 시나리오는 하단 체크리스트.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const reqBox = () => read('src/components/consult/OpinionRequestBox.tsx');
const queue = () => read('src/components/doctor/DocRequestQueue.tsx');
const lib = () => read('src/lib/opinionRequest.ts');
const docTools = () => read('src/pages/DoctorTools.tsx');
const opinionTab = () => read('src/components/doctor/OpinionDocTab.tsx');
const chart = () => read('src/pages/CustomerChartPage.tsx');

test.describe('T-20260620-foot-CHART2-OPINION-SELECT-BOX-LINK — 소견서 선택박스 연동', () => {

  // 앱 정상 로드 (회귀 가드)
  test('AC-5: 앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // AC-1 / AC-8: 상담내역에 선택박스 인라인 포팅(팝업 아님)
  test('AC-1/AC-8: 상담내역 인라인 소견서 선택박스 렌더', () => {
    const c = chart();
    // 상담내역 박스가 별도 컴포넌트로 인라인 배치
    expect(c).toContain('OpinionRequestBox');
    expect(c).toContain('import OpinionRequestBox');
    const box = reqBox();
    // 인라인 박스 식별자(상담내역 2줄 섹션 앵커)
    expect(box).toContain('data-testid="consult-section-opinion"');
    // 팝업(Dialog)으로 띄우지 않음 — 박스 자체에 Dialog 마운트 없음
    expect(box).not.toContain('<Dialog');
    // OPINION_SECTIONS 재사용(진료대시보드 자산 포팅)
    expect(box).toContain("from '@/components/doctor/OpinionDocTab'");
    expect(box).toContain('OPINION_SECTIONS');
  });

  // AC-6: 서류종류 2종(소견서/진단서) 토글
  test('AC-6: 서류종류 소견서/진단서 2종 토글', () => {
    const box = reqBox();
    expect(box).toContain('data-testid="opinion-req-doctype"');
    // 동적 testid: opinion-req-doctype-${t.value} (opinion/diagnosis 양쪽 OPINION_DOC_TYPES 순회)
    expect(box).toContain('opinion-req-doctype-${t.value}');
    // 데이터 레이어에 2종 정의
    const l = lib();
    expect(l).toContain("value: 'opinion'");
    expect(l).toContain("value: 'diagnosis'");
  });

  // AC-7: 해당항목 옵션 그리드 다중 토글
  test('AC-7: 해당항목 옵션 그리드 다중 토글', () => {
    const box = reqBox();
    expect(box).toContain('data-testid="opinion-req-options"');
    expect(box).toContain('opinion-req-opt-');
    // OPINION_SECTIONS 순회 렌더 + Set 기반 다중선택
    expect(box).toContain('OPINION_SECTIONS.map');
    expect(box).toContain('Set<string>');
  });

  // AC-2: 실장 선택 → 저장(요청 draft 생성)
  test('AC-2: 발행 요청 저장(draft 생성)', () => {
    const box = reqBox();
    expect(box).toContain('useCreateOpinionRequest');
    expect(box).toContain('data-testid="opinion-req-submit"');
    const l = lib();
    // draft 상태로 form_submissions insert — 발행(published) 아님
    expect(l).toContain("status: 'draft'");
    expect(l).toContain("request_origin: 'staff_consult'");
    expect(l).toContain('from(\'form_submissions\')');
  });

  // AC-4 (BLOCKING): authoring 경계 — 실장 박스에 발행 행위 없음
  test('AC-4: 실장 박스는 요청만 — 발행(publish) 행위 없음', () => {
    const box = reqBox();
    // 실장 박스에서 발행 RPC 직접 호출 금지
    expect(box).not.toContain('publish_opinion_doc');
    expect(box).not.toContain('OpinionEditorDialog');
    // 안내 문구로 경계 명시(발행=원장)
    expect(box).toContain('발행은 원장');
    const l = lib();
    // 데이터 레이어도 실장 경로는 draft만 — publish RPC 호출 없음(주석 언급은 경계 문서화로 허용)
    expect(l).not.toContain("rpc('publish_opinion_doc'");
  });

  // AC-3 / AC-11: 원장 서류작성 큐 9컬럼 연동
  test('AC-3/AC-11: 진료대시보드 서류작성 큐 9컬럼', () => {
    const q = queue();
    expect(q).toContain('useOpinionRequestQueue');
    expect(q).toContain('data-testid="docreq-table"');
    // 9컬럼 헤더 전부 존재
    for (const col of ['이름', '생년', '차트번호', '오늘시술', '처방내역', '임상경과', '서류종류', '해당항목', '발행']) {
      expect(q).toContain(col);
    }
    // 큐 모집단 = staff_consult draft (실장 요청만)
    const l = lib();
    expect(l).toContain("=== 'staff_consult'");
    expect(l).toContain("eq('status', 'draft')");
  });

  // AC-9: 작성하기 버튼 + 반짝효과
  test('AC-9: 작성하기 버튼 + 반짝(animate-ping) 효과', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-write-btn"');
    expect(q).toContain('작성하기');
    expect(q).toContain('animate-ping');
  });

  // AC-10: 작성하기 → prefill + 실장 메모 참고 패널
  test('AC-10: 작성하기 → prefill + 실장 메모 참고', () => {
    const q = queue();
    // 큐 → OpinionEditorDialog 로 prefill props 전달
    expect(q).toContain('OpinionEditorDialog');
    expect(q).toContain('initialSelectedKeys');
    expect(q).toContain('initialDocType');
    expect(q).toContain('staffRequestMemo');
    // 발행본 작성·확정은 OpinionEditorDialog(원장 전용)에서
    const tab = opinionTab();
    expect(tab).toContain('initialSelectedKeys');
    expect(tab).toContain('data-testid="opinion-staff-request-memo"');
    // 발행 성공 시 요청 resolve(큐 제거)
    expect(q).toContain('onPublished');
    expect(q).toContain('useResolveOpinionRequest');
  });

  // AC-4 (BLOCKING): 발행은 원장 전용 RPC로만 — 큐는 발행하지 않음
  test('AC-4: 발행 = publish_opinion_doc RPC(원장 전용)로만, 큐는 비발행', () => {
    const q = queue();
    // 큐 자체는 발행 RPC 직접 호출 안 함(작성창 경유)
    expect(q).not.toContain("rpc('publish_opinion_doc'");
    // 발행 RPC는 OpinionEditorDialog(원장 작성창)에만
    const tab = opinionTab();
    expect(tab).toContain('publish_opinion_doc');
  });

  // AC-12: 탭 리네임 소견서 → 서류작성 (value/data-testid 보존)
  test('AC-12: 균검사지 옆 탭 라벨 소견서→서류작성, value 보존', () => {
    const d = docTools();
    // 탭 라벨 텍스트
    expect(d).toContain('서류작성');
    // value/data-testid 보존(E2E·탭 상태키 무변경)
    expect(d).toContain('value="opinion_doc"');
    expect(d).toContain('data-testid="tab-opinion-doc"');
    // 큐 + 기존 OpinionDocTab 둘 다 렌더(AC-5 회귀0)
    expect(d).toContain('<DocRequestQueue');
    expect(d).toContain('<OpinionDocTab');
  });

  // AC-5: 회귀0 — 기존 OpinionDocTab 자산(금일 내방객) 보존
  test('AC-5: 기존 OpinionDocTab 자산·export 보존', () => {
    const tab = opinionTab();
    // 포팅 대상 자산이 export로 유지(상담박스·큐가 재사용)
    expect(tab).toContain('export');
    expect(tab).toContain('OPINION_SECTIONS');
    expect(tab).toContain('OpinionEditorDialog');
    // 기존 발행 동선(원장 자발) 토글/RPC 보존
    expect(tab).toContain('publish_opinion_doc');
  });
});

/**
 * 현장 클릭 시나리오 (실브라우저 수동 검증 체크리스트 — 단계별 확인 의무):
 *
 * [시나리오1] 실장 요청 → 원장 작성 (정상 동선) — AC-1/2/3/6/7/9/10/11
 *   1. 실장 로그인 → 고객 차트(2번차트) → "상담내역" 탭
 *   2. '소견서 & 진단서 요청' 박스에서 서류종류(소견서/진단서) 선택 → 해당항목 옵션 다중 토글
 *   3. (선택) 메모 입력 → [발행 요청] 클릭 → "원장님께 보냈습니다" 토스트, 박스 하단 '처리 대기' 표시
 *   4. 원장 로그인 → 진료대시보드 → "서류작성" 탭 → 큐 9컬럼에 해당 요청 행 표시(반짝효과)
 *   5. [작성하기] 클릭 → 발행창 좌측에 실장이 고른 항목 미리채움 + '실장 요청(참고)' 메모 패널 표시
 *   6. 원장이 내용 확인·수정 후 [발행] → 발행 완료, 해당 요청은 큐에서 사라짐
 *   Expected: 실장 요청 메타가 원장 큐로 전달, prefill·메모 참고 정상, 발행 후 큐 제거.
 *
 * [시나리오2] authoring 경계 가드 (BLOCKING) — AC-4
 *   1. 실장 상담내역 박스에는 [발행] 버튼 없음 — [발행 요청]만 존재 확인
 *   2. 서류작성 큐(원장)에서 [작성하기]는 발행창을 '열기'만 — 큐 자체가 발행하지 않음 확인
 *   3. 발행은 발행창에서 원장 권한(is_doctor_role)으로만 수행 — 비원장 계정은 발행 RPC 거부
 *   Expected: 실장=요청만, 원장=발행. 발행 권한 우회 경로 없음.
 *
 * [시나리오3] 엣지 — 내원 이력 없는 고객 — AC-2/AC-11
 *   1. check_in 이력이 없는 고객에서 발행 요청
 *   2. 요청은 전달되나 토스트로 '내원 확인 필요' 안내, 큐 발행열에 '내원확인 필요' 뱃지
 *   Expected: 요청 자체는 정상 저장, 발행 앵커 부재 안내. 에러/크래시 없음.
 *
 * 비고: form_submissions status='draft' + field_data.request_origin='staff_consult' 재사용(NO-DDL).
 *   발행본 immutability·is_doctor_role 게이트는 publish_opinion_doc RPC(20260616160000)에 불변 유지.
 */
