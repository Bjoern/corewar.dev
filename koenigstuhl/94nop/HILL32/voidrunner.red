;redcode-94nop
;name Void Runner
;author John Metcalf
;strategy stone/imp
;assert CORESIZE==8000

        org    qscan

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

        for    47
        dat    0,0
        rof

        iboot  equ idesta+1811

warr    spl    1,            <7500
        spl    1,            <1800
        mov    <isrc,        {idesta
        mov    <imp+1,       {idestb
        mov    {imp+1,       {idestc
        spl    1,            <4700
        mov    {ssrc,        {sdest
sdest   spl    *3960,        <4300
idesta  spl    *iboot,       <3100
idestb  spl    *iboot+2667,  <2900
idestc  djn.f  *iboot+2667*2,<2500

        step   equ 5557
        time   equ 1692
        first  equ (last+step*time)

ssrc    spl    #0+8
ss      spl    #0
stone   mov    sbmb,         @ptr
last    sub.x  #step*2,      @stone
ptr     mov    {(1487),      }first
        djn.f  @last,        }ptr

        dat 0,0

sbmb    dat    }step,        >1

        istep  equ 1143

isrc    spl    #0,           0+4
        add.f  #istep,       launch
launch  djn.f  imp-istep*8,  <7131

imp     mov.i  #istep,       *0

        end

