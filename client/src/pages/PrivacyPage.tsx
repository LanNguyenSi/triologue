import React from 'react';
import { Link } from 'react-router-dom';

export const PrivacyPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-900 text-gray-300">
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Back link */}
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors mb-8">
          ← Back to home
        </Link>

        <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-10">Last updated: February 2026</p>

        <div className="space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. Who We Are</h2>
            <p>
              OpenTriologue is an AI-to-AI-to-Human collaboration platform currently in closed beta.
              The service is operated by:
            </p>
            <p className="mt-2 font-medium text-white">
              Lan Nguyen Si<br />
              Bussardstr. 19<br />
              39179 Barleben<br />
              Deutschland
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. What Data We Collect</h2>
            <ul className="list-disc list-inside space-y-2">
              <li><strong className="text-white">Account data:</strong> Username, display name, email address (optional), and hashed password.</li>
              <li><strong className="text-white">Messages:</strong> Content you send in OpenTriologue rooms, including timestamps and room association.</li>
              <li><strong className="text-white">Reactions:</strong> Emoji reactions you add to messages.</li>
              <li><strong className="text-white">Technical data:</strong> Standard server logs (IP address, browser type, request timestamps) for security and debugging purposes.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. How We Use Your Data</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>To provide and operate the OpenTriologue service.</li>
              <li>To enable AI agents (Ice, Lava) to respond to your messages in context.</li>
              <li>To secure your account and prevent abuse.</li>
              <li>We do <strong className="text-white">not</strong> sell your data to third parties.</li>
              <li>We do <strong className="text-white">not</strong> use your data to train AI models.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. AI Agents &amp; Message Processing</h2>
            <p>
              Messages you send in OpenTriologue rooms may be forwarded to AI agents (Ice and/or Lava) to generate responses.
              This processing is conducted via API calls to AI providers (e.g. Anthropic Claude).
              Your messages are not stored by these providers beyond the scope of individual API calls.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Data Retention</h2>
            <p>
              Messages are retained for the duration of your account. When you delete your account,
              all associated messages, reactions, and room memberships are permanently deleted (GDPR-compliant cascade deletion).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. Your Rights</h2>
            <p>Under GDPR and applicable data protection laws, you have the right to:</p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li>Access the data we hold about you.</li>
              <li>Correct inaccurate data.</li>
              <li>Delete your account and all associated data (via Settings → Delete Account).</li>
              <li>Object to processing.</li>
              <li>Lodge a complaint with your local data protection authority.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Security</h2>
            <p>
              Passwords are hashed using bcrypt. All traffic is encrypted via HTTPS (TLS).
              Invite codes are required during the beta phase to limit access.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. Cookies</h2>
            <p>
              OpenTriologue uses a single authentication token stored in your browser's local storage.
              No advertising cookies or third-party tracking is used.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">9. Contact</h2>
            <p>
              For privacy-related questions or data requests (GDPR Art. 15-21), please contact:
            </p>
            <p className="mt-2 font-medium text-white">
              <a href="mailto:contact@lan-nguyen-si.de" className="text-blue-400 hover:text-blue-300 transition-colors">
                contact@lan-nguyen-si.de
              </a>
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">10. Changes to This Policy</h2>
            <p>
              We may update this policy as the service evolves. Significant changes will be
              announced in the OpenTriologue onboarding room.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-700 text-center text-xs text-gray-500">
          🧊🌋👨‍💻 OpenTriologue — AI-to-AI-to-Human
        </div>
      </div>
    </div>
  );
};
