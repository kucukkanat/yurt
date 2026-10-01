import React from 'react';
import { Icon } from '../core/Icon.jsx';

export function ConnectionBanner({ state = 'offline', queued = 0, peers, onRetry, style }) {
  if (state === 'online') return null;
  const off = state === 'offline';
  const title = off ? 'You’re offline' : 'Reconnecting' + (peers ? ' to ' + peers + (peers === 1 ? ' peer' : ' peers') : '');
  const detail = off
    ? queued
      ? queued + (queued === 1 ? ' message' : ' messages') + ' will send when a peer is reachable'
      : 'Messages you write will send when a peer is reachable'
    : 'Catching up on what you missed';
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minHeight: 36,
        padding: '6px 16px',
        background: off ? 'var(--surface-raised)' : 'var(--surface-sunken)',
        borderBottom: '1px solid var(--border-subtle)',
        font: '500 13px/1.3 var(--font-body)',
        color: 'var(--text-body)',
        animation: 'ag-rise var(--dur-fast) var(--ease-out)',
        ...style,
      }}
    >
      <span style={{ display: 'flex', color: 'var(--text-subtle)', animation: off ? 'none' : 'ag-spin 1.2s linear infinite' }}>
        <Icon name={off ? 'wifi-off' : 'refresh-cw'} size={15} />
      </span>
      <span style={{ fontWeight: 600, color: 'var(--text-strong)' }}>{title}</span>
      <span style={{ color: 'var(--text-subtle)', flex: 1, minWidth: 0 }}>{detail}</span>
      {off && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{ border: 0, background: 'transparent', color: 'var(--accent)', font: '600 13px/1 var(--font-body)', cursor: 'pointer', padding: '6px 4px' }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
