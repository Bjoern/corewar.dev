# John Metcalf's steady-state genetic optimizer (resources/genetic2.rb, v0.2),
# ported to the exMARS Ruby binding and to cwopt templates.
#
# The algorithm is unchanged: tournament selection (3 and 1), uniform,
# single-point, BLX-a or no crossover, creep and random-reset mutation, 5%
# immigrants, and deterministic crowding (the child replaces the most similar
# warrior that scores lower). Each warrior is scored once, 250 rounds against
# every benchmark warrior with the position series of -F 7293.
#
# Differences: battles run in-process in forked workers (no exmars processes,
# no candidate files); several children are evaluated at once, one per worker;
# genes are indices into the template's value lists, so every cwopt marker
# works; the state is saved every few minutes and can be resumed.
#
# Usage (from the project root, after building the binding into exMARS/build/ruby):
#   ruby -I../exMARS/build/ruby tools/genetic2.rb --template T.red --bench DIR \
#       --out warriors/x/g2_x [--time 3h] [--workers 8] [--seed 1] [--resume]
# Writes <out>.log, <out>.best.red, <out>.best.template.red and <out>.state.json.

require 'Mars'
require 'json'
require 'optparse'

ROUNDS = 250
POPSIZE = 50  # population size
TOURX = 3     # tournament size for parent x
TOURY = 1     # tournament size for parent y
IPROB = 0.05  # random immigration rate
BPROB = 0.50  # BLX-a crossover rate
RPROB = 0.08  # random-reset mutation rate
CPROB = 0.10  # creep (incremental) mutation rate
CREEP = 20    # creep magnitude
FIXED = 7293  # position series, as exmars -F 7293
SAVE_EVERY = 300

opt = { time: '3h', workers: `sysctl -n hw.ncpu`.to_i, seed: nil, resume: false }
OptionParser.new do |o|
  o.on('--template FILE') { |v| opt[:template] = v }
  o.on('--bench DIR') { |v| opt[:bench] = v }
  o.on('--out PREFIX') { |v| opt[:out] = v }
  o.on('--time T', 'run time, e.g. 90m or 3h') { |v| opt[:time] = v }
  o.on('--workers N', Integer) { |v| opt[:workers] = v }
  o.on('--seed N', Integer) { |v| opt[:seed] = v }
  o.on('--resume', 'continue from <out>.state.json') { opt[:resume] = true }
end.parse!
abort 'need --template, --bench and --out' unless opt[:template] && opt[:bench] && opt[:out]

seconds = opt[:time].to_f * { 's' => 1, 'm' => 60, 'h' => 3600 }.fetch(opt[:time][-1], 1)
srand(opt[:seed]) if opt[:seed]
tmpl = JSON.parse(`python3 #{File.join(__dir__, 'export_template.py')} --hill standard #{opt[:template]}`)
abort 'template export failed' unless $?.success?
vars = tmpl['variables']
bound = vars.map { |v| v['values'].size }

render = lambda do |g, write_back = false|
  tmpl['segments'].map do |s|
    next s if s.is_a?(String)
    v = vars[s]
    val = v['values'][g[s]]
    next "#{v['spec']}:#{val}" if write_back
    v['paren'] && val.start_with?('-') ? "(#{val})" : val
  end.join
end
describe = ->(g) { vars.each_with_index.map { |v, i| "#{v['name']}=#{v['values'][g[i]]}" }.join(' ') }

benchmark = Dir.glob(File.join(opt[:bench], '*.red'), File::FNM_CASEFOLD).sort
abort "no warriors in #{opt[:bench]}" if benchmark.empty?

# Workers: each parses the benchmark once, then scores source texts sent over a pipe.
workers = Array.new(opt[:workers]) do
  down_r, down_w = IO.pipe
  up_r, up_w = IO.pipe
  pid = fork do
    down_w.close
    up_r.close
    mars = Mars.standard(2)
    mars.rounds = ROUNDS
    mars.fixed_position = FIXED
    opps = benchmark.map { |f| mars.parse(f) }
    $stdout.reopen(File::NULL)   # assembler warnings for broken candidates
    loop do
      src = Marshal.load(down_r)
      energy =
        begin
          w = mars.parse_string(src)
          raise ArgumentError if w.instructions.empty?
          opps.sum do |o|
            mars.fight(w, o)
            won, tied = mars.results_str.lines[0].split.map(&:to_i)
            3 * won + tied
          end
        rescue ArgumentError
          -1
        end
      Marshal.dump(energy, up_w)
      up_w.flush
    end
  rescue EOFError
    exit!(0)
  end
  down_r.close
  up_w.close
  { pid: pid, down: down_w, up: up_r, job: nil }
