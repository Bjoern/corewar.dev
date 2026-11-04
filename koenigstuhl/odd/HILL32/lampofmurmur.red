;redcode-nano
;name Lamp of Murmuur
;author Guillermo Calvo Arenaza
;strategy paper
;assert 1

replicante:		mov.ab  #16, -1
			mov.i   @-2, <puestos
			djn     -1, -3

resureccion:		spl @puestos
			add #499, puestos
			
bomba_trampolin:	mov herramientas, >herramientas
			mov herramientas2, >herramientas
			jmz bomba_trampolin, <contador
			add #5, contador
			jmp replicante

herramientas:		dat #-14, #4
herramientas2:		jmp -1

puestos:		dat #0, #720
contador:		dat #5,#5
