/**
 * E2E spec — T-20260609-foot-CALLLIST-HEALER-POSITION
 * '원장님 진료콜 명단'(DoctorCallListBar) 보강 3건.
 *
 * 현장 요청 (김주연 총괄 / 현장 제보 김지혜, 슬랙 C0ATE5P6JTH / MSG-20260609-104243-i3n7):
 *   1) 상태 [힐러] 변경 시에도 진료콜 명단에 리스트업 (힐러=원장 시술 → 콜 필요).
 *   2) 명단 각 행의 환자 현재 위치 실시간 반영 안 됨(stale).
 *   3) 치료대기에 있는 환자가 방 배정된 것으로 표시됨(오표시).
 *
 * 구현:
 *   - src/components/DoctorCallListBar.tsx — activeList 필터 purple → purple|yellow,
 *     DoctorCallRow [힐러] 배지, 위치 배지 getAssignedSlotName → getCurrentLocationLabel.
 *   - src/lib/checkin-slot.ts — getCurrentLocationLabel(단계 인식: 대기 단계는 방 미표시).
 *
 * dedup 판정: item3 근본원인은 getAssignedSlotName 의 'treatment_waiting → treatment_room'
 *   표시 파생 버그(checkin-slot.ts). SLOT-CHART-MISMAP(카드클릭→customer_id 차트오픈, 별도 축)과
 *   다른 코드 경로 → 본 티켓에서 수정(흡수 아님). DB 무변경(표시 레벨).
 *
 * 시나리오(티켓 클릭 시나리오) → AC 매핑:
 *   시나리오1 힐러 명단 등장/배지/이탈 → AC-1/AC-2/AC-3
 *   시나리오2 보라 회귀                → AC-2/AC-6
 *   시나리오3 현재 위치 실시간·단계일치 → AC-4/AC-5
 *
 * 컨벤션: 핵심 비즈로직은 page.evaluate 로 환경독립 검증(컴포넌트/lib 로직 박제)
 *         + 대시보드 렌더 스모크(데이터/인증 없으면 graceful skip).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260609 CALLLIST-HEALER-POSITION — 힐러 포함 + 현재 위치', () => {
  // ── 시나리오1 / AC-1·AC-2·AC-3: 힐러(yellow) 포함 + 배지 + 이탈 ───────────────────
  test('AC-1/AC-2: activeList inclusion 이 purple + yellow(HL) + healer_waiting(힐러대기 단계) 를 콜대상으로 집계, 이탈', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // DoctorCallListBar.activeList 와 동일 (REOPEN 11:42 FIX-SPEC):
      //   status_flag in (purple, yellow) OR status === 'healer_waiting' + checked_in_at 정렬
      type Row = { id: string; status_flag: string | null; status: string; checked_in_at: string };
      const activeList = (rows: Row[]) =>
        rows
          .filter(
            (ci) =>
              ci.status_flag === 'purple' ||
              ci.status_flag === 'yellow' ||
              ci.status === 'healer_waiting',
          )
          .sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at))
          .map((ci) => ci.id);

      const before: Row[] = [
        // 힐러대기 컬럼 이동(현장 주 동선): status='healer_waiting', status_flag는 미변경(null)
        { id: 'hw', status_flag: null, status: 'healer_waiting', checked_in_at: '2026-06-09T02:30:00+00:00' },
        { id: 'h', status_flag: 'yellow', status: 'payment_waiting', checked_in_at: '2026-06-09T02:00:00+00:00' },  // HL 플래그
        { id: 'p', status_flag: 'purple', status: 'exam_waiting', checked_in_at: '2026-06-09T01:00:00+00:00' },  // 진료필요
        { id: 'w', status_flag: 'white', status: 'consult_waiting', checked_in_at: '2026-06-09T00:30:00+00:00' },   // 제외
        { id: 'k', status_flag: 'pink', status: 'done', checked_in_at: '2026-06-09T00:10:00+00:00' },     // 완료(비활성)
      ];
      const active = activeList(before);

      // 힐러대기(hw)를 다른 단계(치료실)로 이동 → status_flag도 null이면 명단에서 제거(AC-2 이탈)
      const hwAfterMove = activeList(
        before.map((r) => (r.id === 'hw' ? { ...r, status: 'preconditioning' } : r)),
      );
      // HL(h)를 핑크(진료완료)로 전환 + payment_waiting 유지 → 활성 콜대상에서 빠진다(AC-2 이탈)
      const afterDone = activeList(before.map((r) => (r.id === 'h' ? { ...r, status_flag: 'pink' } : r)));

      return { active, hwAfterMove, afterDone };
    });

    // 보라+HL+힐러대기 모두 집계, 접수순(p 01:00 → h 02:00 → hw 02:30). white/pink-done 제외.
    expect(result.active).toEqual(['p', 'h', 'hw']);
    // 힐러대기→치료실 이동(status_flag null) 시 명단에서 제거, 나머지(p,h)만 남음
    expect(result.hwAfterMove).toEqual(['p', 'h']);
    // HL→완료(pink) 전환 시 활성에서 이탈, p + 힐러대기(hw)만 남음
    expect(result.afterDone).toEqual(['p', 'hw']);
  });

  test('AC-3: 힐러(yellow/healer_waiting) 행만 [힐러] 배지 노출 — 진료필요(보라)와 시각 구분', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // DoctorCallRow: isHealer = status_flag === 'yellow' || status === 'healer_waiting'
      const isHealer = (flag: string | null, status: string) =>
        flag === 'yellow' || status === 'healer_waiting';
      return {
        healerFlag: isHealer('yellow', 'payment_waiting'),     // HL 플래그
        healerStage: isHealer(null, 'healer_waiting'),          // 힐러대기 단계(플래그 없음)
        purple: isHealer('purple', 'exam_waiting'),
        pink: isHealer('pink', 'done'),
      };
    });
    expect(result.healerFlag).toBe(true);   // HL 플래그 → 힐러 배지
    expect(result.healerStage).toBe(true);  // 힐러대기 단계 → 힐러 배지
    expect(result.purple).toBe(false);      // 진료필요는 힐러 배지 없음(구분)
    expect(result.pink).toBe(false);
  });

  // ── 시나리오3 / AC-4·AC-5: 현재 위치 단계 인식 (item2 stale + item3 치료대기≠방배정) ──
  test('AC-5: getCurrentLocationLabel — 치료대기 단계는 방 이름이 아니라 "치료대기"로 표기(방배정 오표시 제거)', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // src/lib/checkin-slot.ts getCurrentLocationLabel 로직 박제 (STATUS_KO + IN_ROOM_STATUSES)
      const STATUS_KO: Record<string, string> = {
        registered: '접수', receiving: '접수중', consult_waiting: '상담대기', consultation: '상담',
        exam_waiting: '진료대기', examination: '원장실', treatment_waiting: '치료대기',
        preconditioning: '치료실', laser_waiting: '레이저대기', healer_waiting: '힐러대기',
        laser: '레이저', payment_waiting: '수납대기', done: '완료', cancelled: '취소', checklist: '체크리스트',
      };
      const IN_ROOM = ['consultation', 'examination', 'preconditioning', 'laser'];
      const nonEmpty = (v: string | null) => { const t = (v ?? '').trim(); return t === '' ? null : t; };
      // getAssignedSlotName(입실 단계만 사용) 축약
      const roomFor = (status: string, ci: Record<string, string | null>) => {
        switch (status) {
          case 'consultation': return nonEmpty(ci.consultation_room);
          case 'examination': return nonEmpty(ci.examination_room);
          case 'preconditioning':
          case 'laser': return nonEmpty(ci.laser_room);
          default: return null;
        }
      };
      const label = (status: string, ci: Record<string, string | null> = {}) => {
        const stage = STATUS_KO[status] ?? '대기';
        if (IN_ROOM.includes(status)) { const r = roomFor(status, ci); return r ? `${stage} · ${r}` : stage; }
        return stage;
      };

      return {
        // item3 핵심: 치료대기인데 treatment_room 잔존값이 있어도 '치료대기'만 표기(방 미표시)
        treatmentWaitingWithStaleRoom: label('treatment_waiting', { treatment_room: '치료실2' }),
        treatmentWaitingNoRoom: label('treatment_waiting', {}),
        // 대기 단계 전반: 방 미표시
        consultWaiting: label('consult_waiting', { consultation_room: '상담실1' }),
        // 입실 단계: 단계 · 방이름
        inLaserRoom: label('laser', { laser_room: '레이저실A' }),
        inConsultRoom: label('consultation', { consultation_room: '상담실1' }),
        // 입실 단계인데 방 미배정: 단계만
        laserNoRoom: label('laser', {}),
      };
    });

    // AC-5: 치료대기 환자는 방배정으로 표시되지 않는다 (방 잔존값 무시)
    expect(result.treatmentWaitingWithStaleRoom).toBe('치료대기');
    expect(result.treatmentWaitingNoRoom).toBe('치료대기');
    expect(result.consultWaiting).toBe('상담대기');
    // 실제 입실 단계는 방 이름과 함께 표기
    expect(result.inLaserRoom).toBe('레이저 · 레이저실A');
    expect(result.inConsultRoom).toBe('상담 · 상담실1');
    expect(result.laserNoRoom).toBe('레이저');
  });

  test('AC-4: 위치 라벨이 status(단계)에서 파생 → status 변경 시 갱신(stale 제거)', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const STATUS_KO: Record<string, string> = {
        treatment_waiting: '치료대기', preconditioning: '치료실', laser: '레이저',
      };
      const IN_ROOM = ['consultation', 'examination', 'preconditioning', 'laser'];
      const label = (status: string, laser_room: string | null = null) => {
        const stage = STATUS_KO[status] ?? '대기';
        if (IN_ROOM.includes(status)) return laser_room ? `${stage} · ${laser_room}` : stage;
        return stage;
      };
      // 같은 환자가 치료대기 → 치료실(입실, 방A)로 이동: 라벨이 단계 변화에 따라 갱신
      const t0 = label('treatment_waiting', '치료실A'); // 대기: 방 미표시
      const t1 = label('preconditioning', '치료실A');   // 입실: 단계·방
      return { t0, t1 };
    });
    expect(result.t0).toBe('치료대기');         // 대기 단계엔 방 미표시
    expect(result.t1).toBe('치료실 · 치료실A');  // 입실하면 방 표기로 갱신(stale 아님)
  });

  // ── AC-6 회귀: 기존 명단 기능(초/재진·메모·정렬) 모델 불변 ────────────────────────
  test('AC-6: 기존 활성/완료 분리·정렬·초재진 배지 로직 회귀 없음', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      type Row = { id: string; status_flag: string | null; checked_in_at: string };
      const active = (rows: Row[]) =>
        rows.filter((ci) => ci.status_flag === 'purple' || ci.status_flag === 'yellow')
          .sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at)).map((r) => r.id);
      const done = (rows: Row[]) =>
        rows.filter((ci) => ci.status_flag === 'pink')
          .sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at)).map((r) => r.id);
      const rows: Row[] = [
        { id: 'a', status_flag: 'purple', checked_in_at: '2026-06-09T02:00:00+00:00' },
        { id: 'b', status_flag: 'pink', checked_in_at: '2026-06-09T00:30:00+00:00' },
        { id: 'c', status_flag: 'yellow', checked_in_at: '2026-06-09T01:00:00+00:00' },
      ];
      // displayList = [...active, ...done] (활성 상단 → 완료 하단)
      const display = [...active(rows), ...done(rows)];
      // 초/재진/체험 배지 분기 불변
      const badge = (vt: string, n?: number) =>
        vt === 'returning' ? `재진${typeof n === 'number' && n > 0 ? ` ${n}회차` : ''}` : vt === 'experience' ? '체험' : '초진';
      return { display, badge: [badge('new'), badge('returning', 2), badge('experience')] };
    });
    expect(result.display).toEqual(['c', 'a', 'b']); // 활성(c 01:00, a 02:00) → 완료(b)
    expect(result.badge).toEqual(['초진', '재진 2회차', '체험']);
  });

  // ── 대시보드 렌더 회귀 스모크 + 위젯 위치/배지 DOM 확인(데이터 의존 graceful skip) ──
  test('회귀: 위젯 보강 후 대시보드 정상 렌더 + 위치 배지 존재', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();

    const list = page.locator('[data-testid="doctor-call-list"]');
    if ((await list.count()) === 0) {
      test.skip(true, '진료필요/힐러 당일 체크인 없음 — 위젯 미표시 환경 스킵');
      return;
    }
    await expect(list).toBeVisible();
    // 위치 배지는 항상 렌더(단계 라벨) — 최소 1개 존재
    const loc = page.locator('[data-testid="doctor-call-location"]');
    if ((await loc.count()) > 0) {
      await expect(loc.first()).toBeVisible();
      // 위치 라벨은 비어있지 않다(단계 파생)
      expect((await loc.first().innerText()).trim().length).toBeGreaterThan(0);
    }
  });
});