end

state_file = "#{opt[:out]}.state.json"
fitness = {}
population = []
best = 0
evals = 0
if opt[:resume]
  st = JSON.parse(File.read(state_file))
  st['fitness'].each { |g, e| fitness[JSON.parse(g)] = e }
  population = st['population']
  best = st['best']
  evals = st['evals']
end

log = File.open("#{opt[:out]}.log", 'a')
say = lambda do |msg|
  line = Time.now.strftime('%H:%M:%S ') + msg
  puts line
  $stdout.flush
  log.puts line
  log.flush
end
pct = ->(e) { ((e * 1e2) / benchmark.size / ROUNDS).round(3) }
save = lambda do
  File.write(state_file + '.tmp', JSON.generate(
    'template' => opt[:template], 'bench' => opt[:bench], 'best' => best, 'evals' => evals,
    'population' => population, 'fitness' => fitness.map { |g, e| [JSON.generate(g), e] }.to_h))
  File.rename(state_file + '.tmp', state_file)
end

say.call("#{opt[:resume] ? 'resume' : 'start'} #{opt[:template]} vs #{opt[:bench]} " \
         "(#{benchmark.size} warriors, #{workers.size} workers, #{bound.size} genes)")

# The original loop, with the evaluation split off so children can wait for a worker.
breed = lambda do
  if population.size < 10 || rand < IPROB
    bound.map { |x| rand(x) }
  else
    px = Array.new(TOURX) { population.sample }.max_by { |w| fitness[w] }
    py = Array.new(TOURY) { population.sample }.max_by { |w| fitness[w] }
    candidate =
      case rand(4)
      when 0  # uniform crossover
        px.zip(py).map { |x, y| rand < 0.5 ? x : y }
      when 1  # single-point crossover
        point = rand(px.length)
        px.take(point) + py.drop(point)
      when 2  # BLX-a crossover
        px.zip(py, bound).map do |x, y, b|
          rand < BPROB ? ([x, y].min + rand((x - y).abs * -0.3..(x - y).abs * 1.3).to_i) % b : x
        end
      else    # no crossover
        px
      end
    candidate = candidate.zip(bound).map { |x, b| rand < CPROB ? (x + rand(-CREEP..CREEP)) % b : x }
    candidate.zip(bound).map { |x, b| rand < RPROB ? rand(b) : x }
  end
end

insert = lambda do |candidate|
  population << candidate
  energy = fitness[candidate]
  if population.size > POPSIZE
    population.delete(population.select { |w| fitness[w] < energy }
      .min_by { |w| [candidate.zip(w).count { |x, y| x != y }, fitness[w]] } || candidate)
  end
  next if energy < best
  improved = energy > best
  best = energy
  say.call("#{pct.call(energy)} : #{describe.call(candidate)}") if improved
  File.write("#{opt[:out]}.best.red", render.call(candidate))
  File.write("#{opt[:out]}.best.template.red", render.call(candidate, true))
end

t_end = Time.now + seconds
last_save = Time.now
last_status = Time.now
until Time.now > t_end
  idle = workers.find { |w| w[:job].nil? }
  if idle
    candidate = breed.call
    next if population.include?(candidate) || workers.any? { |w| w[:job] == candidate }
    if fitness.key?(candidate)
      insert.call(candidate)
    else
      idle[:job] = candidate
      Marshal.dump(render.call(candidate), idle[:down])
      idle[:down].flush
    end
    next
  end
  ready, = IO.select(workers.map { |w| w[:up] })
  ready.each do |io|
    w = workers.find { |x| x[:up] == io }
    fitness[w[:job]] = Marshal.load(io)
    evals += 1
    candidate = w[:job]
    w[:job] = nil
    insert.call(candidate) unless population.include?(candidate)
  end
  if Time.now - last_status > 600
    scores = population.map { |g| fitness[g] }.sort
    say.call("#{evals} evals, best #{pct.call(best)}, pop median #{pct.call(scores[scores.size / 2])}, " \
             "worst #{pct.call(scores[0])}")
    last_status = Time.now
  end
  if Time.now - last_save > SAVE_EVERY
    save.call
    last_save = Time.now
  end
end

# Siblings hold copies of each other's pipes, so closing them would not end the workers.
workers.each { |w| Process.kill('TERM', w[:pid]) }
Process.waitall
save.call
say.call("done after #{evals} evals; best #{pct.call(best)} written to #{opt[:out]}.best.red")
