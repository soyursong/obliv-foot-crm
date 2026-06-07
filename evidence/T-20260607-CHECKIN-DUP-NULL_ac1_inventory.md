# AC1 dry-run 인벤토리 — T-20260607-foot-CHECKIN-DUP-NULL-DATAFIX

생성: 2026-06-07T14:33:38.052Z · **READ-ONLY (무변경)** · KST 방문일=checked_in_at AT TIME ZONE 'Asia/Seoul'

## 요약
- 전체 check_ins: 642 / NULL 고아: 14 / visit_type=new: 162
- **① NULL 고아**: 총 14 (더미 7 제외 → 실 7)
    - 고아삭제후보(연결無): **6** · 보존검토(연결有·매핑필요): **1**
- **② new 중복그룹**: 총 4 (더미 3 제외)
    - 운영자오류중복(자동정비후보): **1** · 모호(planner 확인): **0**

> 판정근거: 정본(keep) = 차트(+8) > 결제(+4) > 서비스(+2) > 진행도 > 최초생성 선점. 오류건 전부 연결無이면 자동정비후보, 일부라도 연결有면 모호→planner.

## ① NULL customer_id 고아 (실명/실데이터, 더미 제외)

- [2026-05-27 D-11] `7dd25828-0c9c-443d-abf3-fd63681c8d88` **길동이** +821099634666 · vt=new status=consult_waiting
    - 결제:없음 패키지회차:없음 서비스:없음 resv:O pkg:-
    - **판정: 고아삭제후보(연결無)** (created 2026-05-28T10:52:57.512Z)
- [2026-05-16 D-22] `61c83e50-ae12-4468-8c6a-e0e6a609796c` **김사번** 010-4444-4444 · vt=returning status=healer_waiting
    - 결제:없음 패키지회차:없음 서비스:없음 resv:O pkg:-
    - **판정: 고아삭제후보(연결無)** (created 2026-05-16T16:52:25.095Z)
- [2026-05-16 D-22] `6d1350e6-1f5e-4bd3-8f2d-a78d6260e73c` **김이번** 010-2222-2222 · vt=returning status=done
    - 결제:없음 패키지회차:없음 서비스:있음(3) resv:O pkg:-
    - **판정: 보존검토(고객매핑 필요·차트/결제/서비스 연결有)** (created 2026-05-16T16:51:07.278Z)
- [2026-05-09 D-29] `a8a74db4-9238-4279-9ebc-44206c8284a2` **김십번** 01010101010 · vt=returning status=registered
    - 결제:없음 패키지회차:없음 서비스:없음 resv:O pkg:-
    - **판정: 고아삭제후보(연결無)** (created 2026-05-10T09:48:30.232Z)
- [2026-05-06 D-32] `258fd605-8ed0-415b-ab4b-35f3d132672c` **김오번** 01055555555 · vt=returning status=registered
    - 결제:없음 패키지회차:없음 서비스:없음 resv:O pkg:-
    - **판정: 고아삭제후보(연결無)** (created 2026-05-07T11:50:27.179Z)
- [2026-05-06 D-32] `46824c34-d183-4d38-ac9c-51815c012a7f` **김삼번** 01033333333 · vt=returning status=registered
    - 결제:없음 패키지회차:없음 서비스:없음 resv:O pkg:-
    - **판정: 고아삭제후보(연결無)** (created 2026-05-07T11:50:25.111Z)
- [2026-05-06 D-32] `5545fe03-09fa-4e6c-a7ef-9e57051ed1f3` **김이번** 01022222222 · vt=new status=consult_waiting
    - 결제:없음 패키지회차:없음 서비스:없음 resv:O pkg:-
    - **판정: 고아삭제후보(연결無)** (created 2026-05-07T11:50:21.985Z)

### ①-더미/테스트 고아 (범위외 — 건드리지 않음): 7건
`63887fd6-17e8-4a07-9500-09b10e6eb94d` TEST_ANON_RLS, `275b9c55-9b2b-46bb-957c-b5275c5f56bf` 시뮬초진테스트, `f72da6fd-3af2-4df5-a0ce-3019c3d8b9c1` 시뮬재진테스트, `f9840007-ed46-46c8-adba-1d92fddea4f8` 트리거테스트, `813f24d8-ec6f-41b9-bd81-772304c9df24` 김일번, `a14cc9c4-b0b1-4e98-87bf-a4dca2ab87ab` 김일번, `bff5af10-93ed-4adc-b5b5-550aa4bdaed6` 테스트_CHK_CONSTRAINT

## ② 동일 customer_id + 동일 KST일 + new 2건+ 그룹

### A. 모호 (오류건에도 연결有 → planner/문지은 대표원장 확인) — 0그룹

### B. 운영자오류중복 (오류건 연결無 → 정비후보) — 1그룹

#### [2026-06-01 D-6] 김민경 (customer_id=83ab4fe1-0bbc-4dfc-ab3b-f01378144707) — 2건
- ✅ KEEP `207bf234-8851-4a38-8c56-c0191bea96b8` status=done 차트:- 결제:- 서비스:- created=2026-06-02T04:57:56.770Z
- ❌ ERR `6425a5c8-8fb7-46d6-a762-93d9922eeb48` status=done 차트:- 결제:- 서비스:- 패키지:- created=2026-06-02T06:12:48.995Z

### C. 범위외 (더미/테스트) — 3그룹
테스트00000(2026-06-05), 사과(2026-06-03), 테스트123(2026-05-18)

## ③ 추가 발견 — 동명 customer 중복 (★ 본 티켓 스코프 밖, planner 판단 필요)

> 사유: planner가 언급한 **김규리 2건**은 "동일 customer_id" 패턴이 아니라 **동명이인 customer master 중복**(같은 이름, 다른 customer_id)으로 발생. AC1 스코프 쿼리(동일 customer_id)에 안 잡힘 → 별도 surface.

### 전수 스캔 결과
- 동명 customer 중복 그룹: **138** — 그중 **135그룹이 동물·색·과일 QA 가명 시드**(수달·기린·빨강·올리브 등, 5/29 QA 데이터) = 범위 외.
- **실명 동명이인은 단 3건**:

| 이름 | 정본(real) | 중복(의심) |
|------|-----------|-----------|
| 김규리 | `7fa5dff1` ph 010-2368-2507 · checkin4/pkg2/pay2 | `7cef3be8` ph **010-1234-5679(test)** · checkin1/pkg1/pay0 (06-02 생성) |
| 김민경 | `83ab4fe1` ph 010-4316-0981 · checkin13/pkg2/pay16 | 06-06 'new' check-in(`10f10231`)이 **test 고객 김구번(`3da2d8ef`, ph 010-9999-9999)**에 오연결 — customer_name='김민경' 불일치 |
| 김승현 | `fcdcd44f` ph 010-2849-0209 · checkin1 | `53661ce0` ph **010-1111-1111(test)** · checkin1 (06-01 생성) |

→ **판정 보류 / planner·문지은 대표원장 확인 필요**: customer master 병합 vs 단순 check-in 재귀속 여부는 동일인 여부 확인 후 결정. 본 datafix 티켓(check_in 중복/고아 정비) 범위를 넘어서므로 자동 정비 대상에서 제외.

