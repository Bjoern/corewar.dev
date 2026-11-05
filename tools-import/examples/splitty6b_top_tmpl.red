;redcode-94
;name splitty6b
;strategy paper
;assert 1

stepa		equ !:2451
stepb		equ !:649
hit		equ !:2485		;attack B target, relative to the attack line
ax		equ !:121		;attack A target (start: hit plus one 3-point imp step)
bda		equ !:3857		;bomb dat A field: anti-imp decrement
bdb		equ !:-910		;bomb dat B field: anti-imp decrement
sa		equ !:-1582		;add step for the attack's A target
sb		equ !:3320		;add step for the attack's B target

pdist		equ !(100..7900):3962	;distance between the coop papers

processes	equ 6		;processes per paper

launch		equ !(100..7900):3958

jop		equ ![djn,jmn,jmz]:jmz	;jump at the end of the paper, decides how the step drifts
jmod		equ ![a,b,f]:a

start		spl 2
			spl 1
			spl 1

boot		mov.i {papera, {bptr
			mov.i {paperc, <bptr

			spl 2
			jmp *bptr,1
			jmp @bptr,1		;TODO erase bptr

bptr		dat.f #launch+pdist+processes, launch+processes

papera		spl @processes, >stepa
			mov.i }papera, > papera
			mov.i {papera, <paperb
attack		mov.i ![<,{,>,}]:}ax, ![<,{,>,},$]:{hit
paperb		jop.jmod @0, stepb
bomba		dat <bda, <bdb	;not used by the attack here; a decoy and spare bomb

paperc		spl @processes, >stepa
			mov.i }paperc, > paperc
			mov.i {paperc, <paperd
attack2		add.![f,x,ab,b]:x steps, pdist
paperd		jop.jmod @0, stepb
steps		dat sa, sb


			end	start
