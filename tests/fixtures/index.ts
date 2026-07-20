/**
 * 시드 fixture (T-foot-qa-001)
 *
 * 사용:
 *   const { id, cleanup } = await seedCheckIn({ status: 'consultation', visit_type: 'new' });
 *   afterAll(cleanup);
 *
 * 모든 fixture는 service_role 사용 + `[QA-FIXTURE]` 마커.
 * cleanup은 본인이 만든 row만 삭제 — 다른 데이터 영향 없음.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
export const MARKER = '[QA-FIXTURE]';
// 픽스처 customer/reservation 이름 접두 — orphan(마커 누락/생성중단) 스윕용 2차 키.
//   seedCheckIn → `qa-fixture-{ts}`, seedReservation → `qa-res-{ts}`.
export const FIXTURE_NAME_PREFIXES = ['qa-fixture-', 'qa-res-'] as const;

// ── Run-scoped 시드 격리 (T-20260720-foot-CHART-OPENGATE-SEED-ISOLATION-HARDEN) ──
//   RC(문서화): dev=prod 단일 Supabase(rxlomoozakkjesdqjtvd)를 여러 CI run 이 공유한다.
//     각 run 의 globalSetup pre-sweep / globalTeardown 이 cleanupAll() 로 bare 마커
//     (memo/notes == '[QA-FIXTURE]')를 **전수** DELETE 한다. run A 의 스윕이 동시 실행 중인
//     run B 의 in-flight 시드(특히 chart-open-gate G3/G4 어제/과거 예약카드)를 함께 지워
//     카드 소멸 → 교대성 하드 RED(T-20260713-foot-CI-E2E-RED-DIAGNOSE).
//   격리: 시드 마커에 run 토큰을 embed(`[QA-FIXTURE]|<token>|<tsMs>`)한다. bare-exact 로
//     매칭하는 cleanupAll() 은 이 scoped row 를 **매칭하지 못하므로**, 다른 run 의 전수
//     스윕이 이 run 의 시드를 건드릴 수 없다. scoped row 의 정리는 이 run 자신의
//     teardown(토큰 스코프) + 다음 run 의 pre-sweep(TTL 스코프)이 담당한다(sweepScoped).
//   토큰은 한 CI job 의 모든 프로세스(main+worker)에서 안정적이고 동시 run/job 간 유일해야
//   한다 → GitHub Actions 의 RUN_ID/ATTEMPT/JOB 조합. 로컬(비-CI)은 globalSetup 이 기록한
//   토큰 파일로 워커 간 공유.
const TOKEN_FILE = path.resolve(process.cwd(), 'test-results', '.qa-run-token');
// LIKE 안전(및 파일/URL 안전)을 위해 토큰을 [A-Za-z0-9-] 로 정규화 — '_'/'%' 등 LIKE 메타 제거.
function sanitizeToken(s: string): string {
  return s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
}
let _runToken: string | null = null;
/** 현재 CI run(=job) 을 유일하게 식별하는 안정 토큰. 프로세스 간 동일값 수렴. */
export function runToken(): string {
  if (_runToken) return _runToken;
  const gh = [process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT, process.env.GITHUB_JOB].filter(
    Boolean,
  ) as string[];
  if (gh.length) return (_runToken = sanitizeToken(gh.join('-')));
  if (process.env.QA_RUN_TOKEN) return (_runToken = sanitizeToken(process.env.QA_RUN_TOKEN));
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const t = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
      if (t) return (_runToken = sanitizeToken(t));
    }
  } catch {
    /* 파일 접근 실패 → 아래 기본값 */
  }
  return (_runToken = 'local');
}
/** 로컬(비-CI)에서 워커 프로세스가 동일 토큰을 읽도록 globalSetup 이 1회 파일 기록. */
export function ensureRunTokenFile(): void {
  if (process.env.GITHUB_RUN_ID || process.env.QA_RUN_TOKEN) return; // CI/env 토큰이면 파일 불요
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    if (!fs.existsSync(TOKEN_FILE)) {
      fs.writeFileSync(TOKEN_FILE, `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    }
  } catch {
    /* 기록 실패 시 runToken()='local' 폴백 — 로컬 단독 실행이면 무해 */
  }
}
/** 시드 memo/notes 에 박는 run-scoped 마커: `[QA-FIXTURE]|<token>|<tsMs>` */
export function runMarker(): string {
  return `${MARKER}|${runToken()}|${Date.now()}`;
}
// scoped row(파이프 포함) 전용 LIKE 패턴. bare '[QA-FIXTURE]'(파이프 없음)는 매칭 제외.
const SCOPED_LIKE = `${MARKER}|%`;
// leak 된 scoped row 를 stale 로 간주하는 TTL. 라이브 spec 은 분 단위로 끝나므로
//   2h 초과분은 crash 로 남은 잔재로 판정(동시 run 의 fresh row 는 절대 미포함).
const SCOPED_STALE_TTL_MS = 2 * 60 * 60 * 1000;
function markerTsMs(marker: string): number | null {
  const p = marker.split('|');
  if (p.length < 3) return null;
  const t = Number(p[p.length - 1]);
  return Number.isFinite(t) ? t : null;
}

let _sb: SupabaseClient | null = null;
function svc(): SupabaseClient {
  if (!_sb) _sb = createClient(SUPA_URL, SERVICE_KEY);
  return _sb;
}

// ── PRODREF-HARDGUARD (T-20260719-foot-HARNESS-TESTDB-ISOLATION / §4 defense-in-depth) ──
//   E2E/CI 하네스가 격리 dev DB(obliv-foot-dev)에서 다시 prod(rxlomoozakkjesdqjtvd)로
//   향하는 secret 오배선을 **첫 write 이전에** 큰소리로 차단한다.
//   - 기본값(EXPECT_DEV_DB_REF 미설정) = 무동작 → 컷오버 전 현행 CI 무파손(prod 타겟 허용).
//   - supervisor 가 컷오버 절차(docs/ENV-MATRIX.md §테스트/E2E 격리 DB, step 2~5)에서
//     `EXPECT_DEV_DB_REF=kcdqtyivtqcjmcrdjkqi` 를 CI/로컬에 주입 → 그 시점부터 가드 활성.
//     이후 secret 이 실수로 prod ref 로 되돌아가면 fixture write·cleanup 이전에 즉시 abort.
//   기존 registry teardown(AC-3)과 독립된 2차 방벽(defense-in-depth): teardown 은 '치우고',
//   이 가드는 '애초에 prod 로 못 쓰게' 한다.
const KNOWN_PROD_REF = 'rxlomoozakkjesdqjtvd';
export function assertExpectedDbTarget(): void {
  const expected = (process.env.EXPECT_DEV_DB_REF ?? '').trim();
  if (!expected) return; // opt-in — 컷오버 전에는 무동작
  const url = SUPA_URL ?? '';
  if (!url.includes(expected)) {
    throw new Error(
      `[PRODREF-HARDGUARD] E2E/CI target Supabase 가 기대 dev ref('${expected}')를 포함하지 않습니다 ` +
        `(VITE_SUPABASE_URL=${url || '<빈값>'}). secret 오배선 의심 → 하네스 abort(실환자 DB 오염 차단). ` +
        `컷오버 절차: docs/ENV-MATRIX.md §테스트/E2E 격리 DB.`,
    );
  }
  if (url.includes(KNOWN_PROD_REF) && expected !== KNOWN_PROD_REF) {
    throw new Error(
      `[PRODREF-HARDGUARD] target 이 prod ref('${KNOWN_PROD_REF}')를 가리킵니다. 격리 dev DB 로 전환하세요.`,
    );
  }
}

// ── 시드 row 레지스트리 (T-20260718-foot-SIM-HARNESS-TEARDOWN-HYGIENE / AC-3) ──
//   마커(memo/notes) + 이름접두 스윕은 test 가 name/memo 를 커스텀 값으로 덮어쓰면 놓칠 수
//   있다(POST 10 / DELETE 6 = 4 잔재의 구조적 원인). 프로세스가 살아있는 동안 생성한 row id
//   를 여기에 등록해, 마커 스윕과 **합집합**으로 teardown 이 정확한 id 로도 삭제하게 한다.
//   → registered-row 추적 = 마커 무관 100% 삭제 보장(실패-내성: 예외로 개별 cleanup 이 안
//   돌아도 globalTeardown 의 cleanupAll 이 레지스트리로 전수 회수).
export const REGISTRY: {
  customers: Set<string>;
  checkIns: Set<string>;
  packages: Set<string>;
  reservations: Set<string>;
} = { customers: new Set(), checkIns: new Set(), packages: new Set(), reservations: new Set() };

// E.164 한국 휴대폰 생성 — raw '010…' 저장은 Step1(DB CHECK, PHONE-E164-CHK-UNENFORCED)
//   배포 후 fail-closed(22023)로 시드가 깨져 sim/CI 대량 fail → dev 파이프라인 파손을 부른다.
//   시드부터 +8210… (E.164)로 정렬해 계약(cross_crm_data_contract phone E.164)을 강화한다.
function e164Mobile(ts: number): string {
  return `+8210${String(ts).slice(-8)}`;
}

export interface FixtureHandle {
  id: string;
  cleanup: () => Promise<void>;
}

/** 신규 customer + check_in (지정 단계) */
export async function seedCheckIn(opts: {
  status?: string;
  visit_type?: 'new' | 'returning' | 'experience';
  name?: string;
  package_id?: string;
  /**
   * AC-2 (T-20260718-foot-SIM-HARNESS-TEARDOWN-HYGIENE): 시드 customer 를 is_simulation 으로 표기.
   *
   * ⚠ dev=prod 단일 DB(rxlomoozakkjesdqjtvd) 제약상 이 플래그는 **양날**이다:
   *   - true  → 혹시 teardown 실패로 leak 돼도 stripSimulationRows/excludeSimulationPaymentRows 가
   *             실환자 뷰·매출집계에서 걸러줌(leak 위생). 그러나 run 중에도 admin 칸반/예약목록·매출에서
   *             숨겨지므로 대시보드 가시성을 assert 하는 spec(PKGBOX·CF·DASH…)이 깨진다.
   *   - false → run 중 fixture 가 admin surface 에 그대로 보여 기존 spec 통과(문서화된 비-sim 계약).
   * 따라서 기본값 false(가시성 계약 보존). 대시보드 가시성에 무관한 하네스 경로만 true 로 opt-in.
   * 근본 해소(leak 위생 + 가시성 양립)는 AC-4 dev/test DB 분리 이후에만 가능 → planner FOLLOWUP.
   */
  simulation?: boolean;
}): Promise<FixtureHandle & { customerId: string; phone: string }> {
  const sb = svc();
  const ts = Date.now();
  const phone = e164Mobile(ts); // AC-5: E.164 (+8210…) — Step1 DB CHECK 무파손
  const name = opts.name ?? `qa-fixture-${ts}`;

  const { data: c, error: cErr } = await sb
    .from('customers')
    .insert({
      clinic_id: CLINIC_ID,
      name,
      phone,
      visit_type: opts.visit_type ?? 'new',
      memo: MARKER,
      // AC-2: sim 플래그. is_simulation 컬럼은 customers 에만 존재(20260420000006_simulation_flag)
      //   → 연관 check_ins/packages/reservations 는 customer 링크로 필터되므로 여기 1곳이면 충분.
      //   기본 false(대시보드 가시성 계약 보존, 위 opts.simulation 주석 참조).
      is_simulation: opts.simulation ?? false,
    })
    .select('id')
    .single();
  if (cErr || !c) throw new Error(`seedCheckIn: customer insert failed: ${cErr?.message}`);
  const customerId = c.id as string;
  REGISTRY.customers.add(customerId); // AC-3: 마커 무관 회수 보장

  // queue_number 충돌 회피:
  //   유니크 제약 idx_checkins_clinic_date_queue = (clinic_id, kst_date(checked_in_at), queue_number).
  //   기존 `990 + ts%10` 은 동일 일자에 단 10버킷뿐 → 다회 시딩/잔존 row 와 duplicate key.
  //   QA 픽스처는 고대역(900000~999999) 랜덤으로 실데이터(1..N 순차 발번)와 분리하고,
  //   그래도 충돌 시 23505(unique_violation) 만 새 번호로 재시도.
  const checkedInAt = new Date().toISOString();
  const qaQueue = () => 900000 + Math.floor(Math.random() * 100000);
  let ci: { id: string } | null = null;
  let ciErr: { message?: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    const res = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: customerId,
        customer_name: name,
        customer_phone: phone,
        visit_type: opts.visit_type ?? 'new',
        status: opts.status ?? 'registered',
        queue_number: qaQueue(),
        package_id: opts.package_id,
        // 실제 체크인은 항상 checked_in_at 보유. 대시보드 카드 쿼리가
        // checked_in_at 오늘범위(gte/lte)로 필터하므로 미설정 시 카드가 안 뜬다.
        checked_in_at: checkedInAt,
        notes: MARKER,
      })
      .select('id')
      .single();
    ci = (res.data as { id: string } | null) ?? null;
    ciErr = (res.error as { message?: string; code?: string } | null) ?? null;
    if (!ciErr) break;
    if (ciErr.code === '23505') continue; // queue_number 충돌 → 새 번호 재시도
    break; // 그 외 오류는 즉시 중단
  }
  if (ciErr || !ci) {
    await sb.from('customers').delete().eq('id', customerId);
    throw new Error(`seedCheckIn: check_in insert failed: ${ciErr?.message}`);
  }
  const checkInId = ci.id as string;
  REGISTRY.checkIns.add(checkInId); // AC-3

  return {
    id: checkInId,
    customerId,
    phone,
    cleanup: async () => {
      await sb.from('payments').delete().eq('check_in_id', checkInId);
      await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customerId);
      REGISTRY.checkIns.delete(checkInId);
      REGISTRY.customers.delete(customerId);
    },
  };
}

/** 패키지 + package_payments */
export async function seedPackage(opts: {
  customerId: string;
  preset?: { label: string; total: number; suggestedPrice: number };
}): Promise<FixtureHandle> {
  const sb = svc();
  const preset = opts.preset ?? { label: '패키지1 (12회)', total: 12, suggestedPrice: 3600000 };
  const { data: pkg, error } = await sb
    .from('packages')
    .insert({
      clinic_id: CLINIC_ID,
      customer_id: opts.customerId,
      package_name: preset.label,
      package_type: `preset_${preset.total}`,
      total_sessions: preset.total,
      total_amount: preset.suggestedPrice,
      paid_amount: preset.suggestedPrice,
      status: 'active',
    })
    .select('id')
    .single();
  if (error || !pkg) throw new Error(`seedPackage failed: ${error?.message}`);
  const packageId = pkg.id as string;
  REGISTRY.packages.add(packageId); // AC-3
  return {
    id: packageId,
    cleanup: async () => {
      await sb.from('package_payments').delete().eq('package_id', packageId);
      await sb.from('packages').delete().eq('id', packageId);
      REGISTRY.packages.delete(packageId);
    },
  };
}

/** 오늘 예약 1건 */
export async function seedReservation(opts: {
  date?: string;
  time?: string;
  customerName?: string;
  visit_type?: 'new' | 'returning' | 'experience';
}): Promise<FixtureHandle> {
  const sb = svc();
  const ts = Date.now();
  const date = opts.date ?? new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const { data, error } = await sb
    .from('reservations')
    .insert({
      clinic_id: CLINIC_ID,
      customer_name: opts.customerName ?? `qa-res-${ts}`,
      reservation_date: date,
      reservation_time: opts.time ?? '14:00',
      visit_type: opts.visit_type ?? 'new',
      status: 'confirmed',
      memo: MARKER,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedReservation failed: ${error?.message}`);
  const id = data.id as string;
  REGISTRY.reservations.add(id); // AC-3
  return {
    id,
    cleanup: async () => {
      await sb.from('reservation_logs').delete().eq('reservation_id', id);
      await sb.from('reservations').delete().eq('id', id);
      REGISTRY.reservations.delete(id);
    },
  };
}

/** 활성 staff 1명 픽 (생성 X — 기존 row) */
export async function pickStaff(role?: string): Promise<{ id: string; name: string; role: string } | null> {
  const sb = svc();
  let q = sb.from('staff').select('id, name, role').eq('clinic_id', CLINIC_ID).eq('active', true).limit(1);
  if (role) q = q.eq('role', role);
  const { data } = await q;
  return data?.[0] ?? null;
}

export interface CleanupSummary {
  customers: number;
  checkIns: number;
  packages: number;
  reservations: number;
  /** FK 등으로 삭제 보류된 customer 수 (legacy 잔존 — 별도 PROD 정리 트랙 소관) */
  skippedCustomers: number;
}

// PostgREST .in() 은 id 들을 URL query 로 직렬화한다. 수천 건이면 URL 길이 초과로 statement
// 전체가 실패(414 등)하거나, 한 행의 FK 위반이 statement 전체를 롤백한다.
// → 청크 분할로 한 번에 보내는 양을 제한하고, 청크 실패 시 per-id 폴백으로 격리한다.
const DELETE_CHUNK = 50;
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Supabase/PostgREST 의 기본 select 상한은 1000 row. QA 잔존이 1000건을 넘으면
// 단일 select 가 truncate 되어 신규 픽스처가 페이지 밖으로 밀려 누락된다(RC#0 재현).
// → .range() 페이지네이션으로 전수 수집한다.
const PAGE = 1000;
type RangeQB = {
  range: (from: number, to: number) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>;
};
/** build() 가 만든 select 쿼리를 .range() 로 전수 페이지네이션해 지정 컬럼 값을 모은다. */
async function selectAllValues(build: () => RangeQB, column: string): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const r of data) {
      const v = r[column];
      if (v) out.push(v as string);
    }
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * id 집합을 청크+per-id 폴백으로 안전 삭제한다.
 *   - 청크 .in() delete 가 성공하면 그 청크는 일괄 삭제.
 *   - 한 행의 FK 위반 등으로 청크가 원자적으로 실패하면 per-id 로 격리 삭제 →
 *     삭제 가능한 행(신규 픽스처)은 전부 지우고, FK 막힌 legacy 행만 skip.
 * 이로써 "legacy 한 행이 배치 전체를 오염시켜 신규 픽스처까지 잔존" 하는 RC 를 차단한다.
 */
