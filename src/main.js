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