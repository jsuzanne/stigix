/* Stigix website – script.js
   Minimal interactivity: gallery tabs, clipboard copy, mobile nav
   No dependencies required. */

document.addEventListener('DOMContentLoaded', () => {

  /* ── Gallery tabs ── */
  const tabs = document.querySelectorAll('.gallery__tab');
  const panels = document.querySelectorAll('.gallery__panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const panel = document.getElementById(`tab-${target}`);
      if (panel) panel.classList.add('active');
    });
  });

  /* ── Clipboard copy — code blocks ── */
  document.querySelectorAll('.code-block__copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const block = btn.closest('.code-block');
      const code = block.querySelector('pre')?.innerText ?? '';
      navigator.clipboard.writeText(code).then(() => {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1800);
      });
    });
  });

  /* ── Clipboard copy — terminal block ── */
  const installBtn = document.getElementById('copy-install');
  if (installBtn) {
    installBtn.addEventListener('click', () => {
      const cmd = 'curl -sSL https://raw.githubusercontent.com/jsuzanne/stigix/main/install.sh | bash';
      navigator.clipboard.writeText(cmd).then(() => {
        const orig = installBtn.textContent;
        installBtn.textContent = 'Copied!';
        setTimeout(() => { installBtn.textContent = orig; }, 1800);
      });
    });
  }

  /* ── Mobile nav ── */
  const burger = document.getElementById('nav-burger');
  const mobileNav = document.getElementById('mobile-nav');
  const mobileClose = document.getElementById('mobile-close');

  if (burger && mobileNav) {
    burger.addEventListener('click', () => {
      mobileNav.classList.add('open');
      document.body.style.overflow = 'hidden';
    });
  }
  if (mobileClose && mobileNav) {
    mobileClose.addEventListener('click', () => {
      mobileNav.classList.remove('open');
      document.body.style.overflow = '';
    });
  }
  // Close on link click
  document.querySelectorAll('#mobile-nav a').forEach(a => {
    a.addEventListener('click', () => {
      mobileNav.classList.remove('open');
      document.body.style.overflow = '';
    });
  });

  /* ── Active nav link on scroll ── */
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav__links a[href^="#"]');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        navLinks.forEach(link => {
          link.style.color = '';
          if (link.getAttribute('href') === `#${entry.target.id}`) {
            link.style.color = 'var(--teal)';
          }
        });
      }
    });
  }, { rootMargin: '-40% 0px -55% 0px' });

  sections.forEach(s => observer.observe(s));
});
