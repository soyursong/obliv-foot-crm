#!/usr/bin/env python3
"""Setup massive dummy data for 200-300 patient/day UX test via Supabase RPC."""

import json
import random
import requests

SUPABASE_URL = "https://izegeboamrcczhhvghwo.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6ZWdlYm9hbXJjY3poaHZnaHdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NDEwNzksImV4cCI6MjA5MTIxNzA3OX0.wabOikJ9RlHUo_tzGAqnsr3s2hB654lfbasego3skHQ"
CLINIC_ID = "42574098-b0c1-49fb-9db6-02b9311041c0"
TODAY = "2026-04-10"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

def rpc_query(sql):
    """Execute SELECT via ose_query, returns parsed JSON."""
    r = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/ose_query",
                      headers=HEADERS,
                      json={"query_text": sql})
    return r.json()

def rpc_exec(sql):
    """Execute INSERT/UPDATE/DELETE via ose_execute."""
    r = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/ose_execute",
                      headers=HEADERS,
                      json={"query_text": sql})
    return r.json()

def query_json(sql):
    """Query returning JSON array via json_agg."""
    result = rpc_query(f"SELECT json_agg(row_to_json(t)) FROM ({sql}) t")
    return result if isinstance(result, list) else []

# == CLEAN ==
print("=== Cleaning today's data ===")
rpc_exec(f"DELETE FROM check_in_services WHERE check_in_id IN (SELECT id FROM check_ins WHERE clinic_id = '{CLINIC_ID}' AND created_date = '{TODAY}')")
rpc_exec(f"DELETE FROM payments WHERE check_in_id IN (SELECT id FROM check_ins WHERE clinic_id = '{CLINIC_ID}' AND created_date = '{TODAY}')")
rpc_exec(f"DELETE FROM check_ins WHERE clinic_id = '{CLINIC_ID}' AND created_date = '{TODAY}'")
rpc_exec(f"DELETE FROM reservations WHERE clinic_id = '{CLINIC_ID}' AND reservation_date = '{TODAY}'")
rpc_exec(f"DELETE FROM room_assignments WHERE clinic_id = '{CLINIC_ID}' AND work_date = '{TODAY}'")
print("  Cleaned.")

# == STAFF ==
print("=== Staff ===")
staff_count = rpc_query(f"SELECT count(*) FROM staff WHERE clinic_id = '{CLINIC_ID}' AND active = true")
print(f"  Existing staff count: {staff_count}")
if isinstance(staff_count, (int, float)) and staff_count < 5:
    rpc_exec(f"""
    INSERT INTO staff (clinic_id, name, role, active) VALUES
    ('{CLINIC_ID}', '김원장', 'doctor', true),
    ('{CLINIC_ID}', '박실장', 'manager', true),
    ('{CLINIC_ID}', '이코디', 'coordinator', true),
    ('{CLINIC_ID}', '최코디', 'coordinator', true),
    ('{CLINIC_ID}', '정시술A', 'practitioner', true),
    ('{CLINIC_ID}', '한시술B', 'practitioner', true),
    ('{CLINIC_ID}', '강시술C', 'practitioner', true),
    ('{CLINIC_ID}', '유시술D', 'practitioner', true),
    ('{CLINIC_ID}', '조시술E', 'practitioner', true),
    ('{CLINIC_ID}', '배TM', 'tm', true),
    ('{CLINIC_ID}', '윤TM', 'tm', true),
    ('{CLINIC_ID}', '서데스크', 'desk', true)
    """)
    print("  Created 12 staff")

staff = query_json(f"SELECT id, name, role FROM staff WHERE clinic_id = '{CLINIC_ID}' AND active = true ORDER BY role, name")
print(f"  Total staff: {len(staff)}")

# == CUSTOMERS (60) ==
print("=== Customers ===")
LASTNAMES = ["김","이","박","최","정","강","조","윤","장","임","한","오","서","신","권","황","안","송","류","홍"]
FIRSTNAMES = ["수현","민지","서연","지원","하은","예린","다영","유진","소희","미라","현아","지수","보라","나연","채원","은서","혜진","수빈","아름","진아"]

