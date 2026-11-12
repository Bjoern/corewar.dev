;redcode-94nop
;name Riptide
;author John Metcalf
;strategy paper/imp + paper/clear
;assert CORESIZE==8000

        org    qscan

        qfac   equ 7767
        qdec   equ 104

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
qptr    mov    qtab2,        {qdec
        add    #qstep,       qptr
        djn    q2,           #qtime
        jmp    warr,         <qc
qtab1   dat    warr,         qd
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
qtab2   dat    qgap+1,       qf

        for    48
        dat    0,0
        rof

warr    spl    1,            {6100
        spl    1,            {200
        spl    1,            {3900
        mov    {papera,      {boot1
        mov    {paperc,      {boot2
boot1   spl    *6390,        {6500
boot2   djn.f  *2850,        {5300

        step3  equ 7728
        step4  equ 2176
        step5  equ 1288

paperc  spl    @0+8,         <step3
        mov    }paperc,      >paperc
paperd  spl    @0,           }step4
        mov    }paperd,      >paperd
papere  spl    @0,           <step5
clr     mov    }papere,      >papere
        mov.i  #1,           <1
        djn    clr,          #-22

        step1  equ 1832
        istep  equ 1143

papera  spl    @0+8,         }step1
        mov    }papera,      >papera
        spl    #0
        add.x  imp,          launch
launch  djn.f  imp-istep*8,  <7153

        dat    0,0

imp     mov.i  #3,           istep

        end

