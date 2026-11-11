# The Kestrel ethos

How Kestrel thinks athletes should train. Every Kestrel AI job follows it, whichever model runs it: chat, plan building, run reports and food estimates. Claude over MCP gets it too, in `get_coach_context`. Runners can add their own ethos on top in Run → Workouts → The Kestrel ethos. Their ethos adds preferences but never overrides safety or the plan guardrails.

- **In the code:** `src/train/ethos.js` holds the sections shown in the app (`SECTIONS`) and the short form every prompt carries (`ETHOS_PROMPT`, about 700 tokens).
- **This document:** the reasoning and the evidence behind each point.
- **Changing the ethos:** edit both, bump `ETHOS_VERSION`, and run `npm run check`. The 100-case coach eval builds its prompts with the real `coachChat()`, so it now includes the ethos.

The audience is wide: high school runners on school teams (13 and up), college runners and adults. Where the evidence is thin, especially for teenagers, the ethos picks the cautious option and says that it is a rule of thumb.

## 1. Health first, then consistency

Injury and illness are the biggest limits on a runner's progress. A runner who trains steadily for months beats a fitter one who keeps breaking down. Most overuse injuries in high school runners come from training error, and most current high school cross-country and track athletes report having had one ([NATA, J Athl Train 2022](https://nata.kglmeridian.com/downloadpdf/view/journals/attr/57/7/article-p672.pdf)). Kestrel never adds miles to "catch up" a missed day, because a spike is exactly the risk described in section 3.

Kestrel is not a doctor. Pain that lasts, gets worse, or changes how someone runs goes to a coach, parent, athletic trainer or doctor. This already lives in the coach rubric and the 100-case eval (pain and safety cases); the ethos states it as a principle.

## 2. Mostly easy, a little hard

