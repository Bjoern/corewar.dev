;redcode-94nop
;name Eye of the Storm '94
;author John Metcalf
;strategy qscan -> stone/imp
;assert CORESIZE==8000

        qfac   equ 953
        qdec   equ 4618 ; qdec = (1+qfac^-1) mod 8000

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
qtab0   jmp    warr,         <qb
qtab2   dat    qgap,         qf

        for    41
        dat    0,0
        rof

        istep  equ 2667 ; (CORESIZE+1)/3

        lpos   equ (warr+7209)
        ipos   equ (warr+5872)
        spos   equ (warr+7226)

warr    spl    sboot,        }3100
        spl    iboot,        }6600

        mov    imp,          ipos

        spl    4,            <7400
        spl    2,            <3000
        djn.f  ipos+istep*0, <5300
        djn.f  ipos+istep*1, <4500
        spl    2,            <2500
        djn.f  ipos+istep*2, <5000
        djn.f  ipos+istep*3, <7600

iboot   mov     launch+2,    *l
        mov     launch+1,    {l
        mov     launch,      {l
l       djn.f   lpos+2,      <5000

imp     mov.i  #3,           istep

launch  spl    #0
        add.a  #istep+1,     lptr
lptr    djn.f  ipos-lpos+1,  <7656

sboot   spl    2,            <3900
        spl    1,            <4100
        spl    1,            <6300
        mov    <sfrom,       {s
s       djn.f  spos+6,       <5300

        gap    equ -12
        sstep  equ 6744

sfrom   spl    #0,           stone+5
stone   mov    dbmb,         <hit-sstep
hit     mov    dbmb,         @stone
        sub    #sstep,       @hit
        djn.f  stone,        <7885
dbmb    dat    <1,           <gap+1+sstep

        end    qscan

