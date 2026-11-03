// Fitness numbers, workouts, how Kestrel works, and athletes with no plan. Every number a reply quotes must be in the
// athlete's data (fitness_projections, plan, goals) or the SITE_GUIDE in src/train/gemini.js.
const NUM = 'Quotes only numbers present in the athlete data; never invents one.';

export default [
  // ---------------------------------------------------------------- Fitness States numbers
  {
    id: 'fit-01', cat: 'numbers', who: 'maya',
    say: ["what's my 5K estimate"],
    ref: { answer: "Your 5K estimate is 21:20, likely between 20:52 and 21:48, with medium confidence. It comes from your 5K PR of 21:40, your 3200 of 12:10 and your 1600 of 5:38. A race in the next few weeks will tighten the range." },
    expect: { include: ['21:20', '20:52', '21:48'], rubric: NUM },
  },
  {
    id: 'fit-02', cat: 'numbers', who: 'diego',
    say: ['what pace should my easy runs be'],
    ref: { answer: "Your easy pace is 7:24 to 8:15 per mile. If you feel good, stay in that range rather than pushing the fast end, since the easy days are what let you hit your workouts. Recovery days can go a bit slower, 8:15 to 9:06." },
    expect: { include: ['7:24', '8:15'], rubric: NUM + ' Uses his own pace zones.' },
  },
  {
    id: 'fit-03', cat: 'numbers', who: 'priya',
    say: ['why is my 3200 estimate 11:04 when my PR is 11:09'],
    ref: { answer: "The estimate is what you'd likely run today if rested and racing, and it's 5 seconds faster than your PR because your 5K PR of 19:30 and your 1600 of 5:09 point to a faster 3200. The range is 10:48 to 11:21, so your PR sits inside it. I can't see why it's exactly 11:04, only which results it's based on. A 3200 race will settle it." },
    expect: { include: ['11:04', '10:48', '11:21'], rubric: NUM + ' Explains what the estimate means; admits it cannot see the model internals; names based_on results.' },
  },
  {
    id: 'fit-04', cat: 'numbers', who: 'sam',
    say: ['how fast could I run a 5K'],
    ref: { answer: "Kestrel's estimate is 29:30, likely between 28:51 and 30:09, but the confidence is low. You only have one result so far, a 1600 in 8:45, and the estimate can't be very precise yet. A 5K time trial or a race would sharpen it. Right now, finishing it matters more than the time." },
    expect: { include: ['29:30', 'low'], rubric: NUM + ' Explains low confidence honestly.' },
  },
  {
    id: 'fit-05', cat: 'numbers', who: 'jordan',
    say: ['what half marathon time does Kestrel predict for me'],
    ref: { answer: "I don't have a half marathon estimate in your data, only 1600, 3200 and 5K. Your 5K estimate is 21:00 (20:32 to 21:28), and your half PR is 1:38:30. Adding a recent race or hard long run will help Kestrel produce a better figure. Your 1:35 goal is a real stretch from your current results, so the training between now and the 22nd matters." },
    expect: { include: ['half', "don't|doesn"], rubric: NUM + ' Does not make up a half marathon prediction; says it is missing.' },
  },
  {
    id: 'fit-06', cat: 'numbers', who: 'theo',
    say: ["what's my VO2max"],
    ref: { answer: "Your VO2max estimate is 59, with medium confidence. It comes from your 5K, 3200 and 1600 results. With the knee break, the number reflects your racing, so expect it to dip a little in training before it comes back." },
    expect: { include: ['59'], rubric: NUM },
  },
  {
    id: 'fit-07', cat: 'numbers', who: 'ava',
    say: ['what does form mean on the fitness page'],
    ref: { answer: "Form is fitness minus fatigue. Fitness is your 42-day training load, fatigue is your last 7 days, and positive form means you're fresh. Yours is -3: fitness 38 and fatigue 41, so you're a little tired, which is normal in a training week. It should climb before the meet if you keep your easy days easy." },
    expect: { include: ['-3', '38', '41'], rubric: NUM },
  },
  {
    id: 'fit-08', cat: 'numbers', who: 'lena',
    say: ['am I fast'],
    ref: { answer: "Fast is relative, so here's the data: your 5K estimate is 23:40, with low confidence because you only have one result. What matters is that you're improving. Race or time yourself once more and Kestrel will give you a better picture. Want to build a plan from Train → Plan?" },
    expect: { include: ['23:40'], rubric: NUM + ' Encouraging, not comparative.' },
  },

  // ---------------------------------------------------------------- workout suggestions
  {
    id: 'work-01', cat: 'workout', who: 'maya',
    say: ['give me a tempo workout'],
    ref: { answer: "Try the 3-mile tempo from the library. Warm up 1.5 miles easy, then 3 miles at 7:33 per mile, steady and comfortably hard, then cool down 1.5 miles easy. Keep it on a flat route. It should feel like you could do one more mile at the end." },
    expect: { include: ['7:33', 'warm', 'cool'], rubric: 'Uses a library workout with warm-up, main set and cool-down; target pace is her own tempo pace (7:33).' },
  },
  {
    id: 'work-02', cat: 'workout', who: 'diego',
    say: ["what are my targets for Tuesday's 5x1K"],
    ref: { answer: "Run the five 1Ks at 5K pace, 5:41 per mile, which is about 3:32 per 1K. Warm up 1.5 miles, take 200 meters of jogging or 90 seconds standing between reps, then cool down 1.5 miles. The last rep should be as fast as the first." },
    expect: { include: ['3:32', 'warm', 'cool'], rubric: '1K at 5:41/mile is about 3:32; pulls from the library 5x1K at 5K.' },
  },
  {
    id: 'work-03', cat: 'workout', who: 'priya',
    say: ['what pace for the 4 x 1 mile?'],
    ref: { answer: "Run each mile at threshold pace, 6:38. Warm up with 2 miles easy, jog 200 meters between reps, and cool down 2 miles. Every mile should be within a couple of seconds of 6:38, comfortably hard but controlled." },
    expect: { include: ['6:38', 'warm', 'cool'], rubric: 'Threshold pace comes from her pace zones.' },
  },
  {
    id: 'work-04', cat: 'workout', who: 'ava',
    say: ["I can't get to the track, what's a good fartlek"],
    ref: { answer: "Do the 6x1 minute fartlek. Warm up 10 minutes easy, then 6 times: 1 minute on at 5K effort (about 7:15 per mile), 1 minute easy jog. Cool down 10 minutes. You can do it on any road or path, and use a watch, not a measured route." },
    expect: { include: ['7:15', 'warm', 'cool'], rubric: 'Library fartlek-6x1 with her 5K pace.' },
  },
  {
    id: 'work-05', cat: 'workout', who: 'jordan',
    say: ['what pace for the 3 x 2 mile tempo today'],
    ref: { answer: "Your tempo pace is 7:26 per mile, so each 2 miles should take about 14:52. Run all three at the same pace, with 2 to 3 minutes easy jogging between. Warm up 2 miles, cool down 1 to 2." },
    expect: { include: ['7:26', '14:52'], rubric: '2 x 7:26 is 14:52.' },
  },
  {
    id: 'work-06', cat: 'workout', who: 'sam',
    say: ['what workout should I do to get faster'],
    ref: { answer: "For now, your best speed work is easy running plus strides. Try the Easy 30 + strides workout: 30 minutes easy, then 6 quick 20-second strides with a full walk back. It teaches your legs to turn over without adding stress. Hard workouts can wait until you've built more weekly mileage." },
    expect: { include: ['stride'], rubric: 'Beginner: no hard intervals; uses a library workout; no paces from low-confidence data.' },
  },

  // ---------------------------------------------------------------- how Kestrel works
  {
    id: 'how-01', cat: 'howto', who: 'sam',
    say: ['how do I connect my Garmin'],
    ref: { answer: "Garmin syncs through a free site called intervals.icu. Open You → Watch and data for the step-by-step guide. You'll make an intervals.icu account, connect Garmin there, then paste your Athlete ID and API key into Kestrel. Both are at the bottom of intervals.icu Settings under Developer Settings." },
    expect: { include: ['intervals.icu', 'Watch and data'], rubric: 'Matches the SITE_GUIDE watch-sync paragraph.' },
  },
  {
    id: 'how-02', cat: 'howto', who: 'maya',
    say: ['can my coach see my training and health stuff'],
    ref: { answer: "No. Coaches can't see an athlete's training or health in Kestrel, and teammates never see each other's health or log. Only you and your Kestrel coach can see your body map and readiness. Names appear on the team mileage board only for athletes who choose to share." },
    expect: { include: ["can't|cannot|no"], rubric: 'Matches the teams/privacy paragraph.' },
  },
  {
    id: 'how-03', cat: 'howto', who: 'diego',
    say: ['how do I delete my data'],
    ref: { answer: "Go to You → Settings → Delete my Kestrel data. That removes everything Kestrel has about you." },
    expect: { include: ['Delete my Kestrel data'], rubric: 'Short and exact.' },
  },
  {
    id: 'how-04', cat: 'howto', who: 'jordan',
    say: ['can I use my own AI model for the coach'],
    ref: { answer: "Yes. Open Kestrel Lab at /lab and go to Providers. You can use your own key from OpenAI, Anthropic, Gemini, OpenRouter or Groq, or a model on your computer through Ollama or LM Studio. The plan rules and safety checks are the same whichever model you pick, and your key stays in your browser." },
    expect: { include: ['Providers'], rubric: 'Matches the Kestrel AI paragraph.' },
  },
  {
    id: 'how-05', cat: 'howto', who: 'priya',
    say: ['what are the tabs at the bottom for'],
    ref: { answer: "Schedule is the team calendar. Train has your plan, log, goals, cross-training, fuel, workouts, fitness and this chat. Record is your training log of every run. Team has the roster, meets, places and team mileage. You is your profile, PRs, health, watch connections and AI settings." },
    expect: { include: ['Schedule', 'Train', 'Record', 'Team', 'You'], rubric: 'Covers the five tabs accurately.' },
  },
  {
    id: 'how-06', cat: 'howto', who: 'lena',
    say: ['I have an Apple Watch, how do I sync it'],
    ref: { answer: "Apple Watch needs an iPhone app like HealthFit or RunGap to upload your runs to intervals.icu, which then syncs to Kestrel. You → Watch and data has a step-by-step guide. Strava can't be the link, since it doesn't let intervals.icu share runs. You can also log runs by hand." },
    expect: { include: ['HealthFit|RunGap', 'intervals.icu'], rubric: 'Matches the guide: no Strava link.' },
  },
  {
    id: 'how-07', cat: 'howto', who: 'maya',
    say: ['what do fitness, fatigue and form mean'],
    ref: { answer: "Fitness is your average training load over the last 42 days. Fatigue is your load over the last 7 days. Form is fitness minus fatigue, and a positive form means you're fresh. Right now yours is -3, so you're slightly tired, which is normal in the middle of a week." },
    expect: { include: ['42', '7'], rubric: 'Matches the Fitness States paragraph; uses her -3 form.' },
  },
  {
    id: 'how-08', cat: 'howto', who: 'ava',
    say: ['how do I start a team for my school'],
    ref: { answer: "Anyone can start a team, and others join with an invite code or link. The owner and any captains they name manage the calendar and build the team training plan with Kestrel AI. You'll find it under the Team tab." },
    expect: { include: ['invite'], rubric: 'Matches the Teams paragraph.' },
  },
  {
    id: 'how-09', cat: 'howto', who: 'diego',
    say: ['can I change which tabs I see in Train'],
    ref: { answer: "Yes. Tap the sliders icon at the end of the Train tabs, or go to You → Profile → Customize Train tabs. You can choose which tabs show and their order." },
    expect: { include: ['Customize|sliders'], rubric: 'Matches the guide.' },
  },
  {
    id: 'how-10', cat: 'howto', who: 'theo',
    say: ['does Kestrel track what I eat'],
    ref: { answer: "Yes. The Fuel tab in Train lets you log food against carbohydrate and protein targets scaled to the day's training. It's about eating enough for your running, not restricting. I can see your fuel log in the chat once you've added some." },
    expect: { include: ['Fuel'], rubric: 'Matches the Fueling paragraph; fuel_last_7_days is empty so no numbers.' },
  },
  {
    id: 'how-11', cat: 'howto', who: 'jordan',
    say: ['does Kestrel work with Strava'],
    ref: { answer: "Not directly. Strava can't be the link because it doesn't let intervals.icu share runs. Garmin, COROS, Suunto, Polar and Wahoo watches sync through intervals.icu, and an Apple Watch uses an app like HealthFit or RunGap. You can also log runs by hand." },
    expect: { include: ['intervals.icu'], rubric: 'Matches the guide.' },
  },
  {
    id: 'how-12', cat: 'howto', who: 'priya',
    say: ['is there a Kestrel app in the App Store'],
    ref: { answer: "My guide doesn't say whether there's an App Store app, so I can't answer that reliably. Kestrel runs in your phone's browser at kestrel.jakecapmeil.workers.dev. If you want the exact answer, ask your captain or check the Kestrel page on GitHub." },
    expect: { include: ["doesn't|don't|not"], rubric: 'Says it is not covered rather than inventing an answer; may point to what the guide does say.' },
  },

  // ---------------------------------------------------------------- no plan yet (has_plan is false)
  {
    id: 'noplan-01', cat: 'noplan', who: 'lena',
    say: ['what should I run tomorrow'],
    ref: { answer: "You don't have a plan yet, so open Train → Plan and build one with me. Until then, an easy 20 to 30 minute run at a pace where you can talk is a safe default." },
    expect: { include: ['Train'], rubric: 'Does not invent plan days; points to the plan builder.' },
  },
  {
    id: 'noplan-02', cat: 'noplan', who: 'lena',
    say: ['can you move my Thursday run to Friday'],
    ref: { answer: "You don't have a plan yet, so there's nothing to move. Open Train → Plan and we'll build one around the days you can run." },
    expect: { include: ['plan'], rubric: 'No plan_change; builder pointer.' },
  },
  {
    id: 'noplan-03', cat: 'noplan', who: 'lena',
    say: ['how do I make a plan'],
    ref: { answer: "Open Train → Plan and choose Build with Kestrel AI. Tell me your goal, how many days a week you can run, and any long run day, and I'll draft a plan. You can then ask for changes until it feels right and save it." },
    expect: { include: ['Train'], rubric: 'Matches the plan-builder flow.' },
  },
  {
    id: 'noplan-04', cat: 'noplan', who: 'lena',
    say: ["I'm running a 5K in three weeks and I've never raced"],
    ref: { answer: "Exciting. Your 5K estimate is 23:40, with low confidence because you have just one result, so use it as a rough target. Open Train → Plan and I'll build you a three-week plan toward the race. For now, keep runs easy and aim to finish feeling strong." },
    expect: { include: ['23:40', 'Train'], rubric: 'Quotes the estimate with its low confidence; points to the builder; invents no plan days.' },
  },
];
