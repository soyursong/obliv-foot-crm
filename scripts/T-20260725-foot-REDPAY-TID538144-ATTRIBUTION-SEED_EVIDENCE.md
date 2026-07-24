# T-20260725-foot-REDPAY-TID538144-ATTRIBUTION-SEED — Phase-1 READ-ONLY 조사 증거 스냅샷

- **조사자**: dev-foot · **일시**: 2026-07-25 · **인증컨텍스트**: service_role (RLS bypass, 전건 관측) · **write/DDL/registry 편입 = 0**
- **프로브**: `scripts/T-20260725-foot-REDPAY-TID538144-ATTRIBUTION-SEED_probe.mjs`

## 판정: **(c) 타도메인 = 도수(body) 귀속** — foot 아님, foot registry seed 금지

## AC-1a — 538144 raw row 실측 (id=1d5d59c7-70b4-42de-81ab-907a452a9fa5)
| 필드 | 값 |
|---|---|
| clinic_id | 74967aea (foot·body 공유 clinic — slug `jongno-foot` 공통) |
| approved_at | 2026-07-24 11:42:58 KST |
| external_status | Y (승인) |
| tid (col) | 1047538144 |
| **raw_payload.tid (data.tid)** | **1047538144 (존재)** |
| **raw_payload.merchant.id (mid)** | **1777275006 (존재)** |
| **raw_payload.merchant.name** | **"오블리브-서울오리진점 도수(멀티)"** |
| merchant.member_name | 박영진 |
| amount | 10,000원 |
| trxid / approval_no | 0724C8167237 / 63915739 |
| **matched_payment_id** | **340f587b (매칭됨)** |

### ★ 티켓 전제 정정 (mid/data.tid=NULL 은 현재 DB 실측과 불일치)
티켓/부모 residual_observation 은 `mid/data.tid=NULL`(0724gap 4건과 반대 shape)로 기술했으나, **현재 prod 실측은 mid=1777275006·data.tid=1047538144 둘 다 present**. supervisor 스냅샷 시점(배포 직후) 이후 더 완전한 payload 로 재적재됐거나, col_tid-only projection 관측 아티팩트로 추정. → 본건은 "반대 웹훅 shape" 가 아니라 **완전 payload(poller shape, col_tid=data.tid=mid 모두 존재)**.

## AC-1b — registry 대조
- `redpay_terminal_registry` 총 41행 (body=14 / foot=27).
- **merchant 1777275006 = body(도수) 도메인 registry 등록됨** (14-band `1777275*`, 멀티, active=true, tid=NULL — 도수는 merchant-only 스코핑이라 registry tid=NULL 이 정상).
- TID 1047538144: foot registry.tid 직접매칭 **NO**, foot superseded_tids **NO**. → foot 미등록이 맞으나, 이는 **도수 단말 TID**라서 foot 에 없는 것.
- 1047538*** 밴드 foot 행 4개(538236/231/241/237)는 0724gap 완결분. 538144 는 이와 disjoint이며 **밴드 유사(1047538xxx)는 우연** — 실제 소속은 merchant_id(=1777275006 body) 기준 도수.

## AC-1a' — 인접 raw (11:42:58 ±15분)
- 11:35:54 (2,450,000, mid=NULL) / 11:39:25 (300,000, mid=NULL) = foot 0724gap 웹훅-shape 행(별건, 완결).
- 11:42:58 = 본건, mid=1777275006 도수 — **인접 sibling 과도 merchant 다름**. 도수 단말 단발.

## matched payment 실측 (340f587b)
- clinic=74967aea (foot·body 공유), method=card, type=payment, status=active, reconciled_at=2026-07-24 11:46:32, external_trxid=0724C8167237.
- → **이미 매칭·대사 완료**. 결제 유실 아님. foot 뷰 미표면 = merchant 스코핑상 정상(도수는 foot 아님).

## supervisor raw_total 36→37 확대 해석
- foot raw count 축이 `clinic_id=foot(=body 공유) + approved window`(merchant 미필터)면 도수 행 1건이 혼입 → foot "raw" 카운트 +1. foot 뷰(merchant/TID 스코핑)에서 미표면은 **구조적 정상**(도수 자동배제).

## 권고 (AC-2 → planner 분기)
- **(c) 타도메인 도수(body) 귀속** → planner 재라우팅(dev-body/도수 마감 검증 — 도수 reconciliation 표면 여부). 본 티켓 **foot close(no foot write)**.
- foot registry seed/UPDATE **불요·금지** (AC-1 게이트 준수). foot Phase-2 미진입. foot DA CONSULT 불요.
- 도수측 조치필요성: 결제는 이미 matched/reconciled → 데이터 유실 없음. 도수 마감/대사 표면화 여부는 body 도메인 scope(도수 TID 미상=merchant-only 스코핑 정합). dev-foot 무접촉(도메인 격리).
