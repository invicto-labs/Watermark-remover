const form = document.querySelector('#enquiry-form');
const kind = document.querySelector('#enquiry-type');
const reference = document.querySelector('#enquiry-order');
form.addEventListener('input', () => { document.querySelector('#enquiry-result').hidden = true; });
kind.addEventListener('change', () => { reference.required = kind.value === 'Refund request'; });
form.addEventListener('submit', event => {
  event.preventDefault();
  const data = new FormData(form);
  const text = `To: sales@zynape.com\nRequest: ${data.get('type')}\nName: ${data.get('name')}\nReply email: ${data.get('email')}\nPayment/order reference: ${data.get('order') || 'Not paid / not applicable'}\n\nRequirements:\n${data.get('details')}\n\nPlease confirm the cleanup scope and price. The two-hour delivery-or-refund promise starts when complete requirements and any requested sample have been received.`;
  document.querySelector('#enquiry-preview').value = text;
  document.querySelector('#enquiry-send').href = 'mailto:sales@zynape.com?subject=' + encodeURIComponent('ClearPage — ' + data.get('type')) + '&body=' + encodeURIComponent(text);
  document.querySelector('#enquiry-result').hidden = false;
  document.querySelector('#enquiry-status').textContent = 'Your draft is ready. Open your email app and send it to complete your enquiry.';
  document.querySelector('#enquiry-send').focus();
});
document.querySelector('#enquiry-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(document.querySelector('#enquiry-preview').value); document.querySelector('#enquiry-status').textContent = 'Copied. Paste the text into an email to sales@zynape.com and send it.'; }
  catch { document.querySelector('#enquiry-status').textContent = 'Select and copy the email draft below, then send it to sales@zynape.com.'; document.querySelector('#enquiry-preview').focus(); document.querySelector('#enquiry-preview').select(); }
});

const header = document.querySelector('.site-header');
if (header) {
  const drawer = document.querySelector('#site-menu');
  const drawerNavigation = drawer.querySelector('nav');
  drawerNavigation.replaceChildren(...[...header.querySelectorAll('nav a')].map(link => link.cloneNode(true)));
  header.querySelector('.site-menu-toggle').addEventListener('click', () => drawer.showModal());
  drawer.querySelector('.site-menu-close').addEventListener('click', () => drawer.close());
  drawer.addEventListener('click', event => {
    if (event.target === drawer || event.target.closest('a')) drawer.close();
  });
  const sections = [...header.querySelectorAll('nav a[href^="#"]')].map(link => ({
    link,
    drawerLink: drawerNavigation.querySelector(`a[href="${link.hash}"]`),
    section: document.getElementById(link.hash.slice(1)),
  })).filter(item => item.section);
  let currentSection;
  const updateHeader = () => {
    header.classList.toggle('is-scrolled', window.scrollY > 12);
    const anchorOffset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop);
    const boundary = Math.max(header.offsetHeight + 36, anchorOffset + 21);
    const current = sections.findLast(({ section }) => section.getBoundingClientRect().top <= boundary);
    if (currentSection === current) return;
    currentSection?.link.removeAttribute('aria-current');
    currentSection?.drawerLink.removeAttribute('aria-current');
    currentSection = current;
    currentSection?.link.setAttribute('aria-current', 'location');
    currentSection?.drawerLink.setAttribute('aria-current', 'location');
  };
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });
  window.addEventListener('resize', () => {
    if (!window.matchMedia('(max-width: 1100px)').matches && drawer.open) drawer.close();
    updateHeader();
  });
  window.addEventListener('pageshow', updateHeader);
}
if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.08 });
  document.querySelectorAll('.product-section > div, .workflow > div, .workflow li, .pricing > *, .custom-section > *, .faq, .closing h2').forEach(element => {
    element.classList.add('will-reveal');
    observer.observe(element);
  });
}
