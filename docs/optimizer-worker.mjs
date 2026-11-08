// SPDX-License-Identifier: GPL-2.0-or-later
// One message per job: one match (runMatch), or one candidate against a list of opponents
// (runBatch, a job with `opponents`), or several duels (runDuels, a job with `duels`). exMARS keeps
// the warriors loaded between messages.
import {runMatch,runBatch,runDuels} from './optimizer-fitness.mjs';
self.onmessage=async({data})=>{self.postMessage({id:data.id,result:await (data.job.opponents?runBatch(data.job):data.job.duels?runDuels(data.job):runMatch(data.job))});};
