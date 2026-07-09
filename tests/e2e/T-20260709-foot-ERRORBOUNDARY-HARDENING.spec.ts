/**
 * T-20260709-foot-ERRORBOUNDARY-HARDENING (P2 안전망 하드닝)
 * AdminLayout ChunkErrorBoundary 관측성(AC1)+복원력(AC2) 하드닝 회귀 락.
 *
 * 배경:
 *   CLOSE-ERRORPAGE(b3a6ff13)가 DocumentPrintPanel null.trim crash "원인"은 제거했으나,
 *   ChunkErrorBoundary 자체의 결함2(관측성 전무 + hasError 영구 latch)는 미해소였다.
 *   본 티켓이 (a) componentDidCatch 구조화 로깅, (b) 네비게이션 변경 시 latch 자동 리셋을 잇는다.
 *
 * 검증 (static lock — 경계 로직은 additive·소스 불변식이 회귀 신호로 가장 안정적):
 *   AC1 — componentDidCatch 구조화 로깅(pathname/role/stack/componentStack) 존재.
 *   AC2 — getDerivedStateFromProps 기반 resetKey 변경 시 latch 해제 + usage 에서 location.key 전달.
 *   AC2-가드 — 리셋이 resetKey "변경 시에만" 일어나(동일 지점 재-throw 무한루프 차단).
 *   무회귀 — getDerivedStateFromError·fallback UI·happy-path 렌더 불변(문구·새로고침 버튼 보존).
 *
 * db_change=false. 시드/네트워크 불요 — 순수 소스 불변식.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAYOUT = path.resolve(__dirname, '../../src/components/AdminLayout.tsx');
const read = () => fs.readFileSync(LAYOUT, 'utf-8');

test.describe('ERRORBOUNDARY-HARDENING · AC1 관측성(componentDidCatch 구조화 로깅)', () => {
  test('AC1-1: componentDidCatch 존재 + 구조화 필드 로깅', () => {
    const src = read();
    expect(src).toMatch(/componentDidCatch\s*\(\s*error\s*:\s*Error\s*,\s*errorInfo\s*:\s*ErrorInfo\s*\)/);
    expect(src).toContain('[ChunkErrorBoundary]');
    // 경로/역할/스택/컴포넌트스택 — 다음 필드 재발 시 RC 확보용 핵심 필드
    expect(src).toMatch(/pathname:/);
    expect(src).toMatch(/role:\s*this\.props\.role/);
    expect(src).toMatch(/errorStack:\s*error\?\.stack/);
    expect(src).toMatch(/componentStack:\s*errorInfo\?\.componentStack/);
  });

  test('AC1-2: 로깅 실패가 앱을 깨지 않도록 try/catch 로 삼킴', () => {
    const src = read();
    // componentDidCatch 본문에 try { … } catch 방어
    const body = src.slice(src.indexOf('componentDidCatch'), src.indexOf('render()'));
    expect(body).toMatch(/try\s*\{/);
    expect(body).toMatch(/\}\s*catch\s*\{/);
  });
});

test.describe('ERRORBOUNDARY-HARDENING · AC2 복원력(latch 자동 리셋)', () => {
  test('AC2-1: resetKey prop + getDerivedStateFromProps 로 latch 해제', () => {
    const src = read();
    expect(src).toMatch(/resetKey\?:\s*string/);
    expect(src).toMatch(/static\s+getDerivedStateFromProps/);
    // resetKey 변경 시에만 hasError 해제 (재-throw 무한루프 가드의 핵심 조건)
    expect(src).toMatch(/props\.resetKey\s*!==\s*state\.resetKey/);
    expect(src).toMatch(/return\s*\{\s*hasError:\s*false,\s*resetKey:\s*props\.resetKey\s*\}/);
  });

  test('AC2-2: usage 에서 location.key 를 resetKey 로 전달', () => {
    const src = read();
    expect(src).toMatch(/<ChunkErrorBoundary[^>]*resetKey=\{location\.key\}/);
  });
});

test.describe('ERRORBOUNDARY-HARDENING · 무회귀(happy-path/fallback 불변)', () => {
  test('REG-1: getDerivedStateFromError + fallback 문구/새로고침 버튼 보존', () => {
    const src = read();
    expect(src).toMatch(/static\s+getDerivedStateFromError\(\)/);
    expect(src).toContain('페이지를 불러오는 중 오류가 발생했습니다.');
    expect(src).toContain('새로고침');
    expect(src).toMatch(/window\.location\.reload\(\)/);
  });
});
