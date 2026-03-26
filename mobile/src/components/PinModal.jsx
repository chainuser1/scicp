/**
 * PinModal — Set, change, or remove session PIN.
 */
import { useState } from 'react';
import socket from '../socket';
import { addToast } from '../hooks/useToast';
import './PinModal.css';

export default function PinModal({ sessionId, hasPinActive, onPinChanged, onClose }) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const handleSet = () => {
    if (!/^\d{4,8}$/.test(pin)) { setError('PIN must be 4–8 digits'); return; }
    if (pin !== confirm) { setError('PINs do not match'); return; }
    socket.emit('set-session-pin', { sessionId, pin }, (res) => {
      if (res?.ok) {
        onPinChanged(true);
        onClose();
        addToast('Session PIN set', 'success');
      } else {
        setError(res?.message || 'Failed to set PIN');
      }
    });
  };

  const handleClear = () => {
    socket.emit('clear-session-pin', { sessionId }, (res) => {
      if (res?.ok) {
        onPinChanged(false);
        onClose();
        addToast('Session PIN removed', 'info');
      } else {
        setError(res?.message || 'Failed to remove PIN');
      }
    });
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal pin-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-header">
          <h3 className="text-lg font-semibold">
            {hasPinActive ? 'Change Session PIN' : 'Set Session PIN'}
          </h3>
          <button className="btn-icon btn-sm" onClick={onClose}>✕</button>
        </div>
        <p className="text-xs text-dim" style={{ marginBottom: 12 }}>
          4–8 digit PIN. Required for future presenters joining this session.
        </p>
        <div className="pin-fields">
          <input
            className="input"
            type="password"
            inputMode="numeric"
            maxLength={8}
            placeholder="New PIN"
            value={pin}
            onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }}
            autoFocus
          />
          <input
            className="input"
            type="password"
            inputMode="numeric"
            maxLength={8}
            placeholder="Confirm PIN"
            value={confirm}
            onChange={e => { setConfirm(e.target.value.replace(/\D/g, '')); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && pin === confirm && handleSet()}
          />
        </div>
        {error && <p className="text-sm" style={{ color: 'var(--accent-red)', marginTop: 8 }}>{error}</p>}
        <div className="pin-actions">
          <button className="btn btn-primary" onClick={handleSet}>
            {hasPinActive ? 'Update PIN' : 'Set PIN'}
          </button>
          {hasPinActive && (
            <button className="btn btn-danger" onClick={handleClear}>Remove PIN</button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
