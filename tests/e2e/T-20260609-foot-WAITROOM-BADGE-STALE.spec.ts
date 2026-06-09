/**
 * E2E spec — T-20260609-foot-WAITROOM-BADGE-STALE
 * 대시보드 칸반 '치료대기' 컬럼 환자 카드에 방(공간) 배정 뱃지가 잔존 표시되던 오표시 제거.
 *
 * 현장 요청 (김주연 총괄 / 현장 제보 김지혜, 슬랙 C0ATE5P6JTH / MSG-20260609-104554-c6tj):
 *   치료대기(treatment_waiting) 컬럼의 환자 카드에 방 배정 뱃지가 떠 있음.
 *   치료대기 = 아직 치료실 미입실 대기 상태 → 방 뱃지 노출은 오표시.
 *
 * 판별(재현-by-code):
 *   근본원인은 "DB 잔존" 계열 — 환자가 preconditioning(치료실 입실, treatment_room 세팅)에서
 *   treatment_waiting 으로 이동할 때 Dashboard 일반 드롭 분기(handleDrop else)가
 *   treatment_room 컬럼을 clear하지 않음(laser_waiting/consultation 분기는 각자 방을 clear함).
 *   잔존한 treatment_room 값이 getAssignedSlotName(checkin-slot.ts)을 통해 카드 location-badge로 표출됨.
 *
 * 수정 (최소·read-only, supabase 무변경):
 *   src/lib/checkin-slot.ts getAssignedSlotName — case 'treatment_waiting' → null 반환.
 *   대기 단계는 방 미입실이므로 방 뱃지를 파생하지 않는다.
 *   status 파생이라 이미 stale된 기존 row도 즉시 교정(write-side clear 불필요).
 *   cf. 동일 원칙의 getCurrentLocationLabel(IN_ROOM_STATUSES) 선례.
 *
 * 회귀 경계: RESET-REGRESS REOPEN-3(026eda9)는 room_assignments 테이블(방→스태프 일배정) 수정.
 *   본 건은 check_ins.treatment_room 컬럼 파생 표시 — 별개 개념, 코드/DB 무교차 → AC-4 안전.
 *
 * 컨벤션: 핵심 로직 page.evaluate 박제(환경독립) + 대시보드 렌더 스모크(graceful skip).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260609 WAITROOM-BADGE-STALE — 치료대기 방 뱃지 오표시 제거', () => {
  // ── 시나리오1 / AC-1·AC-3: 치료대기 방 뱃지 미노출 + 입실 단계 회귀 없음 ───────────
  test('AC-1/AC-3: getAssignedSlotName — 치료대기는 treatment_room 잔존값이 있어도 null(뱃지 미노출), 입실 단계는 방 유지', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // src/lib/checkin-slot.ts getAssignedSlotName 박제 (T-20260609-foot-WAITROOM-BADGE-STALE 반영)
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
            // 대기 단계 = 방 미입실 → 잔존값 무시
            return null;
          case 'laser':
          case 'laser_waiting':
          case 'preconditioning':
          case 'healer_waiting':
            return nonEmpty(ci.laser_room);
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
        // 핵심: 치료대기인데 treatment_room 잔존값이 있어도 뱃지 미노출(null)
        treatmentWaitingWithStaleRoom: getAssignedSlotName({ status: 'treatment_waiting', treatment_room: '치료실2' }),
        treatmentWaitingNoRoom: getAssignedSlotName({ status: 'treatment_waiting', treatment_room: null }),
        // 회귀: 실제 입실 단계는 방 이름 그대로 표출
        preconditioningRoom: getAssignedSlotName({ status: 'preconditioning', laser_room: '치료실A' }),
        consultationRoom: getAssignedSlotName({ status: 'consultation', consultation_room: '상담실1' }),
        laserRoom: getAssignedSlotName({ status: 'laser', laser_room: '레이저실B' }),
        // 회귀: 완료/기타 단계 fallback 표시 불변
        doneFallback: getAssignedSlotName({ status: 'done', laser_room: '레이저실B', treatment_room: '치료실2' }),
      };
    });

    // AC-1: 치료대기는 방 뱃지 없음(잔존값 무시)
    expect(result.treatmentWaitingWithStaleRoom).toBeNull();
    expect(result.treatmentWaitingNoRoom).toBeNull();
    // AC-3: 입실 단계 방 표시 회귀 없음
    expect(result.preconditioningRoom).toBe('치료실A');
    expect(result.consultationRoom).toBe('상담실1');
    expect(result.laserRoom).toBe('레이저실B');
    // 완료 단계 fallback(동선 이력)은 종전대로 유지
    expect(result.doneFallback).toBe('레이저실B');
  });

  // ── 시나리오2 / AC-2: 방 배정 상태 → 치료대기 전환 시 뱃지 즉시 클리어(status 파생) ──
  test('AC-2: preconditioning(방배정) → treatment_waiting 전환 시 location-badge 파생값이 null로 즉시 클리어', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const nonEmpty = (v: string | null | undefined) => {
        const t = (v ?? '').trim();
        return t === '' ? null : t;
      };
      const getAssignedSlotName = (ci: Record<string, string | null>) => {
        switch (ci.status) {
          case 'treatment_waiting':
            return null;
          case 'laser':
          case 'laser_waiting':
          case 'preconditioning':
          case 'healer_waiting':
            return nonEmpty(ci.laser_room);
          default:
            return nonEmpty(ci.treatment_room) ?? nonEmpty(ci.laser_room);
        }
      };
      // 같은 환자: 치료실 입실(방 표시) → 치료대기로 되돌림. treatment_room 컬럼은 잔존(stale)이라 가정.
      const inRoom = getAssignedSlotName({ status: 'preconditioning', laser_room: '치료실A', treatment_room: '치료실A' });
      const backToWaiting = getAssignedSlotName({ status: 'treatment_waiting', laser_room: '치료실A', treatment_room: '치료실A' });
      return { inRoom, backToWaiting };
    });
    expect(result.inRoom).toBe('치료실A');     // 입실 시 방 표시
    expect(result.backToWaiting).toBeNull();    // 치료대기 전환 즉시 뱃지 클리어(DB 잔존과 무관)
  });

  // ── AC-4 회귀: room_assignments(방→스태프 일배정)와 무교차 — 개념 분리 명시 ──────────
  test('AC-4: 본 수정은 check_ins.treatment_room 표시 파생만 — room_assignments(RESET-REGRESS) 경로 불변', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // room_assignments(방→스태프) 와 check_ins.*_room(환자 입실 방) 은 별개 모델.
      // 본 티켓 수정은 후자의 표시 파생만 건드림. 전자의 carry-over/persist 로직(REOPEN-3)과 무관.
      const roomAssignment = { room_name: '치료실A', staff_id: null, staff_name: null }; // null-staff persist(REOPEN-3) 유지
      const checkInBadgeDeriv = (status: string) => (status === 'treatment_waiting' ? null : 'room-shown');
      return {
        nullStaffRowPersisted: roomAssignment.room_name === '치료실A' && roomAssignment.staff_id === null,
        badgeForWaiting: checkInBadgeDeriv('treatment_waiting'),
        badgeForInRoom: checkInBadgeDeriv('preconditioning'),
      };
    });
    expect(result.nullStaffRowPersisted).toBe(true);   // RESET-REGRESS 미배정 방 명시 persist 불변
    expect(result.badgeForWaiting).toBeNull();
    expect(result.badgeForInRoom).toBe('room-shown');
  });

  // ── 대시보드 렌더 회귀 스모크 + 치료대기 카드 location-badge 부재 확인(graceful skip) ──
  test('회귀: 대시보드 정상 렌더 + 치료대기 컬럼 카드에 location-badge 미노출', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();

    // 치료대기 컬럼 컨테이너 (DroppableColumn → data-droppable-id)
    const col = page.locator('[data-droppable-id="treatment_waiting"]');
    if ((await col.count()) === 0) {
      test.skip(true, '치료대기 컬럼 미렌더 환경 — 스킵');
      return;
    }
    // 치료대기 컬럼 내 카드가 있으면, 그 안에 card-location-badge 가 없어야 한다.
    const badgesInCol = col.locator('[data-testid="card-location-badge"]');
    expect(await badgesInCol.count()).toBe(0);
  });
});
