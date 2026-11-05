// SPDX-License-Identifier: GPL-2.0-or-later
// One optimizer match per message; each match gets a fresh engine (see runMatch).
import {runMatch} from './optimizer-fitness.mjs';
self.onmessage=async({data})=>{self.postMessage({id:data.id,result:await runMatch(data.job)});};
