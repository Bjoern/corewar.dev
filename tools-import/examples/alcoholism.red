;redcode-nano
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
