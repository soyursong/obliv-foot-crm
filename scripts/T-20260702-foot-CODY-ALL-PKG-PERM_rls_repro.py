import json,urllib.request,os
REF="rxlomoozakkjesdqjtvd"; TOK=os.environ["SUPABASE_ACCESS_TOKEN"]
def runq(sql):
    req=urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query":sql}).encode(),
        headers={"Authorization":f"Bearer {TOK}","Content-Type":"application/json","User-Agent":"curl/8.4.0"},method="POST")
    try:
        urllib.request.urlopen(req).read(); return "PASS (write allowed, rolled back)"
    except urllib.error.HTTPError as e:
        m=e.read().decode()
        try: m=json.loads(m).get("message",m)
        except: pass
        return "FAIL -> "+m.replace("\n"," ")[:300]
UID_JMK="77ef3500-f0c1-43de-9c3b-1072b7a2713c"   # 김민경 no-staff
UID_JJH="f953b4f4-c28a-4ba9-90b7-1542f73c3f91"   # 김지혜 has-staff
CI="74b174d0-3b8c-4bb1-a4db-e3a55cca1e89"; CLINIC="74967aea-a60b-4da3-a0e7-9c997a930bc8"; CUST="536259c2-e311-499a-af37-aadd0cc63f4b"; TMPL="a97a74f6-8c87-47dd-9519-e7e277179899"
def wrap(uid,body):
    claim="request.j"+"wt.claims"
    return (f"begin; select set_config('role','authenticated',true);"
            f" select set_config('{claim}',json_build_object('sub','{uid}')::text,true);"
            f" {body}; rollback;")
steps={
 "S1_packages_INSERT": f"insert into packages (clinic_id,customer_id,package_name,package_type,template_id,total_sessions,heated_sessions,heated_unit_price,unheated_sessions,unheated_unit_price,iv_sessions,iv_unit_price,podologe_sessions,podologe_unit_price,trial_sessions,trial_unit_price,preconditioning_sessions,shot_upgrade,af_upgrade,upgrade_surcharge,total_amount,paid_amount,status,contract_date) values ('{CLINIC}','{CUST}','SIM','template','{TMPL}',12,1,0,11,0,0,0,0,0,0,0,0,false,false,0,2960000,2960000,'active',current_date)",
 "S2_package_payments_INSERT": f"insert into package_payments (clinic_id,package_id,customer_id,amount,method,memo,payment_type) select '{CLINIC}',id,'{CUST}',2960000,'card','SIM','payment' from packages limit 1",
 "S3_payments_INSERT(회수1/단건)": f"insert into payments (clinic_id,check_in_id,customer_id,amount,method,payment_type) values ('{CLINIC}','{CI}','{CUST}',100000,'card','payment')",
 "S4_check_ins_UPDATE_pkgid": f"update check_ins set package_id=(select id from packages limit 1) where id='{CI}'",
 "S5_check_ins_UPDATE_status_done": f"update check_ins set status='done' where id='{CI}'",
 "S6_status_transitions_INSERT": f"insert into status_transitions (check_in_id,clinic_id,from_status,to_status) values ('{CI}','{CLINIC}','payment_waiting','done')",
}
for label,uid in [("김민경(NO staff)",UID_JMK),("김지혜(HAS staff)",UID_JJH)]:
    print("############",label,"############")
    for name,body in steps.items():
        print(f"  {name:38s}: {runq(wrap(uid,body))}")
    print()

print("=== unapproved/inactive coordinator (김연희) ===")
UID_KYH="d4c83d20-e8d6-4918-97ce-2cce68d444ae"
for name,body in list(steps.items())[:1]:
    print(f"  {name:38s}: {runq(wrap(UID_KYH,body))}")
