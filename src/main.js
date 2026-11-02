import { gsap } from 'gsap';

/* ============================================================
   GIBSON HOMEPAGE — main.js
   The 3D guitar hero/carousel has moved to custom-shop.js
   (Custom Shop step 1). This file now only handles homepage
   interactions that don't need a 3D scene.
============================================================ */

// ---------- featured products: arrow scroll ----------
const featuredScroll = document.getElementById('featured-scroll');
const prevBtn = document.getElementById('featured-prev');
const nextBtn = document.getElementById('featured-next');

if (featuredScroll && prevBtn && nextBtn) {
  const scrollAmount = () => featuredScroll.clientWidth * 0.4;
  prevBtn.addEventListener('click', () => {
    featuredScroll.scrollBy({ left: -scrollAmount(), behavior: 'smooth' });
  });
  nextBtn.addEventListener('click', () => {
    featuredScroll.scrollBy({ left: scrollAmount(), behavior: 'smooth' });
  });
}