# arc42 -- Projekt "CivicFlow Mini"

## 1. Einfuehrung
CivicFlow Mini ist ein Microservice fuer kommunale Foerderantraege. Buerger reichen Antraege ein, Sachbearbeitung prueft und entscheidet.

### Qualitaetsziele
1. Nachvollziehbarkeit (Audit-Trail fuer jede Statusaenderung)
2. Testbarkeit (Domain-Logik ohne Framework testbar)
3. Sicherheit (keine Fachlogik in Controllern)

## 2. Randbedingungen
- Symfony 7 (PHP 8.3)
- PostgreSQL, Doctrine ORM
- Docker Compose fuer lokale Entwicklung
- JWT-Authentifizierung

## 3. Kontextabgrenzung
- Browser -> Symfony API -> PostgreSQL
- Symfony API -> Mail-Service (SMTP)

## 4. Loesungsstrategie
- Schichtung: Controller -> Application -> Domain -> Infrastructure
- Domain ist framework-unabhaengig
- DDD light: Module nach Fachlichkeit

## 5. Bausteine

### Domain-Module
- **Antrag**: Einreichung, Statusverwaltung (eingereicht -> in_pruefung -> bewilligt | abgelehnt | nachforderung)
- **Audit**: Jede Statusaenderung erzeugt einen Audit-Eintrag

### Statusuebergaenge
```
eingereicht -> in_pruefung
in_pruefung -> bewilligt
in_pruefung -> abgelehnt
in_pruefung -> nachforderung
nachforderung -> in_pruefung
```

Ungueltige Uebergaenge (z.B. eingereicht -> bewilligt) muessen eine Exception werfen.

## 6. Laufzeitsicht

### Antrag einreichen
1. POST /api/antraege mit Antragsdaten
2. Validierung, Status = "eingereicht"
3. Audit-Eintrag erzeugen

### Antrag pruefen
1. PATCH /api/antraege/{id}/status mit neuem Status
2. Statusuebergang validieren
3. Audit-Eintrag erzeugen
4. Bei "nachforderung": Benachrichtigung ausloesen

## 7. Verteilung
- API-Container (Symfony)
- PostgreSQL-Container
- MailHog-Container (lokaler Mail-Test)

## 8. Querschnittlich

### Tests
- Unit-Tests fuer Domain (Statusuebergaenge, Audit)
- Integrationstests fuer Repositories
- API-Tests fuer Endpunkte

### Sicherheit
- Keine Business-Logik in Controllern
- Keine produktiven Secrets in Containern
- Sicherheitskritische Aenderungen brauchen Review

### Entwicklungsworkflow
- Feature-Branches, PR-Pflicht
- AI-Unterstuetzung nur im Rahmen von project.md und agents.md
