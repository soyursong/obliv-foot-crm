#!/bin/bash
# Setup massive dummy data for 200-300 patient/day scenario
# Clinic: 종로 롱래스팅센터 (42574098-b0c1-49fb-9db6-02b9311041c0)

SUPABASE_URL="https://izegeboamrcczhhvghwo.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6ZWdlYm9hbXJjY3poaHZnaHdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NDEwNzksImV4cCI6MjA5MTIxNzA3OX0.wabOikJ9RlHUo_tzGAqnsr3s2hB654lfbasego3skHQ"
CLINIC_ID="42574098-b0c1-49fb-9db6-02b9311041c0"
TODAY="2026-04-10"

rpc_exec() {
  curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/ose_execute" \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"query_text\": \"$1\"}"
}

rest_post() {
  local table="$1"
  local data="$2"
  curl -s -X POST "$SUPABASE_URL/rest/v1/$table" \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d "$data"
}

echo "=== Step 1: Create Staff ==="
STAFF_DATA='[
  {"clinic_id":"'$CLINIC_ID'","name":"김원장","role":"doctor","active":true},
  {"clinic_id":"'$CLINIC_ID'","name":"박실장","role":"manager","active":true},
  {"clinic_id":"'$CLINIC_ID'","name":"이코디","role":"coordinator","active":true},
  {"clinic_id":"'$CLINIC_ID'","name":"최코디","role":"coordinator","active":true},
  {"clinic_id":"'$CLINIC_ID'","name":"정시술","role":"practitioner","active":true},
  {"clinic_id":"'$CLINIC_ID'","name":"한시술","role":"practitioner","active":true},
  {"clinic_id":"'$CLINIC_ID'","name":"강시술","role":"practitioner","active":true},
  {"clinic_id":"'$CLINIC_ID'","name":"유시술","role":"practitioner","active":true},
  {"clinic_id":"'$CLINIC_ID'","name":"조시술","role":"practitioner","active":true},
  {"clinic_id":"'$CLINIC_ID'","name":"배TM","role":"tm","active":true},
  {"clinic_id":"'$CLINIC_ID'","name":"윤TM","role":"tm","active":true},
  {"clinic_id":"'$CLINIC_ID'","name":"서데스크","role":"desk","active":true}
]'
STAFF_RESULT=$(rest_post "staff" "$STAFF_DATA")
echo "$STAFF_RESULT" | python3 -c "import sys,json; data=json.load(sys.stdin); print(f'Created {len(data)} staff')"

echo "=== Step 2: Create 60 Customers ==="
# Korean family names and given names for realistic data
CUSTOMERS='['
for i in $(seq 1 60); do
  LASTNAMES=("김" "이" "박" "최" "정" "강" "조" "윤" "장" "임" "한" "오" "서" "신" "권" "황" "안" "송" "류" "홍")
  FIRSTNAMES=("수현" "민지" "서연" "지원" "하은" "예린" "다영" "유진" "소희" "미라" "현아" "지수" "보라" "나연" "채원" "은서" "혜진" "수빈" "아름" "진아")
  LN_IDX=$(( (i - 1) % 20 ))
  FN_IDX=$(( (i - 1) / 3 % 20 ))
  NAME="${LASTNAMES[$LN_IDX]}${FIRSTNAMES[$FN_IDX]}"
  PHONE="010$(printf '%04d' $((1000 + i)))$(printf '%04d' $((2000 + i * 7)))"

  if [ $i -gt 1 ]; then CUSTOMERS="$CUSTOMERS,"; fi
  CUSTOMERS="$CUSTOMERS{\"clinic_id\":\"$CLINIC_ID\",\"name\":\"$NAME\",\"phone\":\"$PHONE\"}"
done
CUSTOMERS="$CUSTOMERS]"

CUST_RESULT=$(rest_post "customers" "$CUSTOMERS")
echo "$CUST_RESULT" | python3 -c "import sys,json; data=json.load(sys.stdin); print(f'Created {len(data)} customers')" 2>/dev/null || echo "Customer creation done"

