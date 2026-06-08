/**
 * dummy_factory.mjs — 풋센터 더미 예약 생성 단일 강제 지점 (Single Enforcement Point)
 * T-20260608-foot-DUMMY-CUSTOMER-COCREATE
 *
 * 배경(재발 사고):
 *   6/3·6/8 ad-hoc 더미 생성에서 reservations 만 만들고 customers 동시 생성을 "깜빡"해
 *   reservations.customer_id = NULL 로 적재 → 차트 미열림 + is_simulation 기반 정리에서도 누락(orphan).
 *   (정리 마이그 20260420000009: reservations 를 customer_id ∈ customers(is_simulation=true) 로만 삭제)
 *
 * 불변식(이 모듈을 통하지 않으면 더미 예약을 만들 수 없게 강제):
 *   1) phone 우선 upsert — (clinic_id, phone) UNIQUE. 동명이인/중복 phone 시 기존 row 재사용.
 *   2) customer_id 즉시 연결. reservation 은 customer_id 없이는 절대 생성 불가(사전 게이트 throw).
 *   3) customers 누락/실패 시 예약 생성 중단 — 원자성 보장.
 *   4) customers.is_simulation=true (정리·집계 마킹). reservations 엔 is_simulation 컬럼 없음(설계 확인).
 *
 * 사용:
 *   import { createDummyReservations } from './lib/dummy_factory.mjs';
 *   await createDummyReservations(sb, clinicId, items, { memo, dryRun });
 *   // items: [{ name, phone, visitType, date, time, status?, inflowChannel?, memo? }]
 */

/* ────────────────────────────────────────────────────────────────────────
 * 순수 함수 (DB 불필요 · 단위 테스트 대상)
 * ──────────────────────────────────────────────────────────────────────── */

/** 더미 항목 1건 정규화 + 필수값 검증. phone/name 없으면 즉시 throw (게이트). */
export function normalizeDummyItem(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('dummy item이 객체가 아님');
  }
  const name = (raw.name ?? '').toString().trim();
  const phone = (raw.phone ?? '').toString().trim();
  if (!name) throw new Error(`dummy item name 누락: ${JSON.stringify(raw)}`);
  // phone 은 upsert 의 dedup key. 없으면 동일인 재사용이 불가능 → 더미 생성 금지.
  if (!phone) throw new Error(`dummy item phone 누락(upsert key 필수): ${name}`);

  const visitType = raw.visitType ?? raw.visit_type ?? 'new';
  if (visitType !== 'new' && visitType !== 'returning') {
    throw new Error(`visit_type 은 new|returning 만 허용: ${visitType} (${name})`);
  }
  const date = raw.date ?? raw.reservation_date ?? null;
  const time = raw.time ?? raw.reservation_time ?? null;
  if (!date) throw new Error(`dummy item reservation_date 누락: ${name}`);
  if (!time) throw new Error(`dummy item reservation_time 누락: ${name}`);

  return {
    name,
    phone,
    visitType,
    date,
    time,
    status: raw.status ?? 'confirmed',
    inflowChannel: raw.inflowChannel ?? raw.inflow_channel ?? (visitType === 'returning' ? 'returning' : 'meta_ads'),
    memo: raw.memo ?? null,
  };
}

/**
 * phone 기준 dedup. 같은 phone 의 여러 예약은 customer 1건을 공유한다.
 * @returns {{ uniquePhones: string[], itemsByPhone: Map<string, object[]>, normalized: object[] }}
 */
export function dedupeByPhone(rawItems) {
  if (!Array.isArray(rawItems)) throw new Error('items 는 배열이어야 함');
  const normalized = rawItems.map(normalizeDummyItem);
  const itemsByPhone = new Map();
  for (const it of normalized) {
    if (!itemsByPhone.has(it.phone)) itemsByPhone.set(it.phone, []);
    itemsByPhone.get(it.phone).push(it);
  }
  return { uniquePhones: [...itemsByPhone.keys()], itemsByPhone, normalized };
}

/** customers INSERT/UPSERT 행 빌더. is_simulation 항상 true. */
export function buildCustomerRow(item, clinicId, opts = {}) {
  if (!clinicId) throw new Error('buildCustomerRow: clinicId 필수');
  return {
    clinic_id: clinicId,
    name: item.name,
    phone: item.phone,
    visit_type: item.visitType,
    is_simulation: true,
    memo: opts.customerMemo ?? item.memo ?? opts.memo ?? null,
  };
}

/**
 * reservations 행 빌더 — **사전 게이트**. customerId 없으면 throw.
 * 이 게이트가 "customer_id 없는 예약 생성"을 구조적으로 불가능하게 만든다.
 */
export function buildReservationRow(item, clinicId, customerId, opts = {}) {
  if (!clinicId) throw new Error('buildReservationRow: clinicId 필수');
  if (!customerId) {
    throw new Error(
      `[GATE] customer_id 없이 예약 생성 차단: ${item.name}(${item.phone}). ` +
      `customers 동시 생성/연결이 선행되어야 함.`,
    );
  }
  return {
    clinic_id: clinicId,
    customer_id: customerId,
    customer_name: item.name,
    customer_phone: item.phone,
    reservation_date: item.date,
    reservation_time: item.time,
    visit_type: item.visitType,
    status: item.status,
    memo: opts.memo ?? item.memo ?? null,
  };
}

