// SPDX-License-Identifier: GPL-2.0-or-later
// Kettle, K-7: a dented, kettle-shaped training robot with a screen for a face.
// kettleSvg() returns inline SVG markup; setMood() switches its expression through a class on the <svg>.
// Moods: idle (blinks), happy, worried, static (a glitch for system messages); talking is separate and moves the mouth.

export function kettleSvg({label = 'Kettle', animated = true} = {}) {
  return `<svg class="kettle${animated ? ' animated' : ''}" viewBox="0 0 64 64" role="img" aria-label="${label}">
  <style>
    .kettle .k-eyes-happy,.kettle .k-eyes-worried,.kettle .k-mouth-open,.kettle .k-mouth-worried,.kettle .k-static,.kettle .k-steam{display:none}
    .kettle .k-eyes,.kettle .k-puff1,.kettle .k-puff2{transform-box:fill-box;transform-origin:center}
    .kettle.animated .k-eyes{animation:k-blink 5s infinite}
    .kettle.animated .k-beacon{animation:k-beacon 2.4s infinite}
    .kettle.animated .k-steam{display:inline}
    .kettle.animated .k-puff1{animation:k-puff 3.2s ease-out infinite}
    .kettle.animated .k-puff2{animation:k-puff 3.2s ease-out 1.6s infinite}
    .kettle[data-talking=true] .k-mouth-open{display:inline;animation:k-talk .32s steps(1) infinite}
    .kettle[data-talking=true] .k-mouth,.kettle[data-talking=true] .k-mouth-worried{display:none}
    .kettle[data-mood=happy] .k-eyes,.kettle[data-mood=worried] .k-eyes,.kettle[data-mood=worried] .k-mouth{display:none}
    .kettle[data-mood=happy] .k-eyes-happy,.kettle[data-mood=worried] .k-eyes-worried,.kettle[data-mood=worried] .k-mouth-worried{display:inline}
    .kettle[data-mood=happy] .k-puff1,.kettle[data-mood=happy] .k-puff2{animation-duration:1.1s}
    .kettle[data-mood=happy]{animation:k-hop .45s ease-out 2}
    .kettle[data-mood=worried] .k-steam{display:none}
    .kettle[data-mood=static] .k-static{display:inline;animation:k-glitch .18s steps(2) infinite}
    .kettle[data-mood=static] .k-face{opacity:.25}
    @keyframes k-blink{0%,93%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
    @keyframes k-beacon{0%,60%,100%{opacity:1}75%{opacity:.25}}
    @keyframes k-puff{0%{opacity:0;transform:translateY(4px) scale(.7)}30%{opacity:.8}100%{opacity:0;transform:translateY(-6px) scale(1.2)}}
    @keyframes k-talk{0%{opacity:1}50%{opacity:0}}
    @keyframes k-hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-8%) rotate(-4deg)}}
    @keyframes k-glitch{0%{transform:translateX(-1px)}50%{transform:translateX(1.5px)}}
    @media (prefers-reduced-motion:reduce){.kettle *,.kettle{animation:none!important}}
  </style>
  <defs>
    <linearGradient id="kettleSteel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#c3d5df"/><stop offset=".55" stop-color="#8aa3b2"/><stop offset="1" stop-color="#5a7383"/>
    </linearGradient>
    <radialGradient id="kettleGlow" cx=".5" cy=".5" r=".6">
      <stop offset="0" stop-color="#173a48"/><stop offset="1" stop-color="#0a1820"/>
    </radialGradient>
  </defs>
  <g class="k-steam" fill="none" stroke="#dce9f0" stroke-width="1.6" stroke-linecap="round">
    <path class="k-puff1" d="M58 25 q-2 -3 0 -5 q2 -2 0 -5"/>
    <path class="k-puff2" d="M61 27 q-2 -3 0 -5 q2 -2 0 -4"/>
  </g>
  <path class="k-handle" d="M21 21 C20 8 44 8 43 21" fill="none" stroke="#5e7787" stroke-width="3.2" stroke-linecap="round"/>
  <circle class="k-beacon" cx="32" cy="9.5" r="2.4" fill="#f9a567"/>
  <path d="M49 37 L57 28.5 Q59 27 60 29 L52.5 41 Z" fill="#7e98a8" stroke="#4b6170" stroke-width="1"/>
  <path d="M13 51 C11 35 18 19 32 19 C46 19 53 35 51 51 Z" fill="url(#kettleSteel)" stroke="#4b6170" stroke-width="1.2"/>
  <path d="M19 26 q4 -4 9 -5" fill="none" stroke="#eef6fa" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>
  <path d="M16.5 43 q3.5 -1 3 -5.5" fill="none" stroke="#4b6170" stroke-width="1.1" stroke-linecap="round"/>
  <g transform="rotate(-28 45 24)"><rect x="40" y="22" width="10" height="4" rx="1.4" fill="#e7c48c"/><rect x="43.5" y="22.6" width="3" height="2.8" fill="#cfa66b"/></g>
  <rect class="k-screen" x="19.5" y="27" width="25" height="16" rx="5" fill="url(#kettleGlow)" stroke="#2c4654" stroke-width="1.2"/>
  <g class="k-face" fill="#54d8df">
    <g class="k-eyes"><rect x="24.5" y="31.5" width="4" height="5" rx="1.2"/><rect x="35.5" y="31.5" width="4" height="5" rx="1.2"/></g>
    <g class="k-eyes-happy" fill="none" stroke="#54d8df" stroke-width="1.8" stroke-linecap="round"><path d="M24 35 l2.5 -2.5 l2.5 2.5"/><path d="M35 35 l2.5 -2.5 l2.5 2.5"/></g>
    <g class="k-eyes-worried"><rect x="24.5" y="33" width="4" height="3" rx="1"/><rect x="35.5" y="33" width="4" height="3" rx="1"/><path d="M24.5 31.8 l3.6 -1.4 M39.5 31.8 l-3.6 -1.4" stroke="#54d8df" stroke-width="1.2" stroke-linecap="round"/></g>
    <path class="k-mouth" d="M29.5 39 q2.5 1.8 5 0" fill="none" stroke="#54d8df" stroke-width="1.4" stroke-linecap="round"/>
    <rect class="k-mouth-open" x="30" y="38.2" width="4" height="2.2" rx="1"/>
    <path class="k-mouth-worried" d="M29.5 40 q2.5 -1.6 5 0" fill="none" stroke="#54d8df" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="23" cy="38.6" r="1.5" fill="#ff8bb8" opacity=".6"/><circle cx="41" cy="38.6" r="1.5" fill="#ff8bb8" opacity=".6"/>
  </g>
  <g class="k-static" fill="#f0db75"><rect x="20" y="31" width="24" height="1.4"/><rect x="20" y="35.5" width="18" height="1.2"/><rect x="25" y="39" width="19" height="1.2"/></g>
  <rect x="11.5" y="49" width="41" height="6.5" rx="3" fill="#3b4f5d" stroke="#2a3a45" stroke-width="1"/>
  <g fill="#8aa3b2"><circle cx="17" cy="52.3" r="1"/><circle cx="32" cy="52.3" r="1"/><circle cx="47" cy="52.3" r="1"/></g>
  <text x="38" y="53.6" font-family="Consolas,monospace" font-size="3.6" fill="#8aa3b2">K-7</text>
</svg>`;
}

const timers = new WeakMap();
// Sets a mood; with `ms`, the robot returns to idle afterwards.
export function setTalking(svg, talking) { if (svg) svg.dataset.talking = String(talking); }
export function setMood(svg, mood, ms = 0) {
  if (!svg) return;
  clearTimeout(timers.get(svg));
  svg.dataset.mood = mood;
  if (ms) timers.set(svg, setTimeout(() => { svg.dataset.mood = 'idle'; }, ms));
}

// A still, small version for the chat, as a CSS image.
export const kettleIcon = () => `url("data:image/svg+xml,${encodeURIComponent(kettleSvg({animated: false}).replace('class="kettle"', 'xmlns="http://www.w3.org/2000/svg" class="kettle"'))}")`;
