/**
 * E2E spec — T-20260702-foot-HEALER-CARD-TREATTYPE-MISSING (대시보드 통합시간표 포팅)
 *   FIX-REQUEST MSG-20260704-175153 (병합: NOTSHOWING + HEALER). 김주연 총괄 재보고(2026-07-04 17:43):
 *   "힐러 - 대시보드, 예약관리 고객박스 둘 다 표기 안 됨".
 *
 * [RC 확정] 소스A(197e5c1e)는 Reservations.tsx(예약관리)만 수정. /admin 대시보드(통합시간표)는
 *   src/pages/Dashboard.tsx 별도 컴포넌트라 fix 미도달 → 대시보드 힐러 카드에 치료유형명 미표기.
 *   본 티켓 = 소스A 게이트를 Dashboard 통합시간표 예약카드(Box1 초진 슬롯 · Box2 재진 슬롯)에 이식.
 *
 * [게이트 불변식] `!brief_note?.trim() && resvKind(reservation)==='healer' && resvPkgTypeMap.get(id)`
 *   → 3중 AND. Reservations.tsx 소스A 와 동일 SSOT(resvKind @/lib/resvSlotAgg) 사용(중복구현 금지).
 *
 * [⚠ 소스A 한계 = 소스C(planner 게이트)] 실제 힐러 예약은 CustomerChartPage healer_flag 토글로 생성 →
 *   linked_package_id 미보유 → resvPkgTypeMap empty → 표기 안 됨. 효과적 노출은 소스C(생성경로 캡처)
 *   필요. 본 포팅은 "fix 가 대시보드에 도달"을 보장(예약편집기에서 패키지 연결한 힐러 예약분 한정 노출).
 *
 * 데이터/clinic 미준비와 무관하게 결정적으로 검증되도록 소스-계약 probe 중심으로 회귀 봉인.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const DASHBOARD_SRC = path.resolve(process.cwd(), 'src/pages/Dashboard.tsx');

test.describe('T-20260702-foot-HEALER-CARD-TREATTYPE-MISSING — 대시보드 통합시간표 포팅', () => {
  // ─── (a) 소스-계약: 컨텍스트·사이드맵·게이트 회귀 봉인 (데이터 무의존, 결정적) ───────────
  test('소스-계약: resvPkgTypeMap 사이드맵 + 컨텍스트 주입 + resvKind SSOT import', () => {
    const src = fs.readFileSync(DASHBOARD_SRC, 'utf-8');

    // 분류 SSOT: 중복 resvKind 구현 금지 — @/lib/resvSlotAgg import 사용.
    // T-20260708-foot-E2E-SPEC-CLEANUP-STALE5: resvSlotAgg 에서 isBriefNoteChip 등 추가 심볼을 함께 import
    //   하도록 변경됨(단일-심볼 `{ resvKind }` → 다중 import). 셀렉터 갱신(피처 유지·SSOT 참조 불변).
    expect(src, 'resvKind SSOT import').toMatch(/import\s*\{[^}]*\bresvKind\b[^}]*\}\s*from\s*'@\/lib\/resvSlotAgg'/);

    // 사이드맵 상태 + linked_package_id → packages.package_name read-only 배치 조회.
    expect(src, 'resvPkgTypeMap 상태 선언').toContain('const [resvPkgTypeMap, setResvPkgTypeMap]');
    expect(src, 'packages.package_name read-only 배치 조회').toMatch(/from\('packages'\)[\s\S]{0,80}select\('id, package_name'\)/);
    expect(src, 'linked_package_id 로 맵 키 구성').toContain('linked_package_id');
    expect(src, 'setResvPkgTypeMap 커밋').toContain('setResvPkgTypeMap(m)');

    // 컨텍스트 정의 + Provider 주입(카드 컴포넌트로 전달).
    expect(src, 'ResvPkgTypeMapCtx 컨텍스트 정의').toContain('const ResvPkgTypeMapCtx = createContext<Map<string, string>>');
    expect(src, 'ResvPkgTypeMapCtx Provider 주입').toContain('<ResvPkgTypeMapCtx.Provider value={resvPkgTypeMap}>');
  });

  test('소스-계약: Box1(초진)·Box2(재진) 힐러 fallback 3중 게이트 존재(AC4 일간/재진 정합)', () => {
    const src = fs.readFileSync(DASHBOARD_SRC, 'utf-8');

    // 3중 게이트: brief 우선 + healer + 연결패키지. Box1/Box2 두 카드에 존재.
    const gate = /!reservation\.brief_note\?\.trim\(\) && resvKind\(reservation\) === 'healer'/g;
    const hits = src.match(gate) ?? [];
    expect(hits.length, '3중 게이트가 Box1+Box2 2곳에 존재').toBeGreaterThanOrEqual(2);

    // 두 카드 모두 컨텍스트에서 pkgtype 읽음.
    expect(src, 'Box2 카드 컨텍스트 소비').toContain('const box2PkgTypeMap = useContext(ResvPkgTypeMapCtx)');
    expect(src, 'Box1 카드 컨텍스트 소비').toContain('const box1PkgTypeMap = useContext(ResvPkgTypeMapCtx)');

    // 렌더 testid(치료유형 칩).
    expect(src, 'Box2 pkgtype 렌더 testid').toContain('box2-resv-pkgtype-');
    expect(src, 'Box1 pkgtype 렌더 testid').toContain('box1-resv-pkgtype-');
  });

  test('소스-계약: NOTSHOWING 파리티 — 대시보드 예약카드 이름 결측 폴백(빈 span 방지)', () => {
    const src = fs.readFileSync(DASHBOARD_SRC, 'utf-8');
    // 9ddaf836 Reservations.tsx 파리티: 워크인/미연결·이름 결측 시 빈 span → '이름없음' 폴백.
    const fallback = /cardDisplayName\(reservation\) \|\| '이름없음'/g;
    const hits = src.match(fallback) ?? [];
    expect(hits.length, '이름 폴백이 Box1+Box2 예약카드 2곳에 존재').toBeGreaterThanOrEqual(2);
  });

  test('소스-계약: 게이트가 비힐러/브리프우선 회귀 없음 — AND 결합(중복표기 0)', () => {
    const src = fs.readFileSync(DASHBOARD_SRC, 'utf-8');
    // 게이트가 반드시 brief_note 부재 조건과 AND 로 결합 → 힐러라도 brief 있으면 pkgtype 미표기(중복 회피).
    // 게이트 표현식에 '||'(OR 오염) 없이 '&&' 만으로 healer 판정과 결합됐는지 확인.
    const box2Gate = src.match(/const box2HealerPkgType = \([^;]*?\)\s*\?\s*box2PkgTypeMap\.get\(reservation\.id\)/s);
    expect(box2Gate, 'Box2 게이트 표현식 존재').not.toBeNull();
    expect(box2Gate![0], 'brief 부재 AND healer AND').toContain("!reservation.brief_note?.trim() && resvKind(reservation) === 'healer'");
  });
});
