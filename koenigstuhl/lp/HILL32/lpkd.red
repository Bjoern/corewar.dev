;redcode-lp
;name LPKD
;Looping Paper Killing Device
;author NDusN
;which is how CoreWin display теsт
;strategy Try to convert the enemy into imps and kill them via gate,
;strategy using an imp bomber and two standalone imps
;This is a (real) descendant of Eve 15, the reason of this being "real" is that
;any other e15-style warrior (and there aren't many) is strictly following the
;footsteps of the evolved warrior, which is weird considering the ease of improving it...
;assert CORESIZE == 8000

i2      equ 428
djnoff  equ 91
step    equ 3315

boot    mov imp, *2
        spl imp, {3333
        spl imp+i2, {5555
        djn.f #0, <-djnoff
jump    jmp #0, <-djnoff-1
        for 40
        dat 0, 0
        rof
init    spl boot, {1002
        add #step*2, 2
        mov imp, @1
        mov imp, *-1
        djn.f -3, <jump-djnoff-1
        for 8
        dat 0, 0
        rof
imp     mov.i #step, 1
        for 41
        dat 0, 0
        rof

org     qscan;from Core Warrior #92; i didn't optimize this for length-200 so as to keep the
                   ;components well separated that it would act as a useful decoy

qm      equ 3722
qm2     equ 2681

qa1     equ ((qtab1-1-found)*qm2+1)
qa2     equ ((qtab1-found)*qm2+1)
qb1     equ ((qtab2-1-found)*qm2+1)
qb2     equ ((qtab2-found)*qm2+1)
qb3     equ ((qtab2+1-found)*qm2+1)
qc      equ ((qtab3-found)*qm2+1)

        dat 7, qb1
qtab2   dat 7, qb2
        dat 7, qb3
        for 49
        dat 0, 0
        rof

qtab3   dat >-90, >qc
        for 5
        dat 0, 0
        rof
        dat 0, qa1
qtab1   dat -1, qa2
        for 5
        dat 0, 0
        rof
qscan   sne found+qm*qc, found+qm*qc+qb2
        seq <qtab3, found+qm*(qc-1)+qb2
        jmp q0, }q0
        sne found+qm*qa1, found+qm*qa1+qb2
        seq <(qtab1-1), found+qm*(qa1-1)+qb2
        djn.a q0, {q0
        sne found+qm*qa2, found+qm*qa2+qb2
        seq <qtab1, found+qm*(qa2-1)+qb2
        jmp q0, {q0
        sne found+qm*qb1, found+qm*qb1+qb1
        seq <(qtab2-1), found+qm*(qb1-1)+(qb1-1)
        jmp q0, {q2
        sne found+qm*qb3, found+qm*qb3+qb3
        seq <(qtab2+1), found+qm*(qb3-1)+(qb3-1)
        jmp q0, }q2
        sne found+qm*qb2, found+qm*qb2+qb2
        seq <qtab2, found+qm*(qb2-1)+(qb2-1)
        djn.f q0, <found+qm*(qb2-1)+(qb2-1)
        seq >found, found+qm+(qb2-1)
        jmp q1, <found
        seq found+(qm+1)*(qc-1), found+(qm+1)*(qc-1)+(qb2-1)
        jmp q0, }q0
        seq found+(qm+1)*(qa2-1), found+(qm+1)*(qa2-1)+(qb2-1)
        jmp q0, {q0
        seq found+(qm+1)*(qa1-1), found+(qm+1)*(qa1-1)+(qb2-1)
        djn.a q0, {q0
        jmz.f init, found+(qm+1)*(qb2-1)+(qb2-1)
q0      mul.b *q2, found
q1      sne {qtab1, @found
q2      add.b qtab2, found
        mov qtab3, @found
found   mov qtab3, }qm
        add #5, found
        djn -3, #20
        djn.f init, @found

end
