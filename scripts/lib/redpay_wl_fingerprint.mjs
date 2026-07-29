// scripts/lib/redpay_wl_fingerprint.mjs
// T-20260728-foot-REDPAY-ENVSHADOW-RUNTIME-VALUECHECK — 허용목록 런타임 지문(fingerprint) canonical SSOT.
//
// 총괄(최필경, C0ATE5P6JTH) req1 보강: 코드가 동일 소스를 참조해도 허용목록을 읽는 두 실행주체
//   (수집 poller[env∪registry] · 워치독[registry])가 함수별 별도 배포·기동되어 한쪽은 갱신 env /
//   다른쪽은 구 env 를 물 수 있음(env-shadow). 코드 대조 '동일'이어도 실제 로드값이 어긋날 수 있으므로,
//   각 주체가 "지금 이 순간 실제로 로드한 허용목록"의 (a)개수 + (b)정렬목록/SHA256 을 노출·대조한다.
//
// ★ 이 모듈이 canonical 인 이유(아키텍처 불변식): 두 주체가 서로 다른 파일(poller.mjs / watchdog.mjs)
//   이므로, 지문 계산 알고리즘이 조금이라도 어긋나면(정렬순서/구분자/trim/dedup) 같은 허용목록이어도
//   해시가 달라져 "env-shadow 있음"으로 오판한다. 따라서 두 주체는 반드시 이 단일 함수를 import 해
//   "동일 canonicalization → 동일 해시"를 보장한다. (redpay-webhook EF[Deno]는 import 불가 →
//   EF 안에 동일 스펙을 미러하고, 아래 CANON_SPEC 을 계약으로 참조한다.)
//
// ── CANON_SPEC (EF 미러 계약) ─────────────────────────────────────────────────
//   1) 각 TID/merchant 값을 String 화 → trim.
//   2) 빈 문자열 제거.
//   3) Set 으로 dedup.
//   4) 기본(사전식) 오름차순 정렬: Array.prototype.sort() (locale 무관 코드포인트 비교).
//   5) "\n" 으로 join → UTF-8 → SHA-256 → 소문자 hex.
//   6) 빈 집합의 해시 = sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.
//
// read-only introspection 전용. 허용목록/registry/env/DB 를 일절 변경하지 않는다(no-DDL·no-data-mutation).

import { createHash } from "node:crypto";

export const CANON_SPEC = "trim→drop-empty→dedup→sort(codepoint asc)→join('\\n')→sha256-hex";

/** 값 배열 → canonical 정렬·dedup 문자열 배열. */
export function canonicalize(values) {
  const set = new Set();
  for (const v of values ?? []) {
    const s = (v === null || v === undefined ? "" : String(v)).trim();
    if (s.length > 0) set.add(s);
  }
  return [...set].sort();
}

/** canonical 문자열 배열 → SHA-256 소문자 hex. */
export function sha256OfList(sortedList) {
  return createHash("sha256").update(sortedList.join("\n"), "utf8").digest("hex");
}

/**
 * 허용목록 런타임 지문 산출.
 * @param {object} p
 * @param {string} p.subject   실행주체 라벨 (예: "poller", "watchdog", "webhook-ef")
 * @param {string} p.domain    도메인 (예: "foot")
 * @param {string} p.tidSource TID 허용목록 소스 라벨 (예: "env∪registry", "registry(membership)", "n/a")
 * @param {string} p.merchantSource merchant 허용목록 소스 라벨 (예: "registry", "env-override", "static-module")
 * @param {Iterable<string>} p.tids       실제 로드된 TID 집합 (없으면 [])
 * @param {Iterable<string>} p.merchants  실제 로드된 merchant_id 집합
 * @returns {object} 지문 객체 (count + sha256 + 정렬목록 + 소스라벨 + ts)
 */
export function whitelistFingerprint({ subject, domain, tidSource, merchantSource, tids, merchants }) {
  const tidSorted = canonicalize(tids ? [...tids] : []);
  const merchantSorted = canonicalize(merchants ? [...merchants] : []);
  return {
    subject: subject ?? "unknown",
    domain: domain ?? "foot",
    canon_spec: CANON_SPEC,
    tid_source: tidSource ?? "n/a",
    merchant_source: merchantSource ?? "n/a",
    tid_count: tidSorted.length,
    tid_sha256: sha256OfList(tidSorted),
    tid_sorted: tidSorted,
    merchant_count: merchantSorted.length,
    merchant_sha256: sha256OfList(merchantSorted),
    merchant_sorted: merchantSorted,
    ts: new Date().toISOString(),
  };
}

/** 지문 → 단일 로그 라인(정렬목록 제외, count+hash+source 만 = 저소음 관측용). */
export function formatFingerprintLog(fp) {
  return (
    `[WL-FINGERPRINT] subject=${fp.subject} domain=${fp.domain} ` +
    `merchant(count=${fp.merchant_count} sha256=${fp.merchant_sha256.slice(0, 12)} src=${fp.merchant_source}) ` +
    `tid(count=${fp.tid_count} sha256=${fp.tid_sha256.slice(0, 12)} src=${fp.tid_source})`
  );
}
