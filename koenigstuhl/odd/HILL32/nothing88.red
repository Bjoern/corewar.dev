;redcode
;name I got nothing
;author Ilmari Karonen
;strategy nothing
;assert CORESIZE == 8000

; Written in < 1 hour for the Core War Tournament Weekend 2024:
; https://corewar.co.uk/tournamentweekend2024.htm
;
; This was going to be a fast stone, but I ran out of time getting the step
; sizes right, so here's a simple two pass core clear instead.

kill	dat		#0,		#kill-bptr
stun	spl		 0,		<kill-bptr

start	spl		 0,		<aptr-2667
loop	mov		@bptr,	<aptr
		djn		 loop,	<aptr-2667

aptr	dat		#0,		#kill-1
bptr	dat		#0,		#stun

		end		 start