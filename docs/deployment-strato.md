# Deployment auf dem STRATO VPS Linux S

Ergänzt `deployment.md` (allgemeine Docker-Anleitung) um alles, was für diesen Tarif gilt: 1 vCore, 2 GB RAM, 60 GB NVMe.

## Was getestet ist
Eine echte Collection (5 Routen: 2× AIDA, 3× Mein Schiff) lief lokal im Container mit `--memory 2g --cpus 1` in 116 s durch, ohne OOM-Kill. Spitze laut `docker stats`: ca. 1,33 GiB. Die CPU wird dabei gedrosselt; die Collection dauert etwa 1,6× so lange wie mit 2 CPUs. Mit 1 GB RAM war die App nicht nutzbar.
**Nicht getestet:** der Docker-Build auf dem VPS selbst, ein PDF-Report parallel zu einer Collection, deutlich mehr als 5 Routen.

## Vertrag
- 2 €/Monat für 3 Monate, danach 4 €/Monat, Abrechnung einen Monat im Voraus. Erste Laufzeit: **12 Monate** (im ersten Jahr 42 €).
- **Kündigung einen Monat vor Ende der ersten Laufzeit** (online im Login-Bereich), sonst läuft der Vertrag weiter. Danach jederzeit mit einem Monat Frist.
- Bereitstellung in der Regel innerhalb eines Werktags. Backups sind nicht enthalten (siehe Schritt 8).

## 1. Betriebssystem und SSH
Im STRATO-Kundenbereich Debian 13 oder Ubuntu 24.04 installieren (Wechsel ist kostenlos). Dann einen SSH-Key hinterlegen und anmelden:
```sh
ssh-copy-id root@<VPS-IP>        # einmalig, vom eigenen Rechner
ssh root@<VPS-IP>
```
Optional, wenn der Key funktioniert: in `/etc/ssh/sshd_config` `PasswordAuthentication no` setzen und `systemctl restart ssh`.

## 2. Swap, Docker, Firewall
Auf dem VPS:
```sh
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```
Hat der STRATO-Kundenbereich eine eigene Firewall für den Server, müssen dort 22, 80 und 443 ebenfalls offen sein.

## 3. DNS bei all-inkl
*(Entfällt, wenn Sie die reine VPN-Variante aus Schritt 9 nutzen.)*
KAS > Domain > DNS-Einstellungen: A-Record für die Subdomain (z. B. `kreuzfahrt.deinedomain.de`) auf die IPv4-Adresse des VPS. Prüfen, bevor es weitergeht:
```sh
dig +short kreuzfahrt.deinedomain.de     # muss die VPS-IP liefern
```
Caddy holt das HTTPS-Zertifikat erst, wenn der DNS-Eintrag stimmt und Port 80/443 erreichbar sind.

## 4. Image lokal bauen (empfohlen)
Der Build braucht viel RAM und CPU; auf 1 vCore dauert er lange. Deshalb auf dem eigenen Rechner bauen. Der VPS ist x86-64: **auf einem Apple-Silicon-Mac die Plattform erzwingen**, sonst startet das Image auf dem VPS nicht.
```sh
cd cruise-price
echo 'COMPOSE_PROJECT_NAME=cruise' >> .env     # feste Image- und Volume-Namen (cruise-app, cruise-web, cruise_cruise-data)
DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose build
docker save cruise-app cruise-web | gzip | ssh root@<VPS-IP> 'gunzip | docker load'
```
Das `app`-Image ist ca. 2,9 GB groß; der Upload dauert je nach Leitung einige Minuten. (Die `.dockerignore` im Projekt sorgt dafür, dass das macOS-`node_modules` nicht ins Image kopiert wird.)

## 5. Konfiguration auf den VPS
Der VPS braucht nur drei Dateien, keinen Quellcode:
```sh
ssh root@<VPS-IP> 'mkdir -p /opt/cruise/deploy'
scp docker-compose.yml root@<VPS-IP>:/opt/cruise/
scp deploy/Caddyfile root@<VPS-IP>:/opt/cruise/deploy/
```
Die Anmeldedaten erzeugen Sie **auf Ihrem eigenen Rechner** im Projektordner (nicht auf dem VPS). Das Skript gibt ein zufälliges Passwort, dessen Hash, das Session-Geheimnis und den Schlüssel für die Authenticator-App aus:
```sh
pnpm --filter @cruise/api auth:setup --user dusan --totp
```
Das Passwort wird nur einmal angezeigt und nirgends gespeichert; tragen Sie es in Ihren Passwortmanager ein. (Eigenes Passwort statt eines zufälligen: `--password '…'`, mindestens 12 Zeichen. Ohne `--totp` genügt das Passwort allein.)

