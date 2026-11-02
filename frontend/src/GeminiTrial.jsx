import React, { useEffect, useState } from 'react';

export default function GeminiTrial({ request, busy, page, onTrial }) {
  const [key, setKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; request('/api/gemini').then(data => {
    if (active) setConfigured(data.configured);
  }).catch(() => { if (active) setError('Restart ClearPage to enable the Gemini connection.'); });
  return () => { active = false; }; }, []);
  useEffect(() => { setConsent(false); }, [page]);
  async function configure(value) {
    setSaving(true); setError('');
    try {
      const data = await request('/api/gemini/key', { key: value });
      setConfigured(data.configured); setKey(''); setConsent(false);
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  }
  return <section className="gemini-trial" aria-label="Gemini connection">
    <h3>Try one page with Gemini</h3>
    <p>Gemini 3 Pro Image edits the whole page. It can change words, numbers, signatures and barcodes. This is an AI draft, not verified restoration.</p>
    <p>Only page {page + 1} is sent to Google. Your key stays in this app’s memory until you forget it or close the app. Google usage charges and data policies apply.</p>
    {!configured ? <form onSubmit={event => { event.preventDefault(); configure(key.trim()); }}>
      <label>Gemini API key<input type="password" name="gemini-api-key" value={key} autoComplete="off" spellCheck={false} disabled={busy || saving} onChange={event => setKey(event.target.value)} placeholder="Enter your key here, not in chat" /></label>
      <button className="button button-secondary" disabled={busy || saving || !key.trim()} type="submit">Use key for this session</button>
    </form> : <div><p role="status">Key entered. Access will be checked on the first request.</p><button className="text-button" disabled={busy || saving} onClick={() => configure('')}>Forget key</button></div>}
    <label className="gemini-consent"><input type="checkbox" checked={consent} disabled={busy || saving} onChange={event => setConsent(event.target.checked)} />Send page {page + 1} to Google Gemini using my key. I understand this may cost credits.</label>
    <p>Other pages stay original. Starting another trial replaces this run’s review. Repeating a successful trial of the same page reuses its draft.</p>
    <button className="button button-primary" disabled={busy || saving || !configured || !consent} onClick={() => { setConsent(false); onTrial(); }}>Create draft of page {page + 1}</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
