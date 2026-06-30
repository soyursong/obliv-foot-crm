#!/usr/bin/env python3
# 시안 v2 PNG → 장쳰봇 명의로 총괄 스레드 재공유 (멱등 가드 + 착지검증)
#   channel=C0ATE5P6JTH thread_ts=1782782378.915339
#   - 업로드 전 conversations.replies 로 v2 미존재 확인 (멱등)
#   - 봇 명의(SLACK_BOT_TOKEN=장쳰). 대표 계정 직접발송 아님.
#   - 게시 후 reply_ts 회신(스레드 착지 검증)
import json, os, sys, urllib.request, urllib.parse

TOKEN   = os.environ["SLACK_BOT_TOKEN"]
CHANNEL = "C0ATE5P6JTH"
THREAD  = "1782782378.915339"
MARKER  = "[시안 v2]"   # 멱등 가드 토큰

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = [
    ("A_reservation_liveslot_v2.png",       "A · 예약관리 실시간 반영 슬롯카드 (v2)"),
    ("B_dashboard_signboard_lit_v2.png",     "B · 대시보드 전광판 점등 (v2)"),
    ("B_dashboard_signboard_off_v2.png",     "B · 대시보드 전광판 소등 (v2)"),
]

BODY = (
    "[시안 v2] 실시간 반영 슬롯·전광판 — 운영 미반영 v2 시안 미리보기\n"
    "총괄 회신 반영: ① 회색 더 연하게(실버 톤 lighten) ② 유리 볼록 효과 더 강하게"
    "(상·좌 하이라이트↑ / 하·우 그림자 대비↑ / 외곽 볼록감↑).\n"
    "대상: A) 예약관리 ‘실시간 반영’ 슬롯카드  B) 대시보드 상단 전광판(점등/소등 2위상).\n"
    "힐러 노랑 미접촉·무채색 실버 유지. ※ 코드/운영 미반영 시안 — 컨펌 주시면 반영하겠습니다."
)


def api(method, params, post_json=True):
    url = f"https://slack.com/api/{method}"
    if post_json:
        data = json.dumps(params).encode()
        headers = {"Authorization": f"Bearer {TOKEN}",
                   "Content-Type": "application/json; charset=utf-8"}
        req = urllib.request.Request(url, data=data, headers=headers)
    else:
        data = urllib.parse.urlencode(params).encode()
        headers = {"Authorization": f"Bearer {TOKEN}"}
        req = urllib.request.Request(url, data=data, headers=headers)
    r = json.loads(urllib.request.urlopen(req).read())
    return r


def whoami():
    r = api("auth.test", {})
    if not r.get("ok"):
        print("AUTH_FAIL", r.get("error"), file=sys.stderr); sys.exit(2)
    return r.get("user_id"), r.get("user")


def find_existing(bot_uid):
    """스레드에서 봇이 올린 v2 마커 메시지 탐색 → 있으면 ts 반환(멱등)."""
    r = api("conversations.replies",
            {"channel": CHANNEL, "ts": THREAD, "limit": "200"}, post_json=False)
    if not r.get("ok"):
        print("REPLIES_FAIL", r.get("error"), file=sys.stderr); sys.exit(2)
    for m in r.get("messages", []):
        txt = m.get("text", "")
        if MARKER in txt and (m.get("user") == bot_uid or m.get("bot_id")):
            return m.get("ts")
    return None


def upload_one(path, title):
    size = os.path.getsize(path)
    # 1) external upload URL
    r = api("files.getUploadURLExternal",
            {"filename": os.path.basename(path), "length": str(size)}, post_json=False)
    if not r.get("ok"):
        print("GETURL_FAIL", r.get("error"), file=sys.stderr); sys.exit(2)
    upload_url, file_id = r["upload_url"], r["file_id"]
    # 2) PUT bytes
    with open(path, "rb") as f:
        body = f.read()
    req = urllib.request.Request(upload_url, data=body, method="POST")
    urllib.request.urlopen(req).read()
    return {"id": file_id, "title": title}


def main():
    bot_uid, bot_name = whoami()
    existing = find_existing(bot_uid)
    if existing:
        print(json.dumps({"status": "ALREADY_PRESENT", "reply_ts": existing,
                          "bot": bot_name}, ensure_ascii=False))
        return
    # 업로드(3종) → 한 메시지로 completeUploadExternal (thread + initial_comment)
    uploaded = [upload_one(os.path.join(HERE, fn), title) for fn, title in FILES]
    r = api("files.completeUploadExternal", {
        "files": uploaded,
        "channel_id": CHANNEL,
        "thread_ts": THREAD,
        "initial_comment": BODY,
    })
    if not r.get("ok"):
        print("COMPLETE_FAIL", r.get("error"), file=sys.stderr); sys.exit(2)
    # 착지 검증: replies 재조회로 reply_ts 확정
    reply_ts = find_existing(bot_uid)
    # fallback: file share ts
    if not reply_ts:
        for fobj in r.get("files", []):
            shares = fobj.get("shares", {})
            for vis in ("public", "private"):
                ch = shares.get(vis, {}).get(CHANNEL, [])
                if ch:
                    reply_ts = ch[0].get("ts"); break
            if reply_ts: break
    print(json.dumps({"status": "POSTED", "reply_ts": reply_ts,
                      "bot": bot_name, "files": len(uploaded)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
