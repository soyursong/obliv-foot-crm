# T-20260717-foot-DAYCLOSE-VS-SIDEBAR-MGRSTAT-RECONCILE — RCA 증거

**성격**: READ-ONLY 진단. 코드/DB 변경 0. (수정은 김주연 총괄 confirm 게이트 통과 후)
**현장 리포트**: 김주연 총괄 — "일마감 '실장별 매출 통계'와 사이드바 '[통계-담당실장별]' 내용이 상이"
**clinic**: jongno-foot `74967aea-a60b-4da3-a0e7-9c997a930bc8`
**재현 스크립트**: `scripts/T-20260717-...RECONCILE_probe2.mjs` (SELECT/RPC only)

---

## 1) 두 뷰 데이터 소스 대조표

| 축 | View A — 일마감 › **담당자별 매출** | View B — 사이드바 통계 › **실장별 실적** |
|----|-----|-----|
| 코드 | `src/pages/Closing.tsx` `staffTotals` (L1024) | `src/components/stats/ConsultantSection.tsx` ← `foot_stats_consultant` RPC |
| **매출 귀속** | `customers.assigned_staff_id` (고객 **배정담당자**) | `check_ins.consultant_id` (**상담 실장**, 티켓팅 발생자) |
| **기간 정의** | **단일일** `payments/pkg.created_at` KST (결제일) | **기간 range** `check_ins.checked_in_at` KST (체크인일). **기본 preset=`month`** → 당월 1일~오늘 |
| **직원 모집단** | 배정담당 있는 전 직원 + 수기 staff_name | `staff.role='consultant'` **且** 기간 내 티켓팅(상담전이) 있는 자만 (INNER JOIN) |
| **매출 범위** | payments + package_payments + **closing_manual_payments** 전액, **전체 tax_type**(급여/비급여/선수금) | 티켓팅 check_in에 **연결된** payments(check_in_id) + package(package_id)만. **수기수납 제외** |
| 환불 | net(refund 음수) | net(refund 음수) |
| 시뮬레이션 | 미제외(현 데이터 영향 확인 필요) | 미제외 |

→ **두 뷰는 서로 다른 지표다**: A=결제 수납액(현금흐름)·배정담당·결제일 / B=상담 티켓팅 실적·상담실장·체크인일. 일치가 목적이 아님.

---

## 2) 실제 델타 재현 (prod read-only)

### [2026-07-16]
| 실장 | View A (일마감) | View B same-day (통계) |
|----|----:|----:|
| 정연주 | 118,500 | 34,200 |
| 강경민 | 92,800 | 22,800 |
| 김지윤 | 82,800 | 21,400 |
| **합계** | **294,100** | **78,400** |

### [2026-07-15]
| 실장 | View A (일마감) | View B same-day (통계) |
|----|----:|----:|
| 김지윤 | 2,104,000 | **0** |
| 강경민 | 138,000 | **0** |
| 정연주 | 50,000 | **0** |
| **합계** | **2,283,100** | **0** |

### View B 월간 기본값(사이드바 진입 시 실제 표시, 2026-07-01~07-17)
합계 **78,400** (7명, 총매출: 정연주 34,200 / 김지윤 21,400 / 강경민 22,800 / **엄경은·송지현·김주연·김수린 = 0**)
- 티켓팅은 엄경은 17·송지현 15건씩 있으나 **총매출 0** → 매출 컬럼 구조적 결손.
- **월간 총매출(78,400) == 07-16 단일일 총매출** → 07-16 외 나머지 매출 대부분 미포착.

---

## 3) 델타 발생축 — 수치 지목 (root cause)

**07-01~07-17 매출 원장:**
- `payments`: 69행 중 **check_in_id 보유 27행(39.1%)**. 금액 전체 1,174,120 / check_in_id 연결분 638,620.
- `package_payments`: 25행 = **10,260,110 (전체 매출의 ~90%)**.
- `check_ins`: 174행 중 consultant_id 112, **package_id 보유 = 1행뿐(1/174)**.

**→ 근본 원인 (2축):**
1. **[구조적/의도] 축·기간·모집단 차이** — A=배정담당·결제일·전체결제, B=상담실장·체크인일·티켓팅결제. 매출액이 다를 수밖에 없음.
2. **[버그성] View B '총 매출액' 컬럼이 사실상 붕괴** — `foot_stats_consultant`는 패키지 매출을 `check_ins.package_id`로 귀속하는데 그 컬럼이 1/174만 세팅됨 → **매출 90%(패키지 10.26M)가 상담실장에 전혀 귀속 안 됨**. 단건도 61%가 check_in_id 미연결로 누락. 그래서 총매출/객단가가 항상 0에 가깝게 나옴(07-15 전원 0).

---

## 4) 판정

| 지표 | Canon | 근거 |
|----|----|----|
| **실장별 매출액(수납/현금)** | **View A (일마감 담당자별)** | 배정담당 100% 귀속 + 결제 전액(패키지·수기 포함). 현금흐름 정확. |
| **실장별 상담 티켓팅 건수·전환율** | **View B (통계 실장별 실적)** 의 건수 컬럼 | 상담실장·티켓팅 축의 정본. |
| **View B 총매출/객단가 컬럼** | **신뢰 불가(버그)** | 패키지 매출 미귀속(check_ins.package_id 1/174) → <1% 포착. |

**결론: '상이'의 대부분은 의도된 축 차이(라벨 문제) + View B 총매출 컬럼의 실제 버그(귀속 결손)의 복합.**

---

## 5) 수정안 (착수 = 김주연 총괄 confirm 게이트 통과 후)

- **Option 1 (저위험, db_change 無, label-only):** 두 뷰에 축·기간 명시 라벨/툴팁 추가("일마감=결제수납액·배정담당·당일" vs "통계=상담티켓팅 실적·상담실장·당월"). View B 총매출/객단가 컬럼은 "티켓팅 연결 결제분만" 각주 또는 숨김. → RPC 무변경 → **DB 변경 없음.**
- **Option 2 (근본수정, db_change=true):** `foot_stats_consultant` 패키지 매출 귀속을 `check_ins.package_id`(미세팅) 대신 패키지 원천 상담 check_in/consultant 기준으로 재설계. → **db_change:true + MIG-GATE 5필드 + DA CONSULT 판정 + 귀속 의미론 confirm 필요.**

> dev-foot는 본 RCA까지만 수행(read-only). Option 선택·집계기준 변경은 confirm 후 별도 티켓.
