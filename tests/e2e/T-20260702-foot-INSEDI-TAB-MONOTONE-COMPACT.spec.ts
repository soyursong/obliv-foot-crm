/**
 * E2E spec — T-20260702-foot-INSEDI-TAB-MONOTONE-COMPACT (김주연 총괄, P2, FE-only)
 *
 * 목적: 2026-06-29 신규 '보험청구·EDI' 탭(EdiExport.tsx)이 기존 CRM 톤앤매너와 달라
 *   → 확립된 무채색(모노톤) + 컴팩트 디자인시스템으로 순수 시각조정. 기능요소 추가/제거 0.
 *
 * ── 배경(tailwind config 램프, THEME-MONOCHROME-RECOLOR): teal-400~950 = Classic Taupe
 *   (#C5BEA3)/Umber(#6E6353·#443A35) '브라운'으로 렌더. 따라서 장식용 teal-* 는 warm 브라운,
 *   emerald-* 는 chromatic 그린으로 렌더된다 → 둘 다 '고채도 강조색'. 확립된 무채색 gray-*
 *   (DOCROSTER-ACHROMATIC-SCOPE / SIDEBAR-STAFFCAL-GRAY / DAYHIST-COMPACT-MONOTONE 재사용 SSOT)로 치환.
 *
 * ── 의미색 carve-out(미치환, 기준 화면 예약관리도 유지하는 시맨틱): amber = 전송보류 '주의' 경고 배너,
 *   red = export '불가' 에러 박스. 이 둘은 색 유지 + 컴팩트(패딩·폰트)만 조정.
 *
 * ── 컴팩트 기준(SSOT): 예약관리(Reservations.tsx) 밀도 — 외곽 여백↓·행 py↓·헤더/배너 text-xs·h-8 컨트롤.
 *
 * 검증: 소스 정적 스캔(색·간격 토큰 = className 변경이라 소스가 SSOT). 실브라우저 육안 회색·밀도
 *   확정 + prod 번들 해시 변경은 supervisor QA + 현장(김주연 총괄) 재확인 게이트(정적 grep 단독 신뢰 금지).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EDI = resolve(__dirname, '../../src/pages/EdiExport.tsx');
const src = readFileSync(EDI, 'utf8');

// className 컨텍스트만(주석 내 'teal-emerald' 설명 문구 오탐 방지) 색 토큰을 뽑는다.
const classNameTokens = (src.match(/className=(?:"[^"]*"|\{\[[\s\S]*?\]\.join)/g) ?? []).join('\n');

test.describe('T-20260702-foot-INSEDI-TAB-MONOTONE-COMPACT — 보험청구·EDI 탭 모노톤+컴팩트', () => {
  // ── 시나리오1: 탭 진입 → 모노톤 톤앤매너(고채도 강조색 잔존 0 · 무채색 gray 치환) ──
  // AC1: 고채도 강조색(teal=브라운 · emerald=그린) className 잔존 0건.
  test('AC1: 장식 강조색 teal-*/emerald-* className 잔존 0건', () => {
    const teal = classNameTokens.match(/\bteal-\d{2,3}\b/g) ?? [];
    const emerald = classNameTokens.match(/\bemerald-\d{2,3}\b/g) ?? [];
    expect(teal, `teal className 잔존: ${teal.join(', ')}`).toHaveLength(0);
    expect(emerald, `emerald className 잔존: ${emerald.join(', ')}`).toHaveLength(0);
  });

  // AC3: 무채색 gray-* 치환 존재 — 헤더 아이콘/제목, 선택 행, 배지, 섹션 제목, 완료 표시.
  test('AC3: 무채색 gray-* 치환 존재(헤더·선택행·배지·섹션·완료표시)', () => {
    expect(src).toMatch(/text-gray-600/);                     // 헤더 아이콘
    expect(src).toMatch(/text-lg font-bold text-gray-900/);   // h1 제목
    expect(src).toMatch(/border-gray-400 bg-gray-100/);       // 선택된 청구 행
    expect(src).toMatch(/hover:border-gray-300 hover:bg-gray-50/); // 행 hover
    expect(src).toMatch(/bg-gray-100 text-gray-700 hover:bg-gray-100/); // export완료/주상병 배지
    expect(src).toMatch(/mb-1 text-xs font-semibold text-gray-700/);    // 섹션 제목 ①②③
    expect(src).toMatch(/text-sm text-gray-600/);             // '이미 export 완료됨'
  });

  // ── 시나리오2: 컴팩트 밀도 + 의미색/기능 보존 ──
  // AC2: 여백/밀도 컴팩트(외곽 p-3·grid gap-3·카드 p-2.5·행 py-2·배너 text-xs) 반영.
  test('AC2: 컴팩트 간격 토큰(외곽/그리드/카드/행/배너) 반영', () => {
    expect(src).toMatch(/data-testid="edi-export-page">/);
    expect(src).toMatch(/className="space-y-3 p-3"/);         // 외곽 여백 축소
    expect(src).toMatch(/grid grid-cols-1 gap-3 lg:grid-cols-2/); // 그리드 간격 축소
    expect(src).toMatch(/<Card className="p-2\.5">/);          // 카드 패딩 축소
    expect(src).toMatch(/rounded-md border px-3 py-2 text-left/); // 청구 행 세로 패딩 축소
    expect(src).toMatch(/bg-amber-50 px-3 py-1\.5 text-xs/);   // 전송보류 배너 컴팩트
    expect(src).toMatch(/mb-1\.5 text-xs font-semibold text-slate-700/); // 카드 h2 컴팩트
    expect(src).toMatch(/size="sm"/);                          // 새로고침 버튼 컴팩트(h-8→h-7)
  });

  // AC3(의미색 carve-out): amber 경고·red 에러는 미치환(색 유지) — 예약관리 시맨틱과 동일.
  test('AC1-carveout: 의미색 amber(전송보류 경고)·red(export 불가 에러) 보존', () => {
    expect(src).toMatch(/border-amber-200 bg-amber-50[^"']*text-amber-800/); // 주의 배너
    expect(src).toMatch(/data-testid="edi-no-transmit-notice"/);
    expect(src).toMatch(/border-red-200 bg-red-50[^"']*text-red-700/);       // 에러 박스
    expect(src).toMatch(/data-testid="edi-block-msg"/);
  });

  // AC5: 순수 시각조정 — 기능요소(테스트ID·핸들러·라우팅·표시데이터) 추가/제거 0.
  test('AC4·AC5: 기능·라우팅·표시데이터 회귀 0(순수 className/spacing 조정)', () => {
    // 핵심 인터랙션/데이터 testid 전부 보존.
    for (const id of [
      'edi-export-page',
      'edi-no-transmit-notice',
      'edi-claim-row',
      'edi-exported-badge',
      'edi-block-msg',
      'edi-preview',
      'edi-institution-code',
      'edi-item-row',
      'edi-export-btn',
    ]) {
      expect(src, `testid 소실: ${id}`).toContain(`data-testid="${id}"`);
    }
    // 데이터/핸들러 흐름 보존(export 로직·목록 로드).
    expect(src).toMatch(/useExportableClaims/);
    expect(src).toMatch(/loadClaimForExport/);
    expect(src).toMatch(/markExported/);
    expect(src).toMatch(/doExport/);
    // D2 전송(transmitted) 버튼 미추가 유지 — 기능요소 추가 금지.
    expect(src).not.toMatch(/transmit(ted)?['"]/i);
    // export 실행 버튼은 charcoal 기본 variant(커스텀 색 클래스 제거) — 로직 onClick 보존.
    expect(src).toMatch(/data-testid="edi-export-btn"[\s\S]*?className="gap-2"/);
    expect(src).toMatch(/onClick=\{\(\) => void doExport\(\)\}/);
  });
});
