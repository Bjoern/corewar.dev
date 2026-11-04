;redcode-94b
;name Laniakea.1
;author Oxinetone
;strategy Mantener_El_Podio
;version 2
;assert 1

ORG 1
DAT.F  #-5138,#5138
SPL.B  0,0
ADD.F  -2,1
MOV.I  >0,0  
JMP.B  -2,0

; // prueba de valores 
; -5138/5138 dat.f (2) -- 113.15 bench (mantener el -5138)
; 5138/5138 dat.f (2) -- 71 bench
; -2596 -- 94.23
; + 2569 -- 95

; // modificaciones sonbre laniakea.0
; instruccion MOV.I >0,0 supera a MOV.I <0,0 
; en 10 puntos contra el wilkies estandarizado
; pero lo hace más vulnerable

;otras direcicones
;5138 5138 102  ; 116.75benck
; ( 1-2-7-367 primos)
; (1-2-7-14-367-734-2569, divisores)
;2324 3094 96
;2365 3315 88
;3044 3364 87
;2376 2936 86
;3039 3359 56
