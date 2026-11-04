;redcode
;name deadshot
;author Simon Wainwright
;assert 1

          clearptr equ bombptr+5
          step equ -13

clear     dat         <2667,               <-20
stun      spl             0,                -30

scanloop  add         #step,            scanptr
scanptr   jmz      scanloop,               -100
          mov       scanptr,           clearptr

          spl             0
clearloop mov      @bombptr,          <clearptr
          mov      @bombptr,          <clearptr
          djn     clearloop,               <-15

bombptr   dat                             #stun

          end       scanptr

