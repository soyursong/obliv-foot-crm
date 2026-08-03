// scripts/lib/redpay_unreg_digest.mjs
// T-20260803-foot-REDPAY-UNREG-LINE-ALARM-DAILY-DIGEST — 미등록 회선 알람 스팸 억제 → 하루 1회 아침 요약(digest)
//
// ── 왜 (현장: 최필경 총괄, C0ATE5P6JTH) ─────────────────────────────────────────
//   레드페이 미등록 회선 알람이 폴러 사이클(≤300s)마다 실시간 반복 → 같은 내용 하루 수십 번 →
//   정작 봐야 할 다른 알람이 묻힌다. 요청: 실시간 반복을 끄고, 미등록 회선만 모아 오전 1회 요약.
//
// ── 무엇 (순수 로직 SSOT — 폴러/워치독 공용) ────────────────────────────────────
//   폴러(redpay_macstudio_poller.mjs) 와 워치독(redpay_terminal_watchdog.mjs) 이 함께 import.
//   · 폴러(≤300s): 미등록 회선 감지 시 실시간 슬랙 발송 대신 상태에 누적(첫 감지일·누적 건수). 발송 0(AC1).
//   · 워치독(일 1회, 아침): 발송 시점 "여전히 미등록"인 회선만 모아 요약 1건 발송(AC2·AC3·AC4).
//   · 3일+ 장기 미처리 회선은 요약과 별개로 "장기 방치" 에스컬레이션 1건(회선당 1회/일, AC7).
//   · 피처플래그(REDPAY_UNREG_DIGEST_MODE)로 신(digest)/구(실시간 개별) 즉시 전환(AC6).
//
// ── 불변식 ─────────────────────────────────────────────────────────────────────
//   · 알림 유실 0(AC5): 미등록 회선이 하나라도 있으면 digest 는 반드시 발송. 누적 상태는 유실 없이 축적.
//   · 격리(AC5): 정상 알람·타 알림 경로(unscopable·소계 대조·휴면)는 무접촉.
//   · db_change=false: dedup/누적 상태는 기존 macstudio 로컬 JSON 상태파일에 additive 버킷으로 저장(DB 무변경).
//   · 순수 함수(네트워크·파일 I/O 없음) → self-test 로 AC 커버(e2e_spec_exempt: ef_only).
//
// author: dev-foot / 2026-08-03

// 미등록 회선 안정 키 — 회선(TID) 있으면 tid, 없으면 merchant 단위.
export function detectionKey(merchantId, tid) {
  const t = (tid ?? "").toString().trim();
  if (t) return `tid:${t}`;
  const m = (merchantId ?? "").toString().trim();
  return m ? `mer:${m}` : "unknown";
}

// Asia/Seoul 기준 M/D (첫 감지일 표기용). ISO 문자열/Date 입력.
export function kstMonthDay(iso) {
  try {
    const d = iso instanceof Date ? iso : new Date(iso);
    const s = d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" });
    // en-CA 로 "M/D" 강제는 불안정 → parts 로 직접 구성
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).formatToParts(d);
    const mo = parts.find((p) => p.type === "month")?.value ?? "?";
    const da = parts.find((p) => p.type === "day")?.value ?? "?";
    return `${mo}/${da}`;
  } catch { return "?"; }
}

// Asia/Seoul 기준 YYYY-MM-DD (장기 미처리 1회/일 상한 키).
export function kstDateStr(iso) {
  try {
    const d = iso instanceof Date ? iso : new Date(iso);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch { return "?"; }
}

// 두 시각(ISO) 사이 경과 일수(floor, KST 자정 기준 아님 — 24h 단위 경과). AC7 판정용.
export function daysElapsed(fromIso, toIso) {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!isFinite(a) || !isFinite(b)) return 0;
  return Math.floor((b - a) / (24 * 60 * 60 * 1000));
}

function bucket(state) {
  if (!state.unreg_digest) state.unreg_digest = {};
  return state.unreg_digest;
}

/**
 * 폴러 경로 — 미등록 회선 감지 누적(첫 감지일 1회 고정, 누적 건수 += trx_count).
 *   폴러는 incremental 윈도우로 거래를 1회씩 관측 → 누적 건수 = 미등록 상태로 쌓인 실 거래 수.
 */
