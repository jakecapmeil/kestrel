# How AI was used to build Kestrel

Kestrel was created for the 2026 Congressional App Challenge, and the challenge requires full disclosure of AI use. This is that disclosure.

## What is Jake's

- **The idea and the problem.** Kestrel began as a way for the Hunter Kessler running team to know who was coming to practice. It grew, one need at a time, into training logs, plans, a race predictor and an open model hub, because Jake and his teammates kept hitting the next problem. Every feature came from something the team actually needed.
- **Product and design direction.** What gets built, in what order, how it should work for a runner or a captain, what stays private, what the rules for the coach are.
- **Testing with the team.** The app was used by real teammates and the feedback decided what changed.
- **Architecture decisions and much of the structural code.** The Cloudflare Worker + D1 + Supabase layout, the team, captain and membership model, and the move from a one-team website to an open platform anyone can run.
- **Research direction.** Which running datasets to use, which published formulas to include (Riegel, Daniels, Tanda), and what the open model format should look like.

## What AI did

Jake used **Claude Code** (Anthropic's AI coding tool, Claude Opus and Sonnet models) throughout the project. It is not limited to one corner of the app:

- **Design system.** Jake's original interface was functional but rough. AI helped turn it into a consistent design system (tokens, components, motion, layout).
- **Kestrel Lab and publishing models.** The technical side of packaging, validating, versioning and publishing models, and the advice on how to train them, was beyond Jake's experience when the project started. AI wrote much of that code and explained the methods.
- **Implementation across the codebase.** Under Jake's direction, Claude Code also wrote and edited a large share of the code in both repositories, including features such as watch-sync parsing, course matching and the plan builder. This shows in the public git history: commits co-written with Claude carry a `Co-Authored-By: Claude` line (35 of 49 commits in this repository and 87 of 96 in the earlier [Kessler](https://github.com/jakecapmeil/hawks) repository at the time of writing).
- **The in-app coach.** Kestrel AI is a feature of the app, not a development tool. It runs on an AI model (see [README](README.md) and [THIRD_PARTY.md](THIRD_PARTY.md)) and every plan change it proposes must pass fixed, hand-written guardrails.

## Models used inside the app

- Every model in Kestrel Lab is open weight and open source (`models/`).
- The free default coach tries Google's Gemini first (a closed-weights model), with an open-weight Llama 3.3 70B on Cloudflare Workers AI as the backup. Athletes can instead choose their own provider or a local open model.
- KesslerPredict-Short's weights are published, but one of its training sources has no stated licence (see `models/README.md`).
