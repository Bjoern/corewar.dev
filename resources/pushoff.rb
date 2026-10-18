# Sequential push off using Koenigstuhl format
# hill32.dat and hill32.score files.

dat = File.read('hill32.dat').encode('UTF-8', invalid: :replace).split(/\r?\n/)
warrs = dat.shift.to_i
dat = dat.each_slice(4).to_a
scores = File.read('hill32.scores').unpack('l*').each_slice(warrs).to_a.transpose

while dat.length > 1
  scoresum = scores.map(&:sum)
  lowest = scoresum.each_with_index.min.last
  puts "#{dat.length}  #{format('%3.3f', scoresum[lowest] / 1e4 / (dat.length - 1))}  \"#{dat[lowest][0]}\" by #{dat[lowest][1]}"
  dat.delete_at(lowest)
  scores.delete_at(lowest)
  scores.each { |row| row.delete_at(lowest) }
end

puts "1  .......  \"#{dat[0][0]}\" by #{dat[0][1]}"


