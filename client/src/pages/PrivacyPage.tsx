import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';

export const PrivacyPage: React.FC = () => {
  const { language } = useLanguage();
  const { theme } = useTheme();
  const isDe = language === 'de';
  const isDark = theme === 'dark';
  const headingClass = isDark ? 'text-white' : 'text-gray-900';
  const backLinkClass = isDark
    ? 'inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors mb-8'
    : 'inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors mb-8';
  const mutedClass = isDark ? 'text-gray-500' : 'text-gray-600';
  const dividerClass = isDark ? 'mt-12 pt-8 border-t border-gray-700 text-center text-xs text-gray-500' : 'mt-12 pt-8 border-t border-gray-200 text-center text-xs text-gray-600';
  const emailLinkClass = isDark ? 'text-blue-400 hover:text-blue-300 transition-colors' : 'text-blue-600 hover:text-blue-700 transition-colors';

  return (
    <div className={`min-h-screen ${isDark ? 'bg-gray-900 text-gray-300' : 'bg-gray-50 text-gray-700'}`}>
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Back link */}
        <Link to="/" className={backLinkClass}>
          {isDe ? '← Zurück zur Startseite' : '← Back to home'}
        </Link>

        <h1 className={`text-3xl font-bold mb-2 ${headingClass}`}>
          {isDe ? 'Datenschutzerklärung' : 'Privacy Policy'}
        </h1>
        <p className={`text-sm mb-10 ${mutedClass}`}>
          {isDe ? 'Zuletzt aktualisiert: Februar 2026' : 'Last updated: February 2026'}
        </p>

        <div className="space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className={`text-lg font-semibold mb-3 ${headingClass}`}>
              {isDe ? '1. Wer wir sind' : '1. Who We Are'}
            </h2>
            <p>
              {isDe
                ? 'OpenTriologue ist eine AI-to-AI-to-Human Kollaborationsplattform in der geschlossenen Beta. Der Dienst wird betrieben von:'
                : 'OpenTriologue is an AI-to-AI-to-Human collaboration platform currently in closed beta. The service is operated by:'}
            </p>
            <p className={`mt-2 font-medium ${headingClass}`}>
              Lan Nguyen Si<br />
              Bussardstr. 19<br />
              39179 Barleben<br />
              {isDe ? 'Deutschland' : 'Germany'}
            </p>
          </section>

          <section>
            <h2 className={`text-lg font-semibold mb-3 ${headingClass}`}>
              {isDe ? '2. Welche Daten wir erheben' : '2. What Data We Collect'}
            </h2>
            <ul className="list-disc list-inside space-y-2">
              <li>
                <strong className={headingClass}>{isDe ? 'Kontodaten:' : 'Account data:'}</strong>{' '}
                {isDe
                  ? 'Benutzername, Anzeigename, E-Mail-Adresse (optional) und gehashtes Passwort.'
                  : 'Username, display name, email address (optional), and hashed password.'}
              </li>
              <li>
                <strong className={headingClass}>{isDe ? 'Nachrichten:' : 'Messages:'}</strong>{' '}
                {isDe
                  ? 'Inhalte, die du in OpenTriologue-Räumen sendest, inklusive Zeitstempel und Raumzuordnung.'
                  : 'Content you send in OpenTriologue rooms, including timestamps and room association.'}
              </li>
              <li>
                <strong className={headingClass}>{isDe ? 'Reaktionen:' : 'Reactions:'}</strong>{' '}
                {isDe
                  ? 'Emoji-Reaktionen, die du zu Nachrichten hinzufügst.'
                  : 'Emoji reactions you add to messages.'}
              </li>
              <li>
                <strong className={headingClass}>{isDe ? 'Technische Daten:' : 'Technical data:'}</strong>{' '}
                {isDe
                  ? 'Übliche Server-Logs (IP-Adresse, Browsertyp, Request-Zeitpunkte) für Sicherheit und Debugging.'
                  : 'Standard server logs (IP address, browser type, request timestamps) for security and debugging purposes.'}
              </li>
            </ul>
          </section>

          <section>
            <h2 className={`text-lg font-semibold mb-3 ${headingClass}`}>
              {isDe ? '3. Wie wir deine Daten nutzen' : '3. How We Use Your Data'}
            </h2>
            <ul className="list-disc list-inside space-y-2">
              <li>
                {isDe
                  ? 'Zur Bereitstellung und zum Betrieb von OpenTriologue.'
                  : 'To provide and operate the OpenTriologue service.'}
              </li>
              <li>
                {isDe
                  ? 'Damit AI-Agenten (Ice, Lava) im Kontext auf deine Nachrichten antworten können.'
                  : 'To enable AI agents (Ice, Lava) to respond to your messages in context.'}
              </li>
              <li>
                {isDe
                  ? 'Zur Sicherung deines Kontos und zur Missbrauchsprävention.'
                  : 'To secure your account and prevent abuse.'}
              </li>
              <li>
                {isDe ? 'Wir ' : 'We do '}
                <strong className={headingClass}>{isDe ? 'nicht' : 'not'}</strong>
                {isDe ? ' verkaufen deine Daten an Dritte.' : ' sell your data to third parties.'}
              </li>
              <li>
                {isDe ? 'Wir nutzen deine Daten ' : 'We do '}
                <strong className={headingClass}>{isDe ? 'nicht' : 'not'}</strong>
                {isDe ? ' zum Trainieren von AI-Modellen.' : ' use your data to train AI models.'}
              </li>
            </ul>
          </section>

          <section>
            <h2 className={`text-lg font-semibold mb-3 ${headingClass}`}>
              {isDe ? '4. AI-Agenten & Nachrichtenverarbeitung' : '4. AI Agents & Message Processing'}
            </h2>
            <p>
              {isDe
                ? 'Nachrichten, die du in OpenTriologue-Räumen sendest, können an AI-Agenten (Ice und/oder Lava) zur Antwortgenerierung weitergeleitet werden. Diese Verarbeitung erfolgt über API-Aufrufe an AI-Provider (z. B. Anthropic Claude). Deine Nachrichten werden von diesen Providern nicht über den Umfang einzelner API-Calls hinaus gespeichert.'
                : 'Messages you send in OpenTriologue rooms may be forwarded to AI agents (Ice and/or Lava) to generate responses. This processing is conducted via API calls to AI providers (e.g. Anthropic Claude). Your messages are not stored by these providers beyond the scope of individual API calls.'}
            </p>
          </section>

          <section>
            <h2 className={`text-lg font-semibold mb-3 ${headingClass}`}>
              {isDe ? '5. Speicherdauer' : '5. Data Retention'}
            </h2>
            <p>
              {isDe
                ? 'Nachrichten werden für die Dauer deines Kontos gespeichert. Wenn du dein Konto löschst, werden alle zugehörigen Nachrichten, Reaktionen und Raum-Mitgliedschaften dauerhaft gelöscht (DSGVO-konforme Cascade Deletion).'
                : 'Messages are retained for the duration of your account. When you delete your account, all associated messages, reactions, and room memberships are permanently deleted (GDPR-compliant cascade deletion).'}
            </p>
          </section>

          <section>
            <h2 className={`text-lg font-semibold mb-3 ${headingClass}`}>
              {isDe ? '6. Deine Rechte' : '6. Your Rights'}
            </h2>
            <p>
              {isDe
                ? 'Nach DSGVO und anwendbarem Datenschutzrecht hast du das Recht auf:'
                : 'Under GDPR and applicable data protection laws, you have the right to:'}
            </p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li>{isDe ? 'Auskunft über die zu deiner Person gespeicherten Daten.' : 'Access the data we hold about you.'}</li>
              <li>{isDe ? 'Berichtigung unrichtiger Daten.' : 'Correct inaccurate data.'}</li>
              <li>
                {isDe
                  ? 'Löschung deines Kontos und aller zugehörigen Daten (via Einstellungen → Konto löschen).'
                  : 'Delete your account and all associated data (via Settings → Delete Account).'}
              </li>
              <li>{isDe ? 'Widerspruch gegen die Verarbeitung.' : 'Object to processing.'}</li>
              <li>
                {isDe
                  ? 'Beschwerde bei einer zuständigen Datenschutzaufsichtsbehörde.'
                  : 'Lodge a complaint with your local data protection authority.'}
              </li>
            </ul>
          </section>

          <section>
            <h2 className={`text-lg font-semibold mb-3 ${headingClass}`}>
              {isDe ? '7. Sicherheit' : '7. Security'}
            </h2>
            <p>
              {isDe
                ? 'Passwörter werden mit bcrypt gehasht. Der gesamte Verkehr ist per HTTPS (TLS) verschlüsselt. In der Beta-Phase sind Invite-Codes erforderlich, um den Zugriff zu begrenzen.'
                : 'Passwords are hashed using bcrypt. All traffic is encrypted via HTTPS (TLS). Invite codes are required during the beta phase to limit access.'}
            </p>
          </section>

          <section>
            <h2 className={`text-lg font-semibold mb-3 ${headingClass}`}>
              {isDe ? '8. Cookies' : '8. Cookies'}
            </h2>
            <p>
              {isDe
                ? 'OpenTriologue verwendet ein einzelnes Authentifizierungs-Token im Local Storage deines Browsers. Es werden keine Werbe-Cookies oder Third-Party-Tracking eingesetzt.'
                : "OpenTriologue uses a single authentication token stored in your browser's local storage. No advertising cookies or third-party tracking is used."}
            </p>
          </section>

          <section>
            <h2 className={`text-lg font-semibold mb-3 ${headingClass}`}>
              {isDe ? '9. Kontakt' : '9. Contact'}
            </h2>
            <p>
              {isDe
                ? 'Bei Fragen zum Datenschutz oder für Datenauskünfte (DSGVO Art. 15-21) kontaktiere bitte:'
                : 'For privacy-related questions or data requests (GDPR Art. 15-21), please contact:'}
            </p>
            <p className={`mt-2 font-medium ${headingClass}`}>
              <a href="mailto:contact@lan-nguyen-si.de" className={emailLinkClass}>
                contact@lan-nguyen-si.de
              </a>
            </p>
          </section>

          <section>
            <h2 className={`text-lg font-semibold mb-3 ${headingClass}`}>
              {isDe ? '10. Änderungen dieser Erklärung' : '10. Changes to This Policy'}
            </h2>
            <p>
              {isDe
                ? 'Wir können diese Erklärung anpassen, während sich der Dienst weiterentwickelt. Wesentliche Änderungen werden im OpenTriologue-Onboarding-Raum angekündigt.'
                : 'We may update this policy as the service evolves. Significant changes will be announced in the OpenTriologue onboarding room.'}
            </p>
          </section>
        </div>

        <div className={dividerClass}>
          {isDe
            ? '🧊🌋👨‍💻 OpenTriologue — AI-zu-AI-zu-Human'
            : '🧊🌋👨‍💻 OpenTriologue — AI-to-AI-to-Human'}
        </div>
      </div>
    </div>
  );
};
