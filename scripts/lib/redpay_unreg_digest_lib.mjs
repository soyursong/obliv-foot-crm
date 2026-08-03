// T-20260803-foot-REDPAY-UNREG-LINE-ALARM-DAILY-DIGEST (FIX-REQUEST 재작업, supervisor NO-GO B-1/B-2)
//   순수 로직 — Node(.mjs) 판. supabase/functions/redpay-unreg-digest/digest-lib.ts 와 동일 SSOT.
//   왜 별도 파일: digest 실 발송 경로를 EF(현장 미도달 — REDPAY_ALERT_CHANNEL prod ABSENT)에서
//     검증된 발송경로(맥스튜디오 launchd 폴러 → ~/scripts/slack_send.sh, 워치독과 동일 규약)로
//     재배선(supervisor FIX 옵션 b). EF secrets 프로젝트 전역화 시 redpay-recon(5분주기) 오발화
//     위험(신규 스팸) → EF 경로 대신 폴러/워치독 = 이미 field-reaching 인 proven path 재사용.
//   digest-lib.ts 와 함수 시그니처·정규화 규약 완전 일치(dedupKey/partition/format/AC7). 로직 표류 금지.

export const LONG_UNPROC_DAYS = 3;

/** dedup 키 정규화 — 마이그레이션 RPC(redpay_note_unregistered_line) SQL 정규화와 동일. */
export function dedupKey(merchantId, tid) {
  const m = (merchantId ?? "").trim();
  const t = (tid ?? "").trim();
  return `${m === "" ? "∅" : m}::${t === "" ? "∅" : t}`;
}

/**
 * registry(active foot merchant set) 재대조로 등록 전이 분리.
 *   merchant_id ∈ activeSet → 등록완료(resolvedIds, digest 제외). 그 외 → stillUnreg.
 *   ★ AC5: activeSet 이 비어도(registry 조회 실패 등) 전량 stillUnreg → 유실 0.
 */
export function partitionByRegistry(rows, activeSet) {
  const stillUnreg = [];
  const resolvedIds = [];
  for (const row of rows) {
    const mid = (row.merchant_id ?? "").trim();
    if (mid !== "" && activeSet.has(mid)) resolvedIds.push(row.id);
    else stillUnreg.push(row);
  }
  return { stillUnreg, resolvedIds };
}

/** 첫 감지일 ISO → 'M/D' (Asia/Seoul). */
export function fmtMD(iso) {
  const kst = new Date(new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  return `${kst.getMonth() + 1}/${kst.getDate()}`;
}

/** digest 본문 행 — `• 가맹점 <merchant_id> / 회선 <tid> (첫 감지 M/D, 누적 N건)`. */
export function formatDigestRow(row) {
  const mid = row.merchant_id ?? "∅";
  const tid = row.tid ?? "∅";
  return `• 가맹점 ${mid} / 회선 ${tid} (첫 감지 ${fmtMD(row.first_seen_at)}, 누적 ${row.hit_count}건)`;
}

/** 요약 본문 전체(헤더+행). stillUnreg 0건이면 "" (발송 억제 판정은 호출측). */
export function buildDigestText(stillUnreg, nowKST) {
  if (stillUnreg.length === 0) return "";
  const lines = [
    `📋 [레드페이 미등록 회선 요약 · 풋센터] ${nowKST}`,
    `아직 관리 명단에 없는 결제회선 ${stillUnreg.length}개 — 담당자 확인 후 명단에 추가해 주세요.`,
    ``,
    ...stillUnreg.map(formatDigestRow),
    ``,
    `(회선번호만 명단에 추가하면 즉시 정상 반영됩니다. 거래는 이미 수집돼 누락되지 않습니다.)`,
  ];
  return lines.join("\n");
}

/** 첫 감지일(ISO) 기준 절대 경과일(24h*N, floor) — 결정적. */
export function daysSince(iso, nowMs) {
  return Math.floor((nowMs - new Date(iso).getTime()) / 86_400_000);
}

/** AC7: stillUnreg 중 first_seen 경과 ≥ LONG_UNPROC_DAYS 인 장기 미처리 회선 분리. */
export function selectLongUnprocessed(stillUnreg, nowMs) {
  return stillUnreg.filter((r) => daysSince(r.first_seen_at, nowMs) >= LONG_UNPROC_DAYS);
}

// ── T-20260803-foot-REDPAY-INSTALLVERIFY-NET0-AUTOCLASSIFY (아침요약 N건 프레임 재사용) ──────
//   digest-lib.ts 와 동일 SSOT(문안·시그니처 일치). 설치검증 추정 건을 개별 확인요청 대신 'N건' 한 줄.
//   신규 알림 채널 신설 금지 — 기존 digest 발송 1건에 한 줄 append. n<=0 → "".
export function buildInstallVerifyDigestLine(n) {
  if (!n || n <= 0) return "";
  return `🧪 설치검증 추정 ${n}건 — 승인 즉시 취소된 순액 0원 소액(설치·단말 검증 추정). 개별 확인요청 대신 요약 표기(대사 화면에서 필터로 펼쳐볼 수 있음).`;
}

/** AC7 에스컬레이션 본문(장기 방치 경고, 일일 요약과 별개). 0건이면 "". */
export function buildEscalationText(longRows, nowKST, nowMs) {
  if (longRows.length === 0) return "";
  const lines = [
    `🚨 [레드페이 장기 미처리 · 풋센터] ${nowKST}`,
    `${LONG_UNPROC_DAYS}일 넘게 명단에 추가되지 않고 방치된 결제회선 ${longRows.length}개 — 즉시 처리 필요.`,
    ``,
    ...longRows.map((r) =>
      `• 가맹점 ${r.merchant_id ?? "∅"} / 회선 ${r.tid ?? "∅"} `
        + `(첫 감지 ${fmtMD(r.first_seen_at)}, ${daysSince(r.first_seen_at, nowMs)}일 경과, 누적 ${r.hit_count}건)`
    ),
  ];
  return lines.join("\n");
}
