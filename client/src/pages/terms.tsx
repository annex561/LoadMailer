// Public Terms of Service. Required for A2P 10DLC TCR campaign approval —
// must be reachable without login at /terms.
export default function TermsOfService() {
  const lastUpdated = "April 29, 2026";
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="max-w-3xl mx-auto px-6 py-12 leading-relaxed">
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-slate-500 mb-8">Last updated: {lastUpdated}</p>

        <p className="mb-6">
          These Terms govern your use of TRAQ-IQ ("the Service"), provided by LAMP
          Logistics ("we", "us", "our"). By creating a driver or staff account, or by
          using the Service, you agree to these Terms.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-3">1. The service</h2>
        <p className="mb-6">
          TRAQ-IQ is a dispatch and load-management platform for commercial trucking. It
          enables dispatchers to assign loads to drivers, communicate by SMS, request
          documents, and process settlements.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-3">2. Accounts</h2>
        <ul className="list-disc pl-6 space-y-2 mb-6">
          <li>You must be 18 or older and legally able to enter contracts.</li>
          <li>You are responsible for keeping your credentials secure and for all activity under your account.</li>
          <li>You agree to provide accurate information and to update it when it changes.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-8 mb-3">3. SMS messaging</h2>
        <p className="mb-4">
          By providing your phone number and checking the SMS consent box during driver
          onboarding, you agree to receive operational SMS messages from TRAQ-IQ. Message
          frequency varies based on load activity. Message and data rates may apply.
        </p>
        <p className="mb-6">
          To opt out at any time, reply <strong>STOP</strong>. Reply <strong>HELP</strong> for
          help. Reply <strong>START</strong> to re-subscribe after opting out. Standard
          carrier message rates apply.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-3">4. Acceptable use</h2>
        <p className="mb-4">You agree not to:</p>
        <ul className="list-disc pl-6 space-y-2 mb-6">
          <li>Use the Service for any unlawful purpose.</li>
          <li>Attempt to access another user's account or data.</li>
          <li>Send harassing, fraudulent, or misleading messages through the Service.</li>
          <li>Interfere with or disrupt the Service.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-8 mb-3">5. Driver responsibilities</h2>
        <ul className="list-disc pl-6 space-y-2 mb-6">
          <li>Maintain a valid commercial driver's license, medical certification, and insurance.</li>
          <li>Submit BOLs, PODs, and other required documents promptly.</li>
          <li>Operate vehicles safely and in compliance with DOT and FMCSA regulations.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-8 mb-3">6. Payments and settlements</h2>
        <p className="mb-6">
          Driver settlements are computed from delivered loads according to the rate and
          pay terms agreed at dispatch. Disputes must be raised in writing within 14 days
          of the settlement statement.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-3">7. Termination</h2>
        <p className="mb-6">
          We may suspend or terminate your access for breach of these Terms, fraud,
          unsafe behavior, or non-payment. You may close your account at any time by
          contacting dispatch.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-3">8. Disclaimers</h2>
        <p className="mb-6">
          The Service is provided "as is" without warranties of any kind. We do not
          guarantee uninterrupted availability. We are not responsible for delays,
          accidents, cargo damage, or losses incurred during transport.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-3">9. Limitation of liability</h2>
        <p className="mb-6">
          To the maximum extent permitted by law, our total liability for any claim
          related to the Service is limited to the fees you paid us in the 12 months
          before the claim.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-3">10. Governing law</h2>
        <p className="mb-6">
          These Terms are governed by the laws of the state where LAMP Logistics is
          incorporated. Disputes will be resolved in the courts of that state.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-3">11. Changes</h2>
        <p className="mb-6">
          We may update these Terms. Material changes will be communicated via the app or
          email. Continued use after an update constitutes acceptance.
        </p>

        <h2 className="text-xl font-semibold mt-8 mb-3">Contact</h2>
        <p className="mb-6">
          LAMP Logistics — TRAQ-IQ<br />
          Email: <a className="text-blue-600 underline" href="mailto:support@traqiqs.io">support@traqiqs.io</a>
        </p>

        <p className="text-sm text-slate-500 mt-12">
          See also: <a className="text-blue-600 underline" href="/privacy">Privacy Policy</a>
        </p>
      </div>
    </main>
  );
}
