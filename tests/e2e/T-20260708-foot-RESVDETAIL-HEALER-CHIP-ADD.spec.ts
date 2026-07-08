import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260708-foot-RESVDETAIL-HEALER-CHIP-ADD — 김주연 총괄(풋센터, 스샷 F0BFS5SLJF7)
 *
 * 요청: 예약상세 팝업(기존 예약 열기) 간략메모에 [힐러] 칩이 없어 기존 예약에 힐러 표시가 불가 →
 *   캘린더/통합시간표 노란박스 연동이 깨진다. new-mode(신규예약 폼)엔 [힐러] 칩이 이미 있으므로
 *   그 동선을 예약상세 편집에 parity 확장한다.
 *
 * 旣존재 재사용(신규 자산 0):
 *  - is_healer_intent = reservations 旣존 영속 컬럼(T-20260614 HEALER-RESV-CLASSIFY-DEF, T-20260630 deployed).
 *    ⇒ 신규 스키마/마이그 0, DA/대표 게이트 불요.
 *  - 노랑 = healer 토큰(bg-healer-50 / border-healer-400, T-20260625 WARMPASTEL A안 carve-out). 새 색 0.
 *  - new-mode [힐러] 칩(T-20260630-RESVMEMO-HEALER-CHIP-YELLOWBOX, isHealerIntent) 패턴 동일 재사용.
 *
 * ⚠ REDEFINITION_WATCH: BRIEFMEMO-CHIPONLY-EDIT(deployed 7/8 AC2)가 [힐러]를 '별도 축'으로 의도적 생략.
 *   본 작업 = append-only. brief_note 3종칩 편집 로직은 절대 덮어쓰지 않고 [힐러] 칩만 추가.
 *
 * 본 스펙: FE-only, 스키마 무변경. 소스 정적 가드 — 실 렌더·저장·노란박스 연동은 supervisor 갤탭 field-soak.
 *   (인접 spec BRIEFMEMO-TIMETABLE-CHIPONLY-EDIT 와 동일한 static-guard 스타일)
 *
 * 시나리오 매핑:
 *  시나리오1(힐러 켜기): 예약상세 [힐러] 칩 존재 + 토글 + healer(노랑) active + [저장] payload 동봉.
 *  시나리오2(힐러 해제): OFF 상태(false) → 저장 시 is_healer_intent:false 로 영속(해제 반영).
 *  시나리오3(3종칩 회귀무영향): brief_note 3종칩 편집 로직·직접입력 무변경(직교, append-only).
 */

