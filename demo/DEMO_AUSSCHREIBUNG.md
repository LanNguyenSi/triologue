# Demo 2: Ausschreibungsscreening mit Memory

## Konzept
Agent bekommt eine fiktive Ausschreibung und gleicht sie mit "Memory" ab — gespeichertes Wissen über publicplan-Kompetenzen, vergangene Projekte, Teamkapazitäten.

---

## Fiktive Ausschreibung

**Öffentliche Ausschreibung — Vergabenummer: 2026-NRW-DIG-0847**

**Auftraggeber:** Land Nordrhein-Westfalen, Ministerium für Digitalisierung
**Verfahrensart:** Offenes Verfahren nach VgV
**Veröffentlicht:** 05.03.2026
**Angebotsfrist:** 15.04.2026

### Leistungsbeschreibung

**Titel:** Entwicklung und Einführung einer KI-gestützten Antragsplattform für Fördermittel

**Beschreibung:**
Das Ministerium für Digitalisierung des Landes NRW sucht einen Dienstleister für die Konzeption, Entwicklung und den Betrieb einer digitalen Plattform zur KI-gestützten Bearbeitung von Fördermittelanträgen.

**Leistungsumfang:**
1. Konzeption und UX-Design einer barrierefreien Web-Anwendung (BITV 2.0)
2. Entwicklung des Backends inkl. Schnittstellen zu bestehenden Fachverfahren (XFörd, ZÜPAS)
3. Integration von KI-Komponenten zur automatisierten Vorprüfung von Anträgen
4. Vollständigkeitsprüfung eingreichter Dokumente mittels NLP/OCR
5. Pilotbetrieb (6 Monate) inkl. Schulung von 50 Sachbearbeitern
6. Hosting auf BSI-konformer Infrastruktur (Deutschland)
7. Wartung und Support (12 Monate nach Go-Live)

**Technische Anforderungen:**
- Open-Source-Technologien bevorzugt
- RESTful API Architektur
- DSGVO-konforme Datenverarbeitung
- Barrierefreiheit nach BITV 2.0 / WCAG 2.1 AA
- BSI IT-Grundschutz kompatibel

**Eignungskriterien:**
- Mind. 3 Referenzprojekte im öffentlichen Sektor (letzte 5 Jahre)
- Erfahrung mit KI/ML im Verwaltungskontext
- Mind. 5 Mitarbeiter mit relevanter Qualifikation
- Zertifizierung nach ISO 27001 oder gleichwertig
- Umsatz > 2 Mio. EUR (letzte 3 Geschäftsjahre)

**Zuschlagskriterien:**
- Qualität des Konzepts: 50%
- Preis: 30%
- Projektteam und Referenzen: 20%

**Geschätztes Volumen:** 800.000 – 1.200.000 EUR
**Vertragslaufzeit:** 24 Monate (inkl. Pilotbetrieb + Wartung)

---

## Fiktive Memory-Daten (vorher in Triologue anlegen oder per Chat "füttern")

### Memory 1: publicplan Firmenprofil
```
publicplan GmbH — Firmenprofil
- GovTech-Unternehmen, Düsseldorf + Berlin
- ~120 Mitarbeiter, Umsatz ~12 Mio. EUR
- Schwerpunkt: Digitalisierung öffentliche Verwaltung
- Kernprodukte: Open-Source-Portallösungen (Liferay, Drupal), 
  E-Government-Plattformen, Bürgerservice-Apps
- Zertifizierungen: ISO 27001 ✅
- Technologie-Stack: PHP, Java, React, TypeScript, Docker, Kubernetes
- AI-Kompetenz: Aufbauend (internes AI-Team seit Q1 2026)
```

### Memory 2: Referenzprojekte
```
Referenzprojekte öffentlicher Sektor:

1. Stadt Köln — Digitales Bürgerportal (2024-2025)
   Budget: 650.000€, 14 Monate
   Stack: Liferay, React, REST APIs
   Ergebnis: 180.000 registrierte Nutzer, BITV 2.0 konform

2. Land Hessen — Förderportal Digitalisierung (2023-2024)
   Budget: 420.000€, 10 Monate
   Stack: Drupal, Vue.js, ElasticSearch
   Ergebnis: 12.000 Anträge verarbeitet, 40% schnellere Bearbeitung

3. Bundesagentur für Arbeit — Internes Wissensportal (2024-2025)
   Budget: 380.000€, 8 Monate
   Stack: React, Node.js, PostgreSQL
   Ergebnis: 5.000 Mitarbeiter nutzen es täglich

4. Stadt München — OZG-Umsetzung Baugenehmigungen (2025)
   Budget: 290.000€, 6 Monate
   Stack: Java, Angular, XBau-Schnittstelle
   Ergebnis: Bearbeitungszeit -35%

5. Kreis Mettmann — Digitale Antragsplattform (2025-2026)
   Budget: 180.000€, laufend
   Stack: React, TypeScript, REST, OCR-Integration
   Ergebnis: Pilotphase, erste OCR-Ergebnisse vielversprechend
```