`.env` auf dem VPS anlegen (`/opt/cruise/.env`), Vorlage ist `.env.example`; die `AUTH_*`-Zeilen kommen aus der Ausgabe oben:
```
COMPOSE_PROJECT_NAME=cruise
SITE_ADDRESS=kreuzfahrt.deinedomain.de
CRUISE_LANGUAGE=de
AUTH_USER=dusan
AUTH_PASSWORD_HASH=scrypt:16384:8:1:…
AUTH_SESSION_SECRET=…
AUTH_TOTP_SECRET=…
```
Dann `chmod 600 /opt/cruise/.env`. Ohne `AUTH_USER`, `AUTH_PASSWORD_HASH` und `AUTH_SESSION_SECRET` startet der Stack absichtlich nicht (kein versehentlich offener Server).

**Authenticator-App einrichten** (einmalig, mit dem `AUTH_TOTP_SECRET`): Microsoft Authenticator > "+" > "Anderes Konto (Google, Facebook usw.)" > "Oder Code manuell eingeben" > Kontoname "Cruise Price Tracker", Geheimer Schlüssel = der Schlüssel aus der Ausgabe (Leerzeichen sind egal). Ab dann zeigt die App alle 30 Sekunden einen 6-stelligen Code.

## 6. Vorhandene Daten übernehmen
Vom eigenen Rechner ins Docker-Volume (das Volume wird dabei angelegt). Das kopiert auch `data/notifications.json` mit den Zugangsdaten, falls vorhanden, und nie die Lock-Datei:
```sh
COPYFILE_DISABLE=1 tar czf - --exclude=collector.lock --exclude='.DS_Store' -C data . \
  | ssh root@<VPS-IP> 'docker run --rm -i -v cruise_cruise-data:/data alpine tar xzf - -C /data'
```
`COPYFILE_DISABLE=1` ist auf dem Mac nötig: Sonst packt `tar` `._*`-Hilfsdateien ein, und die API antwortet danach mit "Invalid JSON". (Falls das schon passiert ist: `find /data -name '._*' -delete` im Volume.) Ohne diesen Schritt startet die App mit leeren Daten.

## 7. Starten und prüfen
```sh
ssh root@<VPS-IP>
cd /opt/cruise && docker compose up -d --no-build
docker compose ps
docker compose logs -f app          # "API on ... (data: /data, collectors: live)", "Scheduler on ..."
curl https://kreuzfahrt.deinedomain.de/api/health    # {"ok":true,"collectorMode":"live"}  (offen, ohne Login: nur für Überwachung)
curl -s -o /dev/null -w '%{http_code}\n' https://kreuzfahrt.deinedomain.de/api/routes    # muss 401 sein: ohne Login kein Zugriff
```
Im Log steht `sign-in: on + authenticator code`; steht dort `OFF`, ist die Anmeldung nicht aktiv. Danach im Browser `https://kreuzfahrt.deinedomain.de` öffnen (Login-Seite der App), anmelden und eine Route einzeln sammeln lassen, um die erste Collection zu beobachten:
```sh
docker stats cruise-app-1
```

## 8. Backups (STRATO sichert nicht)
Das Volume `cruise_cruise-data` ist der einzige Zustand. Wöchentlich per Cron sichern und das Archiv **vom VPS herunterkopieren**, sonst geht es mit dem Server verloren:
```sh
mkdir -p /root/backups
cat > /etc/cron.d/cruise-backup <<'EOF'
30 3 * * 1 root docker run --rm -v cruise_cruise-data:/data -v /root/backups:/out alpine sh -c 'tar czf /out/cruise-data-$(date +\%F).tar.gz -C /data . && ls -t /out/cruise-data-*.tar.gz | tail -n +9 | xargs -r rm'
EOF
```
Das behält die letzten 8 Archive. Vom eigenen Rechner abholen, z. B.: `rsync -av root@<VPS-IP>:/root/backups/ ~/cruise-backups/`

