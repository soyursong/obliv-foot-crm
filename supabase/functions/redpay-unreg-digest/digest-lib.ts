// T-20260803-foot-REDPAY-UNREG-LINE-ALARM-DAILY-DIGEST — 순수 로직(단위검증 대상).
//   EF 핸들러(index.ts)에서 import. DB/네트워크 무의존 → 결정적 단위테스트 가능.
//   커버: dedup 키 정규화 · digest 집계(미등록 필터) · 등록전이 제외 · 행 포맷.

export interface UnregRow {
  id:            string;
  merchant_id:   string | null;
  merchant_name: string | null;
  tid:           string | null;
  first_seen_at: string;
  hit_count:     number;
}

/**
 * dedup 키 정규화 — 마이그레이션 RPC(redpay_note_unregistered_line)의 SQL 정규화와 반드시 동일.
 *   trim → 빈문자 '∅' → `${merchant}::${tid}`. (merchant/tid 부재 조합도 안정 dedup.)
 */
export function dedupKey(merchantId: string | null | undefined, tid: string | null | undefined): string {
  const m = (merchantId ?? "").trim();
  const t = (tid ?? "").trim();
  return `${m === "" ? "∅" : m}::${t === "" ? "∅" : t}`;
}

/**
 * registry(active foot merchant set) 재대조로 등록 전이 분리.
 *   merchant_id 가 activeSet 에 있으면 = 등록 완료 → resolvedIds(digest 제외).
 *   그 외(미등록/merchant 부재) → stillUnreg(digest 대상).
 *   ★ AC5: registry 조회 실패 등으로 activeSet 이 비어도 전량 stillUnreg → 유실 0.
 */
export function partitionByRegistry(
  rows: UnregRow[],
  activeSet: Set<string>,
): { stillUnreg: UnregRow[]; resolvedIds: string[] } {
  const stillUnreg: UnregRow[] = [];
  const resolvedIds: string[] = [];
  for (const row of rows) {
    const mid = (row.merchant_id ?? "").trim();
    if (mid !== "" && activeSet.has(mid)) resolvedIds.push(row.id);
    else stillUnreg.push(row);
  }
  return { stillUnreg, resolvedIds };
}

/** 첫 감지일 ISO → 'M/D' (Asia/Seoul). */
export function fmtMD(iso: string): string {
  const kst = new Date(new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  return `${kst.getMonth() + 1}/${kst.getDate()}`;
}

/** digest 본문 행 조립 — `• 가맹점 <merchant_id> / 회선 <tid> (첫 감지 M/D, 누적 N건)`. */
export function formatDigestRow(row: UnregRow): string {
  const mid = row.merchant_id ?? "∅";
  const tid = row.tid ?? "∅";
  return `• 가맹점 ${mid} / 회선 ${tid} (첫 감지 ${fmtMD(row.first_seen_at)}, 누적 ${row.hit_count}건)`;
}

/** 요약 본문 전체 조립(헤더 + 행). stillUnreg 0건이면 빈 배열(발송 억제 판정은 호출측). */
export function buildDigestText(stillUnreg: UnregRow[], nowKST: string): string {
  if (stillUnreg.length === 0) return "";
  const lines: string[] = [
    `📋 *[레드페이 미등록 회선 요약 · 풋센터]* ${nowKST}`,
    `등록 대기 ${stillUnreg.length}개 회선 — redpay_terminal_registry 등록 필요`,
    ``,
    ...stillUnreg.map(formatDigestRow),
  ];
  return lines.join("\n");
}

// ── AC7 (MSG-76a9 delta): 3일+ 장기 미처리 별도 에스컬레이션 ────────────────────────────
/** AC7 장기 미처리 임계(일). 첫 감지일 기준 경과 ≥ 이 값 & 여전히 미등록 → 일일 요약과 별개 에스컬레이션. */
export const LONG_UNPROC_DAYS = 3;

/** 첫 감지일(ISO) 기준 절대 경과일(24h*N, floor) — 결정적(테스트 재현 가능). */
export function daysSince(iso: string, nowMs: number): number {
  return Math.floor((nowMs - new Date(iso).getTime()) / 86_400_000);
}

/** AC7: stillUnreg 중 first_seen 경과 ≥ LONG_UNPROC_DAYS 인 장기 미처리 회선 분리(여전히 미등록 전제=stillUnreg). */
export function selectLongUnprocessed(stillUnreg: UnregRow[], nowMs: number): UnregRow[] {
  return stillUnreg.filter((r) => daysSince(r.first_seen_at, nowMs) >= LONG_UNPROC_DAYS);
}

// ── T-20260803-foot-REDPAY-INSTALLVERIFY-NET0-AUTOCLASSIFY (아침요약 N건 프레임 재사용) ──────
//   설치검증 추정(승인+즉시취소 net0 소액) 건을 아침요약에 개별 확인요청 대신 'N건' 한 줄로만 표시.
//   ★ 신규 알림 채널 신설 금지(AC-0) — 기존 미등록 회선 digest 와 동일 발송 1건에 한 줄 append.
//   0건이면 "" (발송/append 억제). 판정 SSOT = 서버뷰 v_redpay_installverify_pairs(4조건 ALL).
/** 설치검증 추정 요약 한 줄. n<=0 → "". */
export function buildInstallVerifyDigestLine(n: number): string {
  if (!n || n <= 0) return "";
  return `🧪 설치검증 추정 ${n}건 — 승인 즉시 취소된 순액 0원 소액(설치·단말 검증 추정). 개별 확인요청 대신 요약 표기(대사 화면에서 필터로 펼쳐볼 수 있음).`;
}

/**
 * AC7 에스컬레이션 본문 — 일일 요약과 별개(장기 방치 경고). 0건이면 빈 문자열(발송 억제).
 *   digest 가 하루 1회 → 회선당 1회/일 상한이 자연 충족(별도 카운터 불요).
 */
export function buildEscalationText(longRows: UnregRow[], nowKST: string, nowMs: number): string {
  if (longRows.length === 0) return "";
  const lines: string[] = [
    `🚨 *[레드페이 장기 미처리 에스컬레이션 · 풋센터]* ${nowKST}`,
    `${LONG_UNPROC_DAYS}일 이상 미등록 방치 ${longRows.length}개 회선 — 즉시 등록 처리 필요(방치 방지)`,
    ``,
    ...longRows.map((r) =>
      `• 가맹점 ${r.merchant_id ?? "∅"} / 회선 ${r.tid ?? "∅"} `
        + `(첫 감지 ${fmtMD(r.first_seen_at)}, ${daysSince(r.first_seen_at, nowMs)}일 경과, 누적 ${r.hit_count}건)`
    ),
  ];
  return lines.join("\n");
}
