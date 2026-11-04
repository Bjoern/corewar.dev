;redcode
;name mussel scanner
;author Christian Schmidt
;strategy ancient scanning concept
;assert 1

sStep   EQU 4542
sOff    EQU 2284
bBoot   EQU 3784
bdist   equ (sStart+bBoot)

sStart add #sStep  , @2
main   jmz sStart  , @2
       mov sJmp    , @1
       mov sSpl    , <sOff
       jmn sStart  , @sStart

sSpl   spl 0       , <0
       mov 2       , <-9
sJmp   jmp -1      , 0
cptr   dat <-2     , <-92

   for 9
      dat   #0    ,     #0 
   rof 

boot  mov   cptr  ,     bdist+9
brep  mov   <from ,     <boot
      mov   <from ,     <boot
      mov   <from ,     <boot
      mov   <from ,     <boot
      djn   brep  ,     #2
from  jmp   bdist+2,     cptr

end boot