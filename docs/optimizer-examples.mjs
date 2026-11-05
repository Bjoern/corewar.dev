// SPDX-License-Identifier: GPL-2.0-or-later
// Example templates for the constant optimizer. Each names the benchmark it fits.
export const examples=[
 {id:'dwarf',title:'Dwarf · standard ’94',suite:'public-wilkies/suite.benchmark.json',
  note:'A stone with a tunable step (mod 4, so it never bombs its own four lines) and bomb modes. Sampled scoring: 8000-cell core.',
  source:`;redcode-94
;name Dwarf (template)
;author A. K. Dewdney, markers by corewar.dev
;strategy Stone: tune the step and the bomb's modes
;assert CORESIZE == 8000
step    equ     !(4..3996, 4):2004      ; mod 4 keeps the four lines safe
        add.ab  #step, bomb
        mov.i   bomb, @bomb
        jmp     -2
bomb    dat     ![#,$,<,>]:# 0, #0
        end
`},
 {id:'alcoholism',title:'Alcoholism Malt · nano',suite:'public-nanobm07/suite.benchmark.json',
  note:'Dave Hillis’s nano warrior with its step and one offset opened. Exact scoring: every placement of the 80-cell core is fought.',
  source:`;redcode-nano
;name Alcoholism Malt (template)
;author Dave Hillis (constants opened by cwopt example)
;assert CORESIZE == 80
step  equ !(1..79):10
mov.i  <   !:-35, $    13
spl.ab #   step, >   -23
mov.i  *    -8, {     0
mov.i  >   -35, {    -2
djn.x  $    -2, $    -3
end   0
`}
];
