;redcode-94
;assert 1
;name CHaiNS_oF_DeSTRuCTioN
;kill CHaiNS_oF_DeSTRuCTioN
;author Patxy
;strategy Recon clone with bootstrap & decoy 
;date 2024-Nov
;version 7

Timer	equ 350; cuenta atr‡s para el borrado 350*4 posiciones = 1400+1100 >31% 
; Una vez consumido el Timer y cubierto la memoria con una malla de ataques,
; comenzar con un borrado de memoria.

; caza secuencias de pasos de 3, 7, 9, and 11 saltos
;;rStep equ 6557   
;;rStep equ 2727; alternative; caza 3, 13, and 17 saltos
; 6557 * 231 = 2667   (2667 *  3 = 1)
; 6557 *  99 = 1143   (1143 *  7 = 1)
; 6557 *  77 =  889   ( 889 *  9 = 1)
; 6557 *  63 = 5091   (5091 * 11 = 1)
; 2727 * 221 = 2667   (2667 *  3 = 1)
; 2727 *  51 = 3077   (3077 * 13 = 1)
; 2727 *  39 = 2353   (2353 * 17 = 1)

; Benchmark/
;6557	125
;2727	106,08
;5371   121,75
;2607	115,17
;6779	129,17   134 ! 
;4229 	118,42
;1049	107,92
;5049	119,17
;5121	124,67
;7031	120,67
;6771	122

rStep equ 6779




; BOOTSTRAP: Copiamos el guerrero a otra posici—n de la memoria, a 1/3 de la memoria
rPlaceA equ 1*8000/3+1024
reconA  mov  rEnd,   <rDest   ;salto a location A
        mov {reconA, <rDest
        mov {reconA, <rDest
        mov {reconA, <rDest
        mov {reconA, <rDest
rSrc    jmn  reconA, {reconA
rDest	jmp rPlaceA+5, rPlaceA+15

        dat 0, 0

;;rDest   spl rPlaceA+5, rPlaceA+15
;;        jmp	reconA
;;reconA  jmp	rLoop



; SNE scanner con SPL wiper
; Compara posiciones en una horquilla de 6 celdas
; Cuando se encuentre algo, lo limpia con un manto de 14 SPLs, 
; con este formato:   ..X.....X.....

rPtr 	equ (rScan-8)

        dat     19, 	19
rDiff   spl #-rStep, #-rStep
rWipe   mov   rDiff, >rPtr    	; golpea con una capa de SPLs
rW2     mov  *rWipe, >rPtr    	; m‡s tarde >> borrado de la memoria
        djn.a rWipe,  rLength  

rLoop   sub   rDiff, @rS2
rScan   sne (rStep*2)-1,  (rStep*2)-7 ; compara 2 posiciones
        sub   rDiff,  rScan
rS2     seq  *rScan, @rScan   	; compara otras 2 posiciones
        slt.a   #20,  rScan   	; evita sus posiciones del scanner
rTimer  djn   rLoop, #Timer 	; cuenta atr‡s para el borrado de la memoria

rLength sub.ba   #0,   #-7     	; inicializa la capa de SPLs
rTweak  mov.ab @rS2,   @rWipe
rT2     jmn    *rW2,    rTimer 	; cuando el contador expire,
rEnd    djn.a <rTweak, {rT2    	; comenzamos el borrado de la memoria

;end rLoop ;sin bootstrap

