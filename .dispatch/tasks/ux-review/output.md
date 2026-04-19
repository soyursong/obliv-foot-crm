# UX Review — 역할별 시나리오 기반 불편함 발견 및 해결

> 리뷰 일시: 2026-04-10
> 대상: Obliv Ose 원내 대기관리 앱 (happy-flow-queue)

---

## 1. 크로스커팅 이슈 (전체 시스템)

### C-01. [Critical] 유입경로(referral) 예약 등록 시 DB에 저장되지 않음
- **파일**: `src/pages/AdminReservations.tsx:204-210`
- **현상**: 예약 생성 모달에서 `resReferral` 상태를 수집하지만 `handleCreate` 함수에서 insert할 때 누락됨
- **영향**: TM팀이 유입경로를 기록해도 데이터가 사라짐. 마케팅 분석 불가
- **수정**:
```tsx
// 기존 (line 206-210)
await supabase.from('reservations').insert({
  clinic_id: clinicId, customer_id: selectedCustomer.id,
  reservation_date: format(resDate, 'yyyy-MM-dd'), reservation_time: resTime,
  memo: resMemo || null,
} as any);

// 수정
await supabase.from('reservations').insert({
  clinic_id: clinicId, customer_id: selectedCustomer.id,
  reservation_date: format(resDate, 'yyyy-MM-dd'), reservation_time: resTime,
  memo: resMemo || null, referral_source: resReferral || null,
} as any);
```

### C-02. [Critical] AdminLayout 글로벌 검색이 clinic_id 필터 없이 전체 고객 조회
- **파일**: `src/components/AdminLayout.tsx:100-108`
- **현상**: `handleSearch`에서 `.or(...)` 호출 시 clinic_id 필터 없음 → 다른 지점 고객도 검색됨
- **영향**: 다중 지점 운영 시 데이터 격리 실패, 개인정보 유출 위험
- **수정**:
```tsx
// 기존 (line 100-103)
const { data } = await supabase
  .from('customers')
  .select('id, name, phone, memo')
  .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)

// 수정: clinic_id 필터 추가 (selectedClinicId 또는 props에서 가져오기)
const currentClinicId = getSelectedClinicId();
const { data } = await supabase
  .from('customers')
  .select('id, name, phone, memo')
  .eq('clinic_id', currentClinicId)
  .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
```

### C-03. [High] AdminClosing / AdminStaff의 activeTab 값이 잘못됨
- **파일**: `src/pages/AdminClosing.tsx:173`, `src/pages/AdminStaff.tsx:153`
- **현상**: 두 페이지 모두 `activeTab="queue"`로 설정됨
- **영향**: AdminLayout에서 현재 탭 하이라이트 불일치 (현재 TABS가 비어있어 시각적 영향은 없으나, 추후 탭 활성화 시 버그)
- **수정**: AdminLayout의 `activeTab` 타입을 확장하고 각 페이지에 올바른 값 전달
```tsx
// AdminLayout.tsx:14
type AdminLayoutProps = {
  activeTab: 'queue' | 'reservations' | 'customers' | 'closing' | 'staff';
  ...
}
// AdminClosing.tsx:173 → activeTab="closing"
// AdminStaff.tsx:153 → activeTab="staff"
```

### C-04. [Medium] WaitingScreen에서 "명" 이중 출력 버그
- **파일**: `src/pages/WaitingScreen.tsx:153`
- **현상**: `{ahead}{t(lang, 'people')}{lang === 'ko' ? '명' : ''}` → i18n의 `people`이 이미 '명'이므로 "3명명" 출력
- **영향**: 한국어 고객에게 어색한 UI
- **수정**:
```tsx
// 기존 (line 153)
{t(lang, 'queueAhead')}: <span className="font-bold text-foreground">{ahead}{t(lang, 'people')}{lang === 'ko' ? '명' : ''}</span>

// 수정: 중복 제거
{t(lang, 'queueAhead')}: <span className="font-bold text-foreground">{ahead}{t(lang, 'people')}</span>
```
- **같은 버그**: line 159, 160, 161도 동일 — `{lang === 'ko' ? '명' : ''}` 삭제 필요

---

## 2. TM팀 시나리오 (예약 등록/변경/확인)

### TM-01. [High] 예약 날짜에 과거 날짜 선택 가능
- **파일**: `src/pages/AdminReservations.tsx:432`
- **현상**: Calendar 컴포넌트에 `disabled` 속성 없음 → 과거 날짜에 예약 가능
- **수정**:
```tsx
// 기존 (line 432)
<Calendar mode="single" selected={resDate} onSelect={(d) => d && setResDate(d)} className={cn("p-3 pointer-events-auto")} />

// 수정: 과거 날짜 비활성화
<Calendar mode="single" selected={resDate} onSelect={(d) => d && setResDate(d)} disabled={(date) => date < startOfDay(new Date())} className={cn("p-3 pointer-events-auto")} />
```

