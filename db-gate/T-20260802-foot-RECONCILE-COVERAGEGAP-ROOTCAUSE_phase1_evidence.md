# RECONCILE coverage-gap orphan — Phase1 근본원인 진단 (READ-ONLY, write 0)

- generated: 2026-08-02T06:16:45.975Z
- 폴러 술어 SSOT: `supabase/functions/redpay-reconcile/index.ts L671-704`
- lookback: 14d (cutoff 2026-07-19T06:16:45.975Z)

## coverage gap 원인 (1줄)
> reconcile 매칭풀이 created_at >= now-14d 만 조회 → 14일 내 미매칭 결제는 aged-out 후 매칭풀 영구 이탈(재시도/백필 경로 부재) = 영구 미reconcile.

## 카운트
- orphan(미대사 payment) 총: **178**
- 영구 orphan(age>14d): **44**
- class-B(payment_waiting stuck ∩ 영구): **5**
- 배제사유별: {"aged_out_14d":45,"within14d_awaiting_raw":112,"within14d_no_pool_key":21}

## class-B per-row (payment_waiting stuck ∩ 영구 orphan)

| payment_id | provider | method | amount | acct_date | created(KST) | age(d) | trxid/appr/tid | ci.status | 배제사유 |
|---|---|---|---|---|---|---|---|---|---|
| a49501d9-f7e5-42a0-b846-a38afeb43bfa | (no-col) | card | 13370 | 2026-05-30 | 2026-05-30 | 64 | -/-/- | payment_waiting | aged_out_14d |
| 81eab404-d424-42a6-b3e2-3b681f1a8d70 | (no-col) | card | 13370 | 2026-05-30 | 2026-05-30 | 64 | -/-/- | payment_waiting | aged_out_14d |
| 7a706b47-0fa1-41ee-970f-44827662e188 | (no-col) | card | 13370 | 2026-05-30 | 2026-05-30 | 64 | -/-/- | payment_waiting | aged_out_14d |
| fdd31d62-ae2a-425f-8d7a-07665750cfc2 | (no-col) | card | 150000 | 2026-07-08 | 2026-07-08 | 24 | -/-/- | payment_waiting | aged_out_14d |
| bab14e0f-9e8b-4ef8-97e7-59a2995c18c5 | (no-col) | cash | 28840 | 2026-07-08 | 2026-07-08 | 24 | -/-/- | payment_waiting | aged_out_14d |

