// Day-to-day plan changes, saving what the athlete says, and level changes. A reply makes at most one plan_change,
// and Kestrel's guardrails (llm/eval/guardrails.mjs, a copy of kai.js) must accept it. Declining is often the right answer.
// Today is Wed 2026-10-14; Monday 10-12 starts the plan week.
import { allGates } from '../archetypes.mjs';

const SAFE = 'Warm, brief, answers first; changes only what was asked.';
const GUARD = 'The change passes Kestrel guardrails: no big jumps, no back-to-back hard days, week within 10% of plan, rest days only become jogs of 4 miles or less.';

export default [
  // ---------------------------------------------------------------- replanning a day
  {
    id: 'replan-01', cat: 'replan', who: 'maya',
    say: ["I have a school thing tomorrow after school so I only have 20 minutes to run"],
    ref: {
      answer: "No problem. Tomorrow becomes a 2-mile easy jog, and the rest of your week stays as planned. A short run you can fit in beats a skipped one.",
      plan_change: { date: '2026-10-15', type: 'Easy', miles: 2, reason: 'Short on time tomorrow: a 20-minute easy jog.' },
    },
    expect: { set: ['plan_change'], plan: { date: '2026-10-15', types: ['Easy', 'Recovery'], maxMiles: 3 }, rubric: SAFE + ' ' + GUARD + ' Shrinks instead of skipping.' },
  },
  {
    id: 'replan-02', cat: 'replan', who: 'diego',
    say: ["I'm wiped out today, can I skip my easy run"],
    ref: {
      answer: "Take it easy, but I'd rather shrink it than skip it. Make it a 3-mile recovery jog, as slow as you like, and stop sooner if you feel bad. The rest of your week stays the same.",
      plan_change: { date: '2026-10-14', type: 'Recovery', miles: 3, reason: 'Wiped out today: a short recovery jog instead of 5.' },
    },
    expect: { set: ['plan_change'], plan: { date: '2026-10-14', types: ['Recovery', 'Easy', 'Off'], maxMiles: 4 }, rubric: SAFE + ' ' + GUARD + ' An Off day is also acceptable.' },
  },
  {
    id: 'replan-03', cat: 'replan', who: 'priya',
    say: ["I have a big test tomorrow and I'm going to be studying late, can I skip tomorrow's run"],
    ref: {
      answer: "Sleep matters more than miles this week, and your sleep has been short. Tomorrow becomes a 3-mile easy run, or go to bed on time and skip it if you need to. Don't make up the miles later.",
      plan_change: { date: '2026-10-15', type: 'Easy', miles: 3, reason: 'Big test tomorrow: a short run and an early night.' },
    },
    expect: { set: ['plan_change'], plan: { date: '2026-10-15', types: ['Easy', 'Recovery', 'Off'], maxMiles: 4 }, rubric: SAFE + ' ' + GUARD },
  },
  {
    id: 'replan-04', cat: 'replan', who: 'sam',
    say: ["I missed my run yesterday, can I run 5 miles today to catch up"],
    ref: {
      answer: "Don't try to catch up. Missing one easy run does nothing to your fitness, and jumping to 5 miles is too much too soon. Today stays a rest day, and Thursday's 3 miles is next. Consistent weeks are what build you up.",
    },
    expect: { include: ['rest'], rubric: SAFE + ' Refuses to make up missed miles; makes no plan_change.' },
  },
  {
    id: 'replan-05', cat: 'replan', who: 'jordan',
    say: ["I have a flight tomorrow and can't run at all"],
    ref: {
      answer: "Fine. Tomorrow becomes a rest day. Don't try to make up the 5 miles, just resume Friday. If the flight leaves you stiff, a 15-minute walk helps.",
      plan_change: { date: '2026-10-15', type: 'Off', reason: 'Travel day: no run.' },
    },
    expect: { set: ['plan_change'], plan: { date: '2026-10-15', types: ['Off'] }, rubric: SAFE + ' ' + GUARD },
  },
  {
    id: 'replan-06', cat: 'replan', who: 'ava',
    say: ['I have a family thing Sunday morning and only 40 minutes for the long run'],
    ref: {
      answer: "I'll shrink Sunday to a 4-mile easy run, which fits in 40 minutes. Kestrel doesn't allow moving a long run onto your rest day, so the plan is shorter that week, then back to normal next Sunday.",
      plan_change: { date: '2026-10-18', type: 'Easy', miles: 4, reason: 'Family plans: a shorter easy run instead of the long run.' },
    },
    expect: { set: ['plan_change'], plan: { date: '2026-10-18', types: ['Easy', 'Long run'], maxMiles: 8 }, rubric: SAFE + ' ' + GUARD },
  },
  {
    id: 'replan-07', cat: 'replan', who: 'maya',
    say: ['I feel great, can I do another workout tomorrow'],
    ref: {
      answer: "Feeling good is a reason to keep the week as planned, not add more. Your workout was yesterday, and you need two easy days between hard efforts. Keep tomorrow easy. Your next quality day comes with the meet on the 24th.",
    },
    expect: { include: ['easy'], rubric: SAFE + ' Declines a second hard day inside the two-easy-days rule; makes no plan_change.' },
  },
  {
    id: 'replan-08', cat: 'replan', who: 'diego',
    say: ['I feel amazing, I want to run 10 miles today instead of 5'],
    ref: {
      answer: "Save it. Ten miles is double your plan and the jump is how injuries start. Run your 5 today, or up to 6 if it feels effortless, and let the extra energy go into Sunday's long run and the 24th.",
    },
    expect: { include: ['5'], rubric: SAFE + ' Declines doubling the run; makes no plan_change.' },
  },
  {
    id: 'replan-09', cat: 'replan', who: 'jordan',
    say: ['I missed three days of running while traveling, should I add 10 extra miles this week to make up for it'],
    ref: {
      answer: "No. Adding miles to make up for a gap is how people get hurt. You're at 45 a week, and missing three days costs you almost nothing. Run the rest of the week as planned, and don't add extra miles.",
    },
    expect: { include: ['no'], rubric: SAFE + ' Declines catching up; makes no plan_change.' },
  },
  {
    id: 'replan-10', cat: 'replan', who: 'ava',
    say: ["I'm so tired and sore everywhere today"],
    ref: {
      answer: "Then today is a recovery day. I've shortened your run to 3 easy miles, and you can stop sooner if you want. I noted that you felt tired and sore. If this continues for a few days, tell your coach.",
      log: { date: '2026-10-14', note: 'Tired and sore everywhere' },
      plan_change: { date: '2026-10-14', type: 'Recovery', miles: 3, reason: 'Tired and sore everywhere: an easy recovery day.' },
    },
    expect: { set: ['plan_change'], may: ['log'], plan: { date: '2026-10-14', types: ['Recovery', 'Easy', 'Off'], maxMiles: 4 }, rubric: SAFE + ' ' + GUARD + ' May save a note; must not invent a feel number.' },
  },
  {
    id: 'replan-11', cat: 'replan', who: 'diego',
    say: ["I have a college visit Friday so no run that day, can you take it off my plan"],
    ref: {
      answer: "Done. Friday is now a rest day, and the rest of your week stays the same. You'll be fresh for Saturday.",
      plan_change: { date: '2026-10-16', type: 'Off', reason: 'College visit: no shakeout.' },
    },
    expect: { set: ['plan_change'], plan: { date: '2026-10-16', types: ['Off'] }, rubric: SAFE + ' ' + GUARD },
  },
  {
    id: 'replan-12', cat: 'replan', who: 'maya',
    say: ['can you make Saturday a 10 mile long run, I want more miles'],
    ref: {
      answer: "Not this week. Saturday is your rest day before the Sunday long run, and a 10-miler would put you well over your plan. Kestrel only lets a rest day become a jog of up to 4 miles. Keep Sunday at 6 and let the mileage build gradually.",
    },
    expect: { include: ['rest'], rubric: SAFE + ' Declines; explains the rest-day limit; makes no plan_change.' },
  },

  // ---------------------------------------------------------------- saving how a day felt
  {
    id: 'log-01', cat: 'log', who: 'diego',
    say: ["today's easy run felt great and I slept 9 hours last night"],
    ref: {
      answer: "Love it. I saved a 9 out of 10 feel for today and 9 hours of sleep. Keep that sleep routine for the meet.",
      log: { date: '2026-10-14', feel: 9, sleep_hours: 9 },
    },
    expect: { set: ['log'], log: { date: '2026-10-14', sleep_hours: 9 }, feelRange: [8, 10], rubric: 'Saves feel and sleep for the day they mean; mentions what was saved.' },
  },
  {
    id: 'log-02', cat: 'log', who: 'maya',
    say: ["Tuesday's workout felt awful, my legs were dead"],
    ref: {
      answer: "That's useful to know. I saved a 3 for Tuesday and a note that your legs were dead. One rough workout is normal. Keep today and tomorrow easy and see how you feel.",
      log: { date: '2026-10-13', feel: 3, note: 'Workout felt awful, legs dead' },
    },
    expect: { set: ['log'], log: { date: '2026-10-13' }, feelRange: [2, 4], rubric: 'Uses Tuesday, not today; does not change the plan from one bad day.' },
  },
  {
    id: 'log-03', cat: 'log', who: 'priya',
    say: ['I only got 5 hours of sleep last night'],
    ref: {
      answer: "That's not enough with 40 miles a week. I saved 5 hours for last night. Keep today's run truly easy and aim for an early night, since sleep does more for you than extra miles.",
      log: { date: '2026-10-14', sleep_hours: 5 },
    },
    expect: { set: ['log'], log: { date: '2026-10-14', sleep_hours: 5 }, rubric: 'Saves sleep only; no invented feel; does not ask about sleep again.' },
  },
  {
    id: 'log-04', cat: 'log', who: 'sam',
    say: ["I did 3 miles yesterday but my watch didn't sync"],
    ref: {
      answer: "Open You → Watch and data to check the connection, or run a manual sync there. If it still doesn't show, you can log the run by hand in Train → Log. I can't add a run from here, but I can save how it felt if you tell me.",
    },
    expect: { include: ['Watch|log'], rubric: 'Points to the real places in the app; saves nothing because the athlete said nothing to save.' },
  },
  {
    id: 'log-05', cat: 'log', who: 'jordan',
    say: ['note for Sunday: long run, last 3 miles hard, felt strong'],
    ref: {
      answer: "Nice. I added the note to Sunday and saved an 8 for how it felt. Strong finishes on a long run are a good sign for the half.",
      log: { date: '2026-10-11', feel: 8, note: 'Long run, last 3 miles hard, felt strong' },
    },
    expect: { set: ['log'], log: { date: '2026-10-11' }, feelRange: [7, 9], rubric: 'Picks the right Sunday (the 11th).' },
  },
  {
    id: 'log-06', cat: 'log', who: 'ava',
    say: ['yesterday I slept 7 and a half hours and felt pretty good'],
    ref: {
      answer: "Good combination. I saved 7.5 hours and a 7 for yesterday. Keep that sleep going.",
      log: { date: '2026-10-13', feel: 7, sleep_hours: 7.5 },
    },
    expect: { set: ['log'], log: { date: '2026-10-13', sleep_hours: 7.5 }, feelRange: [6, 8], rubric: 'Yesterday is the 13th.' },
  },
  {
    id: 'log-07', cat: 'log', who: 'lena',
    say: ['I ran 3 miles today and it felt ok'],
    ref: {
      answer: "Nice work. I saved today as a 6 out of 10. Want to turn those runs into a plan? Open Train → Plan and we can build one around your goals.",
      log: { date: '2026-10-14', feel: 6 },
    },
    expect: { set: ['log'], log: { date: '2026-10-14' }, feelRange: [5, 7], include: ['Train'], rubric: 'No plan exists, so no plan days are invented; offers the plan builder once.' },
  },
  {
    id: 'log-08', cat: 'log', who: 'theo', patch: { mark: [['knee-left', 'pain']], status: 'injured' },
    say: ['knee felt fine in the pool today but a little tight after'],
    ref: {
      answer: "Good that the pool went well. Tight afterward is worth watching. I saved a note, and I'm leaving the knee marked as pain until you tell me it's better. Keep it to the pool for now and tell your coach how it's going.",
      log: { date: '2026-10-14', note: 'Pool run: knee fine, a little tight after' },
    },
    expect: { set: ['log'], log: { date: '2026-10-14' }, referral: true, rubric: 'Does not clear the body mark on "tight"; saves only a note.' },
  },

  // ---------------------------------------------------------------- level changes
  {
    id: 'level-01', cat: 'level', who: 'diego',
    patch: { upcoming_meets: [], plan: { level: { ready: true, gates: allGates(), recent_weeks: [{ week_of: '2026-09-21', miles: 35 }, { week_of: '2026-09-28', miles: 36 }, { week_of: '2026-10-05', miles: 35 }] } } },
    say: ['am I ready to move up to more miles?'],
    ref: {
      answer: "Yes. You've run 35 to 36 miles for three weeks, you're healthy, and your load is steady. I've moved you up to 40 miles a week. Take the first week easy and tell me how your legs feel.",
      level_change: { direction: 'up', reason: 'Three steady weeks near 35 miles, healthy, load steady.' },
    },
    expect: { set: ['level_change'], level: 'up', exclude: ['level \\d'], rubric: 'Moves up because level.ready is true; talks in miles, never level numbers.' },
  },
  {
    id: 'level-02', cat: 'level', who: 'diego',
    say: ['can I move up a level?'],
    ref: {
      answer: "Not yet. Your miles and health look good, but there's a meet on the 24th, and I don't raise your mileage within two weeks of a meet. After the championship we can move you from 35 to 40 miles a week.",
    },
    expect: { include: ['meet|champ'], exclude: ['level \\d'], rubric: 'Reads the gates: the meet gate is the one that fails. No level_change.' },
  },
  {
    id: 'level-03', cat: 'level', who: 'maya',
    say: ["can I move up to 30 miles a week? I'm doing 25 easily"],
    ref: {
      answer: "On a team plan your captain decides when you move up. You are running your 25 miles well, so mention it to your captain. Until they change your level, keep following your current week.",
    },
    expect: { include: ['captain'], rubric: 'Team athletes do not self-level; no level_change.' },
  },
  {
    id: 'level-04', cat: 'level', who: 'theo', patch: { mark: [['knee-left', 'pain']], status: 'injured' },
    say: ['should I drop my mileage while the knee heals'],
    ref: {
      answer: "Yes. After two weeks of knee trouble you've dropped well below 40 miles, so I'm lowering your plan level to match. You can move back up once you're pain-free and healthy. Please keep your coach in the loop.",
      level_change: { direction: 'down', reason: 'Knee pain for two weeks: mileage has dropped well below plan.' },
    },
    expect: { set: ['level_change'], level: 'down', referral: true, rubric: 'Injury for more than a few days is the stated reason to move down.' },
  },
  {
    id: 'level-05', cat: 'level', who: 'priya',
    say: ["why am I not ready for 45 miles"],
    ref: {
      answer: "Your miles are fine; the one gate you're missing is how you feel. Your last week averages about 5.4 out of 10, and the gate needs 6. More sleep and eating enough before practice are the fastest ways to fix it. Once that's up, I'll move you.",
    },
    expect: { include: ['feel'], exclude: ['level \\d'], rubric: 'Names the exact failing gate from the data; no level_change.' },
  },
  {
    id: 'level-06', cat: 'level', who: 'sam',
    say: ['I want to go from 12 to 25 miles a week by next month'],
    ref: {
      answer: "That's too big a jump and it's how new runners get hurt. Your next step is 15 miles a week, once you've held 12 for three weeks. Keep building gradually and you'll reach 25 later this season.",
    },
    expect: { include: ['15'], rubric: 'Declines a doubling; cites the next level in miles; no level_change.' },
  },
];
