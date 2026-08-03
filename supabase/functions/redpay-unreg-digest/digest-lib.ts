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
