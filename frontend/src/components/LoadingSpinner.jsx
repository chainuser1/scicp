export default function LoadingSpinner({ message = 'Loading…' }) {
  return (
    <div className="loading-spinner" role="status" aria-label={message}>
      <div className="spinner" />
      <p>{message}</p>
    </div>
  );
}
