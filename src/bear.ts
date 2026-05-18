import lottie, { type AnimationItem } from 'lottie-web';
import { BearAnimation } from './bear-data';

export function attachBearPeekaboo(button: HTMLElement) {
  if (button.dataset.bearWired === '1') return;
  button.dataset.bearWired = '1';

  const wrapper = document.createElement('span');
  wrapper.className = 'bear-wrap';
  const slot = document.createElement('span');
  slot.className = 'bear-slot';
  wrapper.appendChild(slot);
  button.appendChild(wrapper);

  let anim: AnimationItem | null = null;
  let hideTimer: number | null = null;

  const show = () => {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (!anim) {
      anim = lottie.loadAnimation({
        container: slot,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        animationData: BearAnimation
      });
    }
    wrapper.classList.add('bear-visible');
  };

  const hide = () => {
    wrapper.classList.remove('bear-visible');
    hideTimer = window.setTimeout(() => {
      if (anim) {
        anim.destroy();
        anim = null;
      }
    }, 800);
  };

  button.addEventListener('mouseenter', show);
  button.addEventListener('focus', show);
  button.addEventListener('mouseleave', hide);
  button.addEventListener('blur', hide);
}
