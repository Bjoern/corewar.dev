"""Small genetic optimizer over a cwopt template's markers.

Usage (from the project root):
    python3 tools/ga.py --hill standard --template warriors/x/x_tmpl.red --bench benchmarks/ssr5bm \
        --time 60m --pop 40 --out warriors/x/ga_x

Each generation is scored on a fresh seed (common to all individuals in that
generation), and scores accumulate per genome across generations, so survivors
that keep winning are measured on more and more rounds. Writes <out>.log,
<out>.best.red and <out>.best.template.red.
"""
import argparse, os, random, sys, time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from cwopt.hills import get_hill                                   # noqa: E402
from cwopt.template import parse_template                          # noqa: E402
from cwopt.engine import default_assembler, AssemblyError, engine_version  # noqa: E402
from cwopt.bench import load_bench, read_source                    # noqa: E402
from cwopt.fitness import Schedule, Evaluator, WorkerPool, ScoreCache     # noqa: E402


def parse_time(s):
    return float(s[:-1]) * {"s": 1, "m": 60, "h": 3600}[s[-1]] if s[-1] in "smh" else float(s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hill", required=True)
    ap.add_argument("--template", required=True)
    ap.add_argument("--bench", required=True)
    ap.add_argument("--seed-template", action="append", default=[],
                    help="template (best.template.red) whose values seed the population")
    ap.add_argument("--time", default="60m")
    ap.add_argument("--pop", type=int, default=40)
    ap.add_argument("--elite", type=int, default=6)
    ap.add_argument("--rounds", type=int, default=250)
    ap.add_argument("--workers", type=int, default=None)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    rng = random.Random(a.seed)
    hill = get_hill(a.hill)
    hill.check_runnable()
    tmpl = parse_template(read_source(a.template), hill.constants())
    sizes = [v.size for v in tmpl.variables]
    names = [v.name for v in tmpl.variables]
    asm = default_assembler()
    bench, _ = load_bench(hill, [a.bench])
    opps = [b.warrior for b in bench]
    pool = WorkerPool(a.workers)
    ev = Evaluator(hill, pool, ScoreCache(), engine_version(hill.module, hill.module_path))
    log = open(a.out + ".log", "a")

    def say(msg):
        line = time.strftime("%H:%M:%S ") + msg
        print(line, flush=True)
        log.write(line + "\n")
        log.flush()

    stats = {}      # genome -> [sum of scores, evaluations]
    broken = set()

    def evaluate(g, sch):
        if g in broken:
            return None
        try:
            w = asm.assemble(hill, tmpl.render(list(g)))
        except AssemblyError:
            broken.add(g)
            return None
        s = ev.evaluate(w, opps, sch).score
        st = stats.setdefault(g, [0.0, 0])
        st[0] += s
        st[1] += 1
        return s

    def mean(g):
        st = stats.get(g)
        return st[0] / st[1] if st and st[1] else -1.0

    def rand_genome():
        return tuple(rng.randrange(n) for n in sizes)

    def mutate(g):
        g = list(g)
        k = 0
        while k == 0:
            for i, n in enumerate(sizes):
                if rng.random() < 1.5 / len(sizes):
                    k += 1
                    if n > 100 and rng.random() < 0.7:
                        g[i] = (g[i] + rng.choice([-1, 1]) * int(rng.expovariate(1 / 15) + 1)) % n
                    else:
                        g[i] = rng.randrange(n)
        return tuple(g)

    def cross(x, y):
        return tuple(x[i] if rng.random() < 0.5 else y[i] for i in range(len(sizes)))

    def tourney(popl):
        c = rng.sample(popl, 3)
        return max(c, key=mean)

    # seed population: template start values, seed templates, then random
    start = tuple(s if s is not None else rng.randrange(n) for s, n in zip(tmpl.start_indices(), sizes))
    popl = [start]
    for p in a.seed_template:
        t2 = parse_template(read_source(p), hill.constants())
        vals = {v.name: str(v.values[v.start]) for v in t2.variables if v.start is not None}
        idx = tmpl.indices_from_values(vals)
        popl.append(tuple(i if i is not None else s for i, s in zip(idx, start)))
    while len(popl) < a.pop:
        popl.append(mutate(rng.choice(popl)) if rng.random() < 0.5 else rand_genome())

    t_end = time.time() + parse_time(a.time)
    gen = 0
    best_written = None
    while time.time() < t_end:
        sch = Schedule.sampled(hill, a.seed, 1000 + gen, a.rounds, 1)
        for g in popl:
            evaluate(g, sch)
            if time.time() > t_end:
                break
        ranked = sorted(set(popl), key=mean, reverse=True)
        # trust a genome only once it has been seen on at least 2 seeds
        trusted = [g for g in ranked if stats.get(g, [0, 0])[1] >= 2] or ranked
        top = trusted[0]
        say(f"gen {gen:3d}  best {mean(top):7.2f} (n={stats[top][1]})  "
            f"pop median {mean(ranked[len(ranked) // 2]):6.2f}  "
            + " ".join(f"{n}={tmpl.variables[i].values[top[i]]}" for i, n in enumerate(names)))
        if top != best_written:
            open(a.out + ".best.red", "w").write(tmpl.render(list(top)))
            open(a.out + ".best.template.red", "w").write(tmpl.write_back(list(top)))
            best_written = top
        elites = ranked[:a.elite]
        nxt = list(elites)
        while len(nxt) < a.pop:
            r = rng.random()
            if r < 0.45:
                child = mutate(cross(tourney(ranked), tourney(ranked)))
            elif r < 0.9:
                child = mutate(tourney(ranked))
            else:
                child = rand_genome()
            if child not in nxt:
                nxt.append(child)
        popl = nxt
        gen += 1
    say(f"done after {gen} generations; best written to {a.out}.best.red")
    pool.close()


if __name__ == "__main__":
    main()
