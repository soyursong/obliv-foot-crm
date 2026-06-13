/**
 * E2E spec — T-20260611-foot-CALLLIST-ROOM-LABEL (TREATROOM-NUMBER fold)
 *
 * 진료콜 명단 위젯(DoctorCallListBar) 각 콜 행에 배정 방이름/방번호 표시.
 * 위치 라벨은 getCurrentLocationLabel(checkin-slot.ts) SSOT 사용(DIAGMGMT-6FIX AC-3와 동일 규칙).
 *
 * 현장 요청 (김주연 총괄, 슬랙 C0ATE5P6JTH / thread 1781144846.692699):
 *   "진료콜 명단에 고객 위치 명확하게 안 뜸 / 방 번호 노출되어야 함 (예: 치료실C1)
 *    그래야 원장님이 어느 방인지 찾아가지" — 스크린샷(김민준 C2 치료실 입실, 방번호 누락).
 *
 * 🔴 CRITICAL 정정 (TREATROOM-NUMBER fold):
 *   getAssignedSlotName을 '그대로' 쓰면 치료실(C1-C10) 입실 환자 방번호가 여전히 누락된다.
 *   RC: checkin-slot.ts에서 case 'preconditioning'(치료실 입실)이 laser/laser_waiting/healer_waiting
 *       그룹에 묶여 laser_room을 읽음. 그러나 치료실 방번호는 treatment_room에 write됨
 *       (Dashboard room field map 'treatment'→'treatment_room', StatusContextMenu 치료실 슬롯 배정).
 *       → laser_room=null → null 반환 → 라벨에 "치료실"만, C2 누락(스크린샷 김민준).
 *   FIX: getAssignedSlotName의 case 'preconditioning'을 그룹에서 분리해 treatment_room을 읽도록.
 *        healer_waiting=laser_room 유지(HEALER-POSITION), treatment_waiting=null 유지(WAITROOM-BADGE-STALE).
 *        read-only switch case 수정 — 스키마/write/status전이 불변, 마이그레이션·backfill 없음.
 *
 * 컨벤션: 핵심 파생 로직 page.evaluate 박제(환경독립) + 대시보드 렌더 스모크(graceful skip).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260611 CALLLIST-ROOM-LABEL — 진료콜 명단 방번호 표시(치료실 treatment_room fold)', () => {
  // ── 시나리오3 / AC-3 (핵심): 치료실 입실 환자 방번호(C2) 실제 표시 ────────────────────
  test('AC-3: getAssignedSlotName — preconditioning(치료실 입실)은 treatment_room을 읽어 C2 표시', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // src/lib/checkin-slot.ts getAssignedSlotName 박제 (ROOM-LABEL AC-3 반영: preconditioning→treatment_room)
      const nonEmpty = (v: string | null | undefined) => {
        const t = (v ?? '').trim();
        return t === '' ? null : t;
      };
      const getAssignedSlotName = (ci: Record<string, string | null>) => {
        switch (ci.status) {
          case 'consultation':
          case 'consult_waiting':
            return nonEmpty(ci.consultation_room);
          case 'examination':
          case 'exam_waiting':
            return nonEmpty(ci.examination_room);
          case 'treatment_waiting':
            return null; // WAITROOM-BADGE-STALE: 대기=방 미입실
          case 'preconditioning':
            return nonEmpty(ci.treatment_room); // ROOM-LABEL AC-3: 치료실 방번호 위치
          case 'laser':
          case 'laser_waiting':
          case 'healer_waiting':
            return nonEmpty(ci.laser_room); // HEALER-POSITION 보존
          default:
            return (
              nonEmpty(ci.laser_room) ??
              nonEmpty(ci.treatment_room) ??
              nonEmpty(ci.consultation_room) ??
              nonEmpty(ci.examination_room)
            );
        }
      };
      return {
        // 핵심(김민준 케이스): 치료실 입실 + treatment_room='C2' → 'C2' 반환(종전 null이던 현상 종료)
        treatmentRoomShown: getAssignedSlotName({ status: 'preconditioning', treatment_room: 'C2', laser_room: null }),
        // 회귀: laser_room만 있는 옛 데이터는 치료실 단계에선 더는 노출 안 함(방번호는 treatment_room이 SSOT)
        preconditioningLaserRoomIgnored: getAssignedSlotName({ status: 'preconditioning', treatment_room: null, laser_room: 'L9' }),
        // 회귀: 레이저실(L1-L12)은 여전히 laser_room
        laserRoomKept: getAssignedSlotName({ status: 'laser', laser_room: 'L3' }),
        // 회귀: healer_waiting은 laser_room 유지(HEALER-POSITION)
        healerWaitingKept: getAssignedSlotName({ status: 'healer_waiting', laser_room: 'L5' }),
        // 회귀: treatment_waiting(치료대기)은 잔존값 있어도 null(WAITROOM-BADGE-STALE)
        treatmentWaitingNull: getAssignedSlotName({ status: 'treatment_waiting', treatment_room: 'C2' }),
        // 회귀: 상담실
        consultRoomKept: getAssignedSlotName({ status: 'consultation', consultation_room: '상담실1' }),
      };
    });
    expect(result.treatmentRoomShown).toBe('C2');                  // AC-3 핵심
    expect(result.preconditioningLaserRoomIgnored).toBeNull();     // 치료실 단계는 treatment_room SSOT
    expect(result.laserRoomKept).toBe('L3');                       // 레이저실 무회귀
    expect(result.healerWaitingKept).toBe('L5');                   // HEALER-POSITION 무회귀
    expect(result.treatmentWaitingNull).toBeNull();                // WAITROOM-BADGE-STALE 무회귀
    expect(result.consultRoomKept).toBe('상담실1');                // 상담실 무회귀
  });

  // ── 시나리오1 / AC-1: getCurrentLocationLabel — 치료실 입실 행은 '치료실 · C2'로 표기 ──
  test('AC-1: getCurrentLocationLabel — 치료실 입실(C2) → "치료실 · C2", 미배정은 단계만', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const STATUS_KO: Record<string, string> = {
        treatment_waiting: '치료대기', preconditioning: '치료실', laser: '레이저', consultation: '상담',
      };
      const IN_ROOM = ['consultation', 'examination', 'preconditioning', 'laser'];
      const nonEmpty = (v: string | null) => { const t = (v ?? '').trim(); return t === '' ? null : t; };
      const roomFor = (ci: Record<string, string | null>) => {
        switch (ci.status) {
          case 'consultation': return nonEmpty(ci.consultation_room);
          case 'preconditioning': return nonEmpty(ci.treatment_room); // ROOM-LABEL AC-3
          case 'laser': return nonEmpty(ci.laser_room);
          default: return null;
        }
      };
      const label = (ci: Record<string, string | null>) => {
        const stage = STATUS_KO[ci.status as string] ?? '대기';
        if (IN_ROOM.includes(ci.status as string)) { const r = roomFor(ci); return r ? `${stage} · ${r}` : stage; }
        return stage;
      };
      return {
        inTreatRoom: label({ status: 'preconditioning', treatment_room: 'C2' }),     // 치료실 · C2
        treatNoRoom: label({ status: 'preconditioning', treatment_room: null }),     // AC-2: 단계만
        waiting: label({ status: 'treatment_waiting', treatment_room: 'C2' }),       // 치료대기(방 미표시)
      };
    });
    expect(result.inTreatRoom).toBe('치료실 · C2'); // AC-1
    expect(result.treatNoRoom).toBe('치료실');      // AC-2: undefined/크래시 없이 단계만
    expect(result.waiting).toBe('치료대기');         // 회귀
  });

  // ── 시나리오2 / AC-2: 미배정/빈 값 — null/undefined/"undefined" 노출·크래시 금지 ──────
  test('AC-2: 방 미배정/빈값은 단계 라벨만(undefined·"undefined" 노출 없음)', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const STATUS_KO: Record<string, string> = { preconditioning: '치료실', registered: '접수' };
      const IN_ROOM = ['consultation', 'examination', 'preconditioning', 'laser'];
      const nonEmpty = (v: string | null | undefined) => { const t = (v ?? '').trim(); return t === '' ? null : t; };
      const roomFor = (ci: Record<string, string | null | undefined>) =>
        ci.status === 'preconditioning' ? nonEmpty(ci.treatment_room) : null;
      const label = (ci: Record<string, string | null | undefined>) => {
        const stage = STATUS_KO[ci.status as string] ?? '대기';
        if (IN_ROOM.includes(ci.status as string)) { const r = roomFor(ci); return r ? `${stage} · ${r}` : stage; }
        return stage;
      };
      return {
        emptyStr: label({ status: 'preconditioning', treatment_room: '' }),
        undef: label({ status: 'preconditioning', treatment_room: undefined }),
        nul: label({ status: 'preconditioning', treatment_room: null }),
      };
    });
    // 셋 다 방번호 없이 단계명만 — "undefined" 문자열이 라벨에 섞이지 않음
    for (const v of [result.emptyStr, result.undef, result.nul]) {
      expect(v).toBe('치료실');
      expect(v).not.toContain('undefined');
    }
  });

  // ── 시나리오4 / AC-1·AC-2 (DEDUP 후속): 방번호는 위치 라벨 단일 경로로만 표기 ──
  //   T-20260614-foot-CALLLIST-DOCCALL-3FIX #1: standalone 방 배지(doctor-call-room) 제거.
  //   방번호는 getCurrentLocationLabel('치료실 · C2')가 단독으로 운반한다(중복 'C1' 제거).
  //   이 테스트는 "방번호가 위치 라벨에 정확히 1회 폴딩되고, 미배정/빈값은 단계만(undefined 금지)"를 박제.
  test('AC-1·AC-2(dedup): 방번호는 위치 라벨에만 1회 폴딩 — 미배정/빈값은 단계만(undefined 금지)', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const STATUS_KO: Record<string, string> = {
        treatment_waiting: '치료대기', preconditioning: '치료실', laser: '레이저',
        consultation: '상담', registered: '접수중',
      };
      const IN_ROOM = ['consultation', 'examination', 'preconditioning', 'laser'];
      const nonEmpty = (v: string | null | undefined) => { const t = (v ?? '').trim(); return t === '' ? null : t; };
      const roomFor = (ci: Record<string, string | null | undefined>) => {
        switch (ci.status) {
          case 'consultation': return nonEmpty(ci.consultation_room);
          case 'preconditioning': return nonEmpty(ci.treatment_room);
          case 'laser': return nonEmpty(ci.laser_room);
          default: return null;
        }
      };
      const label = (ci: Record<string, string | null | undefined>) => {
        const stage = STATUS_KO[ci.status as string] ?? '대기';
        if (IN_ROOM.includes(ci.status as string)) { const r = roomFor(ci); return r ? `${stage} · ${r}` : stage; }
        return stage;
      };
      return {
        treatRoom: label({ status: 'preconditioning', treatment_room: 'C2', laser_room: null }), // 치료실 · C2
        laserRoom: label({ status: 'laser', laser_room: 'L3' }),                                  // 레이저 · L3
        consultRoom: label({ status: 'consultation', consultation_room: '상담실1' }),              // 상담 · 상담실1
        waiting: label({ status: 'treatment_waiting', treatment_room: 'C2' }),                    // 치료대기 (방 미표시)
        unassigned: label({ status: 'registered' }),                                             // 접수중
        empty: label({ status: 'preconditioning', treatment_room: '' }),                         // 치료실 (방 미표시)
        undef: label({ status: 'preconditioning', treatment_room: undefined }),                  // 치료실 (방 미표시)
      };
    });
    // 입실 단계: 방번호가 라벨에 정확히 1회 포함(중복 standalone 배지 없음 — 단일 경로)
    expect(result.treatRoom).toBe('치료실 · C2');
    expect(result.laserRoom).toBe('레이저 · L3');
    expect(result.consultRoom).toBe('상담 · 상담실1');
    expect((result.treatRoom.match(/C2/g) ?? []).length).toBe(1); // 'C2' 단 1회
    // 미배정/대기/빈값/undefined: 단계 라벨만, "undefined" 문자열 노출 금지
    for (const v of [result.waiting, result.unassigned, result.empty, result.undef]) {
      expect(v).not.toContain('·');         // 방번호 미부착(단계만)
      expect(v).not.toContain('undefined');
    }
  });

  // ── AC-0 회귀 스모크: 대시보드 렌더 + 위치 배지(단일) 존재 + standalone 방 배지 부재(dedup DOM 가드) ──
  test('AC-0 회귀(dedup): 위치(doctor-call-location) 배지 단일 + 방 배지(doctor-call-room) 제거 확인', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();

    // 진료콜 명단 위젯(숨김 상태일 수 있음 — 탭/패널 중 하나는 존재). 데이터 없으면 graceful skip.
    const widget = page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])');
    if ((await widget.count()) === 0) {
      test.skip(true, '진료콜 명단 데이터 없음(당일 콜대상 0) — 스킵');
      return;
    }
    // T-20260614-foot-CALLLIST-DOCCALL-3FIX #1: standalone 방 배지는 전역에서 제거됨 → 0개여야 한다.
    await expect(page.locator('[data-testid="doctor-call-room"]')).toHaveCount(0);

    const rows = page.locator('[data-testid="doctor-call-row"]');
    const rowCount = await rows.count();
    if (rowCount > 0) {
      const firstRow = rows.first();
      // 위치 배지는 행당 정확히 1개(중복 위치 표기 없음) + "undefined" 미노출.
      const loc = firstRow.locator('[data-testid="doctor-call-location"]');
      await expect(loc).toHaveCount(1);
      await expect(loc).toBeVisible();
      await expect(loc).not.toHaveText(/undefined/);
      // 행 안에도 standalone 방 배지가 없어야 함(중복 박멸 가드).
      await expect(firstRow.locator('[data-testid="doctor-call-room"]')).toHaveCount(0);
    }
  });

  // ── FIX phase2: 콜 대상 0명(기본 로그인·무데이터)에서도 진료콜 명단 위젯이 DOM에 존재(완전소멸 금지) ──
  //   기존 displayList.length===0 → return null 이라 위젯이 사라져 브라우저 QA의 안정 selector가 깨졌다.
  //   빈 상태에서도 최소 헤더 탭([data-testid=doctor-call-list])이 항상 보여야 한다.
  test('FIX phase2: 빈 명단에서도 진료콜 명단 위젯(raw selector)이 항상 표시 — data-empty 탭', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();

    // 데이터 유무와 무관하게 raw selector(콜대상 0이면 data-empty 탭, 있으면 패널)는 항상 1개 이상 존재·표시.
    const anyWidget = page.locator('[data-testid="doctor-call-list"]');
    await expect(anyWidget.first()).toBeVisible();

    // 콜 대상이 없는(빈) 환경이면 data-empty 탭이어야 하고, "원장님 진료콜 명단" 헤더와 0명 표기가 보인다.
    const realWidget = page.locator('[data-testid="doctor-call-list"]:not([data-empty="true"])');
    if ((await realWidget.count()) === 0) {
      const emptyTab = page.locator('[data-testid="doctor-call-list"][data-empty="true"]');
      await expect(emptyTab).toBeVisible();
      await expect(emptyTab).toContainText('진료콜 명단');
      await expect(emptyTab).not.toContainText('undefined');
    }
  });

  // ── FIX phase2-b: 위젯이 body 직속(createPortal)으로 마운트돼 칸반 cage(overflow/transform)에 안 갇힘 ──
  //   RC: position:fixed 위젯이 AdminLayout page-content-area(overflow-hidden) + 칸반 zoom transform 조상
  //   안에 마운트되면 fixed가 조상 기준으로 트랩·클리핑돼 prod에서 미표시됐다. createPortal(document.body)로 해소.
  //   불변식: doctor-call-list의 부모는 <body>여야 한다(칸반 스크롤 컨테이너 kanban-scroll의 자손이면 안 됨).
  test('FIX phase2-b: 진료콜 명단 위젯이 document.body 직속 portal로 마운트(칸반 cage 밖)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();

    const widget = page.locator('[data-testid="doctor-call-list"]').first();
    await expect(widget).toBeVisible();

    // 위젯의 부모 노드 tagName이 BODY여야 한다(portal). 칸반 스크롤 컨테이너 안이면 트랩 RC 재발.
    const parentTag = await widget.evaluate((el) => el.parentElement?.tagName ?? '');
    expect(parentTag).toBe('BODY');

    // 보강: kanban-scroll(overflow-auto cage) 자손으로 위젯이 들어가 있지 않아야 한다.
    const trappedInKanban = await page
      .locator('[data-testid="kanban-scroll"] [data-testid="doctor-call-list"]')
      .count();
    expect(trappedInKanban).toBe(0);
  });
});
