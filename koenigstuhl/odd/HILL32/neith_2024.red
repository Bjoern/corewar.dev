;redcode-94nop 
;author inversed 
;name Neith 2024
;strategy Paper + stone 
;assert (CORESIZE==8000) && (MAXPROCESSES==8000) 

;;paper 

ofs0    equ     2062 
ofs1    equ     1432  
b1      equ     7171  

;;stone 

hop     equ     947  
step    equ     hop*2 
time    equ     6068 
djs     equ     7909  

;;boot 

shift   equ     6678
bds     equ     140+shift
bdp     equ     123+shift

;;misc 

x0      equ     wgo 
org     wgo 

;; 

wgo     spl       1         ,   0
qt2     spl       1         ,   0
        spl       1         ,   0
        mov     < bptr      , { bptr 
        mov     { silk0     , { pptr 
        spl     * bptr      ,   0 
bptr    spl       x0+bds+8  ,   s0+8 
pptr    jmz.a     x0+bdp+8  , * 0 
    
s0      spl     # 0         ,   0 
loop    mov       bomb      , @ ptr 
hit     add     # step      ,   ptr 
ptr     mov       bomb      , } hit-hop*time 
        djn.f     loop      , < djs 
        dat       0         ,   0 
        dat       0         ,   0 
bomb    dat       hop       , > 1 

silk0   spl     @ 8         , < ofs0 
        mov     } silk0     , > silk0 
to      spl       ofs1      , < from 
        mov     > from      , } to 
        mov       pbomb     , > b1 
        mov       pbomb     , } to 
from    djn.f     to        , > to+8 
pbomb   dat     < 2667      , < 5334 
