# RC 리포트 — 상담배정 [확정] Slack 유입경로 '네이버→워크인' 오표기

- **티켓**: T-20260729-foot-CONSULT-SLACK-INFLOW-WALKIN-MISLABEL
- **작성**: dev-foot · 2026-07-29
- **성격**: 진단 전용 (코드·데이터·배포 무변경 / 산출물 = 본 RC)
- **증상**: 권선제(차트 #F-5294, 실제 유입 "네이버")가 상담대기방(C0B4HEC9SHH) [확정] 발송에서 "워크인"으로 안내됨. (증거 slack F0BLF1A20UV / 20260729_154507.png)
- **판정**: **가설 B 확정 (발송 payload/매핑 로직 결함) — 소스 데이터 정상**. 단건 아님, **구조적 폴백**.
- **인증컨텍스트**: 진단쿼리 전부 `service_role`(introspection 표준, RLS 0-row 오독 방지). READ-ONLY, write 0건.

---

## AC-1. F-5294 유입경로 3지점 실측 대조

| 지점 | 소스 | 값 | 정오 |
|------|------|-----|------|
| ① DB 원본(SSOT) | `customers.visit_route` (chart_number=F-5294, id=81e7ba31…3703) | **"네이버"** | ✅ 정상 |
| ② 화면 표시 | 금일 배분 이력 유입경로 컬럼 = `AXIS_KO[axisOf(ci,'consult')]` (Assignments.tsx:998) | **"워크인"** | ❌ 오표기 |
| ③ Slack 발송 | EF `send-consult-notify` body.inflow(= FE r.inflow 그대로 relay) | **"워크인"** | ❌ 오표기 |

- DB 실측 원본: `visit_route="네이버"`, `lead_source=null`, customers.visit_type="returning".
- 발송된 check_in(id=30c402b0…4297): `visit_type="new"`, `consult_notify_status="sent"`.
- **①은 옳고 ②③이 틀림 → 소스 오염(가설 A) 기각. 표시/발송 파생 로직 결함.**

## AC-2. '네이버→워크인' 변환 발생 지점 (파일:라인 특정)

**단일 변환점 = `deriveConsultAxis()` — `src/lib/autoAssign.ts:131‑141`**

```js
const CONSULT_AXES = ['TM', '인바운드', '워크인'];        // L129
export function deriveConsultAxis(c) {
  if (c.visit_type === 'returning') return 'returning';   // L136
  const raw = (c.visit_route ?? c.lead_source ?? '').trim(); // L137  → "네이버"
  if (CONSULT_AXES.includes(raw)) return raw;             // L138  "네이버" ∉ {TM,인바운드,워크인}
  return '워크인';                                        // L140  ★ 구조적 폴백 → "워크인"
}
```

**변환 경로 (증거 기반, 런타임 재현):**
1. 발송 check_in의 per-checkin `visit_type` = `new`(초진) → L136 미해당.
2. `raw = visit_route("네이버") ?? lead_source` = `"네이버"`.
3. `"네이버"`는 `CONSULT_AXES`(TM/인바운드/워크인) 3종에 없음 → L138 미매칭.
4. **L140 폴백 `return '워크인'`** ← 여기서 네이버가 소실되고 워크인으로 치환.
5. `Assignments.tsx:998` : `inflow = AXIS_KO['워크인'] = '워크인'` → 화면 컬럼 + `r.inflow`.
6. `Assignments.tsx:1221‑1222` : EF `send-consult-notify` body에 `inflow: r.inflow('워크인')` 전달.
7. EF(`send-consult-notify/index.ts` L214‑216): `inflow`를 **가공 없이 그대로** 문구에 삽입 → "권선제님 워크인 상담 대기중".

- 재현 시뮬(probe): `deriveConsultAxis({visit_type:'new', visit_route:'네이버'})` → `"워크인"` (일치).
- **EF는 무죄** — inflow를 relay만 하며 자체 '워크인' 폴백/NULL치환 없음(가설 B의 EF-side 기각). 결함은 **FE 파생(deriveConsultAxis)을 표시 라벨로 재사용**한 데 있음.
- **회귀 성격**: `deriveConsultAxis`는 원래 **자동배정 균등 버킷 그룹키**(비-TM/인바운드를 '워크인 성격=균등 대상'으로 의도적 수렴)로 설계됨. 오늘 15:30 배포 T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY가 이 **집계 버킷 키를 사람이 읽는 '유입경로' 표시 라벨로 전용(轉用)** 하면서 오표기가 사용자에게 노출됨.

## AC-3. 오염 범위 — 단건 vs 구조적

**구조적. 단건 아님.** `visit_route`가 {TM·인바운드·워크인} 3종 밖이면 초진 배정 시 전부 '워크인'으로 접힘.

**전체 customers 891건 유입경로 원본값 분포 (service_role 실측):**

| 원본 visit_route/lead_source | count | axisOf(초진 시) | 표시/발송 |
|------|------|------|------|
| TM | 623 | TM | ✅ TM |
| (빈값) | 194 | 워크인 | ⚠ 미상→워크인(기본값) |
| 워크인 | 20 | 워크인 | ✅ 워크인 |
| 인바운드 | 20 | 인바운드 | ✅ 인바운드 |
| **네이버** | **16** | **워크인** | ❌ 오표기 |
| **지인소개** | **15** | **워크인** | ❌ 오표기 |
| **공홈** | **3** | **워크인** | ❌ 오표기 |

- **명시적 오표기 유니버스(비-워크인 실값 → 워크인 강제): 네이버 16 + 지인소개 15 + 공홈 3 = 34건.**
  - 이들은 해당 방문이 초진 판정이면 '워크인', 재진 판정이면 '재진'으로 표시(재진 시엔 유입경로 자체 미노출이라 체감 낮음). F-5294도 customers.visit_type='returning'이나 금회 check_in은 'new'라 워크인 노출.
- **빈값 기본값(별도 성격): 비-재진 customers 중 raw가 빈값 → '워크인' 기본치환 = 125건 중 117건.** '미상'을 '워크인'으로 단정하는 것도 부정확하나, 명시적 오표기(34건)와 원인·구제책이 다름(라벨 부재 vs 라벨 소실).

**판정 쿼리(재실행용):** `scripts/T-20260729-foot-CONSULT-SLACK-INFLOW-WALKIN-MISLABEL_rc-probe.mjs` (READ-ONLY, service_role, customers 전수 + deriveConsultAxis 복제 시뮬).

## AC-4. 권장 수정방향 (1줄, 수정은 본 티켓 금지)

**payload/표시 로직 수정** — Slack 유입경로 라벨을 집계용 `deriveConsultAxis`(균등 버킷)에서 분리해 **실제 `visit_route ?? lead_source` 원문(재진 시 '재진')을 표시**하도록 `Assignments.tsx:998` inflow 바인딩을 교정. **`deriveConsultAxis`/CONSULT_AXES enum·'워크인' 폴백 기본값은 무변경**(자동배정 균등 로직 SSOT — 건드리면 배정 왜곡, 티켓 금지사항). 데이터 백필 불필요(DB SSOT는 이미 정상).

---

### 부가 확인 (하지 말 것 준수)
- ✅ 유입경로 enum/기본값 임의 변경 없음. `VISITROUTE-NAVER-ALIGN` 정합 확인: '네이버'는 16건 실저장된 정규 입력값 = source 정상, 정렬 이슈 아님.
- ✅ cross-CRM 유입경로 귀속 SSOT(오가닉/광고 split·cue_card lead) 무접촉 — 본 결함은 foot 내 FE 표시 라벨 파생 한정, 귀속 로직 무관.
- ✅ 데이터 UPDATE·코드·EF·배포 변경 0건. 산출물 = 본 RC + read-only probe.

**후속**: planner FOLLOWUP 회신 → 수정 티켓 별도 발행·재게이트 요청.