/** 검증 가드 — 예약 행 배열에 customer_id NULL 이 단 1건이라도 있으면 throw. */
export function assertNoNullCustomerLink(reservationRows) {
  const nulls = reservationRows.filter((r) => !r.customer_id);
  if (nulls.length > 0) {
    throw new Error(
      `[INVARIANT VIOLATION] customer_id NULL 예약 ${nulls.length}건 — 적재 차단. ` +
      `샘플: ${nulls.slice(0, 3).map((r) => r.customer_name).join(', ')}`,
    );
  }
  return reservationRows.length;
}

/* ────────────────────────────────────────────────────────────────────────
 * DB 함수 (supabase client 필요)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * 더미 customer 1건 upsert (phone 우선, 동명이인/중복 phone 시 기존 row 재사용).
 * (clinic_id, phone) UNIQUE 인덱스에 onConflict 로 upsert → 항상 단일 row id 반환.
 * @returns {Promise<string>} customer id (없으면 throw — 게이트)
 */
export async function upsertDummyCustomer(sb, clinicId, item, opts = {}) {
  const row = buildCustomerRow(item, clinicId, opts);
  const { data, error } = await sb
    .from('customers')
    .upsert(row, { onConflict: 'clinic_id,phone', ignoreDuplicates: false })
    .select('id')
    .single();
  if (error) {
    throw new Error(`customers upsert 실패(${item.name}/${item.phone}): ${error.message}`);
  }
  if (!data?.id) {
    throw new Error(`customers upsert 결과 id 없음(${item.name}/${item.phone})`);
  }
  return data.id;
}

/**
 * 더미 예약 배치 생성 — 단일 진입점.
 * 흐름: dedupe → customers upsert(phone) → customer_id 게이트로 reservation 행 빌드 →
 *       NULL 가드 → reservations insert → 사후 검증(NULL 0).
 *
 * @param {object} sb         supabase client (service role)
 * @param {string} clinicId   대상 clinic id
 * @param {object[]} rawItems [{ name, phone, visitType, date, time, status?, memo? }]
 * @param {object} opts       { memo?, dryRun?, log? }
 * @returns {Promise<{customers: number, reservations: number, reused: number, created: number, nullLinks: number}>}
 */
export async function createDummyReservations(sb, clinicId, rawItems, opts = {}) {
  const log = opts.log ?? console.log;
  if (!clinicId) throw new Error('createDummyReservations: clinicId 필수');

  const { uniquePhones, itemsByPhone, normalized } = dedupeByPhone(rawItems);
  log(`[dummy_factory] 항목 ${normalized.length}건 / 고유 phone ${uniquePhones.length}개`);

  // 1) 기존 customer 조회 (재사용 카운트용)
  const { data: existing, error: exErr } = await sb
    .from('customers')
    .select('id, phone')
    .eq('clinic_id', clinicId)
    .in('phone', uniquePhones);
  if (exErr) throw new Error(`기존 customer 조회 실패: ${exErr.message}`);
  const existingPhones = new Set((existing ?? []).map((c) => c.phone));
  const reused = existingPhones.size;
  const willCreate = uniquePhones.length - reused;
  log(`[dummy_factory] 재사용 예정 ${reused}건 / 신규 생성 예정 ${willCreate}건`);

  if (opts.dryRun) {
    // 게이트 시뮬레이션: customer_id 를 placeholder 로 두고 예약 행 빌드까지 검증
    const planned = [];
    for (const [phone, items] of itemsByPhone) {
      for (const it of items) {
        planned.push(buildReservationRow(it, clinicId, `DRY-${phone}`, opts));
      }
    }
    assertNoNullCustomerLink(planned);
    log(`[dummy_factory] DRY-RUN OK — 예약 ${planned.length}건 모두 customer_id 연결 가능(무변경)`);
    return { customers: uniquePhones.length, reservations: planned.length, reused, created: willCreate, nullLinks: 0 };
  }

  // 2) phone 별 customer upsert → phone→customer_id 맵
  const phoneToId = new Map();
  for (const [phone, items] of itemsByPhone) {
    const id = await upsertDummyCustomer(sb, clinicId, items[0], opts); // 대표 1건으로 upsert
    phoneToId.set(phone, id);
  }
  log(`[dummy_factory] customers 확정: ${phoneToId.size}건 (재사용 ${reused} + 신규 ${willCreate})`);

  // 3) 예약 행 빌드 — customer_id 게이트 + NULL 가드
  const reservationRows = normalized.map((it) =>
    buildReservationRow(it, clinicId, phoneToId.get(it.phone), opts),
  );
  assertNoNullCustomerLink(reservationRows);

  // 4) reservations insert
  const { data: ins, error: insErr } = await sb
    .from('reservations')
    .insert(reservationRows)
    .select('id, customer_id');
  if (insErr) throw new Error(`reservations insert 실패: ${insErr.message}`);

  // 5) 사후 검증 — DB 적재 결과에 NULL 0 확인
  const nullLinks = (ins ?? []).filter((r) => !r.customer_id).length;
  if (nullLinks > 0) {
    throw new Error(`[POST-CHECK] 적재된 예약 중 customer_id NULL ${nullLinks}건 — 데이터 무결성 위반`);
  }
  log(`[dummy_factory] 완료 — 예약 ${ins.length}건, customer_id NULL ${nullLinks}건`);

  return {
    customers: phoneToId.size,
    reservations: ins.length,
    reused,
    created: willCreate,
    nullLinks,
  };
}
