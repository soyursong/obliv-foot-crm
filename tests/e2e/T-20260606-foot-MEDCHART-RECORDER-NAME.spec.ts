/**
 * T-20260606-foot-MEDCHART-RECORDER-NAME — 임상차트 기록자 의사 이름 DB 영구 저장
 *
 * 배경:
 *   현재 medical_charts 는 created_by(이메일)만 저장. 기록자 이름은 조회 시점에
 *   user_profiles 조인(staffNameMap)으로 동적 파생 → 의사 계정 삭제/이메일 변경 시
 *   기록자 추적 끊김(의료기록 원칙 소지).
 *
 * 변경:
 *   AC-1 [DB] medical_charts.created_by_name TEXT 컬럼 추가(NULL 허용).
 *   AC-2 [DB] backfill: user_profiles.name ↔ created_by(이메일) join (dry-run 선행, 미매칭 NULL 유지).
 *   AC-3 [코드] 저장 payload 에 created_by_name: currentUserName 추가.
 *   AC-4 [타입] MedicalChart.created_by_name?: string|null.
 *   AC-5 [표시] created_by_name 우선, 없으면 recorderName(created_by) 폴백.
 *
 * 시나리오 2종:
 *   S1 (영구 저장): created_by_name 컬럼이 존재하고 조회 가능하다(스키마 + 데이터 무손실).
 *   S2 (표시 우선/폴백): created_by_name 있으면 그 값, NULL이면 이메일 로컬파트 폴백.
 */
import { test, expect } from '@playwright/test';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';

test.describe('T-20260606-foot-MEDCHART-RECORDER-NAME', () => {

  // ── S1: 영구 저장 (DB 스키마 + 무손실) ──────────────────────────────
  test('S1: medical_charts.created_by_name 컬럼이 조회 가능(스키마 적용 확인)', async ({ request }) => {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!serviceKey) {
      test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY not set — skip DB check');
      return;
    }
    // 신규 컬럼을 명시 select → 컬럼 미존재 시 400(PostgREST). 200이면 컬럼 적용됨.
    const url = `${SUPABASE_URL}/rest/v1/medical_charts?select=id,created_by,created_by_name&limit=5`;
    const resp = await request.get(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(Array.isArray(body)).toBe(true);
    // 각 행은 created_by_name 키를 가짐(값은 NULL 가능 — 레거시/미매칭).
    for (const row of body) {
      expect(row).toHaveProperty('created_by_name');
    }
  });

  test('S1-b: backfill 매칭행은 이름 스냅샷 보유(매칭행 존재 시) — 무손실 확인', async ({ request }) => {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!serviceKey) {
      test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY not set — skip DB check');
      return;
    }
    // created_by_name 이 채워진 행(신규 저장분 또는 backfill 적용분)이 있으면 비어있지 않아야 함.
    const url = `${SUPABASE_URL}/rest/v1/medical_charts?select=created_by_name&created_by_name=not.is.null&limit=10`;
    const resp = await request.get(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    for (const row of body) {
      expect(typeof row.created_by_name).toBe('string');
      expect(row.created_by_name.trim().length).toBeGreaterThan(0);
    }
  });

  // ── S2: 표시 우선순위/폴백 로직 (순수 함수 검증) ─────────────────────
  // FE 표시 규칙 미러: const recorder = chart.created_by_name || recorderName(chart.created_by)
  //   recorderName(email) = staffNameMap[email] ?? email.split('@')[0] ?? email
  function recorderDisplay(
    chart: { created_by: string | null; created_by_name?: string | null },
    staffNameMap: Record<string, string> = {},
  ): string | null {
    const recorderName = (createdBy: string | null | undefined): string | null => {
      if (!createdBy) return null;
      return staffNameMap[createdBy] ?? createdBy.split('@')[0] ?? createdBy;
    };
    return chart.created_by_name || recorderName(chart.created_by);
  }

  test('S2-a: created_by_name 있으면 그 값을 우선 사용(계정 변경 무관)', () => {
    // 동적 매핑이 비어 있어도(계정 삭제 시나리오) 스냅샷 이름이 그대로 표시됨.
    const r = recorderDisplay({ created_by: 'deleted@oblivseoul.kr', created_by_name: '문지은' }, {});
    expect(r).toBe('문지은');
  });

  test('S2-b: created_by_name NULL이면 staffNameMap 폴백', () => {
    const r = recorderDisplay(
      { created_by: 'wlgp3907@naver.com', created_by_name: null },
      { 'wlgp3907@naver.com': '김지혜' },
    );
    expect(r).toBe('김지혜');
  });

  test('S2-c: created_by_name NULL + 매핑 없으면 이메일 로컬파트 폴백', () => {
    const r = recorderDisplay({ created_by: 'someone@oblivseoul.kr', created_by_name: null }, {});
    expect(r).toBe('someone');
  });

  test('S2-d: created_by_name 빈문자열도 폴백(|| 가드)', () => {
    const r = recorderDisplay(
      { created_by: 'a@b.com', created_by_name: '' },
      { 'a@b.com': '관리자' },
    );
    expect(r).toBe('관리자');
  });

  test('S2-e: created_by/created_by_name 모두 없으면 null(표시 숨김)', () => {
    const r = recorderDisplay({ created_by: null, created_by_name: null }, {});
    expect(r).toBeNull();
  });
});
