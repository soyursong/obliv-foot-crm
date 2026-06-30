/**
 * E2E spec — T-20260630-foot-DOCDASH-HEADER-ICONS-REMOVE
 *
 * 진료대시보드(의사 뷰) = 진료 알림판(DoctorCallDashboard) 헤더 영역의 아이콘 전부 제거.
 * 문지은 대표원장 보고("헤더에 아이콘이 많아 정리 — 헤더 아이콘 전부 제거, 텍스트/기능 유지").
 *
 *   AC1: 진료대시보드(의사 뷰) 헤더에 아이콘 0개.
 *   AC2: 헤더의 텍스트 라벨·건수·기능 버튼 동작은 변경 없이 유지.
 *   AC3: 아이콘 제거로 인한 레이아웃 깨짐 없음(버튼/핸들러 구조 보존).
 *
 * surface 식별: 접수 DASH(Dashboard.tsx)의 DASHHEADER-DEDUP 계열과는 다른 surface(의사 진료알림판) → 단독 처리.
 * 검증은 컴포넌트 소스 정적 분석(로그인/데이터 비의존, 결정론).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC = readFileSync(
  join(ROOT, 'src/components/doctor/DoctorCallDashboard.tsx'),
  'utf8',
);

/** 메인 헤더 region 슬라이스: `{/* 헤더 — 음소거 / 알림 권한 *​/}` 부터 다음 섹션(소견서·진단서) 직전까지. */
function headerRegion(src: string): string {
  const start = src.indexOf('헤더 — 음소거 / 알림 권한');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('소견서·진단서 처리대기', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

// ── 시나리오 1: 헤더 아이콘 0개 (AC1) ──
test('시나리오1: 진료 알림판 메인 헤더 region 에 lucide 아이콘 0개', () => {
  const region = headerRegion(SRC);
  // 헤더에서 제거 대상이던 아이콘들이 JSX 엘리먼트로 잔존하지 않음.
  for (const icon of ['Stethoscope', 'Volume2', 'VolumeX', 'BellOff', 'Bell']) {
    expect(region.includes(`<${icon}`)).toBe(false);
  }
});

// ── 시나리오 2: 텍스트 라벨·기능 버튼 유지 (AC2) ──
test('시나리오2: 헤더 텍스트 라벨·기능 버튼 핸들러는 그대로 유지', () => {
  const region = headerRegion(SRC);
  // 텍스트 라벨 유지
  expect(region.includes('진료부 통합 대시보드')).toBe(true);
  expect(region.includes('소리 켜기')).toBe(true);
  expect(region.includes('소리 끄기')).toBe(true);
  expect(region.includes('알림 켜기')).toBe(true);
  expect(region.includes('알림 끄기')).toBe(true);
  // 기능 버튼(핸들러) 보존 — 음소거/권한요청/알림토글
  expect(region.includes('onClick={toggleMute}')).toBe(true);
  expect(region.includes('onClick={askPermission}')).toBe(true);
  expect(region.includes('onClick={toggleNotify}')).toBe(true);
  // data-testid(버튼) 보존 — E2E·접근성 앵커 무변경
  expect(region.includes('doctor-call-mute-toggle')).toBe(true);
  expect(region.includes('doctor-call-notify-toggle')).toBe(true);
});

// ── 시나리오 3: 미사용 아이콘 import 정리 + 본문 섹션 아이콘은 유지(스코프 한정) ──
test('시나리오3: 미사용 아이콘 import 제거(noUnusedLocals) + 본문 섹션 아이콘은 헤더 밖이라 보존', () => {
  // 헤더에서만 쓰이던 아이콘 import 제거 — 빌드(noUnusedLocals) 통과 보장.
  const importBlock = SRC.slice(SRC.indexOf("from 'lucide-react'") - 400, SRC.indexOf("from 'lucide-react'"));
  for (const icon of ['Stethoscope', 'Volume2', 'VolumeX', 'BellOff']) {
    expect(importBlock.includes(`${icon},`)).toBe(false);
  }
  // Bell 은 본문 섹션('진료 대기중' 등)에서 여전히 사용 → import 유지.
  expect(importBlock.includes('Bell,')).toBe(true);
  // 본문 섹션(헤더 밖)의 섹션 타이틀 아이콘은 스코프 외 → 보존(전체 파일 기준 잔존).
  expect(SRC.includes('<CheckCircle2')).toBe(true); // '진료 완료' 섹션 타이틀
  expect(SRC.includes('<FilePen')).toBe(true);       // '소견서·진단서' 섹션 타이틀
});
