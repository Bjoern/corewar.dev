# Steady-State Genetic Algorithm Core War Optimizer v0.2 by John Metcalf

# Reads the code to be optimized from template.txt.  Replaces any '!'
# with values 0..CORESIZE-1 and any '!%xxxx` with values 0..xxxx-1.
# Benchmarks against all *.red in the current directory.

# Each generation uses tournament selection to choose two parents which are
# combined using uniform, single-point, or BLX-a crossover.  Random-reset and
# incremental mutation are applied to the offspring, which is added to the
# population, after which the most similar lower-scoring warrior is removed.

# v0.2 - added BLX-a crossover, no crossover, and deterministic crowding

# Usage: $ ruby genetic2.rb

CORESIZE = 8000
ROUNDS = 250
POPSIZE = 50  # population size
TOURX = 3     # tournament size for parent x
TOURY = 1     # tournament size for parent y
IPROB = 0.05  # random immigration rate
BPROB = 0.50  # BLX-a crossover rate
RPROB = 0.08  # random-reset mutation rate
CPROB = 0.10  # creep (incremental) mutation rate
CREEP = 20    # creep magnitude

benchmark = Dir.glob('*.red')
template = File.read('template.txt').split('!')
bound = template[1..-1].map { |x| x[0] == '%' ? x[1..-1].to_i : CORESIZE }
mutex = Mutex.new
fitness = {}
filenum = format('%04x', rand(0x10000))
population = []
best = 0

loop do
  if population.size < 10 || rand < IPROB
    candidate = bound.map { |x| rand(x) }
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
    candidate = candidate.zip(bound).map { |x, b| rand < RPROB ? rand(b) : x }
  end
  next if population.include?(candidate)

  population << candidate
  energy = fitness[candidate]
  if energy.nil?
    File.write("cand_#{filenum}.rc", template.zip(candidate).flatten.join)
    energy = 0
    threads = benchmark.map do |war|
      Thread.new do
        s = `./exmars cand_#{filenum}.rc #{war} -k -b -r #{ROUNDS} -F 7293`.split
        mutex.synchronize do
          energy += 3 * s[0].to_i + s[1].to_i
        end
      end
    end
    threads.each(&:join)
    fitness[candidate] = energy
  end

  if population.size > POPSIZE
    population.delete(population.select { |w| fitness[w] < energy }
      .min_by { |w| [candidate.zip(w).count { |x, y| x != y }, fitness[w]] } || candidate)
  end

  next if energy < best
  best = energy
  puts "#{((energy * 1e2) / benchmark.size / ROUNDS).round(3)} : #{candidate}"
  File.write('opt.log', "#{((energy * 1e2) / benchmark.size / ROUNDS).round(3)} : #{candidate}\n", mode: 'a')
  File.write("best_#{filenum}.rc", template.zip(candidate).flatten.join)
end