### TM-02. [High] 예약 상세에서 날짜 변경 불가
- **파일**: `src/pages/AdminReservations.tsx:466-497`
- **현상**: 예약 상세 모달에서 시간/메모만 수정 가능. 날짜 변경 불가.
- **영향**: TM팀이 고객 일정 변경 시 기존 예약 취소 후 재등록해야 함
- **수정**: 상세 모달에 날짜 변경 Popover 추가 필요

### TM-03. [Medium] 예약 취소 시 확인 다이얼로그 없음
- **파일**: `src/pages/AdminReservations.tsx:229-233`
- **현상**: "취소" 버튼 클릭 즉시 DB 업데이트. 실수로 클릭 시 복구 불가
- **수정**: `handleCancel`에서 `if (!confirm('예약을 취소하시겠습니까?')) return;` 추가 또는 AlertDialog 사용

### TM-04. [Medium] 예약 상세 모달에서 고객 전화번호가 마스킹 없이 노출
- **파일**: `src/pages/AdminReservations.tsx:474`
- **현상**: `{detailRes.customers?.phone}` → 전체 번호 노출 (다른 화면은 maskPhone 사용)
- **수정**: `{maskPhone(detailRes.customers?.phone || '')}`

### TM-05. [Medium] 주간 캘린더에서 한 슬롯에 2건 이상이면 정보 부족
- **파일**: `src/pages/AdminReservations.tsx:323-324`
- **현상**: `showMax = 2`로 제한, overflow는 "+N명"만 표시. 3건 이상이면 누가 있는지 확인 불가
- **영향**: 바쁜 시간대에 예약 현황 파악 어려움
- **수정**: overflow 클릭 시 해당 슬롯 전체 목록 모달 표시

### TM-06. [Low] 신규 고객 등록 시 전화번호 형식 검증 없음
- **파일**: `src/pages/AdminReservations.tsx:214-221`
- **현상**: 어떤 문자열이든 입력 가능. 잘못된 번호로 등록될 수 있음
- **수정**: 전화번호 최소 길이 검증 (10자리 이상) 추가

---

## 3. 코디팀 시나리오 (체크인→대기→상담→시술대기→시술→완료)

### CO-01. [Critical] 예약 타임라인에서 같은 시간대 예약이 덮어씌워짐
- **파일**: `src/pages/AdminDashboard.tsx:626`
- **현상**: `resMap[r.reservation_time.slice(0, 5)] = r;` → 같은 시간 슬롯에 여러 예약 시 마지막 것만 표시
- **영향**: 같은 시간 예약 고객을 놓칠 수 있음
- **수정**: resMap을 배열로 변경
```tsx
// 기존
const resMap: Record<string, typeof activeRes[0]> = {};
activeRes.forEach(r => { resMap[r.reservation_time.slice(0, 5)] = r; });

// 수정
const resMap: Record<string, (typeof activeRes[0])[]> = {};
activeRes.forEach(r => {
  const key = r.reservation_time.slice(0, 5);
  if (!resMap[key]) resMap[key] = [];
  resMap[key].push(r);
});
// 그리고 렌더링에서도 배열 순회하도록 수정
```

### CO-02. [High] 수동 등록 시 유입경로/예약 연결 불가
- **파일**: `src/pages/AdminDashboard.tsx:482-488`
- **현상**: `handleManualRegister`에 referral_source 필드 없음. customer_id도 조회/연결하지 않음
- **영향**: 수동 등록 고객은 유입경로 추적 불가, 기존 고객 이력과 단절
- **수정**: 수동 등록 모달에 유입경로 선택 + 기존 고객 검색 기능 추가

### CO-03. [High] 우클릭 컨텍스트 메뉴에 "노쇼"만 있음
- **파일**: `src/pages/AdminDashboard.tsx:866-870`
- **현상**: 컨텍스트 메뉴 옵션이 노쇼 하나뿐
- **영향**: 상태 복구, 이전 단계로 되돌리기 등 빈번한 작업에 대한 빠른 접근 불가
- **수정**: "대기로 되돌리기", "고객 상세 보기", "노쇼" 등 추가