## 영구 orphan 전수 (aged>14d, class-B 외 포함)
| payment_id | provider | method | amount | created(KST) | age(d) | ci.status | 배제사유 |
|---|---|---|---|---|---|---|---|
| dadf373b-a284-4f86-b260-44a3529db2b8 | (no-col) | card | 2978840 | 2026-05-20 | 73 | done | aged_out_14d |
| e17596ef-cff8-4ec5-9c0a-1f00e97bd485 | (no-col) | cash | 4690 | 2026-05-21 | 72 | done | aged_out_14d |
| 74933c0a-d784-4b22-af3d-1556a930f808 | (no-col) | cash | 4000 | 2026-05-21 | 72 | done | aged_out_14d |
| 4dbb842e-9536-4ee1-b7ee-86bd037e6089 | (no-col) | card | 244690 | 2026-05-21 | 72 | done | aged_out_14d |
| 63e5d4ab-b51e-44d3-acba-569be7a97a9d | (no-col) | card | 5000 | 2026-05-23 | 71 | consult_waiting | aged_out_14d |
| 19467316-1d28-49b6-95a1-2c573e11b977 | (no-col) | cash | 36600 | 2026-05-24 | 69 | done | aged_out_14d |
| 3a0c439c-99bb-4bb0-8b44-363d299a4e6e | (no-col) | card | 10000 | 2026-05-25 | 69 | done | aged_out_14d |
| f7f197ff-fd15-4e6d-aa21-91a103bcffd9 | (no-col) | card | 4690 | 2026-05-25 | 68 | done | aged_out_14d |
| 94a6cff4-ac63-474b-a408-baf240fbed52 | (no-col) | card | 13370 | 2026-05-27 | 67 | done | aged_out_14d |
| aed3d412-7b0d-4820-8062-f1edd1c881ea | (no-col) | card | 13370 | 2026-05-27 | 66 | done | aged_out_14d |
| f6f7d4e5-144c-40af-bc62-44017423f293 | (no-col) | card | 13370 | 2026-05-29 | 65 | done | aged_out_14d |
| a49501d9-f7e5-42a0-b846-a38afeb43bfa | (no-col) | card | 13370 | 2026-05-30 | 64 | payment_waiting | aged_out_14d |
| 81eab404-d424-42a6-b3e2-3b681f1a8d70 | (no-col) | card | 13370 | 2026-05-30 | 64 | payment_waiting | aged_out_14d |
| 7a706b47-0fa1-41ee-970f-44827662e188 | (no-col) | card | 13370 | 2026-05-30 | 64 | payment_waiting | aged_out_14d |
| 3e32caba-6189-4b3c-be07-dc854afe42e1 | (no-col) | card | 13370 | 2026-06-06 | 56 | done | aged_out_14d |
| 8ce390a4-ac62-4f16-86e6-fd3802c10e4d | (no-col) | card | 4690 | 2026-06-08 | 55 | done | aged_out_14d |
| 6bee9265-a2b5-44ee-a581-5ff85726600d | (no-col) | card | 4690 | 2026-06-09 | 54 | laser | aged_out_14d |
| 0e6efcaa-c0cb-4a2d-940d-fd4aed58eecf | (no-col) | card | 13370 | 2026-06-10 | 52 | done | aged_out_14d |
| dfdef3e0-2bcb-4ff5-aa7d-6995b53ac2bf | (no-col) | card | 0 | 2026-06-19 | 43 | done | aged_out_14d |
| fdd31d62-ae2a-425f-8d7a-07665750cfc2 | (no-col) | card | 150000 | 2026-07-08 | 24 | payment_waiting | aged_out_14d |
| bab14e0f-9e8b-4ef8-97e7-59a2995c18c5 | (no-col) | cash | 28840 | 2026-07-08 | 24 | payment_waiting | aged_out_14d |
| 2cb3c057-a381-41da-b8d3-45c9decbf111 | (no-col) | card | 339380 | 2026-07-10 | 23 | done | aged_out_14d |
| d9ea1665-9d04-4348-b790-3564bf5f113d | (no-col) | card | 313370 | 2026-07-13 | 20 | done | aged_out_14d |
| 6bd81845-4b39-4afd-89d8-6bb6ccb3fd66 | (no-col) | card | 290900 | 2026-07-14 | 19 | registered | aged_out_14d |
| 89c24208-629b-4ca7-8e3c-bf40e6bcaa3a | (no-col) | card | 248900 | 2026-07-14 | 19 | done | aged_out_14d |
| 12b2bf37-1ea4-473d-a613-8ac0572d9eda | (no-col) | card | 8900 | 2026-07-14 | 18 | - | aged_out_14d |
| 45e62522-9835-4e42-b28c-565e4794e7b6 | (no-col) | card | 248900 | 2026-07-15 | 18 | done | aged_out_14d |
| f58a814f-0f50-4475-9191-7af45e2728d8 | (no-col) | card | 10000 | 2026-07-15 | 18 | - | aged_out_14d |
| 5e42026a-f956-4d96-a84e-0237ecc87b54 | (no-col) | card | 10000 | 2026-07-15 | 17 | - | aged_out_14d |
| 976969e3-099c-427b-abf7-291ce9fb492d | (no-col) | card | 10000 | 2026-07-15 | 17 | - | aged_out_14d |
| d6760056-1f9e-48f1-8745-f9f1f95833a0 | (no-col) | card | 10000 | 2026-07-16 | 17 | - | aged_out_14d |
| d2021f95-9f4f-4967-8760-a39d0ec557a6 | (no-col) | card | 10000 | 2026-07-16 | 17 | - | aged_out_14d |
| 168055d3-cecd-4fca-89e2-7356788aac19 | (no-col) | card | 10000 | 2026-07-16 | 17 | - | aged_out_14d |
| de30f38c-283b-43fe-bc99-ecbd344fe334 | (no-col) | transfer | 10000 | 2026-07-16 | 17 | - | aged_out_14d |
| 6fc292a4-dbba-4a3d-8c4a-c45bf0530990 | (no-col) | card | 5700 | 2026-07-16 | 17 | done | aged_out_14d |
| 5e3ccafc-edde-4df3-b084-3070918b71b4 | (no-col) | card | 5700 | 2026-07-16 | 17 | done | aged_out_14d |
| f3acd6a3-cad2-49c0-b78b-95302ba04316 | (no-col) | card | 5700 | 2026-07-16 | 17 | done | aged_out_14d |
| c06f3ece-f701-41cc-9bf1-b3cb84e85979 | (no-col) | card | 5700 | 2026-07-16 | 17 | done | aged_out_14d |
| af1f3a55-6e48-4038-ab2e-711afc82e868 | (no-col) | card | 5700 | 2026-07-16 | 16 | done | aged_out_14d |
| 4163984f-6769-4905-9d59-4b9bec41928f | (no-col) | card | 8800 | 2026-07-17 | 16 | - | aged_out_14d |
| 6c21f7aa-4351-49c8-9c42-d97532af4a8c | (no-col) | card | 8800 | 2026-07-17 | 16 | - | aged_out_14d |
| 9842a0be-12b2-494c-be0d-f024355502f0 | (no-col) | cash | 10000 | 2026-07-17 | 16 | - | aged_out_14d |
| f8f3ca8b-0b0a-421b-8b59-248b02093127 | (no-col) | card | 500000 | 2026-07-17 | 15 | - | aged_out_14d |
| 662f6ecf-3aed-4ae7-b6ef-f9068a2d6db1 | (no-col) | card | 500000 | 2026-07-17 | 15 | - | aged_out_14d |

> ⛔ write 0. 정정은 Phase2 파이프 보정(supervisor gate). 승격 술어 무접점(masking 0).