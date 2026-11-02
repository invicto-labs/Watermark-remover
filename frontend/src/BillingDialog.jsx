import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, KeyRound, X } from 'lucide-react';

export default function BillingDialog({ status, request, onChange, onClose }) {
  const dialog = useRef(null);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkout, setCheckout] = useState(null);
  const razorpay = status?.payment_provider === 'razorpay';
  const payment = status?.payment;
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    if (!razorpay || !status?.payment_ready) return;
    let stopped = false;
    request('/api/billing/razorpay/check', {}).then(result => {
      if (stopped) return;
      setCheckout(result.pending ? result : null);
      onChange(result.billing);
      if (result.paid) setMessage('Payment verified. Your document credits are ready.');
      if (result.refunded) setMessage('Your previous payment was refunded. You can start a new pack.');
    }).catch(failure => { if (!stopped) setError(failure.message); });
    return () => { stopped = true; };
  }, [razorpay, status?.payment_ready]);
  useEffect(() => {
    if (!checkout?.pending) return;
    let stopped = false;
    let timer;
    let attempts = 0;
    async function poll() {
      try {
        const result = await request('/api/billing/razorpay/check', {});
        if (stopped) return;
        if (result.paid || result.refunded) {
          onChange(result.billing); setCheckout(null);
          setError(''); setMessage(result.paid ? 'Payment verified. Your document credits are ready.' : 'Your previous payment was refunded. You can start a new pack.');
          return;
        }
      } catch { /* Keep recovery available without replacing a customer's current message. */ }
      if (!stopped && ++attempts < 60) timer = setTimeout(poll, 10000);
    }
    timer = setTimeout(poll, 10000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [checkout?.pending]);
  async function paymentAction(create) {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request(`/api/billing/razorpay/${create ? 'order' : 'check'}`, {});
      onChange(result.billing); setCheckout(result.pending ? result : null);
      setMessage(result.paid ? 'Payment verified. Your document credits are ready.'
        : result.refunded ? 'Your previous payment was refunded. You can start a new pack.'
        : result.pending ? 'Complete checkout in the payment tab, then choose Check payment here. If you already paid, check again shortly.'
        : 'No pending payment. You can start a new ₹999 document pack.');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function copy(value) {
    try { await navigator.clipboard.writeText(value); setMessage('Copied.'); }
    catch { setError('Copy was unavailable. Select the text and copy it manually.'); }
  }
  async function activate(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const next = await request('/api/billing/activate', { key });
      onChange(next); setKey(''); setMessage(`Pack accepted. ${next.credits} document credits available. Re-entering a key does not add credits twice.`);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="billing-dialog" aria-labelledby="billing-title" onCancel={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="billing-content">
      <button autoFocus className="icon-button close-help" aria-label="Close payments" onClick={onClose}><X size={20} /></button>
      <span className="eyebrow">DOCUMENT CREDITS</span>
      <h2 id="billing-title">Two documents. ₹999.</h2>
      <p>Each distinct PDF uses one credit when it opens successfully. Clean, reopen and download that same file again at no extra charge. All pages in the PDF are included.</p>
      <div className="billing-balance"><KeyRound size={20} /><strong>{status?.credits ?? 0} credits available</strong></div>
      {status?.online_required && <p>Internet is required to verify credits and open paid documents. Reopening the same paid original uses no extra credit. Back up your app profile to preserve your account access.</p>}
      {status?.error && <p role="alert" className="billing-error">{status.error}</p>}
      {razorpay ? <div className="billing-setup">
        <h3>Pay securely with Razorpay</h3>
        <p>Pay ₹999 to add two document credits. Your credits activate after payment is verified. Your PDFs stay on this computer.</p>
        {status?.payment_ready ? <>
          {checkout?.test_mode && <p className="billing-error">Test mode — no real money is collected.</p>}
          <div className="billing-payment-actions">
            <button className="button button-primary" disabled={busy} onClick={() => paymentAction(true)}>{busy ? 'Checking…' : checkout ? 'Resume checkout' : 'Buy two documents · ₹999'}</button>
            <button className="button button-secondary" disabled={busy} onClick={() => paymentAction(false)}>Check payment</button>
          </div>
          {checkout?.amount && checkout?.currency && <p>Pending checkout: {checkout.documents} documents · {new Intl.NumberFormat('en-IN', { style: 'currency', currency: checkout.currency }).format(checkout.amount / 100)}</p>}
          {checkout?.checkout_url && <a className="button button-primary billing-checkout-link" href={checkout.checkout_url} target="_blank" rel="noopener noreferrer">Continue to secure checkout ↗</a>}
          {payment?.support_email && <p>Payment help: <strong>{payment.support_email}</strong></p>}
        </> : <p>Checkout is not available yet. The seller needs to finish Razorpay setup before accepting payments.</p>}
      </div> : status?.payment_ready && payment ? <>
        <h3>1. Transfer ₹999 to {payment.seller_name}</h3>
        <p>Pay through your bank using these transfer instructions. Check transfer charges and the final amount with your bank before sending.</p>
        <dl className="bank-details">
          {[["Beneficiary", payment.beneficiary_name], ["Account number", payment.account_number],
            ["Bank", payment.bank_name], ["Bank address", payment.bank_address], ["SWIFT / BIC", payment.swift_bic]]
            .map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}
        </dl>
        <p className="transfer-instructions">{payment.transfer_instructions}</p>
        <h3>2. Request your activation key</h3>
        <p>Send your name, bank transaction reference and installation code to <strong>{payment.support_email}</strong>. The seller checks the credited payment and replies with your key. Payment is not verified automatically.</p>
      </> : <div className="billing-setup"><h3>Bank payment details are not available yet</h3><p>Contact the seller before sending money. You can activate a key you have already received below.</p></div>}
      {status?.installation && <div className="installation-code"><span>Installation code</span><code>{status.installation}</code><button className="button button-secondary" onClick={() => copy(status.installation)}><Copy size={14} />Copy code</button></div>}
      {!razorpay && <form onSubmit={activate}>
        <label htmlFor="activation-key">{razorpay ? 'Have an activation key? (optional)' : 'Activation key'}</label>
        <textarea id="activation-key" value={key} onChange={event => setKey(event.target.value)} maxLength={8192} rows={4} placeholder="Paste the activation key from the seller" spellCheck={false} />
        <button className="button button-primary" disabled={busy || !key.trim()} type="submit"><Check size={16} />{busy ? 'Activating…' : 'Activate document pack'}</button>
      </form>}
      {error && <p role="alert" className="billing-error">{error}</p>}
      {message && <p role="status" className="billing-message">{message}</p>}
    </div>
  </dialog>;
}
