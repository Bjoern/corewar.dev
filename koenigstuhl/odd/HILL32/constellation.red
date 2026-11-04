;redcode-88
;name Constellation Core
;author Alchemic Raker
;strategy stone, clear
;assert CORESIZE == 8000

MOV bomb, 24
ADD #13, -1
DJN -2, #612
ptr SPL 0, -1
run MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
MOV bomb, <ptr
bomb DAT #0, #0

end


