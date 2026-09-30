import React, { useMemo, useState } from 'react';
import { Button, Input, Checkbox, Icon } from '@yurt/ui';
import { newRecoveryPhrase, keyFromPhrase, fingerprint, isValidPhrase, normalizePhrase, formatCode } from '@yurt/protocol';
import { useApp } from '../store';
import { handleFrom } from '../lib/format';

type Step = 'hello' | 'restore' | 'save';

export function Onboarding() {
  const route = useApp((s) => s.route);
  const [step, setStep] = useState<Step>('hello');
  const [phrase, setPhrase] = useState(() => newRecoveryPhrase());
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [handleTouched, setHandleTouched] = useState(false);
  const [restoreText, setRestoreText] = useState('');
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const fp = useMemo(() => fingerprint(keyFromPhrase(phrase).pub), [phrase]);
  const h = handleTouched ? handle : handleFrom(name);
  const finish = () => useApp.getState().createIdentity(phrase, name.trim(), h);

  return (
    <div style={{ height: '100%', overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 28, animation: 'ag-rise var(--dur-slow) var(--ease-out)' }}>
        <span style={{ font: '700 24px/1 var(--font-display)', letterSpacing: '-0.05em', color: 'var(--text-strong)' }}>yurt</span>
        {step === 'hello' && (
          <form onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return setErr('Tell people who you are.'); setErr(''); setStep('save'); }} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h1 style={{ margin: 0, font: '700 44px/1 var(--font-display)', letterSpacing: '-0.045em', color: 'var(--text-strong)', textWrap: 'balance' as any }}>
                {route.code ? 'You’re invited.' : 'Team chat with no server in the middle.'}
              </h1>
              <p style={{ margin: 0, fontSize: 16, color: 'var(--text-muted)', textWrap: 'pretty' as any }}>
                {route.code ? <>Pick a name and you’ll join <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-strong)' }}>{formatCode(route.code)}</span>. Messages travel straight between members’ browsers.</> : 'Messages travel straight between members’ browsers. No accounts: you are a key that lives on this device.'}
              </p>
            </div>
            <Input label="Display name" placeholder="Maya Chen" value={name} onChange={(e) => setName(e.target.value)} error={err || undefined} autoFocus />
            <Input label="Handle" iconLeft="at-sign" value={h} onChange={(e) => { setHandleTouched(true); setHandle(e.target.value.toLowerCase().replace(/[^\w-]/g, '')); }} hint="How people @mention you." />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 16, background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)' }}>
              <Icon name="key-round" size={18} style={{ color: 'var(--text-subtle)' }} />
              <span style={{ flex: 1, fontSize: 13.5, color: 'var(--text-muted)' }}>Your key</span>
              <span style={{ font: '500 14px var(--font-mono)', color: 'var(--text-strong)' }}>{fp}</span>
              <Button size="sm" variant="ghost" iconLeft="refresh-cw" onClick={() => setPhrase(newRecoveryPhrase())} aria-label="Make a new key">New</Button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Button type="submit" variant="primary" size="lg" iconRight="arrow-right" fullWidth>Continue</Button>
              <Button variant="ghost" onClick={() => { setErr(''); setStep('restore'); }}>I have a recovery phrase</Button>
            </div>
          </form>
        )}
        {step === 'restore' && (
          <form onSubmit={(e) => {
            e.preventDefault();
            const p = normalizePhrase(restoreText);
            if (!isValidPhrase(p)) return setErr('That isn’t a valid 12-word phrase. Check spelling and order.');
            if (!name.trim()) return setErr('Add your display name too.');
            setPhrase(p);
            useApp.getState().createIdentity(p, name.trim(), h);
          }} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h1 style={{ margin: 0, font: '700 36px/1.05 var(--font-display)', letterSpacing: '-0.045em', color: 'var(--text-strong)' }}>Welcome back.</h1>
            <p style={{ margin: 0, fontSize: 15, color: 'var(--text-muted)' }}>Enter your 12 words to be the same person on this device. Rejoin your workspaces with their codes and history syncs back.</p>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>Recovery phrase</span>
              <textarea value={restoreText} onChange={(e) => setRestoreText(e.target.value)} rows={3} autoFocus spellCheck={false} autoCapitalize="none"
                style={{ resize: 'vertical', padding: '10px 14px', borderRadius: 12, border: '1.5px solid var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-body)', font: '400 14px/1.6 var(--font-mono)', outline: 'none' }} />
            </label>
            <Input label="Display name" value={name} onChange={(e) => setName(e.target.value)} />
            {err && <span role="alert" style={{ fontSize: 13, color: 'var(--danger-ink)' }}>{err}</span>}
            <Button type="submit" variant="primary" size="lg" fullWidth>Restore identity</Button>
            <Button variant="ghost" onClick={() => { setErr(''); setStep('hello'); }}>Back</Button>
          </form>
        )}
        {step === 'save' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <h1 style={{ margin: 0, font: '700 36px/1.05 var(--font-display)', letterSpacing: '-0.045em', color: 'var(--text-strong)' }}>Save these 12 words.</h1>
            <p style={{ margin: 0, fontSize: 15, color: 'var(--text-muted)' }}>They are your account. Use them to sign in on another device. Nobody can reset them for you.</p>
            <ol style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, margin: 0, padding: 14, listStyle: 'none', borderRadius: 20, background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)' }}>
              {phrase.split(' ').map((w, i) => (
                <li key={i} style={{ font: '500 14px/1.6 var(--font-mono)', color: 'var(--text-strong)', animation: `ag-pop var(--dur-base) var(--ease-spring) ${i * 30}ms both` }}>
                  <span style={{ color: 'var(--text-subtle)' }}>{String(i + 1).padStart(2, ' ')}.</span> {w}
                </li>
              ))}
            </ol>
            <Button variant="secondary" iconLeft="copy" onClick={() => navigator.clipboard?.writeText(phrase)}>Copy phrase</Button>
            <Checkbox checked={saved} onChange={(e) => setSaved(e.target.checked)} label="I saved my recovery phrase somewhere safe" />
            <Button variant="primary" size="lg" iconRight="arrow-right" fullWidth disabled={!saved} onClick={finish}>{route.code ? 'Join workspace' : 'Start chatting'}</Button>
            <Button variant="ghost" onClick={() => setStep('hello')}>Back</Button>
          </div>
        )}
      </div>
    </div>
  );
}
