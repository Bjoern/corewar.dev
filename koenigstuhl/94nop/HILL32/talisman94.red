;redcode-94nop
;name Talisman'94
;author John Metcalf
;strategy stone/imp
;assert CORESIZE==8000

        org    qscan

        qfac   equ 953
        qdec   equ 4618

        qa     equ (qfac*(qtab0-1-qptr)+1)
        qb     equ (qfac*(qtab0-qptr)+1)
        qc     equ (qfac*(qtab1-1-qptr)+1)
        qd     equ (qfac*(qtab1-qptr)+1)
        qe     equ (qfac*(qtab1+1-qptr)+1)
        qf     equ (qfac*(qtab2-qptr)+1)

        qtime  equ 22
        qstep  equ -5
        qgap   equ 71

qdecode mul.b  *q1,          qptr
q0      sne    {qtab0,       @qptr
q1      add.b  qtab1,        qptr
q2      mov    qtab2,        @qptr
qptr    mov    qtab2,        *qdec
        add    #qstep,       qptr
        djn    q2,           #qtime
        jmp    warr,         <qc
qtab1   dat    4000,         qd
        dat    4000,         qe

qscan   sne    qptr+qdec*qe, qptr+qdec*qe+qe
        seq    <qtab1+1,     qptr+qdec*(qe-1)+qe-1
        jmp    qdecode,      }q1
        sne    qptr+qdec*qb, qptr+qdec*qb+qd
        seq    <qtab0,       qptr+qdec*(qb-1)+qd
        jmp    qdecode,      {qdecode
        sne    qptr+qdec*qa, qptr+qdec*qa+qd
        seq    <qtab0-1,     qptr+qdec*(qa-1)+qd
        djn.a  qdecode,      {qdecode
        sne    qptr+qdec*qf, qptr+qdec*qf+qd
        seq    <qtab2,       qptr+qdec*(qf-1)+qd
        jmp    qdecode,      }qdecode
        sne    qptr+qdec*qc, qptr+qdec*qc+qc
        seq    <qtab1-1,     qptr+qdec*(qc-1)+qc-1
        jmp    qdecode,      {q1
        sne    qptr+qdec*qd, qptr+qdec*qd+qd
        seq    <qtab1,       qptr+qdec*(qd-1)+qd-1
        jmp    qdecode,      <qa
qtab0   djn.f  warr,         <qb
qtab2   dat    qgap,         qf

        for    49
        dat    0,0
        rof

        sdist equ (warr+7019)
        ldist equ (sdist+34)
        idist equ 169
        bdist equ 10%20

warr    mov    imp,          ldist+idist+2
        mov    imp,          <warr
        mov    imp,          <warr
        mov    sbomb,        sdist+bdist
        spl    2,            <6000
        spl    2,            <3000
        spl    1,            <3500
        mov    <launch,      {lboot
        mov    <stone-1,     {sboot
sboot   djn    sdist+5,      #5
lboot   jmp    ldist+5,      <5700

        step   equ 2211
        time   equ 1819
        hop    equ 20

        spl    #0,           0+5
stone   mov    stone+bdist-1,<hit+time*step
hit     mov    stone+bdist-1,@stone
        sub    #step,        @hit
        djn.f  stone,        <1765

sbomb   dat    <1-hop,       <1-hop

        istep  equ 2667

imp     mov.i  #3,           istep

launch  spl    #0,           0+5
        add.f  #istep+1,     iptr
iptr    djn.f  launch+idist-istep-1, <4883

        end

