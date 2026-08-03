#!/usr/bin/env python3
"""
T-20260803-foot-REDPAY-NOTXN-4TERM-RAWVERIFY-DEACTIVATE — AC-0 raw 재확인 게이트 (READ-ONLY)

'무거래(0건)' 근거를 스캔 산출이 아닌 레드페이 raw 원천(VAN∪조회API) 총량으로 재확인.
CANCELPAIR-FILTER-AUDIT verdict 계승: 스캔 raw-only 는 (a)순액0상쇄 (b)진짜무거래 (c)미적재 3상태 미구분.
→ feed↔raw 대조(A12 delta1 방식)만 진짜 0건 구분. 158 선례: feed{cnt2,net0} vs raw{cnt0} = 실제 누락.

대상 4 TID(비활성 후보) + 158(보류 control):
  1047479476(m 1777289002 멀티) · 1047479148(m 1777289010) · 1047479155(m 1777289011) · 1047479157(m 1777289013)
  [control] 1047479158(m 1777289012) — FILTER-AUDIT 에서 feed>raw 확증된 케이스

판정:
  feed_cnt == 0  AND raw_cnt == 0            → TRUE-ZERO   (진짜 무거래 → 비활성 대상)
  feed_cnt  > 0                               → HAS-TXN     (비활성 제외·보류 + 158 class → CANCELPAIR-AUDIT)
  feed_cnt == 0  BUT raw_cnt > 0              → RAW-ONLY-RESIDUAL (조사 필요 → 보류)
  feed pull 실패(success=false/WAF)           → READ-FAIL   (관측불가 → 비활성 금지, fail-closed)

write 0 / DDL 0. 순수 read: RedPay live feed(GET) + redpay_raw_transactions(SELECT via REST).
"""
import os, sys, json, urllib.request, urllib.parse, datetime

sys.path.insert(0, os.path.expanduser("~/ops/etl/recon"))
import redpay_registry_reconcile_probe as a11  # load_env, fetch_redpay_feed, ENV_PATH

ENV = a11.load_env(a11.ENV_PATH)

# 관찰구간: 단말 registry created_at=2026-07-17. 여유롭게 07-01 부터(457 프리플립 511 era 포함) 오늘까지.
WINDOW_FROM = "2026-07-01"
now_kst = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)
WINDOW_TO = now_kst.date().isoformat()

TARGETS = {
    "1047479476": {"merchant": "1777289002", "label": "풋(멀티)", "role": "candidate"},
    "1047479148": {"merchant": "1777289010", "label": "풋(무선)", "role": "candidate"},
    "1047479155": {"merchant": "1777289011", "label": "풋(무선)", "role": "candidate"},
    "1047479157": {"merchant": "1777289013", "label": "풋(무선)", "role": "candidate"},
    "1047479158": {"merchant": "1777289012", "label": "풋(무선)", "role": "control-158"},
}


def rest_get(path):
    base = ENV["SUPABASE_URL"].rstrip("/")
    key = ENV["SUPABASE_SERVICE_ROLE_KEY"]
    url = f"{base}/rest/v1/{path}"
    req = urllib.request.Request(url, headers={
        "apikey": key, "Authorization": f"Bearer {key}",
        "Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0",
    }, method="GET")
    with urllib.request.urlopen(req, timeout=40) as r:
        cr = r.headers.get("Content-Range", "")  # e.g. "0-0/5" or "*/0"
        total = None
        if "/" in cr:
            tail = cr.split("/")[-1]
            total = int(tail) if tail.isdigit() else None
        return total


