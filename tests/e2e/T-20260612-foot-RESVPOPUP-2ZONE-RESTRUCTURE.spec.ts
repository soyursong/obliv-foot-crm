import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260612-foot-RESVPOPUP-2ZONE-RESTRUCTURE — 예약상세 팝업 2구역 재구성 (delta: AC-6 미화 + AC-7 등록자 필터)
 * 원천: 김주연 총괄(C0ATE5P6JTH). AC-0 read-only 진단 결론:
 *   AC-1(2구역)·AC-2(고객검색창)·AC-3(미니캘린더)·AC-4(2번차트 연동) = T-20260611-RESVPOPUP-2ZONE-SEARCH-CALENDAR
 *   에서 이미 충족(deployed 53d4460). 중복 폭격 회피 → 본 티켓 신규 작업 = AC-6 + AC-7 만.
 *
 *   AC-6 미화: 카드 일관 스타일(rounded-xl·shadow·bg-card·border-border/60) + SectionHeader(액센트바 타이포 위계)
 *             + FieldRow 라벨↔값 그리드 정렬. 순수 표현 — 기능/데이터 변경 0. 신규 npm 0(기존 Tailwind 토큰).
 *             ※ "다크테마" 리터럴 복사는 미적용 — 앱 전역 light(teal-emerald) 테마와 충돌 + "기존 디자인 토큰 재사용"
 *               제약. 카드 정돈·타이포 위계로 롱래CRM 동급 시각 완성도 달성(GUARD: 순수 스타일).
 *   AC-7 등록자 필터: 2번구역 캘린더 '바로 위' 드롭다운. 선택 시 캘린더 점표기 + 예약이력 목록이 해당
 *             등록자(registrar_id) 예약만 표시. 옵션=reservation_registrars(group_name 'TM'/'원내' - name, active=true).
 *             registrarFilter 는 편집용 registrarId 와 '별개' 상태 → 저장(reservations.update) 무관(엉뚱 저장 0).
 *
 * AC-0 노트(추정 금지 결과):
 *   - TM/원내 그룹 분류 기준 = reservation_registrars.group_name('원내'|'TM') 기존 마스터. ref 이미지 옵션과 일치
 *     → responder 확인 불요(모호성 자체 해소).
 *   - "2,3번" 미화 지칭 구역 모호 → 티켓 지침대로 1·2구역 전체 미화로 진행(본 노트 명시).
 *
 * 거대-established 컴포넌트 = source-integrity gating. 실 브라우저 동작은 supervisor field-soak 로 닫음.
 * DB 무관(FE-only, 기존 테이블 read 재사용 · db_change=false).
 */

const DETAIL_POPUP = fs.readFileSync(path.resolve('src/components/ReservationDetailPopup.tsx'), 'utf-8');