export function accruePollerDetection(state, line, nowIso) {
  const b = bucket(state);
  const key = detectionKey(line.merchant_id, line.tid);
  const inc = Number(line.trx_count ?? 0) || 0;
  const cur = b[key];
  if (!cur) {
    b[key] = {
      merchant_id: line.merchant_id ?? null,
      merchant_name: line.merchant_name ?? "",
      tid: (line.tid ?? "").toString().trim() || null,
      first_seen_at: nowIso,
      cumulative_count: inc,
      last_seen_at: nowIso,
      source: "poller",
    };
  } else {
    cur.cumulative_count = (Number(cur.cumulative_count ?? 0) || 0) + inc;
    cur.last_seen_at = nowIso;
    if (!cur.merchant_name && line.merchant_name) cur.merchant_name = line.merchant_name;
    if (!cur.tid && line.tid) cur.tid = String(line.tid).trim();
    if (!cur.merchant_id && line.merchant_id) cur.merchant_id = line.merchant_id;
  }
  return b[key];
}

/**
 * 워치독 경로 — 첫 감지일 seed(없을 때만). 누적 건수는 폴러 소유이므로 이중계상 방지 위해
 *   기존 엔트리엔 손대지 않고, 폴러가 놓친(엔트리 부재) 회선만 fallback 으로 seed 한다.
 */
export function seedWatchdogDetection(state, line, nowIso) {
  const b = bucket(state);
  const key = detectionKey(line.merchant_id, line.tid);
  const cur = b[key];
  if (!cur) {
    b[key] = {
      merchant_id: line.merchant_id ?? null,
      merchant_name: line.merchant_name ?? "",
      tid: (line.tid ?? "").toString().trim() || null,
      first_seen_at: nowIso,
      cumulative_count: Number(line.trx_count ?? 0) || 0, // 폴러 미관측 fallback
      last_seen_at: nowIso,
      source: "watchdog",
    };
  } else {
    cur.last_seen_at = nowIso;
    if (!cur.merchant_name && line.merchant_name) cur.merchant_name = line.merchant_name;
  }
  return b[key];
}

/**
 * 발송 시점 여전히 미등록인 회선 외의 상태 엔트리 정리(AC3 — 등록/미감지 회선 제외 + auto-release).
 *   currentKeys = 이번 워치독 조회에서 여전히 미등록으로 확인된 회선 키 집합.
 */
export function pruneResolvedEntries(state, currentKeys) {
  const b = bucket(state);
  const keep = currentKeys instanceof Set ? currentKeys : new Set(currentKeys);
  const released = [];
  for (const key of Object.keys(b)) {
    if (!keep.has(key)) { released.push(key); delete b[key]; }
  }
  // 장기 미처리 알림 상한 상태도 해소된 회선은 정리
  if (state.long_unproc_alerted) {
    for (const key of Object.keys(state.long_unproc_alerted)) {
      if (!keep.has(key)) delete state.long_unproc_alerted[key];
    }
  }
  return released;
}

/**
 * 일일 요약(digest) 조립 — 순수. currentLines = 발송 시점 여전히 미등록인 회선 배열.
 *   각 회선을 상태(첫 감지일·누적 건수)와 병합해 1줄. 미등록 0건이면 {count:0}.
 *   포맷(AC4): 가맹점 <merchant> / 회선 <tid> (첫 감지 M/D, 누적 N건). 헤더에 총 건수.
 */
