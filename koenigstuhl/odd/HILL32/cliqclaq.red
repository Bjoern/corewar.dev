;redcode-94
;name Cliq Claq
;author Steve Gunnell
;strategy Pendulum clone
;assert CORESIZE==8000


	step	equ	(inc-ptr)
	first	equ	2221

ptr	dat	first+step	,first

	for	9
	dat.f	0	,0
	rof

bomb	spl	#0	,{0

wipe	mov	bomb	,<ptr
	mov	>ptr	,>ptr
	jmn.f	wipe	,>ptr

reset	mov.ab	ptr	,ptr

scan	sub	inc	,ptr
	sne.x	*ptr	,@ptr
inc	sub.x	#-2*step	,ptr
	jmz.f	scan	,@ptr

	slt	ptr	,#last-ptr+6
	djn	wipe	,ptr
	djn	reset	,#16
last	jmp	reset	,{wipe

        end    scan+1