### CO-04. [Medium] 시술실 담당 선생님이 칸반보드에 표시 안 됨
- **파일**: `src/pages/AdminDashboard.tsx:776-806`
- **현상**: 상담실은 `getRoomStaff` 호출하여 표시하지만, 시술실 헤더에는 staff 정보 미표시
- **영향**: 코디가 어떤 시술실에 어떤 선생님이 있는지 한눈에 파악 불가
- **수정**: 시술실 번호 옆에 해당 날짜 배정된 선생님 이름 표시

### CO-05. [Medium] 대시보드에서 칸반 카드를 드래그하지 않으면 상태 변경 방법 없음
- **파일**: `src/pages/AdminDashboard.tsx` (전반)
- **현상**: Detail Sheet에 상태 변경 버튼 없음. 드래그만으로 상태 변경 가능
- **영향**: 태블릿/마우스 드래그가 불편한 환경에서 상태 변경 어려움
- **수정**: Detail Sheet 상단에 "다음 단계로 이동" 버튼 또는 상태 선택 드롭다운 추가

### CO-06. [Medium] 실시간 업데이트 시 서비스/결제 정보 미갱신
- **파일**: `src/pages/AdminDashboard.tsx:336-355`
- **현상**: realtime subscription에서 check_in UPDATE 시 카드만 갱신. cardServices/dayPayments는 갱신 안 됨
- **영향**: 다른 사용자가 결제/시술 등록하면 현재 화면에 반영 안 됨
- **수정**: UPDATE 이벤트 시 `fetchCheckIns` 전체 재호출 또는 서비스/결제도 realtime 구독

### CO-07. [Low] 대기 카드의 경과 시간이 30초마다만 갱신됨
- **파일**: `src/pages/AdminDashboard.tsx:242-244`
- **현상**: `setTick` 30초 간격 → 오래 대기 중인 고객의 시간 표시가 부정확하게 느껴짐
- **수정**: 1분마다가 적정 (현재 30초도 수용 가능하긴 함)

---

## 4. 상담실장 시나리오 (고객정보 확인, 시술선택, 가격조정, 결제)

### CN-01. [High] 상세 Sheet에서 고객 과거 방문이력 미표시
- **파일**: `src/pages/AdminDashboard.tsx:539-547`
- **현상**: `openDetail`에서 현재 체크인의 서비스/결제만 조회. 과거 방문 이력 없음
- **영향**: 상담실장이 재방문 고객의 이전 시술/결제 이력을 확인할 수 없음
- **수정**: customer_id 기반 과거 check_ins + payments 조회 추가 (AdminCustomers의 openDetail처럼)

### CN-02. [High] 결제 금액 자동 입력 안 됨
- **파일**: `src/components/PaymentModal.tsx:29-49`
- **현상**: PaymentModal에 시술 합계 금액 props가 없음. 수동 입력해야 함
- **영향**: 매번 금액 계산하여 입력 → 오류 가능성, 시간 소모
- **수정**:
```tsx
// PaymentModal props에 suggestedAmount 추가
interface PaymentModalProps {
  open: boolean;
  customerName: string;
  suggestedAmount?: number;  // 추가
  onSkip: () => void;
  onComplete: (data: {...}) => void;
}
// 초기값으로 suggestedAmount 설정
useEffect(() => {
  if (suggestedAmount && open) setAmount(suggestedAmount.toLocaleString());
}, [suggestedAmount, open]);
```

### CN-03. [High] 분할결제(카드+현금) 불가
- **파일**: `src/components/PaymentModal.tsx`
- **현상**: 결제 수단이 card/cash 단일 선택. 분할결제 불가
- **영향**: 실제 피부과에서 카드+현금 혼합 결제가 빈번함
- **수정**: "분할결제" 옵션 추가, 카드/현금 각각 금액 입력

### CN-04. [Medium] 시술 추가 다이얼로그에서 검색 불가
- **파일**: `src/pages/AdminDashboard.tsx:1012-1045`
- **현상**: 시술 목록이 카테고리별로 나열만 됨. 검색 기능 없음
- **영향**: 시술 항목이 많으면 찾기 어려움
- **수정**: 다이얼로그 상단에 검색 Input 추가

### CN-05. [Medium] 결제 완료 후 영수증/기록 확인 어려움
- **파일**: `src/pages/AdminDashboard.tsx:986-997`
- **현상**: 결제 완료 시 "결제 완료" 뱃지만 표시. 할부, 메모 등 상세 정보 미표시
- **수정**: 결제 상세 (할부 개월 수, 메모) 표시 추가

---

## 5. 시술사 시나리오 (시술실 정보 접근성)

