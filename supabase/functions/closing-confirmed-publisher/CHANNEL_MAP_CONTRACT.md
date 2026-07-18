# 발톱(foot) 매출마감 전령 — 채널맵·표시명 계약 (D)

> T-20260718-foot-CLOSING-HERALD-PORT-GOLDEN §(D). dev-foot가 **값을 정의**하고,
> 실제 등록(marketing_v2 수신측)은 **dev-sales lane**(도메인 격리 — dev-foot는 obliv-foot-crm만 수정).
> 본 파일 = 수신측(dev-sales)이 소비할 emit-side canonical 값의 SSOT.

## 1. clinic_slug (payload top-level, HARD-DROP 게이트 키)

★dryrun 실측(2026-07-18): foot clinic = **2개**. 양쪽 slug 실재(Q6 hard_gate_pass=true).

| clinics.slug (실재, Q6 확인) | clinic name | 비고 |
|---|---|---|
| `jongno-foot` | 오블리브의원 서울오리진점 | payload `clinic_slug` 로 방출. 라우팅/dedup/드롭게이트 기준키 |
| `songdo-foot` | 오블리브 풋센터 송도 | ★송도점. 채널맵 누락 시 송도 마감 HARD-DROP |

- ★Q6 HARD 게이트: `clinic_slug` 없으면 수신기 `handle_closing_confirmed` 가 전건 HARD-DROP(무증상).
  본 slug 가 아래 CLOSING_CHANNEL_MAP_JSON 에 **반드시 등록**되어야 shadow→live flip 가능.
- preflight 확인: `SELECT public.foot_closing_herald_preflight();` (hard_gate_pass=true 필요)

## 2. CLOSING_CHANNEL_MAP_JSON 등록값 (수신측 = dev-sales/marketing_v2)

slug(변형 포함) → Slack 채널ID. 미매핑 slug = hold(오배선 방지).

```jsonc
{
  // 종로/서울오리진 발톱 매출 보고 채널 (★채널 생성 = 미결 액션, 아래 §4)
  "jongno-foot":  "<FOOT_JONGNO_CHANNEL_ID>",   // ← 채널 생성 후 채널ID 확정 필요
  "foot-jongno":  "<FOOT_JONGNO_CHANNEL_ID>",   // 구키 alias(normalizeSlug) — 안전차 등록
  // 송도 발톱 매출 보고 채널 (★별도 채널ID — jongno와 다름)
  "songdo-foot":  "<FOOT_SONGDO_CHANNEL_ID>",   // ← 송도 채널 생성 후 확정 필요
  "foot-songdo":  "<FOOT_SONGDO_CHANNEL_ID>"    // 구키 alias — 안전차 등록
}
```

## 3. CLINIC_SLUG_DISPLAY_MAP 등록값 (수신측 코드 편집)

표시명 친화화(순수 config 아님 — 코드 편집). 미편집 시 raw slug 노출(경미).

```jsonc
{
  "jongno-foot": "발톱센터(서울오리진)",
  "songdo-foot": "발톱센터(송도)"
}
```

## 4. 미결 액션 (dev-foot 스코프 밖 — planner/dev-sales/human)

1. **발톱센터 전용 Slack 채널 생성 × 2**(종로/서울오리진 + 송도) → 채널ID 확보 (권한 주체 확정 필요). human/ops 액션.
2. **CLOSING_CHANNEL_MAP_JSON 에 위 §2 등록** — marketing_v2. dev-sales lane.
3. **CLINIC_SLUG_DISPLAY_MAP 에 §3 등록** — marketing_v2 코드 편집. dev-sales lane.
4. **(B) 수신측 배선** (per-center PG DSN + reader thread + watermark + read_closing_confirmed_events fn
   + 최소권한 LOGIN role) — DA closing_reader_registry 후속계약 나오면 dev-sales 별도 티켓 carve.

> emit-side(발행체인 ①~④ + payload + 본 채널맵 값 정의 + Q6 preflight) = dev-foot 완료.
> 수신측 배선·채널 등록 = dev-sales lane (DA 후속계약 대기).
