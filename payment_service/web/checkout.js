/* The purchase capability stays in the URL fragment, never a query or access log. */
const claim = new URLSearchParams(location.hash.slice(1)).get('claim');
const pay = document.querySelector('#pay');
const check = document.querySelector('#check');
const message = document.querySelector('#status');
let order;
let paying = false;
async function call(path, body = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, claim }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Payment check failed. Please try Check payment.');
  return result;
}
function show(result) {
  order = result;
  const price = new Intl.NumberFormat('en-IN', { style: 'currency', currency: result.currency }).format(result.amount / 100);
  document.querySelector('#plan-documents').textContent = `${result.documents} documents.`;
  document.querySelector('#plan-price').textContent = price;
  document.querySelector('#test').hidden = !result.test_mode;
  document.querySelector('#support').textContent = result.support_email ? `Need help? ${result.support_email}` : '';
  pay.disabled = result.status !== 'pending';
  pay.textContent = result.status === 'paid' ? 'Payment verified' : `Pay ${price}`;
  if (result.status === 'paid') message.textContent = `Payment verified. Return to ClearPage and choose Check payment to activate your ${result.documents} document credits.`;
  else if (result.status === 'refunded') message.textContent = 'This payment was refunded. Contact the seller for help.';
  else message.textContent = 'Ready to pay. If you already paid, use Check payment before trying again.';
}
async function refresh() {
  check.disabled = true; pay.disabled = true;
  try { show(await call('/api/purchase')); }
  catch (error) { message.textContent = error.message; }
  finally { check.disabled = false; }
}
check.addEventListener('click', refresh);
pay.addEventListener('click', () => {
  if (paying || !order || order.status !== 'pending') return;
  if (!window.Razorpay) { message.textContent = 'Razorpay checkout could not load. Check your connection, then reload this page.'; return; }
  paying = true; pay.disabled = true; check.disabled = true;
  const finish = () => { paying = false; check.disabled = false; };
  const checkout = new window.Razorpay({ key: order.key_id, order_id: order.order_id,
    ...(order.test_mode ? { config: { display: {
      blocks: { test_cards: { name: 'Test card payment', instruments: [{ method: 'card' }] } },
      sequence: ['block.test_cards'], preferences: { show_default_blocks: false }
    } } } : {}),
    amount: order.amount, currency: order.currency, name: order.seller_name,
    description: `${order.documents} distinct PDF documents`, theme: { color: '#347b44' },
    handler: async result => {
      message.textContent = 'Verifying payment…';
      try {
        show(await call('/api/confirm', result));
        if (order.status === 'pending') message.textContent = 'Payment is awaiting capture. Use Check payment shortly; do not pay again.';
      } catch (error) { message.textContent = error.message + ' Return to ClearPage and check payment to recover your purchase.'; }
      finally { finish(); }
    }, modal: { ondismiss: () => { finish(); refresh(); } }
  });
  checkout.on('payment.failed', () => { message.textContent = 'Payment was not completed. Close checkout and check payment before retrying.'; });
  checkout.open();
});
if (!/^[a-f0-9]{64}$/.test(claim || '')) message.textContent = 'Open this checkout from the Buy / activate button in ClearPage.';
else refresh();
