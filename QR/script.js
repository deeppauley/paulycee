const links = {
  main: document.querySelector('#main-link'),
  tiktok: document.querySelector('#tiktok-link')
};

fetch('./links.json', { cache: 'no-store' })
  .then(response => response.ok ? response.json() : Promise.reject())
  .then(config => {
    if (config.main) links.main.href = config.main;
    if (config.tiktok) links.tiktok.href = config.tiktok;
  })
  .catch(() => {});

document.querySelectorAll('.link-card').forEach(link => {
  link.addEventListener('click', () => {
    if (typeof gtag === 'function') {
      gtag('event', 'qr_link_click', { link_id: link.id, link_url: link.href });
    }
  });
});