def main():
    print(f"# AC-0 raw census  window={WINDOW_FROM}..{WINDOW_TO}  bizno={ENV.get('REDPAY_BUSINESS_NO')}")
    print(f"# 관찰: RedPay live feed(정본, 과거 적재갭 면역) ↔ redpay_raw_transactions(적재)\n")

    # 1) RedPay 정본 feed pull (VAN∪조회API, business_no 스코프) — 실패 시 READ-FAIL fail-closed
    #    RedPay API 는 range≈31일 상한 → 14일 청크로 분할 pull 후 누적(청크 하나라도 실패 시 READ-FAIL).
    feed_ok = True
    feed_err = None
    items = []
    chunks = []
    d0 = datetime.date.fromisoformat(WINDOW_FROM)
    d1 = datetime.date.fromisoformat(WINDOW_TO)
    cur = d0
    while cur <= d1:
        cend = min(cur + datetime.timedelta(days=13), d1)
        chunks.append((cur.isoformat(), cend.isoformat()))
        cur = cend + datetime.timedelta(days=1)
    try:
        for (cf, ct) in chunks:
            part = a11.fetch_redpay_feed(ENV, cf, ct)
            items.extend(part)
            print(f"[feed] chunk {cf}..{ct}: {len(part)} items")
    except Exception as e:  # noqa
        feed_ok = False
        feed_err = f"{type(e).__name__}: {e}"

    if not feed_ok:
        print(f"[READ-FAIL] RedPay feed pull 실패 → 전 TID 관측불가, 비활성 금지(fail-closed): {feed_err}")
        print(json.dumps({"feed_ok": False, "error": feed_err, "verdict": "READ-FAIL-ALL"}))
        sys.exit(2)

    print(f"[feed] pull OK — total items(business_no 전체, 전 도메인)={len(items)}")

    # 2) feed 를 대상 TID 로 집계 (승인·취소 raw 건수, netting 前). status 별 분해.
    feed_by_tid = {t: {"total": 0, "by_status": {}, "net": 0, "dates": set()} for t in TARGETS}
    for it in items:
        tid = str(it.get("tid")) if it.get("tid") is not None else None
        if tid not in TARGETS:
            continue
        st = str(it.get("status") or "?")
        try:
            amt = int(it.get("amount") or 0)
        except (TypeError, ValueError):
            amt = 0
        ap = it.get("approved_at") or ""
        rec = feed_by_tid[tid]
        rec["total"] += 1
        rec["by_status"][st] = rec["by_status"].get(st, 0) + 1
        rec["net"] += amt
        if len(ap) >= 10:
            rec["dates"].add(ap[:10])

    # 3) 적재(raw) count per TID (전기간 — 적재는 과거갭 영향 받으므로 feed 와 대조)
    raw_by_tid = {}
    for t in TARGETS:
        # tid 컬럼 기준 전기간 count
        raw_by_tid[t] = rest_get(f"redpay_raw_transactions?tid=eq.{t}&select=id")

    # 4) 판정
    results = []
    print("\n── per-TID census ──")
    for t, meta in TARGETS.items():
        fc = feed_by_tid[t]["total"]
        rc = raw_by_tid[t]
        by_status = feed_by_tid[t]["by_status"]
        net = feed_by_tid[t]["net"]
        if fc == 0 and (rc == 0 or rc is None):
            verdict = "TRUE-ZERO"
        elif fc > 0:
            verdict = "HAS-TXN"
        elif fc == 0 and rc and rc > 0:
            verdict = "RAW-ONLY-RESIDUAL"
        else:
            verdict = "AMBIGUOUS"
        deactivate = (verdict == "TRUE-ZERO")
        results.append({
            "tid": t, "merchant": meta["merchant"], "label": meta["label"], "role": meta["role"],
            "feed_cnt": fc, "feed_by_status": by_status, "feed_net": net,
            "raw_ingested_cnt": rc, "verdict": verdict, "deactivate": deactivate,
        })
        print(f"  TID {t} [{meta['role']:11}] m={meta['merchant']} {meta['label']}: "
              f"feed_cnt={fc} by_status={by_status} net={net} | raw_ingested={rc} "
              f"→ {verdict} {'✅비활성' if deactivate else '⛔보류/제외'}")

    freeze_set = sorted([r["tid"] for r in results if r["deactivate"] and r["role"] == "candidate"])
    held = sorted([r["tid"] for r in results if not r["deactivate"] and r["role"] == "candidate"])
    print("\n── AC-0 결론 ──")
    print(f"  TRUE-ZERO 후보(비활성 freeze-set) = {freeze_set}")
    print(f"  보류/제외 후보 = {held}")
    print(f"  control 158 = {[r['verdict'] for r in results if r['role']=='control-158']}")

    out = {
        "ticket": "T-20260803-foot-REDPAY-NOTXN-4TERM-RAWVERIFY-DEACTIVATE",
        "ac": "AC-0", "window": [WINDOW_FROM, WINDOW_TO], "feed_ok": True,
        "feed_total_items": len(items), "results": results,
        "freeze_set_deactivate": freeze_set, "held": held,
    }
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
              "T-20260803-foot-REDPAY-NOTXN-4TERM-RAWVERIFY-DEACTIVATE_ac0_census.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=2, default=lambda o: list(o) if isinstance(o, set) else o)
    print("\n[written] _ac0_census.json")


if __name__ == "__main__":
    main()