## 9. Zugriff absichern (nur privat)
Die App meldet Benutzer selbst an (eigene Login-Seite): Alles unter `/api` außer `/api/health` und der Anmeldung selbst verlangt ein Session-Cookie. Die API ist nicht veröffentlicht, nur der Web-Container erreicht sie. Zwei Stufen:

### Stufe 1: öffentlich erreichbar, mit Login (Standard)
**Was die Anmeldung tut:**
- Passwort wird nur als scrypt-Hash gespeichert; Vergleiche laufen zeitkonstant, ein falscher Benutzername dauert genauso lang wie ein falsches Passwort.
- Mit `AUTH_TOTP_SECRET` kommt der **zweite Faktor** dazu: Nach dem Passwort fragt die Seite den 6-stelligen Code aus Microsoft Authenticator (oder jeder anderen TOTP-App). Ein Code gilt nur einmal.
- **Sperre gegen Raten:** 5 falsche Versuche pro Adresse (oder 20 insgesamt) sperren die Anmeldung für 15 Minuten, auch für das richtige Passwort. Die Zähler liegen im Speicher, ein Neustart der App setzt sie zurück.
- Das Session-Cookie ist `HttpOnly`, `SameSite=Strict` und (über HTTPS) `Secure`, gültig 12 Stunden. Schreibende Anfragen von fremden Webseiten werden abgewiesen. Abmelden löscht das Cookie im Browser; eine einzelne Session lässt sich serverseitig nicht widerrufen. Ein neues `AUTH_SESSION_SECRET` meldet alle ab.
- Die Seite selbst (HTML und JavaScript) ist ohne Login abrufbar, zeigt aber nur die Login-Maske; alle Daten kommen über die geschützte API.

**Was Sie tun müssen:**
- Nur HTTPS mit echtem Zertifikat (`SITE_ADDRESS` = Domain, nicht `:80`) und `AUTH_COOKIE_SECURE=1` (Standard), sonst gehen Passwort und Daten im Klartext durch das Netz.
- SSH nur mit Key (Schritt 1) und `ufw limit OpenSSH`. Zusätzlich fail2ban gegen Brute-Force auf SSH:
  ```sh
  apt install -y fail2ban unattended-upgrades
  scp deploy/fail2ban/jail.local root@<VPS-IP>:/etc/fail2ban/jail.local
  ssh root@<VPS-IP> 'systemctl restart fail2ban && fail2ban-client status sshd'
  ```
  4 Fehlversuche in 10 Minuten sperren die Adresse eine Stunde, bei Wiederholung länger (bis zu einer Woche).
- `chmod 600` auf `notifications.json` im Volume: `docker run --rm -v cruise_cruise-data:/data alpine chmod 600 /data/notifications.json`.

**Handy verloren oder Passwort ändern:** Neue Werte mit `pnpm --filter @cruise/api auth:setup --user dusan --totp` erzeugen, die `AUTH_*`-Zeilen in `/opt/cruise/.env` ersetzen und `docker compose up -d --no-build` ausführen. Der SSH-Zugang zum Server ist der Notausgang; sichern Sie deshalb den SSH-Key und die `.env`.

**Getestet:** Unit- und Integrationstests der API (u. a. der RFC-6238-Testvektor für die Codes, Sperre, Cookie-Flags, Replay eines Codes, fremde Origin, ein absichtlich falsch eingetragener Passwort-Hash) und der gesamte Ablauf im echten Browser gegen den lokalen Docker-Stack (falsches Passwort, Code-Schritt, falscher und richtiger Code, Reload, Abmelden, Deep-Link ohne Session). Außerdem geprüft: Ein per `curl` an Caddy mitgeschickter, gefälschter `X-Forwarded-For`-Header wird verworfen (Caddy setzt ihn auf die echte Absenderadresse), die Sperre gegen Raten lässt sich darüber also nicht umgehen; `pnpm audit` findet keine bekannten Schwachstellen in den Abhängigkeiten. **Nicht getestet:** der Betrieb auf dem echten VPS mit HTTPS und die Einrichtung in Microsoft Authenticator selbst (die App verwendet das Standardverfahren; ob die manuelle Eingabe bei Ihnen so heißt, sehen Sie in der App). Eine echte Sicherheitsprüfung (Penetrationstest) gegen die öffentlich erreichbare Instanz ist damit nicht ersetzt.