async function deleteByIds(
  sb: SupabaseClient,
  table: string,
  column: string,
  ids: string[],
): Promise<{ deleted: number; skipped: number }> {
  let deleted = 0;
  let skipped = 0;
  for (const c of chunk(ids, DELETE_CHUNK)) {
    const res = await sb.from(table).delete().in(column, c).select(column);
    if (!res.error) {
      deleted += res.data?.length ?? 0;
      continue;
    }
    for (const id of c) {
      const r = await sb.from(table).delete().eq(column, id);
      if (r.error) skipped += 1;
      else deleted += 1;
    }
  }
  return { deleted, skipped };
}

/**
 * 일괄 cleanup — 모든 QA 픽스처 row 를 전수 스윕한다 (RC#0 PROD 픽스처 누적 차단).
 *
 * 안전 불변식: **삭제 대상은 오직 QA 마커(notes/memo=MARKER) 또는 QA 이름 접두(qa-fixture-/qa-res-)
 * 를 가진 row 로만 도출**한다. 실데이터를 절대 삭제하지 않는다.
 *
 * 강화 포인트 (기존 대비):
 *  - orphan customer 스윕: seedCheckIn 이 customer INSERT 후 check_in INSERT 전 중단되면
 *    check_ins 경유로는 안 잡히는 고아 고객(memo=MARKER, name=qa-fixture-*)이 PROD 에 잔존했음.
 *    이제 customers 를 memo·name 두 키로 직접 스윕하고, 해당 고객에 매달린 종속 row 전부 정리.
 *  - 마커 누락 방어: 이름 접두 패턴(qa-fixture-/qa-res-)을 2차 키로 병행.
 */
