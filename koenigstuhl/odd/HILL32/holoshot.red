;redcode-94
;name holoshot
;author Simon Wainwright
;strategy oneshot
;assert CORESIZE==8000

st equ 20
gp equ 10
fi equ (ptr+200-3)

       dat        0,       0
gate   dat        0,       0
       dat        0,       0
bptr   dat        1,      10
squash spl    #4000,      12
clear  mov    *bptr,   >gate
       mov    *bptr,   >gate
       mov    *bptr,   >gate
       djn.f  clear, }squash

       dat        0,       0

inc    spl     #-st,    <-st
scan   sub      inc,     ptr
ptr    sne    fi+gp,      fi
       sub      inc,     ptr
p      sne     *ptr,    @ptr
       djn.f   scan,    @ptr
       mov.f     @p,    gate
       djn.f squash,    <195
       end      ptr

