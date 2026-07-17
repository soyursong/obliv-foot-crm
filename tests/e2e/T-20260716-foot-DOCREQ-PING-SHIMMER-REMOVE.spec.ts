/**
 * E2E spec — T-20260716-foot-DOCREQ-PING-SHIMMER-REMOVE
 *
 * 진료 알림판(진료 대시보드 → DocRequestQueue) '작성하기' 버튼 주위의
 * 청록 반짝임(animate-ping teal-400/40 ripple) 제거.
 *   - 현장(김주연 총괄, slack ts 1784110215.729589) 원인 확정: DocRequestQueue 의
 *     animate-ping span 이 "작성하기" 버튼 주위 반짝임의 정체.
 *   - animate-ping span 만 삭제. 버튼 본체(teal-600)·Sparkles 아이콘·클릭(onWrite)·
 *     서류요청 로직·회귀 동선은 그대로 유지.
 *   - 신규 서류요청 시각화는 큐 항목(row)·상시 노출 teal-600 버튼으로 충분(pulse가 유일 신호 아님).
 *
 * AC-1 : DocRequestQueue 미완료(작성하기) 셀에 animate-ping span 0건.
 * AC-2 : 작성하기 버튼 본체 유지 — docreq-write-btn / bg-teal-600 / '작성하기' / Sparkles 정상 노출.
 * AC-3 : 클릭 동작(onWrite) + 서류요청 로직(발행 완료 뱃지·내원확인 등) 회귀0.
 * AC-4 : teal-400/40 ripple 잔재 0건(색/애니메이션 문자열 완전 제거).
 * AC-5 : 앱 정상 로드 — HTTP 200(회귀 가드).
 *
 * 검증 방식: 진료 알림판 = 의사 전용 PHI 화면(§11) → 인증 우회 불가.
 *   정적 코드 구조 검증 + 앱 로드(HTTP 200)로 회귀 가드.
 *   실브라우저 클릭 시나리오(/admin/doctor-tools 진입 → 소견서·진단서 '작성하기' 버튼 주위
 *   반짝임 0 + 버튼 정상 노출)는 field-soak 갤탭 실기기 현장 confirm 후 done
 *   (풋 의료책임자 김태영 대표 + 김주연 총괄, §11 deferred_field_soak).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const docReqQueue = () => read('src/components/doctor/DocRequestQueue.tsx');

test.describe('T-20260716-foot-DOCREQ-PING-SHIMMER-REMOVE — 작성하기 버튼 반짝임 제거', () => {

  // AC-1: animate-ping span 0건
  test('AC-1: DocRequestQueue 에 animate-ping 0건', () => {
    const src = docReqQueue();
    expect(src).not.toContain('animate-ping');
  });

  // AC-4: teal-400/40 ripple 잔재 0건 (색/애니메이션 문자열 완전 제거)
  test('AC-4: teal-400/40 ripple 잔재 0건', () => {
    const src = docReqQueue();
    expect(src).not.toContain('bg-teal-400/40');
    // 반짝임 전용 absolute inline-flex ripple span 형태가 남지 않음
    expect(src).not.toMatch(/absolute inline-flex h-full w-full animate-ping/);
  });

  // AC-2: 작성하기 버튼 본체 유지
  test('AC-2: 작성하기 버튼 본체·Sparkles 정상 노출', () => {
    const src = docReqQueue();
    expect(src).toContain('docreq-write-btn');       // 버튼 testid 유지
    expect(src).toContain('bg-teal-600');            // 버튼 본체 색 유지(반짝임 400/40 과 별개)
    expect(src).toContain('작성하기');                // 라벨 유지
    expect(src).toContain('<Sparkles');              // Sparkles 아이콘 유지
    // ripple 래퍼는 유지되어 버튼 레이아웃 보존
    expect(src).toContain('relative inline-flex');
  });

  // AC-3: 클릭 동작 + 서류요청 로직 회귀0
  test('AC-3: onWrite 클릭 + 서류요청 로직 회귀0', () => {
    const src = docReqQueue();
    expect(src).toContain('onClick={() => onWrite(r)}');   // 클릭 동작 유지
    expect(src).toContain('docreq-done-badge');            // 발행 완료 뱃지 유지
    expect(src).toContain('발행 완료');
    expect(src).toContain('내원확인 필요');                 // 내원확인 경로 유지
  });

  // AC-5: 앱 정상 로드 (회귀 가드)
  test('AC-5: 앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });
});