### Stufe 2: wirklich privat, nur über VPN (empfohlen)
Ein VPN (hier Tailscale, WireGuard-basiert) macht den Server aus dem Internet unsichtbar: 80/443 sind nicht erreichbar, es braucht weder DNS-Eintrag noch Zertifikat. Dann entfällt Schritt 3, und der Login der App bleibt als zweite Schicht. Reihenfolge einhalten, damit Sie sich nicht aussperren:

1. **Tailscale installieren** (Account anlegen, Konditionen des kostenlosen Tarifs selbst prüfen):
   ```sh
   curl -fsSL https://tailscale.com/install.sh | sh
   tailscale up
   tailscale ip -4          # z. B. 100.64.12.34
   ```
   Auf Laptop und Handy die Tailscale-App installieren und mit demselben Account anmelden. Prüfen: `ssh root@100.64.12.34` muss vom Laptop funktionieren.
2. **App nur an die VPN-Adresse binden.** In `/opt/cruise/.env`:
   ```
   BIND_IP=100.64.12.34
   SITE_ADDRESS=:80
   AUTH_COOKIE_SECURE=0
   ```
   `:80` genügt, weil das VPN den Verkehr schon verschlüsselt (der Browser zeigt "nicht sicher" an). `AUTH_COOKIE_SECURE=0` ist nötig, weil ein `Secure`-Cookie über HTTP nicht gesendet wird. Neu starten: `cd /opt/cruise && docker compose up -d --no-build`.
   **Wichtig:** Docker veröffentlicht Ports vorbei an `ufw`. Eine ufw-Regel allein schließt 80/443 *nicht*; erst `BIND_IP` tut das.
3. **Docker erst nach Tailscale starten**, sonst scheitert der Port nach einem Neustart, weil die VPN-Adresse noch fehlt:
   ```sh
   systemctl edit docker
   ```
   ```
   [Unit]
   After=tailscaled.service
   Wants=tailscaled.service
   ```
4. **Firewall:** öffentliche Webports schließen. SSH erst einschränken, wenn Schritt 1 sicher klappt (Notausgang: VNC-Konsole im STRATO-Kundenbereich):
   ```sh
   ufw delete allow 80 && ufw delete allow 443
   ufw allow in on tailscale0 to any port 22 && ufw delete allow OpenSSH     # SSH nur noch über das VPN
   ```
5. **Aufrufen:** `http://100.64.12.34` (oder der Tailscale-Rechnername) vom Laptop/Handy mit Tailscale.
6. **Von außen prüfen** (ohne VPN, z. B. mobil im Funknetz): `curl -m 5 http://<öffentliche VPS-IP>` muss in einen Timeout laufen.

Nicht getestet: Tailscale selbst und das Zusammenspiel mit `BIND_IP` auf dem echten VPS; die Compose-Datei ist nur mit `docker compose config` geprüft. Die ausgehenden Meldungen der App (Benachrichtigungen) und die Collections funktionieren unabhängig vom VPN.

## Betrieb
- **Update:** lokal neu bauen (Schritt 4: `build`, `save | ssh ... load`), dann auf dem VPS `cd /opt/cruise && docker compose up -d --no-build`. Die Daten im Volume bleiben erhalten.
- **Logs:** `docker compose logs -f app`.
- **Uhrzeit:** Der Scheduler sammelt standardmäßig täglich um 07:00 in der Zeitzone des Containers (UTC), also 08:00 oder 09:00 deutscher Zeit. Ändern mit `COLLECT_CRON` (siehe Kommentar in `docker-compose.yml`).
- **Speicher:** `mem_limit` im `docker-compose.yml` steht auf 1536m. Das reichte im Test (ca. 1,33 GiB Spitze), aber mit wenig Reserve. Bei Abstürzen oder `OOMKilled` (`docker inspect cruise-app-1 --format '{{.State.OOMKilled}}'`) auf `1800m` erhöhen; der Swap fängt Spitzen ab.
- **Nur eine Collection gleichzeitig:** Ein manueller Lauf während der Scheduler arbeitet wird mit einer Meldung abgelehnt (Lock). Auf 1 vCore trotzdem nicht mehrere Läufe oder Reports parallel anstoßen.
- **AIDA:** Öffnet einen sichtbaren Chromium auf einem virtuellen Display (xvfb). Ob AIDA eine Rechenzentrums-IP akzeptiert, zeigt sich erst im Betrieb; die App umgeht keine Bot-Erkennung.
- **Crypto-Mining** ist auf der Strato-Plattform untersagt (betrifft die App nicht).