### TE-01. [High] 시술사 전용 뷰 없음 — 복잡한 대시보드를 함께 사용해야 함
- **파일**: 해당 없음 (기능 부재)
- **현상**: 시술사도 코디용 대시보드를 사용해야 함. 자기 방 환자만 볼 수 있는 간단한 뷰 없음
- **영향**: 시술실에서 필요한 정보만 빠르게 확인하기 어려움
- **수정**: 시술사용 간단 뷰 (내 방 환자 목록 + 시술 항목 + 마취 타이머) 추가 고려

### TE-02. [Medium] 시술실 카드에서 시술 항목 트렁케이트됨
- **파일**: `src/pages/AdminDashboard.tsx:140-142`
- **현상**: compact 카드에서 서비스명이 `truncate` CSS로 잘림
- **영향**: 여러 시술을 받는 환자의 전체 시술 목록 확인 불가
- **수정**: 툴팁이나 줄바꿈으로 전체 표시. 현재 title 속성은 있으나 터치 디바이스에서 동작 안 함

### TE-03. [Medium] 마취 타이머 알림 없음
- **파일**: `src/pages/AdminDashboard.tsx:143-147`
- **현상**: 마취 20분 경과 시 텍스트만 변경됨. 소리/진동 알림 없음
- **영향**: 시술사가 계속 화면을 주시해야 함
- **수정**: 20분 도달 시 toast 알림 또는 카드 배경색 변경(깜빡임)

---

## 6. 고객 시나리오 (셀프체크인, 대기화면)

### PA-01. [High] 체크인 화면 문구가 혼란스러움
- **파일**: `src/pages/CheckIn.tsx:181`
- **현상**: "예약하지 않은 고객 셀프체크인" — 그러나 실제로는 예약 고객도 체크인하면 reservation과 자동 연결됨
- **영향**: 예약 고객이 이 화면을 보고 체크인하지 않을 수 있음
- **수정**:
```tsx
// 기존
{lang === 'ko' ? '예약하지 않은 고객 셀프체크인' : 'Self Check-in for Walk-in Customers'}

// 수정
{lang === 'ko' ? '셀프 체크인' : 'Self Check-in'}
```

### PA-02. [Medium] 체크인 제출 중 로딩 UI 부족
- **파일**: `src/pages/CheckIn.tsx:274-277`
- **현상**: loading 시 버튼 텍스트가 "..."만 표시. 스피너 없음
- **영향**: 네트워크 느린 환경에서 고객이 중복 제출 시도 가능
- **수정**: 로딩 스피너 아이콘 + "체크인 중..." 텍스트

### PA-03. [Medium] 대기화면에서 예상 대기시간 미표시
- **파일**: `src/pages/WaitingScreen.tsx`
- **현상**: "내 앞 대기 인원" 수만 표시. 예상 시간 없음
- **영향**: 고객이 얼마나 기다려야 하는지 감을 잡기 어려움
- **수정**: 앞 인원 × 평균 상담시간(약 15분)으로 대략적 예상시간 표시

### PA-04. [Low] 대기화면에서 체크인 취소 불가
- **파일**: `src/pages/WaitingScreen.tsx`
- **현상**: 체크인 후 취소할 수 있는 방법 없음
- **영향**: 고객이 급하게 떠나야 할 때 대기 목록에 계속 남음
- **수정**: "체크인 취소" 버튼 추가 (확인 다이얼로그 포함)

### PA-05. [Low] 체크인 에러 시 사용자 피드백 없음
- **파일**: `src/pages/CheckIn.tsx:147-148`
- **현상**: catch 블록에서 console.error만 함. 사용자에게 알림 없음
- **수정**: toast 또는 에러 메시지 표시

---

## 7. 일마감(AdminClosing) 관련

### CL-01. [Medium] 환불 등록 시 고객 검색이 이름 텍스트 매칭만
- **파일**: `src/pages/AdminClosing.tsx:398-400`
- **현상**: ilike로 이름 매칭 → 동명이인 구분 불가, 오타 시 연결 실패
- **수정**: 해당일 check-in 목록에서 선택하는 방식으로 변경

### CL-02. [Medium] 마감 확정 취소(되돌리기) 불가
- **파일**: `src/pages/AdminClosing.tsx:169`
- **현상**: `isConfirmed` 상태에서 모든 입력 disabled. 수정 방법 없음
- **영향**: 실수로 마감 확정 시 복구 불가
- **수정**: "마감 해제" 버튼 추가 (권한 확인 후)

---

## 8. 직원관리(AdminStaff) 관련