export async function cleanupAll(): Promise<CleanupSummary> {
  const sb = svc();
  const summary: CleanupSummary = { customers: 0, checkIns: 0, packages: 0, reservations: 0, skippedCustomers: 0 };

  // ── 1) 삭제 대상 customer id 집합 도출 (마커 + 이름 접두 + check_ins 역참조) ──
  //   모든 select 는 페이지네이션 — 1000건 상한 truncate 로 신규 픽스처 누락되는 것 방지.
  const customerIds = new Set<string>();

  // 1a) check_ins(notes=MARKER) → 연결 customer
  (
    await selectAllValues(
      () => sb.from('check_ins').select('customer_id').eq('notes', MARKER) as unknown as RangeQB,
      'customer_id',
    )
  ).forEach((id) => customerIds.add(id));

  // 1b) customers(memo=MARKER) — orphan 포함
  (
    await selectAllValues(() => sb.from('customers').select('id').eq('memo', MARKER) as unknown as RangeQB, 'id')
  ).forEach((id) => customerIds.add(id));

  // 1c) customers(name ilike 'qa-fixture-%' / 'qa-res-%') — 마커 누락 방어
  for (const prefix of FIXTURE_NAME_PREFIXES) {
    (
      await selectAllValues(
        () => sb.from('customers').select('id').ilike('name', `${prefix}%`) as unknown as RangeQB,
        'id',
      )
    ).forEach((id) => customerIds.add(id));
  }

  // 1d) 레지스트리 등록분 합집합 (AC-3) — test 가 name/memo 를 커스텀으로 덮어써 마커/이름
  //     접두 스윕을 벗어난 row 도 정확한 id 로 회수. POST=DELETE 정합의 구조적 보장.
  REGISTRY.customers.forEach((id) => customerIds.add(id));

  const customerIdArr = Array.from(customerIds);

  // ── 2) customer 종속 row 삭제 (FK 역순: payments → check_ins → package_payments → packages) ──
  //   각 delete 는 deleteByIds(청크+per-id 폴백) — legacy 한 행이 배치 전체를 오염시켜
  //   신규 픽스처의 종속 row 까지 잔존하는 것을 막는다.
  for (const ids of chunk(customerIdArr, DELETE_CHUNK)) {
    const ckIds = await selectAllValues(
      () => sb.from('check_ins').select('id').in('customer_id', ids) as unknown as RangeQB,
      'id',
    );
    if (ckIds.length) {
      await deleteByIds(sb, 'payments', 'check_in_id', ckIds);
      const r = await deleteByIds(sb, 'check_ins', 'id', ckIds);
      summary.checkIns += r.deleted;
    }
    const pkgIds = await selectAllValues(
      () => sb.from('packages').select('id').in('customer_id', ids) as unknown as RangeQB,
      'id',
    );
    if (pkgIds.length) {
      await deleteByIds(sb, 'package_payments', 'package_id', pkgIds);
      const r = await deleteByIds(sb, 'packages', 'id', pkgIds);
      summary.packages += r.deleted;
    }
  }

  // ── 3) customers 삭제 — 청크 + per-id 폴백 (legacy FK 잔존행은 격리·skip, 신규 픽스처는 전수 삭제) ──
  {
    const r = await deleteByIds(sb, 'customers', 'id', customerIdArr);
    summary.customers += r.deleted;
    summary.skippedCustomers += r.skipped;
  }

  // ── 4) reservations (memo=MARKER 또는 이름 접두 qa-res-/qa-fixture-) ──
  const resIds = new Set<string>();
  (
    await selectAllValues(() => sb.from('reservations').select('id').eq('memo', MARKER) as unknown as RangeQB, 'id')
  ).forEach((id) => resIds.add(id));
  for (const prefix of FIXTURE_NAME_PREFIXES) {
    (
      await selectAllValues(
        () => sb.from('reservations').select('id').ilike('customer_name', `${prefix}%`) as unknown as RangeQB,
        'id',
      )
    ).forEach((id) => resIds.add(id));
  }
  REGISTRY.reservations.forEach((id) => resIds.add(id)); // AC-3 레지스트리 합집합
  const resIdArr = Array.from(resIds);
  if (resIdArr.length) {
    await deleteByIds(sb, 'reservation_logs', 'reservation_id', resIdArr);
    const r = await deleteByIds(sb, 'reservations', 'id', resIdArr);
    summary.reservations += r.deleted;
  }

  // ── 5) 레지스트리 잔여분 직접 회수 (AC-3, belt-and-suspenders) ──
  //   customer 링크가 어떤 이유로 누락돼 §2 cascade 에 안 잡힌 check_ins/packages 도
  //   등록된 정확한 id 로 마지막에 삭제. 삭제 성공분은 레지스트리에서 제거해 idempotent 유지.
  {
    const ckLeft = Array.from(REGISTRY.checkIns);
    if (ckLeft.length) {
      await deleteByIds(sb, 'payments', 'check_in_id', ckLeft);
      const r = await deleteByIds(sb, 'check_ins', 'id', ckLeft);
      summary.checkIns += r.deleted;
    }
    const pkgLeft = Array.from(REGISTRY.packages);
    if (pkgLeft.length) {
      await deleteByIds(sb, 'package_payments', 'package_id', pkgLeft);
      const r = await deleteByIds(sb, 'packages', 'id', pkgLeft);
      summary.packages += r.deleted;
    }
  }

  // teardown 은 run 종료 시 1회 — 회수 끝난 레지스트리를 비워 재호출 시 중복 삭제 방지.
  REGISTRY.customers.clear();
  REGISTRY.checkIns.clear();
  REGISTRY.packages.clear();
  REGISTRY.reservations.clear();

  return summary;
}