echo "=== Step 3: Create Reservations (35 for today) ==="
# Get customer IDs
CUST_IDS=$(curl -s "$SUPABASE_URL/rest/v1/customers?clinic_id=eq.$CLINIC_ID&select=id&limit=60" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY")

SERVICE_IDS=$(curl -s "$SUPABASE_URL/rest/v1/services?clinic_id=eq.$CLINIC_ID&select=id&active=eq.true" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY")

# Parse IDs into arrays
CIDS=$(echo "$CUST_IDS" | python3 -c "import sys,json; [print(c['id']) for c in json.load(sys.stdin)]")
SIDS=$(echo "$SERVICE_IDS" | python3 -c "import sys,json; [print(s['id']) for s in json.load(sys.stdin)]")

readarray -t CUST_ARR <<< "$CIDS"
readarray -t SVC_ARR <<< "$SIDS"

TIMES=("10:00" "10:30" "11:00" "11:30" "12:00" "13:00" "13:30" "14:00" "14:30" "15:00" "15:30" "16:00" "16:30" "17:00" "17:30" "18:00" "18:30" "19:00" "19:30" "20:00")
SOURCES=("naver" "instagram" "friend" "blog" "youtube" "kakao" "walk_in")

RESERVATIONS='['
for i in $(seq 0 34); do
  CID="${CUST_ARR[$i]}"
  SID="${SVC_ARR[$(( i % ${#SVC_ARR[@]} ))]}"
  TIME="${TIMES[$(( i % ${#TIMES[@]} ))]}"
  SRC="${SOURCES[$(( i % ${#SOURCES[@]} ))]}"

  # Mix statuses: 25 reserved, 5 checked_in, 5 no_show
  if [ $i -lt 25 ]; then
    STATUS="reserved"
  elif [ $i -lt 30 ]; then
    STATUS="checked_in"
  else
    STATUS="no_show"
  fi

  if [ $i -gt 0 ]; then RESERVATIONS="$RESERVATIONS,"; fi
  RESERVATIONS="$RESERVATIONS{\"clinic_id\":\"$CLINIC_ID\",\"customer_id\":\"$CID\",\"service_id\":\"$SID\",\"reservation_date\":\"$TODAY\",\"reservation_time\":\"$TIME\",\"status\":\"$STATUS\",\"referral_source\":\"$SRC\"}"
done
RESERVATIONS="$RESERVATIONS]"

RES_RESULT=$(rest_post "reservations" "$RESERVATIONS")
echo "$RES_RESULT" | python3 -c "import sys,json; data=json.load(sys.stdin); print(f'Created {len(data)} reservations')" 2>/dev/null || echo "Reservation creation done"

echo "=== Step 4: Create Check-ins (25 in various states) ==="
# Create check-ins representing a busy mid-day scenario
# Status distribution: 6 waiting, 3 consultation, 3 treatment_waiting, 8 treatment, 3 payment_waiting, 2 done

STATUSES=("waiting" "waiting" "waiting" "waiting" "waiting" "waiting" "consultation" "consultation" "consultation" "treatment_waiting" "treatment_waiting" "treatment_waiting" "treatment" "treatment" "treatment" "treatment" "treatment" "treatment" "treatment" "treatment" "payment_waiting" "payment_waiting" "payment_waiting" "done" "done")
ROOMS=(0 0 0 0 0 0 1 2 3 0 0 0 1 2 3 4 5 6 7 8 0 0 0 0 0)

CHECKINS='['
for i in $(seq 0 24); do
  CID="${CUST_ARR[$i]}"
  CUST_INFO=$(curl -s "$SUPABASE_URL/rest/v1/customers?id=eq.$CID&select=name,phone" \
    -H "apikey: $SUPABASE_KEY" \
    -H "Authorization: Bearer $SUPABASE_KEY")
  CNAME=$(echo "$CUST_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['name'])")
  CPHONE=$(echo "$CUST_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['phone'])")

  STATUS="${STATUSES[$i]}"
  ROOM="${ROOMS[$i]}"
  QNUM=$(( i + 1 ))
  SRC="${SOURCES[$(( i % ${#SOURCES[@]} ))]}"

  # Timestamps based on status
  CHECKED_IN="2026-04-10T$(printf '%02d' $(( 9 + i / 5 ))):$(printf '%02d' $(( (i * 7) % 60 ))):00+09:00"

  CALLED_AT="null"
  ANESTHESIA_AT="null"
  COMPLETED_AT="null"

  if [ "$STATUS" != "waiting" ]; then
    CALLED_AT="\"2026-04-10T$(printf '%02d' $(( 9 + i / 5 ))):$(printf '%02d' $(( (i * 7 + 10) % 60 ))):00+09:00\""
  fi
  if [ "$STATUS" = "treatment" ] || [ "$STATUS" = "payment_waiting" ] || [ "$STATUS" = "done" ]; then
    ANESTHESIA_AT="\"2026-04-10T$(printf '%02d' $(( 9 + i / 5 ))):$(printf '%02d' $(( (i * 7 + 20) % 60 ))):00+09:00\""
  fi
  if [ "$STATUS" = "done" ]; then
    COMPLETED_AT="\"2026-04-10T$(printf '%02d' $(( 10 + i / 5 ))):$(printf '%02d' $(( (i * 7 + 40) % 60 ))):00+09:00\""
  fi

  ROOM_VAL="null"
  if [ "$ROOM" -gt 0 ]; then
    ROOM_VAL="$ROOM"
  fi

  if [ $i -gt 0 ]; then CHECKINS="$CHECKINS,"; fi
  CHECKINS="$CHECKINS{\"clinic_id\":\"$CLINIC_ID\",\"customer_id\":\"$CID\",\"customer_name\":\"$CNAME\",\"customer_phone\":\"$CPHONE\",\"queue_number\":$QNUM,\"status\":\"$STATUS\",\"checked_in_at\":\"$CHECKED_IN\",\"called_at\":$CALLED_AT,\"anesthesia_at\":$ANESTHESIA_AT,\"completed_at\":$COMPLETED_AT,\"room_number\":$ROOM_VAL,\"referral_source\":\"$SRC\",\"created_date\":\"$TODAY\"}"
done
CHECKINS="$CHECKINS]"

CI_RESULT=$(rest_post "check_ins" "$CHECKINS")
echo "$CI_RESULT" | python3 -c "import sys,json; data=json.load(sys.stdin); print(f'Created {len(data)} check-ins')" 2>/dev/null || echo "Check-in creation done"

echo "=== Step 5: Create Room Assignments ==="
# Get staff IDs
STAFF_IDS=$(curl -s "$SUPABASE_URL/rest/v1/staff?clinic_id=eq.$CLINIC_ID&select=id,name,role" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY")

echo "Staff: $STAFF_IDS" | python3 -c "import sys,json; [print(f'{s[\"name\"]} ({s[\"role\"]})') for s in json.load(sys.stdin)]" 2>/dev/null

# Assign practitioners to treatment rooms
PRACTITIONERS=$(echo "$STAFF_IDS" | python3 -c "
import sys,json
staff = json.load(sys.stdin)
pracs = [s for s in staff if s['role'] == 'practitioner']
for p in pracs:
    print(p['id'])
")
readarray -t PRAC_ARR <<< "$PRACTITIONERS"

MANAGERS=$(echo "$STAFF_IDS" | python3 -c "
import sys,json
staff = json.load(sys.stdin)
mgrs = [s for s in staff if s['role'] in ('manager', 'doctor')]
for m in mgrs:
    print(m['id'])
")
readarray -t MGR_ARR <<< "$MANAGERS"

ASSIGNMENTS='['
FIRST=true
# Assign practitioners to treatment rooms 1-10
for i in $(seq 0 $(( ${#PRAC_ARR[@]} - 1 ))); do
  ROOMS_PER_PRAC=$((3))
  for j in $(seq 0 $(( ROOMS_PER_PRAC - 1 ))); do
    ROOM_NUM=$(( i * ROOMS_PER_PRAC + j + 1 ))
    if [ $ROOM_NUM -gt 15 ]; then break; fi
    if [ "$FIRST" = "true" ]; then FIRST=false; else ASSIGNMENTS="$ASSIGNMENTS,"; fi
    ASSIGNMENTS="$ASSIGNMENTS{\"clinic_id\":\"$CLINIC_ID\",\"staff_id\":\"${PRAC_ARR[$i]}\",\"room_number\":$ROOM_NUM,\"room_type\":\"treatment\",\"work_date\":\"$TODAY\"}"
  done
done

# Assign managers to consultation rooms
for i in $(seq 0 $(( ${#MGR_ARR[@]} - 1 ))); do
  CONS_ROOM=$(( i + 1 ))
  if [ $CONS_ROOM -gt 3 ]; then break; fi
  ASSIGNMENTS="$ASSIGNMENTS,{\"clinic_id\":\"$CLINIC_ID\",\"staff_id\":\"${MGR_ARR[$i]}\",\"room_number\":$CONS_ROOM,\"room_type\":\"consultation\",\"work_date\":\"$TODAY\"}"
done

ASSIGNMENTS="$ASSIGNMENTS]"

RA_RESULT=$(rest_post "room_assignments" "$ASSIGNMENTS")
echo "$RA_RESULT" | python3 -c "import sys,json; data=json.load(sys.stdin); print(f'Created {len(data)} room assignments')" 2>/dev/null || echo "Room assignment done"

echo "=== Setup Complete ==="
echo "Created: 12 staff, 60 customers, 35 reservations, 25 check-ins, room assignments"
