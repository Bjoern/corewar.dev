;redcode-88
;name Thoth
;author Alchemic Raker
;strategy paper
;assert CORESIZE == 8000


src MOV #60, 0
MOV <src, <dest
JMN -1, src
dest SPL @0, 3000
ADD #70, -1
ADD #10, src
JMP src
bomb DAT #0, #0
end

