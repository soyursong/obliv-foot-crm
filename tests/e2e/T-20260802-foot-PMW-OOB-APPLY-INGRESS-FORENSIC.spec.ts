/**
 * T-20260802-foot-PMW-OOB-APPLY-INGRESS-FORENSIC — B2 apply-runner preflight guard
 *
 * 재발벡터 B2 (supervisor 사전승인 MSG-20260802-115032-k3xo):
 *   apply 러너가 워킹트리 up.sql 을 prod 에 실적용하기 전, 그 파일이 **승인커밋의
 *   blob 과 바이트-동일** + **워킹트리 clean** 임을 강제한다. V1(커밋 미대조 apply)
 *   최우선 차단책.
 *
 * 검증 대상: scripts/dryrun_lib.mjs 의 applyPreflight() 순수 클라이언트-측 가드.
 *   INV-B2-1 blob 일치  : git hash-object == 승인커밋 blob
 *   INV-B2-2 워킹트리 clean: git status --porcelain 빈 값
 *   fail-closed         : 승인커밋 미지정 / 레포-밖 / 커밋에 파일 부재 → abort
 *
 * 방식: 격리된 임시 git 레포를 만들어 각 시나리오를 실측한다 (DB 무접점, 순수 로컬).
 * 브라우저 불요 — 빌드-툴링 가드이므로 node/git 만으로 불변식을 검증.
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// dryrun_lib.mjs 를 ESM 으로 로드 (repo 절대경로)
const LIB_URL = pathToFileURL(join(process.cwd(), 'scripts/dryrun_lib.mjs')).href;

function g(cwd: string, ...argv: string[]) {
  return execFileSync('git', argv, { cwd, encoding: 'utf8' }).trim();
}

/** 초기 커밋 1개(up.sql)를 가진 격리 레포를 만들고 { dir, upPath, commit } 반환 */
function makeRepo(sql: string) {
  const dir = mkdtempSync(join(tmpdir(), 'b2-preflight-'));
  g(dir, 'init', '-q');
  g(dir, 'config', 'user.email', 'b2@test.local');
  g(dir, 'config', 'user.name', 'b2-test');
  g(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, 'migrations'), { recursive: true });
  const rel = 'migrations/up.sql';
  writeFileSync(join(dir, rel), sql);
  g(dir, 'add', rel);
  g(dir, 'commit', '-q', '-m', 'approved migration');
  const commit = g(dir, 'rev-parse', 'HEAD');
  return { dir, rel, upPath: join(dir, rel), commit };
}

