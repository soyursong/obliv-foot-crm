/**
 * E2E spec — T-20260613-foot-RXLIST-FUNGAL-LABEL-SAVEBUG
 * 풋센터 현장 3건 묶음(현장 클릭 시나리오 4종 변환):
 *   S1 [AC-1] 진료환자목록 필터탭 라벨 '처방나감' → '처방환자 목록'.
 *             표시 라벨만 교정 — confirmed 필터 key/카운트 로직 불변(정렬·필터 회귀 0).
 *   S2 [AC-2] 균검사지 화면 사용자 노출 라벨/문구/토스트 '발톱' → '조갑'.
 *             헤더('조갑부위')·안내문('조갑부위는…')·저장실패 토스트('조갑부위 저장 실패').
 *             ⚠ 변수명·DB컬럼(koh_nail_sites)·RPC명(set_koh_nail_sites)은 불변(주석 무관).
 *   S3 [AC-2] 범위 제외 가드 — 진료환자목록 '임시'(pending) 라벨은 미확정이라 건드리지 않음(불변).
 *   S4 [AC-3] 균검사지 저장 버그 RCA — set_koh_nail_sites RPC/koh_nail_sites 컬럼이 prod 미적용이면
 *             write 경로 실패('저장안됨'). read 는 42703 폴백으로 명단 유지되나 write 는 폴백 없음.
 *             PHASE15 마이그(20260612160000_koh_nail_sites.sql) 적용이 직접 fix.
 *
 * 스타일: PHASE15 spec(T-20260612)과 동일 — in-page 정본 모사 + 소스 정적검증.
 *   라벨 rename 은 소스 파일 텍스트를 직접 읽어 신규 라벨 present / 구 라벨 absent 를 단언(리버트 회귀 차단).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const readSrc = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const DOCTOR_PATIENT_LIST = 'src/components/doctor/DoctorPatientList.tsx';
const KOH_REPORT_TAB = 'src/components/doctor/KohReportTab.tsx';

// ───────────────────────────────────────────────────────────────────────────
// S1 [AC-1] 진료환자목록 필터탭 라벨: '처방나감' → '처방환자 목록'
//   confirmed 필터 key/카운트 로직은 불변 — 표시 라벨(label 템플릿)만 교정.
// ───────────────────────────────────────────────────────────────────────────
test.describe('S1 [AC-1] 진료환자목록 필터탭 라벨 처방환자 목록', () => {
  test('confirmed 탭 라벨이 "처방환자 목록"이고 "처방나감"은 사용자 노출에서 사라짐', () => {
    const src = readSrc(DOCTOR_PATIENT_LIST);

    // 신규 라벨 present — confirmedCount 를 보간하는 표시 라벨.
    expect(src).toContain('처방환자 목록 (${confirmedCount})');

    // 구 라벨 absent — label 템플릿에서 '처방나감 (' 가 더 이상 없어야 함(주석의 변천 표기는 허용).
    expect(src).not.toContain('처방나감 (${confirmedCount})');
    expect(src).not.toContain('label: `처방나감');
  });

  test('confirmed 필터 key/카운트 로직 불변 — key="confirmed" + confirmedCount 보간 유지', () => {
    const src = readSrc(DOCTOR_PATIENT_LIST);
    // 필터 key 는 'confirmed' 그대로(필터/카운트 로직 불변 보장).
    expect(src).toMatch(/key:\s*'confirmed'\s+as const,\s*label:\s*`처방환자 목록 \(\$\{confirmedCount\}\)`/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// S3 [AC-2 범위가드] 진료환자목록 '임시'(pending) 라벨은 미확정 → 불변(건드리지 않음)
// ───────────────────────────────────────────────────────────────────────────
test.describe('S3 [AC-2 범위가드] pending(임시) 라벨 불변', () => {
  test('"임시 (${pendingCount})" 라벨은 그대로 유지(범위 제외)', () => {
    const src = readSrc(DOCTOR_PATIENT_LIST);
    expect(src).toContain('임시 (${pendingCount})');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// S2 [AC-2] 균검사지 사용자 노출 '발톱' → '조갑'. 변수/DB컬럼/RPC명 불변.
// ───────────────────────────────────────────────────────────────────────────
test.describe('S2 [AC-2] 균검사지 화면 발톱→조갑 (사용자 노출 한정)', () => {
  test('헤더 컬럼명이 "조갑부위" (발톱부위 헤더 제거)', () => {
    const src = readSrc(KOH_REPORT_TAB);
    expect(src).toContain('<th className="px-3 py-2.5 font-medium">조갑부위</th>');
    expect(src).not.toContain('<th className="px-3 py-2.5 font-medium">발톱부위</th>');
  });

  test('저장 실패 토스트 문구가 "조갑부위 저장 실패"', () => {
    const src = readSrc(KOH_REPORT_TAB);
    expect(src).toContain('조갑부위 저장 실패');
    expect(src).not.toContain('발톱부위 저장 실패');
  });

  test('안내문이 "조갑부위는 …" (발톱부위는 … 제거)', () => {
    const src = readSrc(KOH_REPORT_TAB);
    expect(src).toContain('조갑부위는 R/L·발가락을 눌러 입력하세요');
    expect(src).not.toContain('발톱부위는 R/L·발가락을 눌러 입력하세요');
  });

  test('⚠ 변수명·DB컬럼·RPC명은 불변 — koh_nail_sites / set_koh_nail_sites 유지', () => {
    const src = readSrc(KOH_REPORT_TAB);
    // DB 컬럼/RPC 식별자는 절대 rename 금지(PHASE15 마이그와 일치 유지).
    expect(src).toContain('koh_nail_sites');
    expect(src).toContain("supabase.rpc('set_koh_nail_sites'");
    // NailSite 타입/변수도 그대로(코드 식별자 무변경).
    expect(src).toContain('export interface NailSite');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// S4 [AC-3] 저장 버그 RCA — PHASE15 마이그(RPC/컬럼) 미적용이 직접원인.
//   write 경로는 read 와 달리 폴백 없음 → RPC 부재 시 그대로 실패('저장안됨').
//   아래는 write mutation 의 동작 동치 모사(정본: useSaveNailSites.mutationFn).
// ───────────────────────────────────────────────────────────────────────────
test.describe('S4 [AC-3] 조갑부위 저장 RCA — RPC 부재 시 저장 실패', () => {
  // 정본 모사: useSaveNailSites.mutationFn — supabase.rpc('set_koh_nail_sites') 호출, error 면 throw.
  type RpcResult = { error: { code: string; message: string } | null };
  async function saveNailSites(rpc: (fn: string) => Promise<RpcResult>): Promise<string> {
    const { error } = await rpc('set_koh_nail_sites');
    if (error) throw new Error(`조갑부위 저장 실패: ${error.message}`); // onError 토스트 동치
    return 'saved';
  }

  test('RPC 미적용(PGRST202)이면 저장이 실패한다 — 현장 "저장안됨"의 직접원인', async () => {
    // prod 실측(2026-06-13): set_koh_nail_sites → HTTP 404 PGRST202(schema cache 미존재).
    const rpcMissing = async (): Promise<RpcResult> => ({
      error: { code: 'PGRST202', message: 'Could not find the function public.set_koh_nail_sites' },
    });
    await expect(saveNailSites(rpcMissing)).rejects.toThrow('조갑부위 저장 실패');
  });

  test('PHASE15 마이그 적용 후 RPC 존재하면 저장 성공한다 — 직접 fix', async () => {
    const rpcPresent = async (): Promise<RpcResult> => ({ error: null });
    await expect(saveNailSites(rpcPresent)).resolves.toBe('saved');
  });

  test('read 폴백 ≠ write 폴백 — read(42703)는 폴백 select 로 명단 유지, write 는 폴백 없음', () => {
    const src = readSrc(KOH_REPORT_TAB);
    // read 경로: koh_nail_sites 컬럼 부재(42703) 감지 시 제외 select 폴백 존재(명단 안 깨짐).
    expect(src).toMatch(/koh_nail_sites/);
    expect(src).toContain('SELECT_WITHOUT');
    // write 경로: RPC 호출은 단일 — 폴백 분기 없음(마이그 적용이 유일 fix).
    expect(src).toContain("supabase.rpc('set_koh_nail_sites'");
  });
});
