// SPDX-License-Identifier: GPL-2.0-or-later
// One message per job: one match (runMatch), or one candidate against a list of opponents
// (runBatch, a job with `opponents`). exMARS keeps the warriors loaded between messages.
import {runMatch,runBatch} from './optimizer-fitness.mjs';
self.onmessage=async({data})=>{self.postMessage({id:data.id,result:await (data.job.opponents?runBatch(data.job):runMatch(data.job))});};