### Memory 3: Team-Kapazitäten
```
Aktuelle Kapazitäten und Auslastung:

Abteilung Softwareentwicklung (Julia, Direktorin):
- 24 Entwickler (12 Senior, 8 Mid, 4 Junior)
- Auslastung Q2 2026: ~80%
- Freie Kapazität: ~4-5 Entwickler ab April
- AI/ML Kompetenz: 3 Entwickler mit Erfahrung (NLP, LLM-Integration)

Abteilung Client Services (Gregor, Direktor):
- 8 Projektmanager, 6 Consultants
- UX-Team: 3 Designer (BITV 2.0 zertifiziert)
- Auslastung Q2: ~75%
- Freie PM-Kapazität: 1-2 PMs ab April

Besondere Qualifikationen:
- 2 Mitarbeiter: BSI IT-Grundschutz Practitioner
- 4 Mitarbeiter: ISTQB Certified Tester
- 1 Mitarbeiter: KI in der Verwaltung (Weiterbildung 2025)
```

---

## Chat-Anweisung (Live tippen):

```
@ice Wir haben eine neue Ausschreibung erhalten. Bitte analysiere sie und gib eine Empfehlung ab: Sollen wir uns bewerben?

Berücksichtige dabei unser Firmenprofil, unsere Referenzprojekte und unsere aktuellen Kapazitäten aus dem Memory.

Bewerte auf einer Skala von 1-10:
- Fachliche Eignung
- Kapazitätsverfügbarkeit  
- Strategische Relevanz
- Gewinnwahrscheinlichkeit

Hier die Ausschreibung:
[Ausschreibungstext einfügen]
```

---

## Erwartetes Agent-Ergebnis (ungefähr):

### Ausschreibungsanalyse: 2026-NRW-DIG-0847

**Gesamtempfehlung: GO ✅ (Score: 7.5/10)**

**Fachliche Eignung: 8/10**
- ✅ Referenzprojekte: 5 Projekte im öffentlichen Sektor (Anforderung: 3) 
- ✅ ISO 27001 vorhanden
- ✅ Umsatz 12 Mio. > 2 Mio. Anforderung
- ✅ Open-Source-Erfahrung (Liferay, Drupal, React)
- ⚠️ KI/ML-Erfahrung: aufbauend, nicht etabliert — 3 Entwickler mit Erfahrung, aber kein großes KI-Referenzprojekt
- ⚠️ XFörd/ZÜPAS-Schnittstellen: Keine direkte Erfahrung, aber XBau-Erfahrung (München) übertragbar

**Kapazitätsverfügbarkeit: 7/10**
- ✅ 4-5 Entwickler ab April verfügbar
- ✅ 1-2 PMs frei
- ✅ UX-Team mit BITV 2.0 Zertifizierung
- ⚠️ Projekt braucht geschätzt 6-8 Entwickler → Engpass möglich ab Q3
- ⚠️ BSI-Grundschutz: Nur 2 Practitioners — Aufstockung empfohlen

**Strategische Relevanz: 9/10**
- ✅ NRW = Kernmarkt für publicplan
- ✅ KI-gestützte Verwaltung = Zukunftsthema (passt zu AI-Strategie)
- ✅ Volumen 800K-1,2M = signifikanter Auftrag
- ✅ Fördermittel-Plattform = Referenz für ähnliche Projekte bundesweit
- ✅ OpenTriologue könnte als interne KI-Komponente einfließen

**Gewinnwahrscheinlichkeit: 6/10**
- ✅ Starke Referenzen (5 Projekte, davon 1 Förderportal in Hessen)
- ✅ Hessen-Referenz ist direkt übertragbar
- ⚠️ KI-Kompetenz als Schwachpunkt ggü. spezialisierten KI-Firmen
- ⚠️ Preiskriterium 30% — publicplan eher Premium-Segment
- 💡 Empfehlung: Partnerschaft mit KI-Spezialist erwägen (Konsortium)

**Red Flags:**
- ❌ Keine: Alle formalen Eignungskriterien erfüllt

**Nächste Schritte:**
1. Go-Entscheidung in GL-Runde bestätigen
2. Projektteam zusammenstellen (Julia: 6 Devs + 3 KI-Devs)
3. KI-Partner evaluieren (Konsortium für NLP/OCR-Komponente)
4. Konzeptentwurf starten (Hessen-Projekt als Basis)
5. Angebotsabgabe bis 10.04. (5 Tage Puffer vor Frist)

---

## Warum diese Demo die GL überzeugt:

1. **Stefan:** "Das ist genau das Ausschreibungsscreening das ich meinte!"
2. **Gregor:** Sieht seine Referenzprojekte im Einsatz
3. **Julia:** Agent kennt ihre Teamkapazitäten
4. **Lara:** Strukturierte Go/No-Go Entscheidung spart Stunden
5. **Christian:** Strategische Bewertung auf Knopfdruck
6. **Kai:** Sieht wie Memory-System echten Mehrwert liefert
7. **Christian H.:** "Das können wir für Kundenprojekte auch bauen"

**Killer-Moment:** Agent empfiehlt OpenTriologue als KI-Komponente für das Angebot → Meta-Beweis
