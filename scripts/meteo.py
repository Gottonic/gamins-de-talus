"""Météo de la station MeteoSwiss Fribourg / Posieux (GRA), la plus proche de Marly.
Télécharge les valeurs journalières (données ouvertes MeteoSwiss, OGD) et écrit meteo/posieux.json :
évapotranspiration de référence FAO (ET0, mm), pluie (mm, 0-0 UTC), températures min / max.
Lancé chaque jour par .github/workflows/meteo.yml. Les jours déjà connus sont gardés (2 ans glissants)."""
import csv, io, json, os, sys, urllib.request, datetime

STATION = 'gra'
BASE = f'https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/{STATION}/ogd-smn_{STATION}_d_'
SORTIE = os.path.join(os.path.dirname(__file__), '..', 'meteo', 'posieux.json')
CHAMPS = {'et0': 'erefaod0', 'pluie': 'rka150d0', 'tmin': 'tre200dn', 'tmax': 'tre200dx'}


def lire(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'gamins-de-talus-meteo (github.com/gottonic/gamins-de-talus)'})
    with urllib.request.urlopen(req, timeout=120) as r:
        brut = r.read()
    for enc in ('utf-8-sig', 'cp1252', 'latin-1'):
        try:
            return brut.decode(enc)
        except UnicodeDecodeError:
            continue
    return brut.decode('latin-1', 'replace')


def date_iso(s):
    s = s.strip()
    for f in ('%d.%m.%Y %H:%M', '%d.%m.%Y', '%Y-%m-%d %H:%M', '%Y-%m-%dT%H:%M:%SZ', '%Y-%m-%d', '%Y%m%d'):
        try:
            return datetime.datetime.strptime(s, f).date().isoformat()
        except ValueError:
            continue
    return None


def nombre(v):
    v = (v or '').strip()
    if v in ('', '-', 'NA', 'nan'):
        return None
    try:
        return round(float(v.replace(',', '.')), 2)
    except ValueError:
        return None


def parser(texte):
    sep = ';' if texte.count(';') > texte.count(',') else ','
    lignes = csv.reader(io.StringIO(texte), delimiter=sep)
    tete = [h.strip().lower() for h in next(lignes)]
    col_date = next((i for i, h in enumerate(tete) if 'reference_timestamp' in h or h in ('time', 'date')), 1)
    idx = {k: (tete.index(v) if v in tete else None) for k, v in CHAMPS.items()}
    if idx['et0'] is None:
        print('Colonnes trouvées :', tete[:40], file=sys.stderr)
        raise SystemExit("Colonne erefaod0 (ET0) absente : format MeteoSwiss changé ?")
    jours = {}
    for l in lignes:
        if len(l) <= col_date:
            continue
        d = date_iso(l[col_date])
        if not d:
            continue
        jours[d] = {k: (nombre(l[i]) if i is not None and i < len(l) else None) for k, i in idx.items()}
    return jours


def main():
    jours = {}
    if os.path.exists(SORTIE):
        with open(SORTIE, encoding='utf-8') as f:
            ancien = json.load(f)
        for d, et0, pluie, tmin, tmax in ancien.get('jours', []):
            jours[d] = {'et0': et0, 'pluie': pluie, 'tmin': tmin, 'tmax': tmax}
    debut = (datetime.date.today() - datetime.timedelta(days=730)).isoformat()
    if not jours or min(jours) > debut:
        try:
            jours.update(parser(lire(BASE + 'historical.csv')))  # une seule fois : l'historique (gros fichier)
        except Exception as e:
            print('Historique non lu :', e, file=sys.stderr)
    jours.update(parser(lire(BASE + 'recent.csv')))
    garde = sorted(d for d in jours if d >= debut)
    out = {
        'station': 'GRA', 'nom': 'Fribourg / Posieux', 'source': 'MeteoSwiss, données ouvertes (OGD)',
        'unites': {'et0': 'mm (ET0 FAO)', 'pluie': 'mm (0-0 UTC)', 'tmin': '°C', 'tmax': '°C'},
        'maj': datetime.datetime.utcnow().replace(microsecond=0).isoformat() + 'Z',
        'jours': [[d, jours[d]['et0'], jours[d]['pluie'], jours[d]['tmin'], jours[d]['tmax']] for d in garde],
    }
    os.makedirs(os.path.dirname(SORTIE), exist_ok=True)
    with open(SORTIE, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f"{len(garde)} jours, dernier : {garde[-1] if garde else '—'}")


if __name__ == '__main__':
    main()