export function buildDailyDigest(currentLines, state) {
  const b = bucket(state);
  const rows = (currentLines ?? []).map((line) => {
    const key = detectionKey(line.merchant_id, line.tid);
    const s = b[key] ?? {};
    return {
      key,
      merchant_id: line.merchant_id ?? s.merchant_id ?? "(미상)",
      merchant_name: line.merchant_name || s.merchant_name || "",
      tid: (line.tid ?? s.tid ?? "").toString().trim() || null,
      first_seen_at: s.first_seen_at ?? null,
      cumulative_count: Number(s.cumulative_count ?? line.trx_count ?? 0) || 0,
    };
  });
  if (rows.length === 0) return { count: 0, rows: [], text: null };

  // 안정 정렬: 첫 감지 오래된 순 → merchant → tid
  rows.sort((a, z) => {
    const fa = a.first_seen_at ? new Date(a.first_seen_at).getTime() : Infinity;
    const fz = z.first_seen_at ? new Date(z.first_seen_at).getTime() : Infinity;
    if (fa !== fz) return fa - fz;
    if (a.merchant_id !== z.merchant_id) return String(a.merchant_id).localeCompare(String(z.merchant_id));
    return String(a.tid).localeCompare(String(z.tid));
  });

  const line = (r) => {
    const md = r.first_seen_at ? kstMonthDay(r.first_seen_at) : "?";
    const lineNo = r.tid ? `회선 ${r.tid}` : "회선 (미상)";
    return ` · 가맹점 ${r.merchant_id} / ${lineNo} (첫 감지 ${md}, 누적 ${r.cumulative_count}건)`;
  };
  const text =
    `[레드페이 회선] 미등록 회선 ${rows.length}건\n` +
    rows.map(line).join("\n") + "\n" +
    `아직 관리 명단에 없는 결제회선입니다. 담당자가 확인 후 명단(회선번호)에 추가해 주세요. (매출/정산 대사 누락 방지 · 자동 등록 안 함)`;
  return { count: rows.length, rows, text };
}

/**
 * 장기 미처리(3일+) 에스컬레이션 선택 — 순수. 회선당 1회/일 상한(AC7).
 *   판정: 첫 감지일 기준 경과 ≥ thresholdDays AND 여전히 미등록 AND 오늘 아직 에스컬레이션 안 함.
 *   호출부가 반환 rows 를 발송 후 markLongUnprocessedAlerted 로 상한 기록.
 */
export function selectLongUnprocessed(currentLines, state, nowIso, thresholdDays = 3) {
  const b = bucket(state);
  const today = kstDateStr(nowIso);
  const alerted = state.long_unproc_alerted ?? {};
  const rows = [];
  for (const lineObj of (currentLines ?? [])) {
    const key = detectionKey(lineObj.merchant_id, lineObj.tid);
    const s = b[key];
    if (!s || !s.first_seen_at) continue;
    const elapsed = daysElapsed(s.first_seen_at, nowIso);
    if (elapsed < thresholdDays) continue;
    if (alerted[key] === today) continue; // 오늘 이미 에스컬레이션함(1회/일 상한)
    rows.push({
      key,
      merchant_id: lineObj.merchant_id ?? s.merchant_id ?? "(미상)",
      merchant_name: lineObj.merchant_name || s.merchant_name || "",
      tid: (lineObj.tid ?? s.tid ?? "").toString().trim() || null,
      first_seen_at: s.first_seen_at,
      elapsed_days: elapsed,
      cumulative_count: Number(s.cumulative_count ?? 0) || 0,
    });
  }
  rows.sort((a, z) => z.elapsed_days - a.elapsed_days);
  const text = rows.length === 0 ? null :
    `⏳ [레드페이 회선 · 장기 방치 에스컬레이션] 3일 이상 미등록 상태로 방치된 결제회선 ${rows.length}건\n` +
    rows.map((r) => {
      const md = kstMonthDay(r.first_seen_at);
      const lineNo = r.tid ? `회선 ${r.tid}` : "회선 (미상)";
      return ` · 가맹점 ${r.merchant_id} / ${lineNo} (첫 감지 ${md}, ${r.elapsed_days}일째 미처리, 누적 ${r.cumulative_count}건)`;
    }).join("\n") + "\n" +
    `일일 요약과 별개 알림입니다. 오래 방치될수록 매출/정산 누락 위험이 커집니다 — 우선 확인·명단 등록 부탁드립니다.`;
  return { count: rows.length, rows, text, today };
}

// 장기 미처리 에스컬레이션 발송 후 상한 기록(회선당 1회/일).
export function markLongUnprocessedAlerted(state, rows, today) {
  if (!state.long_unproc_alerted) state.long_unproc_alerted = {};
  for (const r of rows) state.long_unproc_alerted[r.key] = today;
}
