import re, json
from collections import Counter

raw = open('/mnt/user-data/uploads/sam_hr-institutes_com.ics', encoding='utf-8').read()
lines = raw.split('\n'); unfolded=[]
for ln in lines:
    if ln[:1] in (' ','\t'): unfolded[-1]+=ln[1:]
    else: unfolded.append(ln.rstrip('\r'))
events,cur,inalarm=[],None,False
for ln in unfolded:
    if ln=='BEGIN:VEVENT': cur={}; inalarm=False
    elif ln=='END:VEVENT':
        if cur is not None: events.append(cur); cur=None
    elif ln=='BEGIN:VALARM': inalarm=True
    elif ln=='END:VALARM': inalarm=False
    elif cur is not None and not inalarm and ':' in ln:
        k,v=ln.split(':',1); cur[k.split(';')[0]]=v

def date_of(ev):
    m=re.search(r'(\d{8})', ev.get('DTSTART','')); 
    return f"{m.group(1)[:4]}-{m.group(1)[4:6]}-{m.group(1)[6:8]}" if m else None
def unesc(s): return s.replace('\\n','\n').replace('\\,',',').replace('\\;',';')
def pace_to_sec(t): mm,ss=t.split(':'); return int(mm)*60+int(ss)
DASH=r'[–\-]'
RUN_TYPES={'Easy','Medium','Pace Run','Long Run','Tempo','Intervals','Marathon Pace','Race'}

plan=[]
for ev in events:
    s=ev.get('SUMMARY','')
    m=re.match(r'^Wk(\d+)\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*[—]\s*(.+)$', s)
    if not m: continue
    week=int(m.group(1)); wd=m.group(2); rest=m.group(3)
    taper='Taper' in rest; stepback=('Stepback' in rest) or ('↓' in rest)
    base=re.split(r'\s*[—–↓]\s*', rest)[0].strip()        # part before any modifier
    dist=None
    dm=re.search(r'([\d.]+)\s*km', base)
    if dm: dist=float(dm.group(1))
    typ=re.sub(r'^[\d.]+\s*km\s*','',base).strip() or base
    desc=unesc(ev.get('DESCRIPTION',''))
    pace=None
    pm=re.search(r'Pace:\s*(\d+:\d{2})(?:\s*'+DASH+r'\s*(\d+:\d{2}))?\s*/km', desc)
    if pm:
        lo=pace_to_sec(pm.group(1)); hi=pace_to_sec(pm.group(2)) if pm.group(2) else lo
        pace={'min_sec':lo,'max_sec':hi,'display':pm.group(0).replace('Pace:','').strip()}
    hr=None
    hm=re.search(r'HR:\s*(\d+)\s*'+DASH+r'\s*(\d+)\s*bpm', desc)
    if hm: hr={'min':int(hm.group(1)),'max':int(hm.group(2))}
    else:
        hm2=re.search(r'HR[:\s]*([<>]?)\s*(\d+)\s*bpm', desc)
        if hm2: hr={'min':None,'max':int(hm2.group(2))}
    plan.append({'id':f'wk{week}-{wd.lower()}','date':date_of(ev),'week':week,'weekday':wd,
        'type':typ,'is_run':typ in RUN_TYPES,'distance_km':dist,'taper':taper,'stepback':stepback,
        'pace_target':pace,'hr_target':hr,'title':s,'note':desc})

plan=[p for p in plan if p['date']]; plan.sort(key=lambda p:p['date'])
json.dump(plan, open('plan.json','w'), indent=2, ensure_ascii=False)

print("Sessions:",len(plan),"| weeks",plan[0]['week'],"-",plan[-1]['week'],"|",plan[0]['date'],"->",plan[-1]['date'])
print("By type:", dict(Counter(p['type'] for p in plan)))
runs=[p for p in plan if p['is_run']]
print("Runs:",len(runs)," total planned km:",round(sum(p['distance_km'] or 0 for p in runs),1),
      " peak long:",max((p['distance_km'] or 0) for p in runs),"km")
print("Missing pace:",sum(1 for p in runs if not p['pace_target'])," missing hr:",sum(1 for p in runs if not p['hr_target']))