const POPUP = fs.readFileSync(
  path.resolve('src/components/ReservationDetailPopup.tsx'),
  'utf-8',
);

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오1 — 힐러 켜기: 예약상세 [힐러] 칩 추가 + 토글 + healer 노랑 + 저장 동봉
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 예약상세 간략메모 [힐러] 칩 추가·토글·저장 (힐러 켜기)', () => {
  test('AC1: 예약상세 전용 힐러 상태(detailHealerIntent) — anchor 예약 is_healer_intent 초기화', () => {
    expect(POPUP).toContain('detailHealerIntent');
    expect(POPUP).toContain('setDetailHealerIntent');
    // 초기값 = 현재 예약(anchor)의 is_healer_intent (없으면 false)
    expect(POPUP).toMatch(/useState<boolean>\(reservation\?\.is_healer_intent \?\? false\)/);
    // new-mode 의 isHealerIntent 상태와 분리(stale 오염 차단, 양 화면 상호배타 렌더)
    expect(POPUP).toContain('const [isHealerIntent, setIsHealerIntent]');
  });

  test('AC2: reservation 변경 시 힐러 칩 상태 재초기화(stale 차단)', () => {
    expect(POPUP).toContain('setDetailHealerIntent(reservation.is_healer_intent ?? false)');
  });

  test('AC3: 예약상세 [힐러] 칩 버튼 — new-mode 패턴(토글·aria-pressed·healer 노랑) 동일 재사용', () => {
    // 예약상세 전용 testid (new-mode 의 newmode-brief-quick-힐러 와 구분)
    expect(POPUP).toContain('data-testid="detail-brief-quick-힐러"');
    // 토글 핸들러 + aria-pressed telegraph
    expect(POPUP).toContain('setDetailHealerIntent((prev) => !prev)');
    expect(POPUP).toContain('aria-pressed={detailHealerIntent}');
    // active 시 healer 노랑 토큰(new-mode 와 동일 클래스)
    expect(POPUP).toMatch(/detailHealerIntent[\s\S]{0,120}border-healer-400 bg-healer-50 text-healer-700/);
  });

  test('AC4: [저장](saveRouteAndRegistrar)이 is_healer_intent 를 기존 update 에 동봉(신규 스키마 0)', () => {
    const saveIdx = POPUP.indexOf('const saveRouteAndRegistrar');
    expect(saveIdx).toBeGreaterThan(-1);
    const saveBlock = POPUP.slice(saveIdx, saveIdx + 1200);
    // brief_note(旣존) 와 동일 [저장] 경로에 is_healer_intent 동봉
    expect(saveBlock).toContain('is_healer_intent: detailHealerIntent');
    expect(saveBlock).toContain('brief_note: detailBriefNote.trim() || null'); // 3종칩 저장 경로 유지(덮어쓰기 0)
    expect(saveBlock).toContain('onChanged()'); // 저장 후 부모 리프레시 → 캘린더/시간표 노란박스 연동
    expect(saveBlock).toContain('.eq(\'id\', reservation.id)'); // anchor 예약 대상(오저장 방지)
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오2 — 힐러 해제: OFF 상태가 저장 시 is_healer_intent:false 로 영속
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 힐러 해제 → 저장 시 false 영속', () => {
  test('AC5-a: 저장 payload 가 detailHealerIntent(boolean) 원값을 그대로 전달 — OFF 시 false 영속', () => {
    // is_healer_intent: detailHealerIntent (truthy 강제·|| 폴백 없음) → OFF(false) 도 명시 영속되어 해제 반영
    expect(POPUP).toContain('is_healer_intent: detailHealerIntent');
    expect(POPUP).not.toContain('is_healer_intent: detailHealerIntent || ');
    expect(POPUP).not.toContain('is_healer_intent: detailHealerIntent ? ');
  });

  test('AC5-b: 힐러 칩 미선택(off)가 healer 토큰 없이 중립 스타일 — 노란박스 연동 안 됨', () => {
    // off 분기 = 중립(input/background) 클래스, healer 노랑 아님
    expect(POPUP).toMatch(/detailHealerIntent[\s\S]{0,160}border-input bg-background hover:bg-muted/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오3 — 3종칩 회귀무영향: brief_note 편집 로직 append-only(직교) 무변경
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오3: 3종 텍스트칩 회귀 무영향 (append-only·직교)', () => {
  test('AC-reg: brief_note 3종칩(발톱무좀/내성발톱/발각질케어) 편집·직접입력 로직 유지', () => {
    // 3종칩 렌더/토글(detail-brief-quick-*) + 직접입력(detail-brief-note-input) 무변경
    expect(POPUP).toContain('data-testid="detail-brief-note-input"');
    // 3종칩 토글 로직(prev.trim() === label 이면 해제, 아니면 선택) + active 판정(detailBriefNote.trim() === label) 유지
    expect(POPUP).toMatch(/setDetailBriefNote\(\(prev\) => \(prev\.trim\(\) === label \? '' : label\)\)/);
    expect(POPUP).toContain('const active = detailBriefNote.trim() === label');
    // 힐러 칩은 brief_note 를 건드리지 않음(직교) — setDetailBriefNote 를 힐러 토글에 섞지 않음
    const healerIdx = POPUP.indexOf('data-testid="detail-brief-quick-힐러"');
    expect(healerIdx).toBeGreaterThan(-1);
    // 힐러 버튼 블록(전후 200자) 안에서 setDetailBriefNote 오염 0
    const healerBlock = POPUP.slice(healerIdx - 400, healerIdx + 200);
    expect(healerBlock).not.toContain('setDetailBriefNote');
  });

  test('AC-reg: 힐러(플래그) ↔ brief_note(텍스트) 직교 — 저장 payload 에 둘 다 독립 필드로 동봉', () => {
    const saveIdx = POPUP.indexOf('const saveRouteAndRegistrar');
    const saveBlock = POPUP.slice(saveIdx, saveIdx + 1200);
    // 두 축이 서로 다른 컬럼으로 각각 존재(동시 선택 가능·상호 간섭 0)
    expect(saveBlock).toContain('brief_note: detailBriefNote.trim() || null');
    expect(saveBlock).toContain('is_healer_intent: detailHealerIntent');
  });
});
