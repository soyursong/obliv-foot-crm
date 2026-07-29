/**
 * T-20260709-foot-ERRORBOUNDARY-HARDENING (P2 안전망 하드닝 · 재구현/RECUT)
 * AdminLayout ChunkErrorBoundary 관측성(AC1)+복원력(AC2) 하드닝 회귀 락.
 *
 * 재구현 배경 (FIX-REQUEST MSG-20260727-200538-brfj):
 *   구 산출 브랜치 2d65f57d 는 현 main 대비 858커밋 발산 → merge-as-is 불가.
 *   그 사이 main 에 735e33fd(전메뉴 outage 실해소 chunk 자가치유: isChunkLoadError/
 *   markAndCheckAutoReload/recovering/reload)가 들어왔다. 본 재구현은 그 chunk 자가치유를
 *   보존한 채 그 위에 AC1(구조화 로깅)+AC2(latch 자동리셋)를 얹는다.
 *
 * 검증 (static lock — 경계 로직은 additive·소스 불변식이 회귀 신호로 가장 안정적):
 *   AC1 — componentDidCatch 구조화 로깅(pathname/role/stack/componentStack/UA/ts) 존재.
 *         chunk-load 조기반환 경로에서도 로깅이 남도록 로깅이 chunk 판별보다 먼저 수행.
 *   AC2 — getDerivedStateFromProps 기반 resetKey 변경 시 latch 해제 + usage 에서 location.key 전달.
 *   AC2-가드 — 리셋이 resetKey "변경 시에만" 일어나(동일 지점 재-throw 무한루프 차단).
 *   무회귀(735e33fd 보존) — chunk 자가치유(isChunkLoadError/markAndCheckAutoReload/recovering/reload)·
 *         fallback UI·happy-path 렌더 불변(문구·새로고침 버튼·가드 클리어 보존).
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
    // 현 main 은 error: unknown 시그니처(chunk 자가치유). errorInfo 를 추가 배선.
    expect(src).toMatch(/componentDidCatch\s*\(\s*error\s*:\s*unknown\s*,\s*errorInfo\?\s*:\s*ErrorInfo\s*\)/);
    expect(src).toContain('[ChunkErrorBoundary]');
    // 경로/역할/스택/컴포넌트스택/UA/ts — 다음 필드 재발 시 RC 확보용 핵심 필드
    expect(src).toMatch(/pathname:/);
    expect(src).toMatch(/role:\s*this\.props\.role/);
    expect(src).toMatch(/errorName:/);
    expect(src).toMatch(/errorMessage:/);
    expect(src).toMatch(/errorStack:\s*err\?\.stack/);
    expect(src).toMatch(/componentStack:\s*errorInfo\?\.componentStack/);
    expect(src).toMatch(/userAgent:/);
    expect(src).toMatch(/ts:/);
  });

  test('AC1-2: 로깅 실패가 앱을 깨지 않도록 try/catch 로 삼킴', () => {
    const src = read();
    // componentDidCatch 본문에 try { … } catch 방어
    const body = src.slice(src.indexOf('componentDidCatch'), src.indexOf('render()'));
    expect(body).toMatch(/try\s*\{/);
    expect(body).toMatch(/\}\s*catch\s*\{/);
  });

  test('AC1-3: 로깅이 chunk 판별(isChunkLoadError 조기반환)보다 먼저 수행 — 자가치유 경로에서도 로그 확보', () => {
    const src = read();
    const body = src.slice(src.indexOf('componentDidCatch'), src.indexOf('render()'));
    // console.error 로깅 위치 < isChunkLoadError 조기반환 위치
    const logIdx = body.indexOf('[ChunkErrorBoundary]');
    const earlyReturnIdx = body.indexOf('if (!isChunkLoadError(error)) return');
    expect(logIdx).toBeGreaterThanOrEqual(0);
    expect(earlyReturnIdx).toBeGreaterThan(logIdx);
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
    expect(src).toMatch(/<ChunkErrorBoundary[^>]*role=\{profile\?\.role\}/);
  });

  test('AC2-3: 무한루프 가드 — 리셋 반환은 조건부(resetKey 변경 시에만), 무조건 리셋 아님', () => {
    const src = read();
    const gdp = src.slice(src.indexOf('static getDerivedStateFromProps'), src.indexOf('componentDidCatch(error'));
    // 조건 밖에서는 null 반환(리셋 없음)
    expect(gdp).toMatch(/return\s+null/);
  });
});

test.describe('ERRORBOUNDARY-HARDENING · 무회귀(735e33fd chunk 자가치유 보존)', () => {
  test('REG-1: chunk 자가치유 로직 보존(isChunkLoadError/markAndCheckAutoReload/recovering/reload)', () => {
    const src = read();
    // 735e33fd 라이브 outage 실해소 로직 — 회귀 금지
    expect(src).toMatch(/if\s*\(\s*!isChunkLoadError\(error\)\s*\)\s*return/);
    expect(src).toMatch(/if\s*\(\s*!markAndCheckAutoReload\(Date\.now\(\)\)\s*\)\s*return/);
    expect(src).toMatch(/this\.setState\(\{\s*recovering:\s*true\s*\}\)/);
    expect(src).toMatch(/recovering:\s*boolean/);
    // recovering fallback 문구 보존
    expect(src).toContain('새 버전을 적용하는 중입니다…');
  });

  test('REG-2: getDerivedStateFromError + fallback 문구/새로고침 버튼/가드 클리어 보존', () => {
    const src = read();
    expect(src).toMatch(/static\s+getDerivedStateFromError\(\)/);
    // 자가치유 진행표시 초기화 보존 (recovering:false)
    expect(src).toMatch(/getDerivedStateFromError\(\).*hasError:\s*true,\s*recovering:\s*false/s);
    expect(src).toContain('페이지를 불러오는 중 오류가 발생했습니다.');
    expect(src).toContain('새로고침');
    // 수동 재시도 시 자동 reload 가드 클리어(자가치유 재동작) 보존
    expect(src).toMatch(/clearAutoReloadGuard\(\)/);
    expect(src).toMatch(/window\.location\.reload\(\)/);
  });
});
