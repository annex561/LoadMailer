// Public Privacy Policy. Required for A2P 10DLC TCR campaign approval —
// must be reachable without login at /privacy and must describe SMS consent,
// opt-out keywords, message frequency, and data sharing.
export default function PrivacyPolicy() {
  const lastUpdated = "April 29, 2026";
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="max-w-3xl mx-auto px-6 py-12 leading-relaxed">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-slate-500 mb-8">Last updated: {lastUpdated}</p>

        <p className="mb-6">
          TRAQ-IQ (operated by LAMP Logistics, "we", "us", "our") provides trucking
          dispatch and load-management software for commercial carriers and their drivers.
          This Privacy Policy explains what information we collect, how we use it, and how
          we handle SMS messaging consent.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-3">Information we collect</h2>
        <ul className="list-disc pl-6 space-y-2 mb-6">
          <li><strong>Driver profile:</strong> name, email, phone number, city, license number, state, expiry, equipment type, vehicle details, insurance and banking information needed for dispatch and settlement.</li>
          <li><strong>Operational data:</strong> load assignments, GPS location during active dispatch (with consent), document uploads (BOL, POD, weight tickets), message history with dispatch.</li>
          <li><strong>Consent records:</strong> timestamp and source of SMS consent, IP address at time of consent, opt-out events.</li>
          <li><strong>Account data:</strong> usernames, hashed passwords, role, and session data for staff users (admins, dispatchers).</li>
        </ul>

        <h2 className="text-xl font-semibold mt-8 mb-3">SMS messaging consent</h2>
        <p className="mb-4">
          By providing your phone number and checking the SMS consent box during driver
          onboarding (or otherwise providing explicit written or recorded consent), you
          agree to receive SMS messages from LAMP Logistics (operating the TRAQ-IQ platform)
          for the following purposes:
        </p>
        <ul className="list-disc pl-6 space-y-2 mb-4">
          <li>Load offers and dispatch coordination</li>
          <li>GPS tracking consent and location requests</li>
          <li>Document upload requests (BOL, POD, weight tickets)</li>
          <li>Driver dashboard and settlement notifications</li>
          <li>Account and security notifications</li>
        </ul>
        <p className="mb-4">
          <strong>Message frequency varies</strong> based on load activity. <strong>Message and
          data rates may apply.</strong> You can opt out of SMS at any time by replying{" "}
          <strong>STOP</strong> to any message. Reply <strong>HELP</strong> for help. To
          re-subscribe after opting out, reply <strong>START</strong>.
        </p>
        <p className="mb-6">
          We do not share your phone number with third parties for marketing purposes. We
          do not sell your information.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-3">How we use information</h2>
        <ul className="list-disc pl-6 space-y-2 mb-6">
          <li>To match you with loads that fit your equipment, location, and preferences.</li>
          <li>To send dispatch instructions, tracking links, and document upload requests.</li>
          <li>To process settlements and statements.</li>
          <li>To verify identity, prevent fraud, and maintain security.</li>
          <li>To comply with legal obligations and trucking industry regulations (DOT, FMCSA, IRS).</li>
        </ul>

        <h2 className="text-xl font-semibold mt-8 mb-3">Service providers</h2>
        <p className="mb-6">
          We use Twilio for SMS delivery, Stripe for payments, SendGrid for email, NeonDB
          for database hosting, and Railway for application hosting. These providers process
          information on our behalf under contractual data-protection terms and are not
          permitted to use your information for their own marketing.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-3">Your rights</h2>
        <ul className="list-disc pl-6 space-y-2 mb-6">
          <li>Request a copy of the personal information we hold about you.</li>
          <li>Request correction or deletion of your information (subject to legal retention requirements).</li>
          <li>Withdraw SMS consent at any time by replying STOP.</li>
          <li>Contact us with privacy questions at <a className="text-blue-600 underline" href="mailto:privacy@traqiqs.io">privacy@traqiqs.io</a>.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-8 mb-3">Data retention</h2>
        <p className="mb-6">
          We retain driver, dispatch, and financial records as long as your account is active
          and as required by trucking and tax regulations (typically 4–7 years for
          settlement and tax records). Consent and opt-out records are retained for as long
          as needed to honor your preferences.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-3">Changes to this policy</h2>
        <p className="mb-6">
          We may update this policy. Material changes will be communicated via the app or
          email. Continued use of the service after an update constitutes acceptance.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-3">Contact</h2>
        <p className="mb-6">
          LAMP Logistics — TRAQ-IQ<br />
          Email: <a className="text-blue-600 underline" href="mailto:privacy@traqiqs.io">privacy@traqiqs.io</a>
        </p>

        <p className="text-sm text-slate-500 mt-12">
          See also: <a className="text-blue-600 underline" href="/terms">Terms of Service</a>
        </p>
      </div>
    </main>
  );
}
