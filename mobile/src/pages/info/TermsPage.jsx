import '../../styles/info.css';

export default function TermsPage({ onBack }) {
  return (
    <div className="info-page">
      <div className="info-header">
        <button className="info-back" onClick={onBack}>← Back</button>
        <span className="info-header-title">Terms of Service</span>
      </div>
      <div className="info-scroll">
        <div className="info-content">
          <h2>Allowed Use</h2>
          <p>This software is for non-commercial church use and home use only.</p>

          <h2>User Responsibility</h2>
          <p>You are fully responsible for how you use this software and you agree to follow all applicable laws and regulations.</p>

          <h2>No Commercial Use</h2>
          <p>You may not sell, resell, rent, or commercially license this software without written permission from Dagami Ward Dev.</p>

          <h2>Software Provided As Is</h2>
          <p>The software is provided as is, without guarantees of uninterrupted operation in all environments.</p>

          <h2>Changes to Terms</h2>
          <p>These terms may be updated from time to time. Continuing to use the software means you accept the updated terms.</p>
        </div>
      </div>
    </div>
  );
}
