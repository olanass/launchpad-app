// -------------------------------------------------------------
// 1. NAVIGATION & ROUTING
// -------------------------------------------------------------
function initNavigation() {
  const header = document.querySelector('.app-header');
  const mobileToggle = document.getElementById('mobileNavToggle');
  const mobileClose = document.getElementById('mobileNavClose');
  const mobileBackdrop = document.getElementById('mobileNavBackdrop');
  const closeMobileNavigation = () => {
    if (!header || !mobileToggle) return;
    header.classList.remove('mobile-nav-open');
    document.body.classList.remove('mobile-navigation-open');
    mobileToggle.setAttribute('aria-expanded', 'false');
    mobileToggle.setAttribute('aria-label', 'Open navigation menu');
  };

  if (header && mobileToggle) {
    mobileToggle.addEventListener('click', () => {
      const isOpen = header.classList.toggle('mobile-nav-open');
      document.body.classList.toggle('mobile-navigation-open', isOpen);
      mobileToggle.setAttribute('aria-expanded', String(isOpen));
      mobileToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
    });
    if (mobileClose) mobileClose.addEventListener('click', closeMobileNavigation);
    if (mobileBackdrop) mobileBackdrop.addEventListener('click', closeMobileNavigation);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMobileNavigation();
    });
    document.addEventListener('click', event => {
      if (!header.contains(event.target)) closeMobileNavigation();
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 920) closeMobileNavigation();
    });
  }

  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      const route = view === 'docs' ? '/docs' : (view === 'payments' ? '/payments' : '/');
      history.pushState(null, '', route);
      switchView(view);
      if (view === 'docs' && window.renderDocsRoute) window.renderDocsRoute();
      closeMobileNavigation();
    });
  });

  const btnCreateNew = document.getElementById('btnCreateNew');
  if (btnCreateNew) {
    btnCreateNew.addEventListener('click', () => switchView('create'));
  }

  const navHome = document.getElementById('navHome');
  if (navHome) {
    navHome.addEventListener('click', (e) => {
      e.preventDefault();
      history.pushState(null, '', '/');
      switchView('service-launch');
      closeMobileNavigation();
    });
  }
}

function switchView(viewName) {
  state.activeView = viewName;
  document.body.dataset.view = viewName;
  document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) targetView.classList.add('active');

  const activeBtn = document.querySelector(`.nav-btn[data-view="${viewName}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  if (viewName === 'mylinks') {
    fetchMyLinks();
    fetchMyServices();
  }
  if (viewName === 'marketplace') loadServiceMarketplace();
  if (viewName === 'payments') {
    if (!window.location.pathname.startsWith('/orders/')) window.resetConsoleOrder?.();
    loadPaymentServices();
  }
}