test.describe('B2 apply-runner preflight (applyPreflight)', () => {
  let applyPreflight: (o: Record<string, unknown>) => { ok: boolean; code: string | null; checks: unknown[] };
  let assertApplyPreflight: (o: Record<string, unknown>) => unknown;
  const dirs: string[] = [];

  test.beforeAll(async () => {
    const mod = await import(LIB_URL);
    applyPreflight = mod.applyPreflight;
    assertApplyPreflight = mod.assertApplyPreflight;
  });

  test.afterAll(() => {
    for (const d of dirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });

  test('PASS — 워킹트리 파일 == 승인커밋 blob & clean', () => {
    const r = makeRepo('CREATE TABLE t(a int);\n'); dirs.push(r.dir);
    const res = applyPreflight({ upPath: r.upPath, approvedCommit: r.commit, cwd: r.dir });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(res.code).toBe('APPLY_PREFLIGHT_PASS');
  });

  test('ABORT BLOB_MISMATCH — 커밋 후 워킹트리 로컬 수정 (V1 재현)', () => {
    const r = makeRepo('CREATE TABLE t(a int);\n'); dirs.push(r.dir);
    // 승인커밋 이후 워킹트리 파일을 몰래 바꿔치기 (미커밋)
    writeFileSync(r.upPath, 'CREATE TABLE t(a int);\nDROP TABLE audit_log;\n');
    const res = applyPreflight({ upPath: r.upPath, approvedCommit: r.commit, cwd: r.dir });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('APPLY_PREFLIGHT_BLOB_MISMATCH');
  });

  test('ABORT PATH_DIRTY — 내용은 같아도 스테이징된 pending 변경', () => {
    const r = makeRepo('SELECT 1;\n'); dirs.push(r.dir);
    // 동일 바이트로 다시 써서 blob 은 일치하지만 status 를 dirty 로 만들기 위해
    // 별도 스테이징 변경을 만든다: 파일을 수정→add→원복(내용 동일, 인덱스 dirty)
    writeFileSync(r.upPath, 'SELECT 2;\n');
    g(r.dir, 'add', r.rel);            // 인덱스에 SELECT 2 스테이징
    writeFileSync(r.upPath, 'SELECT 1;\n'); // 워킹트리는 원래 blob 으로 복귀
    // 이제 hash-object(워킹트리)=승인 blob 이지만 git status 는 dirty(staged M)
    const res = applyPreflight({ upPath: r.upPath, approvedCommit: r.commit, cwd: r.dir });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('APPLY_PREFLIGHT_PATH_DIRTY');
  });

  test('ABORT NO_APPROVED_COMMIT — 승인커밋 미지정 fail-closed', () => {
    const r = makeRepo('SELECT 1;\n'); dirs.push(r.dir);
    const prev = process.env.APPLY_APPROVED_COMMIT;
    delete process.env.APPLY_APPROVED_COMMIT;
    const res = applyPreflight({ upPath: r.upPath, cwd: r.dir });
    if (prev !== undefined) process.env.APPLY_APPROVED_COMMIT = prev;
    expect(res.ok).toBe(false);
    expect(res.code).toBe('APPLY_PREFLIGHT_NO_APPROVED_COMMIT');
  });

  test('ABORT PATH_ABSENT_AT_COMMIT — 승인커밋에 없던 파일', () => {
    const r = makeRepo('SELECT 1;\n'); dirs.push(r.dir);
    // 승인커밋에 없던 신규 파일을 워킹트리에만 생성
    const relNew = 'migrations/rogue.sql';
    writeFileSync(join(r.dir, relNew), 'DROP TABLE t;\n');
    const res = applyPreflight({ upPath: join(r.dir, relNew), approvedCommit: r.commit, cwd: r.dir });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('APPLY_PREFLIGHT_PATH_ABSENT_AT_COMMIT');
  });

  test('ABORT PATH_OUTSIDE_REPO — 레포 밖 경로', () => {
    const r = makeRepo('SELECT 1;\n'); dirs.push(r.dir);
    const outside = join(tmpdir(), 'b2-outside.sql');
    writeFileSync(outside, 'SELECT 1;\n');
    const res = applyPreflight({ upPath: outside, approvedCommit: r.commit, cwd: r.dir });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('APPLY_PREFLIGHT_PATH_OUTSIDE_REPO');
    try { rmSync(outside, { force: true }); } catch { /* noop */ }
  });

  test('strictTree — 레포 내 무관 파일 dirty 도 abort', () => {
    const r = makeRepo('SELECT 1;\n'); dirs.push(r.dir);
    writeFileSync(join(r.dir, 'unrelated.txt'), 'noise\n'); // untracked noise
    const lax = applyPreflight({ upPath: r.upPath, approvedCommit: r.commit, cwd: r.dir });
    expect(lax.ok, 'strictTree=false 는 대상 파일만 보므로 PASS').toBe(true);
    const strict = applyPreflight({ upPath: r.upPath, approvedCommit: r.commit, cwd: r.dir, strictTree: true });
    expect(strict.ok).toBe(false);
    expect(strict.code).toBe('APPLY_PREFLIGHT_TREE_DIRTY');
  });

  test('assertApplyPreflight — 실패 시 throw (러너 hard-stop)', () => {
    const r = makeRepo('SELECT 1;\n'); dirs.push(r.dir);
    writeFileSync(r.upPath, 'SELECT 999;\n'); // blob mismatch
    expect(() => assertApplyPreflight({ upPath: r.upPath, approvedCommit: r.commit, cwd: r.dir }))
      .toThrow(/APPLY_PREFLIGHT_BLOB_MISMATCH/);
  });
});