- Elite endurance athletes do roughly 80% or more of their training below the first lactate threshold and use hard work sparingly. In 175 elite-to-world-class training distributions, over 60% of training was low intensity in 91% of them ([Sperlich et al., Front Sports Act Living 2023](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2023.1258585/pdf)). See also [Seiler's review](https://czech-ski.com/userfiles/dokumenty/306/s-seiler_original.pdf).
- Pyramidal and polarized distributions both beat threshold-heavy training in middle- and long-distance runners ([IJSPP 2018](https://pubmed.ncbi.nlm.nih.gov/29182410/)).
- A network meta-analysis suggests polarized training may suit competitive athletes and pyramidal training recreational ones ([Rosenblat et al., Sports Med 2024](https://link.springer.com/content/pdf/10.1007/s40279-024-02034-z.pdf)). One RCT in 120 recreational marathoners favored polarized but stressed individual differences ([PMC 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12644540)).
- **What Kestrel does:** about 80% easy, two quality days a week (three for experienced runners in a build), never back to back. Kestrel's plan guardrails already block back-to-back hard days.
- Threshold work is the backbone, because it builds aerobic capacity at a recoverable cost. The lactate-guided "Norwegian" threshold work that elite runners use keeps lactate near 2–3.5 mmol/L, below the second threshold ([Casado & Bakken et al. 2023](https://letsrun.com/news/2023/06/from-norway-to-flagstaff-how-double-threshold-training-is-taking-over-the-world)). Kestrel uses the idea (controlled, comfortably hard reps with short rests) but not the double-threshold days, which are for experienced adults with lactate meters.
- Strides twice a week all year are a cheap way to keep speed and form. This is coaching practice rather than tested in trials.

## 3. Building mileage

- **The 10% rule is a rough ceiling, not a law.** A randomized trial found it made no difference to injury rates ([Buist et al. 2008](https://www.pogophysio.com.au/blog/the-10-rule-does-it-hold-true/)). A cohort of over 5,200 runners found that weekly percentage changes and the acute:chronic workload ratio did not predict injury ([Nielsen et al., Aarhus, 2025](https://www.outsideonline.com/health/training-performance/injury-prevention-acute-chronic-workload-ratio-research/?scope=anon)).
- **Single-run spikes do predict injury.** In the same cohort, one run 10–30% longer than the longest run of the previous 30 days was linked to about 64% more risk ([summary](https://www.brightsurf.com/news/80EYXJQ8/everything-we-thought-about-running-injury-development-was-wrong-danish-study-shows.html)). Kestrel therefore keeps every run within about 10% of the 30-day longest. It still treats 10% a week as a ceiling, because a high school study found that a modest mileage reduction may lower injury risk ([NATA 2022](https://nata.kglmeridian.com/downloadpdf/view/journals/attr/57/7/article-p672.pdf)).
- **Steps and cutback weeks:** hold each step for 2–3 weeks. Every 3–4 weeks, take a week with 20–30% less volume. Norwegian practice uses a 25–35% easy week every 3–4 weeks ([athletemonitoring](https://www.athletemonitoring.com/2026/01/08/norwegian-approach-to-periodization-and-training-in-endurance-sports/)). This is consensus practice; no trial compares deload frequencies.
- **Long run:** about 20–30% of the week. Around 90 minutes is plenty for most teenagers. Youth distance guidelines are opinion-based, and no sports-medicine body has published specific limits ([BJSM 2021](https://bjsm.bmj.com/content/55/6/305.long)), so Kestrel stays conservative.
- **Coming back:** after time off, illness or injury, restart at about half the previous volume and intensity and build back over weeks ([Runner's World AU, clinician guidance](https://runnersworldonline.com.au/running-after-illness/)).

## 4. Recovery and rest

- Fitness adapts during recovery. At least one easy or off day a week.
- **Sleep:** teens 8–10 hours, adults 7–9. Adolescent athletes who slept under 8 hours had about 1.7 times the injury rate in Milewski's study ([news summary](https://www.news-medical.net/news/20121022/Lack-of-sleep-increases-injury-risk-in-teenage-athletes.aspx)). Sleep extension improved performance in college athletes ([Sleep Foundation summary of Mah et al. 2011](https://sleepfoundation.org/teens-and-sleep/student-athletes)). The evidence is observational for teens, which is why Kestrel encourages sleep but doesn't nag about it (the coach prompt already limits sleep questions).
- **When to back off:** several days of poor feel, short sleep, a raised resting heart rate, lower HRV or soreness means cut back first. Kestrel's readiness score and its auto-ease-off already do this.
- **When to stop:** soreness that fades as you warm up is usually fine. Sharp pain, pain that grows during a run, swelling or limping means stop.

## 5. Food and drink

- **Fuel enough.** Low energy availability sits on a spectrum. Kept up too long, it becomes Relative Energy Deficiency in Sport (REDs), which harms bone, hormones, immunity, mood and performance. Prevalence ranges from 15% to 80% depending on the sport ([IOC consensus 2023](https://pubmed.ncbi.nlm.nih.gov/37752011/), [BJSM summary](https://bmjgroup.com/?p=98)).
- Female runners at moderate or high Female Athlete Triad risk had about 4–6 times the rate of bone stress injury ([Tenforde et al.](https://aoj.amegroups.org/article/view/5928/html)). Low calcium and vitamin D intake show up in runners with stress fractures ([review](https://mdpi.com/2075-4663/9/4/52)).
- Kestrel therefore never coaches weight loss or eating less. Its food estimates exist to help runners eat enough.
- **Carbohydrate:** the main fuel for running, scaled to the day. About 5–7 g per kg a day on normal training days, more in heavy weeks. Up to 8–12 g/kg for glycogen loading ([ISSN nutrient timing](https://pmc.ncbi.nlm.nih.gov/articles/PMC5596471); ISSN ultra stand: 5–8 g/kg in training, [Tiller et al. 2019](https://pubmed.ncbi.nlm.nih.gov/31699159/)).
- **Protein:** about 1.2–2 g per kg a day, spread across meals. The ISSN puts about 1.6 g/kg as the figure that maintains lean mass, with more under heavy load ([Tiller et al. 2019](https://pubmed.ncbi.nlm.nih.gov/31699159/)).
- **After hard sessions:** carbohydrate and protein together within an hour or two, roughly 1 g/kg of carbohydrate and 0.25–0.4 g/kg of protein ([ACSM 2000 and later reviews](https://fct.unesp.br/Home/Pesquisa/labsim/nutrition.pdf)).
- **Iron, calcium and vitamin D** matter, especially for girls and growing runners. Being tired all the time, missed periods or a stress fracture is a reason to see a doctor.
- **Fluids:** drink to thirst on easy days. On long or hot days, drink regularly and add sodium; sweat rates range from 0.3 to 2.4 L an hour. After a run, replace about 450–675 mL for every 0.5 kg lost ([ACSM](https://lh-hsrc.pnu.edu.sa/wp-content/uploads/2018/11/Nutrition-and-Athletic-Performance-ACSM-2000.pdf)).

## 6. Strength and mobility

- Strength training improves running economy. In a 2024 meta-analysis of 31 studies (652 runners), high loads (at least 80% of 1RM) and combined methods helped most, plyometrics helped at slower speeds, and light or isometric work showed no clear benefit ([Sports Med 2024](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11052887/)). Earlier: 2–3 sessions a week for 8–12 weeks ([2016 meta-analysis](https://pubmed.ncbi.nlm.nih.gov/26694507/)).
- **What Kestrel does:** strength twice a week. Young runners start with bodyweight and good form, and heavier lifting comes with experience and supervision. Hills and plyometrics count as strength work.

## 7. Illness, heat and conditions

- **Illness:** fever, body aches, chest symptoms or a racing heart means no running. The "above the neck" rule is expert opinion, not outcome-tested, and a virus that causes a mild cold in one person can involve the heart in another ([summary](https://ubiehealth.com/doctors-note/workout-with-cold-should-you-above-neck-ruleset-5741e7)). Kestrel treats it as permission for at most an easy run, never as a reason to train hard. Once symptoms clear, restart at half.
- **Heat:** keep the effort and slow the pace. Acclimatizing takes about 10–14 days of shorter, easier sessions in the heat. Kestrel's heat-and-hills calculator already turns this into adjusted paces.
- **Hills, trails and wind:** run by effort, not by pace.

## 8. Race week and race day

- **Taper:** 1–2 weeks for a key race. Cut volume about 41–60% (Kestrel says 40–60%), keep the intensity and the number of runs ([Bosquet et al. 2007](https://coachsci.sdsu.edu/csa/vol131/bosquet.htm); endurance-only meta-analysis, [Wang et al. 2023](https://pubmed.ncbi.nlm.nih.gov/37163550/)). Kestrel's plans already have race and taper weeks; the AI keeps them.
- **Nothing new on race day:** shoes, breakfast, gels and warm-up should all be practiced beforehand.
- **Before:** a carbohydrate-rich meal 1–4 hours before, about 1–4 g/kg ([GSSI](https://www.gssiweb.org/docs/default-source/sse-docs/sse_231_005.pdf)). Warm up with easy running, drills and strides. Start a touch slower than goal pace and aim for even or negative splits.
- **Long races** (over about 90 minutes): eat 10–12 g/kg of carbohydrate a day for the 36–48 hours before, then take 30–60 g an hour during, up to 90 g an hour past about 2.5 hours for trained guts ([GSSI](https://www.gssiweb.org/docs/default-source/sse-docs/sse_231_005.pdf), [PMC table](https://pmc.ncbi.nlm.nih.gov/articles/PMC4672014/table/Tab1)).
- **After:** easy days before hard ones. For long races, roughly one easy day per race mile, a long-standing coaching rule of thumb.

## 9. The season and the long game

- Build an easy base first, add threshold, then sharpen with faster work near the key races. Sequencing effects are real but small ([summary](https://www.8020endurance.com/is-periodization-overrated/)), so Kestrel cares more about consistency than about a perfect structure.
- After a season, take 1–2 weeks of rest or very light activity.
- Young runners should play other sports and peak years from now. Youth running has few adverse effects when it is built gradually, apart from growth-plate vulnerability ([Frontiers 2020](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2020.586141/epub)).

## How the AI uses it

- Every system prompt ends with the short form and the runner's own ethos, which is fenced as data.
- When the runner's ethos clashes with a health rule or the guardrails, the AI follows safety and explains why, kindly.
- The ethos never overrides the server guardrails, which check every plan change whichever model proposed it.
- Food estimates follow section 5: estimates are ranges, the runner edits them before saving, and nothing is framed as eating less.

## Open questions for a human reviewer

- **Teen thresholds:** the youth numbers (long run near 90 minutes, sleep 8–10 hours) are cautious defaults, not tested limits. A youth-sports physician or an experienced high school coach should review them.
- **Sources:** several of the cited links are summaries of the primary studies. Before quoting a figure publicly, check it against the original paper.