// (id, marker) 페어를 페이지네이션 수집 — scoped(파이프) row 만.
type PairQB = {
  range: (from: number, to: number) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>;
};
async function selectScopedPairs(
  build: () => PairQB,
  valueCol: string,
  markerCol: string,
): Promise<{ value: string; marker: string }[]> {
  const out: { value: string; marker: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const r of data) {
      const v = r[valueCol];
      const m = r[markerCol];
      if (v && typeof m === 'string') out.push({ value: v as string, marker: m });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * Run-scoped 시드 스윕 (T-20260720-foot-CHART-OPENGATE-SEED-ISOLATION-HARDEN).
 *
 * cleanupAll() 은 bare 마커('[QA-FIXTURE]')를 전수 삭제하므로 **동시 run 의 in-flight 시드까지
 * 지우는 cross-run race** 를 유발한다. 그 대상이 되지 않도록 chart-open-gate 시드는 run 토큰이
 * embed 된 scoped 마커(`[QA-FIXTURE]|<token>|<ts>`)를 쓴다 — bare-exact 매칭인 cleanupAll() 은
 * 이 row 를 못 잡는다(=다른 run 이 못 건드림). 대신 scoped row 는 이 함수가 정리한다:
 *   - mode='run'   (globalTeardown): **이 run 토큰** 접두 row 만 삭제 → 동시 run 무간섭.
 *   - mode='stale' (globalSetup pre-sweep): ts 가 TTL(2h) 초과한 scoped row 만 삭제
 *       → crash 로 leak 된 과거 run 잔재만 회수, 동시 실행 중인 run 의 fresh 시드는 미접촉.
 *
 * 안전 불변식: 삭제 대상은 오직 scoped 마커(`[QA-FIXTURE]|...`)를 가진 row. bare 마커·실데이터
 * 는 절대 건드리지 않는다(그건 cleanupAll 소관).
 */
export async function sweepScoped(opts: { mode: 'run' | 'stale' }): Promise<CleanupSummary> {
  const sb = svc();
  const summary: CleanupSummary = { customers: 0, checkIns: 0, packages: 0, reservations: 0, skippedCustomers: 0 };
  const runPrefix = `${MARKER}|${runToken()}|`;
  const now = Date.now();
  const keep = (marker: string): boolean => {
    if (opts.mode === 'run') return marker.startsWith(runPrefix);
    // stale: ts 파싱 가능 + TTL 초과분만. (파싱 불가/최근 = 동시 run 가능성 → 미삭제)
    const ts = markerTsMs(marker);
    return ts !== null && now - ts > SCOPED_STALE_TTL_MS;
  };

  // ── 1) 삭제 대상 customer id (customers.memo + check_ins.notes 역참조) ──
  const customerIds = new Set<string>();
  (
    await selectScopedPairs(
      () => sb.from('customers').select('id, memo').like('memo', SCOPED_LIKE) as unknown as PairQB,
      'id',
      'memo',
    )
  ).forEach(({ value, marker }) => {
    if (keep(marker)) customerIds.add(value);
  });
  (
    await selectScopedPairs(
      () => sb.from('check_ins').select('customer_id, notes').like('notes', SCOPED_LIKE) as unknown as PairQB,
      'customer_id',
      'notes',
    )
  ).forEach(({ value, marker }) => {
    if (keep(marker)) customerIds.add(value);
  });
  const customerIdArr = Array.from(customerIds);

  // ── 2) customer 종속 cascade (payments → check_ins, package_payments → packages) ──
  for (const ids of chunk(customerIdArr, DELETE_CHUNK)) {
    const ckIds = await selectAllValues(
      () => sb.from('check_ins').select('id').in('customer_id', ids) as unknown as RangeQB,
      'id',
    );
    if (ckIds.length) {
      await deleteByIds(sb, 'payments', 'check_in_id', ckIds);
      const r = await deleteByIds(sb, 'check_ins', 'id', ckIds);
      summary.checkIns += r.deleted;
    }
    const pkgIds = await selectAllValues(
      () => sb.from('packages').select('id').in('customer_id', ids) as unknown as RangeQB,
      'id',
    );
    if (pkgIds.length) {
      await deleteByIds(sb, 'package_payments', 'package_id', pkgIds);
      const r = await deleteByIds(sb, 'packages', 'id', pkgIds);
      summary.packages += r.deleted;
    }
  }

  // ── 3) customers ──
  {
    const r = await deleteByIds(sb, 'customers', 'id', customerIdArr);
    summary.customers += r.deleted;
    summary.skippedCustomers += r.skipped;
  }

  // ── 4) reservations (reservations.memo scoped) ──
  const resIds = new Set<string>();
  (
    await selectScopedPairs(
      () => sb.from('reservations').select('id, memo').like('memo', SCOPED_LIKE) as unknown as PairQB,
      'id',
      'memo',
    )
  ).forEach(({ value, marker }) => {
    if (keep(marker)) resIds.add(value);
  });
  const resIdArr = Array.from(resIds);
  if (resIdArr.length) {
    await deleteByIds(sb, 'reservation_logs', 'reservation_id', resIdArr);
    const r = await deleteByIds(sb, 'reservations', 'id', resIdArr);
    summary.reservations += r.deleted;
  }

  return summary;
}
