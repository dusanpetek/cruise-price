import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { t } from '@/lib/i18n';

export const LEGAL_PATHS = ['/impressum', '/datenschutz'] as const;

/** Contact address of the operator, set at build time (VITE_LEGAL_EMAIL). */
const CONTACT_EMAIL = (import.meta.env.VITE_LEGAL_EMAIL as string | undefined)?.trim();

const H2 = ({ children }: { children: ReactNode }) => <h2 className="mt-6 text-base font-semibold">{children}</h2>;
const P = ({ children }: { children: ReactNode }) => <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</p>;

function Impressum() {
  return (
    <>
      <h1 className="text-xl font-semibold">Impressum</h1>
      <H2>Private Seite, kein öffentliches Angebot</H2>
      <P>
        Der Kreuzfahrt-Preisradar ist eine rein private Website für einen geschlossenen Kreis aus Freunden und Bekannten. Sie richtet sich nicht an die Öffentlichkeit und wird weder geschäftsmäßig noch gegen Entgelt betrieben. Ein Zugang ist nur mit
        persönlichen Zugangsdaten des Betreibers möglich; eine freie Registrierung gibt es nicht. Eine Anbieterkennzeichnung nach § 5 DDG ist daher nicht erforderlich.
      </P>
      <H2>Kontakt</H2>
      <P>
        {CONTACT_EMAIL ? (
          <>
            E-Mail:{' '}
            <a className="text-primary underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          </>
        ) : (
          'Kontakt über den Betreiber, von dem du deine Zugangsdaten erhalten hast.'
        )}
      </P>

      <h1 className="mt-10 text-xl font-semibold">Haftungsausschluss</h1>
      <H2>Private, unentgeltliche Bereitstellung</H2>
      <P>
        Der Kreuzfahrt-Preisradar ist ein privates, nicht kommerzielles Hobbyprojekt, das unentgeltlich und ohne Gewinnerzielungsabsicht für einen geschlossenen Nutzerkreis betrieben wird. Es werden keine Werbung geschaltet und keine Waren oder
        Leistungen verkauft.
      </P>
      <H2>Kein Anspruch auf Nutzung</H2>
      <P>
        Es besteht kein Anspruch auf Nutzung, Verfügbarkeit, Funktionsumfang oder Fortbestand des Dienstes. Der Betreiber kann den Dienst, einzelne Funktionen oder einzelne Konten jederzeit und ohne Angabe von Gründen ändern, einschränken, sperren,
        löschen oder ganz einstellen. Es wird keine bestimmte Verfügbarkeit, Datensicherung oder Datenhaltung zugesichert; Preisverläufe, Routen und Alarme können jederzeit verloren gehen.
      </P>
      <H2>Haftung für Inhalte und Funktion</H2>
      <P>
        Der Dienst wird „wie besehen“ bereitgestellt. Für die Richtigkeit der erfassten Preise, Prognosen und Kaufempfehlungen sowie für die Fehlerfreiheit und Sicherheit der Software wird keine Gewähr übernommen; Preise sind vor einer Buchung beim
        jeweiligen Anbieter zu prüfen. Die Haftung des Betreibers ist auf Vorsatz und grobe Fahrlässigkeit beschränkt. Unberührt bleibt die Haftung für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit sowie nach zwingenden
        gesetzlichen Vorschriften. Bei einfacher Fahrlässigkeit haftet der Betreiber nur bei Verletzung wesentlicher Vertragspflichten und dort begrenzt auf den vorhersehbaren, typischen Schaden; dies gilt nicht, soweit eine unentgeltliche Überlassung
        eine weitergehende Haftungsbeschränkung zulässt.
      </P>
      <H2>Nutzerinhalte</H2>
      <P>
        Routen, Bezeichnungen und sonstige Eingaben stammen von den Nutzern. Der Betreiber macht sich diese nicht zu eigen und prüft sie nicht vorab. Nutzer verpflichten sich, keine rechtswidrigen, beleidigenden oder fremde Rechte verletzenden Inhalte
        einzugeben. Hinweise auf rechtswidrige Inhalte bitte direkt an den Betreiber; sie werden zeitnah geprüft und Inhalte bei Berechtigung entfernt.
      </P>
      <H2>Externe Links</H2>
      <P>Für Inhalte externer Seiten, auf die ggf. verlinkt wird, sind ausschließlich deren Betreiber verantwortlich. Zum Zeitpunkt der Verlinkung waren keine Rechtsverstöße erkennbar.</P>
      <H2>Urheberrecht</H2>
      <P>
        Namen, Marken und Logos der Reedereien und Buchungsportale gehören ihren jeweiligen Rechteinhabern. Der Kreuzfahrt-Preisradar ist ein unabhängiges Hilfsmittel zur Beobachtung von Preisen und steht in keiner Verbindung zu diesen Unternehmen.
      </P>
    </>
  );
}

function Datenschutz() {
  const li = (label: string, text: string) => (
    <li className="mt-1">
      <b className="font-semibold text-foreground">{label}</b> {text}
    </li>
  );
  return (
    <>
      <h1 className="text-xl font-semibold">Datenschutz</h1>
      <H2>Verantwortlicher</H2>
      <P>Verantwortlich ist der private Betreiber dieser Seite (Kontakt siehe Impressum).</P>
      <H2>Welche Daten verarbeitet werden</H2>
      <ul className="mt-2 list-disc pl-5 text-sm leading-relaxed text-muted-foreground">
        {li('Konto:', 'Benutzername und Passwort (nur als Hash); bei aktivierter Zwei-Faktor-Anmeldung zusätzlich das Geheimnis für den Authenticator-Code.')}
        {li('Nutzungsdaten:', 'Routen, Suchparameter, erfasste Preise und Alarme. Alle angemeldeten Nutzer dieser Installation können diese Daten sehen.')}
        {li('Server-Logs:', 'IP-Adresse, Zeitpunkt und aufgerufene Adresse werden aus Sicherheitsgründen kurzzeitig protokolliert.')}
      </ul>
      <P>
        Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Bereitstellung des Dienstes) sowie lit. f (Sicherheit und Stabilität des Betriebs). Es werden keine Cookies zu Tracking- oder Werbezwecken gesetzt und keine Analyse- oder Werbedienste eingebunden.
        Technisch notwendige Daten (das Anmelde-Cookie der Sitzung sowie Spracheinstellung und Design im Browser) werden lokal gespeichert.
      </P>
      <H2>Weitergabe</H2>
      <P>Eine Weitergabe an Dritte erfolgt nicht, außer an den Hosting-Anbieter als Auftragsverarbeiter. Die Preise werden von den öffentlichen Seiten der Anbieter abgerufen; dabei werden keine personenbezogenen Daten der Nutzer übermittelt.</P>
      <H2>Speicherdauer und Rechte</H2>
      <P>
        Daten werden gespeichert, solange das Konto besteht. Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch sowie auf Beschwerde bei einer Datenschutz-Aufsichtsbehörde. Für die Löschung des
        Kontos genügt eine Nachricht an den Betreiber.
      </P>
    </>
  );
}

/** Impressum / Datenschutz: German only (legal text), reachable without signing in. */
export default function LegalPage({ page }: { page: (typeof LEGAL_PATHS)[number] }) {
  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="legal-back">
        <ArrowLeft size={14} /> {t('Back')}
      </Link>
      <main className="mt-4">{page === '/impressum' ? <Impressum /> : <Datenschutz />}</main>
    </div>
  );
}
