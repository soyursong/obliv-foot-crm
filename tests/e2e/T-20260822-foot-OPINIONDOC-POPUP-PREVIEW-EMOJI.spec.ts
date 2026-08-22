/**
 * E2E spec — T-20260822-foot-OPINIONDOC-POPUP-PREVIEW-EMOJI
 * (canonical; dedup: T-20260822-foot-OPINIONDOC-PREVIEW-PANEL-RESET-EMOJI-REMOVE 회수분 포함)
 *
 * 진료대시보드 > 소견서 작성 팝업 UI 2건 (문지은 대표원장 self-request, 첨부 F0BRWG7MGUE 박스 위치 기준):
 *   요구1. 팝업 가장 우측 단에 '서류 미리보기' 패널 신설(현재 작성 본문 read-only 렌더) + 헤더 우측 '초기화' 버튼.
 *          초기화 = 첫 창 상태(이미 요청받은 항목이 다시 선택된 상태)로 복귀.
 *   요구2. 소견서 헤더 좌측 문서 이모지 제거 + '발행하기' 버튼 좌측 문서 이모지 제거.
 *
 * 성격: FE-only·db_change=false·PHI mutation 0·display_only(회귀 0 필수).
 *   현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200)로 확인.
 *   실브라우저 클릭 시나리오는 하단 체크리스트(갤탭 실기기 현장 confirm 대상).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const tab = () => read('src/components/doctor/OpinionDocTab.tsx');

test.describe('T-20260822-foot-OPINIONDOC-POPUP-PREVIEW-EMOJI — 소견서 팝업 미리보기 패널 + 초기화 + 이모지 제거', () => {

  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── 요구1: '서류 미리보기' 패널 신설 ────────────────────────────────────────
  test('요구1: 우측단에 "서류 미리보기" 패널(read-only) 존재', () => {
    const t = tab();
    expect(t).toContain('data-testid="opinion-preview"');
    expect(t).toContain('서류 미리보기');
    // 본문 = 작성 중 text(SSOT)의 read-only 렌더 + 빈 상태 안내.
    expect(t).toContain('data-testid="opinion-preview-body"');
    expect(t).toContain('data-testid="opinion-preview-empty"');
    // 미리보기는 표시 전용 — pre-wrap 텍스트 렌더(편집기 Textarea 아님).
    expect(t).toContain('whitespace-pre-wrap');
  });

  test('요구1: 3단(우측) 컬럼에 발행이력 + 미리보기 패널이 함께 스택된다', () => {
    const t = tab();
    // 우측 컬럼이 이력(상단)·미리보기(하단)를 동시 렌더 → previewPanel 이 3단 안에 삽입됨.
    expect(t).toContain('{historyPanel}');
    expect(t).toContain('{previewPanel}');
    // 미리보기 패널은 남은 공간 flex-1 로 큰 박스(첨부 스샷 우측 큰 빈 박스 위치).
    expect(t).toMatch(/opinion-preview[\s\S]*flex-1/);
  });

  // ── 요구1: '초기화' 버튼 = 첫 창 상태 복귀 ──────────────────────────────────
  test('요구1: 미리보기 패널 헤더에 "초기화" 버튼 존재', () => {
    const t = tab();
    expect(t).toContain('data-testid="opinion-preview-reset-btn"');
    expect(t).toContain('초기화');
    expect(t).toContain('onClick={handleReset}');
  });

  test('요구1: handleReset = 재바인딩 강제(boundTo=null) → bind 블록 초기화 로직 재실행', () => {
    const t = tab();
    expect(t).toContain('const handleReset = () => {');
    // 첫 창 상태 복원 = boundTo 리셋으로 bind 블록(초기 선택항목 재적용) 재실행.
    expect(t).toContain('setBoundTo(null)');
    // 발건강 질문지 자동체크도 재적용해 '첫 창'과 동일.
    expect(t).toContain('setHealthQAppliedFor(null)');
  });

  test('요구1: bind 블록이 초기 요청항목(initialSelectedKeys)을 선택 상태로 복원한다(초기화 대상)', () => {
    const t = tab();
    // handleReset 이 재실행시키는 bind 블록 = 이미 요청받은 항목 재선택 로직.
    expect(t).toContain('if (open && bindKey !== boundTo)');
    expect(t).toContain('setBoundTo(bindKey)');
    expect(t).toContain('applyPrefillExclusivity(rawKeys, contraindKeySet, initialDocType ?? null)');
    expect(t).toContain('setSelected(new Set(keys))');
  });

  // ── 요구1: display_only — 발급/발행 경로 무접촉 ──────────────────────────────
  test('요구1: 초기화는 로컬 UI 상태만 리셋 — 발행 RPC(publish_opinion_doc) 무접촉', () => {
    const t = tab();
    const resetBlock = t.slice(t.indexOf('const handleReset'), t.indexOf('const resolveIssuer'));
    // 초기화 핸들러 안에서 발행/mutate/supabase 호출이 없어야 함(순수 로컬 리셋).
    expect(resetBlock).not.toContain('publish_opinion_doc');
    expect(resetBlock).not.toContain('mutateAsync');
    expect(resetBlock).not.toContain('supabase');
  });

  // ── 요구2: 이모지 제거 ──────────────────────────────────────────────────────
  test('요구2: 소견서 헤더 제목 좌측 문서 이모지(FileText) 제거', () => {
    const t = tab();
    // 헤더 제목 span 바로 앞의 FileText 아이콘(text-teal-600, h-5 w-5) 제거됨.
    expect(t).not.toContain('<FileText className="h-5 w-5 text-teal-600" />');
    // 제목 텍스트 자체는 유지.
    expect(t).toContain('data-testid="opinion-doc-title"');
  });

  test('요구2: 발행하기 버튼 좌측 문서 이모지(FileText) 제거 — 대기 스피너만 유지', () => {
    const t = tab();
    // 기존: 대기 아니면 <FileText h-3.5 w-3.5> 를 붙이던 라인 제거.
    expect(t).not.toContain('<FileText className="h-3.5 w-3.5" />');
    // 발행 중 스피너(Loader2)는 진행상태 표시라 유지.
    expect(t).toContain('publishMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />');
    expect(t).toContain("publishMut.isPending ? '발행 중…' : '발행하기'");
  });

  // ── 회귀 0: 기존 발행 동선 불변 ─────────────────────────────────────────────
  test('회귀: 발행 버튼/RPC/편집기 SSOT 동선 불변', () => {
    const t = tab();
    expect(t).toContain('data-testid="opinion-publish-btn"');
    expect(t).toContain("supabase.rpc('publish_opinion_doc'");
    expect(t).toContain('data-testid="opinion-editor"'); // 소견 내용 Textarea = 편집 SSOT 유지
    expect(t).toContain('data-testid="opinion-published"'); // 발행 이력 패널 유지
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * 갤탭 실기기 현장 confirm 체크리스트 (supervisor / 문지은 대표원장):
 *   [시나리오1] 진료대시보드 → 소견서 작성 팝업 오픈(이미 요청받은 항목 선택 상태)
 *     → 우측단 "서류 미리보기" 칸 표시 확인
 *     → 초기 선택 외 다른 항목 클릭 → 미리보기 칸에 내용이 서류 형태로 렌더 확인
 *     → '초기화' 클릭 → 첫 창 상태(이미 요청받은 항목 다시 선택 + 미리보기 초기 본문) 복귀 확인
 *   [시나리오2] 소견서 헤더 좌측에 문서 이모지 없음 확인 / '발행하기' 좌측 문서 이모지 없음 확인
 *   [시나리오3] 소견서 정상 작성 → 발행하기 → 발행 이력/서류 출력 정상 반영(기존 동선 불변, 회귀 0)
 * ─────────────────────────────────────────────────────────────────────────────
 */
