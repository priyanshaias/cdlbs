"""Classify DL/CDL nature-of-work wordings into categories and sub-categories."""
import openpyxl, glob, re, collections as C, sys

SRC = sys.argv[1]   # folder with Batch_*.xlsx

# (category, sub-category, pattern) — order matters only for ties at the same text position
SUBS = [
 ('Protection & patrolling', 'Elephant / wildlife conflict', r'poaching duty|depredation|deperdation|hulla|elephant (drive|driving|relocation|management|chas|squad|track|movement)|human.?(wild|elephant|animal)|conflict|\bqrt\b|\bert\b|quick response|wild elephant'),
 ('Protection & patrolling', 'Wildlife rescue & release', r'rescue|release|snake|catch'),
 ('Protection & patrolling', 'Check post / gate', r'check ?post|check ?gate|checkgate|anti.?poach|\bnaka\b|barrier|gate'),
 ('Protection & patrolling', 'Fire / watch tower', r'fire|watch ?tower'),
 ('Protection & patrolling', 'Plantation watch & ward', r'(plantation|pltn|plnt)\.? (watch|protection|guard|ward)|watch(er)? (and|&) ward of (plantation|pltn)|plantation watcher|pltn watcher'),
 ('Protection & patrolling', 'Patrolling & forest protection', r'patrol|petrol|protect|watching|wild ?life (duty|movement)|movement of|leopard|protction|forest guard|watch (and|&) ward|\bward\b|beat (duty|work)|tiger|mangrove|fencing|fence|wls|sanctuary'),
 ('Nursery, plantation & garden', 'Nursery', r'nur+s?e?r+y|nursary|nuesery|seedling|\bbed\b|\bbeds\b'),
 ('Nursery, plantation & garden', 'Plantation work', r'plantation|pltn|plnt|plant\.|planting|seed stand|afforestation|creation'),
 ('Nursery, plantation & garden', 'Garden / park', r'garden|\bpark\b|lawn|\bmali\b|flower|floricultur|horticultur|weeding|arbor|uddyan|udyan'),
 ('Elephant & animal care', 'Mahut', r'mahut|mahout|mahat|kunki|elephant dl|elephant (care|attend|feed)'),
 ('Elephant & animal care', 'Patawala / grass cutter', r'pat+a?w+a?l+a|patuwala|partawala|chara|grass.?cut|fodder'),
 ('Elephant & animal care', 'Zoo / animal keeper', r'zoo|animal keeper|animal house|enclosure|deer|feeding|bird|aviary|aquarium|crocodile'),
 ('Premises & upkeep', 'Night guard / security', r'night|security|secuirity|securit|chowkidar|chowkider|darwan|gun ?m[ae]n|durwan|watchman|watch man|guard|watcher'),
 ('Premises & upkeep', 'Cleaning / sweeping', r'clean|sweep|sweap|house ?keep|scaveng|toilet|jharu|safai'),
 ('Premises & upkeep', 'Timber depot', r'depot|timber|\blog\b|logs'),
 ('Premises & upkeep', 'Rest house / bungalow', r'rest ?house|bungalow|bunglow|\bfrh\b|guest ?house|cook|caretaker|holiday home|lodge|care taker|tourism|tourist|cottage'),
 ('Premises & upkeep', 'Maintenance & utilities', r'lift ?man|drinking water|electric|plumb|pump|carpent|mason|mechanic|repair|maintenance'),
 ('Other specialised work', 'Processing unit / laboratory', r'ayurved|citronella|packag|bottl|processing|laborator|sale centre|oil extraction'),
 ('Other specialised work', 'Extension / JFMC / awareness', r'extension|jfmc|\bshg\b|awareness'),
 ('Office & transport', 'Driver', r'(?<!elephant )driv'),
 ('Office & transport', 'Boat crew', r'boat|launch|sarang|lascar|laskar|khalasi|serang|vessel'),
 ('Office & transport', 'Computer / data entry / accounts', r'computer|data entry|monitoring data|\bmis\b|accounts|budget|tender|hrms|tally|typ(ist|ing)|\bdeo\b|\bdto\b'),
 ('Office & transport', 'Wireless operator', r'wireless|\bwt\b|\bw/t\b|radio'),
 ('Office & transport', 'Office assistant / peon', r'office|offc|contractual assistant|store ?keeper|librar|reception|xerox|docket|despatch|dispatch|wbhs|peon|orderly|clerical|clerk|\bdak\b|record|official|attendant|messenger|\bcamp office'),
]
VAGUE = r'various|variouss|misc|different|general|all type|other|forestry|field|labour|labor|work|duty|assist|helper|worker'
LOW = {'Maintenance & utilities'}
DITTO = r'^(do|d\.o\.?|-do-|ditto|")$'

def norm(s): return re.sub(r'\s+', ' ', str(s or '').replace('\n', ' ')).strip()

def classify(text):
    t = text.lower()
    if not t: return 'Not reported', 'Blank', []
    hits = []
    for cat, sub, p in SUBS:
        m = re.search(p, t)
        if m: hits.append((m.start(), cat, sub))
    # plantation watch also matches plantation work / guard; drop the generic ones it covers
    subs = {h[2] for h in hits}
    if 'Plantation watch & ward' in subs:
        hits = [h for h in hits if h[2] not in ('Plantation work', 'Night guard / security', 'Patrolling & forest protection')]
    if 'Mahut' in subs or 'Patawala / grass cutter' in subs:
        hits = [h for h in hits if h[2] != 'Zoo / animal keeper']
    if any(h[2] not in LOW for h in hits):     # upkeep words only lead when nothing else matched
        hits = [(p + (1000 if h in LOW else 0), c, h) for p, c, h in hits]
    if hits:
        hits.sort()
        seen, out = set(), []
        for _, cat, sub in hits:
            if sub not in seen: seen.add(sub); out.append((cat, sub))
        return out[0][0], out[0][1], [s for _, s in out[1:]]
    if re.search(VAGUE, t): return 'Unclear', 'Vague (e.g. various / misc / field work)', []
    return 'Unclear', 'Not matched', []

def load():
    rows = []
    for f in sorted(glob.glob(SRC + '/Batch_*.xlsx')):
        it = openpyxl.load_workbook(f, read_only=True, data_only=True)['Clean_Data'].iter_rows(values_only=True); h = next(it)
        rows += [dict(zip(h, r)) for r in it if r[0]]
    rows.sort(key=lambda r: r['CR_Row'] or 0)
    prev = {}
    for r in rows:
        raw = norm(r['Work_As_Compiled'])
        r['Raw'] = raw
        if re.match(DITTO, raw.lower()):      # "do" = same as the row above, in the same division
            r['Resolved'] = prev.get(r['Division'], ''); r['Ditto'] = True
        else:
            r['Resolved'] = raw; r['Ditto'] = False
            if raw: prev[r['Division']] = raw
        r['Cat'], r['Sub'], r['Also'] = classify(r['Resolved'])
    return rows

if __name__ == '__main__':
    rows = load()
    print(C.Counter(r['Cat'] for r in rows).most_common())
    print(C.Counter((r['Cat'], r['Sub']) for r in rows).most_common())
    um = C.Counter(r['Resolved'].lower() for r in rows if r['Cat'] == 'Unclear')
    print(len(um)); [print(n, '|', k) for k, n in um.most_common(150)]
