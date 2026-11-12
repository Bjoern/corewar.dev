;redcode-94nop
;name Pendulum (decoy)
;author John Metcalf
;strategy .75c scanner
;assert CORESIZE==8000

        org    boot

        step   equ 4009
        ptr    equ (inc-2*step)

bomb    spl    #0,         {0

wipe    mov    @last,      <ptr
        mov    >ptr,       >ptr
        jmn.f  wipe,       >ptr

reset   mov.ab @wipe+1,    @wipe+1

scan    sub.x  inc,        @wipe+1
        sne.x  *ptr,       >ptr
inc     sub.f  #-step,     ptr
        jmz.f  scan,       <ptr

        slt    @wipe+1,    #last+5-ptr
        djn    wipe,       @wipe+1
        djn    reset,      #21
last    djn.f  inc,        #bomb

        bdist  equ boot+230

boot    mov    bomb+12,    bdist+12
        for    12
        mov    {boot,      <boot
        rof
        jmp    bdist+5,    <1000

        spl    #0,         0

        for    (MAXLENGTH-CURLINE)/3
        spl    #0,         {0
        spl    #0,         }0
        spl    #0,         0
        rof

        end

