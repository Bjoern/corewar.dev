;redcode-94
;name Psydon
;author Steve Gunnell
;strategy quickbomb -> PdqScan style paper
;assert CORESIZE==8000

MARK	equ	}522
STEP1	equ	3177
STEP2	equ	2817
DECOY	equ	2130

off1	equ	(pa+5+5334-(STEP1*3))
off2	equ	(pa+6+2667-STEP1)

qb:
I for 11
	MOV.I	>6864*I	,0-(6864*I)
rof

st	MOV.I 	<t1	,{t1
	SPL.F 	2	,MARK
	SPL.F 	1	,MARK*2
	SPL.F 	1	,MARK*3
	MOV.I 	<1	,{1
t1	SPL.F 	off1	,p0+7
p0	MOV.I 	<1	,{1
	SPL.F 	off2	,pa+6
pa	SPL.F 	@0	,>STEP1
	MOV.I 	}-1	,>-1
	MOV.I 	{-2	,<1
	SPL.F 	@0	,>STEP2
	MOV.I 	#DECOY	,}2667
	MOV.I	>12	,}-10

END	qb

