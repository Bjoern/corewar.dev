# Tournament Scheduler v0.2 by John Metcalf

# Run all *.red in the current directory against each other (with self fights)
# Saves the results in Koenigstuhl-format hill32.dat and hill32.scores files

# v0.2 - parallel battles, added self fights

# Usage: $ ruby scheduler.rb

ROUNDS = 1000
MAXTHREADS = 16

dat = []
Dir.glob('*.red').each do |war|
  winfo = `./pmars #{war}`.split('"')
  dat << [winfo[1], winfo[3], war, '94']
end
File.write('hill32.dat', "#{dat.length}\n#{dat.join("\n")}\n")

battle = 0
scores = Array.new(dat.length) { Array.new(dat.length, 0) }
mutex = Mutex.new
queue = Queue.new

dat.each_index do |war1|
  (war1...dat.length).each do |war2|
    queue << [war1, war2]
  end
end

threads = Array.new(MAXTHREADS) do
  Thread.new do
    loop do
      war1, war2 = queue.pop(true) rescue break
      score = `./pmars #{dat[war1][2]} #{dat[war2][2]} -k -b -r #{ROUNDS} -F 7293`.split
      mutex.synchronize do
        battle += 1
        scores[war1][war2] = (3 * score[2].to_i + score[3].to_i) * 1000000 / ROUNDS
        scores[war2][war1] = (3 * score[0].to_i + score[1].to_i) * 1000000 / ROUNDS
        puts "Battle #{battle} of #{(dat.length**2 + dat.length) / 2}:"
        puts "#{dat[war1][0]} by #{dat[war1][1]} scores #{3 * score[0].to_i + score[1].to_i}"
        puts "#{dat[war2][0]} by #{dat[war2][1]} scores #{3 * score[2].to_i + score[3].to_i}\n\n"
      end
    end
  end
end

threads.each(&:join)

File.write('hill32.scores', scores.flatten.pack('L<*'), mode: 'wb')

