export function leprechaunSVG(): string {
  return `
<svg viewBox="0 0 400 360" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="rainbow" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#FF2DA0"/>
      <stop offset="22%" stop-color="#FF7A1A"/>
      <stop offset="44%" stop-color="#F5C24A"/>
      <stop offset="62%" stop-color="#3CE08F"/>
      <stop offset="80%" stop-color="#00E5FF"/>
      <stop offset="100%" stop-color="#7C3AED"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#FFE9A8"/>
      <stop offset="55%" stop-color="#F5C24A"/>
      <stop offset="100%" stop-color="#A8742A"/>
    </linearGradient>
    <linearGradient id="cyan" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#00E5FF"/>
      <stop offset="100%" stop-color="#50AAE3"/>
    </linearGradient>
    <radialGradient id="sparkle" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="1"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- Rainbow arc (semi-circle) -->
  <g opacity="0.92">
    <path d="M 50 280 A 150 150 0 0 1 350 280" stroke="url(#rainbow)" stroke-width="38" fill="none" stroke-linecap="round"/>
    <path d="M 80 280 A 120 120 0 0 1 320 280" stroke="#060610" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.4"/>
  </g>

  <!-- Pot of gold -->
  <g transform="translate(252,250)">
    <ellipse cx="40" cy="68" rx="58" ry="10" fill="#000" opacity="0.45"/>
    <path d="M -8 28 Q -20 26 -16 60 Q 0 74 40 76 Q 80 74 96 60 Q 100 26 88 28 Z" fill="#1a1a26" stroke="#0e0e18" stroke-width="2"/>
    <ellipse cx="40" cy="28" rx="48" ry="8" fill="url(#gold)"/>
    <g>
      <circle cx="22" cy="22" r="6" fill="url(#gold)"/>
      <circle cx="40" cy="14" r="7" fill="url(#gold)"/>
      <circle cx="56" cy="22" r="6" fill="url(#gold)"/>
      <circle cx="32" cy="6" r="4" fill="url(#gold)"/>
      <circle cx="48" cy="6" r="4" fill="url(#gold)"/>
    </g>
  </g>

  <!-- Leprechaun body -->
  <g transform="translate(82,88)" filter="url(#glow)">
    <!-- Hat -->
    <path d="M -6 16 L 78 16 L 86 28 L -14 28 Z" fill="#1B6F2C"/>
    <rect x="6" y="-26" width="60" height="44" rx="6" fill="#1B6F2C"/>
    <rect x="6" y="6" width="60" height="10" fill="#0A0A0F"/>
    <rect x="28" y="6" width="16" height="10" fill="url(#gold)"/>
    <rect x="32" y="9" width="8" height="4" fill="#A8742A"/>

    <!-- Face -->
    <ellipse cx="36" cy="60" rx="34" ry="32" fill="#F2C599"/>
    <!-- Beard -->
    <path d="M 6 70 Q 36 110 66 70 Q 60 96 36 100 Q 12 96 6 70 Z" fill="#E26B2A"/>
    <!-- Hair tufts -->
    <path d="M 4 36 Q 14 24 22 32" stroke="#E26B2A" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M 50 32 Q 58 24 68 36" stroke="#E26B2A" stroke-width="6" fill="none" stroke-linecap="round"/>
    <!-- Eyes (digital pixels) -->
    <rect x="20" y="56" width="6" height="6" fill="#00E5FF"/>
    <rect x="46" y="56" width="6" height="6" fill="#00E5FF"/>
    <!-- Smile -->
    <path d="M 26 74 Q 36 82 46 74" stroke="#0A0A0F" stroke-width="2.4" fill="none" stroke-linecap="round"/>

    <!-- Body / vest -->
    <path d="M 8 92 L 64 92 L 72 138 Q 72 156 56 162 L 16 162 Q 0 156 0 138 Z" fill="#1B6F2C"/>
    <rect x="32" y="92" width="8" height="74" fill="#0A0A0F"/>
    <circle cx="36" cy="108" r="4" fill="url(#gold)"/>
    <circle cx="36" cy="124" r="4" fill="url(#gold)"/>
    <circle cx="36" cy="142" r="4" fill="url(#gold)"/>

    <!-- Arm holding flag pole -->
    <path d="M 64 100 Q 96 92 122 56" stroke="#F2C599" stroke-width="14" fill="none" stroke-linecap="round"/>
    <circle cx="124" cy="56" r="8" fill="#F2C599"/>

    <!-- Boots -->
    <rect x="6" y="156" width="22" height="14" rx="4" fill="#0A0A0F"/>
    <rect x="44" y="156" width="22" height="14" rx="4" fill="#0A0A0F"/>
    <rect x="6" y="160" width="22" height="6" fill="url(#gold)"/>
    <rect x="44" y="160" width="22" height="6" fill="url(#gold)"/>
  </g>

  <!-- Cyan panda flag -->
  <g transform="translate(196,52)">
    <line x1="0" y1="0" x2="0" y2="118" stroke="#1f1f2c" stroke-width="4"/>
    <circle cx="0" cy="-2" r="4" fill="url(#gold)"/>
    <g class="flag-wave">
      <rect x="2" y="2" width="76" height="48" rx="4" fill="url(#cyan)"/>
      <!-- Panda head simplified -->
      <g transform="translate(30,18)">
        <circle cx="10" cy="14" r="14" fill="#FFFFFF"/>
        <ellipse cx="0" cy="6" rx="5" ry="6" fill="#0A0A0F"/>
        <ellipse cx="20" cy="6" rx="5" ry="6" fill="#0A0A0F"/>
        <ellipse cx="4" cy="14" rx="3" ry="4" fill="#0A0A0F"/>
        <ellipse cx="16" cy="14" rx="3" ry="4" fill="#0A0A0F"/>
        <circle cx="4" cy="14" r="1.2" fill="#FFFFFF"/>
        <circle cx="16" cy="14" r="1.2" fill="#FFFFFF"/>
        <ellipse cx="10" cy="20" rx="2.4" ry="1.6" fill="#0A0A0F"/>
        <path d="M 7 23 Q 10 26 13 23" stroke="#0A0A0F" stroke-width="1" fill="none" stroke-linecap="round"/>
      </g>
    </g>
  </g>

  <!-- Sparkles -->
  <g class="sparkles">
    <circle cx="48" cy="30" r="3" fill="url(#sparkle)"/>
    <circle cx="360" cy="60" r="4" fill="url(#sparkle)"/>
    <circle cx="320" cy="120" r="3" fill="url(#sparkle)"/>
    <circle cx="200" cy="20" r="2" fill="url(#sparkle)"/>
  </g>
</svg>`;
}
