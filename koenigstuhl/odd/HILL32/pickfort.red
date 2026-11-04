;redcode
;name Pickfort
;author Steve Gunnell
;strategy Qbomb -> stone/imp based on QuickSilver
;assert CORESIZE == 8000

SDIST	equ	5234
IDIST	equ	55
IOFF	equ	(7980+3)
BP	equ	(stone+9)

MARK	equ	3587

qb:
I for 5
	mov	<MARK*I	,0-(MARK*I)
rof

boot	mov	imp+1	,SDIST+9
iboot	spl	2	,boot+IDIST+3
	spl	1	,boot+IOFF+8
	mov	imp	,<-1
	mov	<iptr	,<iboot
	mov	-3	,0
	mov	imp	,<-4
	mov	<iptr	,<sboot
	djn	boot+SDIST	,#5
sboot	djn	boot+IDIST	,#boot+SDIST+5

STEP	equ	514
TIME	equ	3496
START	equ	(514*3496)
HIT	equ	(stone+0)

;type 88gertop non-factor FT like
stone	SPL	0	,1-STEP
	MOV	<BP+1+(TIME*3)	,<HIT-(START*2)
	MOV	BP	,@-1
	ADD	1	,-2
	DJN	-3	,<STEP*2

;type 7 point - QuickSilver launch
iptr	spl	0	,imp
	add	#1144	,1
	jmp	@0	,iptr+IOFF-IDIST-1144

imp	mov	0	,1143
	DAT	<-STEP	,<1-STEP


end qb

