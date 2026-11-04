;redcode
;name Exude
;author Steve Gunnell
;strategy Qbomb -> Sting variant
;assert CORESIZE==8000

STEP	equ	893
START	equ	2902
GAP	equ	19
DTRAIN	equ	6668

RPT	equ	(GAP+5+8)/2
SAFE	equ	inc-scan+GAP+8+11

MARK	equ	5274

qb:
I for 9-3
	MOV	<MARK*I	,0-(MARK*I)
rof
go	SUB	inc	,1
scan	CMP	START-GAP	,START
	SLT	#SAFE	,-1
	DJN	go	,<DTRAIN
	MOV	scan	,wptr
	MOV	#RPT	,wlp
wptr	JMP	wipe	,#-10
	MOV	wipe	,<wptr
	MOV	wipe	,<wptr
wlp	DJN	-2	,#0
	JMN	go	,go
wipe	SPL	0	,0
	MOV	bomb	,<inc
for 3
	MOV	bomb	,<inc
rof
	DJN	1	,<-30
bomb	DAT	<2667	,<-5-3
inc	SPL	<STEP	,<STEP

	end	qb
