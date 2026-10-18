# Infinite Diversity Hill using Koenigstuhl-format score files.
#
# Iteratively removes warriors based on the diversity numeric discriminant:
# average score multiplied by Euclidean distance to the nearest warrior.
# Based on "A Numeric Approach to Diversity Hills" by Achille Astolfi:
# https://corewar.co.uk/astolfi/diversity.htm

hill = 'hill32'
dat = File.read("#{hill}.dat").encode('UTF-8', invalid: :replace).split(/\r?\n/)
warrs = dat.shift.to_i
dat = dat.each_slice(4).to_a
scores = File.read("#{hill}.scores").unpack('l*').each_slice(warrs).to_a.transpose

scores.each_with_index { |row, i| row[i] = 0 }

while dat.length > 1
  wardisc = []
  warrs -= 1
  scores.each_with_index do |x, i|
    mindist = Float::INFINITY
    scores.each_with_index do |y, j|
      mindist = [mindist, x.each_index.sum { |k| (x[k] - y[k])**2 }].min if i != j
    end
    mindist = Math.sqrt(mindist / warrs) / 3e6
    wardisc << [mindist * x.sum / warrs / 1e4, mindist, x.sum / warrs / 1e4]
  end
  lowest = wardisc.each_with_index.min.last
  puts "#{warrs + 1}  #{wardisc[lowest].map { |v| format('%7.3f', v) }.join('  ')}  \"#{dat[lowest][0]}\" by #{dat[lowest][1]}"
  dat.delete_at(lowest)
  scores.delete_at(lowest)
  scores.each { |row| row.delete_at(lowest) }
end

puts "1#{' ' * 29}\"#{dat[0][0]}\" by #{dat[0][1]}"