existing_count = rpc_query(f"SELECT count(*) FROM customers WHERE clinic_id = '{CLINIC_ID}'")
print(f"  Existing: {existing_count}")

need = 60 - (existing_count if isinstance(existing_count, int) else 0)
if need > 0:
    values = []
    for i in range(need):
        idx = (existing_count if isinstance(existing_count, int) else 0) + i
        name = LASTNAMES[idx % 20] + FIRSTNAMES[(idx // 3) % 20]
        phone = f"010{1000+idx:04d}{2000+idx*7:04d}"
        values.append(f"('{CLINIC_ID}', '{name}', '{phone}')")
    # Insert in batches of 20
    for batch_start in range(0, len(values), 20):
        batch = values[batch_start:batch_start+20]
        sql = f"INSERT INTO customers (clinic_id, name, phone) VALUES {','.join(batch)}"
        rpc_exec(sql)
    print(f"  Created {need} customers")

customers = query_json(f"SELECT id, name, phone FROM customers WHERE clinic_id = '{CLINIC_ID}' ORDER BY created_at LIMIT 60")
print(f"  Total: {len(customers)}")

# == SERVICES ==
services = query_json(f"SELECT id, name, price FROM services WHERE clinic_id = '{CLINIC_ID}' AND active = true ORDER BY sort_order")
print(f"Services: {len(services)}")

# == RESERVATIONS (35 today) ==
print("=== Reservations ===")
TIMES = ["10:00","10:30","11:00","11:30","12:00","13:00","13:30","14:00","14:30","15:00",
         "15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00"]
SOURCES = ["naver","instagram","friend","blog","youtube","kakao","walk_in"]

res_values = []
for i in range(35):
    cust = customers[i % len(customers)]
    svc = services[i % len(services)]
    time = TIMES[i % len(TIMES)]
    src = SOURCES[i % len(SOURCES)]
    status = "reserved" if i < 25 else ("checked_in" if i < 30 else "no_show")
    res_values.append(
        f"('{CLINIC_ID}', '{cust['id']}', '{svc['id']}', '{TODAY}', '{time}', '{status}', '{src}')"
    )

for batch_start in range(0, len(res_values), 15):
    batch = res_values[batch_start:batch_start+15]
    sql = f"INSERT INTO reservations (clinic_id, customer_id, service_id, reservation_date, reservation_time, status, referral_source) VALUES {','.join(batch)}"
    rpc_exec(sql)
print(f"  Created {len(res_values)} reservations")

# == CHECK-INS (25) ==
print("=== Check-ins ===")
STATUS_DIST = (
    [("waiting", "NULL")] * 6 +
    [("consultation", "1"), ("consultation", "2"), ("consultation", "3")] +
    [("treatment_waiting", "NULL")] * 3 +
    [("treatment", "1"), ("treatment", "2"), ("treatment", "3"), ("treatment", "4"),
     ("treatment", "5"), ("treatment", "6"), ("treatment", "7"), ("treatment", "8")] +
    [("payment_waiting", "NULL")] * 3 +
    [("done", "NULL")] * 2
)

ci_values = []
for i, (status, room) in enumerate(STATUS_DIST):
    cust = customers[i]
    q = i + 1
    src = SOURCES[i % len(SOURCES)]
    hour = 9 + i // 5
    minute = (i * 7) % 60

    checked_in = f"2026-04-10 {hour:02d}:{minute:02d}:00+09"

    called = "NULL"
    anesth = "NULL"
    completed = "NULL"
    if status != "waiting":
        called = f"'2026-04-10 {hour:02d}:{(minute+10)%60:02d}:00+09'"
    if status in ("treatment", "payment_waiting", "done"):
        anesth = f"'2026-04-10 {hour:02d}:{(minute+20)%60:02d}:00+09'"
    if status == "done":
        completed = f"'2026-04-10 {(hour+1):02d}:{(minute+40)%60:02d}:00+09'"

    # Escape single quotes in names
    name = cust['name'].replace("'", "''")
    phone = cust['phone'].replace("'", "''")

    ci_values.append(
        f"('{CLINIC_ID}', '{cust['id']}', '{name}', '{phone}', {q}, '{status}', "
        f"'{checked_in}', {called}, {anesth}, {completed}, {room}, '{src}', '{TODAY}')"
    )

sql = f"""INSERT INTO check_ins
    (clinic_id, customer_id, customer_name, customer_phone, queue_number, status,
     checked_in_at, called_at, anesthesia_at, completed_at, room_number, referral_source, created_date)
    VALUES {','.join(ci_values)}"""
rpc_exec(sql)
print(f"  Created {len(ci_values)} check-ins")

# Get check-in IDs for services
ci_ids = query_json(f"SELECT id, customer_name FROM check_ins WHERE clinic_id = '{CLINIC_ID}' AND created_date = '{TODAY}' ORDER BY queue_number")
print(f"  Verified: {len(ci_ids)} check-ins in DB")

# == CHECK-IN SERVICES ==
print("=== Check-in Services ===")
svc_values = []
for i, ci in enumerate(ci_ids):
    svc = services[i % len(services)]
    price = random.choice([154000, 220000, 250000, 350000, 500000])
    svc_name = svc['name'].replace("'", "''")
    svc_values.append(f"('{ci['id']}', '{svc['id']}', '{svc_name}', {price})")
    if i % 4 == 0 and len(services) > 1:
        svc2 = services[(i + 3) % len(services)]
        price2 = random.choice([154000, 220000, 250000])
        svc2_name = svc2['name'].replace("'", "''")
        svc_values.append(f"('{ci['id']}', '{svc2['id']}', '{svc2_name}', {price2})")

for batch_start in range(0, len(svc_values), 15):
    batch = svc_values[batch_start:batch_start+15]
    sql = f"INSERT INTO check_in_services (check_in_id, service_id, service_name, price) VALUES {','.join(batch)}"
    rpc_exec(sql)
print(f"  Created {len(svc_values)} services on check-ins")

# == ROOM ASSIGNMENTS ==
print("=== Room Assignments ===")
practitioners = [s for s in staff if s['role'] == 'practitioner']
managers = [s for s in staff if s['role'] in ('manager', 'doctor')]

ra_values = []
for i, prac in enumerate(practitioners):
    for j in range(3):
        room_num = i * 3 + j + 1
        if room_num > 15:
            break
        ra_values.append(f"('{CLINIC_ID}', '{prac['id']}', {room_num}, 'treatment', '{TODAY}')")

for i, mgr in enumerate(managers):
    if i >= 3:
        break
    ra_values.append(f"('{CLINIC_ID}', '{mgr['id']}', {i+1}, 'consultation', '{TODAY}')")

sql = f"INSERT INTO room_assignments (clinic_id, staff_id, room_number, room_type, work_date) VALUES {','.join(ra_values)}"
rpc_exec(sql)
print(f"  Created {len(ra_values)} room assignments")

# == SUMMARY ==
print("\n=== SETUP COMPLETE ===")
summary = query_json(f"""
    SELECT status, count(*) as cnt
    FROM check_ins
    WHERE clinic_id = '{CLINIC_ID}' AND created_date = '{TODAY}'
    GROUP BY status ORDER BY status
""")
for s in summary:
    print(f"  {s['status']}: {s['cnt']}")

res_summary = query_json(f"""
    SELECT status, count(*) as cnt
    FROM reservations
    WHERE clinic_id = '{CLINIC_ID}' AND reservation_date = '{TODAY}'
    GROUP BY status ORDER BY status
""")
print("Reservations:")
for s in res_summary:
    print(f"  {s['status']}: {s['cnt']}")
