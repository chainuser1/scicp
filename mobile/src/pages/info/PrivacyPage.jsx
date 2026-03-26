import '../../styles/info.css';

export default function PrivacyPage({ onBack }) {
  return (
    <div className="info-page">
      <div className="info-header">
        <button className="info-back" onClick={onBack}>← Back</button>
        <span className="info-header-title">Privacy Policy</span>
      </div>
      <div className="info-scroll">
        <div className="info-content">
          <h2>Data Collection</h2>
          <p>For normal scripture presentation use, we do not ask for accounts and we do not collect personal profiles.</p>

          <h2>Download Page Checks</h2>
          <p>On the downloads page, we check country and network risk flags (such as VPN/proxy) to enforce access rules. This check is used only to allow or block access and is not used for user profiling.</p>

          <h2>Third-Party Services</h2>
          <p>If a third-party service is used (for example, hosting or download providers), their own privacy policies apply to their systems.</p>

          <h2>Policy Updates</h2>
          <p>We may update this policy as the software changes. Continued use means you accept the latest published policy.</p>
        </div>
      </div>
    </div>
  );
}
