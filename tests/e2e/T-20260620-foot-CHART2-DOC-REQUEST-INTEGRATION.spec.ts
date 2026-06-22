/**
 * E2E spec — T-20260620-foot-CHART2-DOC-REQUEST-INTEGRATION
 *
 * 본 티켓의 4축(① '소견서'→'서류작성' 탭 rename ② 서류작성 탭 9컬럼 테이블 ③ 2번차트 상담내역
 * 인라인 서류 발행요청 박스 ④ 직원→원장 발행요청 핸드오프: 작성하기(반짝)+prefill+직원메모 연동)은
 * 선행 deploy-ready 티켓 T-20260620-foot-CHART2-OPINION-SELECT-BOX-LINK(commit aabb0a4f)에서
 * AC-1~AC-12로 이미 구현·검증됨(해당 spec 13 PASS).
 *
 * 본 ticket이 추가로 닫는 잔여 갭 = AC-2의 '처방내역' 컬럼.
 *   선행 구현에선 서류작성 큐 '처방내역' 셀이 하드코드 '—' 였음(데이터 소스 미연결).
 *   본 delta: medical_charts.prescription_items(기존 JSONB 컬럼, 20260519 추가) ADDITIVE read →
 *   formatRxItemToken(referralAutoLoad와 동일 패턴) 요약 → 큐 '처방내역' 셀에 표시. 신규 DDL/조인 0.
 *
 * 검증: 현장 PHI 계정 → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) + 9컬럼/경계 회귀 가드.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const queue = () => read('src/components/doctor/DocRequestQueue.tsx');
const lib = () => read('src/lib/opinionRequest.ts');

test.describe('T-20260620-foot-CHART2-DOC-REQUEST-INTEGRATION — 처방내역 컬럼 연동', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // AC-2 delta: 처방내역 데이터 소스 = medical_charts.prescription_items ADDITIVE read
  test('AC-2: 처방내역 소스 = prescription_items ADDITIVE read', () => {
    const l = lib();
    // 기존 medical_charts 조회 select에 prescription_items 가산(신규 테이블/조인 없음)
    expect(l).toContain('prescription_items');
    expect(l).toContain("from('medical_charts')");
    // ClinicalSnap 에 prescription 필드 추가
    expect(l).toContain('prescription: string | null');
    // formatRxItemToken(referralAutoLoad 동일 패턴) 재사용 — 신규 요약 스택 금지
    expect(l).toContain("from '@/lib/rxTooltip'");
    expect(l).toContain('formatRxItemToken');
    expect(l).toContain('summarizeRxItems');
  });

  // AC-2 delta: 큐 '처방내역' 셀이 하드코드 '—' 가 아니라 snap.prescription 렌더
  //   ※ T-20260620-foot-DOCDASH-DOCREQ-TABLEVIEW: RXCLIN 표현 상속으로 셀이 미리보기+드롭다운(클릭 펼침)으로 리워크 →
  //     렌더 패턴이 `const rx = snap?.prescription || null` → `{rx || '—'}` 로 변경. stale 단언 갱신(데이터소스·폴백 의미 보존).
  test('AC-2: 서류작성 큐 처방내역 셀이 실데이터(snap.prescription) 렌더', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-cell-rx"');
    expect(q).toContain('snap?.prescription');
    // 처방내역 셀이 더 이상 무조건 '—' 만 출력하지 않음(데이터 있으면 표시, 없으면 '—' 폴백)
    expect(q).toContain('const rx = snap?.prescription || null');
    expect(q).toContain("{rx || '—'}");
  });

  // 회귀0: 9컬럼 헤더 전부 보존(선행 AC-11)
  test('회귀0: 서류작성 큐 9컬럼 헤더 보존', () => {
    const q = queue();
    for (const col of ['이름', '생년', '차트번호', '오늘시술', '처방내역', '임상경과', '서류종류', '해당항목', '발행']) {
      expect(q).toContain(col);
    }
  });

  // 회귀0(authoring 경계): 큐는 발행하지 않음 — 발행은 publish_opinion_doc RPC(원장 전용) 유지
  test('회귀0: authoring 경계 — 큐 비발행 유지', () => {
    const q = queue();
    expect(q).not.toContain("rpc('publish_opinion_doc'");
    const l = lib();
    // 데이터 레이어(실장 경로)도 draft 만 — 발행 RPC 직접 호출 없음
    expect(l).not.toContain("rpc('publish_opinion_doc'");
    expect(l).toContain("status: 'draft'");
  });
});

/**
 * 현장 클릭 시나리오 (실브라우저 수동 검증 체크리스트):
 *
 * [시나리오1] 처방내역 표시 — AC-2
 *   1. 원장 로그인 → 진료대시보드 → "서류작성" 탭
 *   2. 데스크 발행요청이 있는 환자 행에서 '처방내역' 컬럼 확인
 *   3. 해당 환자의 최근 진료차트(medical_charts)에 처방약(prescription_items)이 있으면
 *      약물명 토큰('약물명 용량, …')이 표시되고, 없으면 '—' 폴백
 *   Expected: 처방내역이 차트 처방 데이터로 채워짐(이전 하드코드 '—' 해소). 조회 실패해도 큐 무파손.
 *
 * [시나리오2] 4축 통합 동선(선행 ticket 재확인) — 본 ticket 범위 내 회귀
 *   1. 실장 2번차트 상담내역 → 서류종류+항목 선택 → 발행요청
 *   2. 원장 서류작성 탭 큐에 반짝 행 → [작성하기] → prefill+직원메모 → 발행 → 큐 제거
 *   Expected: 선행 구현 동선 무회귀(탭명 '서류작성', 9컬럼, 핸드오프 정상).
 *
 * 비고: prescription_items = 기존 컬럼(20260519000080_medchart_revamp) ADDITIVE read. NO-DDL.
 *   DA CONSULT/supervisor DDL-diff 불요(신규 컬럼/테이블/enum/RLS 0).
 */
