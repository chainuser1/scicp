import '../../styles/info.css';

export default function ContactPage({ onBack }) {
  return (
    <div className="info-page">
      <div className="info-header">
        <button className="info-back" onClick={onBack}>← Back</button>
        <span className="info-header-title">Contact</span>
      </div>
      <div className="info-scroll">
        <div className="info-content">
          <h2>Get in Touch</h2>
          <p>For questions, support, and feedback, contact Dagami Ward Dev:</p>
          <p><a href="mailto:lumpsam47@gmail.com">lumpsam47@gmail.com</a></p>
          <p>Team: Dagami Ward Dev</p>
        </div>
      </div>
    </div>
  );
}
