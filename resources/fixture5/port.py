# Faithful Python port of resources/pushoff.rb and diversity.rb, plus the SD-score variant.
import math, struct, sys
names="ABCDE"
s={'A':{'A':1.4,'B':2.0,'C':1.0,'D':1.5,'E':2.2},
   'B':{'A':0.5,'B':1.3,'C':1.0,'D':1.5,'E':2.1},
   'C':{'A':1.8,'B':1.6,'C':1.0,'D':0.4,'E':0.9},
   'D':{'A':1.2,'B':1.0,'C':2.4,'D':1.2,'E':1.3},
   'E':{'A':0.6,'B':0.7,'C':1.9,'D':1.4,'E':1.1}}
n=len(names)
# file[row][col] = col's score vs row, points/round * 1e6
file=[[round(s[c][r]*1e6) for c in names] for r in names]
open('hill32.scores','wb').write(struct.pack('<%dl'%(n*n),*sum(file,[])))
open('hill32.dat','w').write(f"{n}\n"+"".join(f"{w}\nauthor{w}\n{w.lower()}.red\n94\n" for w in names))
def load():
    raw=struct.unpack('<%dl'%(n*n),open('hill32.scores','rb').read())
    rows=[list(raw[i*n:(i+1)*n]) for i in range(n)]
    return [list(c) for c in zip(*rows)], list(names)   # transpose: vec[i][j]=i's score vs j
def pushoff():
    sc,dat=load(); out=[]
    while len(dat)>1:
        sums=[sum(r) for r in sc]; lo=min(range(len(sums)),key=lambda i:(sums[i],i))
        out.append(f"{len(dat)}  {sums[lo]/1e4/(len(dat)-1):.3f}  {dat[lo]}")
        del dat[lo]; del sc[lo]; [r.pop(lo) for r in sc]
    out.append(f"1  .......  {dat[0]}"); return out
def diversity(sd=False):
    sc,dat=load(); out=[]
    for i,r in enumerate(sc): r[i]=0
    w=n
    while len(dat)>1:
        w-=1; rows=[]
        if sd:
            m=len(sc); sig=0
            for k in range(m):
                col=[sc[r][k] for r in range(m)]; mu=sum(col)/m
                sig+=math.sqrt(sum((v-mu)**2 for v in col)/m)
        for i,x in enumerate(sc):
            md=math.inf
            for j,y in enumerate(sc):
                if i!=j:
                    d=sum(abs(a-b) for a,b in zip(x,y)) if sd else sum((a-b)**2 for a,b in zip(x,y))
                    md=min(md,d)
            md = md/sig if sd else math.sqrt(md/w)/3e6
            avg=sum(x)/w/1e4
            rows.append(([md*avg,md,avg],i))
        (vals,lo)=min(rows)
        out.append(f"{w+1}  "+"  ".join(f"{v:7.3f}" for v in vals)+f"  {dat[lo]}")
        del dat[lo]; del sc[lo]; [r.pop(lo) for r in sc]
    out.append(f"1  {dat[0]}"); return out
for name,f in [("pushoff",pushoff),("diversity",diversity),("sd",lambda:diversity(True))]:
    print("==",name); print("\n".join(f()))