test.describe('AC-7 — 예약등록자 기준 필터 (예약이력·캘린더 표시 한정)', () => {
  test('필터 드롭다운이 2번구역 캘린더 "바로 위"에 위치(예약 캘린더 카드 내, 캘린더 위)', () => {
    const calCardIdx = DETAIL_POPUP.indexOf('예약 캘린더</SectionHeader>');
    const filterIdx = DETAIL_POPUP.indexOf('data-testid="popup-registrar-filter"');
    const calIdx = DETAIL_POPUP.indexOf('<MiniMonthCalendar');
    expect(calCardIdx).toBeGreaterThan(-1);
    expect(filterIdx).toBeGreaterThan(calCardIdx); // 캘린더 제목 뒤
    expect(filterIdx).toBeLessThan(calIdx);        // 그러나 캘린더 그리드 '위'
  });

  test('옵션 소스 = reservation_registrars(group_name - name) 재사용 + 미지정(전체) 기본', () => {
    expect(DETAIL_POPUP).toContain('const [registrarFilter, setRegistrarFilter]');
    // 필터 드롭다운이 registrars 마스터를 재사용(신규 스키마 0)
    expect(DETAIL_POPUP).toMatch(/popup-registrar-filter[\s\S]*registrars\.map/);
    expect(DETAIL_POPUP).toMatch(/popup-registrar-filter[\s\S]*\{r\.group_name\} - \{r\.name\}/);
    // 미지정 = 전체(빈 문자열)
    expect(DETAIL_POPUP).toContain("setRegistrarFilter(v === '__all__' ? '' : v)");
  });

  test('필터는 visibleResvs(예약이력·캘린더 점표기)에만 적용 — registrar_id 일치', () => {
    expect(DETAIL_POPUP).toContain(
      "registrarFilter\n    ? allResvs.filter((r) => r.registrar_id === registrarFilter)",
    );
    // 캘린더 markedDates + 예약이력 목록이 visibleResvs 사용
    expect(DETAIL_POPUP).toContain('markedDates={visibleResvs');
    expect(DETAIL_POPUP).toContain('visibleResvs.map((r) => {');
    expect(DETAIL_POPUP).toContain('예약이력{visibleResvs.length');
  });

  test('🔒 격리: 필터는 표시 전용 — 저장(reservations.update)에 registrarFilter 미사용(엉뚱 저장 0)', () => {
    // saveRouteAndRegistrar 는 편집용 registrarId 만 사용. registrarFilter 가 저장 payload 에 새지 않음.
    const saveFnIdx = DETAIL_POPUP.indexOf('const saveRouteAndRegistrar');
    const saveFnEnd = DETAIL_POPUP.indexOf('};', saveFnIdx);
    const saveFnBody = DETAIL_POPUP.slice(saveFnIdx, saveFnEnd);
    expect(saveFnBody).not.toContain('registrarFilter');
    expect(saveFnBody).toContain('registrar_id: registrarId');
  });

  test('필터 상태는 팝업 재로드 시 초기화(다른 예약 열 때 stale 필터 잔존 0)', () => {
    // useEffect 양 분기(null reset / load) 모두 setRegistrarFilter('') 호출
    const matches = DETAIL_POPUP.match(/setRegistrarFilter\(''\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

test.describe('AC-6 — 레이아웃 미화 (롱래CRM 동급 시각 완성도 · 순수 스타일)', () => {
  test('카드 일관 스타일: rounded-xl + shadow-sm + bg-card + border-border/60 적용', () => {
    expect(DETAIL_POPUP).toContain('rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm');
    // 구 카드 스타일(border rounded-lg p-3) 잔존 0 — 일관성
    expect(DETAIL_POPUP).not.toContain('border rounded-lg p-3');
  });

  test('SectionHeader(액센트바 타이포 위계) 헬퍼 도입 + 주요 카드 제목에 적용', () => {
    expect(DETAIL_POPUP).toContain('function SectionHeader(');
    expect(DETAIL_POPUP).toContain('<SectionHeader accent="teal">환자 정보</SectionHeader>');
    expect(DETAIL_POPUP).toContain('<SectionHeader accent="blue">고객메모</SectionHeader>');
    expect(DETAIL_POPUP).toContain('<SectionHeader accent="amber">예약메모</SectionHeader>');
  });

  test('FieldRow 라벨↔값 그리드 정렬(롱래CRM 정돈)', () => {
    expect(DETAIL_POPUP).toContain('grid grid-cols-[4.75rem_1fr]');
  });

  test('AC-6 GUARD: 순수 스타일 — 신규 npm/데이터 변경 0 (기존 테이블 read 유지)', () => {
    // 팝업 내 신규 INSERT 신설 0(L-002 회귀) + 기존 read 소스 유지
    expect(DETAIL_POPUP).not.toContain("from('reservations').insert");
    expect(DETAIL_POPUP).toContain("from('check_ins')");
    expect(DETAIL_POPUP).toContain("from('reservation_registrars')");
  });
});

test.describe('GUARD 회귀 — RESV-REGISTRAR(deployed) 보존 + 팝업 방문경로 write 입력란 신설 금지', () => {
  test('예약경로/예약등록자 편집 드롭다운(RESV-REGISTRAR) 보존 — 파괴 0', () => {
    expect(DETAIL_POPUP).toContain('data-testid="popup-visit-route"');
    expect(DETAIL_POPUP).toContain('data-testid="popup-registrar"');
    expect(DETAIL_POPUP).toContain('const saveRouteAndRegistrar');
    expect(DETAIL_POPUP).toContain('registrar_name: reg ? reg.name : null');
  });

  test('예약경로 = 기존 VISIT_ROUTE_OPTIONS 표시만 — 신규 방문경로 write 경로 신설 0', () => {
    // RESV-ROUTE-AUTOCLASS GUARD: 팝업은 방문경로 입력경로 아님. 옵션은 기존 SSOT 재사용.
    expect(DETAIL_POPUP).toContain('VISIT_ROUTE_OPTIONS.map');
    expect(DETAIL_POPUP).not.toContain('visit_route_detail'); // 소분류 write 입력란 미신설
  });
});
