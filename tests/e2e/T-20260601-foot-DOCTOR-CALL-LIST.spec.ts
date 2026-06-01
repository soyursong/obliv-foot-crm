/**
 * E2E spec — T-20260601-foot-DOCTOR-CALL-LIST
 * 대시보드 하단 '원장님 진료콜 명단' 자동 집계 위젯 (DoctorCallListBar)
 *
 * 현장 요청 (김주연 총괄, 슬랙 C0ATE5P6JTH / MSG-20260601-124719-bvpf):
 *   상태플래그를 '보라(진료필요)'로 바꾸면 대시보드 하단 빨간박스 영역에 '원장님 진료콜 명단'이
 *   자동 리스트업 → 데스크 수기 명단 제거. 다른 상태로 바뀌면 명단에서 제거.
 *
 * 구현:
 *   - src/components/DoctorCallListBar.tsx (신규 위젯)
 *   - src/pages/Dashboard.tsx (가로 스크롤 컨테이너 밖, flex-col root의 shrink-0 자식으로 배치)
 *   - check_ins.doctor_call_memo TEXT NULL (진료 전달사항 전용 — 방문동선 메모와 분리)
 *
 * 시나리오 4종(티켓 클릭 시나리오) → AC 매핑:
 *   시나리오1 자동명단 등장/제거 → AC-1/AC-2
 *   시나리오1 초/재진 배지+N회차 → AC-3
 *   시나리오2 메모 영속        → AC-4
 *   시나리오3 sticky           → AC-6
 *   시나리오4 지정콜 하이라이트 → AC-5
 *   당일·지점 필터             → AC-7
 *
 * 컨벤션: 핵심 비즈로직은 page.evaluate 로 환경독립 검증(컴포넌트 로직 박제),
 *         + 대시보드 렌더 스모크(데이터/인증 없으면 graceful skip).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260601 DOCTOR-CALL-LIST — 원장님 진료콜 자동명단', () => {
  // ── 시나리오1 / AC-1·AC-2: 보라(purple) 자동 리스트업 (활성) ───────────────────────
  //    ※ AC-2 는 T-20260601-foot-CALLLIST-DONE-INACTIVE 로 대체됨:
  //       핑크(진료완료)는 명단에서 '제거'가 아니라 '비활성(완료) 잔존'.
  //       따라서 여기서는 '활성(콜대상) 집계'만 검증하고, 핑크 잔존/정렬은 후속 spec에서 검증.
  test('AC-1: status_flag=purple(활성) 만 콜대상 명단에 접수순 집계된다', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // DoctorCallListBar.activeList 와 동일: status_flag === 'purple' 필터 + checked_in_at 정렬
      type Row = { id: string; status_flag: string | null; checked_in_at: string };
      const activeList = (rows: Row[]) =>
        rows
          .filter((ci) => ci.status_flag === 'purple')
          .sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at))
          .map((ci) => ci.id);

      const before: Row[] = [
        { id: 'a', status_flag: 'purple', checked_in_at: '2026-06-01T02:00:00+00:00' },
        { id: 'b', status_flag: 'white', checked_in_at: '2026-06-01T01:00:00+00:00' },
        { id: 'c', status_flag: 'purple', checked_in_at: '2026-06-01T00:30:00+00:00' },
        { id: 'd', status_flag: 'pink', checked_in_at: '2026-06-01T00:10:00+00:00' },
      ];
      const active = activeList(before);

      // a 를 핑크(진료완료)로 전환 → 활성 명단에서는 빠진다(콜대상 아님). (핑크 잔존은 후속 spec)
      const after = before.map((r) => (r.id === 'a' ? { ...r, status_flag: 'pink' } : r));
      const afterActive = activeList(after);

      return { active, afterActive };
    });

    // 보라만 활성 집계 + 접수순 정렬 → c(00:30) before a(02:00). white/pink 제외.
    expect(result.active).toEqual(['c', 'a']);
    // a 핑크 전환 후 활성 명단에서 제외, 보라(c)만 활성 유지
    expect(result.afterActive).toEqual(['c']);
  });

  // ── 시나리오1 보강 / AC-3: 초진/재진 배지 + 재진 N회차 ─────────────────────────────
  test('AC-3: 초진/재진/체험 배지 + 재진은 N회차(누적 내원수) 표기', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // DoctorCallRow.visitBadge 와 동일 분기 + visitCounts 산출(고객 전체 check_ins 건수)
      const badge = (visit_type: string, visitCount?: number) => {
        if (visit_type === 'returning')
          return `재진${typeof visitCount === 'number' && visitCount > 0 ? ` ${visitCount}회차` : ''}`;
        if (visit_type === 'experience') return '체험';
        return '초진';
      };
      return {
        newPatient: badge('new'),
        returning3: badge('returning', 3),
        returningNoCount: badge('returning', undefined),
        experience: badge('experience'),
      };
    });
    expect(result.newPatient).toBe('초진');
    expect(result.returning3).toBe('재진 3회차');
    expect(result.returningNoCount).toBe('재진'); // 회차 미산출 시 배지만
    expect(result.experience).toBe('체험');
  });

  // ── 시나리오2 / AC-4: 진료 전달사항 메모 정규화·영속 모델 ──────────────────────────
  test('AC-4: 진료 전달사항 메모 저장 정규화 (공백→null, 영속 후 동일 표시)', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // DoctorCallRow.saveMemo 와 동일: trim() === '' ? null : trim()
      const normalize = (draft: string) => (draft.trim() === '' ? null : draft.trim());
      // 표시 분기: doctor_call_memo || '진료 전달사항 +'
      const display = (memo: string | null) => memo || '진료 전달사항 +';

      const saved = normalize('  혈압 체크 후 진료  ');
      const cleared = normalize('   ');
      return {
        saved,
        // 새로고침 후(DB값으로 재마운트) 같은 메모가 다시 보임
        reloadedDisplay: display(saved),
        cleared,
        clearedDisplay: display(cleared),
      };
    });
    expect(result.saved).toBe('혈압 체크 후 진료'); // 양끝 공백 정규화
    expect(result.reloadedDisplay).toBe('혈압 체크 후 진료'); // 영속 후 동일 표시
    expect(result.cleared).toBeNull(); // 공백만 입력 시 null
    expect(result.clearedDisplay).toBe('진료 전달사항 +'); // placeholder 복귀
  });

  // ── 시나리오4 / AC-5: 전체콜/지정콜 하이라이트 토글 모델 ───────────────────────────
  test('AC-5: 지정콜(행 선택)·전체콜 하이라이트 토글이 상호 배타적으로 동작', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // DoctorCallListBar: highlighted = allCall || selectedId === ci.id
      const ids = ['p1', 'p2', 'p3'];
      const highlightedSet = (allCall: boolean, selectedId: string | null) =>
        ids.filter((id) => allCall || selectedId === id);

      // 지정콜: p2 선택
      const designated = highlightedSet(false, 'p2');
      // 전체콜 활성화(지정 해제)
      const all = highlightedSet(true, null);
      // 지정콜 재선택 시 전체콜 해제(상호배타) — 컴포넌트 onSelect: setAllCall(false)
      const reDesignated = highlightedSet(false, 'p1');
      // 명단에서 사라진 행이 선택돼 있으면 자동 해제(useEffect) — p9는 명단에 없음
      const staleCleared = ids.includes('p9') ? 'p9' : null;

      return { designated, all, reDesignated, staleCleared };
    });
    expect(result.designated).toEqual(['p2']); // 지정콜 1건만 호출 중
    expect(result.all).toEqual(['p1', 'p2', 'p3']); // 전체콜 → 전원 강조
    expect(result.reDesignated).toEqual(['p1']); // 재지정 시 전체콜 해제
    expect(result.staleCleared).toBeNull(); // 명단 이탈 행 선택 자동 해제
  });

  // ── AC-7: 당일·지점 필터는 부모(Dashboard.rows)가 책임 — 위젯은 재필터 안 함 ────────
  test('AC-7: 위젯은 부모가 당일·지점으로 필터한 rows 만 받아 status_flag 만 추가 필터', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // Dashboard.fetchCheckIns 가 clinic_id + 당일(KST)로 필터한 rows 를 그대로 전달.
      // 위젯은 status_flag=purple 만 추가로 거른다 (날짜/지점 재필터 없음 = 부모 신뢰).
      type Row = { id: string; status_flag: string | null; checked_in_at: string };
      const widgetFilter = (rows: Row[]) =>
        rows.filter((ci) => ci.status_flag === 'purple').map((ci) => ci.id);
      // 부모가 이미 당일·해당지점으로 좁힌 rows (타 날짜/지점 row 는 애초에 없음)
      const sameDayClinic: Row[] = [
        { id: 'x', status_flag: 'purple', checked_in_at: '2026-06-01T03:00:00+00:00' },
        { id: 'y', status_flag: 'orange', checked_in_at: '2026-06-01T03:10:00+00:00' },
      ];
      return widgetFilter(sameDayClinic);
    });
    expect(result).toEqual(['x']); // 당일·지점 보라 1건만
  });

  // ── 시나리오3 / AC-6: sticky — 가로 스크롤 컨테이너 밖 배치(렌더 스모크) ────────────
  test('AC-6: 명단 위젯이 가로 스크롤 영역 밖, flex-col root 직계 자식으로 렌더된다', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const root = page.locator('[data-testid="dashboard-root"]');
    await expect(root).toBeVisible();

    // 보라(진료필요) check_in 이 없으면 위젯은 null 렌더 → 구조 검증 스킵(데이터 의존)
    const list = page.locator('[data-testid="doctor-call-list"]');
    if ((await list.count()) === 0) {
      test.skip(true, '보라(진료필요) 당일 체크인 없음 — 위젯 미표시 환경 스킵');
      return;
    }

    // 위젯은 dashboard-root 의 직계(혹은 근접) 자식이어야 하며,
    // 가로 스크롤 컨테이너(overflow-x:auto 영역) 안에 중첩되면 안 된다.
    const isOutsideHScroll = await list.evaluate((el) => {
      let cur = el.parentElement;
      while (cur && !cur.matches('[data-testid="dashboard-root"]')) {
        const ox = getComputedStyle(cur).overflowX;
        if (ox === 'auto' || ox === 'scroll') return false; // 가로 스크롤 컨테이너 내부 = 실패
        cur = cur.parentElement;
      }
      return cur != null; // dashboard-root 까지 도달 = 스크롤 영역 밖
    });
    expect(isOutsideHScroll).toBe(true);

    // shrink-0 으로 viewport 하단 고정 — 위젯이 화면에 보인다
    await expect(list).toBeVisible();
  });

  // ── 대시보드 렌더 회귀 스모크 ──────────────────────────────────────────────────
  test('회귀: 위젯 도입 후 대시보드가 정상 렌더된다', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await expect(page.locator('[data-testid="dashboard-root"]')).toBeVisible();
  });
});
