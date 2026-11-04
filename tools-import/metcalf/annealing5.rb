# Simulated Annealing Core War Optimizer v0.5 by John Metcalf

# Reads the code to be optimized from template.txt.  Replaces any '!'
# with values 0..CORESIZE-1 and any '!%xxxx` with values 0..xxxx-1.
# Benchmarks against all *.red in the current directory.

# In each step, one or more variables are modified.  Higher-scoring
# candidates are always accepted.  Lower-scoring candidates may be
# accepted based on the score difference and a gradually increasing
# probability, which is reset to zero when a candidate is accepted.

# v0.2 - modified temp schedule, normalised scores, and log file
# v0.3 - parallel benchmark, range for variables, and output best.rc
# v0.4 - store scores in a hash, restart using high score from opt.log
# v0.5 - scale temp schedule: stable behaviour for diff bench size/rounds

# Usage: $ ruby annealing5.rb

CORESIZE = 8000
ROUNDS = 250

benchmark = Dir.glob('*.red')
template = File.read('template.txt').split('!')
bound = template[1..-1].map { |x| x[0] == '%' ? x[1..-1].to_i : CORESIZE }
state = statenew = bound.map { |x| rand(x) }
best = temp = energy = 0
mutex = Mutex.new
hash = {}
filenum = '%04x' % rand(0x10000)

if File.exist?('opt.log')
  high = 0.0
  File.foreach('opt.log') do |log|
    log = log.strip.split(':').map(&:strip)
    statenew = log[1].tr('[]', '').split(',').map(&:to_i) if high < log[0].to_f
    high = [high, log[0].to_f].max
  end
  puts "Restarting using highest score from opt.log... #{high} : #{statenew}"
end

state.each_index.cycle do |i|
  unless hash.empty?
    statenew = state.zip(bound).map { |x, y| (x.dup + (rand < 0.1 ? rand(-20..20) : 0)) % y }
    statenew[i] = rand < 0.5 ? rand(bound[i]) : (statenew[i] + rand(-20..20)) % bound[i]
  end

  energynew = hash.fetch(statenew) do
    File.write("cand_#{filenum}.rc", template.zip(statenew).flatten.join)
    energynew = 0
    threads = benchmark.each.map do |war|
      Thread.new do
        score = `./exmars cand_#{filenum}.rc #{war} -k -b -r #{ROUNDS} -F 7293`.split
        mutex.synchronize { energynew += 3 * score[0].to_i + score[1].to_i }
      end
    end
    threads.each(&:join)
    hash[statenew] = energynew
  end

  temp += 1
  next if Math.exp((energynew - energy) * 15000 / benchmark.size / ROUNDS / temp) < rand
  energy = energynew
  state = statenew.map(&:dup)
  puts "#{((energy * 1e2) / benchmark.size / ROUNDS).round(3)} : #{state} : #{temp}"
  File.write('opt.log', "#{((energy * 1e2) / benchmark.size / ROUNDS).round(3)} : #{state} : #{temp}\n", mode: 'a')
  File.write("best_#{filenum}.rc", template.zip(state).flatten.join) if energy > best
  best = [best, energy].max
  temp = 0
end