### ST-01. [Medium] 직원 추가 시 역할(role) 선택 불가
- **파일**: `src/pages/AdminStaff.tsx:110`
- **현상**: 하드코딩 `role: 'technician'`. 상담사/코디 등 다른 역할 등록 불가
- **수정**: 역할 선택 드롭다운 추가

### ST-02. [Medium] 직원 수정/비활성화 UI 없음
- **파일**: `src/pages/AdminStaff.tsx:161-167`
- **현상**: 직원 카드에 이름만 표시. 수정, 삭제, 비활성화 기능 없음
- **수정**: 직원 카드 클릭 시 수정/비활성화 모달

### ST-03. [Low] 시술실 배정에서 drag-and-drop 미지원
- **파일**: `src/pages/AdminStaff.tsx:196-225`
- **현상**: 셀 클릭 → 직원 선택만 가능. 복사/붙여넣기/주간 패턴 복사 없음
- **영향**: 매주 같은 배정을 반복 입력해야 함

---

## 우선순위 정렬 액션 아이템

### P0 — Critical (즉시 수정)
| # | 이슈 | 파일:라인 | 수정 난이도 |
|---|------|-----------|------------|
| 1 | C-01: 유입경로 DB 미저장 | AdminReservations.tsx:206 | 쉬움 (1줄 추가) |
| 2 | C-02: 글로벌 검색 clinic_id 미필터 | AdminLayout.tsx:100 | 쉬움 (1줄 추가) |
| 3 | CO-01: 예약 타임라인 같은 시간 덮어씌움 | AdminDashboard.tsx:626 | 중간 (배열로 변경) |

### P1 — High (이번 스프린트)
| # | 이슈 | 파일:라인 | 수정 난이도 |
|---|------|-----------|------------|
| 4 | C-04: "명명" 이중 출력 | WaitingScreen.tsx:153,159-161 | 쉬움 |
| 5 | TM-01: 과거 날짜 예약 가능 | AdminReservations.tsx:432 | 쉬움 |
| 6 | TM-02: 예약 날짜 변경 불가 | AdminReservations.tsx:466 | 중간 |
| 7 | CO-02: 수동 등록에 유입경로 없음 | AdminDashboard.tsx:482 | 중간 |
| 8 | CO-03: 컨텍스트 메뉴 부족 | AdminDashboard.tsx:866 | 중간 |
| 9 | CN-01: 고객 과거 이력 미표시 | AdminDashboard.tsx:539 | 중간 |
| 10 | CN-02: 결제 금액 자동입력 | PaymentModal.tsx:29 | 쉬움 |
| 11 | PA-01: 체크인 문구 혼란 | CheckIn.tsx:181 | 쉬움 |

### P2 — Medium (다음 스프린트)
| # | 이슈 | 수정 난이도 |
|---|------|------------|
| 12 | TM-03: 예약 취소 확인 없음 | 쉬움 |
| 13 | TM-04: 상세 전화번호 미마스킹 | 쉬움 |
| 14 | CO-04: 시술실 담당 선생님 미표시 | 중간 |
| 15 | CO-05: 상태변경 버튼 없음 (드래그만) | 중간 |
| 16 | CO-06: 실시간 서비스/결제 미갱신 | 중간 |
| 17 | CN-03: 분할결제 불가 | 높음 |
| 18 | CN-04: 시술 검색 기능 없음 | 중간 |
| 19 | C-03: activeTab 오류 | 쉬움 |
| 20 | TE-02: 시술 항목 트렁케이트 | 쉬움 |
| 21 | TE-03: 마취 타이머 알림 없음 | 중간 |
| 22 | CL-01: 환불 고객 선택방식 개선 | 중간 |
| 23 | CL-02: 마감 확정 되돌리기 | 중간 |
| 24 | ST-01: 직원 역할 선택 불가 | 쉬움 |
| 25 | ST-02: 직원 수정/비활성화 없음 | 중간 |
| 26 | PA-02: 체크인 로딩 UI 부족 | 쉬움 |
| 27 | PA-05: 체크인 에러 피드백 없음 | 쉬움 |

### P3 — Low (백로그)
| # | 이슈 |
|---|------|
| 28 | TM-05: 슬롯 overflow 상세 보기 |
| 29 | TM-06: 전화번호 형식 검증 |
| 30 | PA-03: 예상 대기시간 표시 |
| 31 | PA-04: 체크인 취소 기능 |
| 32 | TE-01: 시술사 전용 뷰 |
| 33 | ST-03: 주간 배정 복사 기능 |
| 34 | CN-05: 결제 상세 표시 |

---

## 총 발견 이슈: 34건
- Critical: 3건
- High: 8건
- Medium: 16건
- Low: 7건
